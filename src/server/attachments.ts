import path from 'node:path';
import ExcelJS from 'exceljs';
import * as yauzl from 'yauzl';
import { XMLParser } from 'fast-xml-parser';

export interface VisionProvider {
  readImage(buffer: Buffer, mime: string, signal?: AbortSignal): Promise<string>;
}

export interface AttachmentLine { query: string; quantity: number; unit?: string; source: string }
export interface ParsedAttachment { lines: AttachmentLine[]; warnings: string[]; text: string }
export const ATTACHMENT_LIMITS = { bytes: 8 * 1024 * 1024, rows: 100, pdfPages: 20, scannedPages: 3, processingMs: 45_000, expandedBytes: 32 * 1024 * 1024, text: 100_000 } as const;

export class AttachmentError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never { throw new AttachmentError(code, message); }
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
const normalizeUnit = (value: string) => ({ 'штук': 'шт', 'штука': 'шт', 'шт.': 'шт', 'метр': 'м', 'метров': 'м', 'м.': 'м', 'pcs': 'шт', 'pc': 'шт', 'm': 'м' }[value.toLowerCase()] || value.toLowerCase());
const isUnit = (value: string) => /^(шт\.?|штук|штука|м\.?|метр|метров|кг|уп\.?|упак\.?|компл\.?|pcs?|m)$/i.test(value);
const quantity = (value: string) => {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return undefined;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) && number > 0 && number <= 1_000_000 ? number : undefined;
};

function splitRow(line: string, selectedDelimiter?: string): string[] {
  const delimiter = selectedDelimiter ?? (line.includes('\t') ? '\t' : line.includes(';') ? ';' : undefined);
  if (!delimiter) return [clean(line)];
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(clean(value)); value = ''; }
    else value += char;
  }
  cells.push(clean(value));
  return cells;
}

function csvRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const records: string[] = [];
  let record = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { record += '""'; index++; continue; }
      quoted = !quoted;
    }
    if (char === '\n' && !quoted) { records.push(record); record = ''; } else record += char;
  }
  if (quoted) fail('INVALID_CSV', 'В CSV не закрыта кавычка. Проверьте формат файла.');
  if (record) records.push(record);
  return records.map((line) => splitRow(line, delimiter));
}

