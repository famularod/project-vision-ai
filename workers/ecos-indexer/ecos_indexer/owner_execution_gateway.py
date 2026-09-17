"""Separate, server-only owner execution control port; no legacy worker calls.

Credentials and a trusted dispatch expectation are explicit constructor inputs.
The five methods do not bind/enroll sources, download originals, or publish
evidence. Requests timeouts bound socket inactivity, while a monotonic caller
deadline bounds waiting. A noncooperative background operation may still commit:
same-instance overlap is prohibited until it settles, late bodies are closed,
and callers must reconcile the SAME binding/claim IDs. No automatic retries.
"""
from __future__ import annotations

import json
import queue
import threading
import time
import weakref
from typing import Any, Callable

import requests

from .owner_execution import (
    MAX_RESPONSE_BYTES, OwnerExecutionError, OwnerExecutionIdentity,
    OwnerExecutionResult, ServiceAttestedMeasurement, bind_owner_execution_result,
    decode_json, uuid,
)
from .owner_service_limits import OWNER_CLAIM_LIFETIME_SECONDS

SUPABASE_URL = "https://xdytqlpsqsseoeuxgzre.supabase.co"
RPC_NAMES = {action: f"ecos_v3_{action}_owner_source_execution" for action in ("read", "claim", "register", "finish", "cancel")}


