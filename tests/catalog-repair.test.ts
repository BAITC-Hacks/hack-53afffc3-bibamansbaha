import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../src/server/catalog';
import { CartService } from '../src/server/cart';

function configuration(t: TestContext) {
  const values = { EKT_API_USERNAME: 'synthetic', EKT_API_PASSWORD: 'synthetic', CATALOG_MAX_PAGES: '2', EKT_API_BASE_URL: 'https://ekt.kz' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
const raw = { id: '1', article: 'SYNTHETIC-001', name: 'Synthetic cable', price: '12.50', quantity: 10 };
const page = { page: 1, per_page: 1, count: 2, items: [raw] };
const shortPage = { ...page, per_page: 2, count: 1 };

test('EKT-017 one operation budget includes all catalog pages instead of restarting per request', async (t) => {
  configuration(t);
  let now = 1_000, attempts = 0;
  const catalog = new Catalog('live', { now: () => now, operationTimeoutMs: 250, transport: async () => { attempts++; now += 150; return page; } });
  await assert.rejects(() => catalog.load(), { code: 'CATALOG_TIMEOUT' });
  assert.equal(attempts, 2);
  assert.equal(catalog.status().count, 0, 'a partial failed load must not be published as successful cache');
});

test('EKT-017 concurrent searches share loading and warm search proves cache reuse without HTTP', async (t) => {
  configuration(t);
  let attempts = 0, now = 1_000;
  const catalog = new Catalog('live', { now: () => now, transport: async (url, _authorization, _signal, timing) => {
    attempts++; await Promise.resolve(); now += 5; timing('fetchMs', 2); timing('readMs', 3);
    return url.pathname.endsWith('/detail') ? raw : shortPage;
  } });
  const results = await Promise.all([catalog.search(raw.article), catalog.search(raw.article)]);
  assert.equal(results[0][0].product.priceMinor, 1250);
  assert.equal(results[1][0].product.stock, 10);
  assert.equal(attempts, 2, 'one page and one detail for concurrent readers');
  const cold = catalog.diagnostics();
  assert.equal(cold.loadJoins, 1);
  assert.equal(cold.detailJoins, 1);
  assert.equal(cold.timings.fetchMs, 4);
  assert.equal(cold.timings.readMs, 6);
  await catalog.search(raw.article);
  const warm = catalog.diagnostics();
  assert.equal(attempts, 2);
  assert.equal(warm.instanceId, cold.instanceId);
  assert.equal(warm.cacheHits - cold.cacheHits, 2);
  assert.equal(JSON.stringify(warm).includes(raw.article), false);
  assert.equal(JSON.stringify(warm).includes('synthetic'), false);
});

test('EKT-017 list and detail share one search deadline', async (t) => {
  configuration(t);
  let now = 1_000, attempts = 0;
  const catalog = new Catalog('live', { now: () => now, operationTimeoutMs: 250, transport: async (url) => {
    attempts++; now += 150; return url.pathname.endsWith('/detail') ? raw : shortPage;
  } });
  await assert.rejects(() => catalog.search(raw.article), { code: 'CATALOG_TIMEOUT' });
  assert.equal(attempts, 2);
  assert.equal(catalog.diagnostics().lastOperation?.kind, 'search');
});

test('EKT-017 a retry consumes the original deadline rather than receiving another full budget', async (t) => {
  configuration(t);
  let now = 1_000, attempts = 0;
  const catalog = new Catalog('live', { now: () => now, operationTimeoutMs: 250, transport: async () => {
    attempts++; now += 150; if (attempts === 1) throw new Error('Synthetic retryable failure'); return shortPage;
  } });
  await assert.rejects(() => catalog.load(), { code: 'CATALOG_TIMEOUT' });
  assert.equal(attempts, 2);
  assert.equal(catalog.status().fetchedAt, null);
});

test('EKT-017 expired cache refresh fails closed and rejected loading can recover', async (t) => {
  configuration(t);
  let now = 1_000, attempts = 0, offline = false;
  const catalog = new Catalog('live', { now: () => now, transport: async (url) => {
    attempts++; if (offline) throw new Error('Synthetic unavailable transport');
    return url.pathname.endsWith('/detail') ? raw : shortPage;
  } });
  await catalog.search(raw.article);
  const loadedAt = catalog.status().fetchedAt;
  now += 120_001; offline = true;
  await assert.rejects(() => catalog.search(raw.article), { code: 'CATALOG_UNAVAILABLE' });
  assert.equal(catalog.status().fetchedAt, loadedAt);
  assert.ok(catalog.status().error);
  assert.ok(catalog.diagnostics().cacheAgeMs! > catalog.diagnostics().cacheTtlMs);
  assert.equal(attempts, 4, 'one page/detail success and only two refresh attempts');
  offline = false;
  assert.equal((await catalog.search(raw.article))[0].product.stock, 10);
  assert.equal(attempts, 6);
  assert.equal(catalog.status().error, undefined);
});

test('EKT-017 deadline cancels a stalled transport and leaves no rejected in-flight cache', async (t) => {
  configuration(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stalled = true, attempts = 0, signal: AbortSignal | undefined;
  const catalog = new Catalog('live', { operationTimeoutMs: 25, transport: async (_url, _authorization, currentSignal) => {
    attempts++; signal = currentSignal;
    return stalled ? new Promise<never>(() => {}) : shortPage;
  } });
  const pending = catalog.load();
  t.mock.timers.tick(25);
  await assert.rejects(() => pending, { code: 'CATALOG_TIMEOUT' });
  assert.equal(signal?.aborted, true);
  assert.equal(attempts, 1, 'deadline exhaustion never starts another retry');
  stalled = false;
  await catalog.load();
  assert.equal(attempts, 2);
  assert.equal(catalog.status().count, 1);
});

test('EKT-017 unavailable fresh source prevents confirmation despite a warm detail cache', async (t) => {
  configuration(t);
  let offline = false;
  const catalog = new Catalog('live', { transport: async () => { if (offline) throw new Error('Synthetic offline'); return raw; } });
  // The synthetic transport has a known sale unit; the real API's absent unit stays unknown.
  const syntheticCatalog = { get: async (id: string, fresh?: boolean) => ({ ...await catalog.get(id, fresh), unit: 'шт' }), search: (query: string) => catalog.search(query), status: () => catalog.status() };
  const cart = new CartService(':memory:', syntheticCatalog); t.after(() => cart.close());
  const session = cart.createSession();
  const proposal = await cart.prepare(session.id, [{ productId: raw.id, quantity: 1 }]);
  assert.equal((await catalog.get(raw.id)).stock, 10);
  offline = true;
  await assert.rejects(() => cart.confirm(session.id, { proposalId: proposal.id, version: proposal.version, hash: proposal.hash, confirmed: true }), { code: 'CATALOG_UNAVAILABLE' });
  assert.equal(cart.getCart(session.id).lines.length, 0);
  assert.equal(cart.getProposal(session.id, proposal.id).status, 'awaiting_confirmation');
});

test('EKT-017 concurrent detail readers share one request and fresh reads bypass cached facts', async (t) => {
  configuration(t);
  let attempts = 0;
  const catalog = new Catalog('live', { transport: async () => { attempts++; await Promise.resolve(); return raw; } });
  const products = await Promise.all([catalog.get('1'), catalog.get('1')]);
  assert.equal(attempts, 1);
  assert.equal(products[0].priceMinor, 1250);
  assert.equal(catalog.diagnostics().detailJoins, 1);
  await catalog.get('1');
  assert.equal(attempts, 1, 'warm metadata/detail read uses a confirmed cache hit');
  await catalog.get('1', true);
  assert.equal(attempts, 2, 'fresh price and stock validation must perform another HTTP attempt');
});
