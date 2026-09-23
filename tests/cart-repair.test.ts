import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartService, lineTotal } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';
import type { Proposal } from '../src/shared/types';
const confirm = (p: Proposal) => ({ proposalId: p.id, version: p.version, hash: p.hash, confirmed: true });

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
