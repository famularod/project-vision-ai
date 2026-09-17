from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable


# Drawing identifiers appear in several common forms: C6, E-2.1, WPA-4, and
# legacy sheets such as X-E-2.1. OCR may insert spaces or use a Unicode dash.
SHEET_PATTERN = re.compile(
    r"(?<![A-Z0-9])((?=[A-Z])(?:[A-Z]{1,4}\s*[-–—]\s*){0,2}[A-Z]{0,4}\s*[-.]?\s*\d{1,3}(?:\.\d{1,3})?[A-Z]?)(?![A-Z0-9])",
    re.IGNORECASE,
)
SHEET_LABEL_PATTERN = re.compile(
    r"\bSHEET\s*(?:NO\.?|NUMBER|NUM(?:BER)?\.?)\b",
    re.IGNORECASE,
)
REFERENCE_CONTEXT_PATTERN = re.compile(
    r"\b(?:REFER\s+TO|REFERENCE|DETAIL|SECTION|FIXTURE|TYPE|KEYNOTE|KEY\s+NOTE)\b",
    re.IGNORECASE,
)
PAGE_BOUND_VALIDATED_IDENTITY_SOURCE = "sheet_identity_ocr_page_bound_validated"
STRUCTURAL_IDENTITY_RENDERED_SOURCES = frozenset({
    "fixed_visual_tile_coordinate_ocr",
    "sheet_identity_ocr_landscape_native",
    "sheet_identity_ocr_page_bound_validated",
    "sheet_identity_ocr_vertical_outline",
    "title_block_ocr",
})
AMBIGUOUS_ARCHITECTURAL_OCR_PATTERN = re.compile(r"^A-\d{1,2}$", re.IGNORECASE)


@dataclass(frozen=True)
class SheetCandidate:
    sheet_number: str
    score: float
    confidence: float
    evidence_region_ids: tuple[str, ...]
    strong_title_evidence: bool
    exact_identity_evidence: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "sheetNumber": self.sheet_number,
            "score": round(self.score, 5),
            "confidence": round(self.confidence, 5),
            "evidenceRegionIds": list(self.evidence_region_ids),
        }


@dataclass(frozen=True)
class CoordinateSheetAnalysis:
    """Rendered-coordinate candidates that may corroborate structural identity.

    Coordinate OCR is independent visual support, not structural provenance.
    A strong candidate can therefore corroborate an exact bookmark, but it may
    never by itself cross the public ``verified`` mapping boundary.
    """

    candidates: tuple[SheetCandidate, ...]
    strong_candidate: SheetCandidate | None
    conflicted: bool


@dataclass(frozen=True)
class StructuralIdentityEvidence:
    """One page-bound piece of evidence for a structural sheet identity."""

    evidence_id: str
    page_number: int
    source: str
    text: str
    normalized_bounds: tuple[float, float, float, float] | None = None
    annotation_subtype: str | None = None
    rendered_corroborated: bool = False
    rendered_corroborating_region_ids: tuple[str, ...] = ()
    rendered_corroborating_sources: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        bounds = self.normalized_bounds
        result = {
            "id": self.evidence_id,
            "pageNumber": self.page_number,
            "source": self.source,
            "text": self.text,
            "normalizedBounds": (
                {
                    "x": bounds[0],
                    "y": bounds[1],
                    "width": bounds[2],
                    "height": bounds[3],
                }
                if bounds is not None
                else None
            ),
        }
        if self.annotation_subtype is not None:
            result["annotationSubtype"] = self.annotation_subtype
        if self.rendered_corroborated:
            result["renderedCorroborated"] = True
            result["renderedCorroboratingRegionIds"] = list(
                self.rendered_corroborating_region_ids,
            )
            result["renderedCorroboratingSources"] = list(
                self.rendered_corroborating_sources,
            )
        return result


@dataclass(frozen=True)
class StructuralSheetIdentity:
    """A verified sheet identity plus its actual structural provenance."""

    sheet_number: str
    source: str
    evidence: tuple[StructuralIdentityEvidence, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "sheetNumber": self.sheet_number,
            "source": self.source,
            "evidence": [item.as_dict() for item in self.evidence],
        }


