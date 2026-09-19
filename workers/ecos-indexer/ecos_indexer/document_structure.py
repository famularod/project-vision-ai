from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import pymupdf as fitz

from .sheet_mapping import StructuralIdentityEvidence, StructuralSheetIdentity


# Many issued drawing sets carry a page-bound bookmark such as ``E04-E1.1``.
# The left token is the publisher's page key and the right token is the sheet
# identity.  Keep this deliberately strict: arbitrary bookmark prose must
# never be promoted into a verified drawing identity.
BOOKMARK_SHEET_PATTERN = re.compile(
    r"^\s*[A-Z]{1,4}\d{1,4}\s*[-–—]\s*"
    r"((?:[A-Z]{1,4}(?:\s*[-–—]\s*[A-Z]{1,4}){0,2})"
    r"\s*[-–—]?\s*\d{1,3}(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)

# The exact 2321 Architectural outline uses this one inserted-sheet publisher
# key for benchmark sheet A-1.5A.  Keep it exact rather than broadly accepting
# every trailing publisher or sheet suffix: the same issued outline contains a
# misdirected ``A11B`` entry, and several 2375 suffix sheets are intentionally
# verified from their page-bound title cells instead of the unreliable outline.
ARCHITECTURAL_INSERTED_BOOKMARK_PATTERN = re.compile(
    r"^\s*A12A\s*[-–—]\s*(A\s*[-–—]?\s*1\.5A)\s*$",
    re.IGNORECASE,
)

# The issued 2375 Street Improvement package uses page-bound publisher
# bookmarks in the exact form ``SIP SHT 1--`` / ``SIP SHT 2--``.  Accept only
# that structural token shape.  In particular, do not infer a sheet from the
# PDF page ordinal, from generic ``Sheet 1`` prose, or from a single trailing
# dash that could be ordinary bookmark punctuation.
STREET_IMPROVEMENT_BOOKMARK_PATTERN = re.compile(
    r"^[ \t]*SIP[ \t]+SHT[ \t]+([1-9]\d{0,2})[ \t]*--[ \t]*$",
    re.IGNORECASE,
)

# Some structural canopy packages do not include useful PDF bookmarks, but do
# carry one embedded, coordinate-bound page identity in the issued title block
# on every page (for example ``WPA - 4``).  This is intentionally not a general
# text heuristic: every page in a multi-page document must satisfy the exact
# same-family contract before any of these identities are used.
NATIVE_CANOPY_SHEET_PATTERN = re.compile(
    r"^WP([ABC])\s*[-–—]\s*(\d{1,3})$",
    re.IGNORECASE,
)
NATIVE_CANOPY_IDENTITY_BAND = (0.60, 0.76, 0.985, 0.84)

# The issued 2321 Landscape set has prose-only PDF bookmarks.  Every page does,
# however, contain one embedded page identity (``L-1`` through ``L-6``) in the
# same lower-right title-band cell.  Treat this as an all-pages structural
# source: a missing, duplicate, conflicting, or out-of-band token rejects the
# entire fallback.  No sheet number is ever derived from the PDF page ordinal.
NATIVE_LANDSCAPE_SHEET_PATTERN = re.compile(
    r"^L\s*[-–—]\s*([1-9]\d{0,2})$",
    re.IGNORECASE,
)
NATIVE_LANDSCAPE_IDENTITY_BAND = (0.94, 0.94, 0.99, 0.99)

# The issued 2375 Civil set has no usable bookmarks or embedded title-cell
# text.  It does, however, carry page-bound PDF Square annotations for both the
# exact sheet token (``C1`` through ``C8``) and the adjacent ``SHEET NO.``
# label.  This is structural PDF data, not OCR.  Keep the fallback deliberately
# narrow: every page must contain exactly one canonical token in the fixed
# title cell and one exact adjacent label annotation, and every observed sheet
# identity must be unique.  Off-band sheet-index annotations are ignored.
PDF_ANNOTATION_CIVIL_SHEET_PATTERN = re.compile(
    r"^C\s*[-–—]?\s*([1-9]\d{0,2})$",
    re.IGNORECASE,
)
PDF_ANNOTATION_SHEET_LABEL_PATTERN = re.compile(
    r"^SHEET\s+NO\.$",
    re.IGNORECASE,
)
PDF_ANNOTATION_SHEET_TOKEN_BAND = (0.948, 0.904, 0.972, 0.925)
PDF_ANNOTATION_SHEET_LABEL_BAND = (0.94, 0.888, 0.98, 0.907)


def document_sheet_identity_map(document: Any) -> dict[int, StructuralSheetIdentity]:
    """Return only unambiguous page-bound structural sheet identities."""

    bookmark_map = bookmark_sheet_identity_map(document)
    native_canopy_map = native_canopy_sheet_identity_map(document)
    native_landscape_map = native_landscape_sheet_identity_map(document)
    annotation_title_band_map = pdf_annotation_title_band_sheet_identity_map(document)
    native_maps = [
        mapping
        for mapping in (
            native_canopy_map,
            native_landscape_map,
            annotation_title_band_map,
        )
        if mapping
    ]
    if not native_maps:
        return bookmark_map

    native_map = native_maps[0]
    native_numbers = sheet_number_map(native_map)
    if any(sheet_number_map(mapping) != native_numbers for mapping in native_maps[1:]):
        return bookmark_map

    # A trusted bookmark remains authoritative.  The native fallback may fill
    # missing pages only when every existing bookmark agrees with it.
    if any(
        native_map.get(page_number) is None
        or native_map[page_number].sheet_number != identity.sheet_number
        for page_number, identity in bookmark_map.items()
    ):
        return bookmark_map
    return {**native_map, **bookmark_map}


def bookmark_sheet_identity_map(document: Any) -> dict[int, StructuralSheetIdentity]:
    """Return only unambiguous page-bound sheet identities from PDF bookmarks."""

    candidates: dict[int, dict[str, list[StructuralIdentityEvidence]]] = defaultdict(
        lambda: defaultdict(list),
    )
    try:
        table_of_contents = document.get_toc(simple=True)
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return {}

    page_count = int(getattr(document, "page_count", 0) or 0)
    for toc_index, entry in enumerate(table_of_contents or []):
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            continue
        try:
            page_number = int(entry[2])
        except (TypeError, ValueError):
            continue
        if page_number < 1 or page_number > page_count:
            continue
        bookmark_text = str(entry[1] or "")
        sheet_number = parse_bookmark_sheet_number(bookmark_text)
        if sheet_number:
            candidates[page_number][sheet_number].append(StructuralIdentityEvidence(
                evidence_id=f"pdf-bookmark-{toc_index}-page-{page_number}",
                page_number=page_number,
                source="pdf_bookmark",
                text=bookmark_text,
                normalized_bounds=None,
            ))

    # Duplicate nested bookmarks are common and safe when they agree. Any
    # disagreement fails closed so OCR/visual review can resolve the page.
    result: dict[int, StructuralSheetIdentity] = {}
    for page_number, by_sheet in candidates.items():
        if len(by_sheet) != 1:
            continue
        sheet_number, evidence = next(iter(by_sheet.items()))
        result[page_number] = StructuralSheetIdentity(
            sheet_number=sheet_number,
            source="pdf_bookmark",
            evidence=tuple(evidence),
        )
    return result


def native_canopy_sheet_identity_map(document: Any) -> dict[int, StructuralSheetIdentity]:
    """Return an exact all-pages WPA/WPB/WPC native title-block identity map."""

    try:
        page_count = int(getattr(document, "page_count", 0) or 0)
    except (TypeError, ValueError):
        return {}
    if page_count <= 1:
        return {}

    result: dict[int, StructuralSheetIdentity] = {}
    observed_family: str | None = None
    observed_identities: set[str] = set()
    for page_number in range(1, page_count + 1):
        try:
            page = document.load_page(page_number - 1)
            matches = native_canopy_identities_for_page(page, page_number)
        except (AttributeError, RuntimeError, TypeError, ValueError):
            return {}
        if len(matches) != 1:
            return {}

        family, identity = matches[0]
        sheet_number = identity.sheet_number
        if observed_family is None:
            observed_family = family
        elif family != observed_family:
            return {}
        if sheet_number in observed_identities:
            return {}

        observed_identities.add(sheet_number)
        result[page_number] = identity
    return result


def native_canopy_identities_for_page(
    page: Any,
    page_number: int,
) -> list[tuple[str, StructuralSheetIdentity]]:
    """Read exact embedded full-line canopy identities inside the title band."""

    page_rect = getattr(page, "rect", None)
    page_width = float(getattr(page_rect, "width", 0.0) or 0.0)
    page_height = float(getattr(page_rect, "height", 0.0) or 0.0)
    if page_rect is None or page_width <= 0 or page_height <= 0:
        return []

    payload = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    matches: list[tuple[str, StructuralSheetIdentity]] = []
    for block_index, block in enumerate(payload.get("blocks") or []):
        if block.get("type") != 0:
            continue
        for line_index, line in enumerate(block.get("lines") or []):
            spans = line.get("spans") or []
            text = "".join(str(span.get("text") or "") for span in spans).strip()
            match = NATIVE_CANOPY_SHEET_PATTERN.fullmatch(text)
            if not match:
                continue
            box = line.get("bbox") or block.get("bbox")
            if not box or len(box) < 4:
                continue
            normalized_box = normalized_page_box(page, box, page_rect, page_width, page_height)
            if not canopy_identity_band_contains(normalized_box):
                continue

            family = match.group(1).upper()
            # Numeric canonicalization prevents ``WPA-01`` and ``WPA-1`` from
            # being treated as two distinct observed sheet identities.
            number = str(int(match.group(2)))
            sheet_number = f"WP{family}-{number}"
            matches.append((family, StructuralSheetIdentity(
                sheet_number=sheet_number,
                source="native_title_band",
                evidence=(StructuralIdentityEvidence(
                    evidence_id=f"native-{block_index}-{line_index}",
                    page_number=page_number,
                    source="embedded_text",
                    text=text,
                    normalized_bounds=normalized_region_bounds(normalized_box),
                ),),
            )))
    return matches


def native_landscape_sheet_identity_map(document: Any) -> dict[int, StructuralSheetIdentity]:
    """Return an exact all-pages native Landscape title-band identity map."""

    try:
        page_count = int(getattr(document, "page_count", 0) or 0)
    except (TypeError, ValueError):
        return {}
    if page_count <= 1:
        return {}

    result: dict[int, StructuralSheetIdentity] = {}
    observed_identities: set[str] = set()
    for page_number in range(1, page_count + 1):
        try:
            page = document.load_page(page_number - 1)
            matches = native_landscape_identities_for_page(page, page_number)
        except (AttributeError, RuntimeError, TypeError, ValueError):
            return {}
        if len(matches) != 1:
            return {}

        identity = matches[0]
        sheet_number = identity.sheet_number
        if sheet_number in observed_identities:
            return {}
        observed_identities.add(sheet_number)
        result[page_number] = identity
    return result


def native_landscape_identities_for_page(
    page: Any,
    page_number: int,
) -> list[StructuralSheetIdentity]:
    """Read exact embedded Landscape identities inside the issued title band."""

    page_rect = getattr(page, "rect", None)
    page_width = float(getattr(page_rect, "width", 0.0) or 0.0)
    page_height = float(getattr(page_rect, "height", 0.0) or 0.0)
    if page_rect is None or page_width <= 0 or page_height <= 0:
        return []

    payload = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    matches: list[StructuralSheetIdentity] = []
    for block_index, block in enumerate(payload.get("blocks") or []):
        if block.get("type") != 0:
            continue
        for line_index, line in enumerate(block.get("lines") or []):
            spans = line.get("spans") or []
            text = "".join(str(span.get("text") or "") for span in spans).strip()
            match = NATIVE_LANDSCAPE_SHEET_PATTERN.fullmatch(text)
            if not match:
                continue
            box = line.get("bbox") or block.get("bbox")
            if not box or len(box) < 4:
                continue
            normalized_box = normalized_page_box(page, box, page_rect, page_width, page_height)
            if not landscape_identity_band_contains(normalized_box):
                continue

            number = str(int(match.group(1)))
            matches.append(StructuralSheetIdentity(
                sheet_number=f"L-{number}",
                source="native_title_band",
                evidence=(StructuralIdentityEvidence(
                    evidence_id=f"native-{block_index}-{line_index}",
                    page_number=page_number,
                    source="embedded_text",
                    text=text,
                    normalized_bounds=normalized_region_bounds(normalized_box),
                ),),
            ))
    return matches


def pdf_annotation_title_band_sheet_identity_map(
    document: Any,
) -> dict[int, StructuralSheetIdentity]:
    """Return an exact all-pages Civil PDF-annotation title-band map."""

    try:
        page_count = int(getattr(document, "page_count", 0) or 0)
    except (TypeError, ValueError):
        return {}
    if page_count <= 1:
        return {}

    result: dict[int, StructuralSheetIdentity] = {}
    observed_identities: set[str] = set()
    for page_number in range(1, page_count + 1):
        try:
            page = document.load_page(page_number - 1)
            matches = pdf_annotation_title_band_identities_for_page(page, page_number)
        except (AttributeError, RuntimeError, TypeError, ValueError, fitz.FileDataError):
            return {}
        if len(matches) != 1:
            return {}

        identity = matches[0]
        if identity.sheet_number in observed_identities:
            return {}
        observed_identities.add(identity.sheet_number)
        result[page_number] = identity
    return result


def pdf_annotation_title_band_identities_for_page(
    page: Any,
    page_number: int,
) -> list[StructuralSheetIdentity]:
    """Read one exact Square-annotation sheet token plus adjacent label."""

    page_rect = getattr(page, "rect", None)
    page_width = float(getattr(page_rect, "width", 0.0) or 0.0)
    page_height = float(getattr(page_rect, "height", 0.0) or 0.0)
    if page_rect is None or page_width <= 0 or page_height <= 0:
        return []

    tokens: list[tuple[str, StructuralIdentityEvidence]] = []
    labels: list[StructuralIdentityEvidence] = []
    annotation = getattr(page, "first_annot", None)
    annotation_index = 0
    while annotation is not None:
        try:
            annotation_type = annotation.type
            annotation_text = str((annotation.info or {}).get("content") or "").strip()
            annotation_box = annotation.rect
            next_annotation = annotation.next
        except (AttributeError, RuntimeError, TypeError, ValueError):
            return []

        if (
            isinstance(annotation_type, (list, tuple))
            and len(annotation_type) >= 2
            and str(annotation_type[1]) == "Square"
        ):
            normalized_box = normalized_page_box(
                page,
                annotation_box,
                page_rect,
                page_width,
                page_height,
            )
            normalized_bounds = normalized_region_bounds(normalized_box)
            evidence = StructuralIdentityEvidence(
                evidence_id=f"pdf-annotation-{annotation_index}-page-{page_number}",
                page_number=page_number,
                source="pdf_annotation",
                text=annotation_text,
                normalized_bounds=normalized_bounds,
                annotation_subtype="Square",
            )
            token_match = PDF_ANNOTATION_CIVIL_SHEET_PATTERN.fullmatch(annotation_text)
            if token_match and pdf_annotation_sheet_token_band_contains(normalized_box):
                tokens.append((f"C{int(token_match.group(1))}", evidence))
            elif (
                PDF_ANNOTATION_SHEET_LABEL_PATTERN.fullmatch(annotation_text)
                and pdf_annotation_sheet_label_band_contains(normalized_box)
            ):
                labels.append(evidence)

        annotation = next_annotation
        annotation_index += 1

    if len(tokens) != 1 or len(labels) != 1:
        return []
    sheet_number, token_evidence = tokens[0]
    label_evidence = labels[0]
    if not pdf_annotation_title_evidence_adjacent(token_evidence, label_evidence):
        return []
    return [StructuralSheetIdentity(
        sheet_number=sheet_number,
        source="pdf_annotation_title_band",
        evidence=(token_evidence, label_evidence),
    )]


def sheet_number_map(
    mapping: dict[int, StructuralSheetIdentity],
) -> dict[int, str]:
    return {
        page_number: identity.sheet_number
        for page_number, identity in mapping.items()
    }


def normalized_region_bounds(
    box: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = box
    return (x0, y0, x1 - x0, y1 - y0)


def normalized_page_box(
    page: Any,
    box: Any,
    page_rect: Any,
    page_width: float,
    page_height: float,
) -> tuple[float, float, float, float]:
    region = fitz.Rect(*map(float, box[:4]))
    if int(getattr(page, "rotation", 0) or 0):
        region = region * page.rotation_matrix
    return (
        (region.x0 - float(page_rect.x0)) / page_width,
        (region.y0 - float(page_rect.y0)) / page_height,
        (region.x1 - float(page_rect.x0)) / page_width,
        (region.y1 - float(page_rect.y0)) / page_height,
    )


def canopy_identity_band_contains(box: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = box
    band_x0, band_y0, band_x1, band_y1 = NATIVE_CANOPY_IDENTITY_BAND
    return (
        band_x0 <= x0 <= x1 <= band_x1
        and band_y0 <= y0 <= y1 <= band_y1
    )


def landscape_identity_band_contains(box: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = box
    band_x0, band_y0, band_x1, band_y1 = NATIVE_LANDSCAPE_IDENTITY_BAND
    return (
        band_x0 <= x0 <= x1 <= band_x1
        and band_y0 <= y0 <= y1 <= band_y1
    )


def pdf_annotation_sheet_token_band_contains(
    box: tuple[float, float, float, float],
) -> bool:
    x0, y0, x1, y1 = box
    band_x0, band_y0, band_x1, band_y1 = PDF_ANNOTATION_SHEET_TOKEN_BAND
    return band_x0 <= x0 <= x1 <= band_x1 and band_y0 <= y0 <= y1 <= band_y1


def pdf_annotation_sheet_label_band_contains(
    box: tuple[float, float, float, float],
) -> bool:
    x0, y0, x1, y1 = box
    band_x0, band_y0, band_x1, band_y1 = PDF_ANNOTATION_SHEET_LABEL_BAND
    return band_x0 <= x0 <= x1 <= band_x1 and band_y0 <= y0 <= y1 <= band_y1


def pdf_annotation_title_evidence_adjacent(
    token: StructuralIdentityEvidence,
    label: StructuralIdentityEvidence,
) -> bool:
    if token.normalized_bounds is None or label.normalized_bounds is None:
        return False
    token_x, token_y, token_width, _token_height = token.normalized_bounds
    label_x, label_y, label_width, label_height = label.normalized_bounds
    token_center = token_x + token_width / 2.0
    label_center = label_x + label_width / 2.0
    label_bottom = label_y + label_height
    return (
        abs(token_center - label_center) <= 0.02
        and 0.0 <= token_y - label_bottom <= 0.025
    )


def parse_bookmark_sheet_number(title: str) -> str | None:
    street_improvement_match = STREET_IMPROVEMENT_BOOKMARK_PATTERN.fullmatch(title)
    if street_improvement_match:
        return f"SIP-SHT-{int(street_improvement_match.group(1))}"

    inserted_architectural_match = ARCHITECTURAL_INSERTED_BOOKMARK_PATTERN.fullmatch(title)
    if inserted_architectural_match:
        return canonical_bookmark_sheet_number(inserted_architectural_match.group(1))

    match = BOOKMARK_SHEET_PATTERN.fullmatch(title)
    if not match:
        return None
    return canonical_bookmark_sheet_number(match.group(1))


def canonical_bookmark_sheet_number(value: str) -> str | None:
    normalized = re.sub(r"\s+", "", value.upper().replace("–", "-").replace("—", "-"))
    if not normalized:
        return None
    if "-" in normalized:
        return normalized.replace("-.", "-")

    match = re.fullmatch(
        r"([A-Z]{1,4})(\d{1,3}(?:\.\d{1,2})?[A-Z]?)",
        normalized,
    )
    if not match:
        return None
    prefix, number = match.groups()
    if prefix == "XE":
        return f"X-E-{number}"
    if prefix in {"A", "E", "MB", "PB", "SB", "WPA", "WPB", "WPC"}:
        return f"{prefix}-{number}"
    return f"{prefix}{number}"
