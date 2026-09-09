import { WorkerBridge } from './worker-bridge.js';
import { FsNamespace } from './fs-namespace.js';
import { ProcessNamespace } from './process-namespace.js';
import { PortsNamespace } from './ports-namespace.js';
import { SandboxOptions, SandboxError, WorkerOutboundMessage } from './types.js';

// @ts-ignore
import InlineSandboxWorker from './worker/sandbox.worker.ts?worker&inline';

export class Sandbox {
  public readonly fs: FsNamespace;
  public readonly process: ProcessNamespace;
  public readonly ports: PortsNamespace;

  private bridge: WorkerBridge;
  private isDisposed = false;

  private constructor(bridge: WorkerBridge) {
    this.bridge = bridge;
    this.fs = new FsNamespace(bridge);
    this.process = new ProcessNamespace(bridge);
    this.ports = new PortsNamespace(bridge);
  }

  public static async create(options: SandboxOptions = {}): Promise<Sandbox> {
    let worker: Worker;

    if (options.workerUrl && typeof Worker !== 'undefined') {
      worker = new Worker(options.workerUrl, { type: 'module' });
    } else if (typeof InlineSandboxWorker === 'function') {
      worker = new InlineSandboxWorker();
    } else {
      throw new SandboxError('Web Worker environment is required for Sandbox execution');
    }

    const bridge = new WorkerBridge(worker);

    const initPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.terminate();
        reject(new SandboxError('Sandbox initialization timed out', 'ETIMEDOUT'));
      }, options.commandTimeoutMs || 30000);

      const unsub = bridge.onMessage((msg: WorkerOutboundMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          unsub();
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          unsub();
          reject(new SandboxError(msg.message, msg.code));
        }
      });
    });

    bridge.postMessage({ type: 'init', options });
    await initPromise;

    return new Sandbox(bridge);
  }

  public async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.bridge.terminate();
  }
}
