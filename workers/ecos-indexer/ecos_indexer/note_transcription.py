"""Bounded discovery of printed note blocks, not an answer or an OCR approval.

No question, expected facts, sheet hint or replacement text enters discovery.
Only a separate pair of original-pixel reads may create verified note text.
"""
from __future__ import annotations

import re
from .labeled_counts import bounds, confidence, union
from .measurement_correction import AGREEMENT_KEYS

NOTE_SOURCE = 'fixed_visual_tile_note_transcription'
MAX_NOTE_TARGETS = 6


def note_read_exceptions(regions):
    lines = []
    seen = set()
    for region in regions:
        if not isinstance(region, dict) or not bounds(region):
            continue
        text = str(region.get('text') or '').strip()
        # Use complete OCR lines, not standalone words, page headings or an
        # arbitrary question-driven crop. Keep uncertain text as diagnostics.
        if ('-line-' not in str(region.get('id') or '') or
            region.get('source') != 'fixed_visual_tile_coordinate_ocr' or
            region.get('searchable') is False or
            not .018 <= region['width'] <= .16 or not .002 <= region['height'] <= .018 or
            not .2 <= confidence(region) <= 1 or not 4 <= len(text) <= 240 or
            len(re.findall(r'[A-Za-z]{2,}', text)) < 2):
            continue
        key = (text, round(region['x'], 3), round(region['y'], 3))
        if key in seen:
            continue
        seen.add(key)
        lines.append(region)
    # Work only on a bounded matching shortlist. Original raw text stays intact.
    lines = sorted(lines, key=lambda r: (confidence(r), -len(r['text']), r['id']))[:160]
    candidates = []
    for anchor in lines:
        block = [anchor]
        for other in sorted(lines, key=lambda r: (abs(r['y']-anchor['y']),r['id'])):
            if other is anchor or other['source'] != anchor['source']:
                continue
            b = union(block)
            gap = max(0,b['y']-other['y']-other['height'],other['y']-b['y']-b['height'])
            aligned = abs(other['x']-anchor['x']) <= .006
            expanded = union([*block,other])
            if aligned and gap <= .007 and expanded['width'] <= .16 and expanded['height'] <= .05:
                block.append(other)
            if len(block) == 6:
                break
        block.sort(key=lambda r: (r['y'],r['x'],r['id']))
        text = '\n'.join(dict.fromkeys(r['text'] for r in block))
        if len(block) < 2 or len(text) > 500 or len(re.findall(r'[A-Za-z]{2,}',text)) < 5:
            continue
        b = union(block)
        # Reject known navigation/title blocks; this does not assert that any
        # surviving text is relevant, true, or sufficient for an answer.
        if re.search(r'\b(?:SHEET TITLE|PROJECT ADDRESS|DRAWN BY|CHECKED BY|ARCHITECTURAL GROUP)\b',text,re.I):
            continue
        candidates.append((min(confidence(r) for r in block),-len(text),b,text,block))
    chosen = []
    for conf, _, b, text, block in sorted(candidates,key=lambda c:(c[0],c[1],c[2]['y'],c[2]['x'])):
        if any(max(0,min(b['x']+b['width'],p['x']+p['width'])-max(b['x'],p['x'])) *
               max(0,min(b['y']+b['height'],p['y']+p['height'])-max(b['y'],p['y'])) >=
               .5*min(b['width']*b['height'],p['width']*p['height']) for p in (item['bounds'] for item in chosen)):
            continue
        x,y=max(0,b['x']-.002),max(0,b['y']-.002)
        box={'x':x,'y':y,'width':min(1,b['x']+b['width']+.002)-x,
             'height':min(1,b['y']+b['height']+.002)-y}
        chosen.append({'regionKey':f'low-confidence-ocr-note-block-{len(chosen)}','bounds':box,
            'reason':'Independently transcribe the complete printed note block from the original crop; do not join fragments into inferred relationships.',
            'diagnosticCandidates':[{'text':text,'source':NOTE_SOURCE,'confidence':conf,'bounds':box}]})
        if len(chosen) == MAX_NOTE_TARGETS:
            break
    return chosen


def verified_note_text(fact,candidate,agreement):
    if candidate.get('source') != NOTE_SOURCE or not isinstance(agreement,dict):
        return None
    if agreement.get('candidateAgreementMethod') != 'dual_provider_candidate_index_v1':
        return None
    if any(agreement.get(k) is not True for k in AGREEMENT_KEYS if k.endswith('Valid')):
        return None
    for prefix in ('primary','assurance'):
        accepted=agreement.get(prefix+'AcceptedCandidateIndexes')
        if (not isinstance(accepted,list) or len(accepted)!=1 or type(accepted[0]) is not int or
            accepted[0]!=0 or agreement.get(prefix+'DismissedCandidateIndexes')!=[]):
            return None
    text=fact.get('evidenceText')
    if not isinstance(text,str) or text != fact.get('statement') or not 5 <= len(text) <= 800:
        return None
    # The independent pixel agreement is required by the reader boundary.
    # Anchor overlap prevents a completely unrelated block replacing this one.
    words=lambda s:set(re.findall(r'[A-Za-z]{3,}',s.lower()))
    if len(words(text)&words(str(candidate.get('text') or ''))) < 2:
        return None
    return text.strip()
