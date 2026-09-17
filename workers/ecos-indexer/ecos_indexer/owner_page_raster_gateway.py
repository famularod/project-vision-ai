"""Explicit owner-worker PNG copy/readback and immutable raster receipt seam.

The worker's optional raster path calls this port, never a customer request.
Construction is not authorization: genuine execution and exact checkpoint reads happen before
and after bytes, and SQL rechecks again. No legacy job, delete, upsert, automatic
retry, or fallback from upload failure. Reconciliation uses explicit SAME IDs.
60 seconds bounds caller waiting, not external network/decode termination. A
noncooperative thread retains the instance lock until its actual cleanup ends.
The caller's original-reader batch still owns its combined retained-byte limit;
this adapter retains one PNG at a time and returns no duplicate raster bytes.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import json
import math
import queue
import threading
import time
from typing import Any, Callable, Mapping

import requests
from PIL import Image

from .owner_execution import OwnerExecutionIdentity, _freeze, _thaw, _timestamp, decode_json, exact_object, integer, uuid, SHA
from .owner_execution_gateway import OwnerExecutionGateway, SUPABASE_URL
from .owner_page_checkpoint_gateway import OwnerPageCheckpointGateway

MAX_PNG_BYTES = 32 * 1024 * 1024
MAX_RPC_BYTES = 64 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
COMMIT = "ecos_commit_owner_page_raster"
READ = "ecos_read_owner_page_raster"
COORDINATES = "rotated_display_cropbox_pixels_top_left"
RESULT_KEYS = frozenset("schema_version publication_mode outcome upload_attempt_id current_upload_attempt_id receipt_json receipt_sha256 availability retrieval_authorized semantic_verified".split())
READ_KEYS = frozenset("schema_version publication_mode owner_id organization_id project_id execution_id binding_id page_number expected_page_attempt_id expected_page_sha256 expected_upload_attempt_id state current_upload_attempt_id receipt_json receipt_sha256 availability retrieval_authorized semantic_verified".split())
RECEIPT_KEYS = frozenset("schema_version publication_mode attestation_json attestation_sha256 version previous_upload_attempt_id committed_at verification retrieval_authorized semantic_verified".split())


class OwnerPageRasterError(Exception):
    def __init__(self, code="operation_failed", *, may_have_stored=False, may_have_committed=False):
        self.code = code if code in {"invalid_request", "invalid_response", "source_not_current", "operation_failed", "cancelled", "deadline_exceeded", "operation_in_flight"} else "operation_failed"
        self.may_have_stored = may_have_stored
        self.may_have_committed = may_have_committed
        self.external_operation_stopped = False
        self.recovery = "explicit_reconcile_same_upload_page_and_predecessor_ids"
        super().__init__("Owner page raster not confirmed")


@dataclass(frozen=True, eq=False)
class OwnerPageRasterResult:
    attestation: Mapping[str, Any]
    receipt: Mapping[str, Any]
    readback: Mapping[str, Any]
    verification: str = "exact_png_readback_and_matching_current_receipt_read"
    currentness: str = "at_final_receipt_read_only_not_atomic"
    retrieval_authorized: bool = False
    semantic_verified: bool = False

    def to_dict(self):
        return {"attestation": _thaw(self.attestation), "receipt": _thaw(self.receipt),
                "readback": _thaw(self.readback), "verification": self.verification, "currentness": self.currentness,
                "retrieval_authorized": False, "semantic_verified": False}


def _sha(value):
    if type(value) is not str or not SHA.fullmatch(value):raise ValueError()
    return value


def _upload_id(value):
    uuid(value)
    if value[14] != "4":raise ValueError()
    return value


def _same(left, right):
    # Python bool/int equality must not normalize a malformed receipt scalar.
    if type(left) is not type(right):raise ValueError()
    if type(left) is dict:
        if left.keys() != right.keys():raise ValueError()
        for key in left:_same(left[key], right[key])
    elif type(left) is list:
        if len(left) != len(right):raise ValueError()
        for a, b in zip(left, right):_same(a, b)
    elif left != right:raise ValueError()


def _json_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:raise ValueError()
        result[key] = value
    return result


def _png_measurement(data: bytes) -> tuple[int, int]:
    """Independent full PNG decode, not merely a supplied header or MIME claim."""
    if type(data) is not bytes or not 33 <= len(data) <= MAX_PNG_BYTES or not data.startswith(PNG_SIGNATURE):raise ValueError()
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "PNG" or image.is_animated or getattr(image, "n_frames", 1) != 1:raise ValueError()
        width, height = image.size
        integer(width, 1, 8000);integer(height, 1, 8000)
        if width * height > 24000000:raise ValueError()
        image.verify()
    with Image.open(io.BytesIO(data)) as decoded:
        if decoded.format != "PNG" or decoded.size != (width, height):raise ValueError()
        decoded.load()
    return width, height


class OwnerPageRasterGateway:
    def __init__(self, gateway: OwnerExecutionGateway, checkpoints: OwnerPageCheckpointGateway, *,
                 service_role_key: str, request: Callable[..., Any] | None = None, timeout_seconds: float = 60):
        try:
            if type(gateway) is not OwnerExecutionGateway or type(checkpoints) is not OwnerPageCheckpointGateway:raise ValueError()
            gateway.identity.validate();checkpoints.identity.validate()
            _same(dict(gateway.identity.request), dict(checkpoints.identity.request))
            if gateway.identity.expected_byte_length != checkpoints.identity.expected_byte_length:raise ValueError()
            self._identity = OwnerExecutionIdentity.from_service_request(dict(gateway.identity.request), expected_byte_length=gateway.identity.expected_byte_length)
            if (type(service_role_key) is not str or not 1 <= len(service_role_key) <= 16384 or any(not "!" <= c <= "~" for c in service_role_key)
                    or type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 60
                    or request is not None and not callable(request)):raise ValueError()
        except Exception:raise OwnerPageRasterError("invalid_request") from None
        self._gateway, self._checkpoints = gateway, checkpoints
        self._timeout = float(timeout_seconds)
        self._headers = {"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key, "Accept-Encoding": "identity"}
        self._session = None
        if request is None:
            session = requests.Session();session.trust_env = False
            session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
            self._session, self._request = session, session.request
        else:self._request = request
        self._inflight = threading.Lock()

    def require_scope(self, gateway: OwnerExecutionGateway, checkpoints: OwnerPageCheckpointGateway) -> None:
        """Worker composition check only; current SQL reads still occur later."""
        try:
            if gateway is not self._gateway or checkpoints is not self._checkpoints:raise ValueError()
            _same(dict(gateway.identity.request),dict(self._identity.request))
            _same(dict(checkpoints.identity.request),dict(self._identity.request))
            if (gateway.identity.expected_byte_length != self._identity.expected_byte_length
                    or checkpoints.identity.expected_byte_length != self._identity.expected_byte_length):raise ValueError()
        except Exception:raise OwnerPageRasterError("invalid_request") from None

    def persist(self, png: bytes, *, page_number: int, expected_page_attempt_id: str,
                expected_page_sha256: str, upload_attempt_id: str,
                expected_previous_upload_attempt_id: str | None, mode: str,
                image_payload_json: str | None = None,
                cancel_event: threading.Event | None = None,
                caller_cancel_event: threading.Event | None = None) -> OwnerPageRasterResult:
        try:
            r = dict(self._identity.request)
            integer(page_number, 1, r["source_page_count"]);uuid(expected_page_attempt_id);_sha(expected_page_sha256);_upload_id(upload_attempt_id)
            if expected_previous_upload_attempt_id is not None:
                _upload_id(expected_previous_upload_attempt_id)
                if expected_previous_upload_attempt_id == upload_attempt_id:raise ValueError()
            if (type(png) is not bytes or not 33 <= len(png) <= MAX_PNG_BYTES or not png.startswith(PNG_SIGNATURE)
                    or type(mode) is not str or mode not in {"upload", "reconcile"}
                    or cancel_event is not None and type(cancel_event) is not threading.Event
                    or caller_cancel_event is not None and type(caller_cancel_event) is not threading.Event):raise ValueError()
            image = None
            if image_payload_json is not None:
                from .original_page_image import decode_original_page_image
                image = decode_original_page_image(image_payload_json, source_sha256=r['source_sha256'],
                    source_page_count=r['source_page_count'], page_number=page_number)
        except Exception:raise OwnerPageRasterError("invalid_request") from None
        if ((cancel_event is not None and cancel_event.is_set())
                or (caller_cancel_event is not None and caller_cancel_event.is_set())):raise OwnerPageRasterError("cancelled")
        if not self._inflight.acquire(blocking=False):raise OwnerPageRasterError("operation_in_flight")
        deadline = time.monotonic() + self._timeout
        stop, uploaded, committed = threading.Event(), threading.Event(), threading.Event()
        active_call_deadline = [None]
        results = queue.Queue(maxsize=1)
        object_key = f"v2-rasters/{r['owner_id']}/{r['execution_id']}/{r['request_id']}/{expected_page_attempt_id}/{upload_attempt_id}.png"
        storage_url = f"{SUPABASE_URL}/storage/v1/object/project-documents/{object_key}"
        def error(code):return OwnerPageRasterError(code, may_have_stored=uploaded.is_set(), may_have_committed=committed.is_set())
        def check():
            # Do not wait for a processing watcher to copy the original caller
            # event. This blocks new dispatch, not an upload already in flight.
            if ((cancel_event is not None and cancel_event.is_set())
                    or (caller_cancel_event is not None and caller_cancel_event.is_set())):raise error("cancelled")
            now = time.monotonic()
            if stop.is_set() or now >= deadline or (active_call_deadline[0] is not None and now >= active_call_deadline[0]):raise error("deadline_exceeded")
        def current():
            check()
            # The concrete gateways execute and bind these reads themselves;
            # no caller-constructed result is accepted as a trusted read.
            _same(dict(self._gateway.identity.request), r);_same(dict(self._checkpoints.identity.request), r)
            execution = self._gateway.read(cancel_event=stop);check()
            if (not execution.binding_matches_request or execution.payload["outcome"] != "read" or execution.payload["source"] is None
                    or execution.payload["state"] not in {"running", "released", "failed", "expired"}):raise error("source_not_current")
            page = self._checkpoints.read(page_number=page_number, expected_attempt_id=expected_page_attempt_id, cancel_event=stop);check()
            if page.receipt["head"]["page_sha256"] != expected_page_sha256 or page.page is None:raise error("source_not_current")
            slot = page.page["modalities"]["visual"]
            if image is not None:
                # /2.2 binds an independently rendered original to this exact
                # current raw checkpoint. Its OCR state and payload are unchanged.
                return {"visual_payload_sha256": page.receipt["head"]["modalities"]["visual"]["payload_sha256"],
                        **{k: image[k] for k in ('raster_sha256', 'raster_byte_count', 'raster_width', 'raster_height')},
                        'raster_coordinate_system': COORDINATES, 'image_payload_json': image_payload_json,
                        'image_payload_sha256': hashlib.sha256(image_payload_json.encode('utf-8')).hexdigest()}
            if slot["state"] not in {"partial", "unreadable"} or type(slot["payload_json"]) is not str:raise error("source_not_current")
            # SQL/checkpoint port already pins raw payload bytes/hash. Here only
            # the source/raster tuple is consumed, not OCR confidence or text.
            visual = json.loads(slot["payload_json"], object_pairs_hook=_json_pairs,
                                parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if type(visual) is not dict or visual.get("schema_version") != "ecos-page-visual-observations/2.1" or visual.get("state") != slot["state"]:raise ValueError()
            if visual.get("retrieval_authorized") is not False or visual.get("semantic_verified") is not False:raise ValueError()
            source, raster = visual.get("source"), visual.get("raster")
            if type(source) is not dict or type(raster) is not dict:raise ValueError()
            for k, expected in (("source_sha256", r["source_sha256"]), ("source_page_count", r["source_page_count"]), ("page_number", page_number)):_same(source.get(k), expected)
            if raster.get("coordinate_system") != COORDINATES or raster.get("hash_scope") != "exact_png_bytes" or raster.get("decode_verified_by_parser") is not False:raise ValueError()
            digest = _sha(raster.get("sha256"));size = integer(raster.get("byte_count"), 33, MAX_PNG_BYTES)
            width = integer(raster.get("width"), 1, 8000);height = integer(raster.get("height"), 1, 8000)
            if width * height > 24000000:raise ValueError()
            return {"visual_payload_sha256":page.receipt["head"]["modalities"]["visual"]["payload_sha256"], "raster_sha256":digest,
                    "raster_byte_count":size,"raster_width":width,"raster_height":height,"raster_coordinate_system":COORDINATES}
        def http(method, url, *, data=None, media="application/json", cap=MAX_RPC_BYTES, statuses=(200,)):
            check();response = None;call_end = min(deadline, time.monotonic()+25)
            active_call_deadline[0] = call_end
            def call_check():
                check()
                if time.monotonic() >= call_end:raise error("deadline_exceeded")
            try:
                headers = {**self._headers,"Accept":media}
                if method == "POST":headers.update({"Content-Type": "image/png" if url == storage_url else "application/json"})
                if url == storage_url and method == "POST":headers["x-upsert"] = "false";uploaded.set()
                if url.endswith("/"+COMMIT):committed.set()
                remaining = max(0.001, call_end-time.monotonic())
                response = self._request(method, url, headers=headers, data=data, allow_redirects=False, stream=True, timeout=(min(5.,remaining),min(5.,remaining)))
                call_check()
                if response.url != url or response.history or response.status_code not in statuses:raise error("operation_failed")
                if response.headers.get("Content-Type", "").split(";",1)[0].strip().lower() != media:raise error("invalid_response")
                length = response.headers.get("Content-Length");encoded = response.headers.get("Content-Encoding","identity").strip().lower()
                if length is not None:
                    if type(length) is not str or not length.isascii() or not length.isdigit() or len(length)>10 or int(length)>cap:raise error("invalid_response")
                    length = int(length)
                output = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    call_check()
                    if type(chunk) is not bytes or len(output)+len(chunk)>cap:raise error("invalid_response")
                    output.extend(chunk)
                call_check()
                if encoded in {"", "identity"} and length is not None and length != len(output):raise error("invalid_response")
                return bytes(output)
            finally:
                if response is not None:
                    try:response.close()
                    except Exception:pass
                active_call_deadline[0] = None
        def receipt(raw, raw_sha, attestation):
            _sha(raw_sha)
            if type(raw) is not str or len(raw.encode("utf-8"))>20000 or hashlib.sha256(raw.encode("utf-8")).hexdigest()!=raw_sha:raise ValueError()
            body = exact_object(decode_json(raw.encode("utf-8"),20000),RECEIPT_KEYS)
            if (body["schema_version"]!="ecos-owner-page-raster-receipt/2.1" or body["publication_mode"]!="shadow" or body["verification"]!="trusted_service_attested_png_readback"
                    or body["retrieval_authorized"] is not False or body["semantic_verified"] is not False):raise ValueError()
            a = body["attestation_json"];_sha(body["attestation_sha256"])
            if type(a) is not str or len(a.encode("utf-8"))>16384 or hashlib.sha256(a.encode("utf-8")).hexdigest()!=body["attestation_sha256"]:raise ValueError()
            _same(decode_json(a.encode("utf-8"),16384),attestation)
            integer(body["version"],1,32);_timestamp(body["committed_at"])
            _same(body["previous_upload_attempt_id"],expected_previous_upload_attempt_id)
            if (body["version"]==1)!=(expected_previous_upload_attempt_id is None):raise ValueError()
            return body
        def run():
            try:
                check();pins = current();check()
                digest = hashlib.sha256(png).hexdigest();dimensions = _png_measurement(png);check()
                if (digest != pins["raster_sha256"] or len(png) != pins["raster_byte_count"] or dimensions != (pins["raster_width"],pins["raster_height"])):raise error("invalid_request")
                if mode == "upload":
                    ack = decode_json(http("POST",storage_url,data=png,media="application/json",statuses=(200,201)))
                    if type(ack) is not dict or ack.get("Key")!="project-documents/"+object_key or set(ack)-{"Key","Id"}:raise error("invalid_response")
                downloaded = http("GET",storage_url,media="image/png",cap=MAX_PNG_BYTES);check()
                if len(downloaded)!=len(png) or hashlib.sha256(downloaded).hexdigest()!=digest or _png_measurement(downloaded)!=dimensions:raise error("invalid_response")
                del downloaded
                check();_same(current(),pins);check()
                a = {"schema_version":"ecos-owner-page-raster-attestation/2.1","publication_mode":"shadow","owner_id":r["owner_id"],"organization_id":r["owner_id"],
                     "project_id":r["project_id"],"execution_id":r["execution_id"],"binding_id":r["request_id"],"source_id":r["source_id"],"source_sha256":r["source_sha256"],
                     "source_revision":r["source_revision"],"source_page_count":r["source_page_count"],"extraction_version":r["extraction_version"],"page_number":page_number,
                     "page_attempt_id":expected_page_attempt_id,"page_sha256":expected_page_sha256,**pins,"upload_attempt_id":upload_attempt_id,
                     "expected_previous_upload_attempt_id":expected_previous_upload_attempt_id,"storage_project_ref":"xdytqlpsqsseoeuxgzre","bucket":"project-documents","object_key":object_key,
                     "verification":"exact_png_sha256_and_independent_decode","retrieval_authorized":False,"semantic_verified":False}
                if image is not None:a['schema_version'] = 'ecos-owner-page-raster-attestation/2.2'
                encoded = json.dumps({"p_attestation":a},ensure_ascii=False,allow_nan=False).encode("utf-8")
                if len(encoded)>16384:raise error("invalid_request")
                committed_raw = exact_object(decode_json(http("POST",f"{SUPABASE_URL}/rest/v1/rpc/{COMMIT}",data=encoded)),RESULT_KEYS)
                if (committed_raw["schema_version"]!="ecos-owner-page-raster-result/2.1" or committed_raw["publication_mode"]!="shadow" or committed_raw["outcome"] not in {"committed","already_committed"}
                        or committed_raw["upload_attempt_id"]!=upload_attempt_id or committed_raw["current_upload_attempt_id"]!=upload_attempt_id or committed_raw["availability"]!="not_checked"
                        or committed_raw["retrieval_authorized"] is not False or committed_raw["semantic_verified"] is not False):raise ValueError()
                body = receipt(committed_raw["receipt_json"],committed_raw["receipt_sha256"],a);check()
                parameters = {"p_owner_id":r["owner_id"],"p_project_id":r["project_id"],"p_execution_id":r["execution_id"],"p_binding_id":r["request_id"],"p_page_number":page_number,
                              "p_expected_page_attempt_id":expected_page_attempt_id,"p_expected_page_sha256":expected_page_sha256,"p_expected_upload_attempt_id":upload_attempt_id}
                got = exact_object(decode_json(http("POST",f"{SUPABASE_URL}/rest/v1/rpc/{READ}",data=json.dumps(parameters).encode("utf-8"))),READ_KEYS)
                if (got["schema_version"]!="ecos-owner-page-raster-read/2.1" or got["publication_mode"]!="shadow" or got["organization_id"]!=r["owner_id"] or got["state"]!="current"
                        or got["current_upload_attempt_id"]!=upload_attempt_id or got["availability"]!="private_locator_requires_verified_download"
                        or got["retrieval_authorized"] is not False or got["semantic_verified"] is not False):raise ValueError()
                for k,v in parameters.items():_same(got[k[2:]],v)
                _same(receipt(got["receipt_json"],got["receipt_sha256"],a),body)
                _same(got["receipt_json"],committed_raw["receipt_json"]);_same(got["receipt_sha256"],committed_raw["receipt_sha256"])
                check();outcome = (True,OwnerPageRasterResult(_freeze(a),_freeze(body),_freeze(got)))
            except Exception as e:outcome=(False,error(e.code if type(e) is OwnerPageRasterError else "invalid_response"))
            finally:
                self._inflight.release();results.put_nowait(outcome)
        thread = threading.Thread(target=run,name="ecos-owner-page-raster",daemon=True)
        try:thread.start()
        except Exception:
            self._inflight.release();raise error("operation_failed") from None
        try:
            while True:
                check()
                try:ok,result=results.get(timeout=min(0.01,max(0.001,deadline-time.monotonic())))
                except queue.Empty:continue
                check()
                if not ok:raise result from None
                return result
        finally:stop.set()