/** Missing quantities are visible warnings; numbers within technical markings are never quantities. */
function parseRows(rows: { cells: string[]; source: string }[], warnings: string[]): AttachmentLine[] {
  const lines: AttachmentLine[] = [];
  let columns: { query: number; quantity: number; unit: number } | undefined;
  for (const { cells: raw, source } of rows) {
    const cells = raw.map(clean);
    if (!cells.some(Boolean)) continue;
    const queryHeader = cells.findIndex((cell) => /^(наименование(?: товара)?|товар|материал|название|артикул|description|product|name)$/i.test(cell));
    const quantityHeader = cells.findIndex((cell) => /^(количество|кол[ -]?во|кол\.?|quantity|qty)$/i.test(cell));
    if (queryHeader >= 0 && (quantityHeader >= 0 || cells.length > 1)) {
      columns = { query: queryHeader, quantity: quantityHeader, unit: cells.findIndex((cell) => /^(единица(?: измерения)?|ед\.?\s?(?:изм\.?)?|unit|units)$/i.test(cell)) };
      continue;
    }
    const quantityOnly = cells.length === 1 ? cells[0]?.match(/^(\d+(?:[.,]\d+)?)\s*(шт\.?|штук|м\.?|метр(?:ов)?|кг|уп\.?|упак\.?|компл\.?|pcs?|m)$/i) : null;
    if (!columns && quantityOnly) {
      const previous = lines.at(-1);
      const warningIndex = previous ? warnings.indexOf(`${previous.source}: количество не задано — предварительно 1; проверьте перед подтверждением.`) : -1;
      const count = quantity(quantityOnly[1]);
      if (previous && warningIndex >= 0 && count !== undefined) {
        previous.quantity = count;
        previous.unit = normalizeUnit(quantityOnly[2]);
        warnings.splice(warningIndex, 1);
      } else warnings.push(`${source}: количество без названия товара пропущено; проверьте исходный файл.`);
      continue;
    }
    let query = columns ? cells[columns.query] || '' : cells[0] || '';
    let count = columns && columns.quantity >= 0 ? quantity(cells[columns.quantity] || '') : undefined;
    let unit = columns && columns.unit >= 0 ? cells[columns.unit] : undefined;
    if (columns && columns.quantity >= 0 && cells[columns.quantity] && count === undefined) {
      warnings.push(`${source}: количество «${cells[columns.quantity].slice(0, 30)}» не распознано; проверьте строку.`);
    }
    if (!columns && cells.length > 1) {
      // Headerless rows accept a name followed by quantity/unit, optionally preceded by row number.
      const start = /^\d+[.)]?$/.test(cells[0] || '') && cells.length > 2 ? 1 : 0;
      query = cells[start] || '';
      count = quantity(cells[start + 1] || '');
      if (isUnit(cells[start + 1] || '')) {
        unit = cells[start + 1];
        count = quantity(cells[start + 2] || '');
      } else if (isUnit(cells[start + 2] || '')) unit = cells[start + 2];
      if (count === undefined && cells.length > start + 1) query = cells.slice(start).filter(Boolean).join(' ');
    }
    if (!columns && cells.length === 1) {
      const match = query.match(/^(.*?)\s*(?:[—–;]|\s-\s)?\s+(\d+(?:[.,]\d+)?)\s*(шт\.?|штук|м\.?|метр(?:ов)?|кг|уп\.?|упак\.?|компл\.?|pcs?|m)\s*$/i);
      if (match && clean(match[1]).length > 1) {
        query = clean(match[1]).replace(/[—–-]\s*$/, '').trim();
        count = quantity(match[2]);
        unit = match[3];
      }
    }
    if (!query || /^(?:спецификация|список товаров|ведомость|итого|всего|№|номер)\s*[:.]?$/i.test(query)) continue;
    if (query.length > 2_000) fail('TEXT_LIMIT', 'Одна строка превышает 2000 символов. Сократите спецификацию.');
    if (count === undefined) warnings.push(`${source}: количество не задано — предварительно 1; проверьте перед подтверждением.`);
    lines.push({ query, quantity: count ?? 1, ...(unit ? { unit: normalizeUnit(unit) } : {}), source });
    if (lines.length > ATTACHMENT_LIMITS.rows) fail('ROW_LIMIT', 'В спецификации более 100 позиций. Разделите файл.');
  }
  return lines;
}

/** ZIP is checked and streamed before any Office parser is allowed to see it. No filesystem extraction. */
async function inspectOfficeZip(buffer: Buffer, signal: AbortSignal): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(new AttachmentError('INVALID_OFFICE', 'Повреждённый файл Office.'));
      const files = new Map<string, Buffer>();
      let entries = 0;
      let expanded = 0;
      let settled = false;
      const abort = (message: string, code = 'UNSAFE_OFFICE') => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(new AttachmentError(code, message));
      };
      const cancelled = () => abort('Превышено время обработки файла.', 'PROCESSING_TIMEOUT');
      signal.addEventListener('abort', cancelled, { once: true });
      zip.once('close', () => signal.removeEventListener('abort', cancelled));
      if (signal.aborted) { cancelled(); return; }
      zip.on('error', () => abort('Не удалось безопасно прочитать архив Office.', 'INVALID_OFFICE'));
      zip.on('end', () => { if (!settled) { settled = true; resolve(files); } });
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++;
        expanded += entry.uncompressedSize;
        if (entries > 2_000 || expanded > ATTACHMENT_LIMITS.expandedBytes || entry.uncompressedSize > 16 * 1024 * 1024 || (entry.uncompressedSize > 1_000_000 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 100)) return abort('Архив Office превышает допустимый размер распаковки.', 'ZIP_LIMIT');
        if ((entry.generalPurposeBitFlag & 1) !== 0) return abort('Зашифрованные файлы Office не поддерживаются.');
        if (/(?:^|\/)(?:vbaProject\.bin|externalLinks|embeddings)(?:\/|$)/i.test(entry.fileName)) return abort('Макросы, встроенные объекты и внешние связи в Office не поддерживаются.');
        if (files.has(entry.fileName)) return abort('Повторяющиеся файлы внутри архива Office.');
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return abort('Повреждённый элемент Office.', 'INVALID_OFFICE');
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on('error', () => abort('Повреждённый элемент Office.', 'INVALID_OFFICE'));
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > entry.uncompressedSize || bytes > 16 * 1024 * 1024) { stream.destroy(); abort('Архив Office превышает допустимый размер распаковки.', 'ZIP_LIMIT'); return; }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            if (settled) return;
            const content = Buffer.concat(chunks);
            if (/\.(?:xml|rels)$/i.test(entry.fileName) && /<!DOCTYPE|<!ENTITY/i.test(content.toString('utf8'))) return abort('Внешние сущности XML запрещены.');
            files.set(entry.fileName, content);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function officeText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return ''; // Cached formula results are untrusted too.
    if ('richText' in value) return value.richText.map((item) => item.text).join('');
    if ('text' in value) return value.text;
    return '';
  }
  return String(value);
}