def map_sheet(
    regions: Iterable[dict[str, Any]],
    page_width: float,
    page_height: float,
    *,
    structural_identity: StructuralSheetIdentity | None = None,
    page_number: int | None = None,
) -> dict[str, Any]:
    coordinate_analysis = analyze_coordinate_sheet(
        regions,
        page_width,
        page_height,
    )
    candidates = coordinate_analysis.candidates
    structural_sheet = canonical_sheet_number(
        structural_identity.sheet_number if structural_identity else "",
    )
    if (
        structural_identity is not None
        and structural_sheet
        and plausible_sheet(structural_sheet)
        and valid_structural_identity(
            structural_identity,
            structural_sheet,
            page_number=page_number,
        )
    ):
        structural_evidence = [item.as_dict() for item in structural_identity.evidence]
        structural_candidate = {
            "sheetNumber": structural_sheet,
            "score": 10.0,
            "confidence": 0.99,
            "evidenceRegionIds": [
                item.evidence_id for item in structural_identity.evidence
            ],
            "evidence": structural_evidence,
        }
        return {
            "sheetNumber": structural_sheet,
            "sheetMappingStatus": "verified",
            "sheetMappingConfidence": 0.99,
            "sheetMappingSource": structural_identity.source,
            "sheetMappingEvidence": structural_evidence,
            "sheetMappingCandidates": [
                structural_candidate,
                *(candidate.as_dict() for candidate in candidates if candidate.sheet_number != structural_sheet),
            ][:8],
        }
    if not candidates:
        return empty_mapping()

    # ``coordinate_text`` is deliberately diagnostic-only. Even a unique,
    # high-scoring title-cell OCR read has no producer provenance record for
    # Assurance to replay, so persisting it as verified would create a mapping
    # that the independent Assurance boundary must reject.
    winner = candidates[0]
    return {
        "sheetNumber": None,
        "sheetMappingStatus": (
            "conflicted" if coordinate_analysis.conflicted else "unverified"
        ),
        "sheetMappingConfidence": winner.confidence,
        "sheetMappingSource": "coordinate_text",
        "sheetMappingEvidence": [],
        "sheetMappingCandidates": [candidate.as_dict() for candidate in candidates[:8]],
    }


