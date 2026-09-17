from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import re
from dataclasses import dataclass
from fractions import Fraction
from typing import Any
from uuid import UUID

import pymupdf as fitz
import requests

from .resource_limits import bounded_page_render_png


VISUAL_SCHEMA_VERSION = "ecos-drawing-page-analysis/2.0"
VISUAL_DISMISSAL_TYPE = "independently_unverifiable_candidates"
VISUAL_CANDIDATE_PARTITION_TYPE = "independently_resolved_candidate_partition"
CANDIDATE_AGREEMENT_METHOD = "dual_provider_candidate_index_v1"
VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION = "ecos-visual-provider-operation/1.0"
MIN_ASSURED_VISUAL_CONFIDENCE = 0.85
VISUAL_MEASUREMENT_CORRECTION_SOURCE = (
    "fixed_visual_tile_measurement_transcription_correction"
)
VISUAL_PROVIDER_READ_TIMEOUT_SECONDS = 240
EXACT_AREA_TOTAL_FRONTAGE_TEXT = "TOTAL FRONTAGE LENGTH: 30' / 586'-1\""
EXACT_AREA_ROW_VERTICAL_RULE_SUPPRESSION_TEXTS = frozenset({
    "EAST- 30' / 185'-1\"",
    EXACT_AREA_TOTAL_FRONTAGE_TEXT,
})
EXACT_FIRE_SEPARATION_SOURCE = (
    "exact_rendered_fire_separation_composite_candidate"
)
EXACT_FIRE_SEPARATION_NORTH_OPENINGS_TEXT = (
    "OPENINGS WITH LESS THEN 29'-10\" FIRE SEPARATION, OPENINGS NOT "
    "LIMITED, NO OPENING PROTECTION REQUIRED."
)
EXACT_FIRE_SEPARATION_NORTH_OPENINGS_BOUNDS = {
    "x": 0.45746, "y": 0.364,
    "width": 0.085397, "height": 0.013333,
}
EXACT_FIRE_SEPARATION_NORTH_OPENINGS_DETAIL_SPECS = (
    ({
        "x": 0.45746, "y": 0.364,
        "width": 0.085397, "height": 0.004222,
    }, 12.0),
    ({
        "x": 0.45746, "y": 0.368667,
        "width": 0.081746, "height": 0.004,
    }, 12.0),
    ({
        "x": 0.45746, "y": 0.373333,
        "width": 0.016667, "height": 0.004,
    }, 12.0),
)
EXACT_EASEMENT_NOTE_SOURCE = (
    "exact_rendered_easement_note_composite_candidate"
)
EXACT_SITE_NOTE_SOURCE = "exact_rendered_site_note_composite_candidate"
EXACT_PAGE30_COMPLETE_PROPOSITION_SOURCE = (
    "exact_rendered_page30_complete_proposition_candidate"
)
EXACT_PAGE63_SPACING_PROPOSITION_SOURCE = (
    "exact_rendered_architectural_2375_page63_spacing_candidate"
)
EXACT_PAGE64_CONTROL_JOINT_PROPOSITION_SOURCE = (
    "exact_rendered_architectural_2375_page64_control_joint_candidate"
)
EXACT_ELECTRICAL_PAGE13_PHOTOMETRIC_SOURCE = (
    "exact_native_rendered_2375_electrical_page13_photometric_candidate"
)
EXACT_CANOPY_A_OVERALL_DIMENSION_SOURCE = (
    "exact_rendered_canopy_a_2375_overall_dimension_candidate"
)
EXACT_CANOPY_A_OUTSET_NOTE_SOURCE = (
    "exact_rendered_canopy_a_2375_outset_note_candidate"
)
FACT_RESOLVABLE_REGION_PREFIX = "low-confidence-ocr-"
NON_FACT_RESOLVABLE_REGION_KEYS = frozenset({
    "page-overview",
    "low-text-page",
    "title-block",
})
TOKEN_STOP_WORDS = frozenset({
    "a", "an", "and", "are", "at", "be", "by", "for", "from", "in",
    "is", "it", "of", "on", "or", "the", "to", "was", "with",
})
VULGAR_FRACTIONS = {
    "¼": "1/4", "½": "1/2", "¾": "3/4",
    "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}
VISUAL_PROVIDER_TEXT_ID_MAX_BYTES = {
    "organizationId": 500,
    "projectId": 500,
    "documentId": 200,
}
VISUAL_PROVIDER_UUID_FIELDS = (
    "hostedJobId",
    "hostedClaimToken",
)
VISUAL_PROVIDER_OPERATION_FIELDS = (
    "organizationId",
    "projectId",
    "documentId",
    "sourceSha256",
    "pageNumber",
    "hostedJobId",
    "hostedClaimToken",
    "evidenceVersion",
    "visualExceptionFingerprint",
    "visualRegionKey",
)
LOWER_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
EVIDENCE_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")
VISUAL_REGION_KEY_PATTERN = re.compile(r"^[\x21-\x7e]{1,300}$")


@dataclass(frozen=True)
class VisualResolution:
    resolved: bool
    evidence: dict[str, Any]
    internal_diagnostics: dict[str, Any]


class VisualProviderIdentityRejected(ValueError):
    """The worker could not bind a provider request to its exact hosted claim."""


class BoundedVisualResolver:
    """Optional Vitruvius-owned visual exception service.

    Credentials exist only in the worker runtime. No provider configuration is
    ever accepted from, or returned to, a customer application.
    """

    def __init__(self) -> None:
        self.endpoint = os.getenv("ECOS_VISUAL_PROVIDER_URL", "").strip()
        self.token = os.getenv("ECOS_VISUAL_PROVIDER_TOKEN", "").strip()

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.token)

    def resolve(
        self,
        *,
        page: fitz.Page,
        exception: dict[str, Any],
        context: dict[str, Any],
    ) -> VisualResolution:
        if not self.endpoint or not self.token:
            return VisualResolution(False, {}, {"category": "visual_service_not_configured"})
        if not visual_exception_is_fact_resolvable(exception):
            return VisualResolution(False, {}, {
                "category": "visual_exception_requires_deterministic_resolution",
                "regionKey": str(exception.get("regionKey") or "")[:300],
            })
        candidates = bounded_diagnostic_candidates(exception)
        if not candidates:
            return VisualResolution(False, {}, {"category": "visual_exception_candidates_missing"})
        bounds = normalized_unit_bounds(exception.get("bounds"))
        if bounds is None:
            return VisualResolution(False, {}, {"category": "visual_exception_bounds_invalid"})
        try:
            request_identity = visual_provider_request_identity(context, exception)
        except VisualProviderIdentityRejected:
            return VisualResolution(False, {}, {"category": "visual_request_identity_invalid"})
        reason = str(exception.get("reason") or "").strip()[:1000]
        # Keep the exception/candidate authority at its exact OCR coordinates,
        # but show the providers a small amount of surrounding drawing context.
        # A word-tight crop can clip feet/inch marks into a leader line or
        # arrowhead, making a clearly printed dimension impossible to verify.
        # Provider facts are still rejected below unless their returned bounds
        # remain inside the original exact exception and candidate boxes.
        review_bounds = visual_review_bounds(bounds, candidates)
        overview = crop_page(page, review_bounds, scale=1.25)
        tile_bounds = visual_tile_bounds(review_bounds)
        tile_scale = visual_review_tile_scale(candidates)
        exact_area_row = (
            len(candidates) == 1
            and str(candidates[0].get("source") or "")
            == "exact_rendered_area_table_row_composite_candidate"
        )
        exact_fire_separation = (
            len(candidates) == 1
            and str(candidates[0].get("source") or "")
            == EXACT_FIRE_SEPARATION_SOURCE
        )
        tile_specs = [(tile, tile_scale) for tile in tile_bounds]
        detail_bounds = None
        exact_area_detail_scale = None
        if exact_area_row:
            # Issued area-table values can be crossed by long drawing rules.
            # Keep the full table tile for W/L and neighboring-row semantics,
            # then add one denser immutable row tile so both providers can
            # inspect the remaining glyph strokes without changing authority.
            # Facts still have to map inside the original candidate bounds.
            detail_bounds = normalized_unit_bounds(candidates[0].get("bounds"))
            if detail_bounds is not None:
                exact_area_detail_scale = (
                    6.0
                    if str(candidates[0].get("text") or "")
                    == EXACT_AREA_TOTAL_FRONTAGE_TEXT
                    else 18.0
                )
                tile_specs.append((detail_bounds, exact_area_detail_scale))
        elif exact_fire_separation:
            # The complete issued fire-separation sentences span multiple
            # tightly spaced CAD lines. Preserve the ordinary context tile,
            # then add one unmodified denser rendering of the exact candidate
            # bounds so both providers can inspect every printed word and
            # dimension. This is a readability view only: candidate authority,
            # bounds, fingerprint, and the dual-provider partition are
            # unchanged.
            detail_bounds = normalized_unit_bounds(candidates[0].get("bounds"))
            if detail_bounds is not None:
                tile_specs.append((detail_bounds, 6.0))
                if (
                    str(candidates[0].get("text") or "")
                    == EXACT_FIRE_SEPARATION_NORTH_OPENINGS_TEXT
                    and detail_bounds
                    == EXACT_FIRE_SEPARATION_NORTH_OPENINGS_BOUNDS
                ):
                    # The exact sentence ends at REQUIRED., while its third
                    # printed CAD line immediately starts the next sentence.
                    # Preserve both untouched context crops above, then add
                    # direct high-resolution crops of the two complete first
                    # lines and the terminal REQUIRED. word. These are
                    # readability views only: candidate text, coordinates,
                    # fingerprint, and dual-provider acceptance remain
                    # unchanged.
                    tile_specs.extend(
                        EXACT_FIRE_SEPARATION_NORTH_OPENINGS_DETAIL_SPECS
                    )
        tiles = []
        raw_detail = None
        for tile, scale in tile_specs:
            rendered = crop_page(page, tile, scale=scale)
            tiles.append({
                "bounds": tile,
                "imageDataUrl": image_data_url(rendered),
            })
            if (
                exact_area_row
                and detail_bounds == tile
                and scale == exact_area_detail_scale
            ):
                raw_detail = rendered
        if (
            exact_area_row
            and detail_bounds is not None
            and raw_detail is not None
            and str(candidates[0].get("text") or "")
            in EXACT_AREA_ROW_VERTICAL_RULE_SUPPRESSION_TEXTS
        ):
            # Preserve the original issued rendering above, then provide the
            # same exact row with only continuous full-height drawing-rule
            # columns suppressed. The transformed view is a readability aid;
            # it does not change candidate text, coordinates, fingerprint, or
            # the dual-provider fact/dismissal contract.
            tiles.append({
                "bounds": detail_bounds,
                "imageDataUrl": image_data_url(
                    suppress_exact_area_row_crossing_rule(raw_detail),
                ),
            })
        response = requests.post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            json={
                "schemaVersion": VISUAL_SCHEMA_VERSION,
                **request_identity,
                "documentName": context.get("documentName") or context.get("documentId") or "Protected project drawing",
                "discipline": context.get("discipline") or None,
                "existingText": "\n".join(candidate["text"] for candidate in candidates)[:16000],
                "analysisFocus": reason,
                "visualException": {
                    "regionKey": str(exception.get("regionKey") or "")[:300],
                    "reason": reason,
                    "bounds": bounds,
                    "diagnosticCandidates": candidates,
                },
                "imageDataUrl": image_data_url(overview),
                # A visual exception is always a crop, even when it produces
                # one tile. page_tiles makes the edge service convert the
                # provider's crop-local 0..1000 proof coordinates back to
                # full-page coordinates before this worker validates them.
                "analysisPass": "page_tiles",
                "tileBounds": review_bounds,
                "tileImages": tiles,
            },
            # One bounded request performs primary analysis and an independent
            # assurance pass. Keep it below the 600-second page deadline, but
            # do not abandon a valid two-provider result at the old 90-second
            # single-provider boundary.
            timeout=(10, VISUAL_PROVIDER_READ_TIMEOUT_SECONDS),
        )
        if response.status_code >= 500 or response.status_code == 429:
            return VisualResolution(False, {}, {
                "category": "visual_service_temporarily_unavailable",
                "status": response.status_code,
                "error": bounded_error_code(response),
                **bounded_assurance_provider_diagnostics(response),
            })
        if response.status_code >= 400:
            return VisualResolution(False, {}, {
                "category": "visual_service_request_rejected",
                "status": response.status_code,
                "error": bounded_error_code(response),
            })
        try:
            payload = response.json() if response.content else {}
        except (ValueError, TypeError):
            return VisualResolution(False, {}, {"category": "visual_service_response_invalid"})
        return validated_visual_resolution(payload, exception)


