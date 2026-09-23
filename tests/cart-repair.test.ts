import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CartService, lineTotal } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';
import type { Proposal } from '../src/shared/types';
const confirm = (p: Proposal) => ({ proposalId: p.id, version: p.version, hash: p.hash, confirmed: true });

function temporaryDatabase() {
  const root = resolve(process.cwd(), '.tmp'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'cart-repair-matrix-'));
  const path = join(directory, 'isolated.sqlite');
  const cleanup = () => { for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix); rmdirSync(directory); };
  return { path, cleanup };
}

test('EKT-001 preview includes the complete old-line repricing and stores exactly that plan', async (t) => {
  const catalog = new Catalog('fixture'); const get = catalog.get.bind(catalog); let price = 195000;
  catalog.get = async id => ({ ...await get(id), priceMinor: price });
  const service = new CartService(':memory:', catalog); t.after(() => service.close());
  const s = service.createSession();
  await service.confirm(s.id, confirm(await service.prepare(s.id, [{ productId: 'DEMO-C16-IN', quantity: 2 }])));
  for (const [next, before, after, delta, repricing] of [[210000, 390000, 630000, 240000, 30000], [190000, 630000, 760000, 130000, -60000], [190000, 760000, 950000, 190000, 0]]) {
    price = next;
    const p = await service.prepare(s.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);
    assert.deepEqual(p.plan && [p.plan.beforeMinor, p.plan.afterMinor, p.plan.deltaMinor, p.plan.repricingMinor], [before, after, delta, repricing]);
    assert.equal(p.plan?.repricedLines?.reduce((sum,line)=>sum+line.deltaMinor,0),repricing);
    assert.equal((await service.confirm(s.id, confirm(p))).cart.totalMinor, after);
  }
});

test('EKT-014 money overflow fails before loss of precision, fractional meters retain rounding', async (t) => {
  assert.throws(() => lineTotal(Number.MAX_SAFE_INTEGER, 3), { code: 'MONEY_RANGE' });
  assert.equal(lineTotal(45000, 0.25), 11250);
  assert.equal(lineTotal(195001, 0.001), 195);
  assert.equal(lineTotal(Number.MAX_SAFE_INTEGER, 1), Number.MAX_SAFE_INTEGER);
  const catalog = new Catalog('fixture'); const get = catalog.get.bind(catalog);
  catalog.get = async id => ({ ...await get(id), priceMinor: Number.MAX_SAFE_INTEGER });
  const cart = new CartService(':memory:', catalog); t.after(() => cart.close());
  const session = cart.createSession();
  await assert.rejects(() => cart.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }, { productId: 'DEMO-C25', quantity: 1 }]), { code: 'MONEY_RANGE' });
  assert.equal(cart.getCart(session.id).totalMinor, 0);
});

test('legacy awaiting proposals without a contract version reject without deleting the saved cart', async t => {
  const { path, cleanup } = temporaryDatabase();
  const service = new CartService(path, new Catalog('fixture')); const stored = new DatabaseSync(path);
  t.after(() => { stored.close(); service.close(); cleanup(); });
  const session = service.createSession();
  const initial = await service.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 2 }]);
  const before = (await service.confirm(session.id, confirm(initial))).cart;
  const pending = await service.prepare(session.id, [{ productId: 'DEMO-CABLE', quantity: 0.5 }]);
  const legacy = { ...pending }; delete legacy.contractVersion;
  stored.prepare('UPDATE proposals SET body=? WHERE id=? AND session_id=?').run(JSON.stringify(legacy), pending.id, session.id);
  await assert.rejects(() => service.confirm(session.id, confirm(pending)), { code: 'VERSION' });
  assert.equal(service.getProposal(session.id, pending.id).status, 'invalidated');
  assert.deepEqual(service.getCart(session.id), before);
  assert.equal(service.getCart(session.id).totalMinor, 390000);
});

test('two SQLite connections cannot apply a stale revision or old plan over an intervening edit', async t => {
  const { path, cleanup } = temporaryDatabase(); const catalog = new Catalog('fixture');
  const first = new CartService(path, catalog); const second = new CartService(path, new Catalog('fixture'));
  t.after(() => { second.close(); first.close(); cleanup(); });
  const session = first.createSession();
  const initial = await first.prepare(session.id, [{ productId: 'DEMO-CABLE', quantity: 0.5 }]);
  const before = (await first.confirm(session.id, confirm(initial))).cart;
  const old = await first.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);
  const get = catalog.get.bind(catalog); let release!: () => void;
  const barrier = new Promise<void>(resolveBarrier => { release = resolveBarrier; });
  catalog.get = async id => { await barrier; return get(id); };
  const confirming = first.confirm(session.id, confirm(old));
  const rejected = assert.rejects(confirming, { code: 'STATE' });
  const edited = await second.updateCart(session.id, 'DEMO-CABLE', 0.25, before.revision);
  await assert.rejects(() => first.updateCart(session.id, 'DEMO-CABLE', 0.75, before.revision), { code: 'CART_CHANGED' });
  release(); await rejected;
  assert.equal(edited.totalMinor, 11250);
  assert.deepEqual(first.getCart(session.id), edited);
  assert.deepEqual(second.getCart(session.id), edited);
  assert.equal(first.getProposal(session.id, old.id).status, 'invalidated');
});

test('safe money boundary survives repeated SQLite reads and a sum overflow leaves the cart intact', async t => {
  const { path, cleanup } = temporaryDatabase(); const catalog = new Catalog('fixture'); const get = catalog.get.bind(catalog);
  catalog.get = async id => ({ ...await get(id), priceMinor: id === 'DEMO-C16-IN' ? Number.MAX_SAFE_INTEGER : 1 });
  const first = new CartService(path, catalog); const second = new CartService(path, catalog);
  t.after(() => { second.close(); first.close(); cleanup(); });
  const session = first.createSession();
  const proposal = await first.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);
  const saved = (await first.confirm(session.id, confirm(proposal))).cart;
  for (let read = 0; read < 3; read++) {
    assert.equal(first.getCart(session.id).totalMinor, 9007199254740991);
    assert.equal(second.getCart(session.id).lines[0].lineTotalMinor, 9007199254740991);
    assert.equal(second.getProposal(session.id, proposal.id).committedCart?.totalMinor, 9007199254740991);
  }
  await assert.rejects(() => second.prepare(session.id, [{ productId: 'DEMO-C25', quantity: 1 }]), { code: 'MONEY_RANGE' });
  assert.deepEqual(first.getCart(session.id), saved);
  assert.deepEqual(second.getCart(session.id), saved);
  assert.equal(second.currentProposal(session.id)?.id, proposal.id);
  assert.equal(second.currentProposal(session.id)?.status, 'committed');
});
