import { describe, it, expect } from 'vitest';
import { interceptRequire } from '../../src/worker/shims/addon-interceptor.js';

describe('SQLite Database via Native Addon Interceptor', () => {
  it('intercepts better-sqlite3 and performs table creation, insertion, and querying', () => {
    const Database = interceptRequire('better-sqlite3');
    expect(Database).not.toBeNull();

    const db = new Database('/workspace/app.db');
    db.exec('CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT)');

    const insertStmt = db.prepare('INSERT INTO todos (title) VALUES (?)');
    const info = insertStmt.run('Build Next.js App');
    expect(info.changes).toBeGreaterThanOrEqual(1);

    const selectStmt = db.prepare('SELECT * FROM todos');
    const rows = selectStmt.all();
    expect(Array.isArray(rows)).toBe(true);

    db.close();
  });
});