def analyze_coordinate_sheet(
    regions: Iterable[dict[str, Any]],
    page_width: float,
    page_height: float,
) -> CoordinateSheetAnalysis:
    """Score rendered coordinate text without asserting verified provenance."""

    page_regions = list(regions)
    markers = [
        normalized_position(region, page_width, page_height)
        for region in page_regions
        if SHEET_LABEL_PATTERN.search(region_text(region))
    ]
    grouped: dict[str, dict[str, Any]] = {}

    for region in page_regions:
        text = region_text(region)
        if not text.strip():
            continue
        nx, ny = normalized_position(region, page_width, page_height)
        source = str(region.get("source") or "").lower()
        explicit_sheet_label = bool(SHEET_LABEL_PATTERN.search(text))
        # A title-block identity is to the right of its SHEET NUMBER label or
        # immediately below it.  A broad symmetric radius incorrectly made a
        # DATE value several rows above the label look like page identity.
        near_sheet_label = any(
            0.012 <= nx - mx <= 0.16
            and -0.015 <= ny - my <= 0.07
            for mx, my in markers
        )
        title_block_corner = nx >= 0.66 and ny >= 0.64
        title_block_edge = nx >= 0.82 and ny >= 0.48
        exact_identity_ocr = source == PAGE_BOUND_VALIDATED_IDENTITY_SOURCE
        title_ocr = source == "title_block_ocr" or source.startswith("sheet_identity_ocr")
        preferred_identity_crop = source == "sheet_identity_ocr_landscape_native"
        reference_context = bool(REFERENCE_CONTEXT_PATTERN.search(text))

        for match in SHEET_PATTERN.finditer(text.upper()):
            sheet = canonical_sheet_number(match.group(1))
            if not plausible_sheet(sheet):
                continue
            ambiguous_architectural_ocr = bool(
                AMBIGUOUS_ARCHITECTURAL_OCR_PATTERN.fullmatch(sheet)
                and "ocr" in source
                and not exact_identity_ocr
            )
            occurrence_score = 0.08
            if title_block_corner:
                occurrence_score += 2.15
            if title_block_edge:
                occurrence_score += 0.65
            if title_ocr:
                occurrence_score += 0.9
            if exact_identity_ocr:
                occurrence_score += 1.3
            if preferred_identity_crop:
                occurrence_score += 1.0
            if explicit_sheet_label:
                occurrence_score += 2.5
            if near_sheet_label:
                occurrence_score += 1.7
            if candidate_is_only_identity(text, match.group(0)):
                occurrence_score += 0.85
            if reference_context and not (explicit_sheet_label or near_sheet_label or title_block_corner):
                occurrence_score = min(occurrence_score, 0.2)

            current = grouped.setdefault(sheet, {
                "scores": [], "regions": [], "strong": False, "exact": False,
            })
            current["scores"].append(occurrence_score)
            current["strong"] = bool(current["strong"] or (
                not ambiguous_architectural_ocr
                and (
                    explicit_sheet_label
                    or near_sheet_label
                    or (exact_identity_ocr and candidate_is_only_identity(text, match.group(0)))
                )
            ))
            current["exact"] = bool(current["exact"] or (
                exact_identity_ocr and candidate_is_only_identity(text, match.group(0))
            ))
            region_id = str(region.get("id") or "").strip()
            if region_id and region_id not in current["regions"]:
                current["regions"].append(region_id)

    candidates = tuple(sorted(
        (
            SheetCandidate(
                sheet_number=sheet,
                score=aggregate_scores(data["scores"]),
                confidence=min(0.99, 0.45 + aggregate_scores(data["scores"]) * 0.095),
                evidence_region_ids=tuple(data["regions"]),
                strong_title_evidence=bool(data["strong"]),
                exact_identity_evidence=bool(data["exact"]),
            )
            for sheet, data in grouped.items()
        ),
        key=lambda candidate: (-candidate.score, candidate.sheet_number),
    ))
    if not candidates:
        return CoordinateSheetAnalysis((), None, False)

    winner = candidates[0]
    runner_up = candidates[1] if len(candidates) > 1 else None
    winner_has_title_evidence = winner.score >= 3.25 and winner.strong_title_evidence
    conflicted = (
        winner_has_title_evidence
        and runner_up is not None
        and runner_up.strong_title_evidence
        and runner_up.score >= 3.0
        and abs(winner.score - runner_up.score) < 0.75
        and not (winner.exact_identity_evidence and not runner_up.exact_identity_evidence)
    )
    return CoordinateSheetAnalysis(
        candidates=candidates,
        strong_candidate=(winner if winner_has_title_evidence and not conflicted else None),
        conflicted=conflicted,
    )


def valid_structural_identity(
    identity: StructuralSheetIdentity,
    canonical_sheet: str,
    *,
    page_number: int | None,
) -> bool:
    """Reject structural provenance that is incomplete or internally inconsistent."""

    if page_number is None or page_number < 1:
        return False
    if identity.source not in {
        "pdf_bookmark",
        "native_title_band",
        "pdf_annotation_title_band",
    }:
        return False
    if not identity.evidence:
        return False

    for evidence in identity.evidence:
        if (
            evidence.page_number != page_number
            or not evidence.evidence_id
            or not evidence.text.strip()
        ):
            return False
        if identity.source == "pdf_bookmark":
            # Import lazily to avoid a module cycle while still enforcing the
            # exact strict bookmark grammar used to construct the identity.
            from .document_structure import parse_bookmark_sheet_number

            if (
                evidence.source != "pdf_bookmark"
                or not evidence.evidence_id.startswith("pdf-bookmark-")
                or evidence.normalized_bounds is not None
                or parse_bookmark_sheet_number(evidence.text) != canonical_sheet
                or not valid_rendered_identity_corroboration(evidence)
            ):
                return False
        elif identity.source == "native_title_band":
            if (
                evidence.source != "embedded_text"
                or not evidence.evidence_id.startswith("native-")
                or not valid_normalized_bounds(evidence.normalized_bounds)
                or canonical_sheet_number(evidence.text) != canonical_sheet
                or not valid_rendered_identity_corroboration(evidence)
            ):
                return False
        if canonical_sheet_number(identity.sheet_number) != canonical_sheet:
            return False
    if identity.source == "pdf_annotation_title_band":
        from .document_structure import (
            PDF_ANNOTATION_SHEET_LABEL_PATTERN,
            pdf_annotation_sheet_label_band_contains,
            pdf_annotation_sheet_token_band_contains,
            pdf_annotation_title_evidence_adjacent,
        )

        if len(identity.evidence) != 2:
            return False
        if any(
            item.source != "pdf_annotation"
            or not item.evidence_id.startswith("pdf-annotation-")
            or not valid_normalized_bounds(item.normalized_bounds)
            or item.annotation_subtype != "Square"
            or not valid_rendered_identity_corroboration(item)
            for item in identity.evidence
        ):
            return False
        token_items = [
            item for item in identity.evidence
            if canonical_sheet_number(item.text) == canonical_sheet
        ]
        label_items = [
            item for item in identity.evidence
            if PDF_ANNOTATION_SHEET_LABEL_PATTERN.fullmatch(item.text.strip())
        ]
        if len(token_items) != 1 or len(label_items) != 1:
            return False
        token = token_items[0]
        label = label_items[0]
        token_bounds = token.normalized_bounds
        label_bounds = label.normalized_bounds
        if token_bounds is None or label_bounds is None:
            return False
        token_box = (
            token_bounds[0], token_bounds[1],
            token_bounds[0] + token_bounds[2], token_bounds[1] + token_bounds[3],
        )
        label_box = (
            label_bounds[0], label_bounds[1],
            label_bounds[0] + label_bounds[2], label_bounds[1] + label_bounds[3],
        )
        if (
            not pdf_annotation_sheet_token_band_contains(token_box)
            or not pdf_annotation_sheet_label_band_contains(label_box)
            or not pdf_annotation_title_evidence_adjacent(token, label)
        ):
            return False
    return True


