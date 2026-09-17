"""Hosted integration for the pure coordinate-bound structured-table engine.

The detector in :mod:`structured_tables` intentionally knows nothing about
PDFs, persistence, or searchable ECOS regions.  This module is the narrow
adapter between that pure boundary and the hosted indexer:

* exact project/source/page/evidence identity enters the detector;
* only complete, non-conflicted relationships become drawing facts, even when
  an unrelated sibling row remains incomplete;
* each fact retains every exact coordinate constituent;
* incomplete/conflicted tables remain explicit unresolved work; and
* the persisted analysis is independently fingerprinted and revalidated by
  ECOS Assurance before a page can be published.

Six-tile visual coverage is deliberately not consumed here.  Coverage proves
that the page was inspected; it cannot make a missing table cell factual.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Iterable, Mapping

from .structured_tables import (
    StructuredTableInputRejected,
    StructuredTableResourceRejected,
    detect_blocks,
    evaluate_blocks,
)


STRUCTURED_TABLE_ANALYSIS_SCHEMA_VERSION = "ecos-structured-table-analysis/1.0"
STRUCTURED_TABLE_FACT_SOURCE = "deterministic_structured_table_relationship"
STRUCTURED_TABLE_RECONSTRUCTION_METHOD = (
    "complete_coordinate_bound_structured_table_relationship"
)


def analyze_page_structured_tables(
    *,
    project_id: str,
    source_sha256: str,
    page_number: int,
    evidence_version: str,
    sheet_number: str | None,
    regions: Iterable[Mapping[str, Any]],
    vector_segments: Iterable[Mapping[str, Any]] | None = None,
    block_hints: Iterable[Mapping[str, Any]] | None = None,
    targeted_ocr_proofs: Iterable[Mapping[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]]]:
    """Evaluate one hosted page and return facts, persisted analysis, gaps.

    No analysis object is emitted when no table block is detected.  Once a
    block is detected, however, an incomplete or conflicted relationship is a
    fail-closed page gap rather than an invitation to search flattened OCR.
    """

    identity = {
        "projectId": str(project_id or "").strip(),
        "sourceSha256": str(source_sha256 or "").strip().lower(),
        "pageNumber": page_number,
        "evidenceVersion": str(evidence_version or "").strip(),
        "sheetNumber": str(sheet_number).strip() if sheet_number else None,
    }
    region_list = [dict(region) for region in regions if isinstance(region, Mapping)]
    blocks = detect_blocks(
        identity,
        region_list,
        vector_segments=vector_segments,
        block_hints=block_hints,
    )
    if not blocks:
        return [], None, []

    evaluation = evaluate_blocks(identity, blocks, region_list)
    analysis: dict[str, Any] = {
        "schemaVersion": STRUCTURED_TABLE_ANALYSIS_SCHEMA_VERSION,
        "pageIdentity": evaluation["pageIdentity"],
        "blocks": evaluation["blocks"],
        "relationships": evaluation["relationships"],
        "derivations": evaluation["derivations"],
        "targetedOcrRequests": evaluation["targetedOcrRequests"],
        "targetedOcrProofs": [
            dict(proof) for proof in (targeted_ocr_proofs or ())
            if isinstance(proof, Mapping)
        ],
        "status": evaluation["status"],
    }
    facts = searchable_structured_table_regions(analysis)
    analysis["searchableFactRegionIds"] = [str(region["id"]) for region in facts]
    analysis["analysisSha256"] = structured_table_analysis_sha256(analysis)
    return facts, analysis, structured_table_unresolved_regions(analysis)


def structured_table_analysis_sha256(value: Mapping[str, Any]) -> str:
    payload = {
        key: value.get(key)
        for key in (
            "schemaVersion",
            "pageIdentity",
            "blocks",
            "relationships",
            "derivations",
            "targetedOcrRequests",
            "targetedOcrProofs",
            "status",
            "searchableFactRegionIds",
        )
    }
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def rebind_targeted_ocr_proofs(
    initial_analysis: Mapping[str, Any],
    refined_analysis: Mapping[str, Any],
    targeted_ocr_proofs: Iterable[Mapping[str, Any]],
    *,
    available_region_ids: Iterable[str],
) -> list[dict[str, Any]]:
    """Bind first-pass OCR requests to exactly one second-pass block.

    Block identifiers include their region identifiers, so adding a bounded
    OCR refinement can legitimately change a block id.  The raster proof is
    nevertheless evidence for the *requested* first-pass crop, not arbitrary
    second-pass geometry.  Preserve that requested id and only move the current
    id when one final block has the same page identity and schema and either:

    * the exact normalized requested bounds; or
    * bounds wholly contained by the requested crop, with every trusted proof
      region explicitly claimed by that final block.

    Ambiguous, missing, or non-matching proofs are discarded.  A caller must
    also discard their refinement regions rather than use unbound OCR output.
    """

    initial_identity = initial_analysis.get("pageIdentity")
    refined_identity = refined_analysis.get("pageIdentity")
    if (
        not isinstance(initial_identity, Mapping)
        or not isinstance(refined_identity, Mapping)
        or dict(initial_identity) != dict(refined_identity)
    ):
        return []
    initial_blocks = initial_analysis.get("blocks")
    refined_blocks = refined_analysis.get("blocks")
    if not isinstance(initial_blocks, list) or not isinstance(refined_blocks, list):
        return []
    initial_by_id = {
        str(block.get("id") or ""): block
        for block in initial_blocks
        if isinstance(block, Mapping) and str(block.get("id") or "")
    }
    available_ids = {
        str(region_id) for region_id in available_region_ids if str(region_id)
    }
    proof_list = [
        proof for proof in targeted_ocr_proofs if isinstance(proof, Mapping)
    ]
    rebound: list[dict[str, Any]] = []
    for raw_proof in proof_list:
        requested_id = str(
            raw_proof.get("requestedStructuredTableBlockId")
            or raw_proof.get("structuredTableBlockId")
            or ""
        )
        requested_block = initial_by_id.get(requested_id)
        requested_bounds = _canonical_bounds(raw_proof.get("bounds"))
        block_bounds = (
            _canonical_bounds(requested_block.get("bounds"))
            if isinstance(requested_block, Mapping)
            else None
        )
        schema = str(raw_proof.get("structuredTableSchema") or "")
        trusted_ids = raw_proof.get("trustedRegionIds")
        if (
            not isinstance(requested_block, Mapping)
            or not requested_id
            or not schema
            or schema != str(requested_block.get("schema") or "")
            or requested_bounds is None
            or requested_bounds != block_bounds
            or not _proof_identity_matches(raw_proof, initial_identity)
            or not isinstance(trusted_ids, list)
            or not trusted_ids
            or any(not isinstance(region_id, str) or not region_id for region_id in trusted_ids)
            or len(set(trusted_ids)) != len(trusted_ids)
            or any(region_id not in available_ids for region_id in trusted_ids)
        ):
            continue

        candidates: list[tuple[Mapping[str, Any], str, dict[str, float]]] = []
        for final_block in refined_blocks:
            if (
                not isinstance(final_block, Mapping)
                or str(final_block.get("schema") or "") != schema
            ):
                continue
            final_bounds = _canonical_bounds(final_block.get("bounds"))
            final_region_ids = {
                str(region_id) for region_id in final_block.get("regionIds") or []
            }
            if (
                final_bounds is None
                or not set(trusted_ids).issubset(final_region_ids)
            ):
                continue
            if final_bounds == requested_bounds:
                candidates.append((final_block, "exact_normalized_bounds", final_bounds))
            elif _safe_refinement_geometry(final_bounds, requested_bounds):
                candidates.append((
                    final_block,
                    "trusted_regions_in_near_exact_final_bounds",
                    final_bounds,
                ))
        if len(candidates) != 1:
            continue
        final_block, binding_method, final_bounds = candidates[0]
        requested_block_receipt = _canonical_requested_block_receipt(requested_block)
        if requested_block_receipt is None:
            continue
        rebound.append({
            **dict(raw_proof),
            "requestedStructuredTableBlockId": requested_id,
            "requestedStructuredTableBlock": requested_block_receipt,
            "requestedStructuredTableSchema": schema,
            "requestedBounds": requested_bounds,
            "structuredTableBlockId": str(final_block.get("id") or ""),
            "structuredTableSchema": schema,
            "structuredTableBlockBounds": final_bounds,
            "structuredTableBindingMethod": binding_method,
        })
    requested_ids = [
        str(proof.get("requestedStructuredTableBlockId") or "") for proof in rebound
    ]
    final_ids = [
        str(proof.get("structuredTableBlockId") or "") for proof in rebound
    ]
    if (
        len(rebound) != len(proof_list)
        or len(set(requested_ids)) != len(requested_ids)
        or len(set(final_ids)) != len(final_ids)
    ):
        return []
    return rebound


def attach_rebound_targeted_ocr_proofs(
    analysis: Mapping[str, Any],
    proofs: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Return a fresh analysis with canonical proofs and a fresh outer hash."""

    result = dict(analysis)
    result["targetedOcrProofs"] = [
        dict(proof) for proof in proofs if isinstance(proof, Mapping)
    ]
    result["analysisSha256"] = structured_table_analysis_sha256(result)
    return result