async function parseXlsx(buffer: Buffer, name: string, files: Map<string, Buffer>, warnings: string[]) {
  if (!files.has('xl/workbook.xml')) fail('INVALID_OFFICE', 'Файл не является книгой XLSX.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const rows: { cells: string[]; source: string }[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 1_000 || sheet.columnCount > 100) fail('ROW_LIMIT', 'Таблица слишком велика: допустимы 100 позиций и до 100 колонок.');
    if (sheet.state !== 'visible') { warnings.push(`Скрытый лист «${sheet.name}» пропущен.`); continue; }
    sheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        if (cell.type === ExcelJS.ValueType.Formula) warnings.push(`${sheet.name}, строка ${rowNumber}: формула пропущена; введите обычное значение.`);
        cells[column - 1] = officeText(cell.value);
      });
      rows.push({ cells, source: `${name} / ${sheet.name}, строка ${rowNumber}` });
    });
  }
  return rows;
}

type XmlNode = Record<string, unknown>;
function xmlText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  return nodes.map((node: XmlNode) => {
    if ('#text' in node) return String(node['#text']);
    if ('tab' in node) return '\t';
    if ('br' in node || 'cr' in node) return ' ';
    return Object.entries(node).filter(([key]) => key !== ':@').map(([, value]) => xmlText(value)).join('');
  }).join('');
}

function parseDocx(files: Map<string, Buffer>, name: string) {
  const body = files.get('word/document.xml');
  if (!body) fail('INVALID_OFFICE', 'Файл не является документом DOCX.');
  const parser = new XMLParser({ preserveOrder: true, removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, processEntities: true, trimValues: false });
  const document: XmlNode[] = parser.parse(body.toString('utf8'));
  const rows: { cells: string[]; source: string }[] = [];
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes as XmlNode[]) {
      if ('tr' in node && Array.isArray(node.tr)) {
        const cells = (node.tr as XmlNode[]).filter((child) => 'tc' in child).map((child) => clean(xmlText(child.tc)));
        rows.push({ cells, source: `${name}, строка ${rows.length + 1}` });
      } else if ('p' in node) {
        const text = xmlText(node.p);
        if (clean(text)) rows.push({ cells: splitRow(text), source: `${name}, строка ${rows.length + 1}` });
      } else for (const [key, children] of Object.entries(node)) if (key !== ':@') walk(children);
      if (rows.length > 1_000) fail('ROW_LIMIT', 'В документе слишком много строк. Разделите файл.');
    }
  };
  walk(document);
  return rows;
}

