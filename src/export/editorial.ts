import type { ProjectRepository } from '../domain/repository';
import { blockText } from '../domain/document';
import type { DocumentBlock, ExportFormat, ExportOptions, ExportedFile, Revision, StructuredDocument, TextRun } from '../domain/types';

export const EDITORIAL_TEMPLATE = Object.freeze({
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 'double',
  header: 'title',
  pageNumbering: true
});

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('*', '\\*').replaceAll('_', '\\_').replaceAll('`', '\\`');
}

function textFromRuns(runs: readonly TextRun[], format: 'markdown' | 'text'): string {
  if (format === 'text') return runs.map((run) => run.text).join('');
  return runs.map((run) => {
    let value = escapeMarkdown(run.text);
    for (const mark of run.marks) {
      if (mark === 'bold') value = `**${value}**`;
      if (mark === 'italic') value = `_${value}_`;
      if (mark === 'underline') value = `<u>${value}</u>`;
    }
    return value;
  }).join('');
}

function bodyLines(document: StructuredDocument, format: 'markdown' | 'text'): string[] {
  return document.blocks.map((block) => {
    if (block.kind === 'scene-break') return format === 'markdown' ? '***' : '***';
    const text = textFromRuns(block.runs, format);
    if (format === 'markdown' && block.kind === 'heading') return `${'#'.repeat(block.headingLevel ?? 1)} ${text}`;
    return text;
  });
}

export function renderMarkdown(document: StructuredDocument, options: ExportOptions): string {
  const title = `# ${escapeMarkdown(options.title)}`;
  const author = options.author ? `\n\n_${escapeMarkdown(options.author)}_` : '';
  return `${title}${author}\n\n${bodyLines(document, 'markdown').join('\n\n')}\n`;
}

export function renderPlainText(document: StructuredDocument, options: ExportOptions): string {
  const header = [options.header ?? options.title, options.author].filter(Boolean).join(' — ');
  return `${header}\n${'='.repeat(Math.max(3, header.length))}\n\n${bodyLines(document, 'text').join('\n\n')}\n`;
}

function renderWordRun(run: TextRun): string {
  const properties = [
    run.marks.includes('bold') ? '<w:b/>' : '',
    run.marks.includes('italic') ? '<w:i/>' : '',
    run.marks.includes('underline') ? '<w:u w:val="single"/>' : ''
  ].join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function renderWordParagraph(block: DocumentBlock): string {
  if (block.kind === 'scene-break') return '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:t>***</w:t></w:r></w:p>';
  const style = block.kind === 'heading' ? `w:pStyle w:val="Heading${block.headingLevel ?? 1}"` : '';
  return `<w:p><w:pPr>${style ? `<${style}/>` : ''}<w:spacing w:line="480" w:lineRule="auto"/></w:pPr>${block.runs.map(renderWordRun).join('')}</w:p>`;
}

function xmlFiles(document: StructuredDocument, options: ExportOptions): Map<string, Uint8Array> {
  const encoder = new TextEncoder();
  const header = options.header ?? options.title;
  const pageField = options.pageNumbering === false ? '' : '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${escapeXml(header)}</w:t></w:r>${pageField}</w:p></w:hdr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${document.blocks.map(renderWordParagraph).join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const files = new Map<string, Uint8Array>();
  files.set('[Content_Types].xml', encoder.encode(contentTypes));
  files.set('_rels/.rels', encoder.encode(relationships));
  files.set('word/document.xml', encoder.encode(documentXml));
  files.set('word/styles.xml', encoder.encode(styles));
  files.set('word/header1.xml', encoder.encode(headerXml));
  files.set('word/_rels/document.xml.rels', encoder.encode(documentRelationships));
  return files;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff); }
function u32(value: number): Uint8Array { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Small ZIP store writer, sufficient for the deterministic DOCX package. */
function zip(files: Map<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const path = encoder.encode(name);
    const crc = crc32(data);
    const local = concatBytes(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(path.length), u16(0), path, data);
    locals.push(local);
    const central = concatBytes(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(path.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), path);
    centrals.push(central);
    offset += local.length;
  }
  const centralDirectory = concatBytes(...centrals);
  const localData = concatBytes(...locals);
  const end = concatBytes(u32(0x06054b50), u16(0), u16(0), u16(files.size), u16(files.size), u32(centralDirectory.length), u32(localData.length), u16(0));
  return concatBytes(localData, centralDirectory, end);
}

function pdfEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replaceAll(/[^\x20-\x7e]/g, '?');
}

function renderPdf(document: StructuredDocument, options: ExportOptions): Uint8Array {
  const lines = [options.header ?? options.title, ...(options.author ? [options.author] : []), '', ...bodyLines(document, 'text').flatMap((line) => {
    const chunks: string[] = [];
    let rest = line;
    while (rest.length > 92) { chunks.push(rest.slice(0, 92)); rest = rest.slice(92); }
    chunks.push(rest);
    return chunks;
  })];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 42) pages.push(lines.slice(index, index + 42));
  if (!pages.length) pages.push([]);
  const objects: string[] = [];
  const pageIds: number[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');
  pages.forEach((page, pageIndex) => {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const commands = ['BT', '/F1 12 Tf', '72 760 Td', ...page.map((line, lineIndex) => `${lineIndex ? '0 -34 Td ' : ''}(${pdfEscape(line)}) Tj`), options.pageNumbering === false ? '' : `0 -34 Td (${pageIndex + 1}) Tj`, 'ET'].filter(Boolean).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets[index + 1] = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function exportCapturedRevision(revision: Revision, format: ExportFormat, options: ExportOptions): ExportedFile {
  const safeTitle = options.title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'manuscript';
  if (format === 'markdown') {
    return { format, filename: `${safeTitle}.md`, mimeType: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(renderMarkdown(revision.document, options)), capturedRevisionId: revision.id };
  }
  if (format === 'text') {
    return { format, filename: `${safeTitle}.txt`, mimeType: 'text/plain;charset=utf-8', bytes: new TextEncoder().encode(renderPlainText(revision.document, options)), capturedRevisionId: revision.id };
  }
  if (format === 'docx') {
    return { format, filename: `${safeTitle}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: zip(xmlFiles(revision.document, options)), capturedRevisionId: revision.id };
  }
  return { format, filename: `${safeTitle}.pdf`, mimeType: 'application/pdf', bytes: renderPdf(revision.document, options), capturedRevisionId: revision.id };
}

/** Capture first, then render. A later save cannot alter any returned file. */
export async function exportRevision(repository: ProjectRepository, revisionId: string, formats: ExportFormat[], options: ExportOptions): Promise<ExportedFile[]> {
  const captured = await repository.getRevision(revisionId);
  return formats.map((format) => exportCapturedRevision(captured, format, options));
}
