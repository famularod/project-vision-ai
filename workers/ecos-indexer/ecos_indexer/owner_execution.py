"""Owner-preview control DTOs, NOT HostedJob or authorization/storage proof.

The service dispatcher supplies the existing 16-field prepared request and the
byte length from its current managed-copy receipt. Python validates transport
expectations; only each protected SQL operation rechecks current authority.
Nothing here marks extraction, enrollment or answer evidence complete.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
from types import MappingProxyType
from typing import Any, Mapping

from .owner_service_limits import OWNER_CLAIM_LIFETIME_SECONDS
from .owner_original_limits import MAX_ORIGINAL_BYTES

MAX_RESPONSE_BYTES = 65536
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
JS_SPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
REQUEST_KEYS = frozenset("schema_version publication_mode execution_id request_id owner_id project_id source_id source_sha256 source_revision source_page_count extraction_version authority_decision_id authority_receipt_sha256 managed_attempt_id managed_receipt_sha256 expected_previous_binding_id".split())
RESULT_KEYS = frozenset("schema_version publication_mode execution_kind execution_id owner_id organization_id project_id source_id source_sha256 source_revision source_page_count extraction_version binding_id binding_version affected_binding_id outcome state claim source native_readiness retrieval_authorized".split())
SOURCE_KEYS = frozenset("source_sha256 source_revision source_page_count byte_length bucket object_key managed_attempt_id managed_receipt_sha256 verification".split())
CLAIM_KEYS = frozenset("claim_id claimed_at expires_at status binding_id measurement_json measurement_sha256 registered_at".split())
MEASUREMENT_KEYS = frozenset(("source_sha256", "source_page_count", "byte_length"))
OUTCOMES = {
    "read": {"read"}, "claim": {"claimed", "already_claimed", "cancelled"},
    "register": {"registered", "already_registered", "cancelled"},
    "finish": {"finished", "finished_before_claim", "already_finished"},
    "cancel": {"cancelled", "already_cancelled"},
}


class OwnerExecutionError(Exception):
    """Fixed diagnostics only. A deadline never proves the server stopped."""
    def __init__(self, code: str = "operation_failed", *, may_have_committed: bool = True):
        self.code = code if code in {"invalid_request", "invalid_response", "cancelled", "deadline_exceeded", "operation_failed", "operation_in_flight"} else "operation_failed"
        self.may_have_committed = may_have_committed
        self.external_operation_stopped = False
        self.recovery = "read_or_retry_the_same_execution_binding_and_claim_ids"
        super().__init__("Owner execution operation not confirmed")


def reject() -> None:
    raise OwnerExecutionError("invalid_response")


def exact_object(value: Any, keys: frozenset[str]) -> dict[str, Any]:
    if type(value) is not dict or value.keys() != keys:
        reject()
    return value.copy()


def uuid(value: Any) -> str:
    if type(value) is not str or not UUID.fullmatch(value):
        reject()
    return value


def integer(value: Any, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        reject()
    return value


def text(value: Any, limit: int = 300) -> str:
    if (type(value) is not str or not value or len(value) > limit or value.strip(JS_SPACE) != value
            or any(ord(c) < 32 or 127 <= ord(c) <= 159 or 0xD800 <= ord(c) <= 0xDFFF for c in value)
            or len(value.encode("utf-8")) > limit):
        reject()
    return value


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            reject()
        result[key] = value
    return result


def decode_json(data: bytes, limit: int = MAX_RESPONSE_BYTES) -> Any:
    if type(data) is not bytes or not data or len(data) > limit:
        reject()
    try:
        return json.loads(data.decode("utf-8", errors="strict"), object_pairs_hook=_pairs,
                          parse_float=lambda _: reject(), parse_constant=lambda _: reject())
    except Exception:
        raise OwnerExecutionError("invalid_response") from None


def _freeze(value: Any) -> Any:
    if type(value) is dict:
        return MappingProxyType({k: _freeze(v) for k, v in value.items()})
    if type(value) is list:
        return tuple(_freeze(v) for v in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {k: _thaw(v) for k, v in value.items()}
    if type(value) is tuple:
        return [_thaw(v) for v in value]
    return value


@dataclass(frozen=True, eq=False)
class OwnerExecutionIdentity:
    request: Mapping[str, Any]
    expected_byte_length: int

    @classmethod
    def from_service_request(cls, value: Any, *, expected_byte_length: int) -> "OwnerExecutionIdentity":
        """Structural expectation only; callers must provide a trusted dispatch."""
        try:
            r = exact_object(value, REQUEST_KEYS)
            if (r["schema_version"] != "ecos-owner-source-execution-request/2.0"
                    or r["publication_mode"] != "shadow"
                    or r["extraction_version"] != "ecos-owner-native-preview/2.0"):
                reject()
            for key in ("execution_id", "request_id", "owner_id", "project_id", "authority_decision_id", "managed_attempt_id"):
                uuid(r[key])
            if r["expected_previous_binding_id"] is not None:
                uuid(r["expected_previous_binding_id"])
                if r["expected_previous_binding_id"] == r["request_id"]:
                    reject()
            for key in ("source_sha256", "authority_receipt_sha256", "managed_receipt_sha256"):
                if type(r[key]) is not str or not SHA.fullmatch(r[key]):
                    reject()
            text(r["source_id"])
            if r["source_revision"] is not None:
                text(r["source_revision"])
            integer(r["source_page_count"], 1, 10000)
            integer(expected_byte_length, 5, MAX_ORIGINAL_BYTES)
            return cls(_freeze(r), expected_byte_length)
        except Exception:
            raise OwnerExecutionError("invalid_request", may_have_committed=False) from None

    @property
    def object_key(self) -> str:
        r = self.request
        source_id_sha = hashlib.sha256(r["source_id"].encode("utf-8")).hexdigest()
        return f'v2-originals/{r["owner_id"]}/{source_id_sha}/{r["source_sha256"]}/{r["managed_attempt_id"]}.pdf'

    def validate(self) -> None:
        # A dataclass constructor is not an authority brand. Revalidate even a
        # directly constructed DTO before every operation and snapshot it once.
        self.from_service_request(dict(self.request), expected_byte_length=self.expected_byte_length)


@dataclass(frozen=True, eq=False)
class ServiceAttestedMeasurement:
    """Supplied measurement, not proof that this module downloaded or parsed PDF."""
    source_sha256: str
    source_page_count: int
    byte_length: int

    def to_wire(self, identity: OwnerExecutionIdentity) -> dict[str, Any]:
        r = identity.request
        integer(self.source_page_count, 1, 10000)
        integer(self.byte_length, 5, MAX_ORIGINAL_BYTES)
        if (type(self.source_sha256) is not str or self.source_sha256 != r["source_sha256"]
                or self.source_page_count != r["source_page_count"] or self.byte_length != identity.expected_byte_length):
            reject()
        return {"source_sha256": self.source_sha256, "source_page_count": self.source_page_count, "byte_length": self.byte_length}


@dataclass(frozen=True, eq=False)
class OwnerExecutionResult:
    payload: Mapping[str, Any]
    binding_matches_request: bool
    claim_expires_at: float | None
    verification: str = "execution_control_only_not_native_completion"

    def to_dict(self) -> dict[str, Any]:
        return {**_thaw(self.payload), "binding_matches_request": self.binding_matches_request,
                "verification": self.verification}


def _timestamp(value: Any) -> datetime:
    if type(value) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)", value):
        reject()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise OwnerExecutionError("invalid_response") from None


def bind_owner_execution_result(raw: Any, identity: OwnerExecutionIdentity, action: str,
                               claim_id: str | None = None) -> OwnerExecutionResult:
    """Validate the existing SQL control wire; this is not a new receipt format."""
    try:
        identity.validate()
        r = identity.request
        v = exact_object(raw, RESULT_KEYS)
        source = None if v["source"] is None else exact_object(v["source"], SOURCE_KEYS)
        claim = None if v["claim"] is None else exact_object(v["claim"], CLAIM_KEYS)
        if (action not in OUTCOMES or type(v["outcome"]) is not str or v["outcome"] not in OUTCOMES[action]
                or v["schema_version"] != "ecos-owner-source-execution-control/2.0"
                or v["publication_mode"] != "shadow" or v["execution_kind"] != "owner_preview"
                or v["native_readiness"] != "not_assessed" or v["retrieval_authorized"] is not False
                or v["execution_id"] != r["execution_id"] or v["owner_id"] != r["owner_id"]
                or v["organization_id"] != r["owner_id"] or v["project_id"] != r["project_id"]
                or v["affected_binding_id"] != (None if action == "read" else r["request_id"])):
            reject()
        state = v["state"]
        if type(state) is not str or state not in {"missing", "stale", "queued", "running", "released", "failed", "cancelled", "expired", "currentness_not_asserted"}:
            reject()
        absent = v["source_id"] is None
        if absent:
            if (not ((action == "read" and state == "missing") or (action == "cancel" and state == "cancelled"))
                    or any(v[k] is not None for k in ("source_sha256", "source_revision", "source_page_count", "extraction_version", "binding_id", "binding_version"))
                    or source is not None or claim is not None):
                reject()
        else:
            for key in ("source_id", "source_sha256", "source_revision", "source_page_count", "extraction_version"):
                if type(v[key]) is not type(r[key]) or v[key] != r[key]:
                    reject()
            uuid(v["binding_id"])
            integer(v["binding_version"], 1, 100)
        matches = v["binding_id"] == r["request_id"]
        if action in {"read", "claim", "register"} and not absent and not matches:
            reject()
        if action == "finish" and (state != "currentness_not_asserted" or source is not None or claim is not None):
            reject()
        if action == "cancel" and (state not in {"cancelled", "currentness_not_asserted"} or source is not None or claim is not None):
            reject()
        if action == "read" and (claim is not None or state == "currentness_not_asserted"
                                 or (state in {"missing", "stale", "cancelled"} and source is not None)
                                 or (state in {"queued", "running", "expired", "released", "failed"} and source is None)):
            reject()
        if action in {"claim", "register"}:
            if v["outcome"] == "cancelled":
                if state != "cancelled" or source is not None or claim is not None:
                    reject()
            elif claim is None or (action == "register" and state != "running"):
                reject()
        elif claim is not None:
            reject()
        if source is not None:
            expected = {"source_sha256": r["source_sha256"], "source_revision": r["source_revision"],
                        "source_page_count": r["source_page_count"], "byte_length": identity.expected_byte_length,
                        "bucket": "project-documents", "object_key": identity.object_key,
                        "managed_attempt_id": r["managed_attempt_id"], "managed_receipt_sha256": r["managed_receipt_sha256"],
                        "verification": "trusted_service_attested_storage_readback_not_current_download_proof"}
            if any(type(source[k]) is not type(value) or source[k] != value for k, value in expected.items()):
                reject()
        expires = None
        if claim is not None:
            if (claim["claim_id"] != claim_id or claim["binding_id"] != r["request_id"]
                    or claim["status"] not in {"active", "released", "failed", "cancelled", "expired"}):
                reject()
            started, ended = _timestamp(claim["claimed_at"]), _timestamp(claim["expires_at"])
            if (ended - started).total_seconds() != OWNER_CLAIM_LIFETIME_SECONDS:
                reject()
            if claim["status"] == "active":
                if state != "running" or source is None or ended <= datetime.now(timezone.utc):
                    reject()
                expires = ended.timestamp()
            elif state != claim["status"] or source is not None:
                reject()
            if claim["measurement_json"] is None:
                if claim["measurement_sha256"] is not None or claim["registered_at"] is not None or action == "register":
                    reject()
            else:
                raw_measurement = claim["measurement_json"]
                if type(raw_measurement) is not str or len(raw_measurement) > 1024:
                    reject()
                measured = exact_object(decode_json(raw_measurement.encode("utf-8"), 1024), MEASUREMENT_KEYS)
                ServiceAttestedMeasurement(**measured).to_wire(identity)
                if hashlib.sha256(raw_measurement.encode("utf-8")).hexdigest() != claim["measurement_sha256"]:
                    reject()
                registered = _timestamp(claim["registered_at"])
                if not started <= registered < ended:
                    reject()
        v["source"], v["claim"] = source, claim
        return OwnerExecutionResult(_freeze(v), matches, expires)
    except Exception:
        raise OwnerExecutionError("invalid_response") from None