class OwnerExecutionGateway:
    def __init__(self, identity: OwnerExecutionIdentity, *, service_role_key: str,
                 post: Callable[..., Any] | None = None, timeout_seconds: float = 10.0):
        try:
            if type(identity) is not OwnerExecutionIdentity:
                raise ValueError()
            identity.validate()
            self._identity = OwnerExecutionIdentity.from_service_request(dict(identity.request), expected_byte_length=identity.expected_byte_length)
            if (type(service_role_key) is not str or not 1 <= len(service_role_key) <= 16384
                    or any(not "!" <= c <= "~" for c in service_role_key)
                    or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 25
                    or (post is not None and not callable(post))):
                raise ValueError()
        except Exception:
            raise OwnerExecutionError("invalid_request", may_have_committed=False) from None
        self._timeout = float(timeout_seconds)
        self._headers = {"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key,
                         "Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity"}
        self._session = None
        if post is None:
            # Never inherit environment proxies or an arbitrary project URL.
            session = requests.Session()
            session.trust_env = False
            session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
            self._session = session
            self._post = session.post
        else:
            self._post = post
        self._inflight = threading.Lock()
        self._claims: weakref.WeakKeyDictionary[OwnerExecutionResult, tuple[str, float]] = weakref.WeakKeyDictionary()

    @property
    def identity(self) -> OwnerExecutionIdentity:
        return self._identity

    def read(self, *, cancel_event: threading.Event | None = None) -> OwnerExecutionResult:
        return self._send("read", None, {}, cancel_event)

    def claim(self, claim_id: str, *, cancel_event: threading.Event | None = None) -> OwnerExecutionResult:
        return self._send("claim", claim_id, {}, cancel_event)

    def register(self, claim: OwnerExecutionResult, measurement: ServiceAttestedMeasurement,
                 *, cancel_event: threading.Event | None = None) -> OwnerExecutionResult:
        try:
            if type(claim) is not OwnerExecutionResult:
                raise ValueError()
            record = self._claims.get(claim)
            if (record is None or time.monotonic() >= record[1] or type(measurement) is not ServiceAttestedMeasurement):
                raise ValueError()
            values = measurement.to_wire(self.identity)
        except Exception:
            raise OwnerExecutionError("invalid_request", may_have_committed=False) from None
        return self._send("register", record[0], {"p_measurement": values}, cancel_event, claim_deadline=record[1])

    def require_download_identity(self, claim: OwnerExecutionResult) -> OwnerExecutionIdentity:
        """Recognize our still-live claim, not a durable authorization grant.

        The downloader must additionally re-read this gateway's current source
        at action time. SQL register/checkpoint must recheck after processing.
        """
        try:
            if type(claim) is not OwnerExecutionResult:
                raise ValueError()
            record = self._claims.get(claim)
            if (record is None or time.monotonic() >= record[1]
                    or claim.payload["state"] != "running" or claim.payload["source"] is None
                    or not claim.binding_matches_request):
                raise ValueError()
            self.identity.validate()
            return self.identity
        except Exception:
            raise OwnerExecutionError("invalid_request", may_have_committed=False) from None

    def finish(self, claim_id: str, status: str, *, cancel_event: threading.Event | None = None) -> OwnerExecutionResult:
        if type(status) is not str or status not in {"released", "failed", "cancelled"}:
            raise OwnerExecutionError("invalid_request", may_have_committed=False)
        return self._send("finish", claim_id, {"p_status": status}, cancel_event)

    def cancel(self, *, cancel_event: threading.Event | None = None) -> OwnerExecutionResult:
        return self._send("cancel", None, {}, cancel_event)

    def _send(self, action: str, claim_id: str | None, extra: dict[str, Any],
              cancel_event: threading.Event | None, *, claim_deadline: float | None = None) -> OwnerExecutionResult:
        try:
            self.identity.validate()
            if action not in RPC_NAMES or (cancel_event is not None and type(cancel_event) is not threading.Event):
                raise ValueError()
            if claim_id is not None:
                uuid(claim_id)
        except Exception:
            raise OwnerExecutionError("invalid_request", may_have_committed=False) from None
        if cancel_event is not None and cancel_event.is_set():
            raise OwnerExecutionError("cancelled", may_have_committed=False)
        if not self._inflight.acquire(blocking=False):
            raise OwnerExecutionError("operation_in_flight", may_have_committed=False)
        started = time.monotonic()
        deadline = min(started + self._timeout, claim_deadline or float("inf"))
        stop = threading.Event()
        dispatched = threading.Event()
        result_queue: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)
        r = self.identity.request
        parameters = {"p_owner_id": r["owner_id"], "p_project_id": r["project_id"], "p_execution_id": r["execution_id"]}
        if action != "read":
            parameters["p_binding_id"] = r["request_id"]
        if claim_id is not None:
            parameters["p_claim_id"] = claim_id
        parameters.update(extra)
        payload = json.dumps(parameters, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        url = f"{SUPABASE_URL}/rest/v1/rpc/{RPC_NAMES[action]}"

        def check() -> None:
            if cancel_event is not None and cancel_event.is_set():
                raise OwnerExecutionError("cancelled", may_have_committed=dispatched.is_set())
            if stop.is_set() or time.monotonic() >= deadline:
                raise OwnerExecutionError("deadline_exceeded", may_have_committed=dispatched.is_set())

        def run() -> None:
            response = None
            outcome: tuple[bool, Any]
            try:
                check()
                if len(payload) > 16384:
                    raise OwnerExecutionError("invalid_request", may_have_committed=False)
                remaining = max(0.001, deadline - time.monotonic())
                dispatched.set()
                response = self._post(url, headers=dict(self._headers), data=payload, stream=True,
                                      allow_redirects=False, timeout=(min(5.0, remaining), min(5.0, remaining)))
                check()
                if response.status_code != 200 or response.url != url or response.history:
                    raise OwnerExecutionError("operation_failed")
                media = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if media != "application/json":
                    raise OwnerExecutionError("invalid_response")
                # requests exposes decoded bytes. A gzip Content-Length describes
                # encoded bytes, so never require it to equal the decoded length.
                encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
                length_header = response.headers.get("Content-Length")
                length = None
                if length_header is not None:
                    if type(length_header) is not str or not length_header.isascii() or not length_header.isdigit() or len(length_header) > 10:
                        raise OwnerExecutionError("invalid_response")
                    length = int(length_header)
                    if length > MAX_RESPONSE_BYTES:
                        raise OwnerExecutionError("invalid_response")
                data = bytearray()
                for chunk in response.iter_content(chunk_size=4096):
                    check()
                    if type(chunk) is not bytes or len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise OwnerExecutionError("invalid_response")
                    data.extend(chunk)
                check()
                if encoding in ("", "identity") and length is not None and length != len(data):
                    raise OwnerExecutionError("invalid_response")
                result = bind_owner_execution_result(decode_json(bytes(data)), self.identity, action, claim_id)
                check()
                outcome = (True, result)
            except Exception as error:
                code = error.code if type(error) is OwnerExecutionError else "operation_failed"
                outcome = (False, OwnerExecutionError(code, may_have_committed=dispatched.is_set()))
            finally:
                if response is not None:
                    try:
                        response.close()
                    except Exception:
                        pass
                self._inflight.release()
                result_queue.put_nowait(outcome)

        thread = threading.Thread(target=run, name="ecos-owner-control", daemon=True)
        try:
            thread.start()
        except Exception:
            self._inflight.release()
            raise OwnerExecutionError("operation_failed", may_have_committed=False) from None
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
                if result.claim_expires_at is not None and claim_id is not None:
                    self._claims[result] = (
                        claim_id,
                        time.monotonic() + min(
                            float(OWNER_CLAIM_LIFETIME_SECONDS),
                            result.claim_expires_at - time.time(),
                        ),
                    )
                return result
        finally:
            stop.set()
