import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'agent.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, api_hash TEXT, integrations TEXT NOT NULL DEFAULT '{}');`);
  const hasColumn = (table, name) => db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name);
  if (!hasColumn('requests', 'user_id')) db.exec('ALTER TABLE requests ADD COLUMN user_id TEXT');
  if (!hasColumn('requests', 'workspace_id')) db.exec('ALTER TABLE requests ADD COLUMN workspace_id TEXT');
  if (!hasColumn('users', 'workspace_id')) db.exec('ALTER TABLE users ADD COLUMN workspace_id TEXT');
  if (!hasColumn('users', 'role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'");
  db.exec('CREATE INDEX IF NOT EXISTS requests_workspace_created ON requests(workspace_id,created_at DESC)');
  let secret = db.prepare("SELECT value FROM settings WHERE name='session_secret'").get()?.value;
  if (!secret) { secret = randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings(name,value) VALUES('session_secret',?)").run(secret); }
  let encryptionKey = db.prepare("SELECT value FROM settings WHERE name='integration_key'").get()?.value;
  if (!encryptionKey) { encryptionKey = randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings(name,value) VALUES('integration_key',?)").run(encryptionKey); }
  // The key lives in the database; protect the data directory and backups.
  const seal = value => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString('base64');
  };
  const unseal = value => {
    if (!value || value === '{}') return {};
    const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  };
  const newWorkspace = email => {
    const w = { id: randomUUID(), name: `${email.split('@')[0]}'s workspace`, inviteCode: randomBytes(9).toString('hex') };
    db.prepare('INSERT INTO workspaces(id,name,invite_code) VALUES(?,?,?)').run(w.id, w.name, w.inviteCode);
    return w;
  };
  // Migrate earlier private accounts into separate workspaces without losing requests.
  for (const user of db.prepare('SELECT id,email FROM users WHERE workspace_id IS NULL').all()) {
    const w = newWorkspace(user.email);
    db.prepare('UPDATE users SET workspace_id=?,role=? WHERE id=?').run(w.id, 'owner', user.id);
    db.prepare('UPDATE requests SET workspace_id=? WHERE user_id=? AND workspace_id IS NULL').run(w.id, user.id);
  }
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
  const owner = workspaceId => db.prepare("SELECT id,email,role,workspace_id FROM users WHERE workspace_id=? AND role='owner' ORDER BY created_at LIMIT 1").get(workspaceId);
  return {
    secret,
    createUser(email, passwordHash, inviteCode = '') {
      let workspace, role;
      if (inviteCode) {
        workspace = db.prepare('SELECT id,name,invite_code FROM workspaces WHERE invite_code=?').get(inviteCode);
        if (!workspace) throw Object.assign(new Error('That workspace invite code is invalid.'), { status: 400 });
        role = 'requester';
      } else { workspace = newWorkspace(email); role = 'owner'; }
      const user = { id: randomUUID(), email, workspace_id: workspace.id, role };
      db.prepare('INSERT INTO users(id,email,password_hash,created_at,workspace_id,role) VALUES(?,?,?,?,?,?)').run(user.id, email, passwordHash, new Date().toISOString(), workspace.id, role);
      return user;
    },
    userByEmail: email => db.prepare('SELECT id,email,password_hash,workspace_id,role FROM users WHERE email=?').get(email) || null,
    userById: id => db.prepare('SELECT id,email,workspace_id,role FROM users WHERE id=?').get(id) || null,
    workspace: id => db.prepare('SELECT id,name,invite_code,api_hash,integrations FROM workspaces WHERE id=?').get(id),
    owner,
    userByToken(token) {
      const hash = createHash('sha256').update(token).digest('hex');
      const w = db.prepare('SELECT id FROM workspaces WHERE api_hash=?').get(hash);
      return w ? owner(w.id) : null;
    },
    rotateToken(workspaceId) {
      const token = randomBytes(32).toString('hex');
      db.prepare('UPDATE workspaces SET api_hash=? WHERE id=?').run(createHash('sha256').update(token).digest('hex'), workspaceId);
      return token;
    },
    integrations: workspaceId => unseal(db.prepare('SELECT integrations FROM workspaces WHERE id=?').get(workspaceId).integrations),
    updateIntegrations(workspaceId, values) {
      const current = this.integrations(workspaceId);
      db.prepare('UPDATE workspaces SET integrations=? WHERE id=?').run(seal({ ...current, ...values }), workspaceId);
    },
    list: user => db.prepare(user.role === 'owner' ? 'SELECT payload FROM requests WHERE workspace_id=? ORDER BY created_at DESC' : 'SELECT payload FROM requests WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC').all(...(user.role === 'owner' ? [user.workspace_id] : [user.workspace_id, user.id])).map(row => JSON.parse(row.payload)),
    get: (id, user) => { const row = db.prepare(user.role === 'owner' ? 'SELECT payload FROM requests WHERE id=? AND workspace_id=?' : 'SELECT payload FROM requests WHERE id=? AND workspace_id=? AND user_id=?').get(...(user.role === 'owner' ? [id, user.workspace_id] : [id, user.workspace_id, user.id])); return row ? JSON.parse(row.payload) : null; },
    byKey: (key, user) => { const row = db.prepare('SELECT payload FROM requests WHERE idempotency_key=? AND workspace_id=?').get(`${user.workspace_id}:${key}`, user.workspace_id); return row ? JSON.parse(row.payload) : null; },
    insert: (r, key, user) => db.prepare('INSERT INTO requests(id,idempotency_key,created_at,payload,user_id,workspace_id) VALUES(?,?,?,?,?,?)').run(r.id, key ? `${user.workspace_id}:${key}` : null, r.createdAt, JSON.stringify(r), user.id, user.workspace_id),
    save: r => db.prepare('UPDATE requests SET payload=? WHERE id=?').run(JSON.stringify(r), r.id),
    close: () => db.close()
  };
}
