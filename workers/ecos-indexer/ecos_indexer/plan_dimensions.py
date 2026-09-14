"""Bounded full-span dimension detection. Geometry locates labels, never supplies sizes."""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Callable
from .measurement_correction import CORRECTION_SOURCE
import pymupdf as fitz

TOLERANCE = 0.0015
PLAN_TITLE = re.compile(r"\b(?:ANCHOR\s+ROD\s+PLAN|PRIMARY\s+AND\s+ROOF\s+BRACING\s+PLAN)\b", re.I)
DIMENSION = re.compile(r"^\s*(\d{1,4})\s*['’′]\s*-?\s*(\d{1,2})\s*[\"”″]\s*$")


def rectangular_plan_candidates(page: fitz.Page) -> list[dict[str, Any]]:
    continuous = continuous_plan_candidates(page)
    return continuous if continuous else interrupted_plan_candidates(page)


def continuous_plan_candidates(page: fitz.Page) -> list[dict[str, Any]]:
    drawings = page.get_drawings()
    if len(drawings) > 200_000:
        return []
    horizontal, vertical = {}, {}
    for drawing_index, drawing in enumerate(drawings):
        for index, item in enumerate(drawing.get("items") or []):
            if not item or item[0] != "l":
                continue
            start, end = item[1] * page.rotation_matrix, item[2] * page.rotation_matrix
            x0, x1 = sorted([start.x / page.rect.width, end.x / page.rect.width])
            y0, y1 = sorted([start.y / page.rect.height, end.y / page.rect.height])
            if not all(math.isfinite(value) and 0 <= value <= 1 for value in [x0, y0, x1, y1]):
                continue
            target = horizontal if y1-y0 < 0.0001 and x1-x0 >= 0.12 else vertical if x1-x0 < 0.0001 and y1-y0 >= 0.12 else None
            if target is None:
                continue
            key = tuple(round(value, 4) for value in (x0, y0, x1, y1))
            target[key] = {"id": f"pdf-line-{drawing_index}-{index}", "bounds": key}
            if len(horizontal) + len(vertical) > 200:
                return []
    candidates = []
    near = lambda a,b: abs(a-b) <= TOLERANCE
    for upper in horizontal.values():
        x0,y0,x1,_ = upper["bounds"]
        if x0 < 0.03 or x1 > 0.97 or x1-x0 > 0.85:
            continue
        for lower in horizontal.values():
            a,y1,b,_ = lower["bounds"]
            if not (near(a,x0) and near(b,x1) and 0.12 <= y1-y0 <= 0.70 and y1 < 0.85):
                continue
            sides = [line for line in vertical.values() if near(line["bounds"][1],y0) and near(line["bounds"][3],y1)]
            if not any(near(line["bounds"][0],x0) for line in sides) or not any(near(line["bounds"][0],x1) for line in sides):
                continue
            left_rulers = [line for line in sides if 0.008 <= x0-line["bounds"][0] <= 0.06]
            lower_rulers = [line for line in horizontal.values() if near(line["bounds"][0],x0) and near(line["bounds"][2],x1) and 0.008 <= line["bounds"][1]-y1 <= 0.06]
            # More than one full-span exterior ruler is ambiguous, not a cue
            # to pick whichever value is convenient or largest.
            if len(left_rulers) != 1 or len(lower_rulers) != 1:
                continue
            candidates.append({"bounds": (x0,y0,x1,y1), "horizontal": lower_rulers[0], "vertical": left_rulers[0], "outline": [upper,lower,*[line for line in sides if near(line["bounds"][0],x0) or near(line["bounds"][0],x1)]]})
    return candidates


