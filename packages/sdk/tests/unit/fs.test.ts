import { describe, it, expect, beforeEach } from 'vitest';
import { FsNamespace } from '../../src/fs-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

// In-memory mock worker for unit testing
class MockFsWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  private files = new Map<string, { isDir: boolean; data?: Uint8Array; mode: number }>();

  constructor() {
    this.files.set('/', { isDir: true, mode: 0o755 });
  }

  postMessage(msg: any) {
    setTimeout(() => {
      if (msg.type === 'fs:write') {
        this.files.set(msg.path, { isDir: false, data: msg.data, mode: 0o644 });
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      } else if (msg.type === 'fs:read') {
        const entry = this.files.get(msg.path);
        if (!entry || entry.isDir) {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, error: `ENOENT: ${msg.path}` } } as any);
        } else {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: entry.data } } as any);
        }
      } else if (msg.type === 'fs:mkdir') {
        this.files.set(msg.path, { isDir: true, mode: 0o755 });
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      } else if (msg.type === 'fs:readdir') {
        const results: string[] = [];
        const prefix = msg.path.endsWith('/') ? msg.path : msg.path + '/';
        for (const k of this.files.keys()) {
          if (k.startsWith(prefix) && k !== prefix) {
            const rel = k.slice(prefix.length).split('/')[0];
            if (!results.includes(rel)) results.push(rel);
          }
        }
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: results } } as any);
      } else if (msg.type === 'fs:stat') {
        const entry = this.files.get(msg.path);
        if (!entry) {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, error: `ENOENT: ${msg.path}` } } as any);
        } else {
          this.onmessage?.({
            data: {
              type: 'fs:response',
              id: msg.id,
              result: {
                isFile: !entry.isDir,
                isDirectory: entry.isDir,
                isSymbolicLink: false,
                size: entry.data ? entry.data.byteLength : 4096,
                mtimeMs: Date.now(),
                mode: entry.mode,
              },
            },
          } as any);
        }
      } else if (msg.type === 'fs:rm') {
        this.files.delete(msg.path);
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      }
    }, 0);
  }

  terminate() {}
}

describe('FsNamespace Unit Tests (T017)', () => {
  let fs: FsNamespace;
  let mockWorker: MockFsWorker;

  beforeEach(() => {
    mockWorker = new MockFsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    fs = new FsNamespace(bridge);
  });

  it('writes and reads a UTF-8 text file', async () => {
    await fs.writeFile('/test.txt', 'Hello, VirtualFS!');
    const content = await fs.readFile('/test.txt', 'utf-8');
    expect(content).toBe('Hello, VirtualFS!');
  });

  it('writes and reads binary Uint8Array data', async () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50]);
    await fs.writeFile('/binary.bin', raw);
    const result = await fs.readFile('/binary.bin');
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
  });

  it('creates directories and lists contents via readdir', async () => {
    await fs.mkdir('/workspace/src', { recursive: true });
    await fs.writeFile('/workspace/src/index.js', 'console.log(1);');
    await fs.writeFile('/workspace/src/utils.js', 'console.log(2);');

    const files = await fs.readdir('/workspace/src');
    expect(files).toContain('index.js');
    expect(files).toContain('utils.js');
  });

  it('retrieves accurate file stats via stat()', async () => {
    await fs.writeFile('/stat-test.txt', '12345');
    const stat = await fs.stat('/stat-test.txt');
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(5);
  });

  it('removes files via rm()', async () => {
    await fs.writeFile('/temp.txt', 'to be deleted');
    await fs.rm('/temp.txt');
    await expect(fs.readFile('/temp.txt')).rejects.toThrow('ENOENT');
  });
});
