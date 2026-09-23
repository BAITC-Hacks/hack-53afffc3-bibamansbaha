import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CartService } from '../src/server/cart';
import type { CatalogAdapter } from '../src/server/catalog';
import type { Product, Proposal, RequestedLine } from '../src/shared/types';

function fixture(path = ':memory:') {
  const product: Product = { id: 'SYNTHETIC-CABLE', sku: 'SYNTHETIC-CABLE', name: 'Synthetic cable', category: 'cable', priceMinor: 45000, currency: 'KZT', unit: 'м', stock: 200, warehouses: [], attributes: {}, image: null, url: null, certificates: [], evidence: [], warnings: [], minQuantity: null, packSize: null, mode: 'fixture' };
  const catalog = { get: async () => structuredClone(product) } as unknown as CatalogAdapter;
  const service = new CartService(path, catalog);
  const session = service.createSession();
  const source: RequestedLine = { id: 'source-1', query: product.sku, quantity: 2, rawQuantity: 2, rawUnit: 'упак', unit: 'упак', source: 'Synthetic file', selectedId: product.id, selection: 'manual', matches: [], status: 'exact' };
  return { product, catalog, service, session, source };
}

const confirmation = (p: Proposal) => ({ proposalId: p.id, version: p.version, hash: p.hash, confirmed: true });

test('EKT-003/004 one reviewed source line cannot be counted twice in a proposal', async t => {
  const { product, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [source]);
  await service.reviewRequestedUnit(session.id, source.id);
  const selection = { lineId: source.id, productId: product.id, quantity: 2 };
  await assert.rejects(() => service.prepare(session.id, [selection, selection]), { code: 'SOURCE_CONTEXT' });
  assert.equal(service.currentProposal(session.id), null);
  const p = await service.prepare(session.id, [selection]);
  assert.equal((await service.confirm(session.id, confirmation(p))).cart.lines[0].quantity, 2);
});

test('EKT-003/004 cart quantity and catalog-unit edits cannot reuse an earlier packaging review', async t => {
  for (const scenario of [{ unit: 'м', quantity: 3 }, { unit: 'шт', quantity: 2 }, { unit: 'шт', quantity: 3 }]) {
    await t.test(`${scenario.quantity} ${scenario.unit}`, async subtest => {
      const { product, service, session, source } = fixture(); subtest.after(() => service.close());
      service.saveRequestedLines(session.id, [source]); await service.reviewRequestedUnit(session.id, source.id);
      const p = await service.prepare(session.id, [{ lineId: source.id, productId: product.id, quantity: 2 }]);
      const before = (await service.confirm(session.id, confirmation(p))).cart;
      product.unit = scenario.unit;
      await assert.rejects(() => service.updateCart(session.id, product.id, scenario.quantity, before.revision), { code: 'UNIT_REVIEW' });
      assert.deepEqual(service.getCart(session.id), before);
      assert.equal(service.currentProposal(session.id)?.status, 'committed');
    });
  }
});

test('expired and orphaned source rows are removed while active session rows remain', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 8, 23) });
  const path = join(tmpdir(), `ekt-source-retention-${randomUUID()}.sqlite`);
  const { service, session, source } = fixture(path);
  const stored = new DatabaseSync(path);
  t.after(() => { stored.close(); service.close(); for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix); });
  service.saveRequestedLines(session.id, [source]);
  t.mock.timers.tick(23 * 3600_000);
  const active = service.createSession(); service.saveRequestedLines(active.id, [{ ...source, query: 'ACTIVE-SOURCE' }]);
  stored.prepare('INSERT INTO requested_lines VALUES (?, ?)').run('synthetic-orphan-session', JSON.stringify([source]));
  t.mock.timers.tick(3600_000 + 1);
  service.createSession();
  const retained = stored.prepare('SELECT session_id FROM requested_lines').all() as { session_id: string }[];
  assert.deepEqual(retained.map(row => row.session_id), [active.id]);
  assert.equal(service.requestedLines(active.id)[0].query, 'ACTIVE-SOURCE');
  service.createSession();
  assert.equal((stored.prepare('SELECT COUNT(*) AS count FROM requested_lines').get() as { count: number }).count, 1);
});

