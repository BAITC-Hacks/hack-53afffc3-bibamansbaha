import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseAttachment } from '../src/server/attachments.js';
import { modelStatus, interpretRequest, createVisionProvider } from '../src/server/model.js';

test('plain-text specification preserves a cable cross section and explicit decimal quantity', async () => {
  const parsed = await parseAttachment({ name: 'spec.txt', type: 'text/plain', buffer: Buffer.from('Кабель ВВГнг 3х2,5 — 12,5 м\nАвтомат C16;4;шт') });
  assert.deepEqual(parsed.lines.map(({ query, quantity, unit }) => ({ query, quantity, unit })), [
    { query: 'Кабель ВВГнг 3х2,5', quantity: 12.5, unit: 'м' },
    { query: 'Автомат C16', quantity: 4, unit: 'шт' },
  ]);
});

test('comma-delimited CSV preserves quoted commas inside technical product names', async () => {
  const parsed = await parseAttachment({ name: 'spec.csv', type: 'text/csv', buffer: Buffer.from('Наименование,Количество,Единица\n"Кабель 3х2,5",12,м') });
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].query, 'Кабель 3х2,5');
  assert.equal(parsed.lines[0].quantity, 12);
  assert.equal(parsed.lines[0].unit, 'м');
});

test('XLSX reads actual cells and ignores cached formula results', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Материалы');
  sheet.addRow(['№', 'Наименование', 'Ед. изм.', 'Количество']);
  sheet.addRow([1, 'Кабель ВВГнг 3х2,5', 'м', 125]);
  sheet.addRow([2, 'Автомат C16', 'шт', { formula: '2+2', result: 4 }]);
  const parsed = await parseAttachment({ name: 'safe.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  assert.deepEqual(parsed.lines.map(({ query, quantity }) => ({ query, quantity })), [
    { query: 'Кабель ВВГнг 3х2,5', quantity: 125 },
    { query: 'Автомат C16', quantity: 1 },
  ]);
  assert.ok(parsed.warnings.some((warning) => warning.includes('формула пропущена')));
});

