import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { AppConfig, SatelliteObject, SweepRecord, VerbLimitKey } from '../types.js';

export class DbService {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    const fullPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    this.db = new Database(fullPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS objects (
        satid INTEGER PRIMARY KEY,
        satname TEXT NOT NULL,
        satlat REAL,
        satlng REAL,
        satalt REAL,
        category TEXT,
        owner TEXT,
        country TEXT,
        launch_date TEXT,
        last_seen_at TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tle_catalog (
        satid INTEGER PRIMARY KEY,
        satname TEXT NOT NULL,
        raw_tle TEXT NOT NULL,
        line1 TEXT NOT NULL,
        line2 TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        satid INTEGER NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (satid, category)
      );

      CREATE TABLE IF NOT EXISTS sweeps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        discovered_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS request_counters (
        verb TEXT PRIMARY KEY,
        window_started_at TEXT NOT NULL,
        count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  upsertConfig(config: AppConfig): void {
    const stmt = this.db.prepare(`
      INSERT INTO app_config (id, json, updated_at)
      VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = datetime('now')
    `);
    stmt.run(JSON.stringify(config));
  }

  getConfig(): AppConfig | null {
    const row = this.db.prepare('SELECT json FROM app_config WHERE id = 1').get() as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as AppConfig) : null;
  }

  upsertObject(obj: SatelliteObject): void {
    const stmt = this.db.prepare(`
      INSERT INTO objects (satid, satname, satlat, satlng, satalt, category, owner, country, launch_date, last_seen_at, source, updated_at)
      VALUES (@satid, @satname, @satlat, @satlng, @satalt, @category, @owner, @country, @launchDate, @lastSeenAt, @source, datetime('now'))
      ON CONFLICT(satid) DO UPDATE SET
        satname = excluded.satname,
        satlat = excluded.satlat,
        satlng = excluded.satlng,
        satalt = excluded.satalt,
        category = COALESCE(excluded.category, objects.category),
        owner = COALESCE(excluded.owner, objects.owner),
        country = COALESCE(excluded.country, objects.country),
        launch_date = COALESCE(excluded.launch_date, objects.launch_date),
        last_seen_at = excluded.last_seen_at,
        source = excluded.source,
        updated_at = datetime('now')
    `);
    stmt.run(obj);
  }

  getObjects(filters: {
    category?: string;
    q?: string;
    minAlt?: number;
    maxAlt?: number;
    owner?: string;
    country?: string;
    satid?: number;
    launchDate?: string;
  }): SatelliteObject[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.category) {
      where.push('category = @category');
      params.category = filters.category;
    }
    if (filters.q) {
      where.push('(satname LIKE @q OR CAST(satid AS TEXT) LIKE @q)');
      params.q = `%${filters.q}%`;
    }
    if (typeof filters.minAlt === 'number') {
      where.push('satalt >= @minAlt');
      params.minAlt = filters.minAlt;
    }
    if (typeof filters.maxAlt === 'number') {
      where.push('satalt <= @maxAlt');
      params.maxAlt = filters.maxAlt;
    }
    if (filters.owner) {
      where.push('LOWER(owner) LIKE LOWER(@owner)');
      params.owner = `%${filters.owner}%`;
    }
    if (filters.country) {
      where.push('LOWER(country) LIKE LOWER(@country)');
      params.country = `%${filters.country}%`;
    }
    if (typeof filters.satid === 'number') {
      where.push('satid = @satid');
      params.satid = filters.satid;
    }
    if (filters.launchDate) {
      where.push('launch_date = @launchDate');
      params.launchDate = filters.launchDate;
    }

    const sql = `SELECT satid, satname, satlat, satlng, satalt, category, owner, country, launch_date as launchDate, last_seen_at as lastSeenAt, source
      FROM objects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY satid`;

    return this.db.prepare(sql).all(params) as SatelliteObject[];
  }

  persistTle(satid: number, satname: string, rawTle: string, line1: string, line2: string, expiresAt: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO tle_catalog (satid, satname, raw_tle, line1, line2, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(satid) DO UPDATE SET
        satname = excluded.satname,
        raw_tle = excluded.raw_tle,
        line1 = excluded.line1,
        line2 = excluded.line2,
        fetched_at = datetime('now'),
        expires_at = excluded.expires_at
    `);
    stmt.run(satid, satname, rawTle, line1, line2, expiresAt);
  }

  getTle(satid: number): { satid: number; satname: string; raw_tle: string; line1: string; line2: string; fetched_at: string; expires_at: string } | null {
    const row = this.db.prepare('SELECT * FROM tle_catalog WHERE satid = ?').get(satid) as
      | { satid: number; satname: string; raw_tle: string; line1: string; line2: string; fetched_at: string; expires_at: string }
      | undefined;
    return row ?? null;
  }

  getAllTle(): Array<{ satid: number; satname: string; line1: string; line2: string; fetched_at: string; expires_at: string }> {
    return this.db.prepare('SELECT satid, satname, line1, line2, fetched_at, expires_at FROM tle_catalog ORDER BY satid').all() as Array<{
      satid: number;
      satname: string;
      line1: string;
      line2: string;
      fetched_at: string;
      expires_at: string;
    }>;
  }

  upsertCategories(satid: number, categories: string[], source: string): void {
    const insert = this.db.prepare(`
      INSERT INTO categories (satid, category, source, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(satid, category) DO UPDATE SET source = excluded.source, updated_at = datetime('now')
    `);
    const tx = this.db.transaction((vals: string[]) => {
      for (const category of vals) insert.run(satid, category, source);
    });
    tx(categories);
  }

  getDistinctCategories(): string[] {
    return (this.db.prepare('SELECT DISTINCT category FROM categories ORDER BY category').all() as { category: string }[]).map((r) => r.category);
  }

  startSweep(): number {
    const result = this.db.prepare('INSERT INTO sweeps (started_at, status, discovered_count) VALUES (datetime(\'now\'), \'running\', 0)').run();
    return Number(result.lastInsertRowid);
  }

  finishSweep(id: number, status: SweepRecord['status'], discoveredCount: number, error?: string): void {
    this.db
      .prepare('UPDATE sweeps SET finished_at = datetime(\'now\'), status = ?, discovered_count = ?, error = ? WHERE id = ?')
      .run(status, discoveredCount, error ?? null, id);
  }

  getSweeps(limit = 50): SweepRecord[] {
    return this.db
      .prepare(
        'SELECT id, started_at as startedAt, finished_at as finishedAt, status, discovered_count as discoveredCount, error FROM sweeps ORDER BY id DESC LIMIT ?'
      )
      .all(limit) as SweepRecord[];
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .run(key, value);
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  ensureVerbCounter(verb: VerbLimitKey): { window_started_at: string; count: number } {
    const current = this.db.prepare('SELECT window_started_at, count FROM request_counters WHERE verb = ?').get(verb) as
      | { window_started_at: string; count: number }
      | undefined;

    if (current) return current;

    this.db.prepare('INSERT INTO request_counters (verb, window_started_at, count) VALUES (?, datetime(\'now\'), 0)').run(verb);

    return {
      window_started_at: new Date().toISOString(),
      count: 0
    };
  }

  setVerbCounter(verb: VerbLimitKey, windowStartedAt: string, count: number): void {
    this.db
      .prepare(
        `INSERT INTO request_counters (verb, window_started_at, count)
         VALUES (?, ?, ?)
         ON CONFLICT(verb) DO UPDATE SET window_started_at = excluded.window_started_at, count = excluded.count`
      )
      .run(verb, windowStartedAt, count);
  }
}
