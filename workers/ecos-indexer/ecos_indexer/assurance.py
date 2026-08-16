from __future__ import annotations

import math
import re
from typing import Any

from .document_structure import (
    canopy_identity_band_contains,
    landscape_identity_band_contains,
    parse_bookmark_sheet_number,
)
from .sheet_mapping import (
    SHEET_PATTERN,
    STRUCTURAL_IDENTITY_RENDERED_SOURCES,
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
EMBEDDED_PDF_TEXT_SOURCES = frozenset({"embedded_text", "native_pdf_text"})
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
    explicit_searchable_regions = [
        region for region in regions
        if isinstance(region, dict) and region.get("searchable") is True
    ]
    if not text and not explicit_searchable_regions:
        failures.append("no_searchable_evidence")
    region_by_id = {
        str(region.get("id") or ""): region
        for region in regions
        if isinstance(region, dict) and str(region.get("id") or "")
    }
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
            if not fact_embedded_evidence_is_rendered(
                region,
                region_by_id=region_by_id,
                structured_relationship_context=(
                    structured_relationship_visibility_context(
                        region,
                        structured_table_analysis,
                    )
                    if not structured_table_failures
                    else None
                ),
            ):
                failures.append("fact_not_rendered_corroborated")
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
        "evidenceVersion": expected_evidence_version,
        "checks": {
            "projectIdentityBound": "project_identity_mismatch" not in failures,
            "sourceBound": "source_fingerprint_mismatch" not in failures,
            "pageIdentityBound": "page_identity_mismatch" not in failures,
            "proofCoordinatesValid": "invalid_proof_coordinates" not in failures,
            "unresolvedRegions": max(0, unresolved_region_count),
            "searchableEvidencePresent": "no_searchable_evidence" not in failures,
            "factsBoundToVisibleEvidence": "fact_not_bound_to_visible_evidence" not in failures,
            "embeddedFactsRenderedCorroborated": (
                "fact_not_rendered_corroborated" not in failures
            ),
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


def fact_embedded_evidence_is_rendered(
    value: Any,
    *,
    region_by_id: dict[str, dict[str, Any]],
    structured_relationship_context: dict[str, Any] | None = None,
    depth: int = 0,
) -> bool:
    if not isinstance(value, dict) or depth > 4:
        return False
    source = str(value.get("source") or "").strip()
    if source in EMBEDDED_PDF_TEXT_SOURCES:
        ids = value.get("renderedCorroboratingRegionIds")
        sources = value.get("renderedCorroboratingSources")
        if (
            value.get("renderedCorroborated") is not True
            or not isinstance(ids, list)
            or not ids
            or len(ids) > 128
            or any(not isinstance(item, str) or not item for item in ids)
            or len(set(ids)) != len(ids)
            or not isinstance(sources, list)
            or not sources
            or any(not isinstance(item, str) or not item for item in sources)
            or len(set(sources)) != len(sources)
        ):
            return False
        observed_sources: set[str] = set()
        for region_id in ids:
            support = region_by_id.get(region_id)
            if support is None:
                return False
            support_source = str(support.get("source") or "").strip()
            if (
                support_source in EMBEDDED_PDF_TEXT_SOURCES
                or support_source not in sources
                or not rendered_corroboration_matches(value, support)
            ):
                return False
            if (
                support.get("searchable") is not True
                and not valid_quarantined_structured_visibility_support(
                    value,
                    support_region_id=region_id,
                    context=structured_relationship_context,
                )
            ):
                return False
            observed_sources.add(support_source)
        if observed_sources != set(sources):
            return False
    for field in ("constituentEvidence", "corroboratingEvidence"):
        nested = value.get(field)
        if nested is None:
            continue
        if not isinstance(nested, list) or len(nested) > 256:
            return False
        if any(
            not fact_embedded_evidence_is_rendered(
                item,
                region_by_id=region_by_id,
                structured_relationship_context=structured_relationship_context,
                depth=depth + 1,
            )
            for item in nested
        ):
            return False
    return True


def structured_relationship_visibility_context(
    fact: dict[str, Any],
    analysis: Any,
) -> dict[str, Any] | None:
    """Bind quarantined OCR visibility to one validated complete table fact."""

    if (
        fact.get("source") != "deterministic_structured_table_relationship"
        or fact.get("reconstructionMethod")
        != "complete_coordinate_bound_structured_table_relationship"
        or not isinstance(analysis, dict)
    ):
        return None
    relationship_id = str(fact.get("structuredRelationshipId") or "")
    block_id = str(fact.get("structuredTableBlockId") or "")
    if not relationship_id or not block_id:
        return None
    relationships = analysis.get("relationships")
    blocks = analysis.get("blocks")
    relationship = next((
        item for item in relationships if isinstance(item, dict)
        and str(item.get("id") or "") == relationship_id
        and str(item.get("blockId") or "") == block_id
        and item.get("status") == "complete"
    ), None) if isinstance(relationships, list) else None
    block = next((
        item for item in blocks if isinstance(item, dict)
        and str(item.get("id") or "") == block_id
        and relationship_id in (item.get("relationshipIds") or [])
    ), None) if isinstance(blocks, list) else None
    if relationship is None or block is None:
        return None
    constituents = relationship.get("constituents")
    constituent_ids = {
        str(item.get("id") or "")
        for item in constituents if isinstance(item, dict)
        and str(item.get("id") or "")
    } if isinstance(constituents, list) else set()
    quarantined_ids = {
        str(item) for item in block.get("regionIds") or [] if str(item)
    }
    if not constituent_ids or not quarantined_ids:
        return None
    return {
        "relationshipId": relationship_id,
        "blockId": block_id,
        "constituentIds": constituent_ids,
        "quarantinedRegionIds": quarantined_ids,
    }


def valid_quarantined_structured_visibility_support(
    evidence: dict[str, Any],
    *,
    support_region_id: str,
    context: dict[str, Any] | None,
) -> bool:
    """Allow hidden OCR as visibility proof only inside its complete relationship."""

    return bool(
        context
        and str(evidence.get("relationshipId") or "") == context["relationshipId"]
        and str(evidence.get("blockId") or "") == context["blockId"]
        and str(evidence.get("id") or "") in context["constituentIds"]
        and support_region_id in context["quarantinedRegionIds"]
    )


def rendered_corroboration_matches(
    embedded: dict[str, Any],
    rendered: dict[str, Any],
) -> bool:
    if rendered_text_tokens(embedded) != rendered_text_tokens(rendered):
        return False
    left = evidence_bounds(embedded)
    right = evidence_bounds(rendered)
    if left is None or right is None:
        return False
    intersection_width = max(0.0, min(
        left["x"] + left["width"], right["x"] + right["width"],
    ) - max(left["x"], right["x"]))
    intersection_height = max(0.0, min(
        left["y"] + left["height"], right["y"] + right["height"],
    ) - max(left["y"], right["y"]))
    smaller = min(
        left["width"] * left["height"],
        right["width"] * right["height"],
    )
    if smaller > 0 and intersection_width * intersection_height / smaller >= 0.30:
        return True
    left_center = (
        left["x"] + left["width"] / 2,
        left["y"] + left["height"] / 2,
    )
    right_center = (
        right["x"] + right["width"] / 2,
        right["y"] + right["height"] / 2,
    )
    return (
        abs(left_center[0] - right_center[0])
        <= max(0.003, min(left["width"], right["width"]) * 0.35)
        and abs(left_center[1] - right_center[1])
        <= max(0.002, min(left["height"], right["height"]) * 0.75)
    )


def rendered_text_tokens(value: dict[str, Any]) -> list[str]:
    text = str(value.get("text") or value.get("label") or "").upper()
    return re.findall(r"[A-Z]+|\d+(?:\.\d+)?", text)


def evidence_bounds(value: dict[str, Any]) -> dict[str, float] | None:
    source = value.get("bounds") if isinstance(value.get("bounds"), dict) else value
    try:
        result = {
            key: float(source[key])
            for key in ("x", "y", "width", "height")
        }
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(item) for item in result.values()):
        return None
    return result


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
            rendered_region_ids = value.get("renderedCorroboratingRegionIds")
            rendered_sources = value.get("renderedCorroboratingSources")
            if source in {
                "pdf_bookmark",
                "native_title_band",
                "pdf_annotation_title_band",
            } and (
                value.get("renderedCorroborated") is not True
                or not isinstance(rendered_region_ids, list)
                or not rendered_region_ids
                or len(rendered_region_ids) > 128
                or any(not isinstance(item, str) or not item for item in rendered_region_ids)
                or len(set(rendered_region_ids)) != len(rendered_region_ids)
                or not isinstance(rendered_sources, list)
                or not rendered_sources
                or len(set(rendered_sources)) != len(rendered_sources)
                or any(
                    not isinstance(item, str)
                    or item not in STRUCTURAL_IDENTITY_RENDERED_SOURCES
                    for item in rendered_sources
                )
            ):
                return False
            evidence_items.append(StructuralIdentityEvidence(
                evidence_id=str(value.get("id") or "").strip(),
                page_number=evidence_page_number,
                source=str(value.get("source") or "").strip(),
                text=str(value.get("text") or "").strip(),
                normalized_bounds=bounds_tuple,
                annotation_subtype=(
                    str(value.get("annotationSubtype") or "").strip() or None
                ),
                rendered_corroborated=value.get("renderedCorroborated") is True,
                rendered_corroborating_region_ids=tuple(rendered_region_ids or ()),
                rendered_corroborating_sources=tuple(rendered_sources or ()),
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

    region_by_id = {
        str(region.get("id") or ""): region
        for region in regions
        if isinstance(region, dict) and str(region.get("id") or "")
    }
    if source == "native_title_band":
        for evidence in evidence_items:
            current = region_by_id.get(evidence.evidence_id)
            if not isinstance(current, dict):
                return False
            if (
                str(current.get("text") or current.get("label") or "").strip()
                != evidence.text
                or str(current.get("source") or "").strip() != "embedded_text"
                or current.get("searchable") is not False
                or current.get("renderedCorroborated") is not True
                or tuple(current.get("renderedCorroboratingRegionIds") or ())
                != evidence.rendered_corroborating_region_ids
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
    if source in {
        "pdf_bookmark",
        "native_title_band",
        "pdf_annotation_title_band",
    } and any(
        not structural_evidence_rendered_match(value, region_by_id)
        for value in evidence_values
    ):
        return False
    return True


def structural_evidence_rendered_match(
    evidence: dict[str, Any],
    region_by_id: dict[str, dict[str, Any]],
) -> bool:
    if str(evidence.get("source") or "") == "pdf_bookmark":
        return bookmark_evidence_rendered_match(evidence, region_by_id)
    bounds = evidence.get("normalizedBounds")
    ids = evidence.get("renderedCorroboratingRegionIds")
    sources = evidence.get("renderedCorroboratingSources")
    if (
        evidence.get("renderedCorroborated") is not True
        or not isinstance(bounds, dict)
        or not isinstance(ids, list)
        or not ids
        or len(set(ids)) != len(ids)
        or not isinstance(sources, list)
        or not sources
    ):
        return False
    expected = {
        "text": str(evidence.get("text") or ""),
        "bounds": bounds,
    }
    observed_sources: set[str] = set()
    for region_id in ids:
        support = region_by_id.get(str(region_id))
        if not isinstance(support, dict):
            return False
        support_source = str(support.get("source") or "")
        if (
            support.get("searchable") is not True
            or support_source not in STRUCTURAL_IDENTITY_RENDERED_SOURCES
            or support_source not in sources
            or not rendered_corroboration_matches(expected, support)
        ):
            return False
        observed_sources.add(support_source)
    return observed_sources == set(sources)


def bookmark_evidence_rendered_match(
    evidence: dict[str, Any],
    region_by_id: dict[str, dict[str, Any]],
) -> bool:
    """Replay the independent rendered support for one bookmark candidate."""

    expected_sheet = parse_bookmark_sheet_number(str(evidence.get("text") or ""))
    ids = evidence.get("renderedCorroboratingRegionIds")
    sources = evidence.get("renderedCorroboratingSources")
    if (
        not expected_sheet
        or evidence.get("renderedCorroborated") is not True
        or not isinstance(ids, list)
        or not ids
        or len(ids) > 128
        or any(not isinstance(region_id, str) or not region_id for region_id in ids)
        or len(set(ids)) != len(ids)
        or not isinstance(sources, list)
        or not sources
        or len(set(sources)) != len(sources)
        or any(
            not isinstance(source, str)
            or source not in STRUCTURAL_IDENTITY_RENDERED_SOURCES
            for source in sources
        )
    ):
        return False

    observed_sources: set[str] = set()
    for region_id in ids:
        support = region_by_id.get(region_id)
        if not isinstance(support, dict):
            return False
        support_source = str(support.get("source") or "")
        rendered_sheet_numbers = {
            canonical_sheet_number(match.group(1))
            for match in SHEET_PATTERN.finditer(
                str(support.get("text") or support.get("label") or "").upper(),
            )
        }
        if (
            support.get("searchable") is not True
            or support_source not in STRUCTURAL_IDENTITY_RENDERED_SOURCES
            or support_source not in sources
            or expected_sheet not in rendered_sheet_numbers
        ):
            return False
        observed_sources.add(support_source)
    return observed_sources == set(sources)


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
