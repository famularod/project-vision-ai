"""Bounded HTTP-to-sealed-spool port, using the existing downloader transport.

No URL/key/options factory or whole-file byte buffer is added. The exact existing
downloader owns transport configuration and the shared old/new in-flight lock.
Private-field coupling is deliberate and covered by parity tests; this does not
change the old byte-returning implementation or grant a new owner authority.

Caller deadlines do not terminate a noncooperative network callback. Its worker
retains cleanup ownership and the downloader lock until response/iterator and
any undelivered spool have closed. A cleanup error poisons that downloader's
lock instead of permitting overlapping uncertain work. There are no retries.
Returned spool pins still describe supplied bytes/seals, not a persisted receipt,
PDF page-count/scan proof, or permission to skip later register/checkpoint SQL.
"""
from __future__ import annotations

import math
import threading
import time

from .owner_execution import MAX_ORIGINAL_BYTES, OwnerExecutionResult
from .owner_execution_gateway import OwnerExecutionGateway, SUPABASE_URL
from .owner_original_download import OwnerOriginalDownloader
from .owner_original_spool import (
    MAX_CHUNK_BYTES, MAX_CHUNKS, OwnerOriginalSpool, OwnerOriginalSpoolError,
    _require_kernel, spool_owner_original,
)


class OwnerOriginalSpoolDownloadError(Exception):
    def __init__(self, code: str, *, cleanup_state: str = "not_confirmed"):
        self.code = code if code in {"invalid_request", "cancelled", "deadline_exceeded", "operation_failed",
            "invalid_response", "source_not_current", "original_bytes_mismatch", "operation_in_flight",
            "unsupported_kernel", "cleanup_failed"} else "operation_failed"
        self.cleanup_state = cleanup_state if cleanup_state in {"not_confirmed", "confirmed", "unconfirmed_downloader_blocked"} else "not_confirmed"
        self.network_operation_stopped = False
        self.partial_bytes_returned = False
        self.partial_spool_returned = False
        self.storage_mutated = False
        self.retrieval_authorized = False
        super().__init__("Original spool download not confirmed")


