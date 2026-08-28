const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  // node:sqlite fallback
}

const hasPgConfig = !!(process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGHOST !== 'localhost' && process.env.PGHOST !== '127.0.0.1'));

let activeEngine = hasPgConfig ? null : 'sqlite';
let pool = null;

if (hasPgConfig || process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGHOST !== 'localhost')) {
  const needsSSL =
    process.env.PGSSLMODE === 'require' ||
    (env.db.host !== 'localhost' && env.db.host !== '127.0.0.1');

  const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 3000,
      }
    : {
        host: env.db.host,
        port: env.db.port,
        user: env.db.user,
        password: env.db.password,
        database: env.db.database,
        ssl: needsSSL ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 2000,
      };

  try {
    pool = new Pool(poolConfig);
    pool.on('error', (err) => {
      if (activeEngine !== 'sqlite') {
        console.error('Unexpected PostgreSQL error on idle client', err);
      }
    });
  } catch (e) {
    activeEngine = 'sqlite';
  }
}

let sqliteDb = null;

function getSqlite() {
  if (!sqliteDb) {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'physioedvance.sqlite');
    sqliteDb = new DatabaseSync(dbPath);
  }
  return sqliteDb;
}

function runSqliteQuery(sql, params = []) {
  const db = getSqlite();
  const trimSql = sql.trim();
  const flatParams = Array.isArray(params) ? params.flat() : [params];
  if (/^(SELECT|PRAGMA|EXPLAIN)/i.test(trimSql)) {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...flatParams);
    const plainRows = (rows || []).map(r => ({ ...r }));
    return { rows: plainRows, rowCount: plainRows.length };
  } else {
    const stmt = db.prepare(sql);
    const result = stmt.run(...flatParams);
    return { rows: [], rowCount: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
  }
}

function runSqliteExec(sql) {
  const db = getSqlite();
  db.exec(sql);
}

function isConnectionError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '28P01' ||
    code === '3D000' ||
    msg.includes('econnrefused') ||
    msg.includes('connection terminated') ||
    msg.includes('timeout') ||
    msg.includes('connect etimedout') ||
    msg.includes('could not connect') ||
    msg.includes('failed to connect')
  );
}

async function executePgQuery(sql, params = []) {
  if (activeEngine === 'sqlite' || !pool) {
    activeEngine = 'sqlite';
    return runSqliteQuery(sql, params);
  }
  if (activeEngine === 'pg') {
    return await pool.query(sql, params);
  }

  try {
    const res = await pool.query(sql, params);
    activeEngine = 'pg';
    return res;
  } catch (err) {
    if (isConnectionError(err)) {
      console.warn('⚠️ PostgreSQL server not reachable. Falling back to ultra-lightweight SQLite database.');
      activeEngine = 'sqlite';
      return runSqliteQuery(sql, params);
    }
    throw err;
  }
}

async function executePgExec(sql) {
  if (activeEngine === 'sqlite' || !pool) {
    activeEngine = 'sqlite';
    runSqliteExec(sql);
    return;
  }
  if (activeEngine === 'pg') {
    await pool.query(sql);
    return;
  }

  try {
    await pool.query(sql);
    activeEngine = 'pg';
  } catch (err) {
    if (isConnectionError(err)) {
      console.warn('⚠️ PostgreSQL server not reachable. Falling back to ultra-lightweight SQLite database.');
      activeEngine = 'sqlite';
      runSqliteExec(sql);
    } else {
      throw err;
    }
  }
}

// Convert SQLite-style "?" positional placeholders to Postgres "$1, $2, ..."
function toPgPlaceholders(sql) {
  if (activeEngine === 'sqlite') return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Convert SQLite-style "@name" named placeholders to "?" (for SQLite) or "$1, $2" (for Postgres)
function toPgNamedPlaceholders(sql) {
  const names = [];
  const pgSql = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    names.push(name);
    return activeEngine === 'sqlite' ? '?' : `$${names.length}`;
  });
  return { pgSql, mapper: (obj) => names.map(n => (obj ? obj[n] : undefined)) };
}

function hasNamedParams(sql) {
  return /@[a-zA-Z_][a-zA-Z0-9_]*/.test(sql);
}

function prepare(sql) {
  if (hasNamedParams(sql)) {
    const { pgSql, mapper } = toPgNamedPlaceholders(sql);
    return {
      async get(obj) {
        const res = await executePgQuery(pgSql, mapper(obj));
        return res.rows[0];
      },
      async all(obj) {
        const res = await executePgQuery(pgSql, mapper(obj));
        return res.rows;
      },
      async run(obj) {
        const res = await executePgQuery(pgSql, mapper(obj));
        const row = res.rows && res.rows[0];
        return { changes: res.rowCount, lastInsertRowid: res.lastInsertRowid || (row ? row.id : undefined) };
      }
    };
  }

  const pgSql = toPgPlaceholders(sql);
  return {
    async get(...params) {
      const flat = params.flat();
      const res = await executePgQuery(pgSql, flat);
      return res.rows[0];
    },
    async all(...params) {
      const flat = params.flat();
      const res = await executePgQuery(pgSql, flat);
      return res.rows;
    },
    async run(...params) {
      const flat = params.flat();
      const res = await executePgQuery(pgSql, flat);
      const row = res.rows && res.rows[0];
      return {
        changes: res.rowCount,
        lastInsertRowid: res.lastInsertRowid || (row ? row.id : undefined)
      };
    }
  };
}

module.exports = {
  prepare,
  pragma() {},
  async exec(sql) {
    await executePgExec(sql);
  },
  query: (sql, params) => executePgQuery(toPgPlaceholders(sql), params),
  pool,
  get activeEngine() { return activeEngine; }
};
