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

import pymupdf as fitz
import requests
from .measurement_correction import CORRECTION_SOURCE, AGREEMENT_KEYS, corrected_measurement_text


VISUAL_SCHEMA_VERSION = "ecos-drawing-page-analysis/2.0"
VISUAL_DISMISSAL_TYPE = "independently_unverifiable_candidates"
CANDIDATE_AGREEMENT_METHOD = "dual_provider_candidate_index_v1"
VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION = "ecos-visual-provider-operation/1.0"
MIN_ASSURED_VISUAL_CONFIDENCE = 0.85
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
CANONICAL_UUID = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
)
LOWER_SHA256 = re.compile(r"^[a-f0-9]{64}$")
EVIDENCE_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$")
VISUAL_REGION_KEY_PATTERN = re.compile(r"^[\x21-\x7e]{1,300}$")


@dataclass(frozen=True)
class VisualResolution:
    resolved: bool
    evidence: dict[str, Any]
    internal_diagnostics: dict[str, Any]


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
        reason = str(exception.get("reason") or "").strip()[:1000]
        operation_identity = visual_provider_operation_identity(context, exception)
        if operation_identity is None:
            return VisualResolution(False, {}, {
                "category": "visual_operation_identity_invalid",
            })
        overview = crop_page(page, bounds, scale=1.25)
        tile_bounds = visual_tile_bounds(bounds)
        tiles = [
            {
                "bounds": tile,
                "imageDataUrl": image_data_url(crop_page(page, tile, scale=3.0)),
            }
            for tile in tile_bounds
        ]
        response = requests.post(
            self.endpoint,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            json={
                "schemaVersion": VISUAL_SCHEMA_VERSION,
                **operation_identity,
                "pageNumber": int(context.get("pageNumber") or 1),
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
                "tileBounds": bounds,
                "tileImages": tiles,
            },
            timeout=(10, 90),
        )
        if response.status_code >= 500 or response.status_code == 429:
            return VisualResolution(False, {}, {"category": "visual_service_temporarily_unavailable", "status": response.status_code})
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


