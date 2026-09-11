import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FsNamespace } from '../../src/fs-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';
import { FileChangeEvent } from '../../src/types.js';

function canonicalPosixPath(p: string): string {
  const parts = p.split('/').filter(x => x.length > 0 && x !== '.');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

class MockFsWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  private files = new Map<string, { isDir: boolean; data?: Uint8Array; mode: number }>();

  constructor() {
    this.files.set('/', { isDir: true, mode: 0o755 });
  }

  postMessage(msg: any) {
    setTimeout(() => {
      if (msg.type === 'fs:write') {
        const norm = canonicalPosixPath(msg.path);
        const existed = this.files.has(norm);
        this.files.set(norm, { isDir: false, data: msg.data, mode: 0o644 });
        this.onmessage?.({
          data: {
            type: 'fs:change',
            path: norm,
            changeType: existed ? 'update' : 'create',
          },
        } as any);
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      } else if (msg.type === 'fs:mkdir') {
        const norm = canonicalPosixPath(msg.path);
        this.files.set(norm, { isDir: true, mode: 0o755 });
        this.onmessage?.({
          data: {
            type: 'fs:change',
            path: norm,
            changeType: 'create',
          },
        } as any);
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      } else if (msg.type === 'fs:rm') {
        const norm = canonicalPosixPath(msg.path);
        if (msg.recursive) {
          const prefix = norm.endsWith('/') ? norm : norm + '/';
          const toDelete: string[] = [];
          for (const k of this.files.keys()) {
            if (k.startsWith(prefix)) {
              toDelete.push(k);
            }
          }
          // Sort descending by depth
          toDelete.sort((a, b) => b.length - a.length);
          for (const d of toDelete) {
            this.files.delete(d);
            this.onmessage?.({
              data: {
                type: 'fs:change',
                path: d,
                changeType: 'delete',
              },
            } as any);
          }
        }
        this.files.delete(norm);
        this.onmessage?.({
          data: {
            type: 'fs:change',
            path: norm,
            changeType: 'delete',
          },
        } as any);
        this.onmessage?.({ data: { type: 'fs:response', id: msg.id, result: null } } as any);
      }
    }, 0);
  }

  // Helper to simulate a guest-process mutation from worker
  simulateGuestMutation(path: string, type: 'create' | 'update' | 'delete') {
    const norm = canonicalPosixPath(path);
    this.onmessage?.({
      data: {
        type: 'fs:change',
        path: norm,
        changeType: type,
      },
    } as any);
  }

  terminate() {}
}

describe('File Change Listener API', () => {
  let worker: MockFsWorker;
  let bridge: WorkerBridge;
  let fs: FsNamespace;

  beforeEach(() => {
    worker = new MockFsWorker();
    bridge = new WorkerBridge(worker as unknown as Worker);
    fs = new FsNamespace(bridge);
  });

  describe('User Story 1: Host SDK File Change Event Subscription', () => {
    it('dispatches create event when a new file is written', async () => {
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      await fs.writeFile('/app.js', 'console.log("hello");');
      expect(events).toEqual([{ path: '/app.js', type: 'create' }]);
    });

    it('dispatches update event when an existing file is modified', async () => {
      const events: FileChangeEvent[] = [];
      await fs.writeFile('/app.js', 'console.log("v1");');

      fs.on('change', (e) => events.push(e));
      await fs.writeFile('/app.js', 'console.log("v2");');

      expect(events).toEqual([{ path: '/app.js', type: 'update' }]);
    });

    it('dispatches delete event when a file is removed', async () => {
      await fs.writeFile('/temp.txt', '123');
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      await fs.rm('/temp.txt');
      expect(events).toEqual([{ path: '/temp.txt', type: 'delete' }]);
    });

    it('dispatches create event when a directory is created', async () => {
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      await fs.mkdir('/src');
      expect(events).toEqual([{ path: '/src', type: 'create' }]);
    });

    it('unsubscribes via returned cleanup function', async () => {
      const events: FileChangeEvent[] = [];
      const unsubscribe = fs.on('change', (e) => events.push(e));

      await fs.writeFile('/f1.txt', 'first');
      expect(events.length).toBe(1);

      unsubscribe();
      await fs.writeFile('/f2.txt', 'second');
      expect(events.length).toBe(1);
    });

    it('unsubscribes via fs.off()', async () => {
      const events: FileChangeEvent[] = [];
      const listener = (e: FileChangeEvent) => events.push(e);
      fs.on('change', listener);

      await fs.writeFile('/f1.txt', 'first');
      expect(events.length).toBe(1);

      fs.off('change', listener);
      await fs.writeFile('/f2.txt', 'second');
      expect(events.length).toBe(1);
    });

    it('throws when subscribing to unsupported event names', () => {
      expect(() => fs.on('invalid' as any, () => {})).toThrow('Unsupported fs event');
    });
  });

  describe('User Story 2: Worker & Guest Process Mutation Propagation', () => {
    it('propagates worker-originated file mutations to host listener', () => {
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      worker.simulateGuestMutation('/guest-output.txt', 'create');
      worker.simulateGuestMutation('/guest-output.txt', 'update');
      worker.simulateGuestMutation('/guest-output.txt', 'delete');

      expect(events).toEqual([
        { path: '/guest-output.txt', type: 'create' },
        { path: '/guest-output.txt', type: 'update' },
        { path: '/guest-output.txt', type: 'delete' },
      ]);
    });
  });

  describe('User Story 3: Recursive Directory Mutation & Path Normalization', () => {
    it('emits delete events for child entries when directory is removed recursively', async () => {
      await fs.writeFile('/nested/sub/file.txt', 'content');
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      await fs.rm('/nested', { recursive: true });

      expect(events).toEqual([
        { path: '/nested/sub/file.txt', type: 'delete' },
        { path: '/nested', type: 'delete' },
      ]);
    });

    it('normalizes paths with dot segments and multiple slashes', async () => {
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      await fs.writeFile('//workspace/./src/../app.ts', 'test');
      expect(events).toEqual([{ path: '/workspace/app.ts', type: 'create' }]);
    });
  });

  describe('User Story 4: Multiple Listeners, Error Isolation & Teardown', () => {
    it('supports multiple listeners concurrently', async () => {
      const events1: FileChangeEvent[] = [];
      const events2: FileChangeEvent[] = [];

      fs.on('change', (e) => events1.push(e));
      fs.on('change', (e) => events2.push(e));

      await fs.writeFile('/multi.txt', 'content');

      expect(events1).toEqual([{ path: '/multi.txt', type: 'create' }]);
      expect(events2).toEqual([{ path: '/multi.txt', type: 'create' }]);
    });

    it('isolates errors if a listener throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const events2: FileChangeEvent[] = [];

      fs.on('change', () => {
        throw new Error('Listener 1 failed');
      });
      fs.on('change', (e) => events2.push(e));

      await fs.writeFile('/error-test.txt', 'data');

      expect(events2).toEqual([{ path: '/error-test.txt', type: 'create' }]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('clears all listeners on bridge.terminate()', async () => {
      const events: FileChangeEvent[] = [];
      fs.on('change', (e) => events.push(e));

      bridge.terminate();

      // Triggering an event via mock worker postMessage won't reach listeners because terminate cleared them
      worker.simulateGuestMutation('/after-terminate.txt', 'create');
      expect(events).toHaveLength(0);
    });
  });
});
