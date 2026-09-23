import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createModelBudget, ModelBudget, type ModelBudgetOptions } from '../src/server/model-budget';

function database(t: TestContext) {
  const root = resolve('.tmp'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'model-budget-test-'));
  const databasePath = join(directory, 'budget.sqlite');
  const connections: ModelBudget[] = [];
  t.after(() => { for (const budget of connections) budget.close(); for (const suffix of ['', '-wal', '-shm']) if (existsSync(databasePath + suffix)) unlinkSync(databasePath + suffix); rmdirSync(directory); });
  return (maxCalls = 6, maxUSD = 0.25, purpose?: ModelBudgetOptions['purpose']) => {
    const budget = new ModelBudget({ databasePath, maxCalls, maxUSD, purpose }); connections.push(budget); return budget;
  };
}

test('a reservation is persistent and an exhausted attempt stops before the provider', t => {
  const open = database(t); const first = open(1); let providerCalls = 0;
  const call = (budget: ModelBudget) => { const attempt = budget.reserve('gpt-4.1-mini'); providerCalls++; return attempt; };
  const attempt = call(first);
  assert.ok(attempt.attemptId);
  assert.equal(first.status().committedUSD, 0.04);
  first.close();
  const reopened = open(1);
  assert.equal(reopened.status().callsUsed, 1);
  assert.throws(() => call(reopened), { code: 'MODEL_BUDGET_EXHAUSTED' });
  assert.equal(providerCalls, 1);
});

test('completed usage refines cost while timeout, error and missing usage retain reservations', t => {
  const budget = database(t)();
  const complete = budget.reserve('gpt-4.1-mini');
  budget.settle(complete.attemptId, { status: 'completed', returnedModel: 'gpt-4.1-mini-2025-04-14', inputTokens: 1000, outputTokens: 100, durationMs: 1200 });
  assert.equal(budget.status().committedUSD, 0.00056);
  for (const status of ['error', 'timeout', 'completed'] as const) {
    const attempt = budget.reserve('gpt-4.1-mini');
    budget.settle(attempt.attemptId, { status, durationMs: 30000 });
  }
  assert.equal(budget.status().committedUSD, 0.12056);
  assert.equal(budget.status().callsUsed, 4);
  assert.equal(budget.status().attempts[0].returnedModel, 'gpt-4.1-mini-2025-04-14');
  budget.settle(complete.attemptId, { status: 'error', durationMs: 50000 });
  assert.equal(budget.status().committedUSD, 0.12056);
  assert.equal(budget.status().attempts[0].status, 'completed');
});

test('the guard is opt-in and enabled unknown models fail before reserving or calling', t => {
  assert.equal(createModelBudget(), undefined);
  const budget = database(t)();
  assert.throws(() => budget.reserve('unsupported-model'), { code: 'MODEL_BUDGET_MODEL' });
  assert.equal(budget.status().callsUsed, 0);
});

test('the money ceiling is checked against every reserved call before the provider', t => {
  const budget = database(t)(6, 0.079999999);
  const first = budget.reserve('gpt-4.1-mini');
  assert.throws(() => budget.reserve('gpt-4.1-mini'), { code: 'MODEL_BUDGET_EXHAUSTED' });
  budget.settle(first.attemptId, { status: 'completed', inputTokens: 1000, outputTokens: 100, durationMs: 500 });
  budget.reserve('gpt-4.1-mini');
  assert.equal(budget.status().callsUsed, 2);
  assert.equal(budget.status().committedUSD, 0.04056);
  assert.throws(() => budget.reserve('gpt-4.1-mini'), { code: 'MODEL_BUDGET_EXHAUSTED' });
});

test('two ledger instances admit at most six overlapping provider attempts', async t => {
  const open = database(t); const ledgers = [open(), open()]; let providerCalls = 0;
  let release!: () => void; const provider = new Promise<void>(resolveProvider => { release = resolveProvider; });
  const calls = Array.from({ length: 10 }, async (_, index) => {
    const budget = ledgers[index % 2]; const attempt = budget.reserve('gpt-4.1-mini');
    providerCalls++; await provider;
    budget.settle(attempt.attemptId, { status: 'timeout', durationMs: 30000 });
  });
  const results = Promise.allSettled(calls);
  assert.equal(providerCalls, 6);
  assert.equal(ledgers[1].status().committedUSD, 0.24);
  release();
  const settled = await results;
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 6);
  for (const rejected of settled.filter(result => result.status === 'rejected')) assert.equal(rejected.reason.code, 'MODEL_BUDGET_EXHAUSTED');
  ledgers.forEach(budget => budget.close());
  assert.equal(open().status().callsUsed, 6);
  assert.equal(open().status().committedUSD, 0.24);
});

