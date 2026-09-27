"""Google Document AI Enterprise OCR as an added reader.

Owner decision (27 Sep 2026) after a blind-graded test on 153 keyed questions:
adding Document AI lines to the page's current reading raised right answers
(115 -> 120) and cut wrong answers (7 -> 3) and wrong Verified lines
(3.2 -> 1.1 per 100). Its lines are ADDED beside the current reading, never
replacing it, and are dropped where exact PDF text (native text or AutoCAD
SHX comments) already sits at the same place, so an OCR variant can never
compete with the drawing's own typed text.

Off unless ECOS_DOCUMENT_AI_PROCESSOR (projects/../locations/us/processors/..)
is set. On Cloud Run the access token comes from the job's own service
account; nothing secret is stored. A failed tile is counted in the page
record (``documentAi``), never hidden, and leaves the rest of the page as it
would have been without this reader.
"""
from __future__ import annotations

import base64
import json
import math
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import pymupdf as fitz

SOURCE = "google_docai_ocr_region"
TEXT_ORIGIN = "google_document_ai_ocr"
TILE_POINTS = 12 * 72          # 12-inch tiles: 3600 px at 300 DPI (13 MP, under the 40 MP limit)
OVERLAP_POINTS = 0.5 * 72
RENDER_DPI = 300
MIN_CONFIDENCE = 0.5
MAX_TILES_PER_PAGE = 40
BLANK_DARK_FRACTION = 0.002
ENDPOINT = "https://us-documentai.googleapis.com/v1/{processor}:process"
METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-account/token"


class DocumentAIUnavailable(RuntimeError):
    pass


