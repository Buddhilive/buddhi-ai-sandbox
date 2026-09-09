import { WorkerBridge } from './worker-bridge.js';
import { FileStat } from './types.js';

export interface PersistenceAdapter {
  save(path: string, data: Uint8Array): Promise<void>;
  load(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
  clear(): Promise<void>;
}

let reqCounter = 0;
function nextId(): string {
  return `fs_${Date.now()}_${++reqCounter}`;
}

export class FsNamespace {
  private adapter: PersistenceAdapter | null = null;

  constructor(private bridge: WorkerBridge, adapter?: PersistenceAdapter | null) {
    this.adapter = adapter || null;
  }

  setPersistenceAdapter(adapter: PersistenceAdapter | null): void {
    this.adapter = adapter;
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this.bridge.request({
      type: 'fs:write',
      id: nextId(),
      path,
      data: raw,
    });
  }

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: 'utf-8'): Promise<string>;
  async readFile(path: string, encoding?: 'utf-8'): Promise<Uint8Array | string> {
    const res = await this.bridge.request<Uint8Array>({
      type: 'fs:read',
      id: nextId(),
      path,
    });
    if (encoding === 'utf-8') {
      return new TextDecoder().decode(res);
    }
    return res;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.bridge.request({
      type: 'fs:mkdir',
      id: nextId(),
      path,
      recursive: options?.recursive ?? true,
    });
  }

  async readdir(path: string): Promise<string[]> {
    return await this.bridge.request<string[]>({
      type: 'fs:readdir',
      id: nextId(),
      path,
    });
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.bridge.request({
      type: 'fs:rm',
      id: nextId(),
      path,
      recursive: options?.recursive ?? false,
    });
  }

  async stat(path: string): Promise<FileStat> {
    return await this.bridge.request<FileStat>({
      type: 'fs:stat',
      id: nextId(),
      path,
    });
  }

  async symlink(target: string, path: string): Promise<void> {
    await this.bridge.request({
      type: 'fs:symlink',
      id: nextId(),
      target,
      path,
    });
  }
}