async function parsePdf(buffer: Buffer, name: string, warnings: string[], vision: VisionProvider | undefined, signal: AbortSignal) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Text extraction only: no viewer, scripting manager, rendering or remote font/CMap URLs.
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 12_000_000 });
  const rows: { cells: string[]; source: string }[] = [];
  const abortDocument = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener('abort', abortDocument, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > ATTACHMENT_LIMITS.pdfPages) fail('PAGE_LIMIT', 'PDF содержит более 20 страниц. Разделите файл.');
    let totalText = 0;
    const scanned: number[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const before = rows.length;
      let line = '';
      let lastY: number | undefined;
      const flush = () => { if (clean(line)) rows.push({ cells: splitRow(line), source: `${name}, страница ${index}` }); line = ''; };
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(lastY - y) > 3) flush();
        line += (line ? ' ' : '') + item.str;
        totalText += item.str.length;
        if (totalText > ATTACHMENT_LIMITS.text) fail('TEXT_LIMIT', 'В PDF слишком много текста. Разделите файл.');
        lastY = y;
        if (item.hasEOL) flush();
      }
      flush();
      if (rows.length === before) scanned.push(index);
      page.cleanup();
    }
    if (scanned.length && vision) {
      if (scanned.length > ATTACHMENT_LIMITS.scannedPages) fail('SCAN_PAGE_LIMIT', 'В PDF более 3 страниц без текста. Для распознавания разделите скан на файлы до 3 страниц.');
      const { createCanvas } = await import('@napi-rs/canvas');
      for (const index of scanned) {
        signal.throwIfAborted();
        const page = await pdf.getPage(index);
        const natural = page.getViewport({ scale: 1 });
        if (!Number.isFinite(natural.width * natural.height) || natural.width <= 0 || natural.height <= 0) fail('INVALID_PDF', 'Недопустимый размер страницы PDF.');
        const scale = Math.min(1.8, Math.sqrt(3_000_000 / (natural.width * natural.height)), 2_000 / Math.max(natural.width, natural.height));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        const render = page.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport, annotationMode: 0, background: '#ffffff' });
        const cancelRender = () => render.cancel();
        signal.addEventListener('abort', cancelRender, { once: true });
        try { await render.promise; }
        finally { signal.removeEventListener('abort', cancelRender); }
        signal.throwIfAborted();
        const jpeg = await canvas.encode('jpeg', 80);
        canvas.width = 1;
        canvas.height = 1;
        const text = await vision.readImage(jpeg, 'image/jpeg', signal);
        totalText += text.length;
        if (totalText > ATTACHMENT_LIMITS.text) fail('TEXT_LIMIT', 'В PDF слишком много распознанного текста. Разделите файл.');
        if (!text.trim()) warnings.push(`${name}, страница ${index}: читаемая маркировка не найдена.`);
        rows.push(...text.split(/\r?\n/).map((line) => ({ cells: splitRow(line), source: `${name}, страница ${index} (распознано моделью)` })));
        page.cleanup();
      }
      warnings.push('Страницы PDF без текстового слоя распознаны моделью. Проверьте маркировки, количества и единицы перед подтверждением.');
    } else if (scanned.length) {
      warnings.push(`${name}: ${scanned.length} стр. не содержит текстового слоя. Runtime vision-модель не подключена; экспортируйте текстовый PDF/XLSX или подключите модель для OCR.`);
    }
    return rows;
  } finally { signal.removeEventListener('abort', abortDocument); await task.destroy(); }
}

