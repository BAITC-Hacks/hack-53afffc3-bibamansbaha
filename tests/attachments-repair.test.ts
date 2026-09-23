import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseAttachment } from '../src/server/attachments';

test('EKT-004 CSV keeps an unknown packaging unit and points to the source requiring review', async () => {
  const parsed = await parseAttachment({ name: 'new-spec.csv', type: 'text/csv', buffer: Buffer.from('Кабель ВВГнг 3х2,5;2;бухта') });
  assert.equal(parsed.lines[0].query, 'Кабель ВВГнг 3х2,5');
  assert.equal(parsed.lines[0].quantity, 2);
  assert.equal(parsed.lines[0].unit, 'бухта');
  assert.ok(parsed.warnings.some((warning) => warning.includes('new-spec.csv, строка 1') && warning.includes('бухта')));
  assert.equal(parsed.lines[0].rawUnit, 'бухта');
  assert.equal(parsed.lines[0].rawQuantity, 2);
});

test('EKT-005 headerless CSV preserves numeric and mixed SKUs and decimal quantities', async () => {
  const parsed = await parseAttachment({ name: 'sku.csv', type: 'text/csv', buffer: Buffer.from('000123;2;шт\nABC-7;0,25;м\n10;3;шт') });
  assert.deepEqual(parsed.lines.map(({ query, quantity, unit }) => ({ query, quantity, unit })), [
    { query: '000123', quantity: 2, unit: 'шт' },
    { query: 'ABC-7', quantity: 0.25, unit: 'м' },
    { query: '10', quantity: 3, unit: 'шт' },
  ]);
});

test('EKT-004 explicit text units survive while current and cross-section remain product parameters', async () => {
  const parsed = await parseAttachment({ name: 'source.txt', type: 'text/plain', buffer: Buffer.from('Кабель ВВГнг 3х2,5 — 2 бухты\nАвтомат 16 А\nКабель ВВГнг 3х2,5') });
  assert.equal(parsed.lines[0].query, 'Кабель ВВГнг 3х2,5');
  assert.equal(parsed.lines[0].quantity, 2);
  assert.equal(parsed.lines[0].rawUnit, 'бухты');
  assert.ok(parsed.lines[0].unit);
  assert.ok(parsed.warnings.some((warning) => warning.includes('строка 1') && warning.includes('бухты')));
  assert.equal(parsed.lines[1].query, 'Автомат 16 А');
  assert.equal(parsed.lines[1].rawQuantity, undefined);
  assert.equal(parsed.lines[2].query, 'Кабель ВВГнг 3х2,5');
});

test('EKT-005 numbered columns require a header or explicit numbering marker, otherwise clarification', async () => {
  const header = await parseAttachment({ name: 'numbered.csv', type: 'text/csv', buffer: Buffer.from('№;Артикул;Количество;Ед. изм.\n1;000123;2;шт') });
  assert.equal(header.lines[0].query, '000123');
  assert.equal(header.lines[0].quantity, 2);
  const marked = await parseAttachment({ name: 'marked.csv', type: 'text/csv', buffer: Buffer.from('1.;000123;2;шт') });
  assert.equal(marked.lines[0].query, '000123');
  await assert.rejects(parseAttachment({ name: 'ambiguous.csv', type: 'text/csv', buffer: Buffer.from('1;000123;2;шт') }), { code: 'COLUMN_AMBIGUITY' });
});

