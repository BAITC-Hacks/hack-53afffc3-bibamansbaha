import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretRequest } from '../src/server/model';

test('EKT-003 explicit packaging survives even when the provider omits it', async (t) => {
  process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ query: 'DEMO-CABLE', quantity: 2, unit: null, unitEvidence: null, intent: 'search' }) }] }] }), { headers: { 'content-type': 'application/json' } }));
  const result = await interpretRequest('Найди DEMO-CABLE, нужно 2 упаковки', []);
  assert.equal(result.unit, 'упаковки');
  assert.equal(result.unitEvidence, '2 упаковки');
  assert.equal(result.quantity, 2);
});
