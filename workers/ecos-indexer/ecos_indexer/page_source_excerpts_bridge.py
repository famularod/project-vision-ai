"""Bounded shadow persistence; extraction receipts are not answer authority."""

from __future__ import annotations

import re
from typing import Any, Mapping
from uuid import UUID

from .models import HostedJob
from .source_accountability import SourceAccountabilityError


PAGE_EXCERPTS_RPC = "ecos_record_hosted_page_source_excerpts"
PAGE_EXCERPT_HEADS_RPC = "ecos_load_hosted_page_source_excerpt_heads"
PAGE_EXCERPTS_SCHEMA_VERSION = "ecos-page-source-excerpts/2.0"
NATIVE_EXTRACTION_VERSION = "ecos-native-page-excerpts/2.0"


def shadow_native_excerpts_enabled(environment: Mapping[str, str]) -> bool:
    value = environment.get("ECOS_V2_SHADOW_NATIVE_EXCERPTS", "false")
    if value not in ("true", "false"):
        raise ValueError("ECOS_V2_SHADOW_NATIVE_EXCERPTS must be exactly true or false")
    return value == "true"


def validate_page_excerpts_receipt(
    value: Any, job: HostedJob, projection: dict[str, Any],
) -> dict[str, Any]:
    if job.mode != "shadow" or not isinstance(value, dict):
        raise SourceAccountabilityError("v2_page_excerpt_receipt_invalid")
    identities = {
        "schema_version": PAGE_EXCERPTS_SCHEMA_VERSION,
        "extraction_version": NATIVE_EXTRACTION_VERSION,
        "job_id": job.job_id,
        "organization_id": job.organization_id,
        "project_id": job.project_id,
        "source_id": job.document_id,
        "source_sha256": job.source_sha256,
        "source_revision": job.source_revision,
        "publication_mode": "shadow",
        "page_number": projection["page_number"],
        "page_text_sha256": projection["page_text_sha256"],
        "state": projection["state"],
    }
    if any(value.get(key) != expected for key, expected in identities.items()):
        raise SourceAccountabilityError("v2_page_excerpt_receipt_identity_mismatch")
    if type(value.get("page_number")) is not int or not 1 <= value["page_number"] <= 10_000:
        raise SourceAccountabilityError("v2_page_excerpt_receipt_page_invalid")
    if type(value.get("excerpt_count")) is not int or value["excerpt_count"] != len(projection["excerpts"]):
        raise SourceAccountabilityError("v2_page_excerpt_receipt_count_invalid")
    try:
        identity = value["projection_id"]
        if not isinstance(identity, str) or str(UUID(identity)) != identity:
            raise ValueError("projection_id")
    except (KeyError, ValueError, AttributeError) as error:
        raise SourceAccountabilityError("v2_page_excerpt_receipt_id_invalid") from error
    if not isinstance(value.get("projection_sha256"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", value["projection_sha256"],
    ):
        raise SourceAccountabilityError("v2_page_excerpt_receipt_hash_invalid")
    return dict(value)


def validate_page_excerpt_heads(value: Any, job: HostedJob) -> set[int]:
    """A current exact source receipt, not caller-provided completed-page IDs."""
    if not isinstance(value, dict) or job.mode != "shadow":
        raise SourceAccountabilityError("v2_native_page_heads_invalid")
    expected = {
        "schema_version": PAGE_EXCERPTS_SCHEMA_VERSION,
        "extraction_version": NATIVE_EXTRACTION_VERSION,
        "job_id": job.job_id, "organization_id": job.organization_id,
        "project_id": job.project_id, "source_id": job.document_id,
        "source_sha256": job.source_sha256, "source_revision": job.source_revision,
        "publication_mode": "shadow", "source_page_count": job.source_page_count,
    }
    if any(value.get(key) != item for key, item in expected.items()):
        raise SourceAccountabilityError("v2_native_page_heads_scope_mismatch")
    if type(value.get("source_page_count")) is not int or not 1 <= value["source_page_count"] <= 10_000:
        raise SourceAccountabilityError("v2_native_page_heads_count_invalid")
    heads = value.get("heads")
    if not isinstance(heads, list) or len(heads) > value["source_page_count"]:
        raise SourceAccountabilityError("v2_native_page_heads_count_invalid")
    pages: set[int] = set()
    ids: set[str] = set()
    for head in heads:
        if not isinstance(head, dict):
            raise SourceAccountabilityError("v2_native_page_head_invalid")
        number = head.get("page_number")
        count = head.get("excerpt_count")
        state = head.get("state")
        if type(number) is not int or not 1 <= number <= value["source_page_count"] or number in pages:
            raise SourceAccountabilityError("v2_native_page_head_invalid")
        if type(count) is not int or not 0 <= count <= 256 or state not in ("partial", "failed", "unreadable"):
            raise SourceAccountabilityError("v2_native_page_head_invalid")
        if (state == "partial") != (count > 0):
            raise SourceAccountabilityError("v2_native_page_head_invalid")
        identity = head.get("projection_id")
        try:
            if not isinstance(identity, str) or str(UUID(identity)) != identity or identity in ids:
                raise ValueError("projection_id")
        except (ValueError, AttributeError) as error:
            raise SourceAccountabilityError("v2_native_page_head_invalid") from error
        if not isinstance(head.get("projection_sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", head["projection_sha256"]):
            raise SourceAccountabilityError("v2_native_page_head_invalid")
        pages.add(number)
        ids.add(identity)
    return pages