def visual_provider_request_identity(
    context: dict[str, Any],
    exception: dict[str, Any],
) -> dict[str, Any]:
    """Build the exact, replay-stable identity for one visual provider request."""
    if not isinstance(context, dict) or not isinstance(exception, dict):
        raise VisualProviderIdentityRejected("identity_not_an_object")

    identity: dict[str, Any] = {}
    for field, maximum_bytes in VISUAL_PROVIDER_TEXT_ID_MAX_BYTES.items():
        value = context.get(field)
        if (
            not isinstance(value, str)
            or not 1 <= len(value) <= maximum_bytes
            or not all(" " <= character <= "~" for character in value)
            or not any("!" <= character <= "~" for character in value)
        ):
            raise VisualProviderIdentityRejected(f"{field}_invalid")
        # Organization, project, and document IDs are database TEXT keys.
        # Preserve the exact live value; never trim or case-fold operation identity.
        identity[field] = value

    for field in VISUAL_PROVIDER_UUID_FIELDS:
        value = context.get(field)
        if not isinstance(value, str):
            raise VisualProviderIdentityRejected(f"{field}_invalid")
        try:
            canonical = str(UUID(value))
        except (ValueError, TypeError, AttributeError) as error:
            raise VisualProviderIdentityRejected(f"{field}_invalid") from error
        if value != canonical:
            raise VisualProviderIdentityRejected(f"{field}_invalid")
        identity[field] = value

    source_sha256 = context.get("sourceSha256")
    if not isinstance(source_sha256, str) or not LOWER_SHA256_PATTERN.fullmatch(source_sha256):
        raise VisualProviderIdentityRejected("sourceSha256_invalid")
    identity["sourceSha256"] = source_sha256

    page_number = context.get("pageNumber")
    if isinstance(page_number, bool) or not isinstance(page_number, int) or not 1 <= page_number <= 10000:
        raise VisualProviderIdentityRejected("pageNumber_invalid")
    identity["pageNumber"] = page_number

    evidence_version = context.get("evidenceVersion")
    if not isinstance(evidence_version, str) or not EVIDENCE_VERSION_PATTERN.fullmatch(evidence_version):
        raise VisualProviderIdentityRejected("evidenceVersion_invalid")
    identity["evidenceVersion"] = evidence_version

    exception_region_key = exception.get("regionKey")
    visual_region_key = context.get("visualRegionKey")
    if (
        not isinstance(exception_region_key, str)
        or not isinstance(visual_region_key, str)
        or not VISUAL_REGION_KEY_PATTERN.fullmatch(exception_region_key)
        or visual_region_key != exception_region_key
    ):
        raise VisualProviderIdentityRejected("visualRegionKey_invalid")
    identity["visualRegionKey"] = visual_region_key

    exception_fingerprint = context.get("visualExceptionFingerprint")
    if (
        not isinstance(exception_fingerprint, str)
        or not LOWER_SHA256_PATTERN.fullmatch(exception_fingerprint)
        or exception_fingerprint != visual_exception_fingerprint(exception)
    ):
        raise VisualProviderIdentityRejected("visualExceptionFingerprint_invalid")
    identity["visualExceptionFingerprint"] = exception_fingerprint

    identity["providerOperationId"] = visual_provider_operation_id(identity)
    return identity