def searchable_structured_table_regions(
    analysis: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Return only independently complete, non-conflicted relationships.

    A complete row does not borrow certainty from its block and an incomplete
    sibling does not erase its exact proof. Raw constituents for every row are
    still quarantined separately by the hosted integration and Assurance.
    """

    raw_blocks = analysis.get("blocks")
    raw_relationships = analysis.get("relationships")
    blocks = raw_blocks if isinstance(raw_blocks, list) else []
    relationships = raw_relationships if isinstance(raw_relationships, list) else []
    valid_block_ids = {
        str(block.get("id") or "")
        for block in blocks
        if isinstance(block, Mapping) and str(block.get("id") or "")
    }
    facts: list[dict[str, Any]] = []
    for relationship in relationships:
        if (
            not isinstance(relationship, Mapping)
            or relationship.get("status") != "complete"
            or str(relationship.get("blockId") or "") not in valid_block_ids
        ):
            continue
        fact = _relationship_fact(relationship)
        if fact is not None:
            facts.append(fact)
    return sorted(facts, key=lambda item: (
        float(item["y"]),
        float(item["x"]),
        str(item["id"]),
    ))


def structured_table_unresolved_regions(
    analysis: Mapping[str, Any],
) -> list[dict[str, Any]]:
    if analysis.get("status") == "complete":
        return []
    unresolved: list[dict[str, Any]] = []
    relationships = analysis.get("relationships")
    for relationship in relationships if isinstance(relationships, list) else []:
        if not isinstance(relationship, Mapping) or relationship.get("status") == "complete":
            continue
        bounds = relationship.get("rowBounds")
        if not _valid_bounds(bounds):
            continue
        relationship_id = str(relationship.get("id") or "")
        unresolved.append({
            "regionKey": f"structured-table-relationship:{relationship_id}",
            "bounds": dict(bounds),
            "reason": (
                "A coordinate-bound drawing table relationship is incomplete or "
                "conflicted. ECOS will not search or answer from that table until "
                "every required role is resolved from exact bounded evidence."
            ),
            "structuredTableRelationshipId": relationship_id,
            "structuredTableStatus": str(relationship.get("status") or "incomplete"),
            "missingRoles": list(relationship.get("missingRoles") or []),
            "conflictCodes": list(relationship.get("conflictCodes") or []),
        })
    if unresolved:
        return unresolved
    # A detected block with no reconstructable relationship is still a real
    # gap.  Retain its exact bounds so a future bounded OCR retry cannot expand
    # into unrelated page content.
    blocks = analysis.get("blocks")
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, Mapping) or block.get("status") == "complete":
            continue
        bounds = block.get("bounds")
        if not _valid_bounds(bounds):
            continue
        unresolved.append({
            "regionKey": f"structured-table-block:{str(block.get('id') or '')}",
            "bounds": dict(bounds),
            "reason": (
                "A coordinate-bound drawing table was detected but no complete, "
                "non-conflicted relationship could be reconstructed."
            ),
            "structuredTableBlockId": str(block.get("id") or ""),
            "structuredTableStatus": str(block.get("status") or "incomplete"),
        })
    return unresolved


def validate_persisted_structured_table_analysis(
    value: Any,
    *,
    regions: list[dict[str, Any]],
    expected_project_id: str,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
    expected_sheet_number: str | None,
) -> list[str]:
    """Revalidate the exact analysis and its searchable fact round trip."""

    if value is None:
        unexpected = [
            region for region in regions
            if isinstance(region, dict)
            and str(region.get("source") or "") == STRUCTURED_TABLE_FACT_SOURCE
        ]
        return ["structured_table_search_provenance_invalid"] if unexpected else []
    if not isinstance(value, dict):
        return ["structured_table_proof_invalid"]

    failures: list[str] = []
    if value.get("schemaVersion") != STRUCTURED_TABLE_ANALYSIS_SCHEMA_VERSION:
        failures.append("structured_table_proof_invalid")
    identity = value.get("pageIdentity")
    if not isinstance(identity, dict):
        failures.append("structured_table_proof_invalid")
        identity = {}
    expected_sheet = str(expected_sheet_number).strip() if expected_sheet_number else None
    if (
        str(identity.get("projectId") or "").strip() != str(expected_project_id or "").strip()
        or str(identity.get("sourceSha256") or "").strip().lower()
        != str(expected_source_sha256 or "").strip().lower()
        or identity.get("pageNumber") != expected_page_number
        or str(identity.get("evidenceVersion") or "").strip()
        != str(expected_evidence_version or "").strip()
        or (str(identity.get("sheetNumber") or "").strip() or None) != expected_sheet
    ):
        failures.append("structured_table_identity_mismatch")
    recorded_hash = str(value.get("analysisSha256") or "").strip().lower()
    if (
        not _sha256(recorded_hash)
        or recorded_hash != structured_table_analysis_sha256(value)
    ):
        failures.append("structured_table_proof_invalid")

    raw_blocks = value.get("blocks")
    raw_relationships = value.get("relationships")
    raw_derivations = value.get("derivations")
    raw_requests = value.get("targetedOcrRequests")
    raw_proofs = value.get("targetedOcrProofs")
    if not all(isinstance(item, list) for item in (
        raw_blocks, raw_relationships, raw_derivations, raw_requests, raw_proofs,
    )):
        failures.append("structured_table_proof_invalid")
        return list(dict.fromkeys(failures))
    blocks = [item for item in raw_blocks if isinstance(item, dict)]
    relationships = [item for item in raw_relationships if isinstance(item, dict)]
    if len(blocks) != len(raw_blocks) or len(relationships) != len(raw_relationships):
        failures.append("structured_table_proof_invalid")
    block_ids = [str(block.get("id") or "") for block in blocks]
    relationship_ids = [str(item.get("id") or "") for item in relationships]
    if (
        not blocks
        or any(not value for value in block_ids + relationship_ids)
        or len(set(block_ids)) != len(block_ids)
        or len(set(relationship_ids)) != len(relationship_ids)
    ):
        failures.append("structured_table_proof_invalid")

    # Re-run the pure evaluator against the exact persisted coordinate
    # regions. A caller cannot legitimize a fabricated role value merely by
    # recomputing the outer JSON hash: the deterministic relationship output
    # must still equal what the bounded constituents produce now.
    try:
        reevaluated = evaluate_blocks(
            {
                "projectId": expected_project_id,
                "sourceSha256": expected_source_sha256,
                "pageNumber": expected_page_number,
                "evidenceVersion": expected_evidence_version,
                "sheetNumber": expected_sheet,
            },
            blocks,
            regions,
        )
    except (StructuredTableInputRejected, StructuredTableResourceRejected, TypeError, ValueError):
        failures.append("structured_table_proof_invalid")
    else:
        if any(
            reevaluated.get(key) != value.get(key)
            for key in (
                "pageIdentity", "blocks", "relationships", "derivations",
                "targetedOcrRequests", "status",
            )
        ):
            failures.append("structured_table_proof_invalid")
    region_by_id = {
        str(region.get("id") or ""): region
        for region in regions
        if isinstance(region, dict) and str(region.get("id") or "")
    }
    if any(not _valid_targeted_ocr_proof(
        proof,
        region_by_id=region_by_id,
        block_by_id={str(block.get("id") or ""): block for block in blocks},
        expected_project_id=expected_project_id,
        expected_page_number=expected_page_number,
        expected_source_sha256=expected_source_sha256,
        expected_evidence_version=expected_evidence_version,
    ) for proof in raw_proofs):
        failures.append("structured_table_proof_invalid")
    requested_proof_block_ids = [
        str(
            proof.get("requestedStructuredTableBlockId")
            or proof.get("structuredTableBlockId")
            or ""
        )
        for proof in raw_proofs
        if isinstance(proof, Mapping)
    ]
    final_proof_block_ids = [
        str(proof.get("structuredTableBlockId") or "")
        for proof in raw_proofs
        if isinstance(proof, Mapping)
    ]
    if (
        len(requested_proof_block_ids) != len(raw_proofs)
        or any(not block_id for block_id in requested_proof_block_ids)
        or any(not block_id for block_id in final_proof_block_ids)
        or len(set(requested_proof_block_ids)) != len(requested_proof_block_ids)
        or len(set(final_proof_block_ids)) != len(final_proof_block_ids)
    ):
        failures.append("structured_table_proof_invalid")
    for relationship in relationships:
        if not _valid_relationship_identity(
            relationship,
            expected_project_id=expected_project_id,
            expected_page_number=expected_page_number,
            expected_source_sha256=expected_source_sha256,
            expected_evidence_version=expected_evidence_version,
            expected_sheet_number=expected_sheet,
            valid_block_ids=set(block_ids),
        ):
            failures.append("structured_table_proof_invalid")
        constituents = relationship.get("constituents")
        constituent_list = constituents if isinstance(constituents, list) else []
        ids = [
            str(item.get("id") or "")
            for item in constituent_list
            if isinstance(item, dict)
        ]
        if (
            not constituent_list
            or len(ids) != len(constituent_list)
            or any(not item for item in ids)
            or len(set(ids)) != len(ids)
            or any(
                not _constituent_matches_region(
                    item,
                    region_by_id.get(str(item.get("id") or "")),
                )
                for item in constituent_list
                if isinstance(item, dict)
            )
        ):
            failures.append("structured_table_proof_invalid")

    # Every raw constituent claimed by a detected table stays in the durable
    # page record for replay, but must be explicitly quarantined from search.
    # Complete relationship facts are separate regions and remain searchable.
    for block in blocks:
        raw_region_ids = [str(item) for item in block.get("regionIds") or []]
        if any(
            region_by_id.get(region_id, {}).get("searchable") is not False
            for region_id in raw_region_ids
        ):
            failures.append("structured_table_search_provenance_invalid")

    expected_facts = searchable_structured_table_regions(value)
    expected_fact_by_id = {str(fact["id"]): fact for fact in expected_facts}
    recorded_fact_ids = value.get("searchableFactRegionIds")
    fact_id_list = [str(item) for item in recorded_fact_ids] if isinstance(recorded_fact_ids, list) else []
    actual_fact_by_id = {
        region_id: region
        for region_id, region in region_by_id.items()
        if str(region.get("source") or "") == STRUCTURED_TABLE_FACT_SOURCE
    }
    if (
        fact_id_list != [str(item["id"]) for item in expected_facts]
        or set(actual_fact_by_id) != set(expected_fact_by_id)
        or any(
            not _fact_matches(expected, actual_fact_by_id.get(fact_id))
            for fact_id, expected in expected_fact_by_id.items()
        )
    ):
        failures.append("structured_table_search_provenance_invalid")
    return list(dict.fromkeys(failures))


def _valid_targeted_ocr_proof(
    value: Any,
    *,
    region_by_id: Mapping[str, Mapping[str, Any]],
    block_by_id: Mapping[str, Mapping[str, Any]],
    expected_project_id: str,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
) -> bool:
    if not isinstance(value, Mapping) or value.get("state") != "completed":
        return False
    requested_block_id = str(value.get("requestedStructuredTableBlockId") or "")
    block_id = str(value.get("structuredTableBlockId") or "")
    block = block_by_id.get(block_id)
    is_legacy_exact_proof = not any(
        key in value
        for key in (
            "requestedStructuredTableBlockId",
            "requestedStructuredTableBlock",
            "requestedStructuredTableSchema",
            "requestedBounds",
            "structuredTableBlockBounds",
            "structuredTableBindingMethod",
        )
    )
    requested_bounds = _canonical_bounds(value.get("requestedBounds"))
    proof_bounds = _canonical_bounds(value.get("bounds"))
    final_bounds = _canonical_bounds(value.get("structuredTableBlockBounds"))
    actual_final_bounds = (
        _canonical_bounds(block.get("bounds"))
        if isinstance(block, Mapping)
        else None
    )
    binding_method = str(value.get("structuredTableBindingMethod") or "")
    if is_legacy_exact_proof:
        requested_block_id = block_id
        requested_bounds = proof_bounds
        final_bounds = actual_final_bounds
        binding_method = "legacy_exact_block_binding"
    if (
        not isinstance(block, Mapping)
        or not requested_block_id
        or requested_bounds is None
        or proof_bounds != requested_bounds
        or final_bounds is None
        or final_bounds != actual_final_bounds
        or (
            not is_legacy_exact_proof
            and str(value.get("requestedStructuredTableSchema") or "")
            != str(block.get("schema") or "")
        )
        or str(value.get("projectId") or "").strip()
        != str(expected_project_id or "").strip()
        or str(value.get("structuredTableSchema") or "")
        != str(block.get("schema") or "")
        or value.get("pageNumber") != expected_page_number
        or str(value.get("sourceSha256") or "").strip().lower()
        != str(expected_source_sha256 or "").strip().lower()
        or str(value.get("evidenceVersion") or "").strip()
        != str(expected_evidence_version or "").strip()
        or not _valid_bounds(value.get("bounds"))
        or not _sha256(str(value.get("renderSha256") or ""))
        or not _sha256(str(value.get("analysisInputSha256") or ""))
        or not _sha256(str(value.get("analysisSha256") or ""))
    ):
        return False
    if not is_legacy_exact_proof and not _valid_requested_block_receipt(
        value.get("requestedStructuredTableBlock"),
        requested_block_id=requested_block_id,
        requested_bounds=requested_bounds,
        requested_schema=str(value.get("requestedStructuredTableSchema") or ""),
        region_by_id=region_by_id,
        expected_project_id=expected_project_id,
        expected_page_number=expected_page_number,
        expected_source_sha256=expected_source_sha256,
        expected_evidence_version=expected_evidence_version,
        expected_page_fingerprint=str(block.get("pageFingerprint") or ""),
    ):
        return False
    trusted_ids = value.get("trustedRegionIds")
    if not isinstance(trusted_ids, list) or any(
        not isinstance(item, str) or item not in region_by_id
        for item in trusted_ids
    ):
        return False
    block_region_ids = {
        str(region_id) for region_id in block.get("regionIds") or []
    }
    if (
        not trusted_ids
        or len(set(trusted_ids)) != len(trusted_ids)
        or not set(trusted_ids).issubset(block_region_ids)
        or value.get("trustedRegionCount") != len(trusted_ids)
        or not isinstance(value.get("rejectedRegionCount"), int)
        or int(value.get("rejectedRegionCount")) < 0
    ):
        return False
    if binding_method == "legacy_exact_block_binding":
        if proof_bounds != actual_final_bounds:
            return False
    elif binding_method == "exact_normalized_bounds":
        if final_bounds != requested_bounds:
            return False
    elif binding_method == "trusted_regions_in_near_exact_final_bounds":
        if final_bounds == requested_bounds or not _safe_refinement_geometry(
            final_bounds, requested_bounds,
        ):
            return False
    else:
        return False
    passes = value.get("analysisPasses")
    if not isinstance(passes, list) or len(passes) != 2:
        return False
    if not all(
        isinstance(item, Mapping)
        and isinstance(item.get("analysisRegionIds"), list)
        and _sha256(str(item.get("renderSha256") or ""))
        and _sha256(str(item.get("analysisInputSha256") or ""))
        and _sha256(str(item.get("analysisSha256") or ""))
        for item in passes
    ):
        return False
    analyzed_ids = {
        str(region_id)
        for item in passes
        for region_id in item.get("analysisRegionIds") or []
        if isinstance(region_id, str)
    }
    top_level_analyzed_ids = value.get("analysisRegionIds")
    if not isinstance(top_level_analyzed_ids, list):
        return False
    return all(
        region_id in analyzed_ids and region_id in top_level_analyzed_ids
        for region_id in trusted_ids
    )


def _proof_identity_matches(
    proof: Mapping[str, Any],
    identity: Mapping[str, Any],
) -> bool:
    return (
        str(proof.get("projectId") or "").strip()
        == str(identity.get("projectId") or "").strip()
        and str(proof.get("sourceSha256") or "").strip().lower()
        == str(identity.get("sourceSha256") or "").strip().lower()
        and proof.get("pageNumber") == identity.get("pageNumber")
        and str(proof.get("evidenceVersion") or "").strip()
        == str(identity.get("evidenceVersion") or "").strip()
    )


def _canonical_requested_block_receipt(
    block: Mapping[str, Any],
) -> dict[str, Any] | None:
    bounds = _canonical_bounds(block.get("bounds"))
    region_ids = sorted({str(value) for value in block.get("regionIds") or []})
    receipt = {
        "id": str(block.get("id") or ""),
        "pageFingerprint": str(block.get("pageFingerprint") or ""),
        "projectId": str(block.get("projectId") or ""),
        "sourceSha256": str(block.get("sourceSha256") or "").lower(),
        "pageNumber": block.get("pageNumber"),
        "evidenceVersion": str(block.get("evidenceVersion") or ""),
        "schema": str(block.get("schema") or ""),
        "bounds": bounds,
        "regionIds": region_ids,
        "detectionMethod": str(block.get("detectionMethod") or "unknown"),
        "label": block.get("label"),
    }
    if (
        not receipt["id"]
        or not receipt["pageFingerprint"]
        or not receipt["projectId"]
        or not receipt["sourceSha256"]
        or not receipt["evidenceVersion"]
        or not receipt["schema"]
        or bounds is None
    ):
        return None
    return receipt


def _valid_requested_block_receipt(
    value: Any,
    *,
    requested_block_id: str,
    requested_bounds: Mapping[str, Any] | None,
    requested_schema: str,
    region_by_id: Mapping[str, Mapping[str, Any]],
    expected_project_id: str,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
    expected_page_fingerprint: str,
) -> bool:
    if not isinstance(value, Mapping):
        return False
    receipt = _canonical_requested_block_receipt(value)
    if receipt is None or dict(value) != receipt:
        return False
    block_payload = {key: item for key, item in receipt.items() if key != "id"}
    encoded = json.dumps(
        block_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    )
    expected_id = f"block:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()[:24]}"
    region_ids = receipt["regionIds"]
    return (
        receipt["id"] == requested_block_id == expected_id
        and receipt["bounds"] == requested_bounds
        and receipt["schema"] == requested_schema
        and receipt["projectId"] == str(expected_project_id or "").strip()
        and receipt["sourceSha256"] == str(expected_source_sha256 or "").strip().lower()
        and receipt["pageNumber"] == expected_page_number
        and receipt["evidenceVersion"] == str(expected_evidence_version or "").strip()
        and receipt["pageFingerprint"] == expected_page_fingerprint
        and len(region_ids) == len(set(region_ids))
        and all(region_id in region_by_id for region_id in region_ids)
    )


def _canonical_bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, Mapping):
        return None
    try:
        result = {
            key: round(float(value[key]), 6)
            for key in ("x", "y", "width", "height")
        }
    except (KeyError, TypeError, ValueError):
        return None
    return result if _valid_bounds(result) else None


def _bounds_contained(
    inner: Mapping[str, Any],
    outer: Mapping[str, Any],
) -> bool:
    inner_bounds = _canonical_bounds(inner)
    outer_bounds = _canonical_bounds(outer)
    if inner_bounds is None or outer_bounds is None:
        return False
    tolerance = 0.000001
    return (
        inner_bounds["x"] >= outer_bounds["x"] - tolerance
        and inner_bounds["y"] >= outer_bounds["y"] - tolerance
        and inner_bounds["x"] + inner_bounds["width"]
        <= outer_bounds["x"] + outer_bounds["width"] + tolerance
        and inner_bounds["y"] + inner_bounds["height"]
        <= outer_bounds["y"] + outer_bounds["height"] + tolerance
    )


def _safe_refinement_geometry(
    final_bounds: Mapping[str, Any],
    requested_bounds: Mapping[str, Any],
) -> bool:
    """Accept only the tiny deterministic detector drift seen after OCR.

    A second detection can expand a block by one word box, so strict
    containment is insufficient.  Require at least 96 percent intersection
    over union and cap every edge movement at two percent of the requested
    dimension (never more than six normalized page thousandths).  This binds
    the known raster refinement without treating a merely overlapping block as
    the same proof target.
    """

    final = _canonical_bounds(final_bounds)
    requested = _canonical_bounds(requested_bounds)
    if final is None or requested is None:
        return False
    final_right = final["x"] + final["width"]
    final_bottom = final["y"] + final["height"]
    requested_right = requested["x"] + requested["width"]
    requested_bottom = requested["y"] + requested["height"]
    x_tolerance = min(0.006, max(0.00025, requested["width"] * 0.02))
    y_tolerance = min(0.006, max(0.00025, requested["height"] * 0.02))
    if (
        abs(final["x"] - requested["x"]) > x_tolerance
        or abs(final_right - requested_right) > x_tolerance
        or abs(final["y"] - requested["y"]) > y_tolerance
        or abs(final_bottom - requested_bottom) > y_tolerance
    ):
        return False
    intersection_width = max(
        0.0, min(final_right, requested_right) - max(final["x"], requested["x"]),
    )
    intersection_height = max(
        0.0, min(final_bottom, requested_bottom) - max(final["y"], requested["y"]),
    )
    intersection = intersection_width * intersection_height
    union = (
        final["width"] * final["height"]
        + requested["width"] * requested["height"]
        - intersection
    )
    return union > 0 and intersection / union >= 0.96


def _relationship_fact(relationship: Mapping[str, Any]) -> dict[str, Any] | None:
    constituents = relationship.get("constituents")
    if not isinstance(constituents, list) or not constituents:
        return None
    normalized = [item for item in constituents if isinstance(item, Mapping)]
    if len(normalized) != len(constituents) or any(not _valid_bounds(item.get("bounds")) for item in normalized):
        return None
    normalized.sort(key=lambda item: (
        float(item["bounds"]["y"]),
        float(item["bounds"]["x"]),
        str(item.get("id") or ""),
    ))
    texts = [str(item.get("text") or "").strip() for item in normalized]
    if any(not text for text in texts):
        return None
    raw_text = " ".join(texts)
    bounds = _union_bounds([item["bounds"] for item in normalized])
    relationship_id = str(relationship.get("id") or "")
    block_id = str(relationship.get("blockId") or "")
    relationship_type = str(relationship.get("type") or "structured_table")
    row_key = str(relationship.get("rowKey") or "")
    text = _canonical_relationship_fact_text(
        relationship_type,
        row_key,
        relationship.get("roles"),
        fallback=raw_text,
    )
    evidence = []
    for item in normalized:
        evidence_item = {
            "id": str(item.get("id") or ""),
            "text": str(item.get("text") or ""),
            "source": str(item.get("source") or ""),
            "confidence": _bounded_number(item.get("confidence")),
            "bounds": dict(item["bounds"]),
            "projectId": str(relationship.get("projectId") or ""),
            "sourceSha256": str(relationship.get("sourceSha256") or ""),
            "pageNumber": relationship.get("pageNumber"),
            "evidenceVersion": str(relationship.get("evidenceVersion") or ""),
            "sheetNumber": relationship.get("sheetNumber"),
            "relationshipId": relationship_id,
            "blockId": block_id,
            "relationshipType": relationship_type,
            "rowKey": row_key,
        }
        for key in (
            "renderedCorroborated",
            "renderedCorroboratingRegionIds",
            "renderedCorroboratingSources",
            "constituentEvidence",
            "corroboratingEvidence",
        ):
            if item.get(key) is not None:
                evidence_item[key] = item[key]
        evidence.append(evidence_item)
    confidence = min(_bounded_number(item.get("confidence")) for item in normalized)
    fact_id = f"structured-table-fact:{relationship_id}"
    return {
        "id": fact_id,
        "label": text[:240],
        "text": text,
        **bounds,
        "confidence": confidence,
        "source": STRUCTURED_TABLE_FACT_SOURCE,
        "factKind": "drawing_fact",
        "subject": _relationship_subject(relationship_type),
        "location": (
            f"Sheet {relationship.get('sheetNumber')} coordinate-bound table"
            if relationship.get("sheetNumber")
            else f"PDF page {relationship.get('pageNumber')} coordinate-bound table"
        ),
        "evidenceText": text,
        "reconstructionMethod": STRUCTURED_TABLE_RECONSTRUCTION_METHOD,
        "evidenceSources": sorted({str(item.get("source") or "") for item in normalized}),
        "constituentEvidence": evidence,
        "corroboratingEvidence": [],
        "structuredRelationshipId": relationship_id,
        "structuredTableBlockId": block_id,
        "structuredTableRelationshipType": relationship_type,
        "structuredTableRowKey": row_key,
    }


def _canonical_relationship_fact_text(
    relationship_type: str,
    row_key: str,
    raw_roles: Any,
    *,
    fallback: str,
) -> str:
    """Render accepted typed roles as stable, searchable drawing language.

    OCR constituents remain the immutable proof below the fact.  This text is
    only a deterministic rendering of already-complete role values; it cannot
    fill a missing role or turn an incomplete relationship into a fact.
    """

    roles = raw_roles if isinstance(raw_roles, Mapping) else {}

    def role(name: str) -> Any:
        value = roles.get(name)
        if not isinstance(value, Mapping) or value.get("state") != "complete":
            return None
        return value.get("value")

    if relationship_type == "slab_legend":
        thickness = role("thickness")
        material = role("material")
        reinforcement = role("reinforcement")
        if thickness is not None and material and reinforcement:
            return (
                f"{_format_role_number(thickness)}-inch-thick "
                f"{reinforcement} {material} slab"
            )
    elif relationship_type == "footing_schedule":
        dimensions = role("dimensions")
        reinforcing = role("reinforcing")
        if row_key and dimensions and reinforcing:
            return f"Footing {row_key}: {dimensions}; reinforcing {reinforcing}"
    elif relationship_type == "equipment_record":
        identifier = role("identifier") or row_key
        airflow = role("airflow")
        service = role("service")
        if identifier and airflow is not None:
            base = f"Exhaust fan {identifier}: {_format_role_number(airflow)} CFM"
            return f"{base}; serves {str(service).replace(' + ', ' and ')}" if service else base
    elif relationship_type == "fixture_unit_total":
        total = role("totalFixtureUnits")
        labels = {"center": "Center breakroom", "east": "East side"}
        if total is not None and row_key in labels:
            return (
                f"{labels[row_key]} cold-water fixture-unit total: "
                f"{_format_role_number(total)}"
            )
    elif relationship_type == "numbered_note":
        bus_amps = role("busAmps")
        poles = role("poles")
        if row_key and bus_amps is not None and poles is not None:
            return (
                f"Keyed note {row_key}: replacement panel with "
                f"{_format_role_number(bus_amps)}-amp bus and "
                f"{_format_role_number(poles)} poles"
            )
    elif relationship_type == "photometric_statistics":
        average = role("avg")
        maximum = role("max")
        minimum = role("min")
        if row_key and all(value is not None for value in (average, maximum, minimum)):
            return (
                f"{row_key} site photometrics: average {_format_role_number(average)} fc, "
                f"maximum {_format_role_number(maximum)} fc, "
                f"minimum {_format_role_number(minimum)} fc"
            )
    elif relationship_type == "landscape_metric":
        value = role("value")
        labels = {
            "landscapeArea": "Total landscape area",
            "irrigatedArea": "Total irrigated landscape area",
            "requiredTrees": "Parking-lot trees required",
            "providedTrees": "Parking-lot trees provided",
        }
        if value is not None and row_key in labels:
            suffix = " square feet" if row_key in {"landscapeArea", "irrigatedArea"} else " trees"
            return f"{labels[row_key]}: {_format_role_number(value)}{suffix}"
    elif relationship_type == "hydrozone_area":
        area = role("area")
        if area is not None and row_key in {"high", "medium", "low"}:
            return (
                f"{row_key.title()}-water hydrozone area: "
                f"{_format_role_number(area)} square feet"
            )
    elif relationship_type == "water_budget":
        value = role("value")
        if value is not None and row_key in {"ETWU", "MAWA"}:
            return f"{row_key}: {_format_role_number(value)}"
    elif relationship_type == "plant_material":
        quantity = role("quantity")
        common_name = role("commonName")
        if quantity is not None and common_name:
            return f"{common_name}: {_format_role_number(quantity)} trees"
    return fallback


def _format_role_number(value: Any) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        number = float(value)
        return f"{int(number):,}" if number.is_integer() else f"{number:g}"
    return str(value)


def _relationship_subject(value: str) -> str:
    return {
        "slab_legend": "slab construction",
        "footing_schedule": "footing schedule",
        "equipment_record": "equipment schedule",
        "fixture_unit_total": "plumbing fixture units",
        "fixture_unit_printed_overall": "plumbing fixture units",
        "numbered_note": "drawing note",
        "photometric_statistics": "lighting photometric statistics",
        "landscape_summary": "landscape summary",
        "hydrozone_summary": "landscape hydrozone",
        "water_budget": "landscape water budget",
        "plant_material": "plant material",
    }.get(value, "structured drawing table")


def _valid_relationship_identity(
    relationship: Mapping[str, Any],
    *,
    expected_project_id: str,
    expected_page_number: int,
    expected_source_sha256: str,
    expected_evidence_version: str,
    expected_sheet_number: str | None,
    valid_block_ids: set[str],
) -> bool:
    return (
        str(relationship.get("projectId") or "").strip() == str(expected_project_id).strip()
        and str(relationship.get("sourceSha256") or "").strip().lower()
        == str(expected_source_sha256).strip().lower()
        and relationship.get("pageNumber") == expected_page_number
        and str(relationship.get("evidenceVersion") or "").strip()
        == str(expected_evidence_version).strip()
        and (str(relationship.get("sheetNumber") or "").strip() or None)
        == expected_sheet_number
        and str(relationship.get("blockId") or "") in valid_block_ids
        and _valid_bounds(relationship.get("rowBounds"))
    )


def _constituent_matches_region(value: Mapping[str, Any], region: Any) -> bool:
    if not isinstance(region, dict):
        return False
    bounds = value.get("bounds")
    return (
        _valid_bounds(bounds)
        and str(value.get("text") or "").strip() == str(region.get("text") or "").strip()
        and str(value.get("source") or "").strip() == str(region.get("source") or "").strip()
        and all(
            abs(float(bounds[key]) - float(region.get(key))) <= 1e-6
            for key in ("x", "y", "width", "height")
        )
        and all(
            value.get(key) == region.get(key)
            for key in (
                "renderedCorroborated",
                "renderedCorroboratingRegionIds",
                "renderedCorroboratingSources",
                "constituentEvidence",
                "corroboratingEvidence",
            )
        )
    )


def _fact_matches(expected: Mapping[str, Any], actual: Any) -> bool:
    if not isinstance(actual, dict):
        return False
    scalar_keys = (
        "id", "text", "label", "factKind", "subject", "location",
        "evidenceText", "source", "reconstructionMethod",
        "structuredRelationshipId", "structuredTableBlockId",
        "structuredTableRelationshipType", "structuredTableRowKey",
    )
    if any(actual.get(key) != expected.get(key) for key in scalar_keys):
        return False
    try:
        if any(
            abs(float(actual.get(key)) - float(expected.get(key))) > 1e-6
            for key in ("x", "y", "width", "height", "confidence")
        ):
            return False
    except (TypeError, ValueError):
        return False
    return (
        actual.get("evidenceSources") == expected.get("evidenceSources")
        and actual.get("constituentEvidence") == expected.get("constituentEvidence")
        and actual.get("corroboratingEvidence") == expected.get("corroboratingEvidence")
    )


def _valid_bounds(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    try:
        x, y, width, height = (
            float(value.get(key)) for key in ("x", "y", "width", "height")
        )
    except (TypeError, ValueError):
        return False
    return (
        all(math.isfinite(item) for item in (x, y, width, height))
        and 0 <= x <= 1
        and 0 <= y <= 1
        and 0 < width <= 1
        and 0 < height <= 1
        and x + width <= 1.001
        and y + height <= 1.001
    )


def _union_bounds(values: list[Mapping[str, Any]]) -> dict[str, float]:
    x1 = min(float(value["x"]) for value in values)
    y1 = min(float(value["y"]) for value in values)
    x2 = max(float(value["x"]) + float(value["width"]) for value in values)
    y2 = max(float(value["y"]) + float(value["height"]) for value in values)
    return {
        "x": round(x1, 6),
        "y": round(y1, 6),
        "width": round(max(0.000001, x2 - x1), 6),
        "height": round(max(0.000001, y2 - y1), 6),
    }


def _bounded_number(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    if not math.isfinite(number):
        number = 0.0
    return round(max(0.0, min(1.0, number)), 6)


def _sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


__all__ = [
    "attach_rebound_targeted_ocr_proofs",
    "STRUCTURED_TABLE_ANALYSIS_SCHEMA_VERSION",
    "STRUCTURED_TABLE_FACT_SOURCE",
    "STRUCTURED_TABLE_RECONSTRUCTION_METHOD",
    "StructuredTableInputRejected",
    "StructuredTableResourceRejected",
    "analyze_page_structured_tables",
    "rebind_targeted_ocr_proofs",
    "searchable_structured_table_regions",
    "structured_table_analysis_sha256",
    "structured_table_unresolved_regions",
    "validate_persisted_structured_table_analysis",
]
