"""Prepare ONE isolated replacement page; never publish or mutate its parent."""
from __future__ import annotations

import hashlib
import json
import os
from uuid import UUID

from . import EVIDENCE_VERSION
from .assurance import assure_page
from .document_structure import document_sheet_identity_map
from .extraction import extract_page, open_pdf
from .gateway import SupabaseWorkerGateway
from .models import HostedJob
from .note_transcription import note_read_exceptions
from .security import scan_pdf_source
from .visual import BoundedVisualResolver
from .worker import HostedIndexerWorker, page_processing_deadline, visual_exception_inventory


def prepare_page(refresh_id: str, gateway=None, visual=None) -> dict:
    if str(UUID(refresh_id)) != refresh_id:
        raise ValueError('canonical_refresh_id_required')
    gateway = gateway or SupabaseWorkerGateway()
    dispatch = gateway.rpc('ecos_read_isolated_page_refresh', {'p_refresh_id': refresh_id})
    job = HostedJob.from_record(dispatch['job'])
    page_number = dispatch['pageNumber']
    if (dispatch.get('refreshId') != refresh_id or job.mode != 'shadow_refresh:' + job.job_id
        or isinstance(page_number, bool) or not isinstance(page_number, int)
        or not 1 <= page_number <= (job.source_page_count or 0)):
        raise ValueError('isolated_exact_page_required')
    source = gateway.download_source(job)
    if hashlib.sha256(source).hexdigest() != job.source_sha256:
        raise ValueError('source_fingerprint_mismatch')
    scan = scan_pdf_source(source)
    if scan.status != 'clean':
        raise ValueError('clean_source_required')
    gateway.record_source_scan(job, status=scan.status, engine=scan.engine, byte_count=scan.byte_count)
    document = open_pdf(source)
    try:
        if document.page_count != job.source_page_count:
            raise ValueError('source_page_count_mismatch')
        identities = document_sheet_identity_map(document)
        # Reuse the production resolver, not its full-job processing/publishing path.
        resolver = object.__new__(HostedIndexerWorker)
        resolver.gateway = gateway
        resolver.visual = visual or BoundedVisualResolver()
        with page_processing_deadline(1100):
            page = document.load_page(page_number - 1)
            result = extract_page(page, job.source_sha256, project_id=job.project_id,
                document_sheet_identity=identities.get(page_number), evidence_version=EVIDENCE_VERSION)
            # Opt-in isolated preparation only; ordinary indexing is unchanged.
            if os.getenv('ECOS_ENABLE_NOTE_READ_PREPARATION') == 'enabled':
                result['unresolved'].extend(note_read_exceptions(result['ocr'].get('visualTileRegions', [])))
            unresolved = resolver.resolve_visual_exceptions(job, page, page_number, result)
            result['final']['visualExceptionInventory'] = visual_exception_inventory(job, page_number, result['unresolved'])
            result['deterministic']['visualExceptionDiagnostics'] = result['unresolved']
            assurance = assure_page(page_data=result['final'], expected_project_id=job.project_id,
                expected_page_number=page_number, expected_source_sha256=job.source_sha256,
                expected_evidence_version=EVIDENCE_VERSION, unresolved_region_count=len(unresolved))
            # One atomic candidate checkpoint. Its mode excludes it from both
            # publication paths; no parent page, search chunk or receipt is reset.
            saved = gateway.rpc('ecos_checkpoint_hosted_index_page', {
                'p_job_id':job.job_id, 'p_claim_token':job.claim_token, 'p_page_number':page_number,
                'p_state':'assured' if assurance['accepted'] else 'awaiting_visual' if unresolved else 'rejected',
                'p_native_page_data':result['native'], 'p_ocr_page_data':result['ocr'],
                'p_deterministic_page_data':result['deterministic'], 'p_final_page_data':result['final'],
                'p_assurance_result':assurance, 'p_unresolved_region_count':len(unresolved),
            })
            if saved is not True:
                raise ValueError('candidate_checkpoint_not_confirmed')
            return {'refreshId':refresh_id,'candidateJobId':job.job_id,'pageNumber':page_number,
                'accepted':assurance['accepted'],'unresolvedCount':len(unresolved),
                'failureCodes':assurance['failureCodes'],'published':False}
    finally:
        document.close()


if __name__ == '__main__':
    try:
        result = prepare_page(os.environ['ECOS_PAGE_REFRESH_ID'])
        print(json.dumps(result), flush=True)
        if not result['accepted']:
            raise SystemExit(1)
    except Exception as error:
        # No credential-bearing request, response, source locator or traceback.
        print(json.dumps({'event':'isolated_page_refresh_failed','errorType':type(error).__name__}), flush=True)
        raise SystemExit(1)
