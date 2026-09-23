#!/usr/bin/env python3
"""Local scoring regressions; sends no network requests."""
import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('ecos_2375_architectural_live.py')
spec = importlib.util.spec_from_file_location('pilot_live', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def result(answer, *, sheet='A-2.10', page=43, sha=module.SOURCE_SHA, status='verified_with_limits', elapsed=1000):
    return {'httpStatus': 200, 'elapsedMs': elapsed, 'response': {
        'answer': answer, 'assurance': {'status': status}, 'supportingEvidence': [{
            'documentCitation': {'sheetNumber': sheet, 'pageNumber': page, 'sourceSha256': sha},
        }],
    }}


answerable = {'answerType': 'printed', 'sheetNumber': 'A-2.10', 'pdfPage': 43,
              'requiredAnswerPatterns': ['occupant load', '200', 'non[- ]fixed seating']}
good = module.score_response(answerable, result('Occupant load: 200, based on non-fixed seating.'))
assert good['pass']
assert not module.score_response(answerable, result('Occupant load: 16.'))['answerCorrect']
assert not module.score_response(answerable, result('Occupant load: 200, based on non-fixed seating.', sha='wrong'))['sourceIdentityCorrect']
assert not module.score_response(answerable, result('Occupant load: 200, based on non-fixed seating.', page=44))['expectedCitationPresent']
assert not module.score_response(answerable, result('Occupant load: 200, based on non-fixed seating.', elapsed=30001))['withinLatencyBudget']

unanswerable = {'answerType': 'unanswerable', 'sheetNumber': None, 'pdfPage': None, 'requiredAnswerPatterns': []}
safe = module.score_response(unanswerable, result('The drawings do not provide the installed serial number.', status='insufficient_evidence'))
assert safe['answerCorrect'] and safe['safeUnanswerable']
unsafe = module.score_response(unanswerable, result('The serial number is ABC-123.', status='verified'))
assert not unsafe['answerCorrect'] and not unsafe['pass']
print('2375 architectural live scorer passed: 7/7')
