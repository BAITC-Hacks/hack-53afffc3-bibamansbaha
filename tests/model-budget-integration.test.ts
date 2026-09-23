import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interpretRequest, readImage, modelStatus } from '../src/server/model';
import { ModelBudget } from '../src/server/model-budget';

test('one persistent allowance covers text and vision, blocking the seventh provider call', async (t) => {
  const previous = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, budget: process.env.MODEL_BUDGET_PATH };
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  process.env.MODEL_BUDGET_PATH = join(mkdtempSync(join(tmpdir(), 'ekt-model-limit-')), 'budget.sqlite');
  t.after(() => {
    for (const [name, value] of Object.entries({ OPENAI_API_KEY: previous.key, OPENAI_MODEL: previous.model, MODEL_BUDGET_PATH: previous.budget })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    const body = JSON.parse(String(options.body));
    const result = Array.isArray(body.input)
      ? { items: [{ label: 'DEMO-CABLE', quantity: 2, unit: 'м' }] }
      : { query: 'DEMO-CABLE', quantity: 2, unit: null, unitEvidence: null, intent: 'search' };
    return new Response(JSON.stringify({ object: 'response', status: 'completed', model: 'gpt-4.1-mini-2025-04-14', usage: { input_tokens: 100, output_tokens: 50 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }), { headers: { 'content-type': 'application/json' } });
  });
  for (let i = 0; i < 5; i++) await interpretRequest('DEMO-CABLE, 2 м', []);
  assert.equal(await readImage(Buffer.from('fake image consumed only by provider stub'), 'image/jpeg'), 'DEMO-CABLE;2;м');
  await assert.rejects(() => interpretRequest('DEMO-CABLE, 3 м', []), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(() => readImage(Buffer.from('fake image'), 'image/jpeg'), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(calls, 6);
  assert.equal((await modelStatus()).available, false);
});

test('an incomplete provider result retains its reserve and an HTTP error is never retried', async (t) => {
  const previous = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, budget: process.env.MODEL_BUDGET_PATH };
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  const databasePath = join(mkdtempSync(join(tmpdir(), 'ekt-model-failure-')), 'budget.sqlite');
  process.env.MODEL_BUDGET_PATH = databasePath;
  t.after(() => {
    for (const [name, value] of Object.entries({ OPENAI_API_KEY: previous.key, OPENAI_MODEL: previous.model, MODEL_BUDGET_PATH: previous.budget })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ object: 'response', status: 'incomplete', model: 'gpt-4.1-mini', usage: { input_tokens: 100, output_tokens: 50 }, output: [] }), { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ error: { message: 'synthetic failure' } }), { status: 500, headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(() => interpretRequest('DEMO-CABLE', []), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(() => readImage(Buffer.from('fake image'), 'image/jpeg'), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(calls, 2);
  const budget = new ModelBudget({ databasePath, maxCalls: 6, maxUSD: 0.25 });
  t.after(() => budget.close());
  assert.equal(budget.status().committedUSD, 0.08);
  assert.deepEqual(budget.status().attempts.map(attempt => attempt.status), ['error', 'error']);
});

test('GPT-5.5 uses Responses low reasoning, preserves units, and switches to an independent demo allowance', async t => {
  const names = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'MODEL_BUDGET_PATH', 'MODEL_BUDGET_MODE', 'DEMO_BUDGET_PATH'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const directory = mkdtempSync(join(tmpdir(), 'ekt-gpt55-'));
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'gpt-5.5';
  process.env.MODEL_BUDGET_MODE = 'acceptance'; process.env.MODEL_BUDGET_PATH = join(directory, 'acceptance.sqlite');
  process.env.DEMO_BUDGET_PATH = join(directory, 'demo.sqlite');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, options: RequestInit) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options.body)); calls++;
    assert.equal(body.model, 'gpt-5.5'); assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.equal(body.store, false); assert.equal(body.temperature, undefined); assert.equal(body.top_p, undefined);
    const vision = Array.isArray(body.input);
    if (vision) assert.equal(body.input[0].content[1].detail, 'high');
    const result = vision ? { items: [{ label: 'DEMO-CABLE', quantity: 2, unit: 'упаковки' }] } : { query: 'DEMO-CABLE', quantity: 2, unit: null, unitEvidence: null, intent: 'search' };
    return new Response(JSON.stringify({ object: 'response', status: 'completed', model: 'gpt-5.5-2026-04-23', usage: { input_tokens: 500, output_tokens: 80, output_tokens_details: { reasoning_tokens: 50 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }), { headers: { 'content-type': 'application/json' } });
  });
  assert.equal((await interpretRequest('Найди DEMO-CABLE, нужно 2 упаковки', [])).unit, 'упаковки');
  assert.equal(await readImage(Buffer.from('test-only image'), 'image/jpeg'), 'DEMO-CABLE;2;упаковки');
  const acceptance = new ModelBudget({ databasePath: process.env.MODEL_BUDGET_PATH, maxCalls: 6, maxUSD: 0.25 });
  t.after(() => acceptance.close());
  assert.equal(acceptance.status().committedUSD, 0.0098);
  assert.equal(acceptance.status().attempts[1].reasoningTokens, 50);
  process.env.MODEL_BUDGET_MODE = 'demo';
  await interpretRequest('DEMO-CABLE', []);
  assert.equal(acceptance.status().callsUsed, 2);
  const demo = new ModelBudget({ databasePath: process.env.DEMO_BUDGET_PATH, maxCalls: 100, maxUSD: 1, purpose: 'demo' });
  t.after(() => demo.close());
  assert.equal(demo.status().callsUsed, 1);
  delete process.env.DEMO_BUDGET_PATH;
  await assert.rejects(() => interpretRequest('DEMO-CABLE', []), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(calls, 3);
});