def metadata_token_provider() -> Callable[[], str]:
    cache: dict[str, Any] = {"token": None, "until": 0.0}

    def token() -> str:
        if cache["token"] and time.time() < cache["until"]:
            return cache["token"]
        request = urllib.request.Request(METADATA_TOKEN_URL, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(request, timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
        cache["token"] = body["access_token"]
        cache["until"] = time.time() + max(0, int(body.get("expires_in", 300)) - 60)
        return cache["token"]

    return token


class DocumentAIClient:
    def __init__(self, processor: str, token: Callable[[], str], *, timeout: float = 120.0,
                 opener: Callable[..., Any] | None = None) -> None:
        if not processor.startswith("projects/") or "/processors/" not in processor:
            raise ValueError("document_ai_processor_name_required")
        self.processor = processor
        self.token = token
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen

    def lines(self, png: bytes) -> list[tuple[str, float, float, float, float, float]]:
        """Lines on one image: (text, x0, y0, x1, y1, confidence), boxes 0-1 of the image."""
        body = json.dumps({"rawDocument": {"content": base64.b64encode(png).decode("ascii"),
                                           "mimeType": "image/png"}}).encode("utf-8")
        request = urllib.request.Request(ENDPOINT.format(processor=self.processor), data=body, method="POST",
                                         headers={"Authorization": "Bearer " + self.token(),
                                                  "Content-Type": "application/json"})
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as error:  # network, HTTP or JSON: the tile fails, visibly
            raise DocumentAIUnavailable(type(error).__name__) from error
        document = payload.get("document") or {}
        text = document.get("text") or ""
        out = []
        for page in document.get("pages") or []:
            for line in page.get("lines") or []:
                layout = line.get("layout") or {}
                segments = (layout.get("textAnchor") or {}).get("textSegments") or []
                value = "".join(text[int(s.get("startIndex", 0)):int(s.get("endIndex", 0))] for s in segments).strip()
                vertices = (layout.get("boundingPoly") or {}).get("normalizedVertices") or []
                if not value or not vertices:
                    continue
                xs = [float(v.get("x", 0.0)) for v in vertices]
                ys = [float(v.get("y", 0.0)) for v in vertices]
                out.append((value, min(xs), min(ys), max(xs), max(ys), float(layout.get("confidence") or 0.0)))
        return out


def client_from_environment() -> DocumentAIClient | None:
    processor = (os.environ.get("ECOS_DOCUMENT_AI_PROCESSOR") or "").strip()
    return DocumentAIClient(processor, metadata_token_provider()) if processor else None


def page_tiles(width: float, height: float) -> list[fitz.Rect]:
    def starts(total: float) -> list[float]:
        if total <= TILE_POINTS:
            return [0.0]
        n = math.ceil((total - OVERLAP_POINTS) / (TILE_POINTS - OVERLAP_POINTS))
        step = (total - TILE_POINTS) / (n - 1)
        return [i * step for i in range(n)]
    return [fitz.Rect(x, y, min(x + TILE_POINTS, width), min(y + TILE_POINTS, height))
            for y in starts(height) for x in starts(width)]


def tile_core(tile: fitz.Rect, width: float, height: float) -> fitz.Rect:
    half = OVERLAP_POINTS / 2
    return fitz.Rect(tile.x0 + (half if tile.x0 > 0 else 0), tile.y0 + (half if tile.y0 > 0 else 0),
                     tile.x1 - (half if tile.x1 < width else 0), tile.y1 - (half if tile.y1 < height else 0))


def is_blank(page: fitz.Page, tile: fitz.Rect) -> bool:
    pix = page.get_pixmap(matrix=fitz.Matrix(20 / 72, 20 / 72), clip=tile, colorspace=fitz.csGRAY, alpha=False)
    samples = pix.samples
    return sum(1 for b in samples if b < 200) < BLANK_DARK_FRACTION * max(1, len(samples))


def _covered(cx: float, cy: float, exact_boxes: list[tuple[float, float, float, float]]) -> bool:
    return any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in exact_boxes)


def document_ai_regions(page: fitz.Page, page_width: float, page_height: float,
                        exact_regions: list[dict[str, Any]], client: DocumentAIClient | None,
                        *, workers: int = 4) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Regions from Document AI for one page, plus a diagnostic record.

    ``exact_regions`` are the page's native-text and AutoCAD-comment regions
    (normalized x/y/width/height); a Document AI line whose centre falls inside
    one of them (with a small margin) is dropped.
    """
    if client is None:
        return [], {"status": "off"}
    tiles = [t for t in page_tiles(page_width, page_height) if not is_blank(page, t)][:MAX_TILES_PER_PAGE]
    images = [(t, page.get_pixmap(matrix=fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72), clip=t,
                                  colorspace=fitz.csGRAY, alpha=False).tobytes("png")) for t in tiles]
    exact_boxes = []
    for r in exact_regions:
        try:
            x, y, w, h = (float(r[k]) for k in ("x", "y", "width", "height"))
        except (KeyError, TypeError, ValueError):
            continue
        m = 0.1 * h
        exact_boxes.append((x - m, y - m, x + w + m, y + h + m))

    def read(item):
        tile, png = item
        try:
            return tile, client.lines(png)
        except DocumentAIUnavailable:
            return tile, None

    regions: list[dict[str, Any]] = []
    failed = dropped_exact = dropped_low = 0
    with ThreadPoolExecutor(max(1, workers)) as pool:
        results = list(pool.map(read, images))
    for tile, lines in results:
        if lines is None:
            failed += 1
            continue
        core = tile_core(tile, page_width, page_height)
        for text, x0, y0, x1, y1, confidence in lines:
            ax0, ay0 = tile.x0 + x0 * tile.width, tile.y0 + y0 * tile.height
            ax1, ay1 = tile.x0 + x1 * tile.width, tile.y0 + y1 * tile.height
            cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
            if not core.contains(fitz.Point(cx, cy)) or ax1 <= ax0 or ay1 <= ay0:
                continue
            if confidence < MIN_CONFIDENCE:
                dropped_low += 1
                continue
            if _covered(cx / page_width, cy / page_height, exact_boxes):
                dropped_exact += 1
                continue
            regions.append({
                "id": f"docai-{len(regions)}", "text": text, "label": text[:240],
                "x": ax0 / page_width, "y": ay0 / page_height,
                "width": (ax1 - ax0) / page_width, "height": (ay1 - ay0) / page_height,
                "absoluteX": ax0, "absoluteY": ay0, "confidence": round(confidence, 3),
                "source": SOURCE, "textOrigin": TEXT_ORIGIN,
            })
    status = "complete" if not failed else ("failed" if failed == len(images) else "partial")
    return regions, {"status": status, "tiles": len(images), "failedTiles": failed, "lines": len(regions),
                     "droppedOverExactText": dropped_exact, "droppedLowConfidence": dropped_low}
