import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'agent.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, payload TEXT NOT NULL);`);
  // Interrupted side effects are marked uncertain: never silently replay them.
  for (const row of db.prepare('SELECT payload FROM requests').all()) {
    const r = JSON.parse(row.payload); let changed = false;
    if (r.status === 'processing') { r.status = 'failed'; r.error = 'Server restarted during classification. Retry classification.'; changed = true; }
    if (r.status === 'delivering') {
      r.status = 'partial';
      for (const target of ['slack', 'sheets']) if (r.deliveries[target]?.status === 'sending') r.deliveries[target] = { status: 'uncertain', message: 'Server restarted during delivery. Verify the destination before retrying.' };
      changed = true;
    }
    if (changed) db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(r), r.id);
  }
  return {
    list: () => db.prepare('SELECT payload FROM requests ORDER BY created_at DESC').all().map(row => JSON.parse(row.payload)),
    get: id => { const row = db.prepare('SELECT payload FROM requests WHERE id=?').get(id); return row ? JSON.parse(row.payload) : null; },
    byKey: key => { const row = db.prepare('SELECT payload FROM requests WHERE idempotency_key=?').get(key); return row ? JSON.parse(row.payload) : null; },
    insert: (r, key) => db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(r.id, key || null, r.createdAt, JSON.stringify(r)),
    save: r => db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(r), r.id),
    close: () => db.close()
  };
}