test('EKT-006 XLSX keeps zero-padded identifiers without formatting numeric quantities', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Позиции');
  sheet.addRow(['Артикул', 'Количество', 'Единица']);
  sheet.addRow([123, 0.25, 'м']);
  sheet.getCell('A2').numFmt = '000000';
  sheet.getCell('B2').numFmt = '0.000';
  sheet.addRow(['000456', 2, 'шт']);
  sheet.addRow([789, 3, 'шт']);
  const parsed = await parseAttachment({ name: 'formatted.xlsx', type: '', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  assert.deepEqual(parsed.lines.map(({ query, quantity }) => ({ query, quantity })), [
    { query: '000123', quantity: 0.25 },
    { query: '000456', quantity: 2 },
    { query: '789', quantity: 3 },
  ]);
});

async function wordDocument(body: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const paragraph = (text: string) => `<w:p>${run(text)}</w:p>`;

test('EKT-007 separates Word cell paragraphs but preserves contiguous runs inside an SKU', async () => {
  const header = `<w:tr><w:tc>${paragraph('Наименование')}</w:tc><w:tc>${paragraph('Количество')}</w:tc><w:tc>${paragraph('Единица')}</w:tc></w:tr>`;
  const cable = `<w:tr><w:tc>${paragraph('Кабель ВВГнг')}${paragraph('3х2,5')}</w:tc><w:tc>${paragraph('4')}</w:tc><w:tc>${paragraph('м')}</w:tc></w:tr>`;
  const sku = `<w:tr><w:tc><w:p>${run('000')}${run('123')}</w:p></w:tc><w:tc>${paragraph('2')}</w:tc><w:tc>${paragraph('шт')}</w:tc></w:tr>`;
  const parsed = await parseAttachment({ name: 'paragraphs.docx', type: '', buffer: await wordDocument(`<w:tbl>${header}${cable}${sku}</w:tbl>`) });
  assert.deepEqual(parsed.lines.map(({ query, quantity, unit }) => ({ query, quantity, unit })), [
    { query: 'Кабель ВВГнг 3х2,5', quantity: 4, unit: 'м' },
    { query: '000123', quantity: 2, unit: 'шт' },
  ]);
  assert.match(parsed.lines[0].sourceText ?? '', /Кабель ВВГнг 3х2,5/);
});

test('EKT-004 deterministic vision retains unknown units and safe original evidence', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
  const parsed = await parseAttachment({ name: 'scan.jpg', type: 'image/jpeg', buffer: jpeg }, {
    async readImage() { return 'DEMO-CABLE;2;бухта\nDEMO-CABLE;0,25;м\nDEMO-C16-IN;3;шт'; },
  });
  assert.equal(parsed.lines[0].rawUnit, 'бухта');
  assert.equal(parsed.lines[0].unit, 'бухта');
  assert.equal(parsed.lines[0].rawQuantity, 2);
  assert.ok(parsed.warnings.some((warning) => warning.includes('распознанная строка 1') && warning.includes('бухта')));
  assert.match(parsed.lines[0].sourceText ?? '', /бухта/);
  assert.equal(parsed.lines[1].quantity, 0.25);
  assert.equal(parsed.lines[1].unit, 'м');
  assert.equal(parsed.lines[2].unit, 'шт');
});

test('EKT-006 unsupported numeric identifier formats request clarification without inventing a code', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Позиции');
  sheet.addRow(['Артикул', 'Количество', 'Единица']);
  sheet.addRow([123, 2, 'шт']);
  sheet.getCell('A2').numFmt = '000-000';
  await assert.rejects(parseAttachment({ name: 'complex-format.xlsx', type: '', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }), { code: 'IDENTIFIER_FORMAT' });
});

test('EKT-007 Word tabs separate fields and explicit line breaks separate words', async () => {
  const tabbed = `<w:p>${run('000')}${run('123')}<w:r><w:tab/></w:r>${run('2')}<w:r><w:tab/></w:r>${run('шт')}</w:p>`;
  const broken = `<w:p>${run('Кабель')}<w:r><w:br/></w:r>${run('ВВГнг 3х2,5 — 0,25 м')}</w:p>`;
  const parsed = await parseAttachment({ name: 'tabs.docx', type: '', buffer: await wordDocument(tabbed + broken) });
  assert.equal(parsed.lines[0].query, '000123');
  assert.equal(parsed.lines[0].quantity, 2);
  assert.equal(parsed.lines[1].query, 'Кабель ВВГнг 3х2,5');
  assert.equal(parsed.lines[1].quantity, 0.25);
});

test('EKT-004 quantity on a following vision line keeps the original quantity and unit evidence', async () => {
  const parsed = await parseAttachment({ name: 'two-lines.txt', type: 'text/plain', buffer: Buffer.from('DEMO-CABLE\n0,25 м') });
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].rawQuantity, 0.25);
  assert.equal(parsed.lines[0].rawUnit, 'м');
  assert.match(parsed.lines[0].sourceText ?? '', /0,25 м/);
});

test('EKT-004 preserves unknown unit before quantity and explicit packaging at the end of text', async () => {
  const reversed = await parseAttachment({ name: 'reversed.csv', type: 'text/csv', buffer: Buffer.from('Кабель;бухта;2') });
  assert.equal(reversed.lines[0].query, 'Кабель');
  assert.equal(reversed.lines[0].rawUnit, 'бухта');
  assert.equal(reversed.lines[0].quantity, 2);
  const text = await parseAttachment({ name: 'pack.txt', type: 'text/plain', buffer: Buffer.from('Кабель ВВГнг 3х2,5 2 бухты') });
  assert.equal(text.lines[0].query, 'Кабель ВВГнг 3х2,5');
  assert.equal(text.lines[0].quantity, 2);
  assert.equal(text.lines[0].rawUnit, 'бухты');
});
