import copy
import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from ecos_indexer.page_refresh import prepare_page

REFRESH = 'aaaaaaaa-1111-4111-8111-111111111111'
CANDIDATE = 'bbbbbbbb-2222-4222-8222-222222222222'
SOURCE = b'original-source'
SHA = hashlib.sha256(SOURCE).hexdigest()


class PageRefreshTests(unittest.TestCase):
    def setUp(self):
        self.dispatch = {'refreshId':REFRESH,'pageNumber':43,'job':{
            'job_id':CANDIDATE,'organization_id':'org','project_id':'project','document_id':'document',
            'source_provider':'managed_upload','source_locator':{},'source_sha256':SHA,
            'source_page_count':68,'source_revision':'1','mode':'shadow_refresh:'+CANDIDATE,
            'claim_token':'cccccccc-3333-4333-8333-333333333333','retry_count':0}}
        self.gateway = Mock()
        self.gateway.rpc.side_effect = lambda name, payload: copy.deepcopy(self.dispatch) if name == 'ecos_read_isolated_page_refresh' else True
        self.gateway.download_source.return_value = SOURCE
        self.document = Mock(page_count=68)
        self.result = {'native':{},'ocr':{},'deterministic':{},'final':{'regions':[]},'unresolved':[]}

    def run_prepare(self, *, unresolved=None, accepted=True, scan='clean'):
        with patch('ecos_indexer.page_refresh.scan_pdf_source',return_value=SimpleNamespace(status=scan,engine='test-scanner',byte_count=len(SOURCE))), \
             patch('ecos_indexer.page_refresh.open_pdf',return_value=self.document), \
             patch('ecos_indexer.page_refresh.document_sheet_identity_map',return_value={43:{}}), \
             patch('ecos_indexer.page_refresh.extract_page',return_value=copy.deepcopy(self.result)), \
             patch('ecos_indexer.page_refresh.HostedIndexerWorker.resolve_visual_exceptions',return_value=unresolved or []), \
             patch('ecos_indexer.page_refresh.assure_page',return_value={'accepted':accepted,'failureCodes':[] if accepted else ['unresolved_regions']}):
            return prepare_page(REFRESH,self.gateway,Mock())

    def test_only_candidate_page_checkpoint_is_written(self):
        result = self.run_prepare()
        self.assertTrue(result['accepted'])
        self.assertFalse(result['published'])
        self.document.load_page.assert_called_once_with(42)
        self.assertEqual([c.args[0] for c in self.gateway.rpc.call_args_list],
            ['ecos_read_isolated_page_refresh','ecos_checkpoint_hosted_index_page'])
        payload = self.gateway.rpc.call_args_list[-1].args[1]
        self.assertEqual(payload['p_job_id'],CANDIDATE)
        self.assertEqual(payload['p_page_number'],43)
        self.document.close.assert_called_once()

    def test_unresolved_is_checkpointed_not_published(self):
        result=self.run_prepare(unresolved=[{'regionKey':'new'}],accepted=False)
        self.assertFalse(result['accepted'])
        self.assertEqual(self.gateway.rpc.call_args_list[-1].args[1]['p_state'],'awaiting_visual')

    def test_publication_modes_are_rejected_before_download(self):
        for mode in ['shadow','live']:
            self.dispatch['job']['mode']=mode
            with self.assertRaisesRegex(ValueError,'isolated_exact_page_required'):self.run_prepare()
        self.gateway.download_source.assert_not_called()

    def test_page_identity_and_response_identity_are_strict(self):
        for value in [True,0,69,'43',None]:
            self.dispatch['pageNumber']=value
            with self.assertRaisesRegex(ValueError,'isolated_exact_page_required'):self.run_prepare()
        self.dispatch['pageNumber']=43
        self.dispatch['refreshId']=CANDIDATE
        with self.assertRaisesRegex(ValueError,'isolated_exact_page_required'):self.run_prepare()

    def test_source_hash_mismatch_is_rejected_before_scan(self):
        self.gateway.download_source.return_value=b'wrong-source'
        with self.assertRaisesRegex(ValueError,'source_fingerprint_mismatch'):self.run_prepare()
        self.gateway.record_source_scan.assert_not_called()

    def test_unclean_source_and_changed_page_count_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'clean_source_required'):self.run_prepare(scan='pending')
        self.document.page_count=67
        with self.assertRaisesRegex(ValueError,'source_page_count_mismatch'):self.run_prepare()
        self.document.close.assert_called_once()

    def test_unconfirmed_checkpoint_is_not_success(self):
        self.gateway.rpc.side_effect=lambda name,payload: self.dispatch if name=='ecos_read_isolated_page_refresh' else False
        with self.assertRaisesRegex(ValueError,'candidate_checkpoint_not_confirmed'):self.run_prepare()

    def test_noncanonical_refresh_id_rejected(self):
        with self.assertRaises(ValueError):prepare_page('invalid',self.gateway,Mock())
        self.gateway.rpc.assert_not_called()
