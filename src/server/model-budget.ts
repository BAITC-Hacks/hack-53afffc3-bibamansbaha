import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { AppError } from './errors';

const USD_SCALE = 1_000_000_000;
const RESERVE_NANO_USD = 40_000_000;
export type ModelTokenBounds = { inputTokens: number; outputTokens: number };
export function modelReserveUSD(model: string, bounds?: ModelTokenBounds): number {
  if (model === 'gpt-4.1-mini') return RESERVE_NANO_USD / USD_SCALE;
  if (model !== 'gpt-5.5') throw new AppError('MODEL_BUDGET_MODEL', 'Для этой модели бюджет не настроен.', 503);
  if (!bounds || !Number.isSafeInteger(bounds.inputTokens) || bounds.inputTokens < 1 || bounds.inputTokens > 100_000 || !Number.isSafeInteger(bounds.outputTokens) || bounds.outputTokens < 1 || bounds.outputTokens > 4_000) throw new AppError('MODEL_BUDGET_BOUNDS', 'Не задана безопасная граница стоимости AI-запроса.', 503);
  return (bounds.inputTokens * 5000 + bounds.outputTokens * 30000) / USD_SCALE;
}
export type ModelBudgetOptions = { databasePath: string; maxCalls: number; maxUSD: number; purpose?: 'acceptance' | 'demo' };
export type ModelBudgetSettlement = {
  status: 'completed' | 'error' | 'timeout'; returnedModel?: string;
  inputTokens?: number; outputTokens?: number; reasoningTokens?: number; durationMs: number;
};
export type ModelBudgetAttempt = {
  attemptId: string; startedAt: string; finishedAt: string | null;
  requestedModel: string; returnedModel: string | null;
  status: 'reserved' | 'completed' | 'error' | 'timeout';
  inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; durationMs: number | null;
  reservedUSD: number; committedUSD: number;
};
type StoredAttempt = {
  attempt_id: string; started_at: string; finished_at: string | null;
  requested_model: string; returned_model: string | null; status: ModelBudgetAttempt['status'];
  input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null; duration_ms: number | null;
  reserved_nano_usd: number; committed_nano_usd: number;
};

