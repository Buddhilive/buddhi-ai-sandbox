/**
 * Contracts for Node.js Built-in Emulation Shims in packages/sdk
 */

export interface VirtualEventEmitter {
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string | symbol): this;
}

export interface VirtualStream extends VirtualEventEmitter {
  pipe<T extends VirtualWritableStream>(destination: T, options?: { end?: boolean }): T;
}

export interface VirtualReadableStream extends VirtualStream {
  readable: boolean;
  read(size?: number): any;
  resume(): this;
  pause(): this;
}

export interface VirtualWritableStream extends VirtualStream {
  writable: boolean;
  write(chunk: any, encoding?: string, callback?: (error?: Error | null) => void): boolean;
  end(chunk?: any, encoding?: string, callback?: () => void): this;
}

export interface VirtualHttpIncomingMessage extends VirtualReadableStream {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
  statusCode?: number;
  statusMessage?: string;
  socket: any;
}

export interface VirtualHttpServerResponse extends VirtualWritableStream {
  statusCode: number;
  statusMessage: string;
  setHeader(name: string, value: number | string | readonly string[]): this;
  getHeader(name: string): number | string | readonly string[] | undefined;
  removeHeader(name: string): void;
  hasHeader(name: string): boolean;
  writeHead(statusCode: number, statusMessage?: string | any, headers?: any): this;
  flushHeaders(): void;
}

export interface VirtualFsWatcherContract extends VirtualEventEmitter {
  close(): void;
  ref(): this;
  unref(): this;
}
