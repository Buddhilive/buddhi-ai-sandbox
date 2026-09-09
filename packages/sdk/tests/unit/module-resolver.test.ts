import { describe, it, expect } from 'vitest';
import { ModuleResolver } from '../../src/module-resolver.js';
import { FsNamespace } from '../../src/fs-namespace.js';
import { WorkerBridge } from '../../src/worker-bridge.js';

class MockFsWorker {
  public files = new Map<string, any>();
  public onmessage: ((e: any) => void) | null = null;

  constructor() {
    this.files.set('/workspace/main.js', 'console.log(1)');
    this.files.set('/workspace/utils.js', 'module.exports = {}');
    this.files.set('/node_modules/my-pkg/package.json', JSON.stringify({ main: 'lib/index.js' }));
    this.files.set('/node_modules/my-pkg/lib/index.js', 'module.exports = {}');
  }

  postMessage(msg: any) {
    setTimeout(() => {
      if (msg.type === 'fs:stat') {
        if (this.files.has(msg.path)) {
          this.onmessage?.({
            data: {
              type: 'fs:response',
              id: msg.id,
              result: { isFile: true, isDirectory: false, size: 10, mode: 0o644 },
            },
          });
        } else {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, error: 'ENOENT' } });
        }
      } else if (msg.type === 'fs:read') {
        const val = this.files.get(msg.path);
        if (val) {
          this.onmessage?.({
            data: {
              type: 'fs:response',
              id: msg.id,
              result: new TextEncoder().encode(val),
            },
          });
        } else {
          this.onmessage?.({ data: { type: 'fs:response', id: msg.id, error: 'ENOENT' } });
        }
      }
    }, 0);
  }
  terminate() {}
}

describe('ModuleResolver Unit Tests (T041)', () => {
  it('resolves built-in modules without filesystem access', async () => {
    const mockWorker = new MockFsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const fs = new FsNamespace(bridge);
    const resolver = new ModuleResolver(fs);

    expect(await resolver.resolve('fs')).toBe('builtin:fs');
    expect(await resolver.resolve('node:path')).toBe('builtin:path');
    expect(await resolver.resolve('http')).toBe('builtin:http');
  });

  it('resolves relative file paths and adds .js extension', async () => {
    const mockWorker = new MockFsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const fs = new FsNamespace(bridge);
    const resolver = new ModuleResolver(fs);

    const resolved = await resolver.resolve('./utils', '/workspace');
    expect(resolved).toBe('/workspace/utils.js');
  });

  it('resolves package.json main entrypoint from node_modules', async () => {
    const mockWorker = new MockFsWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const fs = new FsNamespace(bridge);
    const resolver = new ModuleResolver(fs);

    const resolved = await resolver.resolve('my-pkg');
    expect(resolved).toBe('/node_modules/my-pkg/lib/index.js');
  });
});
