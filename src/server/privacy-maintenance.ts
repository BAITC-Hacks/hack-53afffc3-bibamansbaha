import { DatabaseSync } from 'node:sqlite';
import { containsPaymentData, PAYMENT_REDACTED } from './privacy';

/** Explicit path, counts only; logical anonymization does not erase WAL/backups. */
export function cleanPaymentMessages(path: string, apply = false) {
  const db = new DatabaseSync(path, { readOnly: !apply });
  try {
    if (apply) db.exec('BEGIN IMMEDIATE');
    const rows = db.prepare('SELECT id, body FROM messages').all() as { id: string; body: string }[];
    const found = rows.filter(row => containsPaymentData(row.body));
    if (apply) {
      const update = db.prepare('UPDATE messages SET body=? WHERE id=?');
      for (const row of found) {
        const message = JSON.parse(row.body);
        update.run(JSON.stringify({ id: message.id, role: message.role, createdAt: message.createdAt, text: PAYMENT_REDACTED }), row.id);
      }
      db.exec('COMMIT');
    }
    return { scanned: rows.length, matched: found.length, anonymized: apply ? found.length : 0, mode: apply ? 'apply' : 'dry-run' };
  } catch (error) { if (apply) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
