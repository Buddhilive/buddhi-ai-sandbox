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
  /** Optional stack preset to pre-configure module aliases and environment */
  stackPreset?: StackPreset;
  /** Next.js specific configuration options */
  nextjsOptions?: {
    version?: string;
    turbopack?: boolean;
    telemetry?: boolean;
  };
}

export type StackPreset = 'next-stack';

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
  | { type: 'fs:external_change'; path: string; changeType: 'change' | 'rename' }
  | { type: 'pdf:extract'; id: string; data: Uint8Array; options?: ExtractionOptions }
  | { type: 'pdf:abort'; id: string };

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
  | { type: 'port:listen'; port: number; messagePort?: MessagePort; bridgePort?: MessagePort }
  | { type: 'port:close'; port: number }
  | { type: 'toolchain:needed'; pkg: string }
  | { type: 'toolchain:progress'; loaded: number; total: number; tool: string }
  | { type: 'npm:progress'; loaded: number; total: number; package: string }
  | { type: 'oom'; message: string }
  | { type: 'fs:change'; path: string; changeType: FileChangeType }
  | { type: 'pdf:progress'; id: string; progress: ExtractionProgress }
  | { type: 'pdf:result'; id: string; result: ExtractedDocument }
  | { type: 'pdf:error'; id: string; error: string; code?: string };

export class PdfExtractionError extends SandboxError {
  constructor(message: string, code = 'ERR_PDF_EXTRACTION') {
    super(message, code);
    this.name = 'PdfExtractionError';
  }
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'table' | 'figure' | 'list' | 'equation';
  text: string;
  level?: number;
  pageNumber: number;
  bbox?: BoundingBox;
}

export interface ExtractedTable {
  id: string;
  pageNumber: number;
  headers: string[];
  rows: string[][];
  markdown: string;
  bbox?: BoundingBox;
}

export interface PageData {
  pageNumber: number;
  width: number;
  height: number;
  blocks: DocumentBlock[];
  tables: ExtractedTable[];
}

export interface DocumentMetadata {
  title?: string;
  authors?: string[];
  totalPages: number;
  creationDate?: string;
  producer?: string;
}

export interface TableOfContentsItem {
  title: string;
  level: number;
  pageNumber: number;
  blockId?: string;
}

export interface ExtractedDocument {
  id: string;
  metadata: DocumentMetadata;
  markdown: string;
  pages: PageData[];
  toc: TableOfContentsItem[];
}

export type ExtractionStage =
  | 'initializing'
  | 'loading'
  | 'extracting_pages'
  | 'detecting_tables'
  | 'structuring'
  | 'generating_markdown'
  | 'completed'
  | 'failed';

export interface ExtractionProgress {
  stage: ExtractionStage;
  pageCurrent: number;
  pageTotal: number;
  percent: number;
  message: string;
}

export interface ExtractionOptions {
  extractTables?: boolean;
  extractImages?: boolean;
  cacheInVfs?: boolean;
  documentId?: string;
  onProgress?: (progress: ExtractionProgress) => void;
  signal?: AbortSignal;
}