/** One caller-owned persistent ledger. It contains provider metadata only, never request bodies. */
export class ModelBudget {
  private db: DatabaseSync;
  private maxNanoUSD: number;
  constructor(private options: ModelBudgetOptions) {
    const purpose = options.purpose ?? 'acceptance';
    if (!['acceptance', 'demo'].includes(purpose) || !isAbsolute(options.databasePath) || !Number.isInteger(options.maxCalls) || options.maxCalls < 0 || options.maxCalls > (purpose === 'demo' ? 100 : 6) || !Number.isFinite(options.maxUSD) || options.maxUSD < 0 || options.maxUSD > (purpose === 'demo' ? 1 : 0.25)) {
      throw new AppError('MODEL_BUDGET_CONFIG', 'Некорректные настройки лимита демонстрации.', 503);
    }
    this.options = { ...options };
    this.maxNanoUSD = Math.floor(options.maxUSD * USD_SCALE);
    this.db = new DatabaseSync(options.databasePath);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS model_budget_attempts (
        attempt_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
        requested_model TEXT NOT NULL, returned_model TEXT, status TEXT NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, duration_ms INTEGER,
        reserved_nano_usd INTEGER NOT NULL, committed_nano_usd INTEGER NOT NULL
      )`);
    try {
      this.transaction(() => {
        const columns = this.db.prepare('PRAGMA table_info(model_budget_attempts)').all() as { name: string }[];
        if (!columns.some(column => column.name === 'reasoning_tokens')) this.db.exec('ALTER TABLE model_budget_attempts ADD COLUMN reasoning_tokens INTEGER');
        this.db.exec('CREATE TABLE IF NOT EXISTS model_budget_policy (id INTEGER PRIMARY KEY CHECK(id=1), purpose TEXT NOT NULL, max_calls INTEGER NOT NULL, max_nano_usd INTEGER NOT NULL)');
        let policy = this.db.prepare('SELECT * FROM model_budget_policy WHERE id=1').get() as { purpose: string; max_calls: number; max_nano_usd: number } | undefined;
        // Existing ledgers predate demo mode and belong to acceptance. Never repurpose their history.
        if (!policy) {
          if (purpose === 'demo' && this.totals().calls) throw new AppError('MODEL_BUDGET_CONFIG', 'Для demo нужен отдельный постоянный журнал.', 503);
          this.db.prepare('INSERT INTO model_budget_policy VALUES (1, ?, ?, ?)').run(purpose, options.maxCalls, this.maxNanoUSD);
          policy = { purpose, max_calls: options.maxCalls, max_nano_usd: this.maxNanoUSD };
        }
        if (policy.purpose !== purpose) throw new AppError('MODEL_BUDGET_CONFIG', 'Нельзя менять назначение журнала AI-бюджета.', 503);
        this.options.maxCalls = Math.min(options.maxCalls, policy.max_calls);
        this.maxNanoUSD = Math.min(this.maxNanoUSD, policy.max_nano_usd);
        this.options.maxUSD = this.maxNanoUSD / USD_SCALE;
      });
    } catch (error) { this.close(); throw error; }
  }
  close() { if (this.db.isOpen) this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private totals() {
    return this.db.prepare('SELECT COUNT(*) AS calls, COALESCE(SUM(committed_nano_usd), 0) AS amount FROM model_budget_attempts').get() as { calls: number; amount: number };
  }
  reserve(requestedModel: string, bounds?: ModelTokenBounds): { attemptId: string } {
    const reserveNanoUSD = Math.ceil(modelReserveUSD(requestedModel, bounds) * USD_SCALE);
    return this.transaction(() => {
      const totals = this.totals();
      if (totals.calls >= this.options.maxCalls || totals.amount + reserveNanoUSD > this.maxNanoUSD) throw new AppError('MODEL_BUDGET_EXHAUSTED', 'Лимит платных AI-вызовов демонстрации исчерпан. Доступен обычный поиск по каталогу.', 429);
      const attemptId = randomUUID();
      this.db.prepare(`INSERT INTO model_budget_attempts(attempt_id, started_at, requested_model, status, reserved_nano_usd, committed_nano_usd) VALUES (?, ?, ?, 'reserved', ?, ?)`).run(attemptId, new Date().toISOString(), requestedModel, reserveNanoUSD, reserveNanoUSD);
      return { attemptId };
    });
  }
  settle(attemptId: string, outcome: ModelBudgetSettlement): void {
    const nonnegativeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
    if (!['completed', 'error', 'timeout'].includes(outcome.status) || !nonnegativeInteger(outcome.durationMs) ||
      (outcome.inputTokens !== undefined && !nonnegativeInteger(outcome.inputTokens)) ||
      (outcome.outputTokens !== undefined && !nonnegativeInteger(outcome.outputTokens)) ||
      (outcome.reasoningTokens !== undefined && (!nonnegativeInteger(outcome.reasoningTokens) || outcome.outputTokens === undefined || outcome.reasoningTokens > outcome.outputTokens))) {
      throw new AppError('MODEL_BUDGET_METADATA', 'Некорректные метаданные AI-вызова.', 503);
    }
    const stored = this.db.prepare('SELECT requested_model FROM model_budget_attempts WHERE attempt_id=?').get(attemptId) as { requested_model: string } | undefined;
    if (!stored) throw new AppError('MODEL_BUDGET_ATTEMPT', 'AI-вызов не был зарезервирован.', 503);
    if (outcome.returnedModel !== undefined && outcome.returnedModel !== stored.requested_model && !new RegExp(`^${stored.requested_model.replaceAll('.', '\\.')}-\\d{4}-\\d{2}-\\d{2}$`).test(outcome.returnedModel)) throw new AppError('MODEL_BUDGET_MODEL', 'Провайдер вернул модель без согласованного тарифа.', 503);
    let actualNanoUSD: number | undefined;
    if (outcome.status === 'completed' && outcome.inputTokens !== undefined && outcome.outputTokens !== undefined) {
      // Standard context pricing; output already includes reasoning. No cache discount assumed.
      const amount = stored.requested_model === 'gpt-5.5'
        ? BigInt(outcome.inputTokens) * 5000n + BigInt(outcome.outputTokens) * 30000n
        : BigInt(outcome.inputTokens) * 400n + BigInt(outcome.outputTokens) * 1600n;
      if (amount > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 6))) throw new AppError('MODEL_BUDGET_METADATA', 'Расход AI превышает точный диапазон учёта.', 503);
      actualNanoUSD = Number(amount);
    }
    this.transaction(() => {
      const attempt = this.db.prepare('SELECT status, reserved_nano_usd FROM model_budget_attempts WHERE attempt_id=?').get(attemptId) as { status: string; reserved_nano_usd: number } | undefined;
      if (!attempt) throw new AppError('MODEL_BUDGET_ATTEMPT', 'AI-вызов не был зарезервирован.', 503);
      // Terminal results are immutable: a late success cannot refund an already uncertain timeout.
      if (attempt.status !== 'reserved') return;
      this.db.prepare(`UPDATE model_budget_attempts SET finished_at=?, returned_model=?, status=?, input_tokens=?, output_tokens=?, reasoning_tokens=?, duration_ms=?, committed_nano_usd=? WHERE attempt_id=?`)
        .run(new Date().toISOString(), outcome.returnedModel ?? null, outcome.status, outcome.inputTokens ?? null, outcome.outputTokens ?? null, outcome.reasoningTokens ?? null, outcome.durationMs, actualNanoUSD ?? attempt.reserved_nano_usd, attemptId);
    });
  }
  status() {
    const totals = this.totals();
    const rows = this.db.prepare('SELECT * FROM model_budget_attempts ORDER BY rowid').all() as StoredAttempt[];
    const attempts: ModelBudgetAttempt[] = rows.map(row => ({
      attemptId: row.attempt_id, startedAt: row.started_at, finishedAt: row.finished_at,
      requestedModel: row.requested_model, returnedModel: row.returned_model, status: row.status,
      inputTokens: row.input_tokens, outputTokens: row.output_tokens, reasoningTokens: row.reasoning_tokens, durationMs: row.duration_ms,
      reservedUSD: row.reserved_nano_usd / USD_SCALE, committedUSD: row.committed_nano_usd / USD_SCALE,
    }));
    return { maxCalls: this.options.maxCalls, maxUSD: this.options.maxUSD, callsUsed: totals.calls, remainingCalls: Math.max(0, this.options.maxCalls - totals.calls), committedUSD: totals.amount / USD_SCALE, remainingUSD: Math.max(0, this.maxNanoUSD - totals.amount) / USD_SCALE, attempts };
  }
}

/** No environment is read here; callers opt in explicitly, keeping the default runtime unchanged. */
export function createModelBudget(options?: ModelBudgetOptions): ModelBudget | undefined {
  return options ? new ModelBudget(options) : undefined;
}