def valid_rendered_identity_corroboration(
    evidence: StructuralIdentityEvidence,
) -> bool:
    """Reject structural candidates that have not crossed the rendered boundary."""

    region_ids = evidence.rendered_corroborating_region_ids
    sources = evidence.rendered_corroborating_sources
    return (
        evidence.rendered_corroborated
        and 0 < len(region_ids) <= 128
        and all(bool(region_id) for region_id in region_ids)
        and len(set(region_ids)) == len(region_ids)
        and bool(sources)
        and all(source in STRUCTURAL_IDENTITY_RENDERED_SOURCES for source in sources)
        and len(set(sources)) == len(sources)
    )


def valid_normalized_bounds(
    bounds: tuple[float, float, float, float] | None,
) -> bool:
    if bounds is None:
        return False
    x, y, width, height = bounds
    return (
        0.0 <= x < 1.0
        and 0.0 <= y < 1.0
        and 0.0 < width <= 1.0 - x + 1e-9
        and 0.0 < height <= 1.0 - y + 1e-9
    )


def region_text(region: dict[str, Any]) -> str:
    return str(region.get("text") or region.get("label") or "")


def normalized_position(
    region: dict[str, Any], page_width: float, page_height: float,
) -> tuple[float, float]:
    if region.get("x") is not None and region.get("y") is not None:
        return float(region.get("x") or 0.0), float(region.get("y") or 0.0)
    safe_width = max(1.0, page_width)
    safe_height = max(1.0, page_height)
    return (
        float(region.get("absoluteX") or 0.0) / safe_width,
        float(region.get("absoluteY") or 0.0) / safe_height,
    )


def candidate_is_only_identity(text: str, matched: str) -> bool:
    remainder = text.upper().replace(matched.upper(), " ")
    remainder = SHEET_LABEL_PATTERN.sub(" ", remainder)
    return not re.sub(r"[^A-Z0-9]+", "", remainder)


def aggregate_scores(scores: list[float]) -> float:
    if not scores:
        return 0.0
    # Repeated fixture tags and detail callouts must not overwhelm one verified
    # title-block identity. Corroboration is useful, but deliberately capped.
    return max(scores) + min(0.45, max(0, len(scores) - 1) * 0.15)


def empty_mapping() -> dict[str, Any]:
    return {
        "sheetNumber": None,
        "sheetMappingStatus": "unverified",
        "sheetMappingConfidence": None,
        "sheetMappingSource": None,
        "sheetMappingEvidence": [],
        "sheetMappingCandidates": [],
    }


def canonical_sheet_number(value: str) -> str:
    normalized = value.upper().replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", "", normalized).replace("-.", "-")


def plausible_sheet(value: str) -> bool:
    prefix = re.match(r"[A-Z]+", value)
    return bool(prefix and prefix.group(0) not in {
        "APN", "DATE", "GP", "NO", "OF", "PR", "REN", "REV", "SF", "SHT", "FT", "WDI",
    })