async function docx(xml: string, extra?: [string, string]) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', xml);
  if (extra) zip.file(extra[0], extra[1]);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('DOCX table preserves real quantity and unit columns', async () => {
  const row = (cells: string[]) => `<w:tr>${cells.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`;
  const buffer = await docx(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${row(['Наименование', 'Количество', 'Ед. изм.'])}${row(['Розетка 16А', '7', 'шт'])}</w:tbl></w:body></w:document>`);
  const parsed = await parseAttachment({ name: 'spec.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].query, 'Розетка 16А');
  assert.equal(parsed.lines[0].quantity, 7);
  assert.equal(parsed.lines[0].unit, 'шт');
});

test('untrusted Office macros and XML entities are rejected before parsing', async () => {
  const macro = await docx('<w:document/>', ['word/vbaProject.bin', 'not-executed']);
  await assert.rejects(parseAttachment({ name: 'macro.docx', type: '', buffer: macro }), { code: 'UNSAFE_OFFICE' });
  const entity = await docx('<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///secret">]><w:document>&x;</w:document>');
  await assert.rejects(parseAttachment({ name: 'entity.docx', type: '', buffer: entity }), { code: 'UNSAFE_OFFICE' });
});

test('high-expansion ZIP is rejected without inflating the oversized entry', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', 'a'.repeat(2_000_000));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(parseAttachment({ name: 'bomb.docx', type: '', buffer }), { code: 'ZIP_LIMIT' });
});

test('legacy formats, forged signatures and oversized uploads return actionable errors', async () => {
  await assert.rejects(parseAttachment({ name: 'old.xls', type: '', buffer: Buffer.from('legacy') }), { code: 'LEGACY_FORMAT' });
  await assert.rejects(parseAttachment({ name: 'fake.xlsx', type: '', buffer: Buffer.from('not a spreadsheet') }), { code: 'INVALID_OFFICE' });
  await assert.rejects(parseAttachment({ name: 'huge.txt', type: '', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) }), { code: 'FILE_LIMIT' });
  await assert.rejects(parseAttachment({ name: 'fake.jpg', type: 'image/jpeg', buffer: Buffer.from('<script>') }), { code: 'INVALID_IMAGE' });
  await assert.rejects(parseAttachment({ name: 'wrong.txt', type: 'application/pdf', buffer: Buffer.from('not pdf') }), { code: 'MIME_MISMATCH' });
});

test('more than 100 actual positions are rejected rather than silently truncated', async () => {
  const buffer = Buffer.from(Array.from({ length: 101 }, (_, index) => `Товар ${index};1;шт`).join('\n'));
  await assert.rejects(parseAttachment({ name: 'many.txt', type: 'text/plain', buffer }), { code: 'ROW_LIMIT' });
});

// This deliberately small synthetic JPEG tests the provider boundary, not an image codec.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
test('photo without runtime vision never produces fake recognised items', async () => {
  const parsed = await parseAttachment({ name: 'label.jpg', type: 'image/jpeg', buffer: jpeg });
  assert.deepEqual(parsed.lines, []);
  assert.ok(parsed.warnings.some((warning) => warning.includes('не подключена')));
});

test('vision text remains a reviewable suggestion with explicit warning', async () => {
  const parsed = await parseAttachment({ name: 'label.jpg', type: 'image/jpeg', buffer: jpeg }, { async readImage() { return 'Автомат C16;3;шт'; } });
  assert.equal(parsed.lines[0].query, 'Автомат C16');
  assert.equal(parsed.lines[0].quantity, 3);
  assert.ok(parsed.warnings.some((warning) => warning.includes('может содержать ошибки')));
});

test('line-wrapped image quantity attaches to the preceding recognised product', async () => {
  const parsed = await parseAttachment({ name: 'label.jpg', type: 'image/jpeg', buffer: jpeg }, { async readImage() { return 'Breaker C16\n3 pcs'; } });
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].query, 'Breaker C16');
  assert.equal(parsed.lines[0].quantity, 3);
  assert.equal(parsed.lines[0].unit, 'шт');
});

function pdf(lines: string[], pageCount = 1) {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let page = 0; page < pageCount; page++) {
    const content = lines.length ? `BT /F1 12 Tf 50 750 Td ${lines.map((line, i) => `${i ? '0 -18 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')} ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + page * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test('PDF extracts real text layer and preserves quantities', async () => {
  const parsed = await parseAttachment({ name: 'spec.pdf', type: 'application/pdf', buffer: pdf(['Cable VVGng 3x2.5 - 100 m', 'Breaker C16 - 4 pcs']) });
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].query, 'Cable VVGng 3x2.5');
  assert.equal(parsed.lines[0].quantity, 100);
  assert.equal(parsed.lines[1].quantity, 4);
});

test('scanned PDF is explicitly unavailable without text; PDFs over 20 pages are rejected', async () => {
  const scanned = await parseAttachment({ name: 'scan.pdf', type: 'application/pdf', buffer: pdf([]) });
  assert.equal(scanned.lines.length, 0);
  assert.ok(scanned.warnings.some((warning) => warning.includes('не содержит текстового слоя')));
  await assert.rejects(parseAttachment({ name: 'long.pdf', type: 'application/pdf', buffer: pdf(['Item - 1 pcs'], 21) }), { code: 'PAGE_LIMIT' });
});

test('textless PDF renders real JPEG pages for vision and preserves page provenance', async () => {
  let sawJpeg = false;
  const parsed = await parseAttachment({ name: 'scan.pdf', type: 'application/pdf', buffer: pdf([]) }, {
    async readImage(buffer, mime, signal) {
      sawJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && mime === 'image/jpeg' && buffer.length > 1_000;
      assert.equal(signal?.aborted, false);
      return '200300285_;2;шт';
    },
  });
  assert.equal(sawJpeg, true);
  assert.equal(parsed.lines[0].query, '200300285_');
  assert.match(parsed.lines[0].source, /страница 1 \(распознано моделью\)/);
  assert.ok(parsed.warnings.some((warning) => warning.includes('распознаны моделью')));
});

test('more than 3 scanned PDF pages are rejected before spending any vision calls', async () => {
  let calls = 0;
  await assert.rejects(parseAttachment({ name: 'large-scan.pdf', type: 'application/pdf', buffer: pdf([], 4) }, {
    async readImage() { calls++; return ''; },
  }), { code: 'SCAN_PAGE_LIMIT' });
  assert.equal(calls, 0);
});

test('processing budget cancels a stalled vision provider', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let providerSignal: AbortSignal | undefined;
  const pending = parseAttachment({ name: 'label.jpg', type: 'image/jpeg', buffer: jpeg }, {
    async readImage(_buffer, _mime, signal) { providerSignal = signal; return new Promise<string>(() => {}); },
  });
  t.mock.timers.tick(45_001);
  await assert.rejects(pending, { code: 'PROCESSING_TIMEOUT' });
  assert.equal(providerSignal?.aborted, true);
});

test('model without runtime configuration is unavailable and does not borrow host credentials', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  try {
    assert.equal(modelStatus().configured, false);
    assert.equal(modelStatus().verified, false);
    assert.equal(createVisionProvider(), undefined);
    await assert.rejects(interpretRequest('кабель', []), { code: 'MODEL_UNAVAILABLE' });
  } finally {
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
    if (oldModel !== undefined) process.env.OPENAI_MODEL = oldModel;
  }
});
