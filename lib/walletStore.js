const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const STATE_KEY = 'wallets';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function createWalletStore({ dataDir, legacyWalletFile, databaseFile = 'game.sqlite' }) {
  if (!dataDir) throw new Error('dataDir is required.');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, databaseFile);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state_meta (
      key TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      value_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      value_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const getState = db.prepare('SELECT value FROM app_state WHERE key = ?');
  const getMeta = db.prepare('SELECT revision, value_hash, byte_length, updated_at FROM app_state_meta WHERE key = ?');
  const setState = db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  const setMeta = db.prepare(`
    INSERT INTO app_state_meta (key, revision, value_hash, byte_length, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      revision = excluded.revision,
      value_hash = excluded.value_hash,
      byte_length = excluded.byte_length,
      updated_at = excluded.updated_at
  `);
  const insertRevision = db.prepare(`
    INSERT INTO app_state_revisions (key, revision, value_hash, byte_length, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const countRevisions = db.prepare('SELECT COUNT(*) AS count FROM app_state_revisions WHERE key = ?');

  function load() {
    const row = getState.get(STATE_KEY);
    if (row?.value) {
      const meta = getMeta.get(STATE_KEY);
      const hash = sha256(row.value);
      if (meta?.value_hash && meta.value_hash !== hash) {
        throw new Error('Wallet database integrity check failed.');
      }
      if (!meta?.value_hash) {
        const now = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          setMeta.run(STATE_KEY, 1, hash, Buffer.byteLength(row.value), now);
          insertRevision.run(STATE_KEY, 1, hash, Buffer.byteLength(row.value), now);
          db.exec('COMMIT');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        }
      }
      return JSON.parse(row.value);
    }

    const legacy = legacyWalletFile ? readJsonFile(legacyWalletFile) : null;
    if (legacy) {
      save(legacy);
      return legacy;
    }
    return null;
  }

  function save(wallets) {
    const value = JSON.stringify(wallets);
    const now = new Date().toISOString();
    const hash = sha256(value);
    const meta = getMeta.get(STATE_KEY);
    const revision = Number(meta?.revision || 0) + 1;
    db.exec('BEGIN IMMEDIATE');
    try {
      setState.run(STATE_KEY, value, now);
      setMeta.run(STATE_KEY, revision, hash, Buffer.byteLength(value), now);
      insertRevision.run(STATE_KEY, revision, hash, Buffer.byteLength(value), now);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  function info() {
    const row = getState.get(STATE_KEY);
    const meta = getMeta.get(STATE_KEY);
    const actualHash = row?.value ? sha256(row.value) : null;
    return {
      dbPath,
      hasState: !!row?.value,
      revision: Number(meta?.revision || 0),
      updatedAt: meta?.updated_at || null,
      byteLength: Number(meta?.byte_length || 0),
      hash: meta?.value_hash || null,
      hashOk: !row?.value || !meta?.value_hash || meta.value_hash === actualHash,
      revisionCount: Number(countRevisions.get(STATE_KEY)?.count || 0),
    };
  }

  function backupTo(backupPath) {
    if (!backupPath) throw new Error('backupPath is required.');
    const backupDir = path.dirname(backupPath);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    db.exec(`VACUUM INTO ${sqlString(backupPath)}`);
    return {
      backupPath,
      byteLength: fs.statSync(backupPath).size,
      createdAt: new Date().toISOString(),
    };
  }

  function close() {
    db.close();
  }

  return { backupTo, dbPath, close, info, load, save };
}

module.exports = { createWalletStore };
