#!/usr/bin/env python3
"""Run and score the private 2375 Architectural Ask ECOS pilot.

This harness sends only the user question. Expected answers, sheets, pages and
regions stay local and are used after the response returns. It targets a
verified, zero-traffic drawing-runtime receipt and preserves sanitized receipts.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import statistics
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_ROOT = Path('/Users/davidfamularo/Projects/vitruvius')
sys.path.insert(0, str(RESEARCH_ROOT / 'research'))

import bounded_http as http  # noqa: E402
from prepare_drawing_runtime import SERVICE, traffic  # noqa: E402
from probe_live_visual_source import BASE, REGION, gcloud, save  # noqa: E402

SOURCE_SHA = '75118aa5adf2696692db1413898f505bcda27128fe96977e68f217bd88e9e41e'
OWNER_ID = 'baa00267-082c-4951-97bb-d7894e98e432'
DELIVERY_BUDGET_MS = 30_000
VERIFIED_STATUSES = {'verified', 'verified_with_limits'}
SAFE_UNANSWERABLE = re.compile(
    r"(?:do(?:es)? not|doesn't|cannot|can't|could not|unable to|not (?:shown|stated|provided|verified)|"
    r"insufficient evidence|no (?:evidence|information))",
    re.I,
)


def load_cases() -> list[dict]:
    core = json.loads((APP_ROOT / 'validation/ecos/2375-architectural-pilot.json').read_text())
    extra = json.loads((APP_ROOT / 'validation/ecos/2375-architectural-pilot-cases-11-50.json').read_text())
    return core['cases'] + extra['cases']


def supporting_citations(body: dict) -> list[dict]:
    return [item.get('documentCitation') or {} for item in body.get('supportingEvidence') or []]


def score_response(case: dict, result: dict) -> dict:
    body = result.get('response') or {}
    assurance = body.get('assurance') or {}
    answer = body.get('answer') or ''
    citations = supporting_citations(body)
    source_ok = bool(citations) and all(c.get('sourceSha256') == SOURCE_SHA for c in citations)
    expected_citation = case['answerType'] == 'unanswerable' or any(
        c.get('sheetNumber') == case.get('sheetNumber') and c.get('pageNumber') == case.get('pdfPage')
        for c in citations
    )
    pattern_results = {
        pattern: bool(re.search(pattern, answer, re.I | re.S))
        for pattern in case.get('requiredAnswerPatterns') or []
    }
    delivered = (
        result.get('httpStatus') == 200
        and not body.get('error')
        and assurance.get('status') is not None
    )
    within_budget = delivered and (result.get('elapsedMs') or 0) <= DELIVERY_BUDGET_MS
    if case['answerType'] == 'unanswerable':
        answer_correct = bool(SAFE_UNANSWERABLE.search(answer)) and assurance.get('status') not in VERIFIED_STATUSES
    else:
        answer_correct = bool(pattern_results) and all(pattern_results.values())
    return {
        'delivered': delivered,
        'withinLatencyBudget': within_budget,
        'sourceIdentityCorrect': source_ok,
        'expectedCitationPresent': expected_citation,
        'answerPatterns': pattern_results,
        'answerCorrect': answer_correct,
        'safeUnanswerable': answer_correct if case['answerType'] == 'unanswerable' else None,
        'pass': delivered and within_budget and source_ok and expected_citation and answer_correct,
    }


class PrivateTarget:
    def __init__(self, receipt_name: str):
        self.verified_folder = RESEARCH_ROOT / 'research' / receipt_name
        if self.verified_folder.parent != RESEARCH_ROOT / 'research' or not receipt_name.startswith('drawing-runtime-'):
            raise ValueError('invalid private runtime receipt')
        self.verification = json.loads((self.verified_folder / 'verification.json').read_text())
        self.before = gcloud('run', 'services', 'describe', SERVICE, '--region=' + REGION)
        tagged = next(t for t in self.before['status']['traffic'] if t.get('tag') == self.verification['tag'])
        assert tagged['url'] == self.verification['url']
        assert tagged['revisionName'] == self.verification['revision']
        assert not tagged.get('percent', 0), 'private tag unexpectedly receives customer traffic'
        self.url = tagged['url']
        env = self.before['spec']['template']['spec']['containers'][0]['env']

        def secret(name: str) -> str:
            ref = next(e for e in env if e['name'] == name)['valueFrom']['secretKeyRef']
            return gcloud('secrets', 'versions', 'access', ref['key'], '--secret=' + ref['name'], json_output=False).strip()

        self.admin, self.anon, self.worker, self.gateway = map(secret, [
            'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
            'ECOS_SERVICE_WORKER_TOKEN', 'ECOS_AGENT_PREVIEW_GATEWAY_TOKEN',
        ])
        self.platform = {'X-Serverless-Authorization': 'Bearer ' + gcloud('auth', 'print-identity-token', json_output=False).strip()}
        health = http.get(self.url + '/status', headers=self.platform, timeout=15)
        assert health.status_code == 200
        assert health.json()['packagedSourceSha256'] == self.verification['package']
        headers = {'apikey': self.admin, 'Authorization': 'Bearer ' + self.admin}
        projects = http.get(BASE + '/rest/v1/projects', headers=headers, params={
            'name': 'eq.2375 Compliance Project', 'owner_id': 'eq.' + OWNER_ID,
            'archived': 'eq.false', 'select': 'id,name,owner_id',
        }, timeout=15)
        assert projects.status_code == 200 and len(projects.json()) == 1
        self.project = projects.json()[0]
        self.admin_headers = headers

    def capacity(self) -> int:
        usage = http.get(BASE + '/rest/v1/dave_ai_operation_requests', headers=self.admin_headers, params={
            'owner_id': 'eq.' + OWNER_ID, 'operation_type': 'eq.project_question',
            'started_at': 'gt.' + (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            'select': 'id',
        }, timeout=15)
        assert usage.status_code == 200
        return max(0, 59 - len(usage.json()))

    def ask(self, case: dict, folder: Path) -> dict:
        user = http.get(BASE + '/auth/v1/admin/users/' + OWNER_ID, headers=self.admin_headers, timeout=15)
        assert user.status_code == 200
        token = refresh = None
        cleanup = {'signedOutLocal': False, 'refreshRevoked': False, 'customerTrafficUnchanged': False}
        try:
            link = http.post(BASE + '/auth/v1/admin/generate_link', headers=self.admin_headers,
                             json={'type': 'magiclink', 'email': user.json()['email']}, timeout=15)
            assert link.status_code == 200
            auth = http.post(BASE + '/auth/v1/verify', headers={'apikey': self.anon},
                             json={'type': 'magiclink', 'token_hash': link.json()['hashed_token']}, timeout=15)
            assert auth.status_code == 200
            token, refresh = auth.json()['access_token'], auth.json()['refresh_token']
            assert json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))['sub'] == OWNER_ID
            request = {
                'schemaVersion': 'ecos-project-question/2.0', 'clientSurface': 'web',
                'clientRequestId': str(uuid.uuid4()), 'projectId': self.project['id'],
                'projectName': self.project['name'], 'question': case['question'],
                'validationMode': 'shadow', 'evaluationModel': 'deepseek-v4-flash',
                'evaluationAttemptId': str(uuid.uuid4()),
            }
            save(folder, 'request.json', request)
            started = time.monotonic()
            response = http.post(self.url + '/question', headers={
                **self.platform, 'Authorization': 'Bearer ' + token, 'apikey': self.anon,
                'x-ecos-worker-token': self.worker, 'x-ecos-agent-gateway-token': self.gateway,
            }, json=request, timeout=120)
            body = response.json()
            result = {
                'caseId': case['id'], 'httpStatus': response.status_code,
                'elapsedMs': round((time.monotonic() - started) * 1000), 'response': body,
                'packagedSourceSha256': response.headers.get('x-ecos-agent-packaged-source-sha256'),
                'referenceHintsSent': False, 'isDeviceAcceptance': False,
                'published': False,
            }
            assert result['packagedSourceSha256'] == self.verification['package']
            save(folder, 'result.json', result)
            return result
        finally:
            if token:
                out = http.post(BASE + '/auth/v1/logout?scope=local', headers={
                    'apikey': self.anon, 'Authorization': 'Bearer ' + token,
                }, timeout=15)
                cleanup['signedOutLocal'] = out.status_code in (200, 204)
                check = http.post(BASE + '/auth/v1/token?grant_type=refresh_token', headers={'apikey': self.anon},
                                  json={'refresh_token': refresh}, timeout=15)
                cleanup['refreshRevoked'] = check.status_code in (400, 401, 403) and not check.json().get('access_token')
            after = gcloud('run', 'services', 'describe', SERVICE, '--region=' + REGION)
            cleanup['customerTrafficUnchanged'] = traffic(self.before) == traffic(after)
            save(folder, 'cleanup.json', cleanup)
            assert not token or all(cleanup.values()), 'cleanup_not_verified'


def write_report(run_folder: Path, rows: list[dict]) -> None:
    elapsed = [row['elapsedMs'] for row in rows if row.get('elapsedMs')]
    lines = [
        f"# 2375 Architectural private pilot — {run_folder.name}", '',
        f"Attempts: {len(rows)}  ",
        f"Passed all gates: {sum(row['score']['pass'] for row in rows)}/{len(rows)}  ",
        f"Delivered: {sum(row['score']['delivered'] for row in rows)}/{len(rows)}  ",
        f"Median latency: {round(statistics.median(elapsed)) if elapsed else '-'} ms  ", '',
        '| Case | HTTP | ms | source | citation | answer | <=30s | pass |',
        '| --- | ---: | ---: | --- | --- | --- | --- | --- |',
    ]
    for row in rows:
        score = row['score']
        mark = lambda value: 'yes' if value else 'NO'
        lines.append(f"| {row['caseId']} | {row.get('httpStatus', '-')} | {row.get('elapsedMs', '-')} | "
                     f"{mark(score['sourceIdentityCorrect'])} | {mark(score['expectedCitationPresent'])} | "
                     f"{mark(score['answerCorrect'])} | {mark(score['withinLatencyBudget'])} | {mark(score['pass'])} |")
    lines += ['', '_Private zero-customer-traffic evidence; not a production reliability claim._', '']
    (run_folder / 'REPORT.md').write_text('\n'.join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('receipt')
    parser.add_argument('--cases', required=True, help='comma-separated pilot case IDs')
    args = parser.parse_args()
    selected = args.cases.split(',')
    by_id = {case['id']: case for case in load_cases()}
    if any(case_id not in by_id for case_id in selected):
        raise SystemExit('unknown pilot case ID')
    target = PrivateTarget(args.receipt)
    if target.capacity() < len(selected):
        raise SystemExit(f'owner_hourly_capacity_unavailable: {target.capacity()} slots remain')
    run_folder = RESEARCH_ROOT / 'research' / ('architectural-pilot-' + uuid.uuid4().hex)
    run_folder.mkdir(mode=0o700)
    save(run_folder, 'target.json', {
        'receipt': args.receipt, 'cases': selected, 'sourceSha256': SOURCE_SHA,
        'deliveryBudgetMs': DELIVERY_BUDGET_MS, 'startedAt': datetime.now(timezone.utc).isoformat(),
    })
    rows = []
    for case_id in selected:
        case = by_id[case_id]
        attempt = run_folder / case_id
        attempt.mkdir(mode=0o700)
        result = target.ask(case, attempt)
        row = {k: result.get(k) for k in ('caseId', 'httpStatus', 'elapsedMs', 'packagedSourceSha256')}
        row['score'] = score_response(case, result)
        rows.append(row)
        with (run_folder / 'runs.jsonl').open('a') as stream:
            stream.write(json.dumps(row) + '\n')
        print(json.dumps(row), flush=True)
    write_report(run_folder, rows)
    print(json.dumps({'pilotReceipt': str(run_folder)}))


if __name__ == '__main__':
    main()
