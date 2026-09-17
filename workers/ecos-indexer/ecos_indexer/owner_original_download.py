"""Download one exact private managed original for a live owner-preview claim.

No environment/URL/locator input, upload, metadata mutation, enrollment or legacy
HostedJob conversion exists here. A genuine claim and action-time SQL read are
required. Returned immutable bytes match the whole expected SHA and exact length;
PDF validity/page count MUST be measured by the separate original reader.

The caller deadline bounds waiting, not guaranteed termination of requests or an
injected callback. One in-flight operation per downloader is retained until late
cleanup finishes. No retries or partial bytes are returned. The processor still
must perform the existing SQL currentness check before register/checkpoint.
"""
from __future__ import annotations

import hashlib
import queue
import threading
import time
from typing import Any, Callable

import requests

from .owner_execution import OwnerExecutionResult
from .owner_original_limits import MAX_BUFFERED_ORIGINAL_BYTES as MAX_ORIGINAL_BYTES
from .owner_execution_gateway import OwnerExecutionGateway, SUPABASE_URL


class OwnerOriginalDownloadError(Exception):
    def __init__(self, code: str = "operation_failed"):
        self.code = code if code in {"invalid_request", "cancelled", "deadline_exceeded", "operation_failed",
                                    "invalid_response", "source_not_current", "original_bytes_mismatch", "operation_in_flight"} else "operation_failed"
        self.network_operation_stopped = False
        self.partial_bytes_returned = False
        self.storage_mutated = False
        self.recovery = "retry_only_after_current_source_recheck"
        super().__init__("Owner original download not confirmed")


class OwnerOriginalDownloader:
    def __init__(self, *, service_role_key: str, get: Callable[..., Any] | None = None,
                 timeout_seconds: float = 30.0):
        if (type(service_role_key) is not str or not 1 <= len(service_role_key) <= 16384
                or any(not "!" <= c <= "~" for c in service_role_key)
                or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 30
                or (get is not None and not callable(get))):
            raise OwnerOriginalDownloadError("invalid_request")
        self._timeout = float(timeout_seconds)
        self._headers = {"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key,
                         "Accept": "application/pdf", "Accept-Encoding": "identity"}
        self._session = None
        if get is None:
            session = requests.Session()
            session.trust_env = False
            session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
            self._session, self._get = session, session.get
        else:
            self._get = get
        self._inflight = threading.Lock()

    def download(self, gateway: OwnerExecutionGateway, claim: OwnerExecutionResult, *,
                 cancel_event: threading.Event | None = None) -> bytes:
        try:
            if type(gateway) is not OwnerExecutionGateway or (cancel_event is not None and type(cancel_event) is not threading.Event):
                raise ValueError()
            identity = gateway.require_download_identity(claim)
        except Exception:
            raise OwnerOriginalDownloadError("invalid_request") from None
        if cancel_event is not None and cancel_event.is_set():
            raise OwnerOriginalDownloadError("cancelled")
        if not self._inflight.acquire(blocking=False):
            raise OwnerOriginalDownloadError("operation_in_flight")
        deadline = time.monotonic() + self._timeout
        stop = threading.Event()
        result_queue: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
        url = f"{SUPABASE_URL}/storage/v1/object/authenticated/project-documents/{identity.object_key}"

        def check() -> None:
            if cancel_event is not None and cancel_event.is_set():
                raise OwnerOriginalDownloadError("cancelled")
            if stop.is_set() or time.monotonic() >= deadline:
                raise OwnerOriginalDownloadError("deadline_exceeded")

        def run() -> None:
            response = None
            outcome: tuple[bool, Any]
            try:
                check()
                # A cached read receipt alone never permits a storage operation.
                # This read checks source/authority/binding at dispatch time;
                # the supplied claim must still be our live claim generation.
                try:
                    current = gateway.read(cancel_event=stop)
                    gateway.require_download_identity(claim)
                except Exception:
                    check()
                    raise OwnerOriginalDownloadError("source_not_current") from None
                check()
                if (current.payload["state"] != "running" or not current.binding_matches_request
                        or current.payload["source"] is None):
                    raise OwnerOriginalDownloadError("source_not_current")
                remaining = max(0.001, deadline - time.monotonic())
                response = self._get(url, headers=dict(self._headers), stream=True, allow_redirects=False,
                                     timeout=(min(5.0, remaining), min(5.0, remaining)))
                check()
                if response.status_code != 200 or response.url != url or response.history:
                    raise OwnerOriginalDownloadError("operation_failed")
                media = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if media != "application/pdf":
                    raise OwnerOriginalDownloadError("invalid_response")
                encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
                length_header = response.headers.get("Content-Length")
                if length_header is not None:
                    if type(length_header) is not str or not length_header.isascii() or not length_header.isdigit() or len(length_header) > 10:
                        raise OwnerOriginalDownloadError("invalid_response")
                    length = int(length_header)
                    if length > MAX_ORIGINAL_BYTES:
                        raise OwnerOriginalDownloadError("invalid_response")
                    if encoding in ("", "identity") and length != identity.expected_byte_length:
                        raise OwnerOriginalDownloadError("original_bytes_mismatch")
                data = bytearray()
                digest = hashlib.sha256()
                for chunk in response.iter_content(chunk_size=65536):
                    check()
                    if type(chunk) is not bytes or len(data) + len(chunk) > min(MAX_ORIGINAL_BYTES, identity.expected_byte_length):
                        raise OwnerOriginalDownloadError("original_bytes_mismatch")
                    digest.update(chunk)
                    data.extend(chunk)
                check()
                if len(data) != identity.expected_byte_length or digest.hexdigest() != identity.request["source_sha256"]:
                    raise OwnerOriginalDownloadError("original_bytes_mismatch")
                try:
                    gateway.require_download_identity(claim)
                except Exception:
                    raise OwnerOriginalDownloadError("source_not_current") from None
                result = bytes(data)
                check()
                outcome = (True, result)
            except Exception as error:
                code = error.code if type(error) is OwnerOriginalDownloadError else "operation_failed"
                outcome = (False, OwnerOriginalDownloadError(code))
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
                self._inflight.release()
                result_queue.put_nowait(outcome)

        thread = threading.Thread(target=run, name="ecos-owner-download", daemon=True)
        try:
            thread.start()
        except Exception:
            self._inflight.release()
            raise OwnerOriginalDownloadError("operation_failed") from None
        try:
            while True:
                check()
                try:
                    success, result = result_queue.get(timeout=min(0.01, max(0.001, deadline - time.monotonic())))
                except queue.Empty:
                    continue
                check()
                if not success:
                    raise result
                return result
        finally:
            stop.set()
