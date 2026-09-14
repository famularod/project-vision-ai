from __future__ import annotations

import math
from typing import Any

from .document_structure import canopy_identity_band_contains, landscape_identity_band_contains
from .sheet_mapping import (
    StructuralIdentityEvidence,
    StructuralSheetIdentity,
    canonical_sheet_number,
    plausible_sheet,
    valid_structural_identity,
)
from .visual_coverage import (
    REQUIRED_VISUAL_TILE_KEYS,
    SHA256_PATTERN,
    VISUAL_COVERAGE_SCHEMA_VERSION,
    valid_completed_visual_tile_proof,
)
from .structured_table_pipeline import validate_persisted_structured_table_analysis
from .plan_dimensions import derive_verified_plan_dimensions
VISUAL_COVERAGE_FAILURE_CODES = frozenset({
    "visual_coverage_missing",
    "visual_coverage_schema_mismatch",
    "visual_coverage_page_mismatch",
    "visual_coverage_source_mismatch",
    "visual_coverage_stale",
    "visual_coverage_incomplete",
    "visual_tile_keys_invalid",
    "visual_tile_proofs_invalid",
})


def assure_page(
    *,
    page_data: dict[str, Any],
    expected_project_id: str,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
    unresolved_region_count: int,
) -> dict[str, Any]:
    failures: list[str] = []
    if str(page_data.get("projectId") or "").strip() != str(expected_project_id or "").strip():
        failures.append("project_identity_mismatch")
    if page_data.get("pageNumber") != expected_page_number:
        failures.append("page_identity_mismatch")
    source_sha = str(page_data.get("sourceSha256") or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(source_sha) or source_sha != expected_source_sha256:
        failures.append("source_fingerprint_mismatch")
    if unresolved_region_count > 0:
        failures.append("unresolved_regions")
    failures.extend(validate_visual_coverage(
        page_data.get("visualCoverage"),
        expected_page_number=expected_page_number,
        expected_source_sha256=expected_source_sha256,
        expected_evidence_version=expected_evidence_version,
    ))
    regions = page_data.get("regions") if isinstance(page_data.get("regions"), list) else []
    expected_dimensions, dimension_failures = derive_verified_plan_dimensions(
        page_data.get("planDimensionAnalysis"), project_id=expected_project_id,
        source_sha256=expected_source_sha256, page_number=expected_page_number,
        evidence_version=expected_evidence_version,
    )
    failures.extend(dimension_failures)
    actual_dimensions = [r for r in regions if r.get("factKind") == "plan_dimension_relationship"]
    if actual_dimensions != expected_dimensions:
        failures.append("plan_dimension_derivation_mismatch")
    structured_table_analysis = page_data.get("structuredTableAnalysis")
    structured_table_failures = validate_persisted_structured_table_analysis(
        structured_table_analysis,
        regions=regions,
        expected_project_id=expected_project_id,
        expected_page_number=expected_page_number,
        expected_source_sha256=expected_source_sha256,
        expected_evidence_version=expected_evidence_version,
        expected_sheet_number=(
            str(page_data.get("sheetNumber") or "").strip() or None
        ),
    )
    failures.extend(structured_table_failures)
    structured_table_limitations = structured_table_limitation_codes(
        structured_table_analysis,
    )
    text = str(page_data.get("text") or "").strip()
    if not text and not regions:
        failures.append("no_searchable_evidence")
    for region in regions:
        if not valid_region(region):
            failures.append("invalid_proof_coordinates")
            break
        if region.get("factKind") == "drawing_fact":
            evidence_text = str(region.get("evidenceText") or "").strip()
            region_text = str(region.get("text") or region.get("label") or "").strip()
            if not evidence_text or evidence_text != region_text:
                failures.append("fact_not_bound_to_visible_evidence")
                break
    mapping_status = page_data.get("sheetMappingStatus")
    if mapping_status not in {"verified", "conflicted", "unverified"}:
        failures.append("invalid_sheet_mapping_status")
    elif mapping_status == "conflicted":
        # A visually plausible fact cannot resolve competing sheet identities.
        # Keep the page fail-closed until the mapping itself is deterministically
        # verified; otherwise Ask ECOS could cite correct text to the wrong sheet.
        failures.append("sheet_mapping_conflicted")
    elif mapping_status == "verified" and not valid_verified_sheet_provenance(
        page_data,
        regions=regions,
        expected_page_number=expected_page_number,
    ):
        failures.append("sheet_provenance_invalid")
    accepted = not failures
    visual_coverage_failures = [
        code for code in failures if code in VISUAL_COVERAGE_FAILURE_CODES
    ]
    return {
        "accepted": accepted,
        "assuranceVersion": "ecos-assurance/hosted-index-1.1",
        # Persist the immutable identity that was actually assured. The
        # database page-graph authority refuses an otherwise accepted page
        # when this exact evidence epoch is absent or stale.
        "evidenceVersion": expected_evidence_version,
        "sourceSha256": expected_source_sha256,
        "projectId": expected_project_id,
        "pageNumber": expected_page_number,
        "checks": {
            "projectIdentityBound": "project_identity_mismatch" not in failures,
            "sourceBound": "source_fingerprint_mismatch" not in failures,
            "pageIdentityBound": "page_identity_mismatch" not in failures,
            "proofCoordinatesValid": "invalid_proof_coordinates" not in failures,
            "unresolvedRegions": max(0, unresolved_region_count),
            "searchableEvidencePresent": "no_searchable_evidence" not in failures,
            "factsBoundToVisibleEvidence": "fact_not_bound_to_visible_evidence" not in failures,
            # Coverage proves that every fixed page tile was reviewed. It does
            # not by itself prove that a drawing fact exists in any tile.
            "visualDetectionCoverageComplete": not visual_coverage_failures,
            "visualEvidentiaryProofCount": sum(
                1 for region in regions
                if isinstance(region, dict) and region.get("factKind") == "drawing_fact"
            ),
            "structuredTableSearchFailClosed": not structured_table_failures,
            "structuredTableEvidenceComplete": (
                not structured_table_failures and not structured_table_limitations
            ),
            "structuredTableLimitationCount": len(structured_table_limitations),
            "sheetMappingUsable": (
                "invalid_sheet_mapping_status" not in failures
                and "sheet_mapping_conflicted" not in failures
                and "sheet_provenance_invalid" not in failures
            ),
        },
        "failureCodes": failures,
        # Limitations are not publication failures: an independently complete
        # row remains usable, while incomplete/conflicted siblings and raw
        # cells stay quarantined and visible for bounded retry.
        "limitationCodes": structured_table_limitations,
    }


def structured_table_limitation_codes(value: Any) -> list[str]:
    if not isinstance(value, dict):
        return []
    limitations: list[str] = []
    blocks = value.get("blocks") if isinstance(value.get("blocks"), list) else []
    relationships = (
        value.get("relationships") if isinstance(value.get("relationships"), list) else []
    )
    derivations = value.get("derivations") if isinstance(value.get("derivations"), list) else []
    if (
        value.get("status") != "complete"
        or any(not isinstance(item, dict) or item.get("status") != "complete" for item in blocks)
        or any(
            not isinstance(item, dict) or item.get("status") != "complete"
            for item in relationships
        )
        or any(
            not isinstance(item, dict) or item.get("status") != "complete"
            for item in derivations
        )
        or bool(value.get("targetedOcrRequests"))
    ):
        limitations.append("structured_table_analysis_incomplete")
    if any(
        isinstance(item, dict) and item.get("status") == "conflicted"
        for item in [*blocks, *relationships, *derivations]
    ) or value.get("status") == "conflicted":
        limitations.append("structured_table_analysis_conflicted")
    return limitations


def valid_verified_sheet_provenance(
    page_data: dict[str, Any],
    *,
    regions: list[dict[str, Any]],
    expected_page_number: int,
) -> bool:
    """Require the exact producer provenance behind a verified sheet identity.

    A displayed sheet number or a confidence score is not identity evidence.
    Only structural sources produced by ``document_structure`` may cross the
    verified boundary: a strictly parsed page-bound PDF bookmark, an exact
    embedded title-band token, or the exact PDF annotation title-cell token
    plus adjacent label. Native title-band evidence must also still exist in
    the current page regions so copied metadata cannot verify a different
    extraction result.
    """
    raw_sheet_number = str(page_data.get("sheetNumber") or "").strip()
    canonical_sheet = canonical_sheet_number(raw_sheet_number)
    source = str(page_data.get("sheetMappingSource") or "").strip()
    evidence_values = page_data.get("sheetMappingEvidence")
    if (
        not raw_sheet_number
        or not canonical_sheet
        or not plausible_sheet(canonical_sheet)
        or source not in {
            "pdf_bookmark",
            "native_title_band",
            "pdf_annotation_title_band",
        }
        or not isinstance(evidence_values, list)
        or not evidence_values
    ):
        return False

    evidence_items: list[StructuralIdentityEvidence] = []
    for value in evidence_values:
        if not isinstance(value, dict):
            return False
        evidence_page_number = value.get("pageNumber")
        if (
            isinstance(evidence_page_number, bool)
            or not isinstance(evidence_page_number, int)
            or evidence_page_number < 1
        ):
            return False
        normalized_bounds = value.get("normalizedBounds")
        bounds_tuple: tuple[float, float, float, float] | None = None
        if normalized_bounds is not None:
            if not isinstance(normalized_bounds, dict):
                return False
            raw_bounds = [normalized_bounds.get(key) for key in ("x", "y", "width", "height")]
            if any(
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or not math.isfinite(item)
                for item in raw_bounds
            ):
                return False
            bounds_tuple = tuple(float(item) for item in raw_bounds)
        try:
            evidence_items.append(StructuralIdentityEvidence(
                evidence_id=str(value.get("id") or "").strip(),
                page_number=evidence_page_number,
                source=str(value.get("source") or "").strip(),
                text=str(value.get("text") or "").strip(),
                normalized_bounds=bounds_tuple,
                annotation_subtype=(
                    str(value.get("annotationSubtype") or "").strip() or None
                ),
            ))
        except (TypeError, ValueError):
            return False

    identity = StructuralSheetIdentity(
        sheet_number=canonical_sheet,
        source=source,
        evidence=tuple(evidence_items),
    )
    evidence_ids = [item.evidence_id for item in evidence_items]
    if len(set(evidence_ids)) != len(evidence_ids):
        return False
    if source == "native_title_band" and len(evidence_items) != 1:
        return False
    if not valid_structural_identity(
        identity,
        canonical_sheet,
        page_number=expected_page_number,
    ):
        return False

    if source == "native_title_band":
        region_by_id = {
            str(region.get("id") or ""): region
            for region in regions
            if isinstance(region, dict) and str(region.get("id") or "")
        }
        for evidence in evidence_items:
            current = region_by_id.get(evidence.evidence_id)
            if not isinstance(current, dict):
                return False
            if (
                str(current.get("text") or current.get("label") or "").strip()
                != evidence.text
                or str(current.get("source") or "").strip() != "embedded_text"
            ):
                return False
            if evidence.normalized_bounds is None:
                return False
            x, y, width, height = evidence.normalized_bounds
            page_box = (x, y, x + width, y + height)
            if canonical_sheet.startswith("L-"):
                if not landscape_identity_band_contains(page_box):
                    return False
            elif canonical_sheet.startswith(("WPA-", "WPB-", "WPC-")):
                if not canopy_identity_band_contains(page_box):
                    return False
            else:
                return False
            raw_current_bounds = [current.get(key) for key in ("x", "y", "width", "height")]
            if any(
                isinstance(item, bool)
                or not isinstance(item, (int, float))
                or not math.isfinite(item)
                for item in raw_current_bounds
            ):
                return False
            current_bounds = tuple(float(item) for item in raw_current_bounds)
            if any(
                # ``public_region`` rounds browser-facing coordinates to six
                # decimal places while structural evidence retains the native
                # PDF precision. Accept only that bounded representation loss.
                abs(left - right) > 5e-6
                for left, right in zip(current_bounds, evidence.normalized_bounds)
            ):
                return False
    return True


def validate_visual_coverage(
    value: Any,
    *,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
) -> list[str]:
    """Validate exact, page-bound six-tile detection coverage.

    Counts and boolean completion flags are only summaries. The authoritative
    proof is one unique record for each fixed tile, bound to the current source
    checksum, PDF page, and evidence version. This prevents copied, duplicate,
    or stale tile results from being treated as current drawing coverage.
    """
    if not isinstance(value, dict):
        return ["visual_coverage_missing"]

    failures: list[str] = []
    if value.get("schemaVersion") != VISUAL_COVERAGE_SCHEMA_VERSION:
        failures.append("visual_coverage_schema_mismatch")
    if value.get("pageNumber") != expected_page_number:
        failures.append("visual_coverage_page_mismatch")
    source_sha = str(value.get("sourceSha256") or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(source_sha) or source_sha != expected_source_sha256:
        failures.append("visual_coverage_source_mismatch")
    if str(value.get("evidenceVersion") or "").strip() != expected_evidence_version:
        failures.append("visual_coverage_stale")

    keys = value.get("completedDeepReadRegionKeys")
    key_list = [str(key).strip() for key in keys] if isinstance(keys, list) else []
    if len(key_list) != len(REQUIRED_VISUAL_TILE_KEYS) or set(key_list) != REQUIRED_VISUAL_TILE_KEYS:
        failures.append("visual_tile_keys_invalid")

    failure_codes = value.get("failureCodes")
    has_recorded_failures = (
        not isinstance(failure_codes, list)
        or any(str(code or "").strip() for code in failure_codes)
    )
    if (
        value.get("overviewAnalyzed") is not True
        or value.get("coverageComplete") is not True
        or value.get("requestedDeepReadRegionCount") != len(REQUIRED_VISUAL_TILE_KEYS)
        or value.get("completedDeepReadRegionCount") != len(REQUIRED_VISUAL_TILE_KEYS)
        or has_recorded_failures
    ):
        failures.append("visual_coverage_incomplete")

    proofs = value.get("completedDeepReadRegionProofs")
    proof_list = proofs if isinstance(proofs, list) else []
    proof_keys: list[str] = []
    all_analysis_region_ids: list[str] = []
    proofs_valid = len(proof_list) == len(REQUIRED_VISUAL_TILE_KEYS)
    for proof in proof_list:
        if not isinstance(proof, dict):
            proofs_valid = False
            continue
        tile_key = str(proof.get("tileKey") or "").strip()
        proof_keys.append(tile_key)
        analysis_region_ids = proof.get("analysisRegionIds")
        if isinstance(analysis_region_ids, list):
            all_analysis_region_ids.extend(str(value) for value in analysis_region_ids)
        if not valid_completed_visual_tile_proof(
            proof,
            expected_page_number=expected_page_number,
            expected_source_sha256=expected_source_sha256,
            expected_evidence_version=expected_evidence_version,
        ):
            proofs_valid = False
    if (
        not proofs_valid
        or len(proof_keys) != len(REQUIRED_VISUAL_TILE_KEYS)
        or set(proof_keys) != REQUIRED_VISUAL_TILE_KEYS
        or len(set(all_analysis_region_ids)) != len(all_analysis_region_ids)
    ):
        failures.append("visual_tile_proofs_invalid")

    # Keep failure codes stable even when one malformed value violates several
    # internal comparisons of the same contract.
    return list(dict.fromkeys(failures))


def valid_region(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if not str(value.get("text") or value.get("label") or "").strip():
        return False
    try:
        x = float(value.get("x"))
        y = float(value.get("y"))
        width = float(value.get("width"))
        height = float(value.get("height"))
    except (TypeError, ValueError):
        return False
    return (
        0 <= x <= 1
        and 0 <= y <= 1
        and 0 < width <= 1
        and 0 < height <= 1
        and x + width <= 1.001
        and y + height <= 1.001
    )
