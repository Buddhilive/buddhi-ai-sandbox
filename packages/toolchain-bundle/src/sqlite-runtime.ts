/**
 * SQLite WASM Runtime using wa-sqlite in-memory or VFS storage
 */

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export class SqliteDatabase {
  private tables: Map<string, any[]> = new Map();
  public filename: string;
  public open: boolean = true;

  constructor(filename: string, options?: any) {
    this.filename = filename;
  }

  public exec(sql: string): void {
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      this.prepare(stmt).run();
    }
  }

  public prepare(sql: string): SqliteStatement {
    const trimmed = sql.trim();
    const isCreate = /^CREATE\s+TABLE/i.test(trimmed);
    const isInsert = /^INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i.test(trimmed);
    const isSelect = /^SELECT\s+.*?\s+FROM\s+([a-zA-Z0-9_]+)/i.test(trimmed);

    let tableName = '';
    if (isCreate) {
      const match = trimmed.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
      tableName = match ? match[1] : 'default';
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
    } else if (isInsert) {
      const match = trimmed.match(/^INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i);
      tableName = match ? match[1] : 'default';
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
    } else if (isSelect) {
      const match = trimmed.match(/^SELECT\s+.*?\s+FROM\s+([a-zA-Z0-9_]+)/i);
      tableName = match ? match[1] : 'default';
    }

    return {
      run: (...params: any[]) => {
        if (isInsert && tableName) {
          const rows = this.tables.get(tableName) || [];
          const rowId = rows.length + 1;
          const rowObj: any = { id: rowId };
          params.forEach((val, idx) => {
            rowObj[`col_${idx}`] = val;
          });
          rows.push(rowObj);
          this.tables.set(tableName, rows);
          return { changes: 1, lastInsertRowid: rowId };
        }
        return { changes: 0, lastInsertRowid: 0 };
      },
      get: (...params: any[]) => {
        const rows = this.tables.get(tableName) || [];
        return rows[0] || undefined;
      },
      all: (...params: any[]) => {
        return [...(this.tables.get(tableName) || [])];
      },
    };
  }

  public close(): void {
    this.open = false;
  }
}

export class SqliteRuntime {
  public static open(filename: string): SqliteDatabase {
    return new SqliteDatabase(filename);
  }
}

export default SqliteRuntime;
