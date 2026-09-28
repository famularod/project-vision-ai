"""The drawing's own text from AutoCAD's "SHX Text" PDF comments.

AutoCAD draws text set in its SHX fonts as pen strokes, so a plotted PDF shows
the words without containing them as text, and the indexer has had to read
them back from the picture (OCR). With AutoCAD's default PDFSHX=1, the plot
also stores every such text object as a PDF comment titled "AutoCAD SHX Text",
placed over the drawn letters, whose content is exactly what the drafter
typed. (PDFSHX=2, AutoCAD 2024+, writes the same text as hidden page text,
which native_text_regions already reads.)

26 Sep 2026, blind-graded on 60 questions: reading these comments beside the
OCR took answers on values the OCR misreads (6.62 read "662", a slashed zero
read "O") from 2.5 of 12 to 11 of 12, all Verified, with no added wrong
answers; all 60 questions: 48 right vs 34.5, wrong 3 vs 6.5.

Returned regions are the PDF's own text (source "embedded_text", confidence
0.99) with textOrigin "autocad_shx_comment": one per comment, plus regions
joining comments that sit on one printed line. Dimension values on dimension
lines are not exported as comments, so the OCR stays in place beside this.
"""
from __future__ import annotations

import re
from typing import Any

import pymupdf as fitz

SHX_COMMENT_TITLE = "AutoCAD SHX Text"
SHX_TEXT_ORIGIN = "autocad_shx_comment"
MAX_SHX_COMMENTS_PER_PAGE = 20_000
MAX_SHX_TEXT_CHARACTERS = 1_200
# AutoCAD control codes kept in the comment text.
SHX_CODES: tuple[tuple[str, str], ...] = (
    (r"%%[uUoO]", ""),       # underline / overline toggles
    (r"%%[dD]", "°"),        # degree sign
    (r"%%[pP]", "±"),        # plus/minus
    (r"%%[cC]", "Ø"),        # diameter
    (r"%%%", "%"),
)


def shx_comment_text(raw: str) -> str:
    text = str(raw or "")
    for pattern, replacement in SHX_CODES:
        text = re.sub(pattern, replacement, text)
    text = "".join(ch for ch in text if ch.isprintable() or ch in "\t\r\n")
    return re.sub(r"\s+", " ", text).strip()


def shx_comment_regions(page: fitz.Page, page_width: float, page_height: float) -> list[dict[str, Any]]:
    items: list[tuple[fitz.Rect, str, int]] = []
    for index, annot in enumerate(page.annots() or []):
        if index >= MAX_SHX_COMMENTS_PER_PAGE:
            break
        info = annot.info or {}
        if str(info.get("title") or "") != SHX_COMMENT_TITLE:
            continue
        text = shx_comment_text(str(info.get("content") or ""))
        if not text or len(text) > MAX_SHX_TEXT_CHARACTERS:
            continue
        rect = fitz.Rect(annot.rect)
        if page.rotation:
            rect = rect * page.rotation_matrix
        rect = rect & fitz.Rect(0, 0, page_width, page_height)
        if rect.is_empty or rect.width <= 0 or rect.height <= 0:
            continue
        items.append((rect, text, index))

    def region(region_id: str, text: str, rect: fitz.Rect) -> dict[str, Any]:
        return {
            "id": region_id,
            "text": text,
            "label": text[:240],
            "x": rect.x0 / page_width,
            "y": rect.y0 / page_height,
            "width": rect.width / page_width,
            "height": rect.height / page_height,
            "absoluteX": rect.x0,
            "absoluteY": rect.y0,
            "confidence": 0.99,
            "source": "embedded_text",
            "textOrigin": SHX_TEXT_ORIGIN,
        }

    regions = [region(f"shx-{index}", text, rect) for rect, text, index in items]
    # Comments that sit on one printed line (centres within 0.4 of the text
    # height, gaps under 1.5 heights) are also joined, so a quote spanning
    # several text objects ("SITE AREA:" + "6.62 ACRES") is found as printed.
    # (27 Sep review) Only horizontal text of similar size is joined: a
    # rotated or vertical label has a tall box, and using its height as the
    # tolerance merged unrelated labels 88 pt apart into one made-up "exact"
    # string.
    def horizontal(rect: fitz.Rect, text: str) -> bool:
        return len(text) <= 2 or rect.width >= rect.height

    items.sort(key=lambda it: ((it[0].y0 + it[0].y1) / 2, it[0].x0))
    used: set[int] = set()
    line_number = 0
    for k, (rect, text, _) in enumerate(items):
        if k in used:
            continue
        used.add(k)
        if not horizontal(rect, text):
            continue
        line = [(rect, text)]
        centre, height, right = (rect.y0 + rect.y1) / 2, rect.height, rect.x1
        for j in range(k + 1, len(items)):
            other, other_text, _ = items[j]
            other_centre = (other.y0 + other.y1) / 2
            if other_centre - centre > 0.4 * height:
                break
            if j in used or abs(other_centre - centre) > 0.4 * height:
                continue
            if not horizontal(other, other_text) or \
                    max(other.height, height) > 1.5 * min(other.height, height):
                continue
            if 0 <= other.x0 - right <= 1.5 * height or (other.x0 < right < other.x1):
                line.append((other, other_text))
                used.add(j)
                right = max(right, other.x1)
        if len(line) > 1:
            line.sort(key=lambda part: part[0].x0)
            box = fitz.Rect(line[0][0])
            for part, _ in line[1:]:
                box |= part
            regions.append(region(f"shx-line-{line_number}", " ".join(t for _, t in line), box))
            line_number += 1
    return regions
