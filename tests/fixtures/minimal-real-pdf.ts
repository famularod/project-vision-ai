function escapePdfText(value: string) {
  return value.replace(/([\\()])/g, '\\$1');
}

/** Builds valid PDF 1.4 bytes so extraction tests exercise pdfjs, not a text mock. */
export function buildMinimalRealPdf(lines: readonly string[]): Uint8Array {
  const operators = lines.map((line, index) => {
    if (index === 0) return `72 720 Td (${escapePdfText(line)}) Tj`;
    if (line.startsWith('SHEET:')) {
      return `408 ${-620 + (index * 18)} Td (${escapePdfText(line.slice(6).trim())}) Tj`;
    }
    return `0 -22 Td (${escapePdfText(line)}) Tj`;
  }).join('\n');
  const stream = `BT\n/F1 12 Tf\n${operators}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
