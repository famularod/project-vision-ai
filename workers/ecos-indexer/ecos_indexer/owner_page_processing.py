"""Actual owner-preview selected-page processing, separate from legacy worker.

The caller supplies already prepared execution identity and exact immutable page
attempt/CAS IDs. This function claims, downloads the private original, reads the
SAME immutable bytes through native/table/rendered OCR, registers the actual
measurement, confirms per-page durable readback, then releases its claim.

Release means this bounded control run ended, never full document/library
coverage, image availability, semantic verification or answer readiness. Failure
may leave immutable page attempts; errors expose reconciliation IDs, not a
successful partial evidence packet. Cleanup uses a separate exact-scope gateway
so an uncertain primary network operation cannot prevent finish-before-claim.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import threading
import time
from typing import Any, Mapping, TYPE_CHECKING

if TYPE_CHECKING:
    from .owner_page_raster_gateway import OwnerPageRasterGateway
    from .owner_source_scan import OwnerSourceScanner

from .original_document_reader import read_original_document_pages
from .owner_execution import ServiceAttestedMeasurement, _freeze, _thaw, exact_object, integer, uuid
from .owner_execution_gateway import OwnerExecutionGateway
from .owner_original_download import OwnerOriginalDownloader
from .owner_original_limits import MAX_BUFFERED_ORIGINAL_BYTES
from .owner_page_checkpoint_gateway import OwnerPageCheckpointGateway, page_summary
from .owner_service_limits import (
    OWNER_PAGE_READER_TIMEOUT_SECONDS,
    OWNER_PROCESSING_TIMEOUT_SECONDS,
)

MAX_RETAINED_BYTES = 64 * 1024 * 1024
DIAGNOSTIC_STAGES = frozenset({"input", "claim", "download", "read_pages", "validate_pages",
    "register", "checkpoint", "checkpoint_readback", "raster", "finish"})
DIAGNOSTIC_REASONS = frozenset({"invalid_request", "cancelled", "deadline_exceeded", "operation_failed",
    "invalid_response", "source_not_current", "original_bytes_mismatch", "operation_in_flight",
    "unsupported_kernel", "cleanup_failed", "source_integrity_failed", "source_inspection_failed",
    "page_payload_limit", "batch_retained_limit", "scan_not_clean", "scan_unavailable", "scan_limit_exceeded", "scan_size_limit",
    "scan_file_size_limit", "scan_file_count_limit", "scan_recursion_limit", "scan_time_limit",
    "pdf_identity_mismatch", "pdf_inspection_failed", "checkpoint_not_current"})


def safe_failure_reason(error):
    # Never log exception text, class names, paths, provider bodies or credentials.
    value = getattr(error, "diagnostic_reason", None) or getattr(error, "code", None)
    return value if type(value) is str and value in DIAGNOSTIC_REASONS else "unclassified"


class OwnerPageProcessingError(Exception):
    def __init__(self, code: str, *, claim_id: str | None = None, confirmed_attempt_ids=(),
                 uncertain_attempt_id: str | None = None, cleanup: str = "not_attempted",
                 confirmed_upload_attempt_ids=(), uncertain_upload_attempt_id: str | None = None,
                 diagnostic_stage="input", diagnostic_reason="unclassified"):
        self.code = code if code in {"invalid_request", "cancelled", "deadline_exceeded", "processing_failed"} else "processing_failed"
        self.claim_id = claim_id
        self.confirmed_attempt_ids = tuple(confirmed_attempt_ids)
        self.uncertain_attempt_id = uncertain_attempt_id
        self.cleanup = cleanup
        self.confirmed_upload_attempt_ids = tuple(confirmed_upload_attempt_ids)
        self.uncertain_upload_attempt_id = uncertain_upload_attempt_id
        self.successful_evidence_prefix = False
        self.external_network_termination_proven = False
        self.recovery = "read_exact_attempt_ids_and_claim_state_before_new_work"
        self.diagnostic_stage = diagnostic_stage if diagnostic_stage in DIAGNOSTIC_STAGES else "input"
        self.diagnostic_reason = diagnostic_reason if diagnostic_reason in DIAGNOSTIC_REASONS else "unclassified"
        super().__init__("Owner page processing not confirmed")


@dataclass(frozen=True, eq=False)
class OwnerPageProcessingResult:
    value: Mapping[str, Any]

    def to_dict(self) -> dict:
        """Contains raw raster bytes; caller must not JSON/base64 them blindly."""
        return _thaw(self.value)


def _encoded(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _validate_batch(batch, identity, selected):
    b = exact_object(batch, frozenset("schema_version measurement selected_pages coverage pages retrieval_authorized semantic_verified".split()))
    measurement = exact_object(b["measurement"], frozenset(("source_sha256", "source_page_count", "byte_length")))
    measure = ServiceAttestedMeasurement(**measurement)
    measure.to_wire(identity)
    if (b["schema_version"] != "ecos-original-document-page-batch/2.1" or b["coverage"] != "selected_pages_only"
            or b["retrieval_authorized"] is not False or b["semantic_verified"] is not False
            or type(b["selected_pages"]) is not list or b["selected_pages"] != selected
            or any(type(n) is not int for n in b["selected_pages"])
            or type(b["pages"]) is not list or len(b["pages"]) != len(selected)):
        raise ValueError()
    pages = []; retained = 0
    for number, raw_entry in zip(selected, b["pages"]):
        entry = exact_object(raw_entry, frozenset(("payload", "payload_json", "payload_sha256", "raster_png")))
        raw = entry["payload_json"]
        if type(raw) is not str or len(raw) > 6 * 1024 * 1024:
            raise ValueError()
        encoded = raw.encode("utf-8", errors="strict")
        if len(encoded) > 6 * 1024 * 1024 or hashlib.sha256(encoded).hexdigest() != entry["payload_sha256"]:
            raise ValueError()
        payload = exact_object(json.loads(raw), frozenset("schema_version source_sha256 source_page_count byte_length page_number native table visual retrieval_authorized semantic_verified".split()))
        if payload != entry["payload"] or payload["schema_version"] != "ecos-original-page-observations/2.1":
            raise ValueError()
        for key, value in measurement.items():
            if type(payload[key]) is not type(value) or payload[key] != value:raise ValueError()
        if type(payload["page_number"]) is not int or payload["page_number"] != number or payload["retrieval_authorized"] is not False or payload["semantic_verified"] is not False:
            raise ValueError()
        modalities = {}
        for lane in ("native", "table", "visual"):
            slot = exact_object(payload[lane], frozenset(("state", "observations", "limitation_codes")))
            observed = slot["observations"]
            if observed is not None and type(observed) is not dict:raise ValueError()
            modalities[lane] = {"state": slot["state"], "payload_json": None if observed is None else _encoded(observed).decode(),
                                "limitation_codes": slot["limitation_codes"]}
        raster = entry["raster_png"]
        visual = payload["visual"]
        if visual["state"] == "failed":
            if raster is not None or visual["observations"] is not None:raise ValueError()
        elif (type(raster) is not bytes or len(raster) > 32 * 1024 * 1024 or not visual["observations"]
              or hashlib.sha256(raster).hexdigest() != visual["observations"]["raster"]["sha256"]):
            raise ValueError()
        wrapper = {"schema_version": "ecos-owner-page-observations/2.1", "source_sha256": measurement["source_sha256"],
                   "source_revision": identity.request["source_revision"], "source_page_count": measurement["source_page_count"],
                   "page_number": number, "extraction_version": identity.request["extraction_version"], "modalities": modalities}
        wrapper, _ = page_summary(wrapper, identity)
        # Returned reader entry retains both parsed and exact JSON forms, plus
        # raw PNG; reserve compact checkpoint/control metadata in the batch cap.
        retained += len(_encoded({**entry, "raster_png": None})) + (len(raster) if raster is not None else 0)
        if retained + 262144 > MAX_RETAINED_BYTES:raise ValueError()
        pages.append((entry, wrapper))
    return measurement, measure, pages


def _separate_sealed_images(batch, identity, selected):
    """Validate and detach /2.2 sealed-reader images from the unchanged /2.1 batch."""
    from .original_page_image import decode_original_page_image
    b = exact_object(batch, frozenset(
        "schema_version measurement selected_pages coverage pages images retrieval_authorized semantic_verified".split()))
    if (b["schema_version"] != "ecos-original-document-page-batch/2.2"
            or b["selected_pages"] != selected or type(b["pages"]) is not list):
        raise ValueError()
    images = b["images"]
    if type(images) is not list or len(images) != len(selected):raise ValueError()
    result = []
    for number, supplied in zip(selected, images):
        image = exact_object(supplied, frozenset(("page_number", "image_payload_json", "raster_png")))
        if type(image["page_number"]) is not int or image["page_number"] != number:raise ValueError()
        raw, png = image["image_payload_json"], image["raster_png"]
        if raw is None or png is None:
            if raw is not None or png is not None:raise ValueError()
            result.append((None, None));continue
        metadata = decode_original_page_image(raw, source_sha256=identity.request["source_sha256"],
            source_page_count=identity.request["source_page_count"], page_number=number)
        if (type(png) is not bytes or len(png) != metadata["raster_byte_count"]
                or hashlib.sha256(png).hexdigest() != metadata["raster_sha256"]):raise ValueError()
        result.append((png, raw))
    legacy = {key: b[key] for key in ("measurement", "selected_pages", "coverage", "pages",
                                      "retrieval_authorized", "semantic_verified")}
    legacy["schema_version"] = "ecos-original-document-page-batch/2.1"
    return legacy, result


def process_owner_pages(*, gateway: OwnerExecutionGateway, cleanup_gateway: OwnerExecutionGateway,
                        downloader: OwnerOriginalDownloader, checkpoints: OwnerPageCheckpointGateway,
                        claim_id: str, page_attempts: list[dict], cancel_event: threading.Event | None = None,
                        total_timeout: float = OWNER_PROCESSING_TIMEOUT_SECONDS, cleanup_timeout: float = 5,
                        reader_stage_timeout: float = 20, dpi: int = 250, psm: int = 11,
                        raster_gateway: OwnerPageRasterGateway | None = None,
                        raster_attempts: list[dict] | None = None,
                        source_scanner: OwnerSourceScanner | None = None,
                        sealed_original: bool = False,
                        independent_images: bool = False,
                        scanner_service=None) -> OwnerPageProcessingResult:
    """Bounded background run plus independent cleanup<=5s on failure.

    Network operations may settle after a caller timeout. Parser cancellation is
    forwarded to the killable/reaped subprocess reader; no parser is abandoned
    in a background processing thread. Exact attempt/predecessor IDs are never
    generated, replaced or retried automatically here.

    Optional raster persistence is explicit /2.2. Default None keeps the exact
    /2.1 output and original call sequence. Every upload/CAS/mode is supplied
    before the claim; no image-copy work is inferred from a successful OCR lane.
    The separate owner launcher chooses sealed_original=True: its reader scans
    the immutable descriptor itself and never reconstructs the original bytes.
    False retains the existing local diagnostic/direct-call sequence. This is
    trusted service configuration, never a field in a customer dispatch. Both
    paths retain downstream registration checks. Only the sealed path admits
    larger originals; legacy buffered downloads and retained output stay 64MiB.
    The explicit /2.3 option keeps separate original images even when OCR
    fails. It requires a raster port and either the direct path's scanner or
    the sealed reader's intrinsic scan. The customer dispatch cannot toggle it.
    """
    try:
        if (type(gateway) is not OwnerExecutionGateway or type(cleanup_gateway) is not OwnerExecutionGateway or gateway is cleanup_gateway
                or type(downloader) is not OwnerOriginalDownloader or type(checkpoints) is not OwnerPageCheckpointGateway):raise ValueError()
        from .owner_clamd_scanner import OwnerClamdScanner
        if (type(sealed_original) is not bool or (sealed_original and source_scanner is not None)
                or scanner_service is not None and (not sealed_original or type(scanner_service) is not OwnerClamdScanner)):
            raise ValueError()
        if (type(independent_images) is not bool or independent_images and
                (raster_gateway is None or (not sealed_original and source_scanner is None))):
            raise ValueError()
        identity = gateway.identity
        if not sealed_original and identity.expected_byte_length > MAX_BUFFERED_ORIGINAL_BYTES:
            raise ValueError()
        if source_scanner is not None:
            from .owner_source_scan import OwnerSourceScanner
            if type(source_scanner) is not OwnerSourceScanner:raise ValueError()
        for other in (cleanup_gateway.identity, checkpoints.identity):
            if dict(other.request) != dict(identity.request) or other.expected_byte_length != identity.expected_byte_length:raise ValueError()
        uuid(claim_id)
        if (type(page_attempts) is not list or not 1 <= len(page_attempts) <= 8
                or (cancel_event is not None and type(cancel_event) is not threading.Event)
                or type(total_timeout) not in (int, float) or not 0 < total_timeout <= OWNER_PROCESSING_TIMEOUT_SECONDS
                or type(cleanup_timeout) not in (int, float) or not 0 < cleanup_timeout <= 5
                or type(reader_stage_timeout) not in (int, float) or not 0 < reader_stage_timeout <= 60
                or type(dpi) is not int or not 72 <= dpi <= 400 or type(psm) is not int or psm not in (3, 6, 11)):raise ValueError()
        attempts = []
        for value in page_attempts:
            a = exact_object(value, frozenset(("page_number", "attempt_id", "expected_previous_attempt_id")))
            integer(a["page_number"], 1, identity.request["source_page_count"]); uuid(a["attempt_id"])
            if a["expected_previous_attempt_id"] is not None:
                uuid(a["expected_previous_attempt_id"])
                if a["attempt_id"] == a["expected_previous_attempt_id"]:raise ValueError()
            attempts.append(a)
        selected = [a["page_number"] for a in attempts]
        if selected != sorted(set(selected)) or len({a["attempt_id"] for a in attempts}) != len(attempts):raise ValueError()
        raster_plan = []
        if raster_gateway is None:
            if raster_attempts is not None:raise ValueError()
        else:
            # Keep the optional Pillow/storage module out of the disabled path.
            from .owner_page_raster_gateway import OwnerPageRasterGateway
            if type(raster_gateway) is not OwnerPageRasterGateway:raise ValueError()
            raster_gateway.require_scope(gateway, checkpoints)
            if type(raster_attempts) is not list or len(raster_attempts) != len(attempts):raise ValueError()
            for number, supplied in zip(selected, raster_attempts):
                a = exact_object(supplied, frozenset(("page_number", "upload_attempt_id", "expected_previous_upload_attempt_id", "mode")))
                integer(a["page_number"],1,identity.request["source_page_count"])
                if a["page_number"] != number:raise ValueError()
                uuid(a["upload_attempt_id"])
                if a["upload_attempt_id"][14] != "4":raise ValueError()
                previous = a["expected_previous_upload_attempt_id"]
                if previous is not None:
                    uuid(previous)
                    if previous[14] != "4" or previous == a["upload_attempt_id"]:raise ValueError()
                if type(a["mode"]) is not str or a["mode"] not in {"upload", "reconcile"}:raise ValueError()
                raster_plan.append(a)
            if len({a["upload_attempt_id"] for a in raster_plan}) != len(raster_plan):raise ValueError()
    except Exception:
        raise OwnerPageProcessingError("invalid_request") from None
    started = time.monotonic(); deadline = started + total_timeout
    stop = threading.Event(); done = threading.Event()
    claim_attempted = False; confirmed = []; uncertain = None
    confirmed_uploads = []; uncertain_upload = None
    image_entries = []
    stage = "claim"
    def check():
        if cancel_event is not None and cancel_event.is_set():raise OwnerPageProcessingError("cancelled")
        if stop.is_set() or time.monotonic() >= deadline:raise OwnerPageProcessingError("deadline_exceeded")
    def watch():
        while not done.wait(min(0.01, max(0.001, deadline-time.monotonic()))):
            if (cancel_event is not None and cancel_event.is_set()) or time.monotonic() >= deadline:
                stop.set();return
    watcher = threading.Thread(target=watch, name="ecos-owner-page-deadline", daemon=True); watcher.start()
    try:
        check(); claim_attempted = True
        claim = gateway.claim(claim_id, cancel_event=stop)
        gateway.require_download_identity(claim); check()
        if sealed_original:
            # Import only after exact input validation/claim. There is no byte
            # fallback when the kernel, scan, descriptor or close is unavailable.
            from .owner_original_spool_download import download_owner_original_spool
            from .owner_original_fd_page_reader import read_owner_original_spool_pages
            stage = "download"
            with download_owner_original_spool(downloader, gateway, claim, cancel_event=stop,
                                               caller_cancel_event=cancel_event) as original:
                check()
                stage = "read_pages"
                batch = read_owner_original_spool_pages(gateway, claim, original, pages=selected,
                    total_timeout=min(OWNER_PAGE_READER_TIMEOUT_SECONDS, max(0.001, deadline-time.monotonic())), stage_timeout=reader_stage_timeout,
                    dpi=dpi, psm=psm, cancel_event=stop, caller_cancel_event=cancel_event,
                    independent_images=independent_images, scanner_service=scanner_service)
                check()
            # Close must be confirmed before any registration/checkpoint. The
            # context manager owns the original on every success/failure path.
            check()
        else:
            stage = "download"
            original = downloader.download(gateway, claim, cancel_event=stop); check()
            stage = "read_pages"
            if source_scanner is not None:
                source_scanner.scan(original, expected_sha256=identity.request["source_sha256"],
                                    deadline_monotonic=deadline, cancel_event=stop)
                check()
            if independent_images:
                from .original_raster_reader import render_original_page_images
                from .original_page_image import original_page_image_payload, decode_original_page_image
                images = render_original_page_images(original, expected_sha256=identity.request['source_sha256'],
                    expected_page_count=identity.request['source_page_count'], pages=selected,
                    total_timeout=min(100, max(0.001, deadline-time.monotonic())), stage_timeout=reader_stage_timeout,
                    dpi=dpi, cancel_event=stop)
                check()
                if images['selected_pages'] != selected or len(images['pages']) != len(selected) or images['source_byte_count'] != len(original):
                    raise ValueError()
                for index, number in enumerate(selected):
                    image_raw = original_page_image_payload(images, index)
                    decode_original_page_image(image_raw, source_sha256=identity.request['source_sha256'],
                        source_page_count=identity.request['source_page_count'], page_number=number)
                    image_entries.append((images['pages'][index]['raster_png'], image_raw))
                del images
            batch = read_original_document_pages(original, expected_sha256=identity.request["source_sha256"],
                        expected_page_count=identity.request["source_page_count"], pages=selected,
                        total_timeout=min(100, max(0.001, deadline-time.monotonic())), stage_timeout=reader_stage_timeout,
                        dpi=dpi, psm=psm, cancel_event=stop)
        stage = "validate_pages"
        if sealed_original and independent_images:
            batch, image_entries = _separate_sealed_images(batch, identity, selected)
        check()
        measurement, measured, entries = _validate_batch(batch, identity, selected)
        if independent_images:
            # Account for both retained packets; do not silently double the
            # existing batch budget. This does not claim a total RSS bound.
            retained_bytes = sum((len(png) if png is not None else 0)
                                 + (len(raw.encode('utf-8')) if raw is not None else 0)
                                 for png, raw in image_entries)
            for entry, _ in entries:
                retained_bytes += len(_encoded({**entry, 'raster_png': None})) + len(entry['raster_png'] or b'')
            if retained_bytes + 262144 > MAX_RETAINED_BYTES:raise ValueError()
        check()
        del original
        stage = "register"
        registered = gateway.register(claim, measured, cancel_event=stop); check()
        retained = []; receipts = []; raster_receipts = []
        for index, (attempt, (entry, page)) in enumerate(zip(attempts, entries)):
            check(); uncertain = attempt["attempt_id"]
            stage = "checkpoint"
            saved = checkpoints.record(gateway, registered, attempt_id=attempt["attempt_id"],
                         expected_previous_attempt_id=attempt["expected_previous_attempt_id"], page=page, cancel_event=stop)
            check()
            stage = "checkpoint_readback"
            readback = checkpoints.read(page_number=attempt["page_number"], expected_attempt_id=attempt["attempt_id"], cancel_event=stop)
            check()
            if (_thaw(readback.page) != page or readback.receipt["head"]["page_sha256"] != saved.receipt["head"]["page_sha256"]
                    or readback.receipt["head"]["version"] != saved.receipt["head"]["version"]):raise ValueError()
            confirmed.append(attempt["attempt_id"]); uncertain = None
            receipts.append({"page_number": attempt["page_number"], "head": _thaw(readback.receipt["head"]),
                             "state": "current_at_readback", "image_available": False})
            if raster_gateway is not None:
                planned = raster_plan[index]
                pin = {"page_number":attempt["page_number"],"page_attempt_id":attempt["attempt_id"],
                       "page_sha256":readback.receipt["head"]["page_sha256"],"upload_attempt_id":planned["upload_attempt_id"]}
                png, image_raw = image_entries[index] if independent_images else (entry['raster_png'], None)
                if png is None:
                    raster_receipts.append({**pin,"state":"not_attempted_no_raster","receipt_sha256":None,"raster_sha256":None,
                                            "limitation_codes":list(page["modalities"]["visual"]["limitation_codes"])})
                else:
                    stage = "raster"
                    check();uncertain_upload = planned["upload_attempt_id"]
                    image_kwargs = {'image_payload_json': image_raw} if independent_images else {}
                    raster = raster_gateway.persist(png,page_number=attempt["page_number"],
                        expected_page_attempt_id=attempt["attempt_id"],expected_page_sha256=pin["page_sha256"],
                        upload_attempt_id=planned["upload_attempt_id"],expected_previous_upload_attempt_id=planned["expected_previous_upload_attempt_id"],
                        mode=planned["mode"],cancel_event=stop,caller_cancel_event=cancel_event,**image_kwargs)
                    check()
                    confirmed_uploads.append(planned["upload_attempt_id"]);uncertain_upload = None
                    raster_receipts.append({**pin,"state":"copy_verified_at_readback","receipt_sha256":raster.readback["receipt_sha256"],
                        "raster_sha256":raster.attestation["raster_sha256"],"limitation_codes":["copy_readback_not_future_image_availability","semantic_verification_pending"]})
            retained.append(entry)
        stage = "finish"
        released = gateway.finish(claim_id, "released", cancel_event=stop); check()
        value = {"schema_version": "ecos-owner-selected-page-processing/2.1", "publication_mode": "shadow",
                 "execution_id": identity.request["execution_id"], "binding_id": identity.request["request_id"],
                 "claim_id": claim_id, "measurement": measurement, "selected_pages": selected,
                 "coverage": "selected_pages_only", "pages": retained, "checkpoints": receipts,
                 "control_outcome": released.payload["outcome"], "native_readiness": "not_assessed",
                 "image_available": False, "retrieval_authorized": False, "semantic_verified": False,
                 "currentness": "per_page_sequential_readbacks_not_atomic_project_snapshot"}
        if raster_gateway is not None:
            value.update(schema_version="ecos-owner-selected-page-processing/2.2",raster_receipts=raster_receipts)
        if independent_images:
            value.update(schema_version='ecos-owner-selected-page-processing/2.3',
                         image_basis='independent_original_render_with_unchanged_ocr_checkpoint')
        if len(_encoded({**value, "pages": []})) > 262144:raise ValueError()
        check()
        return OwnerPageProcessingResult(_freeze(value))
    except Exception as error:
        stop.set()
        code = error.code if type(error) is OwnerPageProcessingError else "processing_failed"
        if cancel_event is not None and cancel_event.is_set():code = "cancelled"
        elif time.monotonic() >= deadline:code = "deadline_exceeded"
        cleanup = "not_attempted"
        if claim_attempted:
            cleanup_stop = threading.Event()
            timer = threading.Timer(cleanup_timeout, cleanup_stop.set); timer.daemon = True; timer.start()
            try:
                cleanup_gateway.finish(claim_id, "cancelled" if code == "cancelled" else "failed", cancel_event=cleanup_stop)
                cleanup = "confirmed_same_claim_finished"
            except Exception:
                cleanup = "unconfirmed_requires_same_id_reconciliation"
            finally:
                cleanup_stop.set(); timer.cancel()
        raise OwnerPageProcessingError(code, claim_id=claim_id if claim_attempted else None,
              confirmed_attempt_ids=confirmed, uncertain_attempt_id=uncertain, cleanup=cleanup,
              confirmed_upload_attempt_ids=confirmed_uploads, uncertain_upload_attempt_id=uncertain_upload,
              diagnostic_stage=stage, diagnostic_reason=safe_failure_reason(error)) from None
    finally:
        stop.set(); done.set(); watcher.join(0.1)
