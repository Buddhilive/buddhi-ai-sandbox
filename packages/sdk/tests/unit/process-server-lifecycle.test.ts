import { describe, it, expect } from 'vitest';
import { ProcessNamespace } from '../../src/process-namespace.js';
import { WorkerBridge, createRingBuffer } from '../../src/worker-bridge.js';

class MockServerWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;
  public killedPids: number[] = [];
  public messages: any[] = [];

  postMessage(msg: any) {
    this.messages.push(msg);
    if (msg.type === 'process:spawn') {
      const stdoutSab = createRingBuffer(1024);
      const stderrSab = createRingBuffer(1024);
      const stdinSab = createRingBuffer(1024);

      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: 'process:spawned',
            id: msg.id,
            pid: 2001,
            stdoutSab,
            stderrSab,
            stdinSab,
          },
        } as any);

        // Simulate server listening event
        this.onmessage?.({
          data: {
            type: 'port:listen',
            port: 3000,
          },
        } as any);

        // Notice: We do NOT post 'process:exit' immediately here,
        // because the server keeps the process alive!
      }, 0);
    } else if (msg.type === 'process:kill') {
      this.killedPids.push(msg.pid);
      setTimeout(() => {
        this.onmessage?.({
          data: {
            type: 'process:exit',
            pid: msg.pid,
            code: 130,
          },
        } as any);
      }, 5);
    }
  }

  terminate() {}
}

describe('Process Server Lifecycle (US1)', () => {
  it('keeps process running while server is listening and does not exit prematurely', async () => {
    const mockWorker = new MockServerWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const procNs = new ProcessNamespace(bridge);

    const handle = await procNs.spawn('node', ['/workspace/server.js']);
    expect(handle.pid).toBe(2001);

    let exited = false;
    handle.exit.then(() => {
      exited = true;
    });

    // Wait 50ms - process should still be running
    await new Promise((r) => setTimeout(r, 50));
    expect(exited).toBe(false);

    // Now kill the process
    handle.kill();

    const exitCode = await handle.exit;
    expect(exitCode).toBe(130);
    expect(mockWorker.killedPids).toContain(2001);
  });

  it('exits with code 0 when server closes cleanly', async () => {
    const mockWorker = new MockServerWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const procNs = new ProcessNamespace(bridge);

    const handle = await procNs.spawn('node', ['/workspace/server.js']);
    expect(handle.pid).toBe(2001);

    // Simulate server closing in the worker
    setTimeout(() => {
      mockWorker.onmessage?.({
        data: {
          type: 'port:close',
          port: 3000,
        },
      } as any);
      mockWorker.onmessage?.({
        data: {
          type: 'process:exit',
          pid: 2001,
          code: 0,
        },
      } as any);
    }, 20);

    const exitCode = await handle.exit;
    expect(exitCode).toBe(0);
  });
});