def interrupted_plan_candidates(page: fitz.Page) -> list[dict[str, Any]]:
    drawings = page.get_drawings()
    if len(drawings) > 200_000:
        return []
    horizontal, vertical = {}, {}
    strokes = {"horizontal": {}, "vertical": {}}
    stroke_count = 0
    for drawing_index, drawing in enumerate(drawings):
        for index, item in enumerate(drawing.get("items") or []):
            if not item or item[0] != "l":
                continue
            start, end = item[1] * page.rotation_matrix, item[2] * page.rotation_matrix
            x0, x1 = sorted([start.x / page.rect.width, end.x / page.rect.width])
            y0, y1 = sorted([start.y / page.rect.height, end.y / page.rect.height])
            if not all(math.isfinite(value) and 0 <= value <= 1 for value in [x0, y0, x1, y1]):
                continue
            axis = "horizontal" if y1-y0 < 0.0001 and x1-x0 >= .003 else "vertical" if x1-x0 < .0001 and y1-y0 >= .003 else None
            if axis is None:
                continue
            position = round(y0 if axis == "horizontal" else x0, 4)
            start, end = (x0,x1) if axis == "horizontal" else (y0,y1)
            strokes[axis].setdefault(position, []).append((start,end,f"pdf-line-{drawing_index}-{index}"))
            stroke_count += 1
            if stroke_count > 100_000:
                return []
    # CAD may store a dashed outline or a dimension line interrupted by its
    # printed label as multiple strokes. Join only collinear, tightly bounded
    # gaps; retain every stroke for replay. Never infer dimensions from length.
    for axis, groups in strokes.items():
        target = horizontal if axis == "horizontal" else vertical
        for position, parts in groups.items():
            runs = []
            for a,b,identity in sorted(parts):
                if runs and a-runs[-1][1] <= .020:
                    runs[-1][1] = max(runs[-1][1],b)
                    runs[-1][2].append([a,b,identity])
                else:
                    runs.append([a,b,[[a,b,identity]]])
            for a,b,components in runs:
                if b-a < .12:
                    continue
                key = tuple(round(v,4) for v in ((a,position,b,position) if axis == "horizontal" else (position,a,position,b)))
                target[key] = {"id": "pdf-stroke-run-"+digest(components)[:16], "bounds": key, "strokes": components}
                if len(horizontal)+len(vertical) > 200:
                    return []
    return plans_from_rulers(horizontal, vertical)


def plans_from_rulers(horizontal, vertical):
    candidates = []
    near = lambda a,b: abs(a-b) <= TOLERANCE
    for h in horizontal.values():
        if not single_dimension_stroke(h):
            continue
        x0, hy, x1, _ = h["bounds"]
        for v in vertical.values():
            if not single_dimension_stroke(v):
                continue
            vx, y0, _, y1 = v["bounds"]
            if not (.03 < x0 < x1 < .97 and .12 <= x1-x0 <= .85 and .12 <= y1-y0 <= .7
                and .008 <= x0-vx <= .06 and .008 <= hy-y1 <= .06 and y1 < .85):
                continue
            outline = []
            for bounds, pool in (((x0,y0,x1,y0),horizontal),((x0,y1,x1,y1),horizontal),
                                 ((x0,y0,x0,y1),vertical),((x1,y0,x1,y1),vertical)):
                a,b,c,d = bounds
                matches = [line for line in pool.values() if
                    (near(b,d) and near(line["bounds"][1],b) and line["bounds"][0] <= a+TOLERANCE and line["bounds"][2] >= c-TOLERANCE)
                    or (near(a,c) and near(line["bounds"][0],a) and line["bounds"][1] <= b+TOLERANCE and line["bounds"][3] >= d-TOLERANCE)]
                if len(matches) != 1:
                    break
                outline.append({"id": matches[0]["id"], "bounds": bounds, "coveringStroke": matches[0]})
            if len(outline) == 4:
                candidates.append({"bounds": (x0,y0,x1,y1), "horizontal": h, "vertical": v, "outline": outline})
    return candidates




def single_dimension_stroke(line):
    """A continuous ruler or two halves interrupted only at its label.

    A chain of bay dimensions is not a single overall dimension line.
    """
    parts = sorted({(round(s[0],4),round(s[1],4)) for s in line.get("strokes", [])})
    merged = []
    for a,b in parts:
        if merged and a <= merged[-1][1] + .0001:
            merged[-1][1] = max(merged[-1][1],b)
        else:
            merged.append([a,b])
    if len(merged) == 1:
        return True
    if len(merged) != 2:
        return False
    a,b = merged
    full_mid = (a[0]+b[1])/2
    gap_mid = (a[1]+b[0])/2
    return abs(full_mid-gap_mid) <= .002 and 0 < b[0]-a[1] <= .020