def visual_provider_operation_identity(
    context: dict[str, Any],
    exception: dict[str, Any],
) -> dict[str, Any] | None:
    """Build the exact protected identity required by the visual provider.

    The digest deliberately matches the TypeScript edge-function contract:
    sorted ASCII JSON with compact separators and the schema version included.
    It binds every paid provider attempt to one live hosted-job claim and one
    exact visual exception, preventing stale or cross-project replay.
    """
    try:
        page_number = int(context.get("pageNumber"))
    except (TypeError, ValueError):
        return None
    if isinstance(context.get("pageNumber"), bool) or not 1 <= page_number <= 10_000:
        return None

    identity = {
        "organizationId": exact_ascii_text(context.get("organizationId"), 500),
        "projectId": exact_ascii_text(context.get("projectId"), 500),
        "documentId": exact_ascii_text(context.get("documentId"), 200),
        "sourceSha256": exact_ascii_text(context.get("sourceSha256"), 64).lower(),
        "pageNumber": page_number,
        "hostedJobId": exact_ascii_text(context.get("hostedJobId"), 36).lower(),
        "hostedClaimToken": exact_ascii_text(context.get("hostedClaimToken"), 36).lower(),
        "evidenceVersion": exact_ascii_text(context.get("evidenceVersion"), 120),
        "visualExceptionFingerprint": visual_exception_fingerprint(exception),
        "visualRegionKey": exact_ascii_text(exception.get("regionKey"), 300),
    }
    if (
        not identity["organizationId"]
        or not identity["projectId"]
        or not identity["documentId"]
        or not LOWER_SHA256.fullmatch(identity["sourceSha256"])
        or not CANONICAL_UUID.fullmatch(identity["hostedJobId"])
        or not CANONICAL_UUID.fullmatch(identity["hostedClaimToken"])
        or not EVIDENCE_VERSION_PATTERN.fullmatch(identity["evidenceVersion"])
        or not LOWER_SHA256.fullmatch(identity["visualExceptionFingerprint"])
        or not VISUAL_REGION_KEY_PATTERN.fullmatch(identity["visualRegionKey"])
    ):
        return None
    canonical = {
        **identity,
        "schemaVersion": VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION,
    }
    provider_operation_id = hashlib.sha256(
        json.dumps(
            canonical,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode("utf-8")
    ).hexdigest()
    return {**identity, "providerOperationId": provider_operation_id}


def exact_ascii_text(value: Any, maximum_length: int) -> str:
    if not isinstance(value, str):
        return ""
    if not 1 <= len(value) <= maximum_length:
        return ""
    if any(ord(character) < 0x20 or ord(character) > 0x7E for character in value):
        return ""
    if not any(0x21 <= ord(character) <= 0x7E for character in value):
        return ""
    return value


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
        not vision_provider
        or not model
        or not assurance_provider
        or not assurance_model
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

    accepted_facts: list[dict[str, Any]] = []
    raw_facts = payload.get("facts") if isinstance(payload.get("facts"), list) else []
    correction = any(candidate.get("source") == CORRECTION_SOURCE for candidate in candidates)
    if correction and raw_facts and (len(candidates) != 1 or len(raw_facts) != 1):
        return VisualResolution(False, {}, {"category": "visual_correction_contract_invalid"})
    for raw_fact in raw_facts[:72]:
        fact = normalized_provider_fact(raw_fact, payload)
        if (
            not fact
            or not bounds_within(fact["bounds"], exception_bounds, tolerance=0.001)
            or not meaningful_bounds_overlap(fact["bounds"], exception_bounds)
        ):
            continue
        matched_indexes = [
            index for index, candidate in enumerate(candidates)
            if bounds_within(candidate["bounds"], exception_bounds, tolerance=0.001)
            and meaningful_bounds_overlap(candidate["bounds"], exception_bounds)
            and bounds_within(fact["bounds"], candidate["bounds"], tolerance=0.001)
            and meaningful_bounds_overlap(fact["bounds"], candidate["bounds"])
            and candidate_fact_text(fact, candidate, payload) is not None
        ]
        if not matched_indexes:
            continue
        for matched_index in matched_indexes:
            canonical_candidate = candidate_fact_text(fact, candidates[matched_index], payload)
            accepted_facts.append({
                **fact,
                # The provider is allowed to help read the crop, but it is not
                # allowed to append conclusions to the durable project fact.
                # Ordinary candidates retain their exact text; the explicit
                # correction contract retains the independently agreed
                # transcription, never the damaged OCR or added conclusions.
                "statement": canonical_candidate,
                "evidenceText": canonical_candidate,
                "subject": canonical_candidate[:240],
                "location": "",
                "corroboratedCandidateIndexes": [matched_index],
            })

    if not accepted_facts:
        expected_indexes = list(range(len(candidates)))
        exact_dismissal = (
            isinstance(payload.get("facts"), list)
            and len(payload["facts"]) == 0
            and payload.get("candidateAgreementMethod") == CANDIDATE_AGREEMENT_METHOD
            and payload.get("primaryAcceptedCandidateIndexesValid") is True
            and payload.get("assuranceAcceptedCandidateIndexesValid") is True
            and payload.get("primaryDismissedCandidateIndexesValid") is True
            and payload.get("assuranceDismissedCandidateIndexesValid") is True
            and candidate_indexes_are_exact(
                payload.get("primaryAcceptedCandidateIndexes"), [], len(candidates)
            )
            and candidate_indexes_are_exact(
                payload.get("assuranceAcceptedCandidateIndexes"), [], len(candidates)
            )
            and candidate_indexes_are_exact(
                payload.get("primaryDismissedCandidateIndexes"),
                expected_indexes,
                len(candidates),
            )
            and candidate_indexes_are_exact(
                payload.get("assuranceDismissedCandidateIndexes"),
                expected_indexes,
                len(candidates),
            )
            and candidate_indexes_are_exact(
                payload.get("dismissedCandidateIndexes"),
                expected_indexes,
                len(candidates),
            )
        )
        if not exact_dismissal:
            return VisualResolution(False, {}, {
                "category": "visual_evidence_unrelated_or_misaligned",
            })
        return VisualResolution(True, {
            "schemaVersion": VISUAL_SCHEMA_VERSION,
            "candidateAgreementMethod": CANDIDATE_AGREEMENT_METHOD,
            "resolutionType": VISUAL_DISMISSAL_TYPE,
            "facts": [],
            "primaryAcceptedCandidateIndexes": [],
            "assuranceAcceptedCandidateIndexes": [],
            "primaryDismissedCandidateIndexes": expected_indexes,
            "assuranceDismissedCandidateIndexes": expected_indexes,
            "dismissedCandidateIndexes": expected_indexes,
            "dismissedDiagnosticCandidates": candidates,
            "visionProvider": vision_provider,
            "model": model,
            "assuranceProvider": assurance_provider,
            "assuranceModel": assurance_model,
        }, {
            "category": "resolved_non_evidentiary",
            "dismissedCandidateCount": len(expected_indexes),
        })
    evidence_parts = list(dict.fromkeys(fact["evidenceText"] for fact in accepted_facts))
    evidence = {
        "schemaVersion": VISUAL_SCHEMA_VERSION,
        "evidenceText": " | ".join(evidence_parts)[:2000],
        "confidence": min(fact["confidence"] for fact in accepted_facts),
        "facts": accepted_facts,
        "visionProvider": str(payload.get("visionProvider") or "").strip()[:120],
        "model": str(payload.get("model") or "").strip()[:160],
        "assuranceProvider": assurance_provider,
        "assuranceModel": str(payload.get("assuranceModel") or "").strip()[:160],
    }
    if correction:
        evidence["measurementCorrectionAgreement"] = {key: payload.get(key) for key in AGREEMENT_KEYS}
    return VisualResolution(True, evidence, {
        "category": "resolved",
        "acceptedFactCount": len(accepted_facts),
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
    return (
        isinstance(value, list)
        and all(type(item) is int for item in value)
        and normalized_candidate_indexes(value, candidate_count) == expected
        and len(value) == len(expected)
        and all(item == expected[index] for index, item in enumerate(value))
    )


def persisted_diagnostic_candidates_are_exact(
    value: Any,
    expected: list[dict[str, Any]],
) -> bool:
    if not isinstance(value, list) or len(value) != len(expected):
        return False
    canonical: list[dict[str, Any]] = []
    for raw in value:
        if (
            not isinstance(raw, dict)
            or set(raw) != {"text", "source", "confidence", "bounds"}
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
        or evidence.get("candidateAgreementMethod") != CANDIDATE_AGREEMENT_METHOD
        or evidence.get("resolutionType") != VISUAL_DISMISSAL_TYPE
        or evidence.get("facts") != []
        or not candidate_indexes_are_exact(
            evidence.get("primaryAcceptedCandidateIndexes"), [], len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("assuranceAcceptedCandidateIndexes"), [], len(candidates)
        )
        or not candidate_indexes_are_exact(
            evidence.get("primaryDismissedCandidateIndexes"),
            expected_indexes,
            len(candidates),
        )
        or not candidate_indexes_are_exact(
            evidence.get("assuranceDismissedCandidateIndexes"),
            expected_indexes,
            len(candidates),
        )
        or not candidate_indexes_are_exact(
            evidence.get("dismissedCandidateIndexes"),
            expected_indexes,
            len(candidates),
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
        or not visual_exception_is_fact_resolvable(exception)
    ):
        return None
    exception_bounds = normalized_unit_bounds(exception.get("bounds"))
    candidates = bounded_diagnostic_candidates(exception)
    if exception_bounds is None or not candidates:
        return None
    facts = evidence.get("facts")
    if not isinstance(facts, list) or not facts:
        return None
    correction = any(candidate.get("source") == CORRECTION_SOURCE for candidate in candidates)
    if correction and (
        len(candidates) != 1 or len(facts) != 1
        or evidence.get("exceptionFingerprint") != visual_exception_fingerprint(exception)
        or not EVIDENCE_VERSION_PATTERN.fullmatch(str(evidence.get("evidenceVersion") or ""))
    ):
        return None
    agreement = evidence.get("measurementCorrectionAgreement") if correction else evidence
    accepted: list[dict[str, Any]] = []
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
            and candidate_fact_text(raw, candidate, agreement) is not None
        ]
        if not matched_indexes:
            return None
        for matched_index in matched_indexes:
            canonical_candidate = candidate_fact_text(raw, candidates[matched_index], agreement)
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
            })
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


def candidate_fact_text(fact, candidate, agreement):
    if candidate.get("source") == CORRECTION_SOURCE:
        return corrected_measurement_text(fact, candidate, agreement)
    return candidate["text"] if fact_directly_corroborates_candidate(fact, candidate["text"]) else None


def fact_directly_corroborates_candidate(fact: dict[str, Any], candidate_text: str) -> bool:
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
    try:
        result = {key: float(value.get(key)) for key in ("x", "y", "width", "height")}
    except (TypeError, ValueError):
        return None
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
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False, colorspace=fitz.csRGB)
    output = io.BytesIO()
    with ImageFromPixmap(pixmap) as image:
        image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def ImageFromPixmap(pixmap: fitz.Pixmap):
    from PIL import Image
    return Image.open(io.BytesIO(pixmap.tobytes("png")))


def image_data_url(payload: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(payload).decode('ascii')}"


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


def coordinate(value: Any) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def normalized_confidence(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
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
