"""Bounded original-page images independent of OCR; not wired to owner retrieval.

Rendering establishes exact image bytes and a physical page locator, not readable
text, semantic truth, malware clearance, current ownership or answer authority.
Source and returned-byte limits do not bound total process working-set memory.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
import threading
import time

from . import original_visual_reader as engine

MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_RASTER_BYTES = 32 * 1024 * 1024
MAX_RETAINED_BYTES = 64 * 1024 * 1024


def render_original_page_images(original: bytes, *, expected_sha256: str,
                                expected_page_count: int, pages: list[int],
                                total_timeout: float = 90, stage_timeout: float = 20,
                                dpi: int = 250,
                                cancel_event: threading.Event | None = None) -> dict:
    started = time.monotonic()
    if cancel_event is not None and type(cancel_event) is not threading.Event:
        raise engine.DiagnosticError('invalid_cancellation_signal')
    if type(original) is not bytes or not 0 < len(original) <= MAX_SOURCE_BYTES:
        raise engine.DiagnosticError('original_raster_source_byte_limit')
    if (type(expected_sha256) is not str or not re.fullmatch(r'[0-9a-f]{64}', expected_sha256)
            or hashlib.sha256(original).hexdigest() != expected_sha256):
        raise engine.DiagnosticError('original_raster_source_sha256_mismatch')
    engine.integer(expected_page_count, 1, 10000, 'page_count_out_of_bounds')
    engine.integer(dpi, 72, 400, 'dpi_out_of_bounds')
    if (type(pages) is not list or not 1 <= len(pages) <= 8
            or any(type(p) is not int or not 1 <= p <= expected_page_count for p in pages)
            or pages != sorted(set(pages))):
        raise engine.DiagnosticError('explicit_sorted_unique_selected_pages_required')
    if (any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in (total_timeout, stage_timeout))
            or total_timeout > 110 or stage_timeout > 60):
        raise engine.DiagnosticError('original_raster_timeout_out_of_bounds')
    selected = list(pages)
    deadline = started + total_timeout

    def check():
        if cancel_event is not None and cancel_event.is_set():
            raise engine.DiagnosticError('original_processing_cancelled')
        if time.monotonic() >= deadline:
            raise engine.DiagnosticError('original_raster_deadline_exceeded')

    def execute(argv, limit, timeout=None):
        check()
        result = engine.run_bounded(argv, min(stage_timeout if timeout is None else timeout,
                                             deadline-time.monotonic()), limit, cancel_event=cancel_event)
        check()
        return result

    check()
    renderer, identity = engine.installed_engine('pdftoppm', None)
    out, err = execute([renderer, '-v'], 16384, 5)
    version = (out+err).decode('utf-8', 'strict').splitlines()[0][:256]
    results = []; retained = 0
    with tempfile.TemporaryDirectory(prefix='ecos-original-raster-reader-') as directory:
        snapshot = Path(directory)/'original.pdf'
        snapshot.write_bytes(original)
        snapshot.chmod(0o600)
        raw, _ = execute([sys.executable, str(Path(engine.__file__).resolve()), '--inspect',
                          str(snapshot), '--pages', ','.join(map(str, selected))], 16384, 15)
        metadata = json.loads(raw)
        if (metadata.get('source_page_count') != expected_page_count
                or [p.get('page_number') for p in metadata.get('pages', [])] != selected):
            raise engine.DiagnosticError('original_raster_page_identity_mismatch')
        for page in metadata['pages']:
            width, height = engine.raster_size(page['display_width_points'], page['display_height_points'],
                                               dpi, 16_000_000, 6000)
            raster, _ = execute([renderer, '-q', '-scale-dimension-before-rotation', '-f', str(page['page_number']),
                '-l', str(page['page_number']), '-singlefile', '-cropbox', '-gray', '-r', str(dpi),
                '-scale-to-x', str(width), '-scale-to-y', str(height), '-png', str(snapshot)], MAX_RASTER_BYTES)
            if engine.png_size(raster, 16_000_000, 6000) != (width, height):
                raise engine.DiagnosticError('rendered_dimensions_mismatch')
            entry = {**page, 'state': 'rendered',
                'raster_sha256': hashlib.sha256(raster).hexdigest(), 'raster_byte_count': len(raster),
                'raster_width': width, 'raster_height': height,
                'effective_dpi': min(width*72/page['display_width_points'], height*72/page['display_height_points']),
                'coordinate_system': 'rotated_display_cropbox_pixels_top_left',
                'ocr_state': 'not_attempted', 'semantic_verified': False, 'retrieval_authorized': False}
            retained += len(raster) + len(json.dumps(entry, allow_nan=False).encode('utf-8'))
            if retained > MAX_RETAINED_BYTES:
                raise engine.DiagnosticError('original_raster_retained_byte_limit')
            results.append({**entry, 'raster_png': raster})
        # A derivative is never returned under an unchanged original pin if the
        # private snapshot was altered during inspection/rendering.
        with snapshot.open('rb') as stream:
            readback = stream.read(MAX_SOURCE_BYTES+1)
        if len(readback) != len(original) or hashlib.sha256(readback).hexdigest() != expected_sha256:
            raise engine.DiagnosticError('original_raster_snapshot_drift')
        check()
    check()
    return {'schema_version': 'ecos-original-page-images/2.1', 'source_sha256': expected_sha256,
        'source_byte_count': len(original), 'source_page_count': expected_page_count, 'selected_pages': selected,
        'coverage': 'selected_pages_only', 'pages': results,
        'renderer': {**identity, 'version': version},
        'renderer_config': {'cropbox': True, 'grayscale': True, 'requested_dpi': dpi,
                            'max_pixels': 16_000_000, 'max_dimension': 6000},
        'ocr_attempted': False, 'semantic_verified': False, 'retrieval_authorized': False,
        'limitations': ['image_copy_only_not_semantic_verification', 'ocr_not_performed',
                       'current_source_and_owner_binding_required', 'hosted_registration_not_performed']}
