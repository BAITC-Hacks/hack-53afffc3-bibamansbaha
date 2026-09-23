import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// Synthetic input examples only. No private partner files, prices, stock or credentials.
// Public SKU 200300285_ was observed in the read-only catalog. A SKU in a sample
// is a search request, not a promise of availability. The app uses its ordinary parser.
const rows = [['Наименование', 'Количество', 'Ед. изм.'], ['200300285_', 2, 'шт'], ['Кабель ВВГнг 3х2,5', 25, 'м']];
const directory = path.resolve(process.argv[2] || '.tmp/demo-files');
await fs.mkdir(directory, { recursive: true });

const workbook = new ExcelJS.Workbook();
workbook.creator = 'EKT demo generator';
const sheet = workbook.addWorksheet('Спецификация');
rows.forEach((row) => sheet.addRow(row));
sheet.columns = [{ width: 38 }, { width: 16 }, { width: 16 }];
sheet.getRow(1).font = { bold: true };
await workbook.xlsx.writeFile(path.join(directory, 'sample-specification.xlsx'));

const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const wordRows = rows.map((row) => `<w:tr>${row.map((value) => `<w:tc><w:p><w:r><w:t>${escape(value)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('');
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Спецификация</w:t></w:r></w:p><w:tbl>${wordRows}</w:tbl><w:sectPr/></w:body></w:document>`);
await fs.writeFile(path.join(directory, 'sample-specification.docx'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
await fs.writeFile(path.join(directory, 'sample-specification.txt'), rows.map((row) => row.join(';')).join('\n') + '\n', 'utf8');
await fs.writeFile(path.join(directory, 'fixture-specification.csv'), 'Артикул;Количество;Единица\nDEMO-C16-OUT;2;шт\nDEMO-CABLE;2.5;м\n', 'utf8');
await fs.writeFile(path.join(directory, 'fixture-unit-review.csv'), 'Артикул;Количество;Единица\nDEMO-CABLE;2;упак\n', 'utf8');

// A real PDF text layer, kept ASCII so the example does not depend on external fonts.
const content = 'BT /F1 14 Tf 50 750 Td (200300285_ - 2 pcs) Tj 0 -24 Td (Cable VVGng 3x2.5 - 25 m) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Count 1 /Kids [4 0 R] >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
await fs.writeFile(path.join(directory, 'sample-specification.pdf'), pdf);

const { createCanvas } = await import('@napi-rs/canvas');
const canvas = createCanvas(900, 200);
const context = canvas.getContext('2d');
context.fillStyle = 'white';
context.fillRect(0, 0, 900, 200);
context.fillStyle = 'black';
context.font = '60px Arial';
context.fillText('200300285_ ; 2 ; pcs', 30, 115);
const jpeg = await canvas.encode('jpeg', 90);
await fs.writeFile(path.join(directory, 'sample-label.jpg'), jpeg);
const drawing = 'q 540 0 0 120 30 650 cm /Im0 Do Q';
const scannedObjects = [
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
  Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'),
  Buffer.from(`<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 900 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
];
const scanChunks = [Buffer.from('%PDF-1.4\n')];
const scanOffsets = [];
let scanLength = scanChunks[0].length;
scannedObjects.forEach((object, index) => {
  scanOffsets.push(scanLength);
  const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
  scanChunks.push(chunk);
  scanLength += chunk.length;
});
scanChunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${scanOffsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${scanLength}\n%%EOF`));
await fs.writeFile(path.join(directory, 'sample-scanned.pdf'), Buffer.concat(scanChunks));
console.log(`Created synthetic XLSX, DOCX, TXT, text-layer PDF, scanned PDF and JPEG examples in ${directory}`);
