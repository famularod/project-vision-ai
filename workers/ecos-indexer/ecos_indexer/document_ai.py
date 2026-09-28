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
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable

import pymupdf as fitz

SOURCE = "google_docai_ocr_region"
TEXT_ORIGIN = "google_document_ai_ocr"
TILE_POINTS = 12 * 72          # 12-inch tiles: 3600 px at 300 DPI (13 MP, under the 40 MP limit)
OVERLAP_POINTS = 0.5 * 72
RENDER_DPI = 300
MIN_CONFIDENCE = 0.5
MAX_TILES_PER_PAGE = 40
# Wall-clock budget for one page's Document AI requests, counted from the first
# request. Without it a slow service held the page for every queued tile (up to
# 40 tiles x 120 s / 4 workers) and the worker's page deadline could not stop
# the threads. Tiles not read within it are counted, never hidden.
PAGE_TIME_BUDGET_SECONDS = 300.0
BLANK_DARK_FRACTION = 0.002
# A line whose box reaches this close to an inner tile edge was cut off by the
# tile; the neighbouring tile, whose core owns it, reads it whole.
TILE_EDGE_POINTS = 2.0
ENDPOINT = "https://us-documentai.googleapis.com/v1/{processor}:process"
METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"


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
        """Lines on one image: (text, x0, y0, x1, y1, confidence), boxes 0-1 of the image.

        Every failure (access token, network, HTTP, JSON, or a response of an
        unexpected shape) raises DocumentAIUnavailable, so it fails one tile,
        visibly, instead of the whole indexing job.
        """
        try:
            authorization = "Bearer " + self.token()
        except Exception as error:  # e.g. metadata server unreachable: the tile fails, visibly
            raise DocumentAIUnavailable("token:" + type(error).__name__) from error
        body = json.dumps({"rawDocument": {"content": base64.b64encode(png).decode("ascii"),
                                           "mimeType": "image/png"}}).encode("utf-8")
        request = urllib.request.Request(ENDPOINT.format(processor=self.processor), data=body, method="POST",
                                         headers={"Authorization": authorization,
                                                  "Content-Type": "application/json"})
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as error:  # network, HTTP or JSON: the tile fails, visibly
            raise DocumentAIUnavailable(type(error).__name__) from error
        try:
            return self._parse(payload)
        except Exception as error:  # a 200 response of an unexpected shape: the tile fails, visibly
            raise DocumentAIUnavailable("response:" + type(error).__name__) from error

    @staticmethod
    def _parse(payload: Any) -> list[tuple[str, float, float, float, float, float]]:
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


def tile_cores(width: float, height: float) -> dict[tuple[float, float], fitz.Rect]:
    """Each tile's core: every overlap between neighbouring tiles is split at
    its middle, so each point of the page belongs to exactly one tile.

    (27 Sep review) The earlier core trimmed only OVERLAP_POINTS / 2 from each
    inner edge while the real overlap is 2-6 inches (tiles are spread evenly),
    so cores overlapped by up to 5.5 inches and a label cut off at one tile's
    edge was published beside the whole reading from its neighbour.
    """
    def bounds(total: float) -> list[tuple[float, float, float]]:
        spans = sorted({(round(t.x0, 3), round(t.x1, 3)) for t in page_tiles(total, TILE_POINTS)}) \
            if total > 0 else []
        out = []
        for i, (a, b) in enumerate(spans):
            lo = 0.0 if i == 0 else (a + spans[i - 1][1]) / 2
            hi = total if i == len(spans) - 1 else (spans[i + 1][0] + b) / 2
            out.append((a, lo, hi))
        return out
    xs, ys = bounds(width), bounds(height)
    return {(x0, y0): fitz.Rect(xlo, ylo, xhi, yhi) for (y0, ylo, yhi) in ys for (x0, xlo, xhi) in xs}


def cut_by_tile_edge(tile: fitz.Rect, width: float, height: float,
                     x0: float, y0: float, x1: float, y1: float) -> bool:
    """True when the line's box touches an inner tile edge (not a page edge)."""
    e = TILE_EDGE_POINTS
    return ((tile.x0 > 0 and x0 <= tile.x0 + e) or (tile.x1 < width and x1 >= tile.x1 - e)
            or (tile.y0 > 0 and y0 <= tile.y0 + e) or (tile.y1 < height and y1 >= tile.y1 - e))


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
    all_tiles = page_tiles(page_width, page_height)
    inked = [t for t in all_tiles if not is_blank(page, t)]
    tiles = inked[:MAX_TILES_PER_PAGE]
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
    cores = tile_cores(page_width, page_height)
    failed = over_budget = dropped_exact = dropped_low = dropped_edge = 0
    # Not a ``with`` block: leaving one waits for every queued tile, even when
    # the budget or the worker's page deadline has already run out. Tiles still
    # queued at the budget are cancelled (never sent); a tile already in flight
    # ends within the client's own timeout and its late answer is discarded.
    pool = ThreadPoolExecutor(max(1, workers))
    try:
        futures = [pool.submit(read, item) for item in images]
        done, _ = wait(futures, timeout=PAGE_TIME_BUDGET_SECONDS)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    results = []
    for future in futures:  # tile order, so region ids stay deterministic
        if future in done:
            results.append(future.result())
        else:
            over_budget += 1
    failed += over_budget
    for tile, lines in results:
        if lines is None:
            failed += 1
            continue
        core = cores[(round(tile.x0, 3), round(tile.y0, 3))]
        for text, x0, y0, x1, y1, confidence in lines:
            ax0, ay0 = tile.x0 + x0 * tile.width, tile.y0 + y0 * tile.height
            ax1, ay1 = tile.x0 + x1 * tile.width, tile.y0 + y1 * tile.height
            cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
            if not core.contains(fitz.Point(cx, cy)) or ax1 <= ax0 or ay1 <= ay0:
                continue
            if cut_by_tile_edge(tile, page_width, page_height, ax0, ay0, ax1, ay1):
                dropped_edge += 1
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
    # Coverage: pageTiles = blankTilesSkipped + tilesOverLimit + tiles; failedTiles
    # (of ``tiles``) includes tilesOverTimeBudget.
    return regions, {"status": status, "tiles": len(images), "failedTiles": failed, "lines": len(regions),
                     "pageTiles": len(all_tiles), "blankTilesSkipped": len(all_tiles) - len(inked),
                     "tilesOverLimit": len(inked) - len(tiles), "tilesOverTimeBudget": over_budget,
                     "droppedOverExactText": dropped_exact, "droppedLowConfidence": dropped_low,
                     "droppedAtTileEdge": dropped_edge}
