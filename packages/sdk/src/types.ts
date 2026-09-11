/**
 * Core type declarations for @buddhilive/sandbox
 */

export interface SandboxOptions {
  /** Maximum memory quota in megabytes (default: 512) */
  maxMemoryMb?: number;
  /** Default command execution timeout in milliseconds (default: 30000) */
  commandTimeoutMs?: number;
  /** NPM registry URL (default: 'https://registry.npmjs.org') */
  registryUrl?: string;
  /** Optional persistence adapter for VirtualFS state */
  persistenceAdapter?: 'opfs' | 'indexeddb' | null;
  /** Optional URL or custom path to sandbox.worker.js */
  workerUrl?: string;
  /** Optional URL or custom path to WebAssembly core binary */
  wasmUrl?: string;
  /** Next.js specific configuration options */
  nextjsOptions?: {
    version?: string;
    turbopack?: boolean;
    telemetry?: boolean;
  };
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
  mode: number;
}

export interface ProcessHandle {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin: WritableStream<Uint8Array>;
  readonly exit: Promise<number>;
  kill(signal?: string): Promise<void>;
}

export interface ProcessExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ListenEvent {
  port: number;
  url: string;
}

export class SandboxError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export class OOMError extends SandboxError {
  constructor(message = 'WebAssembly memory limit exceeded') {
    super(message, 'ERR_OUT_OF_MEMORY');
    this.name = 'OOMError';
  }
}

// Protocol Message Types for Worker Bridge
export type WorkerInboundMessage =
  | { type: 'init'; options: SandboxOptions }
  | { type: 'fs:read'; id: string; path: string }
  | { type: 'fs:write'; id: string; path: string; data: Uint8Array }
  | { type: 'fs:mkdir'; id: string; path: string; recursive?: boolean }
  | { type: 'fs:readdir'; id: string; path: string }
  | { type: 'fs:rm'; id: string; path: string; recursive?: boolean }
  | { type: 'fs:stat'; id: string; path: string }
  | { type: 'fs:symlink'; id: string; target: string; path: string }
  | { type: 'process:spawn'; id: string; command: string; args: string[]; env?: Record<string, string>; cwd?: string }
  | { type: 'process:kill'; pid: number; signal?: string }
  | { type: 'port:listen_ack'; port: number; messagePort: MessagePort }
  | {
      type: 'http:request';
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
      body: ArrayBuffer | null;
      replyPort: MessagePort;
    }
  | { type: 'ws:connect'; port: number; url: string; clientId: string; channelPort: MessagePort }
  | { type: 'fs:external_change'; path: string; changeType: 'change' | 'rename' };

export type FileChangeType = 'create' | 'update' | 'delete';

export interface FileChangeEvent {
  path: string;
  type: FileChangeType;
}

export type FileChangeListener = (event: FileChangeEvent) => void;

export type WorkerOutboundMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string; code?: string }
  | { type: 'fs:response'; id: string; error?: string; result?: unknown }
  | {
      type: 'process:spawned';
      id: string;
      pid: number;
      stdoutSab: SharedArrayBuffer;
      stderrSab: SharedArrayBuffer;
      stdinSab: SharedArrayBuffer;
    }
  | { type: 'process:exit'; pid: number; code: number }
  | { type: 'port:listen'; port: number; messagePort?: MessagePort }
  | { type: 'port:close'; port: number }
  | { type: 'toolchain:needed'; pkg: string }
  | { type: 'toolchain:progress'; loaded: number; total: number; tool: string }
  | { type: 'npm:progress'; loaded: number; total: number; package: string }
  | { type: 'oom'; message: string }
  | { type: 'fs:change'; path: string; changeType: FileChangeType };

