from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import unittest

from ecos_indexer.owner_execution import (
    OwnerExecutionError, OwnerExecutionIdentity, ServiceAttestedMeasurement,
    bind_owner_execution_result, decode_json,
)
from ecos_indexer.owner_service_limits import OWNER_CLAIM_LIFETIME_SECONDS


def fixture_request():
    uid = lambda n: f"70000000-0000-4000-8000-{n:012d}"
    return {
        "schema_version": "ecos-owner-source-execution-request/2.0", "publication_mode": "shadow",
        "execution_id": uid(1), "request_id": uid(2), "owner_id": uid(3), "project_id": uid(4),
        "source_id": "drawing-ñ", "source_sha256": "a" * 64, "source_revision": None, "source_page_count": 7,
        "extraction_version": "ecos-owner-native-preview/2.0", "authority_decision_id": uid(5),
        "authority_receipt_sha256": "b" * 64, "managed_attempt_id": uid(6),
        "managed_receipt_sha256": "c" * 64, "expected_previous_binding_id": None,
    }


def fixture_identity():
    return OwnerExecutionIdentity.from_service_request(fixture_request(), expected_byte_length=100)


def fixture_result(action="read", *, registered=False):
    identity = fixture_identity()
    r = identity.request
    source = {
        "source_sha256": r["source_sha256"], "source_revision": r["source_revision"], "source_page_count": 7,
        "byte_length": 100, "bucket": "project-documents", "object_key": identity.object_key,
        "managed_attempt_id": r["managed_attempt_id"], "managed_receipt_sha256": r["managed_receipt_sha256"],
        "verification": "trusted_service_attested_storage_readback_not_current_download_proof",
    }
    v = {k: r[k] for k in ("execution_id", "owner_id", "project_id", "source_id", "source_sha256", "source_revision", "source_page_count", "extraction_version")}
    v.update(schema_version="ecos-owner-source-execution-control/2.0", publication_mode="shadow", execution_kind="owner_preview",
             organization_id=r["owner_id"], binding_id=r["request_id"], binding_version=1,
             affected_binding_id=None if action == "read" else r["request_id"], outcome={"claim": "claimed", "register": "registered", "finish": "finished", "cancel": "cancelled"}.get(action, "read"),
             state="queued", claim=None, source=source, native_readiness="not_assessed", retrieval_authorized=False)
    if action in {"claim", "register"}:
        started = datetime.now(timezone.utc)
        measurement = json.dumps({"source_sha256": "a" * 64, "source_page_count": 7, "byte_length": 100}) if registered else None
        v["state"] = "running"
        v["claim"] = {"claim_id": "70000000-0000-4000-8000-000000000009", "binding_id": r["request_id"],
                      "claimed_at": started.isoformat(), "expires_at": (started + timedelta(seconds=OWNER_CLAIM_LIFETIME_SECONDS)).isoformat(),
                      "status": "active", "measurement_json": measurement,
                      "measurement_sha256": hashlib.sha256(measurement.encode()).hexdigest() if measurement else None,
                      "registered_at": started.isoformat() if measurement else None}
    if action in {"finish", "cancel"}:
        v["source"] = None
        v["state"] = "currentness_not_asserted" if action == "finish" else "cancelled"
    return v