def download_owner_original_spool(downloader: OwnerOriginalDownloader, gateway: OwnerExecutionGateway,
                                  claim: OwnerExecutionResult, *,
                                  cancel_event: threading.Event | None = None,
                                  caller_cancel_event: threading.Event | None = None) -> OwnerOriginalSpool:
    """Fresh read -> bounded HTTP stream -> genuine sealed spool -> fresh read.

    Current reads use the existing gateway and exact request/managed-copy pins.
    This is a point-in-time download, not a perpetual source grant. The caller
    owns explicit close after successful delivery; no source file path escapes.
    """
    started = time.monotonic()
    try:
        if (type(downloader) is not OwnerOriginalDownloader or type(gateway) is not OwnerExecutionGateway
                or type(claim) is not OwnerExecutionResult
                or any(event is not None and type(event) is not threading.Event
                       for event in (cancel_event, caller_cancel_event))):
            raise ValueError()
        identity = gateway.require_download_identity(claim)
        # Snapshot trusted captured configuration, never return/log credentials.
        timeout = downloader._timeout
        if (type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 30
                or type(downloader._headers) is not dict or not callable(downloader._get)
                or type(downloader._inflight) is not type(threading.Lock())):
            raise ValueError()
        headers = downloader._headers.copy()
        if (headers.keys() != {"Authorization", "apikey", "Accept", "Accept-Encoding"}
                or any(type(value) is not str for value in headers.values())
                or type(headers["apikey"]) is not str or not 1 <= len(headers["apikey"]) <= 16384
                or any(not "!" <= c <= "~" for c in headers["apikey"])
                or headers["Authorization"] != "Bearer " + headers["apikey"]
                or headers["Accept"] != "application/pdf" or headers["Accept-Encoding"] != "identity"):
            raise ValueError()
        get = downloader._get
        inflight = downloader._inflight
    except Exception:
        raise OwnerOriginalSpoolDownloadError("invalid_request") from None
    deadline = started + timeout
    stop = threading.Event()
    transfer = threading.Condition()
    state = {"abandoned": False, "ready": False, "outcome": None, "held": False, "poisoned": False}
    def check():
        if any(event is not None and threading.Event.is_set(event)
               for event in (cancel_event, caller_cancel_event)):
            raise OwnerOriginalSpoolDownloadError("cancelled")
        if stop.is_set() or time.monotonic() >= deadline:
            raise OwnerOriginalSpoolDownloadError("deadline_exceeded")
    check()
    try: _require_kernel()
    except Exception:
        raise OwnerOriginalSpoolDownloadError("unsupported_kernel") from None
    check()
    if not inflight.acquire(blocking=False):
        raise OwnerOriginalSpoolDownloadError("operation_in_flight")
    state["held"] = True
    url = f"{SUPABASE_URL}/storage/v1/object/authenticated/project-documents/{identity.object_key}"

    def poison():
        with transfer: state["poisoned"] = True

    def release():
        with transfer:
            if not state["held"] or state["poisoned"]: return
            state["held"] = False
        inflight.release()

    def close_spool(value):
        if value is None: return True
        try: value.close(); return True
        except BaseException:
            poison(); return False

    def current():
        check()
        try:
            value = gateway.read(cancel_event=stop)
            if (gateway.require_download_identity(claim) is not identity
                    or value.payload["state"] != "running" or not value.binding_matches_request
                    or value.payload["source"] is None):
                raise ValueError()
        except Exception:
            check()
            raise OwnerOriginalSpoolDownloadError("source_not_current") from None
        check()

    def run():
        response = None; iterator = None; original = None; error = None
        iterator_closed = False
        def close_iterator():
            nonlocal iterator_closed
            if iterator is None or iterator_closed: return
            iterator_closed = True  # At most one attempt, including failure.
            try:
                close = getattr(iterator, "close", None)
                if close is not None: close()
            except BaseException:
                poison()
                raise OwnerOriginalSpoolDownloadError("cleanup_failed") from None
        class Chunks:
            def __init__(self): self.count = 0; self.total = 0
            def __iter__(self): return self
            def __next__(self):
                while True:
                    check()
                    part = next(iterator)
                    check()
                    self.count += 1
                    if (self.count > MAX_CHUNKS or type(part) is not bytes or len(part) > MAX_CHUNK_BYTES
                            or len(part) > min(MAX_ORIGINAL_BYTES, identity.expected_byte_length)-self.total):
                        raise OwnerOriginalSpoolDownloadError("original_bytes_mismatch")
                    self.total += len(part)
                    if part: return part  # Bounded empty transport chunks are not file bytes.
            def close(self): close_iterator()
        try:
            current()
            remaining = deadline-time.monotonic()
            check()
            response = get(url, headers=headers.copy(), stream=True, allow_redirects=False,
                           timeout=(min(5.0, remaining), min(5.0, remaining)))
            check()
            # Exact parity with the reviewed byte downloader before any body read.
            if response.status_code != 200 or response.url != url or response.history:
                raise OwnerOriginalSpoolDownloadError("operation_failed")
            if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/pdf":
                raise OwnerOriginalSpoolDownloadError("invalid_response")
            encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
            length = response.headers.get("Content-Length")
            if length is not None:
                if type(length) is not str or not length.isascii() or not length.isdigit() or len(length) > 10:
                    raise OwnerOriginalSpoolDownloadError("invalid_response")
                length = int(length)
                if length > MAX_ORIGINAL_BYTES:
                    raise OwnerOriginalSpoolDownloadError("invalid_response")
                if encoding in ("", "identity") and length != identity.expected_byte_length:
                    raise OwnerOriginalSpoolDownloadError("original_bytes_mismatch")
            check()
            iterator = iter(response.iter_content(chunk_size=MAX_CHUNK_BYTES))
            original = spool_owner_original(gateway, claim, Chunks(), cancel_event=stop,
                                            timeout_seconds=min(30, max(.001, deadline-time.monotonic())))
            check()
            current()  # Source/authority drift during download rejects the entire handle.
        except BaseException as caught:
            code = caught.code if type(caught) is OwnerOriginalSpoolDownloadError else "operation_failed"
            if type(caught) is OwnerOriginalSpoolError:
                code = {"bytes_mismatch": "original_bytes_mismatch", "invalid_chunk": "original_bytes_mismatch",
                        "stream_limit": "original_bytes_mismatch", "source_not_current": "source_not_current",
                        "cancelled": "cancelled", "deadline_exceeded": "deadline_exceeded",
                        "cleanup_failed": "cleanup_failed"}.get(caught.code, "operation_failed")
                if caught.code == "cleanup_failed": poison()
            try: check()
            except OwnerOriginalSpoolDownloadError as stopped: code = stopped.code
            error = OwnerOriginalSpoolDownloadError(code)
        finally:
            try: close_iterator()
            except BaseException: error = OwnerOriginalSpoolDownloadError("cleanup_failed")
            if response is not None:
                try: response.close()
                except BaseException:
                    poison(); error = OwnerOriginalSpoolDownloadError("cleanup_failed")
        # Never call a potentially blocking closer while holding the handoff lock.
        try: check()
        except OwnerOriginalSpoolDownloadError as stopped: error = stopped
        if error is not None:
            close_spool(original); original = None
        with transfer:
            abandoned = state["abandoned"]
            if not abandoned:
                if error is not None:
                    error = OwnerOriginalSpoolDownloadError(error.code, cleanup_state=
                        "unconfirmed_downloader_blocked" if state["poisoned"] else "confirmed")
                state["outcome"] = error if error is not None else original
                original = None
                state["ready"] = True
                transfer.notify_all()
        if abandoned:
            close_spool(original)
            release()
        elif error is not None:
            release()
        # Successful queued spool retains the old/new shared lock until delivered
        # or explicitly discarded by the caller's finally block.

    try:
        worker = threading.Thread(target=run, name="ecos-owner-spool-download", daemon=True)
        worker.start()
    except Exception:
        release()
        raise OwnerOriginalSpoolDownloadError("operation_failed") from None
    owned = None; delivered = False
    try:
        while True:
            check()
            with transfer:
                if state["ready"]:
                    owned = state["outcome"]
                    state["outcome"] = None
                    break
                transfer.wait(min(.01, max(.001, deadline-time.monotonic())))
        check()  # Deliberately after queue ownership transfer: late success is discarded.
        if type(owned) is OwnerOriginalSpoolDownloadError: raise owned
        if type(owned) is not OwnerOriginalSpool: raise OwnerOriginalSpoolDownloadError("operation_failed")
        try:
            if gateway.require_download_identity(claim) is not identity: raise ValueError()
        except Exception:
            raise OwnerOriginalSpoolDownloadError("source_not_current") from None
        check()
        delivered = True
        release()
        return owned
    finally:
        stop.set()
        with transfer:
            state["abandoned"] = True
            waiting = state["outcome"]
            state["outcome"] = None
            ready = state["ready"]
        if not delivered:
            close_spool(owned if type(owned) is OwnerOriginalSpool else None)
            close_spool(waiting if type(waiting) is OwnerOriginalSpool else None)
            if ready: release()
