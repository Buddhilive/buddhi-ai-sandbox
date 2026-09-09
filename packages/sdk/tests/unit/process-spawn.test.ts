import { describe, it, expect } from 'vitest';
import { ProcessNamespace } from '../../src/process-namespace.js';
import { WorkerBridge, createRingBuffer } from '../../src/worker-bridge.js';

class MockProcessWorker {
  public onmessage: ((e: MessageEvent) => void) | null = null;

  postMessage(msg: any) {
    setTimeout(() => {
      if (msg.type === 'process:spawn') {
        const stdoutSab = createRingBuffer(1024);
        const stderrSab = createRingBuffer(1024);
        const stdinSab = createRingBuffer(1024);

        this.onmessage?.({
          data: {
            type: 'process:spawned',
            id: msg.id,
            pid: 1042,
            stdoutSab,
            stderrSab,
            stdinSab,
          },
        } as any);

        // Simulate async process execution
        setTimeout(() => {
          // Write "Hello from process\n" to stdoutSab
          const int32 = new Int32Array(stdoutSab, 0, 4);
          const data = new Uint8Array(stdoutSab, 16, 1024);
          const payload = new TextEncoder().encode('Hello from process\n');
          data.set(payload, 0);
          int32[1] = payload.length; // writeHead
          int32[0] = 2; // FLAG_CLOSED
          Atomics.notify(int32, 0);

          // Close stderr
          const stderrInt32 = new Int32Array(stderrSab, 0, 4);
          stderrInt32[0] = 2; // FLAG_CLOSED
          Atomics.notify(stderrInt32, 0);

          this.onmessage?.({
            data: {
              type: 'process:exit',
              pid: 1042,
              code: 0,
            },
          } as any);
        }, 10);
      }
    }, 0);
  }

  terminate() {}
}

describe('ProcessNamespace Unit Tests (T018)', () => {
  it('spawns a process and streams stdout via ring buffer to completion', async () => {
    const mockWorker = new MockProcessWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const procNs = new ProcessNamespace(bridge);

    const handle = await procNs.spawn('node', ['/workspace/script.js']);
    expect(handle.pid).toBe(1042);

    const reader = handle.stdout.getReader();
    let accumulated = '';
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) accumulated += decoder.decode(value);
    }

    expect(accumulated).toBe('Hello from process\n');

    const exitCode = await handle.exit;
    expect(exitCode).toBe(0);
  });

  it('executes process.exec shorthand returning buffered stdout and exitCode', async () => {
    const mockWorker = new MockProcessWorker();
    const bridge = new WorkerBridge(mockWorker as any);
    const procNs = new ProcessNamespace(bridge);

    const result = await procNs.exec('node /workspace/script.js');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello from process\n');
    expect(result.stderr).toBe('');
  });
});
