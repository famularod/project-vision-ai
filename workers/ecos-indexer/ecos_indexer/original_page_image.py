"""Versioned, source-pinned render metadata, independent of OCR observations.

This is a trusted-worker measurement, not proof of safety, ownership or meaning.
The owner workflow must scan the original and bind a current checkpoint; a fresh
Storage GET/hash/full PNG decode remains mandatory before any image is usable.
"""
from __future__ import annotations

import hashlib
import json

from .owner_execution import decode_json, exact_object, integer, SHA

SCHEMA = "ecos-original-page-image/2.2"
COORDINATES = "rotated_display_cropbox_pixels_top_left"
KEYS = frozenset("schema_version source_sha256 source_page_count page_number state raster_sha256 raster_byte_count raster_width raster_height coordinate_system renderer_sha256 renderer_version requested_dpi ocr_attempted semantic_verified retrieval_authorized".split())
MAX_PAYLOAD_BYTES = 4096


def decode_original_page_image(raw: str, *, source_sha256: str, source_page_count: int,
                               page_number: int) -> dict:
    if type(raw) is not str or len(raw.encode('utf-8')) > MAX_PAYLOAD_BYTES:
        raise ValueError('Invalid original image metadata')
    image = exact_object(decode_json(raw.encode('utf-8'), MAX_PAYLOAD_BYTES), KEYS)
    for key, expected in (("schema_version", SCHEMA), ("source_sha256", source_sha256),
                          ("source_page_count", source_page_count), ("page_number", page_number),
                          ("state", "rendered"), ("coordinate_system", COORDINATES),
                          ("ocr_attempted", False), ("semantic_verified", False), ("retrieval_authorized", False)):
        if type(image[key]) is not type(expected) or image[key] != expected:
            raise ValueError('Original image identity mismatch')
    for key in ('source_sha256', 'raster_sha256', 'renderer_sha256'):
        if type(image[key]) is not str or not SHA.fullmatch(image[key]):
            raise ValueError('Original image hash required')
    integer(image['source_page_count'], 1, 10000)
    integer(image['page_number'], 1, image['source_page_count'])
    integer(image['raster_byte_count'], 33, 32 * 1024 * 1024)
    width = integer(image['raster_width'], 1, 6000)
    height = integer(image['raster_height'], 1, 6000)
    if width * height > 16_000_000:
        raise ValueError('Original image pixel budget exceeded')
    integer(image['requested_dpi'], 72, 400)
    version = image['renderer_version']
    if type(version) is not str or not 1 <= len(version) <= 256 or any(not ' ' <= c <= '~' for c in version):
        raise ValueError('Original renderer version required')
    return image


def original_page_image_payload(batch: dict, index: int) -> str:
    """Extract one exact selected-page measurement without executable paths."""
    if (batch['schema_version'] != 'ecos-original-page-images/2.1'
            or batch['coverage'] != 'selected_pages_only'
            or any(batch[k] is not False for k in ('ocr_attempted', 'semantic_verified', 'retrieval_authorized'))):
        raise ValueError('Original image batch required')
    page = batch['pages'][index]
    if (page['page_number'] != batch['selected_pages'][index] or page['state'] != 'rendered'
            or page['ocr_state'] != 'not_attempted'
            or any(page[k] is not False for k in ('semantic_verified', 'retrieval_authorized'))):
        raise ValueError('Exact rendered page required')
    config = batch['renderer_config']
    if (config['cropbox'] is not True or config['grayscale'] is not True
            or config['max_pixels'] != 16_000_000 or config['max_dimension'] != 6000):
        raise ValueError('Bounded original renderer configuration required')
    png = page['raster_png']
    if (type(png) is not bytes or len(png) != page['raster_byte_count']
            or hashlib.sha256(png).hexdigest() != page['raster_sha256']):
        raise ValueError('Exact original PNG bytes required')
    image = {k: page[k] for k in ('page_number', 'state', 'raster_sha256', 'raster_byte_count',
                                  'raster_width', 'raster_height', 'coordinate_system')}
    image.update(schema_version=SCHEMA, source_sha256=batch['source_sha256'], source_page_count=batch['source_page_count'],
                 renderer_sha256=batch['renderer']['invoked_executable_sha256'], renderer_version=batch['renderer']['version'],
                 requested_dpi=config['requested_dpi'], ocr_attempted=False, semantic_verified=False, retrieval_authorized=False)
    raw = json.dumps(image, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    decode_original_page_image(raw, source_sha256=batch['source_sha256'], source_page_count=batch['source_page_count'], page_number=page['page_number'])
    return raw
