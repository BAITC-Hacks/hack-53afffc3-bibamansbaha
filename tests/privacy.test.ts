import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CartService } from '../src/server/cart';
import { Catalog } from '../src/server/catalog';
import { parseAttachment } from '../src/server/attachments';
import { interpretRequest } from '../src/server/model';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanPaymentMessages } from '../src/server/privacy-maintenance';

const synthetic = ['4111', '1111', '1111', '1111'].join(' ');
test('EKT-002 payment text is rejected before message persistence while product numbers remain intact', (t) => {
  const cart = new CartService(':memory:', new Catalog('fixture'));
  t.after(() => cart.close());
  const session = cart.createSession();
  for (const text of [`Номер карты ${synthetic}`, synthetic.replaceAll(' ', '\u00a0'), synthetic.replaceAll(' ', '\n'), 'CVV: 123', 'CVV123', 'CVV\n123', 'карта, срок действия 12/28', 'номер карты 1234567890123456']) {
    assert.throws(() => cart.addMessage(session.id, { role: 'user', text }), { code: 'PAYMENT_DATA' });
  }
  assert.equal(cart.messages(session.id).length, 0);
  const ordinary = 'Артикул 000123, кабель 3х2,5, ток 160/250 А, 123 штуки';
  cart.addMessage(session.id, { role: 'user', text: ordinary });
  assert.equal(cart.messages(session.id)[0].text, ordinary);
});

test('EKT-002 extracted payment text is rejected before being returned from the attachment parser', async () => {
  await assert.rejects(() => parseAttachment({ name: 'input.csv', type: 'text/csv', buffer: Buffer.from(`Номер карты ${synthetic};1;шт`) }), { code: 'PAYMENT_DATA' });
});

test('EKT-002 payment input never reaches the external provider', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY, oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('External calls forbidden'); });
  await assert.rejects(() => interpretRequest(`Номер карты ${synthetic}`, []), { code: 'PAYMENT_DATA' });
  assert.equal(calls, 0);
});

test('EKT-002 legacy records are safe on read and cleanup is targeted, transactional and repeatable', (t) => {
  const database = join(mkdtempSync(join(tmpdir(), 'ekt-privacy-')), 'isolated.sqlite');
  const cart = new CartService(database, new Catalog('fixture'));
  t.after(() => cart.close());
  const session = cart.createSession();
  cart.addMessage(session.id, { role: 'user', text: '000123 кабель 3х2,5' });
  const db = new DatabaseSync(database);
  const legacy = { id: 'legacy', role: 'user', text: `Номер карты ${synthetic}, CVV 123`, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(legacy.id, session.id, JSON.stringify(legacy), legacy.createdAt);
  db.prepare('INSERT INTO proposals VALUES(?,?,?)').run('old-proposal', session.id, JSON.stringify({ id: 'old-proposal', status: 'awaiting_confirmation', lines: [], excluded: [legacy.text], expiresAt: new Date(Date.now() + 60000).toISOString() }));
  db.close();
  assert.equal(JSON.stringify(cart.messages(session.id)).includes(synthetic), false);
  assert.equal(JSON.stringify(cart.currentProposal(session.id)).includes(synthetic), false);
  assert.deepEqual(cleanPaymentMessages(database), { scanned: 2, matched: 1, anonymized: 0, mode: 'dry-run' });
  assert.equal(cleanPaymentMessages(database, true).anonymized, 1);
  assert.equal(cleanPaymentMessages(database, true).anonymized, 0);
  assert.equal(cart.messages(session.id)[0].text, '000123 кабель 3х2,5');
  assert.equal(cart.getCart(session.id).lines.length, 0);
  const verify = new DatabaseSync(database, { readOnly: true });
  assert.equal(JSON.stringify(verify.prepare('SELECT body FROM messages').all()).includes(synthetic), false);
  verify.close();
});

test('EKT-002 legacy context is masked before provider serialization', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY, oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel; });
  let leaked = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    leaked = String(options.body).includes(synthetic);
    return new Response(JSON.stringify({ id: 'resp-test', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ query: '000123', quantity: 2, intent: 'search' }), annotations: [] }] }] }), { headers: { 'content-type': 'application/json' } });
  });
  assert.equal((await interpretRequest('Артикул 000123, 2 штуки', [`Номер карты ${synthetic}`])).quantity, 2);
  assert.equal(leaked, false);
});
