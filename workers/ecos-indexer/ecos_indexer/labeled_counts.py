"""Bounded re-reading of explicit count labels, never digit correction.

This produces coordinate OCR, not a semantic or publication decision. Existing
source identity, page assurance and final answer/proof checks still apply.
"""
from __future__ import annotations

import math
import re
from typing import Any, Callable

import pymupdf as fitz

MAX_COUNT_TARGETS = 2
MIN_LABEL_CONFIDENCE = 0.5
MIN_NUMBER_CONFIDENCE = 0.65
MAX_RENDER_PIXELS = 4_000_000
MAX_RENDER_EDGE = 6000


def bounds(region: dict[str, Any]) -> dict[str, float] | None:
    values = [region.get(k) for k in ("x", "y", "width", "height")]
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        return None
    x, y, w, h = values
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > 1.000001 or y + h > 1.000001:
        return None
    return dict(zip(("x", "y", "width", "height"), values))


def confidence(region: dict[str, Any]) -> float:
    value = region.get("confidence")
    return float(value) if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1 else 0.0


def union(regions: list[dict[str, Any]]) -> dict[str, float]:
    x, y = min(r["x"] for r in regions), min(r["y"] for r in regions)
    return {"x": x, "y": y,
            "width": max(r["x"] + r["width"] for r in regions) - x,
            "height": max(r["y"] + r["height"] for r in regions) - y}


def label_key(region: dict[str, Any]) -> str:
    return re.sub(r"[\s.!:\[\]()]+", " ", str(region.get("text") or "").upper()).strip()


def count_label_targets(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    eligible = [r for r in regions if bounds(r) and confidence(r) >= MIN_LABEL_CONFIDENCE
                and r.get("searchable") is not False and r.get("ocrRotationDegrees", 0) == 0]
    targets: list[dict[str, Any]] = []
    for region in eligible:
        key = label_key(region)
        parts = [region]
        if key == "LOAD":
            prefixes = [p for p in eligible if label_key(p) in ("OCC", "OCCUPANT", "OCCUPANCY")
                        and p.get("source") == region.get("source")
                        and 0 <= region["x"] - p["x"] - p["width"] <= 0.012
                        and abs(p["y"] + p["height"] / 2 - region["y"] - region["height"] / 2)
                        <= min(p["height"], region["height"]) / 2]
            if len(prefixes) != 1:
                continue
            parts = [prefixes[0], region]
        elif key not in ("QTY", "QUANTITY", "COUNT", "OCC LOAD", "OCCUPANT LOAD", "OCCUPANCY LOAD"):
            continue
        b = union(parts)
        if b["width"] > 0.08 or b["height"] > 0.012:
            continue
        if any(abs(t["bounds"]["x"] - b["x"]) < 0.005 and
               abs(t["bounds"]["y"] - b["y"]) < b["height"] for t in targets):
            continue
        targets.append({"bounds": b, "parts": parts, "label": " ".join(str(p["text"]) for p in parts)})
        if len(targets) == MAX_COUNT_TARGETS:
            break
    return targets


def overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    width = min(left["x"] + left["width"], right["x"] + right["width"]) - max(left["x"], right["x"])
    height = min(left["y"] + left["height"], right["y"] + right["height"]) - max(left["y"], right["y"])
    return max(0, width) * max(0, height) >= 0.5 * max(left["width"] * left["height"], right["width"] * right["height"])


def adjacent_number(rows: list[dict[str, Any]], label: dict[str, float]) -> dict[str, Any] | None:
    # Only literal integer tokens are admissible. Never turn O/D/Z into digits,
    # remove a unit, select one of several values, or join separate text lines.
    near = [r for r in rows if r.get("ocrKind") == "word" and bounds(r)
            and -0.001 <= r["x"] - label["x"] - label["width"] <= 0.028
            and abs(r["y"] + r["height"] / 2 - label["y"] - label["height"] / 2) <= label["height"]]
    content = [r for r in near if re.search(r"[A-Za-z0-9]", str(r.get("text") or ""))]
    if len(content) != 1:
        return None
    number = content[0]
    if number["x"] + number["width"] > label["x"] + label["width"] + 0.026:
        return None  # right-edge clipping cannot establish a complete number
    if confidence(number) < MIN_NUMBER_CONFIDENCE or not re.fullmatch(r"[\[(]?\d{1,5}[\])]?[.,]?", str(number.get("text") or "")):
        return None
    return number


def reread_labeled_counts(page: fitz.Page, targets: list[dict[str, Any]], reader: Callable[..., list[dict[str, Any]]]) -> list[dict[str, Any]]:
    result = []
    width, height = float(page.rect.width), float(page.rect.height)
    for index, target in enumerate(targets[:MAX_COUNT_TARGETS]):
        b = target["bounds"]
        pad = max(0.002, b["height"] * 0.45)
        x0, y0 = max(0, b["x"] - 0.008), max(0, b["y"] - pad)
        x1, y1 = min(1, b["x"] + b["width"] + 0.028), min(1, b["y"] + b["height"] + pad)
        clip = fitz.Rect(width*x0, height*y0, width*x1, height*y1)
        # Apply the render cap BEFORE allocation, even for oversized sheets.
        px, py = math.ceil(clip.width * 600 / 72), math.ceil(clip.height * 600 / 72)
        if max(px, py) > MAX_RENDER_EDGE or px * py > MAX_RENDER_PIXELS:
            continue
        observations = []
        for dpi in (450, 600):
            rows = reader(page, clip, width, height, dpi=dpi, config="--psm 7",
                          prefix=f"targeted-count-{index}-{dpi}", source=f"targeted_count_coordinate_ocr_{dpi}",
                          minimum_confidence=0.0, timeout_seconds=10)
            number = adjacent_number(rows, b)
            if number is None:
                break
            observations.append(number)
        if len(observations) != 2:
            continue
        a, c = observations
        if re.sub(r"\D", "", a["text"]) != re.sub(r"\D", "", c["text"]) or not overlap(a, c):
            continue
        text = target["label"] + " " + a["text"]
        result.append({"id": f"targeted-count-corroborated-{index}", "text": text, "label": text,
                       **union([b, a, c]), "source": "targeted_count_coordinate_ocr_dual_dpi",
                       "confidence": min(confidence(p) for p in [*target["parts"], a, c]),
                       "ocrValidationStatus": "dual_dpi_labeled_count_corroborated",
                       "constituentEvidence": target["parts"], "corroboratingEvidence": observations})
    return result
