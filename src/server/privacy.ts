import { AppError } from './errors';

export const PAYMENT_REDACTED = '[Платёжные реквизиты удалены. Для подбора товаров они не нужны.]';

/** Conservative text heuristics, not a guarantee for every secret or raw image. */
export function containsPaymentData(text: string): boolean {
  text = text.replace(/\\[nrt]/g, ' ').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ');
  if (/(?:\b(?:cvv2?|cvc2?|card\s*(?:number|no)|expiry|iban)|номер\s*карт[ыа]|реквизит[ыа]?\s*(?:карт|оплат)|срок\s*действия\s*карт)[^\n]{0,60}\d/i.test(text)) return true;
  if (/(?:карт[аы]|visa|mastercard).{0,80}(?:срок\s*действия|valid\s*thru).{0,20}\d{2}\s*[/.-]\s*\d{2,4}/i.test(text)) return true;
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_-])(?:\d[ -]*){12,18}\d(?![\p{L}\p{N}_-])/gu)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) continue;
    let sum = 0;
    for (let index = digits.length - 1, double = false; index >= 0; index--, double = !double) {
      let digit = Number(digits[index]);
      if (double) { digit *= 2; if (digit > 9) digit -= 9; }
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export function assertSafeText(text: string): void {
  if (containsPaymentData(text)) throw new AppError('PAYMENT_DATA', 'Платёжные реквизиты в этот чат не нужны. Отправьте запрос о товарах без номера карты, CVV/CVC и других реквизитов.', 422);
}

export function safeHistoryText(text: string): string {
  return containsPaymentData(text) ? PAYMENT_REDACTED : text;
}

export function safeStoredValue<T>(value: T): T {
  if (typeof value === 'string') return safeHistoryText(value) as T;
  if (Array.isArray(value)) return value.map(item => safeStoredValue(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeStoredValue(item)])) as T;
  return value;
}
