import json
import re
from pathlib import Path
from pypdf import PdfReader

source = Path('/Users/davidfamularo/Library/Mobile Documents/com~apple~CloudDocs/Compliance Project Approved/2375 Approved/01 - PLZ CORP - 2375 THIRD STREET - ARCHITECTURAL.pdf')
reader = PdfReader(str(source))
patterns = re.compile(r'haz|matl|hazardous|2\s*,?\s*712|weather\s+protected|storage\s+area\s*[\'\"]?c', re.I)
matches = []
for index, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ''
    normalized = ' '.join(text.split())
    snippets = []
    for match in patterns.finditer(normalized):
        start = max(0, match.start() - 240)
        end = min(len(normalized), match.end() + 360)
        snippet = normalized[start:end]
        if snippet not in snippets:
            snippets.append(snippet)
    if snippets:
        matches.append({'page': index, 'snippets': snippets[:12]})
print(json.dumps({'pages': len(reader.pages), 'matches': matches}, indent=2))
