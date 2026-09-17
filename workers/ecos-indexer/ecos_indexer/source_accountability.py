"""Opt-in shadow bridge, not an answer authority or a second page extractor."""

from __future__ import annotations

import re
from typing import Any, Mapping
from uuid import UUID

from . import EVIDENCE_VERSION
from .models import HostedJob


SNAPSHOT_RPC = "ecos_snapshot_hosted_source_accountability"
SCHEMA_VERSION = "ecos-source-accountability/2.0"


class SourceAccountabilityError(RuntimeError):
    pass


def shadow_accountability_enabled(environment: Mapping[str, str]) -> bool:
    value = environment.get("ECOS_V2_SHADOW_ACCOUNTABILITY", "false")
    if value not in ("true", "false"):
        raise ValueError("ECOS_V2_SHADOW_ACCOUNTABILITY must be exactly true or false")
    return value == "true"


def snapshot_payload(job: HostedJob) -> dict[str, str]:
    if job.mode != "shadow":
        raise SourceAccountabilityError("v2_accountability_requires_shadow_job")
    # Counts, states, and scope are derived inside the database from the exact
    # registered job and durable checkpoints, never from a caller's page list.
    return {
        "p_job_id": job.job_id,
        "p_claim_token": job.claim_token,
        "p_extraction_version": EVIDENCE_VERSION,
    }


def validate_snapshot_receipt(
    value: Any, job: HostedJob, *, expected_page_count: int | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SourceAccountabilityError("v2_accountability_receipt_invalid")
    identities = {
        "schema_version": SCHEMA_VERSION,
        "job_id": job.job_id,
        "organization_id": job.organization_id,
        "project_id": job.project_id,
        "source_id": job.document_id,
        "source_sha256": job.source_sha256,
        "source_revision": job.source_revision,
        "extraction_version": EVIDENCE_VERSION,
        "publication_mode": "shadow",
    }
    if any(value.get(key) != expected for key, expected in identities.items()):
        raise SourceAccountabilityError("v2_accountability_receipt_identity_mismatch")
    try:
        manifest_id = value["manifest_id"]
        if not isinstance(manifest_id, str) or str(UUID(manifest_id)) != manifest_id:
            raise ValueError("manifest_id")
    except (KeyError, ValueError, AttributeError) as error:
        raise SourceAccountabilityError("v2_accountability_manifest_id_invalid") from error
    if not isinstance(value.get("manifest_sha256"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", value["manifest_sha256"],
    ):
        raise SourceAccountabilityError("v2_accountability_manifest_hash_invalid")
    count_keys = (
        "expected_item_count", "reported_item_count", "terminal_item_count",
        "usable_item_count", "gap_item_count", "assured_checkpoint_count",
    )
    if any(type(value.get(key)) is not int or not 0 <= value[key] <= 10_000 for key in count_keys):
        raise SourceAccountabilityError("v2_accountability_counts_invalid")
    expected = value["expected_item_count"]
    if expected < 1 or any(value[key] > expected for key in count_keys[1:]):
        raise SourceAccountabilityError("v2_accountability_counts_invalid")
    if expected_page_count is not None and expected != expected_page_count:
        raise SourceAccountabilityError("v2_accountability_inventory_mismatch")
    if value["terminal_item_count"] > value["reported_item_count"]:
        raise SourceAccountabilityError("v2_accountability_counts_invalid")
    if value["usable_item_count"] > value["terminal_item_count"]:
        raise SourceAccountabilityError("v2_accountability_counts_invalid")
    if value["assured_checkpoint_count"] > value["reported_item_count"] or value["gap_item_count"] < (
        expected - value["terminal_item_count"]
    ):
        raise SourceAccountabilityError("v2_accountability_counts_invalid")
    for key in ("fully_accounted", "fully_usable"):
        if type(value.get(key)) is not bool:
            raise SourceAccountabilityError("v2_accountability_coverage_invalid")
    if value["fully_accounted"] != (value["terminal_item_count"] == expected):
        raise SourceAccountabilityError("v2_accountability_coverage_invalid")
    if value["fully_usable"] != (
        value["usable_item_count"] == expected and value["gap_item_count"] == 0
    ):
        raise SourceAccountabilityError("v2_accountability_coverage_invalid")
    # This receipt validates persistence/identity only. It does not certify
    # extraction fidelity, recommendation quality, or customer answer readiness.
    return dict(value)
