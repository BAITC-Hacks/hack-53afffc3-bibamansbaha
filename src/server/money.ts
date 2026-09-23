import { AppError } from './errors';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function safe(value: bigint): number {
  if (value < 0n || value > MAX) throw new AppError('MONEY_RANGE', 'Сумма превышает поддерживаемый точный диапазон. Уменьшите количество.');
  return Number(value);
}
export function quantityMillis(quantity: number): bigint {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !/^\d+(?:\.\d{1,3})?$/.test(String(quantity))) throw new AppError('QUANTITY', 'Укажите положительное количество, не более трёх знаков после запятой.');
  const [whole, fraction = ''] = String(quantity).split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function quantitySum(a: number, b: number): number { return Number(quantityMillis(a) + (b ? quantityMillis(b) : 0n)) / 1000; }
export function lineTotal(priceMinor: number, quantity: number): number {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw new AppError('CATALOG_PRICE', 'Источник вернул недопустимую цену.', 503);
  return safe((BigInt(priceMinor) * quantityMillis(quantity) + 500n) / 1000n);
}
export function totalMoney(lines: { lineTotalMinor: number }[]): number {
  return safe(lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.lineTotalMinor) || line.lineTotalMinor < 0) throw new AppError('MONEY_RANGE', 'Недопустимая денежная сумма.');
    return sum + BigInt(line.lineTotalMinor);
  }, 0n));
}
