"""Explicit printed count labels require independent visual verification."""
import re
from .measurement_correction import AGREEMENT_KEYS
from .labeled_counts import MAX_COUNT_TARGETS

COUNT_SOURCE = 'fixed_visual_tile_labeled_count_read'

def label_identity(text):
    key=re.sub(r'[\s.!:\[\]()]+',' ',str(text).upper()).strip()
    return key if key in ('QTY','QUANTITY','COUNT','OCC LOAD','OCCUPANT LOAD','OCCUPANCY LOAD') else None

def verified_count_text(fact,candidate,agreement):
    if candidate.get('source')!=COUNT_SOURCE or not isinstance(agreement,dict):return None
    if agreement.get('candidateAgreementMethod')!='dual_provider_candidate_index_v1':return None
    if any(agreement.get(k) is not True for k in AGREEMENT_KEYS if k.endswith('Valid')):return None
    for prefix in ('primary','assurance'):
        accepted=agreement.get(prefix+'AcceptedCandidateIndexes')
        if (not isinstance(accepted,list) or len(accepted)!=1 or type(accepted[0]) is not int
            or accepted[0]!=0 or agreement.get(prefix+'DismissedCandidateIndexes')!=[]):return None
    text=fact.get('evidenceText')
    if not isinstance(text,str) or text!=fact.get('statement'):return None
    match=re.fullmatch(r'\s*([A-Za-z.! ]+)\s*:\s*(\d{1,5})\s*',text)
    if not match or label_identity(match[1])!=label_identity(candidate.get('text')) or not label_identity(match[1]):return None
    return text.strip()

def count_read_exceptions(targets):
    output=[]
    for i,target in enumerate(targets[:MAX_COUNT_TARGETS]):
        b=target['bounds']; pad=max(.002,b['height']*.45)
        x=max(0,b['x']-.002); y=max(0,b['y']-pad)
        bounds={'x':x,'y':y,'width':min(1,b['x']+b['width']+.028)-x,
                'height':min(1,b['y']+b['height']+pad)-y}
        output.append({'regionKey':f'low-confidence-ocr-labeled-count-{i}', 'bounds':bounds,
            'reason':'Read the complete explicit count label and its printed integer independently; OCR agreement is not visual verification.',
            'diagnosticCandidates':[{'text':target['label'],'source':COUNT_SOURCE,
                'confidence':min(float(p['confidence']) for p in target['parts']),'bounds':bounds}]})
    return output
