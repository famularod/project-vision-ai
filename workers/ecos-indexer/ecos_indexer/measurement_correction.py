"""Narrow reader/worker contract for independently verified OCR corrections.

Only a complete single printed feet/inches phrase is supported here. Ranges
and qualifiers remain unresolved until their full contract is implemented.
The raw OCR is retained in the fingerprinted exception, never promoted as the
corrected fact. The numeric edit budget mirrors the protected reader's limit.
"""
import re

CORRECTION_SOURCE = "fixed_visual_tile_measurement_transcription_correction"
AGREEMENT_KEYS = (
    "candidateAgreementMethod",
    "primaryAcceptedCandidateIndexesValid", "assuranceAcceptedCandidateIndexesValid",
    "primaryDismissedCandidateIndexesValid", "assuranceDismissedCandidateIndexesValid",
    "primaryAcceptedCandidateIndexes", "assuranceAcceptedCandidateIndexes",
    "primaryDismissedCandidateIndexes", "assuranceDismissedCandidateIndexes",
)


def corrected_measurement_text(fact, candidate, agreement):
    if candidate.get("source") != CORRECTION_SOURCE or not isinstance(agreement, dict):
        return None
    if agreement.get("candidateAgreementMethod") != "dual_provider_candidate_index_v1":
        return None
    if any(agreement.get(key) is not True for key in AGREEMENT_KEYS if key.endswith("Valid")):
        return None
    for prefix in ("primary", "assurance"):
        accepted = agreement.get(f"{prefix}AcceptedCandidateIndexes")
        dismissed = agreement.get(f"{prefix}DismissedCandidateIndexes")
        if (not isinstance(accepted, list) or len(accepted) != 1
                or type(accepted[0]) is not int or accepted[0] != 0
                or not isinstance(dismissed, list) or dismissed):
            return None
    text = fact.get("evidenceText")
    if not isinstance(text, str) or text != fact.get("statement"):
        return None
    text = text.replace("’", "'").replace("′", "'").replace("“", '"').replace("”", '"').replace("″", '"')
    text = re.sub(r"\s+", " ", text.replace("–", "-").replace("—", "-")).strip()
    match = re.fullmatch(r'''(\d{1,4})\s*'\s*-\s*(\d{1,2})(?: (\d{1,2})\s*/\s*(\d{1,2}))?\s*"''', text)
    if not match or int(match[2]) > 11:
        return None
    if match[3] and (int(match[4]) not in (2, 4, 8, 16, 32, 64)
                     or not 0 < int(match[3]) < int(match[4])):
        return None
    raw = str(candidate.get("text") or "").upper()
    if re.search(r"\b(?:TO|MAX|MIN|TYP|TYPICAL)\b", raw):
        return None
    raw = raw.replace("’", "'").replace("′", "'").replace("“", '"').replace("”", '"').replace("″", '"')
    raw = re.sub(r'''('\s*[-–—]\s*)[A-Z](?=\s*")''', r"\g<1>0", raw)
    before, after = re.sub(r"\D", "", raw), re.sub(r"\D", "", text)
    if not before or not one_edit_apart_or_equal(before, after):
        return None
    fraction = f" {match[3]}/{match[4]}" if match[3] else ""
    return f"{match[1]}'-{match[2]}{fraction}\""


def one_edit_apart_or_equal(left, right):
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right)) <= 1
    short, long = sorted((left, right), key=len)
    i = 0
    while i < len(short) and short[i] == long[i]:
        i += 1
    return short[i:] == long[i + 1:]