def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def derive_verified_plan_dimensions(analysis, *, project_id, source_sha256, page_number, evidence_version):
    """Replay the source-bound geometry/dual-provider relationship contract.

    The output describes a calculated structural plan footprint, not a printed
    area or roof surface. Raw OCR and vector distances never supply a number.
    """
    from .visual import validated_persisted_visual_evidence, visual_exception_fingerprint
    if analysis is None:
        return [], []
    try:
        context = analysis["context"]
        if (context["schemaVersion"] != "ecos-plan-dimension-relationship/1.0"
            or context["projectId"] != project_id or context["sourceSha256"] != source_sha256
            or context["pageNumber"] != page_number or context["evidenceVersion"] != evidence_version
            or analysis["contextHash"] != digest(context)):
            raise ValueError("identity")
        plan = context["plan"]
        x0, y0, x1, y1 = plan["bounds"]
        heading = context["heading"]
        if (not 0 <= x0 < x1 <= 1 or not 0 <= y0 < y1 <= 1
            or not PLAN_TITLE.search(heading["text"])
            or not x0 <= heading["x"] + heading["width"]/2 <= x1
            or not y1 <= heading["y"] <= y1 + .09):
            raise ValueError("plan")
        near = lambda a, b: abs(a-b) <= TOLERANCE
        segments = [r["bounds"] for r in plan["outline"]]
        expected = [(x0,y0,x1,y0), (x0,y1,x1,y1), (x0,y0,x0,y1), (x1,y0,x1,y1)]
        if len(segments) != 4 or any(not any(all(near(a,b) for a,b in zip(s,e)) for s in segments) for e in expected):
            raise ValueError("outline")
        h, v = plan["horizontal"]["bounds"], plan["vertical"]["bounds"]
        if not (near(h[0],x0) and near(h[2],x1) and near(h[1],h[3]) and .008 <= h[1]-y1 <= .06
                and near(v[1],y0) and near(v[3],y1) and near(v[0],v[2]) and .008 <= x0-v[0] <= .06):
            raise ValueError("ruler")
        targets = analysis["targets"]
        if len(targets) != 2 or {t["planAxis"] for t in targets} != {"horizontal", "vertical"}:
            raise ValueError("axes")
        reads = analysis["reads"]
        if len(reads) != 2:
            return [], ["plan_dimension_reads_incomplete"]
        result, values = [], {}
        for target in targets:
            axis = target["planAxis"]
            if (target["planContextHash"] != analysis["contextHash"]
                or not target["reason"].endswith(f"Plan context {analysis['contextHash']}; axis {axis}.")):
                raise ValueError("target_context")
            ruler = plan[axis]["bounds"]
            cx, cy = (ruler[0]+ruler[2])/2, (ruler[1]+ruler[3])/2
            for candidate in target["diagnosticCandidates"]:
                b = candidate["bounds"]
                dx, dy = abs(b["x"]+b["width"]/2-cx), abs(b["y"]+b["height"]/2-cy)
                if dx > (.025 if axis == "horizontal" else .0075) or dy > (.0075 if axis == "horizontal" else .025):
                    raise ValueError("label_not_at_ruler")
            matching = [r for r in reads if r["regionKey"] == target["regionKey"]]
            if len(matching) != 1:
                raise ValueError("read_identity")
            evidence = matching[0]["evidence"]
            if (evidence.get("evidenceVersion") != evidence_version
                or evidence.get("exceptionFingerprint") != visual_exception_fingerprint(target)):
                raise ValueError("read_epoch")
            verified = validated_persisted_visual_evidence(evidence, target)
            if not verified or len(verified["facts"]) != 1:
                raise ValueError("read_proof")
            fact = verified["facts"][0]
            match = DIMENSION.fullmatch(fact["evidenceText"])
            if not match or not 0 <= int(match[2]) < 12:
                raise ValueError("measurement")
            inches = int(match[1])*12 + int(match[2])
            if not 36 <= inches <= 24000:
                raise ValueError("measurement_range")
            values[axis] = inches
            label = f"OVERALL {'WIDTH' if axis == 'horizontal' else 'LENGTH'}: {fact['evidenceText']}"
            result.append({
                "id": f"plan-overall-{analysis['contextHash'][:16]}-{axis}",
                "text": label, "label": label, "evidenceText": fact["evidenceText"],
                "factKind": "plan_dimension_relationship", "source": "deterministic",
                "searchable": True,
                "confidence": fact["confidence"], **fact["bounds"],
                "reconstructionMethod": "closed_plan_full_span_dual_visual_v1",
                "planContextHash": analysis["contextHash"],
                "constituentEvidence": [fact],
                "corroboratingEvidence": [plan[axis], *plan["outline"], heading],
                "limitation": "Structural plan footprint from printed dimensions; not a printed area or roof surface area.",
            })
        physical_ratio = (x1-x0)*context["pageWidth"]/((y1-y0)*context["pageHeight"])
        # Geometry only rejects contradictory reads. It cannot create a value.
        if not math.isfinite(physical_ratio) or abs((values["horizontal"]/values["vertical"])/physical_ratio-1) > .03:
            raise ValueError("dimension_ratio")
        return result, []
    except (KeyError, TypeError, ValueError, ZeroDivisionError, AttributeError, IndexError):
        return [], ["plan_dimension_proof_invalid"]