test('invalid metadata cannot release reservations and timeout cannot be refunded by a late success', t => {
  const budget = database(t)(); const attempt = budget.reserve('gpt-4.1-mini');
  assert.throws(() => budget.settle(attempt.attemptId, { status: 'completed', inputTokens: -1, outputTokens: 1, durationMs: 20 }), { code: 'MODEL_BUDGET_METADATA' });
  assert.throws(() => budget.settle(attempt.attemptId, { status: 'completed', returnedModel: 'unsupported-model', inputTokens: 1, outputTokens: 1, durationMs: 20 }), { code: 'MODEL_BUDGET_MODEL' });
  assert.equal(budget.status().committedUSD, 0.04);
  const outcome = { status: 'timeout' as const, durationMs: 30000, prompt: 'SYNTHETIC-CONTENT-MUST-NOT-PERSIST', credential: 'SYNTHETIC-CREDENTIAL-MUST-NOT-PERSIST' };
  budget.settle(attempt.attemptId, outcome);
  budget.settle(attempt.attemptId, { status: 'completed', inputTokens: 1, outputTokens: 1, durationMs: 32000 });
  assert.equal(budget.status().attempts[0].status, 'timeout');
  assert.equal(budget.status().committedUSD, 0.04);
  assert.doesNotMatch(JSON.stringify(budget.status()), /SYNTHETIC-CONTENT|SYNTHETIC-CREDENTIAL/);
});

test('configuration cannot exceed the approved limits or use a relative database path', t => {
  const open = database(t);
  assert.throws(() => open(7), { code: 'MODEL_BUDGET_CONFIG' });
  assert.throws(() => open(6, 0.26), { code: 'MODEL_BUDGET_CONFIG' });
  assert.throws(() => new ModelBudget({ databasePath: '.tmp/relative.sqlite', maxCalls: 6, maxUSD: 0.25 }), { code: 'MODEL_BUDGET_CONFIG' });
  const disabled = open(0, 0);
  assert.throws(() => disabled.reserve('gpt-4.1-mini'), { code: 'MODEL_BUDGET_EXHAUSTED' });
});

test('GPT-5.5 reserves its bounded input and output, and counts reasoning within output cost', t => {
  const budget = database(t)();
  const attempt = budget.reserve('gpt-5.5', { inputTokens: 1000, outputTokens: 100 });
  assert.equal(budget.status().committedUSD, 0.008);
  budget.settle(attempt.attemptId, { status: 'completed', returnedModel: 'gpt-5.5-2026-04-23', inputTokens: 500, outputTokens: 80, reasoningTokens: 50, durationMs: 1000 });
  assert.equal(budget.status().committedUSD, 0.0049);
  assert.equal(budget.status().attempts[0].reasoningTokens, 50);
  assert.throws(() => budget.reserve('gpt-5.5'), { code: 'MODEL_BUDGET_BOUNDS' });
});

test('demo has its own persistent allowance and cannot reuse or reset the acceptance ledger', t => {
  const acceptance = database(t); const demo = database(t);
  const acceptanceBudget = acceptance(1);
  acceptanceBudget.reserve('gpt-4.1-mini'); acceptanceBudget.close();
  assert.throws(() => acceptance(6, 0.25, 'demo'), { code: 'MODEL_BUDGET_CONFIG' });
  assert.throws(() => acceptance(6).reserve('gpt-4.1-mini'), { code: 'MODEL_BUDGET_EXHAUSTED' });
  const demoBudget = demo(100, 1, 'demo');
  for (let i = 0; i < 7; i++) demoBudget.reserve('gpt-5.5', { inputTokens: 1000, outputTokens: 100 });
  demoBudget.close();
  assert.equal(demo(100, 1, 'demo').status().callsUsed, 7);
  assert.equal(demo(100, 1, 'demo').status().committedUSD, 0.056);
  assert.throws(() => demo(101, 1, 'demo'), { code: 'MODEL_BUDGET_CONFIG' });
  assert.throws(() => demo(100, 1.01, 'demo'), { code: 'MODEL_BUDGET_CONFIG' });
});