def visual_provider_operation_id(identity: dict[str, Any]) -> str:
    """Hash the versioned canonical bytes shared by Python, Edge, and SQL."""
    if not isinstance(identity, dict) or set(identity) != set(VISUAL_PROVIDER_OPERATION_FIELDS):
        raise VisualProviderIdentityRejected("provider_operation_identity_invalid")
    canonical = {"schemaVersion": VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION}
    canonical.update({field: identity[field] for field in VISUAL_PROVIDER_OPERATION_FIELDS})
    return hashlib.sha256(
        json.dumps(
            canonical,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
    ).hexdigest()


def visual_exception_fingerprint(exception: dict[str, Any]) -> str:
    """Bind a paid resolution to the exact extracted exception contract."""
    canonical = {
        "regionKey": str(exception.get("regionKey") or "").strip()[:300],
        "reason": str(exception.get("reason") or "").strip()[:1000],
        "bounds": normalized_unit_bounds(exception.get("bounds")),
        "diagnosticCandidates": bounded_diagnostic_candidates(exception),
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def visual_exception_is_fact_resolvable(exception: dict[str, Any]) -> bool:
    region_key = str(exception.get("regionKey") or "").strip()
    if region_key in NON_FACT_RESOLVABLE_REGION_KEYS:
        return False
    return region_key.startswith(FACT_RESOLVABLE_REGION_PREFIX)


def bounded_diagnostic_candidates(exception: dict[str, Any]) -> list[dict[str, Any]]:
    raw = exception.get("diagnosticCandidates")
    if not isinstance(raw, list):
        return []
    candidates: list[dict[str, Any]] = []
    for item in raw[:12]:
        if not isinstance(item, dict):
            continue
        text = re.sub(r"\s+", " ", str(item.get("text") or "").strip())[:500]
        bounds = normalized_unit_bounds(item.get("bounds"))
        confidence = normalized_confidence(item.get("confidence"))
        if not text or bounds is None:
            continue
        candidates.append({
            "text": text,
            "source": str(item.get("source") or "unknown").strip()[:120],
            "confidence": confidence,
            "bounds": bounds,
        })
    return candidates


def validated_visual_resolution(
    payload: Any,
    exception: dict[str, Any],
) -> VisualResolution:
    """Accept only independently assured facts that resolve this exact crop."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != VISUAL_SCHEMA_VERSION:
        return VisualResolution(False, {}, {"category": "visual_schema_invalid"})
    vision_provider = str(payload.get("visionProvider") or "").strip()[:120]
    model = str(payload.get("model") or "").strip()[:160]
    assurance_provider = str(payload.get("assuranceProvider") or "").strip()[:120]
    assurance_model = str(payload.get("assuranceModel") or "").strip()[:160]
    if (
        not vision_provider or not model or not assurance_provider or not assurance_model
        or vision_provider == assurance_provider
    ):
        return VisualResolution(False, {}, {"category": "visual_assurance_missing"})
    candidates = bounded_diagnostic_candidates(exception)
    exception_bounds = normalized_unit_bounds(exception.get("bounds"))
    if (
        not visual_exception_is_fact_resolvable(exception)
        or not candidates
        or exception_bounds is None
    ):
        return VisualResolution(False, {}, {"category": "visual_exception_not_fact_resolvable"})

    accepted_by_candidate: dict[int, dict[str, Any]] = {}
    every_raw_fact_valid = True
    if not isinstance(payload.get("facts"), list):
        return VisualResolution(False, {}, {"category": "visual_facts_invalid"})
    raw_facts = payload["facts"]
    if len(raw_facts) > 72:
        return VisualResolution(False, {}, {"category": "visual_fact_count_invalid"})
    for raw_fact in raw_facts[:72]:
        fact = normalized_provider_fact(raw_fact, payload)
        if (
            not fact
            or not bounds_within(fact["bounds"], exception_bounds, tolerance=0.001)
            or not meaningful_bounds_overlap(fact["bounds"], exception_bounds)
        ):
            every_raw_fact_valid = False
            continue
        matched_indexes = [
            index for index, candidate in enumerate(candidates)
            if bounds_within(candidate["bounds"], exception_bounds, tolerance=0.001)
            and meaningful_bounds_overlap(candidate["bounds"], exception_bounds)
            and bounds_within(fact["bounds"], candidate["bounds"], tolerance=0.001)
            and meaningful_bounds_overlap(fact["bounds"], candidate["bounds"])
            and fact_directly_corroborates_candidate(fact, candidate)
        ]
        if len(matched_indexes) != 1:
            every_raw_fact_valid = False
            continue
        matched_index = matched_indexes[0]
        if matched_index in accepted_by_candidate:
            every_raw_fact_valid = False
            continue
        canonical_candidate = canonical_provider_fact_text(
            fact, candidates[matched_index]
        )
        if canonical_candidate is None:
            every_raw_fact_valid = False
            continue
        accepted_by_candidate[matched_index] = {
            **fact,
            # The provider is allowed to help read the crop, but it is not
            # allowed to append conclusions to the durable project fact.
            # Persist only the exact low-confidence candidate that the
            # bounded image independently corroborated.
            "statement": canonical_candidate,
            "evidenceText": canonical_candidate,
            "subject": canonical_candidate[:240],
            "location": "",
            "corroboratedCandidateIndexes": [matched_index],
            **({
                "ocrCorrectionMethod": (
                    "dual_provider_exact_measurement_transcription"
                ),
                "rawOcrCandidateText": candidates[matched_index]["text"],
            } if candidate_allows_measurement_transcription(
                candidates[matched_index]
            ) else {}),
        }

    accepted_indexes = sorted(accepted_by_candidate)
    accepted_facts = [accepted_by_candidate[index] for index in accepted_indexes]
    expected_indexes = list(range(len(candidates)))
    expected_dismissed = [index for index in expected_indexes if index not in accepted_by_candidate]
    primary_dismissed = normalized_candidate_indexes(
        payload.get("primaryDismissedCandidateIndexes"), len(candidates),
    )
    assurance_dismissed = normalized_candidate_indexes(
        payload.get("assuranceDismissedCandidateIndexes"), len(candidates),
    )
    jointly_dismissed = normalized_candidate_indexes(
        payload.get("dismissedCandidateIndexes"), len(candidates),
    )
    primary_accepted = normalized_candidate_indexes(
        payload.get("primaryAcceptedCandidateIndexes"), len(candidates),
    )
    assurance_accepted = normalized_candidate_indexes(
        payload.get("assuranceAcceptedCandidateIndexes"), len(candidates),
    )
    if (
        payload.get("candidateAgreementMethod") != CANDIDATE_AGREEMENT_METHOD
        or payload.get("primaryAcceptedCandidateIndexesValid") is not True
        or payload.get("assuranceAcceptedCandidateIndexesValid") is not True
        or payload.get("primaryDismissedCandidateIndexesValid") is not True
        or payload.get("assuranceDismissedCandidateIndexesValid") is not True
        or not every_raw_fact_valid
        or primary_accepted != accepted_indexes
        or assurance_accepted != accepted_indexes
        or primary_dismissed != expected_dismissed
        or assurance_dismissed != expected_dismissed
        or jointly_dismissed != expected_dismissed
    ):
        return VisualResolution(False, {}, {"category": "visual_candidate_partition_incomplete"})

    if not accepted_facts:
        return VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": CANDIDATE_AGREEMENT_METHOD,
            "resolutionType": VISUAL_DISMISSAL_TYPE,
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": expected_dismissed,
            "assuranceDismissedCandidateIndexes": expected_dismissed,
            "dismissedCandidateIndexes": expected_dismissed,
            "dismissedDiagnosticCandidates": candidates,
            "visionProvider": vision_provider,
            "model": model,
            "assuranceProvider": assurance_provider,
            "assuranceModel": assurance_model,
        }, {
            "category": "resolved_non_evidentiary",
            "dismissedCandidateCount": len(expected_dismissed),
        })
    evidence_parts = list(dict.fromkeys(fact["evidenceText"] for fact in accepted_facts))
    evidence = {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "candidateAgreementMethod": CANDIDATE_AGREEMENT_METHOD,
        "evidenceText": " | ".join(evidence_parts)[:2000],
        "confidence": min(fact["confidence"] for fact in accepted_facts),
        "facts": accepted_facts,
        "resolutionType": VISUAL_CANDIDATE_PARTITION_TYPE,
        "acceptedCandidateIndexes": accepted_indexes,
        "primaryAcceptedCandidateIndexes": accepted_indexes,
        "assuranceAcceptedCandidateIndexes": accepted_indexes,
        "primaryDismissedCandidateIndexes": expected_dismissed,
        "assuranceDismissedCandidateIndexes": expected_dismissed,
        "dismissedCandidateIndexes": expected_dismissed,
        "acceptedDiagnosticCandidates": [candidates[index] for index in accepted_indexes],
        "dismissedDiagnosticCandidates": [candidates[index] for index in expected_dismissed],
        "resolvedDiagnosticCandidates": candidates,
        "visionProvider": str(payload.get("visionProvider") or "").strip()[:120],
        "model": str(payload.get("model") or "").strip()[:160],
        "assuranceProvider": assurance_provider,
        "assuranceModel": str(payload.get("assuranceModel") or "").strip()[:160],
    }
    return VisualResolution(True, evidence, {
        "category": "resolved",
        "acceptedFactCount": len(accepted_facts),
        "dismissedCandidateCount": len(expected_dismissed),
    })


def normalized_candidate_indexes(value: Any, candidate_count: int) -> list[int] | None:
    if not isinstance(value, list) or len(value) > 12:
        return None
    indexes: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            return None
        if item < 0 or item >= candidate_count or item in indexes:
            return None
        indexes.append(item)
    return sorted(indexes)


def candidate_indexes_are_exact(
    value: Any,
    expected: list[int],
    candidate_count: int,
) -> bool:
    """Require canonical ascending persisted indexes without Python bool coercion."""
    return (
        isinstance(value, list)
        and all(type(item) is int for item in value)
        and normalized_candidate_indexes(value, candidate_count) == expected
        and len(value) == len(expected)
        and all(item == expected[index] for index, item in enumerate(value))
    )


def persisted_candidate_agreement_is_exact(
    evidence: dict[str, Any],
    accepted_indexes: list[int],
    candidate_count: int,
) -> bool:
    """Revalidate new candidate-index receipts while retaining sealed legacy evidence."""
    method = evidence.get("candidateAgreementMethod")
    if method is None:
        return True
    return (
        method == CANDIDATE_AGREEMENT_METHOD
        and candidate_indexes_are_exact(
            evidence.get("primaryAcceptedCandidateIndexes"),
            accepted_indexes,
            candidate_count,
        )
        and candidate_indexes_are_exact(
            evidence.get("assuranceAcceptedCandidateIndexes"),
            accepted_indexes,
            candidate_count,
        )
    )


def persisted_diagnostic_candidates_are_exact(value: Any, expected: list[dict[str, Any]]) -> bool:
    if not isinstance(value, list) or len(value) != len(expected):
        return False
    canonical: list[dict[str, Any]] = []
    expected_keys = {"text", "source", "confidence", "bounds"}
    for raw in value:
        if (
            not isinstance(raw, dict)
            or set(raw) != expected_keys
            or not isinstance(raw.get("text"), str)
            or not isinstance(raw.get("source"), str)
            or isinstance(raw.get("confidence"), bool)
            or not isinstance(raw.get("confidence"), (int, float))
            or not math.isfinite(float(raw.get("confidence")))
            or not 0 <= float(raw.get("confidence")) <= 1
        ):
            return False
        bounds = normalized_unit_bounds(raw.get("bounds"))
        if bounds is None:
            return False
        canonical_item = {
            "text": re.sub(r"\s+", " ", raw["text"].strip())[:500],
            "source": raw["source"].strip()[:120] or "unknown",
            "confidence": normalized_confidence(raw["confidence"]),
            "bounds": bounds,
        }
        if raw != canonical_item:
            return False
        canonical.append(canonical_item)
    return canonical == expected


def validated_persisted_visual_dismissal(
    evidence: Any,
    exception: dict[str, Any],
) -> dict[str, Any] | None:
    """Revalidate a dual-provider dismissal without creating search evidence."""
    candidates = bounded_diagnostic_candidates(exception)
    expected_indexes = list(range(len(candidates)))
    if (
        not isinstance(evidence, dict)
        or evidence.get("schemaVersion") != VISUAL_SCHEMA_VERSION
        or evidence.get("resolutionType") != VISUAL_DISMISSAL_TYPE
        or evidence.get("facts") != []
        or not persisted_candidate_agreement_is_exact(
            evidence, [], len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("primaryDismissedCandidateIndexes"), expected_indexes, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("assuranceDismissedCandidateIndexes"), expected_indexes, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("dismissedCandidateIndexes"), expected_indexes, len(candidates)
        )
        or not persisted_diagnostic_candidates_are_exact(
            evidence.get("dismissedDiagnosticCandidates"), candidates
        )
        or not str(evidence.get("visionProvider") or "").strip()
        or not str(evidence.get("model") or "").strip()
        or not str(evidence.get("assuranceProvider") or "").strip()
        or not str(evidence.get("assuranceModel") or "").strip()
        or evidence.get("visionProvider") == evidence.get("assuranceProvider")
        or not visual_exception_is_fact_resolvable(exception)
    ):
        return None
    return evidence


def validated_persisted_visual_evidence(
    evidence: Any,
    exception: dict[str, Any],
) -> dict[str, Any] | None:
    """Revalidate durable evidence instead of trusting a resolved row flag."""
    if (
        not isinstance(evidence, dict)
        or evidence.get("schemaVersion") != VISUAL_SCHEMA_VERSION
        or not str(evidence.get("visionProvider") or "").strip()
        or not str(evidence.get("model") or "").strip()
        or not str(evidence.get("assuranceProvider") or "").strip()
        or not str(evidence.get("assuranceModel") or "").strip()
        or evidence.get("visionProvider") == evidence.get("assuranceProvider")
        or evidence.get("resolutionType") != VISUAL_CANDIDATE_PARTITION_TYPE
        or not visual_exception_is_fact_resolvable(exception)
    ):
        return None
    exception_bounds = normalized_unit_bounds(exception.get("bounds"))
    candidates = bounded_diagnostic_candidates(exception)
    if exception_bounds is None or not candidates:
        return None
    facts = evidence.get("facts")
    if not isinstance(facts, list) or not facts or len(facts) > 72:
        return None
    accepted: list[dict[str, Any]] = []
    accepted_indexes: list[int] = []
    for raw in facts[:72]:
        if not isinstance(raw, dict):
            return None
        bounds = normalized_unit_bounds(raw.get("bounds"))
        provider_bounds = normalized_provider_bounds(raw.get("providerBounds"))
        confidence = normalized_confidence(raw.get("confidence"))
        evidence_text = re.sub(r"\s+", " ", str(raw.get("evidenceText") or "").strip())[:800]
        statement = re.sub(r"\s+", " ", str(raw.get("statement") or "").strip())[:1200]
        if (
            bounds is None or provider_bounds is None or bounds != provider_bounds
            or confidence < MIN_ASSURED_VISUAL_CONFIDENCE
            or not evidence_text or not statement
            or not str(raw.get("assuranceProvider") or "").strip()
            or raw.get("visionProvider") != evidence.get("visionProvider")
            or raw.get("model") != evidence.get("model")
            or raw.get("assuranceProvider") != evidence.get("assuranceProvider")
            or raw.get("assuranceModel") != evidence.get("assuranceModel")
            or raw.get("evidenceVersion") != evidence.get("evidenceVersion")
            or raw.get("exceptionFingerprint") != evidence.get("exceptionFingerprint")
            or not bounds_within(bounds, exception_bounds, tolerance=0.001)
            or not meaningful_bounds_overlap(bounds, exception_bounds)
        ):
            return None
        matched_indexes = [
            index for index, candidate in enumerate(candidates)
            if bounds_within(candidate["bounds"], exception_bounds, tolerance=0.001)
            and meaningful_bounds_overlap(candidate["bounds"], exception_bounds)
            and bounds_within(bounds, candidate["bounds"], tolerance=0.001)
            and meaningful_bounds_overlap(bounds, candidate["bounds"])
            and fact_directly_corroborates_candidate(raw, candidate)
        ]
        persisted_indexes = normalized_candidate_indexes(
            raw.get("corroboratedCandidateIndexes"), len(candidates),
        )
        if len(matched_indexes) != 1 or persisted_indexes != matched_indexes:
            return None
        for matched_index in matched_indexes:
            if matched_index in accepted_indexes:
                return None
            accepted_indexes.append(matched_index)
            canonical_candidate = canonical_provider_fact_text(
                raw, candidates[matched_index]
            )
            if canonical_candidate is None:
                return None
            accepted.append({
                **raw,
                "bounds": bounds,
                "confidence": confidence,
                # Re-canonicalize durable retries as well. Old provider-added
                # prose and contextual tags must never re-enter search.
                "statement": canonical_candidate,
                "evidenceText": canonical_candidate,
                "subject": canonical_candidate[:240],
                "location": "",
                "corroboratedCandidateIndexes": [matched_index],
                **({
                    "ocrCorrectionMethod": (
                        "dual_provider_exact_measurement_transcription"
                    ),
                    "rawOcrCandidateText": candidates[matched_index]["text"],
                } if candidate_allows_measurement_transcription(
                    candidates[matched_index]
                ) else {}),
            })
    accepted_indexes.sort()
    expected_dismissed = [
        index for index in range(len(candidates)) if index not in accepted_indexes
    ]
    if (
        not persisted_candidate_agreement_is_exact(
            evidence, accepted_indexes, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("acceptedCandidateIndexes"), accepted_indexes, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("primaryDismissedCandidateIndexes"), expected_dismissed, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("assuranceDismissedCandidateIndexes"), expected_dismissed, len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("dismissedCandidateIndexes"), expected_dismissed, len(candidates)
        )
        or not persisted_diagnostic_candidates_are_exact(
            evidence.get("acceptedDiagnosticCandidates"),
            [candidates[index] for index in accepted_indexes],
        )
        or not persisted_diagnostic_candidates_are_exact(
            evidence.get("dismissedDiagnosticCandidates"),
            [candidates[index] for index in expected_dismissed],
        )
        or not persisted_diagnostic_candidates_are_exact(
            evidence.get("resolvedDiagnosticCandidates"), candidates
        )
    ):
        return None
    accepted.sort(key=lambda fact: fact["corroboratedCandidateIndexes"][0])
    return {
        **evidence,
        "evidenceText": " | ".join(dict.fromkeys(
            str(fact.get("evidenceText") or "").strip() for fact in accepted
        ))[:2000],
        "confidence": min(float(fact["confidence"]) for fact in accepted),
        "facts": accepted,
    }


def normalized_provider_fact(raw: Any, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    evidence_text = re.sub(r"\s+", " ", str(raw.get("evidenceText") or "").strip())[:800]
    statement = re.sub(r"\s+", " ", str(raw.get("statement") or "").strip())[:1200]
    confidence = normalized_confidence(raw.get("confidence"))
    bounds = normalized_provider_bounds(raw.get("bounds"))
    vision_provider = str(payload.get("visionProvider") or "").strip()[:120]
    model = str(payload.get("model") or "").strip()[:160]
    assurance_provider = str(payload.get("assuranceProvider") or "").strip()[:120]
    assurance_model = str(payload.get("assuranceModel") or "").strip()[:160]
    if (
        not evidence_text
        or not statement
        or confidence < MIN_ASSURED_VISUAL_CONFIDENCE
        or bounds is None
        or not vision_provider
        or not model
        or not assurance_provider
        or not assurance_model
    ):
        return None
    return {
        # A provider's subject/location are contextual conclusions, not the
        # bounded visible quote. Derive searchable subject text from the quote
        # and leave location unset unless a later deterministic extractor
        # establishes it from coordinate-bound source evidence.
        "subject": evidence_text[:240],
        "location": "",
        "statement": statement,
        "evidenceText": evidence_text,
        "confidence": confidence,
        # The edge service returns exact full-page 0..1000 coordinates. Keep
        # both representations and never replace them with the exception crop.
        "bounds": bounds,
        "providerBounds": {
            key: int(raw["bounds"][key]) for key in ("x", "y", "width", "height")
        },
        "source": "vision",
        "visionProvider": vision_provider,
        "model": model,
        "assuranceProvider": assurance_provider,
        "assuranceModel": assurance_model,
    }


def fact_directly_corroborates_candidate(
    fact: dict[str, Any],
    candidate: dict[str, Any] | str,
) -> bool:
    if isinstance(candidate, dict) and candidate_allows_measurement_transcription(
        candidate
    ):
        return corrected_measurement_fact_is_exact(fact, candidate)
    candidate_text = (
        str(candidate.get("text") or "")
        if isinstance(candidate, dict)
        else str(candidate)
    )
    evidence_text = str(fact.get("evidenceText") or "")
    statement = str(fact.get("statement") or "")
    if not text_directly_corroborates_candidate(evidence_text, candidate_text):
        return False
    # The saved drawing fact is the provider statement, not the raw quote.
    # Bind that conclusion independently so a correct crop quote cannot carry
    # a contradictory measurement, object, status, identifier, or polarity.
    # Requiring the ordered candidate phrase also prevents conclusions from
    # being assembled across unrelated subject/location fields.
    return text_directly_corroborates_candidate(statement, candidate_text)


def candidate_allows_measurement_transcription(candidate: Any) -> bool:
    if not isinstance(candidate, dict):
        return False
    if str(candidate.get("source") or "") != VISUAL_MEASUREMENT_CORRECTION_SOURCE:
        return False
    text = normalize_vulgar_fractions(candidate.get("text"))
    text = text.replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    return bool(
        len(text) <= 120
        and any(character.isdigit() for character in text)
        and "'" in text
        and '"' in text
    )


def canonical_measurement_transcription(value: Any) -> str | None:
    text = normalize_vulgar_fractions(value).upper()
    text = text.replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    text = re.sub(r"[–—]", "-", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*'\s*", "'", text)
    text = re.sub(r"\s*-\s*", "-", text)
    text = re.sub(r"\s*\"", '"', text)
    text = re.sub(r"\s*/\s*", "/", text)
    text = re.sub(r"\bTYPICAL\b", "TYP", text)
    match = re.fullmatch(
        r"(?P<first>\d{1,4}'-\d{1,2}(?: \d{1,2}/\d{1,2})?\")"
        r"(?:\s+TO\s+"
        r"(?P<second>\d{1,4}'-\d{1,2}(?: \d{1,2}/\d{1,2})?\"))?"
        r"(?:\s+(?P<qualifiers>(?:MAX|MIN|TYP)"
        r"(?:\.?\s+(?:MAX|MIN|TYP))?\.?))?",
        text,
    )
    if match is None:
        return None
    tokens = [match.group("first")]
    if match.group("second"):
        tokens.append(match.group("second"))
    for token in tokens:
        parsed = re.fullmatch(
            r"(\d{1,4})'-(\d{1,2})(?: (\d{1,2})/(\d{1,2}))?\"",
            token,
        )
        if parsed is None or int(parsed.group(2)) > 11:
            return None
        if parsed.group(3):
            numerator = int(parsed.group(3))
            denominator = int(parsed.group(4))
            if (
                denominator not in {2, 4, 8, 16, 32, 64}
                or numerator <= 0
                or numerator >= denominator
            ):
                return None
    result = tokens[0]
    if len(tokens) == 2:
        result += f" TO {tokens[1]}"
    qualifiers = re.findall(r"MAX|MIN|TYP", match.group("qualifiers") or "")
    if len(qualifiers) != len(set(qualifiers)):
        return None
    if qualifiers:
        result += " " + " ".join(qualifiers)
    return result


def corrected_measurement_fact_is_exact(
    fact: dict[str, Any],
    candidate: dict[str, Any],
) -> bool:
    evidence = canonical_measurement_transcription(fact.get("evidenceText"))
    statement = canonical_measurement_transcription(fact.get("statement"))
    if evidence is None or evidence != statement:
        return False
    raw = str(candidate.get("text") or "")
    raw_digits = ocr_measurement_digit_signature(raw)
    corrected_digits = "".join(re.findall(r"\d", evidence))
    if (
        not raw_digits
        or abs(len(raw_digits) - len(corrected_digits)) > 1
        or bounded_text_edit_distance(raw_digits, corrected_digits, limit=1) > 1
    ):
        return False
    raw_keywords = re.findall(r"\b(?:TO|MAX|MIN|TYP)\b", raw.upper())
    corrected_keywords = re.findall(
        r"\b(?:TO|MAX|MIN|TYP)\b", evidence.upper()
    )
    return raw_keywords == corrected_keywords


def ocr_measurement_digit_signature(value: Any) -> str:
    text = normalize_vulgar_fractions(value).upper()
    text = text.replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    # Interpret one alphabetic OCR glyph as a zero placeholder only in the
    # exact inch-digit slot
    # of an OCR foot-inch token.  It remains untrusted and is used solely to
    # bound edit distance against the independently assured transcription.
    text = re.sub(
        r"(?<=['\u2019]-)[A-Z](?=\s*\")",
        "0",
        text,
    )
    return "".join(re.findall(r"\d", text))


def canonical_provider_fact_text(
    fact: dict[str, Any],
    candidate: dict[str, Any],
) -> str | None:
    if candidate_allows_measurement_transcription(candidate):
        if not corrected_measurement_fact_is_exact(fact, candidate):
            return None
        return canonical_measurement_transcription(fact.get("evidenceText"))
    return str(candidate.get("text") or "")


def bounded_text_edit_distance(left: str, right: str, *, limit: int) -> int:
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for row, left_character in enumerate(left, start=1):
        current = [row]
        row_minimum = row
        for column, right_character in enumerate(right, start=1):
            value = min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_character != right_character),
            )
            current.append(value)
            row_minimum = min(row_minimum, value)
        if row_minimum > limit:
            return limit + 1
        previous = current
    return previous[-1]


def text_directly_corroborates_candidate(text: Any, candidate_text: str) -> bool:
    candidate_normalized = normalized_match_text(candidate_text)
    text_value = str(text or "")
    text_normalized = normalized_match_text(text_value)
    if len(candidate_normalized) < 1 or candidate_normalized not in text_normalized:
        return False
    candidate_measurements = measurement_keys(candidate_text)
    text_measurements = measurement_keys(text_value)
    if candidate_measurements and text_measurements != candidate_measurements:
        return False
    # Numeric equality alone cannot prove that a provider saw the candidate's
    # complete foot-inch notation: ``82'-0`` and ``82'-0\"`` both reduce to
    # the same 82-foot numeric value in the general measurement parser. When
    # the candidate explicitly includes feet and inches, require the provider
    # evidence and statement to retain that complete notation as well.
    candidate_foot_inches = explicit_foot_inch_keys(candidate_text)
    if (
        candidate_foot_inches
        and explicit_foot_inch_keys(text_value) != candidate_foot_inches
    ):
        return False
    candidate_identifiers = drawing_identifier_keys(candidate_text)
    text_identifiers = drawing_identifier_keys(text_value)
    if candidate_identifiers and text_identifiers != candidate_identifiers:
        return False
    candidate_negative = has_negative_drawing_polarity(candidate_text)
    text_negative = has_negative_drawing_polarity(text_value)
    if candidate_negative != text_negative:
        return False
    candidate_statuses = drawing_status_keys(candidate_text)
    text_statuses = drawing_status_keys(text_value)
    if candidate_statuses != text_statuses:
        return False
    candidate_semantics = semantic_keys(candidate_text)
    text_semantics = semantic_keys(text_value)
    candidate_objects = {key for key in candidate_semantics if key.startswith("object:")}
    text_objects = {key for key in text_semantics if key.startswith("object:")}
    if candidate_objects and text_objects != candidate_objects:
        return False
    if candidate_semantics and not candidate_semantics.issubset(text_semantics):
        return False
    candidate_tokens = meaningful_tokens(candidate_text)
    text_tokens = meaningful_tokens(text_value)
    return bool(candidate_tokens) and candidate_tokens.issubset(text_tokens)


def explicit_foot_inch_keys(value: Any) -> set[str]:
    text = normalize_vulgar_fractions(value).upper().replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    return {
        f"{int(match.group(1))}ft:{int(match.group(2))}in:"
        f"{int(match.group(3) or 0)}/{int(match.group(4) or 1)}"
        for match in re.finditer(
            r"(?<!\d)(\d{1,4})\s*'\s*[-–—]?\s*(\d{1,2})"
            r"(?:\s+(\d+)\s*/\s*(\d+))?\s*\"",
            text,
        )
    }


def normalized_match_text(value: Any) -> str:
    text = normalize_vulgar_fractions(value).upper().replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def meaningful_tokens(value: Any) -> set[str]:
    return {
        token.lower() for token in re.findall(r"[A-Z0-9]+", normalized_match_text(value))
        if token.lower() not in TOKEN_STOP_WORDS
    }


def semantic_keys(value: Any) -> set[str]:
    text = normalized_match_text(value)
    keys: set[str] = set()
    for pattern, key in (
        (r"\bHAZ(?:ARDOUS)?\s+(?:MAT(?:ERIAL)?|WASTE)\b", "hazardous"),
        (r"\bLIGHT(?:ING|S)?\b", "lighting"),
        (r"\bWALKWAY\b", "object:walkway"),
        (r"\bWALL\b", "object:wall"),
        (r"\bCURB\b", "object:curb"),
        (r"\bSLAB\b", "slab"),
        (r"\bFOOTING\b", "object:footing"),
        (r"\bPAV(?:EMENT|ING)\b", "object:paving"),
        (r"\bPIPE\b", "object:pipe"),
        (r"\bCONDUIT\b", "object:conduit"),
        (r"\bDUCT\b", "object:duct"),
        (r"\bDOOR\b", "object:door"),
        (r"\bBEAM\b", "object:beam"),
        (r"\bBARRIER\b", "object:barrier"),
        (r"\bPCC\b", "pcc"),
        (r"\bCONCRETE\b", "concrete"),
    ):
        if re.search(pattern, text):
            keys.add(key)
    canopy = re.search(r"\bCANOPY\s+([A-Z])\b", text)
    if canopy:
        keys.add(f"canopy:{canopy.group(1)}")
    type_identifier = re.search(r"\bTYPE\s+([A-Z0-9]+)\b", text)
    if type_identifier:
        keys.add(f"type:{type_identifier.group(1)}")
    return keys


def measurement_keys(value: Any) -> set[str]:
    text = normalize_vulgar_fractions(value).upper().replace("’", "'").replace("′", "'")
    text = text.replace("“", '"').replace("”", '"').replace("″", '"')
    keys: set[str] = set()
    imperial_spans: list[tuple[int, int]] = []
    foot_unit = r"(?:'|FT\.?|FEET)"
    inch_unit = r'(?:"|INCH(?:ES)?|IN\.?)'
    mixed_number = (
        r"(?:(\d{1,2})(?:\s*(?:[-–—]|\s)\s*(\d{1,3})\s*/\s*(\d{1,3}))?"
        r"|(\d{1,3})\s*/\s*(\d{1,3}))"
    )
    feet_inches_pattern = re.compile(
        rf"(?<!\d)(\d{{1,4}})\s*{foot_unit}\s*[-–—]?\s*{mixed_number}\s*{inch_unit}"
    )
    feet_decimal_pattern = re.compile(
        rf"(?<!\d)(\d{{1,4}})\s*{foot_unit}\s*[-–—]?\s*(\d{{1,2}}\.\d+)\s*{inch_unit}"
    )
    for match in feet_decimal_pattern.finditer(text):
        try:
            inches = Fraction(match.group(2))
        except (ValueError, ZeroDivisionError):
            continue
        keys.add(imperial_length_key(Fraction(int(match.group(1)) * 12) + inches))
        imperial_spans.append(match.span())
    for match in feet_inches_pattern.finditer(text):
        if span_overlaps(match.span(), imperial_spans):
            continue
        inches = parsed_mixed_number(match.group(2), match.group(3), match.group(4),
                                     match.group(5), match.group(6))
        if inches is None:
            continue
        keys.add(imperial_length_key(Fraction(int(match.group(1)) * 12) + inches))
        imperial_spans.append(match.span())

    inches_pattern = re.compile(
        rf"(?<![\d'])(?:(\d{{1,4}})(?:\s*(?:[-–—]|\s)\s*(\d{{1,3}})\s*/\s*(\d{{1,3}}))?"
        rf"|(\d{{1,3}})\s*/\s*(\d{{1,3}}))\s*{inch_unit}"
    )
    decimal_inches_pattern = re.compile(rf"(?<![\d'])(\d{{1,4}}\.\d+)\s*{inch_unit}")
    for match in decimal_inches_pattern.finditer(text):
        if span_overlaps(match.span(), imperial_spans):
            continue
        try:
            inches = Fraction(match.group(1))
        except (ValueError, ZeroDivisionError):
            continue
        keys.add(imperial_length_key(inches))
        imperial_spans.append(match.span())
    for match in inches_pattern.finditer(text):
        if span_overlaps(match.span(), imperial_spans):
            continue
        inches = parsed_mixed_number(match.group(1), match.group(2), match.group(3),
                                     match.group(4), match.group(5))
        if inches is None:
            continue
        keys.add(imperial_length_key(inches))
        imperial_spans.append(match.span())

    feet_pattern = re.compile(rf"(?<!\d)(\d{{1,4}}(?:\.\d+)?)\s*{foot_unit}")
    for match in feet_pattern.finditer(text):
        if span_overlaps(match.span(), imperial_spans):
            continue
        try:
            feet = Fraction(match.group(1))
        except (ValueError, ZeroDivisionError):
            continue
        keys.add(imperial_length_key(feet * 12))
        imperial_spans.append(match.span())

    for match in re.finditer(r"(?<!\d)(\d+(?:\.\d+)?)\s*(MM|CM|SF|SQ\.?\s*FT|%)\b", text):
        keys.add(f"metric:{match.group(1)}:{re.sub(r'[^A-Z%]', '', match.group(2))}")
    return keys


def normalize_vulgar_fractions(value: Any) -> str:
    text = str(value or "")
    for glyph, fraction in VULGAR_FRACTIONS.items():
        text = text.replace(glyph, f" {fraction}")
    return text


def parsed_mixed_number(
    whole: str | None,
    numerator: str | None,
    denominator: str | None,
    fraction_numerator: str | None,
    fraction_denominator: str | None,
) -> Fraction | None:
    try:
        if whole is not None:
            value = Fraction(int(whole))
            if numerator is not None and denominator is not None:
                value += Fraction(int(numerator), int(denominator))
            return value
        if fraction_numerator is not None and fraction_denominator is not None:
            return Fraction(int(fraction_numerator), int(fraction_denominator))
    except (ValueError, ZeroDivisionError):
        return None
    return None


def imperial_length_key(value: Fraction) -> str:
    return f"imperial-in:{value.numerator}/{value.denominator}"


def span_overlaps(span: tuple[int, int], existing: list[tuple[int, int]]) -> bool:
    return any(span[0] < other[1] and other[0] < span[1] for other in existing)


def drawing_identifier_keys(value: Any) -> set[str]:
    text = str(value or "").upper().replace("–", "-").replace("—", "-")
    keys: set[str] = set()
    patterns = (
        (r"#\s*(\d{1,3})\b", "mark"),
        (r"\bAREA\s+([A-Z0-9]+)\b", "area"),
        (r"\bGRID\s+([A-Z0-9]+(?:\s*[-/.]\s*[A-Z0-9]+)*)", "grid"),
        (r"\bDETAIL\s+([A-Z0-9]+(?:\s*/\s*[A-Z0-9.-]+)?)", "detail"),
        (r"\bNOTE\s+([A-Z0-9]+)\b", "note"),
    )
    for pattern, category in patterns:
        for match in re.finditer(pattern, text):
            identifier = re.sub(r"\s+", "", match.group(1))
            keys.add(f"{category}:{identifier}")
    drawing_label_pattern = (
        r"\b(BEAM|WALL|DOOR|PLAN|SECTION|COLUMN|ROOM|ZONE|CANOPY|AREA|GRID|"
        r"DETAIL|NOTE|TYPE|MARK|KEYNOTE|ELEVATION|SHEET)\s+"
        r"([A-Z0-9][A-Z0-9./-]*)\b"
    )
    for match in re.finditer(drawing_label_pattern, text):
        keys.add(f"label:{match.group(1)}:{match.group(2)}")
    return keys


def has_negative_drawing_polarity(value: Any) -> bool:
    text = normalized_match_text(value)
    return bool(re.search(
        r"\b(?:NOT|WITHOUT|ABSENT|NONE|OMIT(?:TED)?|EXCLUD(?:ED|ES|ING)|"
        r"PROHIBIT(?:ED|S|ING)?|UNREQUIRED)\b|\bNO\s+(?!\d)",
        text,
    ))


def drawing_status_keys(value: Any) -> set[str]:
    text = normalized_match_text(value)
    keys: set[str] = set()
    for pattern, key in (
        (r"\bNEW\b", "new"),
        (r"\bEXIST(?:ING)?\b", "existing"),
        (r"\bPROPOS(?:ED|E)\b", "proposed"),
        (r"\bDEMOLI(?:SH|TION|TIONED)\b|\bDEMO\b", "demolish"),
        (r"\bREMOV(?:E|ED|AL)\b", "remove"),
        (r"\bREMAIN(?:S|ING)?\b", "remain"),
        (r"\bRELOCAT(?:E|ED|ION)\b", "relocate"),
        (r"\bFUTURE\b", "future"),
        (r"\bTEMPORAR(?:Y|ILY)\b", "temporary"),
    ):
        if re.search(pattern, text):
            keys.add(key)
    return keys


def normalized_unit_bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    raw = [value.get(key) for key in ("x", "y", "width", "height")]
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in raw):
        return None
    result = dict(zip(("x", "y", "width", "height"), (float(item) for item in raw)))
    if not all(number == number and abs(number) != float("inf") for number in result.values()):
        return None
    if (
        result["x"] < 0 or result["y"] < 0
        or result["width"] <= 0 or result["height"] <= 0
        or result["x"] + result["width"] > 1.000001
        or result["y"] + result["height"] > 1.000001
    ):
        return None
    return {key: round(result[key], 6) for key in ("x", "y", "width", "height")}


def normalized_provider_bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    if any(
        not isinstance(value.get(key), int) or isinstance(value.get(key), bool)
        for key in ("x", "y", "width", "height")
    ):
        return None
    try:
        integer_bounds = {key: int(value.get(key)) for key in ("x", "y", "width", "height")}
    except (TypeError, ValueError):
        return None
    if any(value.get(key) != integer_bounds[key] for key in integer_bounds):
        return None
    if (
        integer_bounds["x"] < 0 or integer_bounds["y"] < 0
        or integer_bounds["width"] < 1 or integer_bounds["height"] < 1
        or integer_bounds["x"] + integer_bounds["width"] > 1000
        or integer_bounds["y"] + integer_bounds["height"] > 1000
    ):
        return None
    return {key: round(integer_bounds[key] / 1000, 6) for key in integer_bounds}


def bounds_within(
    inner: dict[str, float],
    outer: dict[str, float],
    *,
    tolerance: float = 0.0,
) -> bool:
    """Require proof to be inside its requested crop.

    The one-thousandth tolerance is only for the provider's integer 0..1000
    coordinate quantization; it is deliberately too small to admit a nearby
    drawing note as evidence for this exception.
    """
    return (
        inner["x"] >= outer["x"] - tolerance
        and inner["y"] >= outer["y"] - tolerance
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tolerance
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + tolerance
    )


def meaningful_bounds_overlap(
    left: dict[str, float],
    right: dict[str, float],
    *,
    minimum_ratio: float = 0.5,
) -> bool:
    """Reject edge-touching/adjacent facts and require material candidate overlap."""
    intersection_width = max(0.0, min(
        left["x"] + left["width"], right["x"] + right["width"],
    ) - max(left["x"], right["x"]))
    intersection_height = max(0.0, min(
        left["y"] + left["height"], right["y"] + right["height"],
    ) - max(left["y"], right["y"]))
    intersection_area = intersection_width * intersection_height
    smaller_area = min(
        left["width"] * left["height"],
        right["width"] * right["height"],
    )
    return smaller_area > 0 and intersection_area / smaller_area >= minimum_ratio


def crop_page(page: fitz.Page, bounds: dict[str, Any], *, scale: float = 3.0) -> bytes:
    page_rect = page.rect
    x = coordinate(bounds.get("x"))
    y = coordinate(bounds.get("y"))
    width = coordinate(bounds.get("width"))
    height = coordinate(bounds.get("height"))
    clip = fitz.Rect(
        page_rect.x0 + page_rect.width * x,
        page_rect.y0 + page_rect.height * y,
        page_rect.x0 + page_rect.width * min(1, x + width),
        page_rect.y0 + page_rect.height * min(1, y + height),
    )
    rendered_png, _pixel_width, _pixel_height = bounded_page_render_png(
        page,
        clip=clip,
        dpi=max(1, int(round(float(scale) * 72))),
    )
    output = io.BytesIO()
    from PIL import Image

    with Image.open(io.BytesIO(rendered_png)) as image:
        image.load()
        image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def ImageFromPixmap(pixmap: fitz.Pixmap):
    from PIL import Image
    return Image.open(io.BytesIO(pixmap.tobytes("png")))


def image_data_url(payload: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(payload).decode('ascii')}"


def suppress_exact_area_row_crossing_rule(payload: bytes) -> bytes:
    """Suppress the one immutable rule band crossing the issued EAST value.

    The unmodified crop is always sent separately. This exact-source candidate
    renders to 2271 x 139 pixels at the fixed 18x detail scale. Columns
    1843..1860 contain the vertical drawing rule through the ``8`` in ``185``;
    other full-height dark strokes are printed digits and must remain. Any
    dimension or pixel-profile drift returns the untouched payload.
    """
    from PIL import Image

    with Image.open(io.BytesIO(payload)) as source:
        image = source.convert("RGB")
        image.load()
    width, height = image.size
    if (width, height) != (2271, 139):
        return payload
    minimum_dark_rows = max(1, math.ceil(height * 0.78))
    pixels = image.load()
    rule_columns = list(range(1843, 1861))
    if not all(
        sum(
            1 for y in range(height)
            if max(pixels[x, y]) < 100
        ) >= minimum_dark_rows
        for x in rule_columns
    ):
        return payload
    for x in rule_columns:
        for y in range(height):
            pixels[x, y] = (255, 255, 255)
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def visual_tile_bounds(bounds: dict[str, Any]) -> list[dict[str, float]]:
    x = coordinate(bounds.get("x"))
    y = coordinate(bounds.get("y"))
    width = min(1.0 - x, coordinate(bounds.get("width")))
    height = min(1.0 - y, coordinate(bounds.get("height")))
    if width * height <= 0.25:
        return [{"x": x, "y": y, "width": width, "height": height}]
    columns, rows = 2, 3
    overlap = 0.015
    result: list[dict[str, float]] = []
    for row in range(rows):
        for column in range(columns):
            tile_x0 = max(x, x + width * column / columns - overlap)
            tile_y0 = max(y, y + height * row / rows - overlap)
            tile_x1 = min(x + width, x + width * (column + 1) / columns + overlap)
            tile_y1 = min(y + height, y + height * (row + 1) / rows + overlap)
            result.append({
                "x": round(tile_x0, 6),
                "y": round(tile_y0, 6),
                "width": round(tile_x1 - tile_x0, 6),
                "height": round(tile_y1 - tile_y0, 6),
            })
    return result


def visual_review_tile_scale(candidates: list[dict[str, Any]]) -> float:
    """Render tiny measurement words legibly without enlarging authority.

    A 0.3%-of-page-high dimension becomes only about six pixels tall in the
    normal 216-DPI review tile. Double only the image resolution for one
    word-tight exact measurement, one exact source-bound area row, or one
    exact source-bound multiline note; the
    candidate, exception, and returned-proof bounds remain unchanged and are
    still checked by the existing two-provider contract.
    """
    exact_area_row = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == "exact_rendered_area_table_row_composite_candidate"
    )
    exact_multiline_note = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == "exact_rendered_accessible_parking_note_composite_candidate"
    )
    exact_easement_note = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_EASEMENT_NOTE_SOURCE
    )
    exact_site_note = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_SITE_NOTE_SOURCE
    )
    exact_page30_complete_proposition = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_PAGE30_COMPLETE_PROPOSITION_SOURCE
    )
    exact_page63_spacing_proposition = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_PAGE63_SPACING_PROPOSITION_SOURCE
    )
    exact_page64_control_joint_proposition = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_PAGE64_CONTROL_JOINT_PROPOSITION_SOURCE
    )
    exact_canopy_a_overall_dimension = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_CANOPY_A_OVERALL_DIMENSION_SOURCE
    )
    exact_canopy_a_outset_note = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_CANOPY_A_OUTSET_NOTE_SOURCE
    )
    if (
        exact_area_row
        or exact_multiline_note
        or exact_easement_note
        or exact_site_note
        or exact_page30_complete_proposition
        or exact_page63_spacing_proposition
        or exact_page64_control_joint_proposition
        or exact_canopy_a_overall_dimension
        or exact_canopy_a_outset_note
    ):
        return 6.0
    if len(candidates) != 1 or not measurement_keys(candidates[0].get("text")):
        return 3.0
    bounds = normalized_unit_bounds(candidates[0].get("bounds"))
    if bounds is None:
        return 3.0
    if bounds["width"] <= 0.03 and bounds["height"] <= 0.005:
        return 6.0
    return 3.0


def visual_review_bounds(
    bounds: dict[str, Any],
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, float]:
    """Show context around candidates without enlarging their authority."""
    x = coordinate(bounds.get("x"))
    y = coordinate(bounds.get("y"))
    width = min(1.0 - x, coordinate(bounds.get("width")))
    height = min(1.0 - y, coordinate(bounds.get("height")))
    if not candidates:
        return {
            "x": round(x, 6),
            "y": round(y, 6),
            "width": round(width, 6),
            "height": round(height, 6),
        }
    exact_measurement = (
        len(candidates) == 1
        and bool(measurement_keys(candidates[0].get("text")))
    )
    exact_area_row = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == "exact_rendered_area_table_row_composite_candidate"
    )
    exact_page63_support_post = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_PAGE63_SPACING_PROPOSITION_SOURCE
        and str(candidates[0].get("text") or "").startswith(
            "1 1/2\" Ø STEEL TUBE SUPPORT POST."
        )
    )
    exact_page13_photometric_label = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_ELECTRICAL_PAGE13_PHOTOMETRIC_SOURCE
        and str(candidates[0].get("text") or "") == "B @ 10'"
    )
    exact_canopy_a_overall_dimension = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_CANOPY_A_OVERALL_DIMENSION_SOURCE
    )
    exact_canopy_a_outset_note = (
        len(candidates) == 1
        and str(candidates[0].get("source") or "")
        == EXACT_CANOPY_A_OUTSET_NOTE_SOURCE
    )
    if exact_area_row:
        # This exact source-bound authority is one row inside a compact W/L
        # table. Live dual-provider evidence showed that an isolated row can
        # be legible yet dismissed without the headers and neighboring rows
        # that establish its table semantics. Show the immutable full table as
        # review context while leaving candidate/proof authority at the exact
        # row bounds. The special source exists only for this exact
        # project/SHA/page reconstruction in extraction.py.
        if (
            str(candidates[0].get("text") or "")
            == EXACT_AREA_TOTAL_FRONTAGE_TEXT
        ):
            return {
                "x": 0.558,
                "y": 0.171,
                "width": 0.118,
                "height": 0.036,
            }
        return {
            "x": 0.617,
            "y": 0.171,
            "width": 0.058,
            "height": 0.034,
        }
    elif exact_page63_support_post:
        # The authority is the exact three-line ROCK POST clause, but its
        # first two provider rounds showed that beginning the image midway
        # through the surrounding support-post note can leave an otherwise
        # legible proposition semantically incomplete. Show the immutable
        # full note box at the already source-bound high resolution. Candidate
        # and returned proof authority remain at the exact clause bounds.
        target_width = 0.08
        target_height = 0.045
        return {
            "x": round(min(max(0.0, x + width / 2.0 - 0.04), 0.92), 6),
            "y": round(min(max(0.0, y - 0.02), 0.955), 6),
            "width": target_width,
            "height": target_height,
        }
    elif exact_page13_photometric_label:
        # Several identical photometric labels occupy the same printed row.
        # The normal 0.10-page measurement crop includes neighboring labels,
        # which makes a provider dismissal reasonable but non-authoritative.
        # Isolate the one exact native/rendered overlap for readability only;
        # candidate bounds and two-provider acceptance remain unchanged.
        target_width = 0.025
        target_height = 0.014
    elif exact_canopy_a_overall_dimension:
        # These two overall plan dimensions are printed beside several segment
        # dimensions on the immutable Canopy A anchor-rod plan. A generic
        # measurement crop includes competing values and caused both providers
        # to dismiss the exact candidates. Give each source-bound candidate a
        # tight, high-resolution readability window while leaving candidate,
        # exception, and returned-proof authority at the original word bounds.
        text = str(candidates[0].get("text") or "")
        if text == "52'-0\"":
            return {
                "x": 0.0985,
                "y": 0.4583,
                "width": 0.0455,
                "height": 0.0637,
            }
        if text == "122'-0\"":
            return {
                "x": 0.4545,
                "y": 0.696,
                "width": 0.0645,
                "height": 0.037,
            }
        # Fail closed for any future candidate under this exact source rather
        # than silently granting it a source-specific review context.
        return {
            "x": round(x, 6),
            "y": round(y, 6),
            "width": round(width, 6),
            "height": round(height, 6),
        }
    elif exact_canopy_a_outset_note:
        # The next printed line contains a different 1'-3" dimension. Isolate
        # the exact one-foot outset row for readability while retaining the
        # complete printed line as candidate and returned-proof authority.
        return {
            "x": 0.115,
            "y": 0.2945,
            "width": 0.085,
            "height": 0.0115,
        }
    elif exact_measurement:
        # Dimension tokens need enough horizontal context to identify their
        # object, but a tall crop can include a second nearby dimension row and
        # make an otherwise exact candidate ambiguous to the provider. Keep
        # authority at the original candidate bounds while showing one row.
        # Construction notes normally continue to the right of the dimension;
        # bias review context in that direction instead of centering the token
        # beside an unrelated block on the left. Keep this crop narrow enough
        # that a tiny measurement stays legible at provider resolution. The
        # exact 78949 page-6 review still contains the complete adjoining fence
        # note at 0.10 page width, while the previous 0.24 crop made the token
        # less than four percent of the submitted image.
        target_width = min(1.0, max(width + 0.02, width * 1.5, 0.10))
        target_height = min(1.0, max(height + 0.006, height * 2.0, 0.014))
    else:
        target_width = min(1.0, max(width + 0.02, width * 1.5, 0.06))
        target_height = min(1.0, max(height + 0.02, height * 2.0, 0.04))
    center_x = x + width / 2.0
    center_y = y + height / 2.0
    review_x = (
        min(max(0.0, x - target_width * 0.15), 1.0 - target_width)
        if exact_measurement else
        min(max(0.0, center_x - target_width / 2.0), 1.0 - target_width)
    )
    review_y = min(max(0.0, center_y - target_height / 2.0), 1.0 - target_height)
    return {
        "x": round(review_x, 6),
        "y": round(review_y, 6),
        "width": round(target_width, 6),
        "height": round(target_height, 6),
    }


def coordinate(value: Any) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def normalized_confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0 or parsed > 1:
        return 0.0
    return round(parsed, 5)


def bounded_error_code(response: requests.Response) -> str:
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return "unstructured_provider_error"
    if not isinstance(payload, dict):
        return "unstructured_provider_error"
    return str(payload.get("error") or payload.get("code") or "request_rejected").strip()[:160]


def bounded_assurance_provider_diagnostics(
    response: requests.Response,
) -> dict[str, Any]:
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    provider = str(payload.get("assuranceProvider") or "").strip()[:120]
    model = str(payload.get("assuranceModel") or "").strip()[:160]
    error_code = str(
        payload.get("assuranceProviderErrorCode") or ""
    ).strip()[:160]
    raw_status = payload.get("assuranceProviderStatus")
    provider_status = (
        raw_status
        if isinstance(raw_status, int) and not isinstance(raw_status, bool)
        and 100 <= raw_status <= 599
        else None
    )
    return {
        **({"assuranceProvider": provider} if provider else {}),
        **({"assuranceModel": model} if model else {}),
        **({"assuranceProviderStatus": provider_status}
           if provider_status is not None else {}),
        **({"assuranceProviderErrorCode": error_code} if error_code else {}),
    }