async function parseAttachmentCore(file: { name: string; type: string; buffer: Buffer }, vision: VisionProvider | undefined, signal: AbortSignal): Promise<ParsedAttachment> {
  if (!file.buffer.length) fail('EMPTY_FILE', 'Файл пуст.');
  if (file.buffer.length > ATTACHMENT_LIMITS.bytes) fail('FILE_LIMIT', 'Файл превышает лимит 8 МБ.');
  const name = path.basename(file.name.replaceAll('\\', '/')).slice(0, 180);
  const extension = path.extname(name).toLowerCase();
  if (['.xls', '.doc'].includes(extension)) fail('LEGACY_FORMAT', 'Старые XLS/DOC не поддерживаются. Сохраните файл как XLSX/DOCX.');
  const permittedMime: Record<string, string[]> = {
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.pdf': ['application/pdf'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'],
    '.txt': ['text/plain'], '.csv': ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'], '.tsv': ['text/tab-separated-values', 'text/plain'],
  };
  const declaredType = file.type.split(';')[0].trim().toLowerCase();
  if (declaredType && declaredType !== 'application/octet-stream' && permittedMime[extension] && !permittedMime[extension].includes(declaredType)) fail('MIME_MISMATCH', 'Тип файла не соответствует расширению. Загрузите исходный файл в заявленном формате.');
  const warnings: string[] = [];
  let rows: { cells: string[]; source: string }[] = [];
  try {
    if (['.xlsx', '.docx'].includes(extension)) {
      if (file.buffer.readUInt16LE(0) !== 0x4b50) fail('INVALID_OFFICE', 'Содержимое не соответствует формату Office.');
      const files = await inspectOfficeZip(file.buffer, signal);
      rows = extension === '.xlsx' ? await parseXlsx(file.buffer, name, files, warnings) : parseDocx(files, name);
    } else if (extension === '.pdf') {
      if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('INVALID_PDF', 'Содержимое не соответствует формату PDF.');
      rows = await parsePdf(file.buffer, name, warnings, vision, signal);
    } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      const isJpeg = file.buffer.length > 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
      const isPng = file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isWebp = file.buffer.subarray(0, 4).toString() === 'RIFF' && file.buffer.subarray(8, 12).toString() === 'WEBP';
      const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : undefined;
      if (!mime) fail('INVALID_IMAGE', 'Содержимое не соответствует JPEG, PNG или WebP.');
      if (!permittedMime[extension].includes(mime)) fail('MIME_MISMATCH', 'Формат изображения не соответствует расширению файла.');
      if (!vision) return { lines: [], text: '', warnings: ['Распознавание фото недоступно: runtime vision-модель не подключена. Введите маркировку или загрузите XLSX, DOCX либо PDF с текстом.'] };
      const text = await vision.readImage(file.buffer, mime, signal);
      if (text.length > ATTACHMENT_LIMITS.text) fail('TEXT_LIMIT', 'Результат распознавания слишком большой.');
      warnings.push('Текст распознан моделью и может содержать ошибки. Проверьте маркировку, количество и единицы; невидимые технические параметры не определяются.');
      if (!text.trim()) warnings.push('Читаемая маркировка не найдена. Нужны более чёткое фото или введённые вручную параметры.');
      rows = text.split(/\r?\n/).map((line, index) => ({ cells: splitRow(line), source: `${name}, распознанная строка ${index + 1}` }));
    } else if (['.txt', '.csv', '.tsv'].includes(extension)) {
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); }
      catch { return fail('TEXT_ENCODING', 'Сохраните текстовый файл в кодировке UTF-8.'); }
      if (text.includes('\0')) fail('INVALID_TEXT', 'Текстовый файл содержит двоичные данные.');
      const content = text.replace(/^\uFEFF/, '');
      const cells = extension === '.csv' ? csvRows(content) : content.split(/\r?\n/).map((line) => splitRow(line));
      rows = cells.map((row, index) => ({ cells: row, source: `${name}, строка ${index + 1}` }));
    } else fail('UNSUPPORTED_FORMAT', 'Поддерживаются XLSX, DOCX, PDF с текстовым слоем, TXT/CSV/TSV и JPEG/PNG/WebP.');
    const text = rows.map((row) => row.cells.join('\t')).join('\n');
    if (text.length > ATTACHMENT_LIMITS.text) fail('TEXT_LIMIT', 'Извлечённый текст превышает лимит. Разделите файл.');
    const lines = parseRows(rows, warnings);
    if (!lines.length && !warnings.length) warnings.push('Позиции не найдены. Проверьте, что файл содержит наименования товаров и количества.');
    return { lines, warnings: [...new Set(warnings)], text };
  } catch (error) {
    if (error instanceof AttachmentError || (error instanceof Error && 'code' in error && error.code === 'MODEL_UNAVAILABLE')) throw error;
    throw new AttachmentError('PARSE_FAILED', 'Не удалось прочитать файл. Проверьте формат, отсутствие пароля и целостность документа.');
  }
}

/** Timeouts cancel ZIP/PDF work and the configured provider request. Synchronous Office parsing
 * cannot be interrupted in-process; byte/expansion/row caps bound that portion of the work. */
export async function parseAttachment(file: { name: string; type: string; buffer: Buffer }, vision?: VisionProvider): Promise<ParsedAttachment> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new AttachmentError('PROCESSING_TIMEOUT', 'Обработка файла заняла больше 45 секунд. Разделите файл или повторите позже.'));
      controller.abort();
    }, ATTACHMENT_LIMITS.processingMs);
  });
  try { return await Promise.race([parseAttachmentCore(file, vision, controller.signal), expired]); }
  finally { if (timeout) clearTimeout(timeout); }
}