class OwnerExecutionDTOTest(unittest.TestCase):
    def test_exact_request_copied_frozen_and_no_authority_claim(self):
        raw = fixture_request()
        identity = OwnerExecutionIdentity.from_service_request(raw, expected_byte_length=100)
        raw["source_id"] = "changed"
        self.assertEqual(identity.request["source_id"], "drawing-ñ")
        with self.assertRaises(TypeError):
            identity.request["source_id"] = "changed"
        self.assertNotIn("claim_token", identity.request)
        self.assertNotIn("retrieval_authorized", identity.request)

    def test_request_rejects_unknown_scope_types_controls_and_noncanonical_ids(self):
        for key, value in (("owner_id", "wrong"), ("owner_id", fixture_request()["owner_id"].upper()),
                           ("source_sha256", 1), ("source_id", "bad\n"), ("source_revision", " "),
                           ("source_page_count", True), ("source_page_count", 7.0), ("source_page_count", 10001),
                           ("extraction_version", "hosted"), ("extra", "authority")):
            # Our all-numeric fixture UUID has no case distinction.
            if key == "owner_id" and value == fixture_request()["owner_id"]:
                continue
            raw = fixture_request(); raw[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(OwnerExecutionError):
                OwnerExecutionIdentity.from_service_request(raw, expected_byte_length=100)
        for count in (True, 0, 167772161, 100.0):
            with self.assertRaises(OwnerExecutionError):
                OwnerExecutionIdentity.from_service_request(fixture_request(), expected_byte_length=count)

    def test_real_wire_shape_retained_without_promoting_ready_or_download(self):
        raw = fixture_result()
        result = bind_owner_execution_result(raw, fixture_identity(), "read")
        self.assertEqual(result.payload["source"]["verification"], "trusted_service_attested_storage_readback_not_current_download_proof")
        raw["source"]["byte_length"] = 500
        self.assertEqual(result.payload["source"]["byte_length"], 100)
        self.assertFalse(result.payload["retrieval_authorized"])
        self.assertEqual(result.payload["native_readiness"], "not_assessed")
        with self.assertRaises(TypeError):
            result.payload["source"]["byte_length"] = 500

    def test_wrong_every_response_identity_and_managed_pin_is_rejected(self):
        patches = [(k, "wrong") for k in ("organization_id", "project_id", "execution_id", "source_id", "source_sha256", "source_revision", "extraction_version", "binding_id")]
        patches += [("source_page_count", True), ("binding_version", 0), ("binding_version", 1.0),
                    ("native_readiness", "complete"), ("retrieval_authorized", True), ("extra", False)]
        for key, value in patches:
            raw = fixture_result(); raw[key] = value
            with self.subTest(key=key), self.assertRaises(OwnerExecutionError):
                bind_owner_execution_result(raw, fixture_identity(), "read")
        for key in fixture_result()["source"]:
            raw = fixture_result(); raw["source"][key] = "wrong"
            with self.subTest(source_key=key), self.assertRaises(OwnerExecutionError):
                bind_owner_execution_result(raw, fixture_identity(), "read")

    def test_active_claim_exact_lifetime_generation_and_measurement_hash(self):
        raw = fixture_result("register", registered=True)
        result = bind_owner_execution_result(raw, fixture_identity(), "register", raw["claim"]["claim_id"])
        self.assertIsNotNone(result.claim_expires_at)
        for key, value in (("binding_id", fixture_request()["owner_id"]), ("claim_id", fixture_request()["owner_id"]),
                           ("measurement_sha256", "f" * 64), ("status", "complete"), ("expires_at", raw["claim"]["claimed_at"])):
            bad = deepcopy(raw); bad["claim"][key] = value
            with self.subTest(key=key), self.assertRaises(OwnerExecutionError):
                bind_owner_execution_result(bad, fixture_identity(), "register", raw["claim"]["claim_id"])
        old = deepcopy(raw)
        started = datetime.fromisoformat(old["claim"]["claimed_at"])
        old["claim"]["expires_at"] = (started + timedelta(seconds=120)).isoformat()
        with self.assertRaises(OwnerExecutionError):
            bind_owner_execution_result(old, fixture_identity(), "register", old["claim"]["claim_id"])

    def test_json_rejects_duplicate_rounded_numeric_unicode_and_unbounded_content(self):
        for payload in (b'{"a":1,"a":2}', b'{"a":7.0}', b'{"a":7e0}', b'{"a":NaN}', b'\xff', b' ' * 65537):
            with self.assertRaises(OwnerExecutionError):
                decode_json(payload)
        raw = fixture_result("register", registered=True)
        for measure in ('{"source_sha256":"' + "a" * 64 + '","source_page_count":7.0000000000000001,"byte_length":100}',
                        '{"source_sha256":"' + "a" * 64 + '","source_page_count":7,"byte_length":100,"byte_length":100}'):
            bad = deepcopy(raw); bad["claim"]["measurement_json"] = measure
            bad["claim"]["measurement_sha256"] = hashlib.sha256(measure.encode()).hexdigest()
            with self.assertRaises(OwnerExecutionError):
                bind_owner_execution_result(bad, fixture_identity(), "register", raw["claim"]["claim_id"])

    def test_historical_cleanup_reports_exact_affected_generation_not_new_head_currentness(self):
        raw = fixture_result("finish"); raw["binding_id"] = fixture_request()["owner_id"]; raw["binding_version"] = 2
        result = bind_owner_execution_result(raw, fixture_identity(), "finish", fixture_request()["owner_id"])
        self.assertFalse(result.binding_matches_request)
        self.assertEqual(result.payload["affected_binding_id"], fixture_request()["request_id"])
        self.assertEqual(result.payload["state"], "currentness_not_asserted")

    def test_missing_and_stale_never_supply_source_or_claim(self):
        raw = fixture_result(); raw.update(state="missing", source=None)
        for key in ("source_id", "source_sha256", "source_revision", "source_page_count", "extraction_version", "binding_id", "binding_version"):
            raw[key] = None
        self.assertEqual(bind_owner_execution_result(raw, fixture_identity(), "read").payload["state"], "missing")
        raw["source"] = fixture_result()["source"]
        with self.assertRaises(OwnerExecutionError):
            bind_owner_execution_result(raw, fixture_identity(), "read")

    def test_measurement_explicitly_supplied_not_inferred_and_rejects_bool_or_other_source(self):
        for measure in (ServiceAttestedMeasurement("b" * 64, 7, 100), ServiceAttestedMeasurement("a" * 64, True, 100), ServiceAttestedMeasurement("a" * 64, 7, 99)):
            with self.assertRaises(OwnerExecutionError):
                measure.to_wire(fixture_identity())


if __name__ == "__main__":
    unittest.main()