def detect_plan_dimension_reads(page, regions, reader, *, project_id, source_sha256, evidence_version):
    """Produce two untrusted label targets, not searchable measurements.

    Limited to one unambiguous closed structural plan with full-span exterior
    rulers and a matching nearby heading. Other drawing types remain on their
    existing extraction path; no generic rectangle-to-building inference.
    """
    headings = [r for r in regions if PLAN_TITLE.search(str(r.get("text") or ""))]
    if not headings:
        return None, []
    candidates = rectangular_plan_candidates(page)
    if len(candidates) != 1:
        return None, []
    plan = candidates[0]
    x0, y0, x1, y1 = plan["bounds"]
    matching = [r for r in headings if
        x0 <= float(r.get("x", -1)) + float(r.get("width", 0))/2 <= x1
        and y1 <= float(r.get("y", -1)) <= y1 + .09]
    if len(matching) != 1:
        return None, []
    context = {
        "schemaVersion": "ecos-plan-dimension-relationship/1.0",
        "projectId": project_id, "sourceSha256": source_sha256,
        "pageNumber": page.number + 1, "evidenceVersion": evidence_version,
        "pageWidth": float(page.rect.width), "pageHeight": float(page.rect.height),
        "plan": plan,
        "heading": {k: matching[0].get(k) for k in ("id", "text", "x", "y", "width", "height")},
    }
    context_hash = digest(context)
    targets = []
    for axis in ("horizontal", "vertical"):
        a, b, c, d = plan[axis]["bounds"]
        cx, cy = (a+c)/2, (b+d)/2
        w, h = (.05, .015) if axis == "horizontal" else (.015, .05)
        clip = fitz.Rect((cx-w/2)*page.rect.width, (cy-h/2)*page.rect.height,
                         (cx+w/2)*page.rect.width, (cy+h/2)*page.rect.height)
        raw = reader(page, clip, page.rect.width, page.rect.height, dpi=600,
            prefix=f"plan-label-{context_hash[:16]}-{axis}", source="untrusted_plan_label",
            config="--psm 11", minimum_confidence=0,
            image_rotation_degrees=270 if axis == "vertical" else 0,
            timeout_seconds=15)
        # A damaged glyph is only a proposal for the independent visual reader.
        # It must never pass the normal OCR confidence gate as an exact number.
        matches = [r for r in raw if re.fullmatch(
            r"""[0-9A-Za-z]{1,4}'-[0-9OQo]{1,2}" """.strip(), str(r.get("text") or ""))]
        unique = {(r["text"], r["x"], r["y"], r["width"], r["height"]): r for r in matches}
        diagnostic = []
        outer = {"x": cx-w/2, "y": cy-h/2, "width": w, "height": h}
        if len(unique) == 1:
            r = next(iter(unique.values()))
            bounds = {k: r[k] for k in ("x", "y", "width", "height")}
            px, py = 3/page.rect.width, 3/page.rect.height
            outer = {"x": bounds["x"]-px, "y": bounds["y"]-py,
                "width": bounds["width"]+2*px, "height": bounds["height"]+2*py}
            diagnostic = [{"text": r["text"], "bounds": bounds,
                "confidence": r["confidence"], "source": CORRECTION_SOURCE}]
        targets.append({
            "regionKey": f"{'low-confidence-ocr' if diagnostic else 'unreadable'}-plan-dimension-{context_hash[:16]}-{axis}",
            "reason": f"Transcribe this complete feet-inch label without calculating or inferring a value. Plan context {context_hash}; axis {axis}.",
            "bounds": outer, "diagnosticCandidates": diagnostic,
            "planContextHash": context_hash, "planAxis": axis,
        })
    return {"context": context, "contextHash": context_hash, "targets": targets, "reads": []}, targets
