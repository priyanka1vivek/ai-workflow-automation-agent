import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'agent.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(requests)').all().some(column => column.name === 'user_id')) db.exec('ALTER TABLE requests ADD COLUMN user_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS requests_user_created ON requests(user_id, created_at DESC)');
  let secret = db.prepare("SELECT value FROM settings WHERE name='session_secret'").get()?.value;
  if (!secret) { secret = randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings(name,value) VALUES('session_secret',?)").run(secret); }
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
    secret,
    createUser: (email, passwordHash) => { const user = { id: randomUUID(), email }; db.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(user.id, email, passwordHash, new Date().toISOString()); return user; },
    userByEmail: email => db.prepare('SELECT id,email,password_hash FROM users WHERE email=?').get(email) || null,
    userById: id => db.prepare('SELECT id,email FROM users WHERE id=?').get(id) || null,
    list: userId => db.prepare('SELECT payload FROM requests WHERE user_id=? ORDER BY created_at DESC').all(userId).map(row => JSON.parse(row.payload)),
    get: (id, userId) => { const row = db.prepare('SELECT payload FROM requests WHERE id=? AND user_id=?').get(id, userId); return row ? JSON.parse(row.payload) : null; },
    byKey: (key, userId) => { const row = db.prepare('SELECT payload FROM requests WHERE idempotency_key=? AND user_id=?').get(`${userId}:${key}`, userId); return row ? JSON.parse(row.payload) : null; },
    insert: (r, key, userId) => db.prepare('INSERT INTO requests(id,idempotency_key,created_at,payload,user_id) VALUES(?,?,?,?,?)').run(r.id, key ? `${userId}:${key}` : null, r.createdAt, JSON.stringify(r), userId),
    save: r => db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(r), r.id),
    close: () => db.close()
  };
}
