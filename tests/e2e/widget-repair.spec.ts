import { test, expect, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; browserErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

async function saveTwoLines(page: Page) {
  const state = await (await page.request.get('/api/state')).json();
  const origin = new URL(page.url()).origin;
  const headers = { origin, 'x-csrf-token': state.csrf };
  const prepared = await page.request.post('/api/proposal', { headers, data: { lines: [{ productId: 'DEMO-C16-IN', quantity: 2 }, { productId: 'DEMO-CABLE', quantity: 0.5 }], excluded: [] } });
  expect(prepared.ok()).toBe(true);
  const { proposal } = await prepared.json();
  const saved = await page.request.post('/api/confirm', { headers, data: { proposalId: proposal.id, version: proposal.version, hash: proposal.hash, confirmed: true } });
  expect(saved.ok()).toBe(true);
}

test('EKT-011 parent and widget show the saved server cart after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
  await saveTwoLines(page);
  await page.goto('/embed');
  await expect(page.locator('.header-nav .count')).toHaveText('2');
  await page.getByRole('button', { name: 'Помочь с подбором?', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('.header-nav .count')).toHaveText('2');
  await page.reload();
  await expect(page.locator('.header-nav .count')).toHaveText('2');
});

test('EKT-011 initializes one session before iframe and synchronizes actual add/remove', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/state', async route => {
    await ready;
    await route.continue();
  });
  await page.goto('/embed');
  const launcher = page.getByRole('button', { name: 'Помочь с подбором?', exact: true });
  await expect(launcher).toBeDisabled();
  await expect(page.locator('.header-nav .count')).toHaveText('…');
  await expect(page.locator('iframe')).toHaveCount(0);
  release();
  await launcher.click();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('Запрос ассистенту')).toBeEnabled();
  await frame.getByLabel('Запрос ассистенту').fill('DEMO-C16-IN');
  await frame.getByLabel('Запрос ассистенту').press('Enter');
  await frame.getByRole('button', { name: 'В предложение', exact: true }).click();
  await frame.getByRole('button', { name: 'Подтверждаю состав и сумму', exact: true }).click();
  await expect(page.locator('.header-nav .count')).toHaveText('1');
  await expect(frame.locator('.header-nav .count')).toHaveText('1');
  await frame.getByRole('link', { name: 'Открыть корзину', exact: true }).click();
  await frame.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(frame.locator('.header-nav .count')).toHaveText('0');
  await expect(page.locator('.header-nav .count')).toHaveText('0');
  await page.getByRole('button', { name: 'Закрыть виджет', exact: true }).click();
  await launcher.click();
  await expect(frame.locator('.header-nav .count')).toHaveText('0');
});

test('EKT-011 rejects wrong origin, source and malformed notification instead of trusting a count', async ({ page }) => {
  await page.goto('/embed');
  await page.getByRole('button', { name: 'Помочь с подбором?', exact: true }).click();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('Запрос ассистенту')).toBeEnabled();
  await expect(page.locator('.header-nav .count')).toHaveText('0');
  // Ensure the initial frame notification is consumed before observing subsequent requests.
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/state') && response.request().frame() === page.mainFrame());
  await frame.locator('body').evaluate(() => window.parent.postMessage({ type: 'ekt:cart-changed' }, window.location.origin));
  await refreshed;
  let stateRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/state') && request.frame() === page.mainFrame()) stateRequests++; });
  await page.evaluate(() => {
    const source = document.querySelector('iframe')!.contentWindow;
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.example', source, data: { type: 'ekt:cart-changed' } }));
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data: { type: 'ekt:cart-changed' } }));
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source, data: { type: 'ekt:cart-changed', count: 99 } }));
  });
  await page.waitForTimeout(150); // A bounded quiet window proves these notifications cause no request.
  expect(stateRequests).toBe(0);
  await expect(page.locator('.header-nav .count')).toHaveText('0');
  await frame.locator('body').evaluate(() => window.parent.postMessage({ type: 'ekt:cart-changed' }, window.location.origin));
  await expect.poll(() => stateRequests).toBe(1);
});

for (const width of [360, 1440]) test(`EKT-012 modal widget contains keyboard focus and Escape from iframe at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/embed');
  const launcher = page.getByRole('button', { name: 'Помочь с подбором?', exact: true });
  await launcher.click();
  const dialog = page.getByRole('dialog', { name: 'Виджет EKT' });
  const close = page.getByRole('button', { name: 'Закрыть виджет', exact: true });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('Запрос ассистенту')).toBeEnabled();
  await page.screenshot({ path: `.tmp/repair-widget-${width}.png` });
  await close.press('Tab');
  await expect(frame.getByRole('link', { name: 'EKT — ассистент' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await frame.getByLabel('Запрос ассистенту').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(close).toBeFocused();
  await close.click();
  await expect(launcher).toBeFocused();
});

for (const width of [360, 390]) test(`EKT-013 specification keyboard focus stays above normal and resized composer at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await expect(page.getByLabel('Запрос ассистенту')).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({ name: 'keyboard-specification.csv', mimeType: 'text/csv', buffer: Buffer.from('Артикул;Количество;Единица\nDEMO-C16-OUT;4;шт\nDEMO-CABLE;3.5;м') });
  await page.getByRole('button', { name: 'Распознать файл', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сопоставить заново', exact: true })).toBeEnabled();
  for (const resized of [false, true]) {
    if (resized) {
      const composer = page.getByLabel('Запрос ассистенту');
      await composer.fill('Первая строка\nВторая строка\nТретья строка\nЧетвёртая строка');
      const box = (await composer.boundingBox())!;
      await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
      await page.mouse.down(); await page.mouse.move(box.x + box.width - 3, box.y + box.height + 75, { steps: 8 }); await page.mouse.up();
      expect((await composer.boundingBox())!.height).toBeGreaterThan(box.height + 30);
    }
    await page.getByLabel('Наименование', { exact: true }).first().focus();
    let checked = 0;
    for (let index = 0; index < 30; index++) {
      if (!await page.evaluate(() => !!document.activeElement?.closest('.specification'))) break;
      await expect.poll(() => page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const rect = active.getBoundingClientRect();
        const composer = document.querySelector('.composer-area')!.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.top >= 0 && rect.bottom <= composer.top && !!hit && active.contains(hit);
      }), { timeout: 2000, message: 'Focused specification control must be visible above the composer' }).toBe(true);
      checked++;
      await page.keyboard.press('Tab');
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    await page.getByLabel('Товар каталога').last().focus();
    await page.screenshot({ path: `.tmp/repair-composer-${width}-${resized ? 'resized' : 'normal'}.png` });
  }
});
