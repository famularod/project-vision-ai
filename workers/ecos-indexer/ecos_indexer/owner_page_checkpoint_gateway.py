"""Fixed-host owner raw-page record/read port, separate from legacy checkpoints.

SQL owns page CAS and canonical wrapper hashing. This port verifies exact raw
readback hashes, identity and modality receipt summaries, not semantic geometry
or source authority. A read must still pass current SQL source/binding checks.
No raster bytes are sent or asserted available. No automatic mutation retries.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import queue
import re
import threading
import time
from typing import Any, Callable, Mapping

import requests

from .owner_execution import (
    OwnerExecutionIdentity, OwnerExecutionResult, SHA, _freeze, _thaw,
    _timestamp, decode_json, exact_object, integer, uuid,
)
from .owner_execution_gateway import OwnerExecutionGateway, SUPABASE_URL

MAX_PAGE_BYTES = 12 * 1024 * 1024
MAX_RESPONSE_BYTES = 25 * 1024 * 1024
LANE_LIMITS = {"native": 1024 * 1024, "table": 3 * 1024 * 1024, "visual": 4 * 1024 * 1024}
PAGE_KEYS = frozenset("schema_version source_sha256 source_revision source_page_count page_number extraction_version modalities".split())
RESULT_KEYS = frozenset("schema_version publication_mode owner_id organization_id project_id execution_id binding_id source_id source_sha256 source_revision source_page_count extraction_version page_number requested_attempt_id state outcome head page_json validation image_available retrieval_authorized semantic_verified".split())
HEAD_KEYS = frozenset("attempt_id page_sha256 version previous_attempt_id recorded_at modalities".split())


class OwnerPageCheckpointError(Exception):
    def __init__(self, code="operation_failed"):
        self.code = code if code in {"invalid_request", "invalid_response", "checkpoint_not_current", "operation_failed", "cancelled", "deadline_exceeded", "operation_in_flight"} else "operation_failed"
        self.may_have_committed = True
        self.external_operation_stopped = False
        self.recovery = "read_the_exact_attempt_id_before_any_new_mutation"
        super().__init__("Owner page checkpoint not confirmed")


def page_summary(value: Any, identity: OwnerExecutionIdentity) -> tuple[dict, dict]:
    """Bound wrapper and raw strings only; full modality parsing stays separate."""
    p = exact_object(value, PAGE_KEYS)
    r = identity.request
    if (p["schema_version"] != "ecos-owner-page-observations/2.1"
            or any(type(p[k]) is not type(r[k]) or p[k] != r[k] for k in ("source_sha256", "source_revision", "source_page_count", "extraction_version"))):
        raise ValueError()
    integer(p["page_number"], 1, r["source_page_count"])
    lanes = exact_object(p["modalities"], frozenset(LANE_LIMITS))
    summary = {}
    for name, maximum in LANE_LIMITS.items():
        slot = exact_object(lanes[name], frozenset(("state", "payload_json", "limitation_codes")))
        state, raw, codes = slot["state"], slot["payload_json"], slot["limitation_codes"]
        if (type(state) is not str or state not in {"partial", "unreadable", "failed", "not_attempted"}
                or type(codes) is not list or not 1 <= len(codes) <= 32
                or any(type(c) is not str or not re.fullmatch(r"[a-z][a-z0-9_]{0,99}", c) for c in codes)
                or len(set(codes)) != len(codes)):
            raise ValueError()
        if raw is None:
            if state not in {"failed", "not_attempted"}:
                raise ValueError()
            digest, size = None, 0
        else:
            if type(raw) is not str or len(raw) > maximum or state == "not_attempted":
                raise ValueError()
            encoded = raw.encode("utf-8", errors="strict")
            if not 2 <= len(encoded) <= maximum:
                raise ValueError()
            digest, size = hashlib.sha256(encoded).hexdigest(), len(encoded)
        lanes[name] = {"state": state, "payload_json": raw, "limitation_codes": list(codes)}
        summary[name] = {"state": state, "payload_sha256": digest, "payload_bytes": size, "limitation_codes": list(codes)}
    p["modalities"] = lanes
    if len(json.dumps(p, ensure_ascii=False, allow_nan=False).encode("utf-8")) > MAX_PAGE_BYTES:
        raise ValueError()
    return p, summary


@dataclass(frozen=True, eq=False)
class OwnerPageCheckpointResult:
    receipt: Mapping[str, Any]
    page: Mapping[str, Any] | None

    def to_dict(self) -> dict:
        return {"receipt": _thaw(self.receipt), "page": _thaw(self.page)}


class OwnerPageCheckpointGateway:
    def __init__(self, identity: OwnerExecutionIdentity, *, service_role_key: str,
                 post: Callable[..., Any] | None = None, timeout_seconds: float = 20):
        try:
            if type(identity) is not OwnerExecutionIdentity:
                raise ValueError()
            identity.validate()
            self.identity = OwnerExecutionIdentity.from_service_request(dict(identity.request), expected_byte_length=identity.expected_byte_length)
            if (type(service_role_key) is not str or not 1 <= len(service_role_key) <= 16384 or any(not "!" <= c <= "~" for c in service_role_key)
                    or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 25
                    or (post is not None and not callable(post))):
                raise ValueError()
        except Exception:
            raise OwnerPageCheckpointError("invalid_request") from None
        self._timeout = float(timeout_seconds)
        self._headers = {"Authorization": f"Bearer {service_role_key}", "apikey": service_role_key, "Content-Type": "application/json", "Accept": "application/json", "Accept-Encoding": "identity"}
        self._session = None
        if post is None:
            session = requests.Session(); session.trust_env = False
            session.mount("https://", requests.adapters.HTTPAdapter(max_retries=0))
            self._session, self._post = session, session.post
        else:
            self._post = post
        self._inflight = threading.Lock()

    def record(self, gateway: OwnerExecutionGateway, registered: OwnerExecutionResult, *,
               attempt_id: str, expected_previous_attempt_id: str | None, page: dict,
               cancel_event: threading.Event | None = None) -> OwnerPageCheckpointResult:
        try:
            if type(gateway) is not OwnerExecutionGateway:
                raise ValueError()
            identity = gateway.require_download_identity(registered)
            if (dict(identity.request) != dict(self.identity.request) or identity.expected_byte_length != self.identity.expected_byte_length
                    or registered.payload["claim"]["registered_at"] is None):
                raise ValueError()
            uuid(attempt_id)
            if expected_previous_attempt_id is not None:
                uuid(expected_previous_attempt_id)
                if expected_previous_attempt_id == attempt_id:
                    raise ValueError()
            p, summary = page_summary(page, identity)
            claim_id = registered.payload["claim"]["claim_id"]
        except Exception:
            raise OwnerPageCheckpointError("invalid_request") from None
        return self._send("record", p["page_number"], attempt_id, {
            "p_claim_id": claim_id, "p_attempt_id": attempt_id,
            "p_expected_previous_attempt_id": expected_previous_attempt_id, "p_page": p,
        }, cancel_event, expected_summary=summary, expected_previous=expected_previous_attempt_id)

    def read(self, *, page_number: int, expected_attempt_id: str,
             cancel_event: threading.Event | None = None) -> OwnerPageCheckpointResult:
        try:
            integer(page_number, 1, self.identity.request["source_page_count"]); uuid(expected_attempt_id)
        except Exception:
            raise OwnerPageCheckpointError("invalid_request") from None
        return self._send("read", page_number, expected_attempt_id,
                          {"p_page_number": page_number, "p_expected_attempt_id": expected_attempt_id}, cancel_event)

    def _bind(self, value, action, page_number, attempt_id, expected_summary, expected_previous):
        v = exact_object(value, RESULT_KEYS); r = self.identity.request
        if (v["schema_version"] != "ecos-owner-page-observation-checkpoint/2.1" or v["publication_mode"] != "shadow"
                or v["validation"] != "raw_checkpoint_identity_and_byte_bounds_only"
                or any(v[k] is not False for k in ("image_available", "retrieval_authorized", "semantic_verified"))
                or v["owner_id"] != r["owner_id"] or v["organization_id"] != r["owner_id"] or v["project_id"] != r["project_id"]
                or v["execution_id"] != r["execution_id"] or v["binding_id"] != r["request_id"]
                or type(v["page_number"]) is not int or v["page_number"] != page_number or v["requested_attempt_id"] != attempt_id):
            raise ValueError()
        if v["state"] != "current":
            raise OwnerPageCheckpointError("checkpoint_not_current")
        if v["outcome"] not in ({"read"} if action == "read" else {"recorded", "already_recorded"}):
            raise ValueError()
        for key in ("source_id", "source_sha256", "source_revision", "source_page_count", "extraction_version"):
            if type(v[key]) is not type(r[key]) or v[key] != r[key]:
                raise ValueError()
        head = exact_object(v["head"], HEAD_KEYS)
        if head["attempt_id"] != attempt_id or type(head["page_sha256"]) is not str or not SHA.fullmatch(head["page_sha256"]):
            raise ValueError()
        integer(head["version"], 1, 32); _timestamp(head["recorded_at"])
        if head["previous_attempt_id"] is not None:uuid(head["previous_attempt_id"])
        if (head["version"] == 1) != (head["previous_attempt_id"] is None):raise ValueError()
        parsed = None
        if action == "record":
            if v["page_json"] is not None or head["previous_attempt_id"] != expected_previous or head["modalities"] != expected_summary:
                raise ValueError()
        else:
            raw = v["page_json"]
            if type(raw) is not str or len(raw) > MAX_PAGE_BYTES:
                raise ValueError()
            encoded = raw.encode("utf-8", errors="strict")
            if hashlib.sha256(encoded).hexdigest() != head["page_sha256"]:
                raise ValueError()
            parsed, summary = page_summary(decode_json(encoded, MAX_PAGE_BYTES), self.identity)
            if parsed["page_number"] != page_number or summary != head["modalities"]:
                raise ValueError()
        return OwnerPageCheckpointResult(_freeze(v), _freeze(parsed))

    def _send(self, action, page_number, attempt_id, extra, cancel_event, *, expected_summary=None, expected_previous=None):
        if cancel_event is not None and type(cancel_event) is not threading.Event:
            raise OwnerPageCheckpointError("invalid_request")
        if cancel_event is not None and cancel_event.is_set():raise OwnerPageCheckpointError("cancelled")
        if not self._inflight.acquire(blocking=False):raise OwnerPageCheckpointError("operation_in_flight")
        deadline = time.monotonic() + self._timeout; stop = threading.Event(); result_queue = queue.Queue(maxsize=1)
        r = self.identity.request
        parameters = {"p_owner_id": r["owner_id"], "p_project_id": r["project_id"], "p_execution_id": r["execution_id"], "p_binding_id": r["request_id"], **extra}
        payload = json.dumps(parameters, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        url = f"{SUPABASE_URL}/rest/v1/rpc/ecos_{action}_owner_page_observations"
        def check():
            if cancel_event is not None and cancel_event.is_set():raise OwnerPageCheckpointError("cancelled")
            if stop.is_set() or time.monotonic() >= deadline:raise OwnerPageCheckpointError("deadline_exceeded")
        def run():
            response = None
            try:
                check()
                if len(payload) > MAX_RESPONSE_BYTES:raise OwnerPageCheckpointError("invalid_request")
                remaining = max(0.001, deadline-time.monotonic())
                response = self._post(url, headers=dict(self._headers), data=payload, allow_redirects=False, stream=True,
                                      timeout=(min(5.0, remaining), min(5.0, remaining)))
                check()
                if response.status_code != 200 or response.url != url or response.history:raise OwnerPageCheckpointError()
                if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":raise OwnerPageCheckpointError("invalid_response")
                encoding = response.headers.get("Content-Encoding", "identity").strip().lower(); raw_length = response.headers.get("Content-Length"); length = None
                if raw_length is not None:
                    if type(raw_length) is not str or not raw_length.isascii() or not raw_length.isdigit() or len(raw_length) > 10:raise OwnerPageCheckpointError("invalid_response")
                    length = int(raw_length)
                    if length > MAX_RESPONSE_BYTES:raise OwnerPageCheckpointError("invalid_response")
                data = bytearray()
                for chunk in response.iter_content(chunk_size=65536):
                    check()
                    if type(chunk) is not bytes or len(data)+len(chunk) > MAX_RESPONSE_BYTES:raise OwnerPageCheckpointError("invalid_response")
                    data.extend(chunk)
                check()
                if encoding in ("", "identity") and length is not None and length != len(data):raise OwnerPageCheckpointError("invalid_response")
                value = self._bind(decode_json(bytes(data), MAX_RESPONSE_BYTES), action, page_number, attempt_id, expected_summary, expected_previous)
                check(); outcome = (True, value)
            except Exception as error:
                outcome = (False, OwnerPageCheckpointError(error.code if type(error) is OwnerPageCheckpointError else "invalid_response"))
            finally:
                if response is not None:
                    try:response.close()
                    except Exception:pass
                self._inflight.release(); result_queue.put_nowait(outcome)
        thread = threading.Thread(target=run, name="ecos-owner-page-checkpoint", daemon=True)
        try:thread.start()
        except Exception:
            self._inflight.release(); raise OwnerPageCheckpointError() from None
        try:
            while True:
                check()
                try:success, result = result_queue.get(timeout=min(0.01, max(0.001, deadline-time.monotonic())))
                except queue.Empty:continue
                check()
                if not success:raise result
                return result
        finally:stop.set()
