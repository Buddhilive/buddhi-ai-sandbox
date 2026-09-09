import {
  WorkerBridge,
  createRingBufferReader,
  createRingBufferWriter,
} from './worker-bridge.js';
import {
  ProcessHandle,
  ProcessExecResult,
  WorkerOutboundMessage,
} from './types.js';

let procReqCounter = 0;
function nextProcId(): string {
  return `proc_${Date.now()}_${++procReqCounter}`;
}

export class ProcessNamespace {
  private exitResolvers = new Map<number, (code: number) => void>();

  constructor(private bridge: WorkerBridge) {
    this.bridge.onMessage((msg: WorkerOutboundMessage) => {
      if (msg.type === 'process:exit') {
        const resolver = this.exitResolvers.get(msg.pid);
        if (resolver) {
          resolver(msg.code);
          this.exitResolvers.delete(msg.pid);
        }
      }
    });
  }

  async spawn(
    command: string,
    args: string[] = [],
    options?: { env?: Record<string, string>; cwd?: string }
  ): Promise<ProcessHandle> {
    const id = nextProcId();

    const spawnPromise = new Promise<{
      pid: number;
      stdoutSab: SharedArrayBuffer;
      stderrSab: SharedArrayBuffer;
      stdinSab: SharedArrayBuffer;
    }>((resolve, reject) => {
      const unsub = this.bridge.onMessage((msg: WorkerOutboundMessage) => {
        if (msg.type === 'process:spawned' && msg.id === id) {
          unsub();
          resolve({
            pid: msg.pid,
            stdoutSab: msg.stdoutSab,
            stderrSab: msg.stderrSab,
            stdinSab: msg.stdinSab,
          });
        } else if (msg.type === 'error') {
          unsub();
          reject(new Error(msg.message));
        }
      });
    });

    this.bridge.postMessage({
      type: 'process:spawn',
      id,
      command,
      args,
      env: options?.env,
      cwd: options?.cwd,
    });

    const spawned = await spawnPromise;

    let exitResolver!: (code: number) => void;
    const exit = new Promise<number>((res) => {
      exitResolver = res;
    });
    this.exitResolvers.set(spawned.pid, exitResolver);

    const stdout = createRingBufferReader(spawned.stdoutSab);
    const stderr = createRingBufferReader(spawned.stderrSab);
    const stdin = createRingBufferWriter(spawned.stdinSab);

    return {
      pid: spawned.pid,
      stdout,
      stderr,
      stdin,
      exit,
      kill: async (signal?: string) => {
        await this.kill(spawned.pid, signal);
      },
    };
  }

  async exec(commandLine: string): Promise<ProcessExecResult> {
    const tokens = commandLine.trim().split(/\s+/);
    const command = tokens[0] || '';
    const args = tokens.slice(1);

    const proc = await this.spawn(command, args);

    let stdoutText = '';
    let stderrText = '';
    const decoder = new TextDecoder();

    const readStdout = async () => {
      const reader = proc.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) stdoutText += decoder.decode(value, { stream: true });
        }
      } catch (_) {
        // Stream ended
      } finally {
        reader.releaseLock();
      }
    };

    const readStderr = async () => {
      const reader = proc.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) stderrText += decoder.decode(value, { stream: true });
        }
      } catch (_) {
        // Stream ended
      } finally {
        reader.releaseLock();
      }
    };

    const [, , exitCode] = await Promise.all([readStdout(), readStderr(), proc.exit]);

    return {
      stdout: stdoutText,
      stderr: stderrText,
      exitCode,
    };
  }

  async kill(pid: number, signal?: string): Promise<void> {
    this.bridge.postMessage({
      type: 'process:kill',
      pid,
      signal,
    });
  }
}
