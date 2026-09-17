"""Offline image proof: actual installed scanner and three-lane PDF reader.

Used only by the separate build config with --network=none and no secrets.
Passing is image interoperability, not customer construction-answer accuracy.
"""
import hashlib
import json
import threading
import time


def main() -> int:
    from .owner_worker_main import verify_owner_runtime
    from .owner_source_scan import OwnerSourceScanner
    from .original_document_reader import read_original_document_pages
    from .owner_page_raster_gateway import _png_measurement
    import pymupdf as fitz
    stop=threading.Event()
    verify_owner_runtime(stop)
    with fitz.open() as document:
        page=document.new_page(width=400,height=500)
        page.insert_text((35,45),"NOT APPROVED. VERIFY ORIGINAL DRAWING.",fontsize=14)
        for x in (35,200,360):page.draw_line((x,90),(x,170))
        for y in (90,130,170):page.draw_line((35,y),(360,y))
        page.insert_text((40,115),"Task");page.insert_text((205,115),"Status")
        page.insert_text((40,155),"Steel");page.insert_text((205,155),"NOT READY")
        document.new_page(width=400,height=500)
        rotated=document.new_page(width=400,height=500)
        rotated.insert_text((40,80),"ROTATED SOURCE. DO NOT GUESS.",fontsize=14)
        rotated.set_rotation(90)
        original=document.tobytes()
    digest=hashlib.sha256(original).hexdigest()
    OwnerSourceScanner().scan(original,expected_sha256=digest,deadline_monotonic=time.monotonic()+25,cancel_event=stop)
    packet=read_original_document_pages(original,expected_sha256=digest,expected_page_count=3,pages=[1,2,3],dpi=100,total_timeout=100)
    pages=packet["pages"]
    assert packet["retrieval_authorized"] is False and packet["semantic_verified"] is False
    assert pages[0]["payload"]["native"]["state"]=="partial"
    assert pages[0]["payload"]["table"]["state"]=="partial"
    assert pages[1]["payload"]["visual"]["state"]=="unreadable"
    for number,item in enumerate(pages,1):
        obs=item["payload"]["visual"]["observations"]
        assert obs is not None and obs["source"]["page_number"]==number
        assert hashlib.sha256(item["raster_png"]).hexdigest()==obs["raster"]["sha256"]
        assert _png_measurement(item["raster_png"])==(obs["raster"]["width"],obs["raster"]["height"])
    assert "NOT" in [word["text"] for line in pages[0]["payload"]["visual"]["observations"]["lines"] for word in line["words"]]
    print(json.dumps({"schema_version":"ecos-owner-image-smoke/2.1","status":"passed","page_count":3,
        "scope":"synthetic_pdf_and_installed_engines_only","retrieval_authorized":False,"semantic_verified":False}))
    return 0


if __name__=="__main__":raise SystemExit(main())