test('ordinary meters still support fractional cart editing and explicit deletion', async t => {
  const { product, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [{ ...source, quantity: 0.5, rawQuantity: 0.5, rawUnit: 'm', unit: 'м' }]);
  const p = await service.prepare(session.id, [{ lineId: source.id, productId: product.id, quantity: 0.5 }]);
  let cart = (await service.confirm(session.id, confirmation(p))).cart;
  cart = await service.updateCart(session.id, product.id, 0.25, cart.revision);
  assert.equal(cart.totalMinor, 11250);
  cart = await service.updateCart(session.id, product.id, 0.75, cart.revision);
  assert.equal(cart.totalMinor, 33750);
  assert.equal((await service.updateCart(session.id, product.id, 0, cart.revision)).lines.length, 0);
});

test('a price-only replacement retains the unchanged reviewed packaging quantity', async t => {
  const { product, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [source]); await service.reviewRequestedUnit(session.id, source.id);
  const p = await service.prepare(session.id, [{ lineId: source.id, productId: product.id, quantity: 2 }]);
  const before = (await service.confirm(session.id, confirmation(p))).cart;
  product.priceMinor = 46000;
  await assert.rejects(() => service.updateCart(session.id, product.id, 2, before.revision), { code: 'DATA_CHANGED' });
  const replacement = service.currentProposal(session.id)!;
  assert.equal(replacement.status, 'awaiting_confirmation');
  assert.equal(replacement.lines[0].quantity, 2);
  assert.equal(replacement.lines[0].unitConfirmed, true);
  assert.equal((await service.confirm(session.id, confirmation(replacement))).cart.totalMinor, 92000);
});

test('different reviewed source rows for the same product still aggregate', async t => {
  const { product, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [source, { ...source, id: 'source-2' }]);
  await service.reviewRequestedUnit(session.id, source.id); await service.reviewRequestedUnit(session.id, 'source-2');
  const p = await service.prepare(session.id, [source.id, 'source-2'].map(lineId => ({ lineId, productId: product.id, quantity: 2 })));
  assert.equal((await service.confirm(session.id, confirmation(p))).cart.lines[0].quantity, 4);
});

test('only an explicit review of the new cart quantity and actual unit permits a packaging edit', async t => {
  const { product, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [source]); await service.reviewRequestedUnit(session.id, source.id);
  const p = await service.prepare(session.id, [{ lineId: source.id, productId: product.id, quantity: 2 }]);
  const before = (await service.confirm(session.id, confirmation(p))).cart;
  for (const review of [{ quantity: 2, unit: 'м' }, { quantity: 3, unit: 'шт' }]) {
    await assert.rejects(() => service.updateCart(session.id, product.id, 3, before.revision, review), { code: 'UNIT_REVIEW' });
    assert.deepEqual(service.getCart(session.id), before);
  }
  const updated = await service.updateCart(session.id, product.id, 3, before.revision, { quantity: 3, unit: 'м' });
  assert.equal(updated.lines[0].quantity, 3);
  assert.equal(updated.totalMinor, 135000);
  await assert.rejects(() => service.updateCart(session.id, product.id, 4, before.revision, { quantity: 4, unit: 'м' }), { code: 'CART_CHANGED' });
  product.unit = 'шт';
  await assert.rejects(() => service.updateCart(session.id, product.id, 4, updated.revision, { quantity: 4, unit: 'м' }), { code: 'UNIT_REVIEW' });
  assert.deepEqual(service.getCart(session.id), updated);
});

test('a cart review cannot follow a newer revision while the catalog lookup is pending', async t => {
  const { product, catalog, service, session, source } = fixture(); t.after(() => service.close());
  service.saveRequestedLines(session.id, [source]); await service.reviewRequestedUnit(session.id, source.id);
  const p = await service.prepare(session.id, [{ lineId: source.id, productId: product.id, quantity: 2 }]);
  const before = (await service.confirm(session.id, confirmation(p))).cart;
  product.priceMinor = 46000;
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  catalog.get = async () => { await barrier; return structuredClone(product); };
  const pending = service.updateCart(session.id, product.id, 3, before.revision, { quantity: 3, unit: 'м' });
  await service.updateCart(session.id, product.id, 0, before.revision);
  release();
  await assert.rejects(() => pending, { code: 'CART_CHANGED' });
  assert.equal(service.getCart(session.id).lines.length, 0);
  assert.equal(service.currentProposal(session.id)?.status, 'committed');
});
