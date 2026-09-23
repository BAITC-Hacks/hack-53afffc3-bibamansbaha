import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CartService } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';
import type { Proposal } from '../src/shared/types';

const confirmation = (proposal: Proposal) => ({
  proposalId: proposal.id,
  version: proposal.version,
  hash: proposal.hash,
  confirmed: true,
});

test('concurrent retries of one confirmation add the quantity exactly once', async (t) => {
  const service = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => service.close());
  const session = service.createSession();
  const proposal = await service.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 2 }]);

  const results = await Promise.all(Array.from({ length: 5 }, () =>
    service.confirm(session.id, confirmation(proposal))));

  assert.ok(results.every(result => result.proposal.status === 'committed'));
  const cart = service.getCart(session.id);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 2);
  assert.equal(cart.totalMinor, 390000);
});

test('incorrect proposal version or hash cannot change an empty cart', async (t) => {
  const service = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => service.close());
  const session = service.createSession();
  const proposal = await service.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);

  for (const invalid of [
    { ...confirmation(proposal), version: proposal.version + 1 },
    { ...confirmation(proposal), hash: 'incorrect-hash' },
  ]) {
    await assert.rejects(() => service.confirm(session.id, invalid), { code: 'VERSION' });
    assert.equal(service.getCart(session.id).lines.length, 0);
  }
  assert.equal(service.getProposal(session.id, proposal.id).status, 'awaiting_confirmation');
});

test('editing the cart invalidates the pending proposal', async (t) => {
  const service = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => service.close());
  const session = service.createSession();
  const initial = await service.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);
  await service.confirm(session.id, confirmation(initial));
  const pending = await service.prepare(session.id, [{ productId: 'DEMO-CABLE', quantity: 2.5 }]);

  await service.updateCart(session.id, 'DEMO-C16-IN', 3);

  await assert.rejects(() => service.confirm(session.id, confirmation(pending)), { code: 'STATE' });
  const cart = service.getCart(session.id);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0].quantity, 3);
  assert.equal(cart.totalMinor, 585000);
});

test('cart update and deletion remain isolated between sessions', async (t) => {
  const service = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => service.close());
  const owner = service.createSession();
  const other = service.createSession();
  const proposal = await service.prepare(owner.id, [{ productId: 'DEMO-C16-IN', quantity: 2 }]);
  await service.confirm(owner.id, confirmation(proposal));

  await assert.rejects(() => service.updateCart(other.id, 'DEMO-C16-IN', 0), { code: 'NOT_FOUND' });
  assert.equal(service.getCart(owner.id).lines[0].quantity, 2);
  assert.equal(service.getCart(other.id).lines.length, 0);

  const empty = await service.updateCart(owner.id, 'DEMO-C16-IN', 0);
  assert.equal(empty.lines.length, 0);
  assert.equal(empty.totalMinor, 0);
});

test('an expired proposal cannot be confirmed', async (t) => {
  const service = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => service.close());
  const session = service.createSession();
  const proposal = await service.prepare(session.id, [{ productId: 'DEMO-C16-IN', quantity: 1 }]);
  t.mock.method(Date, 'now', () => Date.parse(proposal.expiresAt) + 1);

  await assert.rejects(() => service.confirm(session.id, confirmation(proposal)), { code: 'EXPIRED' });
  assert.equal(service.getCart(session.id).lines.length, 0);
  assert.equal(service.getProposal(session.id, proposal.id).status, 'expired');
});

test('confirmed cart and idempotency survive reopening the SQLite database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ekt-cart-test-'));
  const database = join(directory, 'cart.sqlite');
  let service: CartService | undefined;
  try {
    service = new CartService(database, new Catalog('fixture'));
    const session = service.createSession();
    const proposal = await service.prepare(session.id, [{ productId: 'DEMO-CABLE', quantity: 2.5 }]);
    const original = await service.confirm(session.id, confirmation(proposal));
    service.close();
    service = undefined;

    service = new CartService(database, new Catalog('fixture'));
    assert.deepEqual(service.getCart(session.id), original.cart);
    const replay = await service.confirm(session.id, confirmation(proposal));
    assert.deepEqual(replay.cart, original.cart);
    assert.equal(replay.cart.lines[0].quantity, 2.5);
  } finally {
    service?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
