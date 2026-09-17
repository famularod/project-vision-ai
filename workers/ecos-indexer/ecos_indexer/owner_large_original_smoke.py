"""Offline Linux large-original mechanism check. No network or live authority.

Synthetic 140,164,269-byte PDF; fake claim transport, real Linux seals, real
ClamAV, real PDF measurement/render/OCR. Never an end-user accuracy test.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import resource
import threading
import time


def synthetic_gateway(digest, length):
    from .owner_execution import OwnerExecutionIdentity
    from .owner_execution_gateway import OwnerExecutionGateway
    from .owner_service_limits import OWNER_CLAIM_LIFETIME_SECONDS
    uid = lambda n: f'70000000-0000-4000-8000-{n:012d}'
    request = dict(schema_version='ecos-owner-source-execution-request/2.0', publication_mode='shadow',
        execution_id=uid(1),request_id=uid(2),owner_id=uid(3),project_id=uid(4),source_id='synthetic-large-pdf',
        source_sha256=digest,source_revision='1',source_page_count=1,extraction_version='ecos-owner-native-preview/2.0',
        authority_decision_id=uid(5),authority_receipt_sha256='b'*64,managed_attempt_id=uid(6),
        managed_receipt_sha256='c'*64,expected_previous_binding_id=None)
    identity = OwnerExecutionIdentity.from_service_request(request, expected_byte_length=length)
    class Response:
        status_code=200
        history=[]
        headers={'Content-Type':'application/json'}
        def __init__(self, value, url): self.data=json.dumps(value).encode(); self.url=url
        def iter_content(self, chunk_size):
            for offset in range(0,len(self.data),chunk_size): yield self.data[offset:offset+chunk_size]
        def close(self): pass
    def post(url, **kwargs):
        assert url.endswith('/ecos_v3_claim_owner_source_execution'), 'offline_claim_only'
        started=datetime.now(timezone.utc)
        r={k:request[k] for k in ('execution_id','owner_id','project_id','source_id','source_sha256','source_revision','source_page_count','extraction_version')}
        r.update(schema_version='ecos-owner-source-execution-control/2.0',publication_mode='shadow',execution_kind='owner_preview',
            organization_id=uid(3),binding_id=uid(2),binding_version=1,affected_binding_id=uid(2),outcome='claimed',state='running',
            native_readiness='not_assessed',retrieval_authorized=False,
            claim=dict(claim_id=uid(9),binding_id=uid(2),claimed_at=started.isoformat(),
                expires_at=(started+timedelta(seconds=OWNER_CLAIM_LIFETIME_SECONDS)).isoformat(),status='active',
                measurement_json=None,measurement_sha256=None,registered_at=None),
            source=dict(source_sha256=digest,source_revision='1',source_page_count=1,byte_length=length,
                bucket='project-documents',object_key=identity.object_key,managed_attempt_id=uid(6),managed_receipt_sha256='c'*64,
                verification='trusted_service_attested_storage_readback_not_current_download_proof'))
        return Response(r,url)
    gateway=OwnerExecutionGateway(identity,service_role_key='synthetic-offline-no-credential',post=post)
    return gateway,gateway.claim(uid(9))


def main():
    import pymupdf as fitz
    from .owner_original_spool import spool_owner_original, OwnerOriginalSpoolError
    from .owner_clamd_scanner import start_owner_clamd_scanner
    from .owner_original_fd_page_reader import read_owner_original_spool_pages
    started=time.monotonic(); stop=threading.Event(); target=140164269
    with fitz.open() as doc:
        page=doc.new_page(width=400,height=500)
        page.insert_text((35,45),'SYNTHETIC LARGE SOURCE. NOT PROJECT EVIDENCE.',fontsize=11)
        small=doc.tobytes()
    # Valid PDF followed by comment padding. This tests actual source byte
    # admission, not the complexity or semantic correctness of a real drawing.
    def chunks():
        yield small
        remain=target-len(small)
        block=b'\n%'+b'x'*65533+b'\n'
        while remain:
            part=block[:min(remain,len(block))]; yield part; remain-=len(part)
    h=hashlib.sha256()
    for part in chunks(): h.update(part)
    digest=h.hexdigest(); gateway,claim=synthetic_gateway(digest,target)
    original=None
    try:
        with spool_owner_original(gateway,claim,chunks(),timeout_seconds=30) as original:
            assert original.pins['byte_length']==target
            with start_owner_clamd_scanner(cancel_event=stop) as scanner:
                packet=read_owner_original_spool_pages(gateway,claim,original,pages=[1],
                    total_timeout=240,stage_timeout=60,dpi=100,psm=11,cancel_event=stop,
                    scanner_service=scanner,independent_images=True)
            assert packet['measurement']=={'source_sha256':digest,'byte_length':target,'source_page_count':1}
            assert packet['selected_pages']==[1]
            assert packet['retrieval_authorized'] is False and packet['semantic_verified'] is False
            assert packet['images'][0]['raster_png'], 'independent_raster_missing'
            from .owner_page_processing import _separate_sealed_images, _validate_batch
            batch, images = _separate_sealed_images(packet,gateway.identity,[1])
            _validate_batch(batch,gateway.identity,[1])
            assert len(images)==1 and images[0][0], 'image_payload_missing'
        assert original.closed
        cancelled=threading.Event(); cancelled.set()
        try:
            spool_owner_original(gateway,claim,chunks(),cancel_event=cancelled)
            raise AssertionError('cancel_not_enforced')
        except OwnerOriginalSpoolError as error: assert error.code=='cancelled'
        print(json.dumps({'schema_version':'ecos-large-original-smoke/1','status':'passed',
            'sourceBytes':target,'pagesRead':[1],'scan':'real_clamd_clean','originalClosed':original.closed,
            'seconds':round(time.monotonic()-started,2),'parentPeakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'largestChildPeakRssKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
            'scope':'offline_synthetic_mechanism_only_not_customer_acceptance'}))
        return 0
    finally:
        if original is not None and not original.closed: original.close()


if __name__=='__main__': raise SystemExit(main())
