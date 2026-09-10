import { WorkerInboundMessage, WorkerOutboundMessage } from '../types.js';
import initWasm, {
  sandbox_init,
  vfs_write_file,
  vfs_read_file,
  vfs_mkdir,
  vfs_readdir,
  vfs_rm,
  vfs_stat,
  vfs_symlink,
} from 'buddhilive-sandbox-core';
// @ts-ignore
import wasmUrl from 'buddhilive-sandbox-core/buddhilive_sandbox_core_bg.wasm?url';

import eventsShim, { EventEmitter } from './shims/events.js';
import bufferShim, { Buffer } from './shims/buffer.js';
import stringDecoderShim from './shims/string-decoder.js';
import assertShim from './shims/assert.js';
import utilShim from './shims/util.js';
import osShim from './shims/os.js';
import cryptoShim from './shims/crypto.js';
import streamShim from './shims/stream.js';
import zlibShim from './shims/zlib.js';
import netShim from './shims/net.js';
import tlsShim from './shims/tls.js';
import childProcessShim from './shims/child-process.js';
import workerThreadsShim from './shims/worker-threads.js';
import httpShim, { activeHttpServers } from './shims/http.js';
import fsWatcherShim, { notifyFsChange } from './shims/fs-watcher.js';
import addonInterceptorShim, { interceptRequire } from './shims/addon-interceptor.js';
import hmrBridgeShim, { globalHmrServer } from './shims/hmr-bridge.js';

// Worker state
let initialized = false;
let wasmReady = false;
let options: any = {};

// In-worker in-memory virtual filesystem fallback and bindings
interface VfsNode {
  isDir: boolean;
  data?: Uint8Array;
  children?: Map<string, VfsNode>;
  target?: string;
  mtime: number;
  mode: number;
}

const rootNode: VfsNode = {
  isDir: true,
  children: new Map(),
  mtime: Date.now(),
  mode: 0o755,
};

function normalizePath(p: string): string[] {
  return p.split('/').filter(x => x.length > 0 && x !== '.');
}

function resolveNode(path: string, hops = 0): { node: VfsNode; parent?: VfsNode; name?: string } {
  if (hops > 40) throw new Error('ELOOP: too many symbolic links');
  const parts = normalizePath(path);
  let current = rootNode;
  let parent: VfsNode | undefined = undefined;
  let name: string | undefined = undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!current.isDir || !current.children) {
      throw new Error(`ENOTDIR: not a directory, '${part}'`);
    }

    const next = current.children.get(part);
    if (!next) {
      if (i === parts.length - 1) {
        return { node: null as any, parent: current, name: part };
      }
      throw new Error(`ENOENT: no such file or directory, '${path}'`);
    }

    if (next.target !== undefined) {
      // Symlink
      const remaining = parts.slice(i + 1).join('/');
      const targetPath = next.target.startsWith('/') ? `${next.target}/${remaining}` : `${next.target}/${remaining}`;
      return resolveNode(targetPath, hops + 1);
    }

    parent = current;
    name = part;
    current = next;
  }

  return { node: current, parent, name };
}

// Stdio buffer write helper
function writeToRingBuffer(sab: SharedArrayBuffer, text: string) {
  const int32 = new Int32Array(sab, 0, 4);
  const capacity = int32[3];
  const data = new Uint8Array(sab, 16, capacity);
  const encoded = new TextEncoder().encode(text);

  let offset = 0;
  while (offset < encoded.length) {
    const writeHead = Atomics.load(int32, 1);
    const readHead = Atomics.load(int32, 2);

    const available = writeHead >= readHead
      ? capacity - (writeHead - readHead) - 1
      : readHead - writeHead - 1;

    if (available <= 0) break;

    const toWrite = Math.min(encoded.length - offset, available);
    let cur = writeHead;
    for (let i = 0; i < toWrite; i++) {
      data[cur] = encoded[offset + i];
      cur = (cur + 1) % capacity;
    }

    Atomics.store(int32, 1, cur);
    Atomics.store(int32, 0, 1); // FLAG_DATA
    Atomics.notify(int32, 0);
    offset += toWrite;
  }
}

function closeRingBuffer(sab: SharedArrayBuffer) {
  const int32 = new Int32Array(sab, 0, 4);
  Atomics.store(int32, 0, 2); // FLAG_CLOSED
  Atomics.notify(int32, 0);
}

// Active processes
const processes = new Map<number, { killed: boolean; timeoutId?: any }>();
let nextPid = 1000;

self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'init': {
        options = msg.options || {};
        try {
          const targetWasm = options.wasmUrl || wasmUrl;
          if (targetWasm) {
            await initWasm(targetWasm);
          } else {
            await initWasm();
          }
          sandbox_init();
          wasmReady = true;
        } catch (e) {
          console.warn('[Sandbox Worker] WebAssembly runtime fallback to in-memory VFS:', e);
        }

        initialized = true;
        // Default standard directories
        const ensureDir = (p: string) => {
          const parts = normalizePath(p);
          let curr = rootNode;
          for (const part of parts) {
            if (!curr.children!.has(part)) {
              curr.children!.set(part, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
            }
            curr = curr.children!.get(part)!;
          }
          if (wasmReady) {
            try {
              vfs_mkdir(p, true);
            } catch (_) {}
          }
        };
        ensureDir('/workspace');
        ensureDir('/node_modules');
        ensureDir('/tmp');

        self.postMessage({ type: 'ready' } as WorkerOutboundMessage);
        break;
      }

      case 'fs:write': {
        const { id, path, data } = msg;
        const u8 = new Uint8Array(data);
        const { parent, name } = resolveNode(path);
        if (!parent || !name) {
          throw new Error(`ENOENT: cannot write to path ${path}`);
        }
        parent.children!.set(name, {
          isDir: false,
          data: u8,
          mtime: Date.now(),
          mode: 0o644,
        });
        if (wasmReady) {
          try {
            vfs_write_file(path, u8);
          } catch (_) {}
        }
        notifyFsChange(path, 'change');
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'fs:read': {
        const { id, path } = msg;
        const { node } = resolveNode(path);
        if (!node || node.isDir || !node.data) {
          throw new Error(`ENOENT: no such file or directory, '${path}'`);
        }
        self.postMessage({
          type: 'fs:response',
          id,
          result: node.data,
        } as WorkerOutboundMessage);
        break;
      }

      case 'fs:mkdir': {
        const { id, path, recursive } = msg;
        if (recursive) {
          const parts = normalizePath(path);
          let curr = rootNode;
          for (const part of parts) {
            if (!curr.children!.has(part)) {
              curr.children!.set(part, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
            }
            curr = curr.children!.get(part)!;
          }
        } else {
          const { parent, name } = resolveNode(path);
          if (!parent || !name) {
            throw new Error(`ENOENT: cannot create directory '${path}'`);
          }
          if (parent.children!.has(name)) {
            throw new Error(`EEXIST: file or directory already exists, '${path}'`);
          }
          parent.children!.set(name, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
        }
        if (wasmReady) {
          try {
            vfs_mkdir(path, !!recursive);
          } catch (_) {}
        }
        notifyFsChange(path, 'change');
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'fs:readdir': {
        const { id, path } = msg;
        const { node } = resolveNode(path);
        if (!node || !node.isDir || !node.children) {
          throw new Error(`ENOTDIR: not a directory, '${path}'`);
        }
        const entries = Array.from(node.children.keys());
        self.postMessage({ type: 'fs:response', id, result: entries } as WorkerOutboundMessage);
        break;
      }

      case 'fs:stat': {
        const { id, path } = msg;
        const { node } = resolveNode(path);
        if (!node) {
          throw new Error(`ENOENT: no such file or directory, '${path}'`);
        }
        self.postMessage({
          type: 'fs:response',
          id,
          result: {
            isFile: !node.isDir && !node.target,
            isDirectory: node.isDir,
            isSymbolicLink: !!node.target,
            size: node.data ? node.data.byteLength : 4096,
            mtimeMs: node.mtime,
            mode: node.mode,
          },
        } as WorkerOutboundMessage);
        break;
      }

      case 'fs:rm': {
        const { id, path } = msg;
        const { parent, name } = resolveNode(path);
        if (parent && name && parent.children!.has(name)) {
          parent.children!.delete(name);
        }
        if (wasmReady) {
          try {
            vfs_rm(path, !!msg.recursive);
          } catch (_) {}
        }
        notifyFsChange(path, 'rename');
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'fs:symlink': {
        const { id, target, path } = msg;
        const { parent, name } = resolveNode(path);
        if (parent && name) {
          parent.children!.set(name, {
            isDir: false,
            target,
            mtime: Date.now(),
            mode: 0o777,
          });
        }
        if (wasmReady) {
          try {
            vfs_symlink(target, path);
          } catch (_) {}
        }
        notifyFsChange(path, 'change');
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'http:request': {
        const server = activeHttpServers.get(msg.port);
        if (server) {
          server.dispatchRequest({
            method: msg.method,
            path: msg.path,
            headers: msg.headers,
            body: msg.body,
            replyPort: msg.replyPort,
          });
        } else if (msg.replyPort) {
          msg.replyPort.postMessage({
            type: 'end',
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
            body: new TextEncoder().encode('Virtual HTTP server not listening').buffer,
          });
        }
        break;
      }

      case 'ws:connect': {
        globalHmrServer.handleConnection(msg.channelPort);
        break;
      }

      case 'fs:external_change': {
        notifyFsChange(msg.path, msg.changeType);
        break;
      }

      case 'process:spawn': {
        const { id, command, args } = msg;
        const pid = nextPid++;

        // Ring buffer sizes: 16 header + 65536
        const sabStdout = new SharedArrayBuffer(16 + 65536);
        const sabStderr = new SharedArrayBuffer(16 + 65536);
        const sabStdin = new SharedArrayBuffer(16 + 65536);

        // Initialize header
        for (const sab of [sabStdout, sabStderr, sabStdin]) {
          const int32 = new Int32Array(sab, 0, 4);
          int32[0] = 0; // FLAG_EMPTY
          int32[1] = 0; // write
          int32[2] = 0; // read
          int32[3] = 65536; // capacity
        }

        const proc = { killed: false };
        processes.set(pid, proc);

        self.postMessage({
          type: 'process:spawned',
          id,
          pid,
          stdoutSab: sabStdout,
          stderrSab: sabStderr,
          stdinSab: sabStdin,
        } as WorkerOutboundMessage);

        // Execute async
        setTimeout(async () => {
          try {
            if (proc.killed) {
              closeRingBuffer(sabStdout);
              closeRingBuffer(sabStderr);
              self.postMessage({ type: 'process:exit', pid, code: 130 } as WorkerOutboundMessage);
              return;
            }

            if (command === 'node' && args.length > 0) {
              const scriptPath = args[0];
              const { node } = resolveNode(scriptPath);
              if (!node || !node.data) {
                writeToRingBuffer(sabStderr, `Error: Cannot find module '${scriptPath}'\n`);
                closeRingBuffer(sabStdout);
                closeRingBuffer(sabStderr);
                self.postMessage({ type: 'process:exit', pid, code: 1 } as WorkerOutboundMessage);
                return;
              }

              const scriptCode = new TextDecoder().decode(node.data);

              // Virtual sandbox execution context
              const virtualConsole = {
                log: (...args: any[]) => writeToRingBuffer(sabStdout, args.map(String).join(' ') + '\n'),
                error: (...args: any[]) => writeToRingBuffer(sabStderr, args.map(String).join(' ') + '\n'),
                warn: (...args: any[]) => writeToRingBuffer(sabStderr, args.map(String).join(' ') + '\n'),
                info: (...args: any[]) => writeToRingBuffer(sabStdout, args.map(String).join(' ') + '\n'),
              };

              const virtualProcess = {
                version: 'v20.12.0',
                platform: 'browser-wasm',
                pid,
                cwd: () => '/workspace',
                stdout: {
                  write: (str: string) => writeToRingBuffer(sabStdout, String(str)),
                },
                stderr: {
                  write: (str: string) => writeToRingBuffer(sabStderr, String(str)),
                },
                exit: (code = 0) => {
                  throw { __isExit: true, code };
                },
                env: {
                  NODE_ENV: 'development',
                  PATH: '/node_modules/.bin',
                  NEXT_TELEMETRY_DISABLED: '1',
                  ...(msg.env || {}),
                },
                nextTick: (cb: Function, ...args: any[]) => setTimeout(() => cb(...args), 0),
                hrtime: (time?: [number, number]) => {
                  const now = performance.now();
                  const seconds = Math.floor(now / 1000);
                  const nanos = Math.floor((now % 1000) * 1e6);
                  if (time) {
                    return [seconds - time[0], nanos - time[1]];
                  }
                  return [seconds, nanos];
                },
              };

              // Virtual fs built-in module
              const virtualFs = {
                writeFileSync: (filePath: string, data: string | Uint8Array, options?: any) => {
                  const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                  const { parent, name } = resolveNode(filePath);
                  if (!parent || !name) throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
                  parent.children!.set(name, {
                    isDir: false,
                    data: encoded,
                    mtime: Date.now(),
                    mode: 0o644,
                  });
                  if (wasmReady) {
                    try { vfs_write_file(filePath, encoded); } catch (_) {}
                  }
                  notifyFsChange(filePath, 'change');
                },
                readFileSync: (filePath: string, options?: any) => {
                  const { node } = resolveNode(filePath);
                  if (!node || node.isDir || !node.data) {
                    throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
                  }
                  const encoding = typeof options === 'string' ? options : options?.encoding;
                  if (encoding === 'utf8' || encoding === 'utf-8') {
                    return new TextDecoder().decode(node.data);
                  }
                  return Buffer.from(node.data);
                },
                readdirSync: (dirPath: string) => {
                  const { node } = resolveNode(dirPath);
                  if (!node || !node.isDir || !node.children) {
                    throw new Error(`ENOTDIR: not a directory, scandir '${dirPath}'`);
                  }
                  return Array.from(node.children.keys());
                },
                statSync: (filePath: string) => {
                  const { node } = resolveNode(filePath);
                  if (!node) {
                    throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
                  }
                  return {
                    isFile: () => !node.isDir && !node.target,
                    isDirectory: () => node.isDir,
                    isSymbolicLink: () => !!node.target,
                    size: node.data ? node.data.byteLength : 4096,
                    mtimeMs: node.mtime,
                    mode: node.mode,
                  };
                },
                existsSync: (filePath: string) => {
                  try {
                    const { node } = resolveNode(filePath);
                    return !!node;
                  } catch (_) {
                    return false;
                  }
                },
                mkdirSync: (dirPath: string, options?: any) => {
                  const recursive = typeof options === 'boolean' ? options : options?.recursive || false;
                  if (recursive) {
                    const parts = normalizePath(dirPath);
                    let curr = rootNode;
                    for (const part of parts) {
                      if (!curr.children!.has(part)) {
                        curr.children!.set(part, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
                      }
                      curr = curr.children!.get(part)!;
                    }
                  } else {
                    const { parent, name } = resolveNode(dirPath);
                    if (!parent || !name) throw new Error(`ENOENT: no such file or directory, mkdir '${dirPath}'`);
                    if (parent.children!.has(name)) throw new Error(`EEXIST: file already exists, mkdir '${dirPath}'`);
                    parent.children!.set(name, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
                  }
                  if (wasmReady) {
                    try { vfs_mkdir(dirPath, !!(options?.recursive)); } catch (_) {}
                  }
                  notifyFsChange(dirPath, 'change');
                },
                unlinkSync: (filePath: string) => {
                  const { parent, name } = resolveNode(filePath);
                  if (parent && name && parent.children!.has(name)) {
                    parent.children!.delete(name);
                    if (wasmReady) {
                      try { vfs_rm(filePath, false); } catch (_) {}
                    }
                    notifyFsChange(filePath, 'rename');
                  } else {
                    throw new Error(`ENOENT: no such file or directory, unlink '${filePath}'`);
                  }
                },
                watch: fsWatcherShim.watch,
                watchFile: fsWatcherShim.watchFile,
                unwatchFile: fsWatcherShim.unwatchFile,
                promises: {
                  writeFile: async (p: string, d: string | Uint8Array, opt?: any) => virtualFs.writeFileSync(p, d, opt),
                  readFile: async (p: string, opt?: any) => virtualFs.readFileSync(p, opt),
                  readdir: async (p: string) => virtualFs.readdirSync(p),
                  stat: async (p: string) => virtualFs.statSync(p),
                  mkdir: async (p: string, opt?: any) => virtualFs.mkdirSync(p, opt),
                  unlink: async (p: string) => virtualFs.unlinkSync(p),
                },
              };

              // Virtual path built-in module
              const virtualPath = {
                join: (...segments: string[]) => {
                  const parts: string[] = [];
                  for (const s of segments) {
                    for (const p of String(s).split('/')) {
                      if (p === '..') parts.pop();
                      else if (p && p !== '.') parts.push(p);
                    }
                  }
                  return (segments[0]?.startsWith('/') ? '/' : '') + parts.join('/');
                },
                resolve: (...segments: string[]) => {
                  const parts: string[] = [];
                  for (const s of segments) {
                    const str = String(s);
                    if (str.startsWith('/')) parts.length = 0;
                    for (const p of str.split('/')) {
                      if (p === '..') parts.pop();
                      else if (p && p !== '.') parts.push(p);
                    }
                  }
                  return '/' + parts.join('/');
                },
                basename: (p: string, ext?: string) => {
                  const seg = String(p).split('/').filter(Boolean).pop() || '';
                  return ext && seg.endsWith(ext) ? seg.slice(0, -ext.length) : seg;
                },
                dirname: (p: string) => {
                  const seg = String(p).split('/').filter(Boolean);
                  seg.pop();
                  return '/' + seg.join('/');
                },
                extname: (p: string) => {
                  const base = String(p).split('/').filter(Boolean).pop() || '';
                  const idx = base.lastIndexOf('.');
                  return idx > 0 ? base.slice(idx) : '';
                },
              };

              // Module cache
              const moduleCache = new Map<string, any>();

              // Virtual require
              const virtualRequire = (mod: string) => {
                // Check native addon interceptor first
                const intercepted = interceptRequire(mod);
                if (intercepted !== null) return intercepted;

                const cleanMod = mod.startsWith('node:') ? mod.slice(5) : mod;
                if (cleanMod === 'fs') return virtualFs;
                if (cleanMod === 'path') return virtualPath;
                if (cleanMod === 'http' || cleanMod === 'https') return httpShim;
                if (cleanMod === 'events') return eventsShim;
                if (cleanMod === 'buffer') return bufferShim;
                if (cleanMod === 'string_decoder') return stringDecoderShim;
                if (cleanMod === 'stream') return streamShim;
                if (cleanMod === 'stream/web') return { ReadableStream, WritableStream, TransformStream };
                if (cleanMod === 'stream/promises') return streamShim.promises;
                if (cleanMod === 'crypto') return cryptoShim;
                if (cleanMod === 'zlib') return zlibShim;
                if (cleanMod === 'os') return osShim;
                if (cleanMod === 'net') return netShim;
                if (cleanMod === 'tls') return tlsShim;
                if (cleanMod === 'assert') return assertShim;
                if (cleanMod === 'util') return utilShim;
                if (cleanMod === 'child_process') return childProcessShim;
                if (cleanMod === 'worker_threads') return workerThreadsShim;
                if (cleanMod === 'url') return { URL, URLSearchParams, parse: (u: string) => new URL(u, 'http://localhost') };
                if (cleanMod === 'querystring') return {
                  parse: (str: string) => {
                    const params: Record<string, string> = {};
                    new URLSearchParams(str).forEach((v, k) => { params[k] = v; });
                    return params;
                  },
                  stringify: (obj: any) => new URLSearchParams(obj).toString(),
                };

                // Check cache
                if (moduleCache.has(mod)) {
                  return moduleCache.get(mod);
                }

                // Check if mod is local or in node_modules
                const candidates: string[] = [];
                if (mod.startsWith('.') || mod.startsWith('/')) {
                  candidates.push(mod);
                  candidates.push(`${mod}.js`);
                  candidates.push(`${mod}.json`);
                  candidates.push(`${mod}/index.js`);
                } else {
                  candidates.push(`/node_modules/${mod}/index.js`);
                  candidates.push(`/node_modules/${mod}.js`);
                  candidates.push(`/node_modules/${mod}/package.json`);
                }

                let targetFile: string | null = null;
                let fileData: Uint8Array | null = null;

                for (const candidate of candidates) {
                  try {
                    const res = resolveNode(candidate);
                    if (res.node && res.node.data) {
                      targetFile = candidate;
                      fileData = res.node.data;
                      break;
                    }
                  } catch (_) {}
                }

                if (!targetFile || !fileData) {
                  throw new Error(`Cannot find module '${mod}'`);
                }

                // If package.json, find entrypoint
                if (targetFile.endsWith('package.json')) {
                  try {
                    const pkgJson = JSON.parse(new TextDecoder().decode(fileData));
                    const mainEntry = pkgJson.main || pkgJson.module || 'index.js';
                    const resolvedMain = virtualPath.join(virtualPath.dirname(targetFile), mainEntry);
                    return virtualRequire(resolvedMain);
                  } catch (e) {
                    throw new Error(`Failed to parse package.json for module '${mod}'`);
                  }
                }

                // If JSON file
                if (targetFile.endsWith('.json')) {
                  const parsed = JSON.parse(new TextDecoder().decode(fileData));
                  moduleCache.set(mod, parsed);
                  return parsed;
                }

                const fn = new Function(
                  'require',
                  'module',
                  'exports',
                  'process',
                  'console',
                  'Buffer',
                  new TextDecoder().decode(fileData)
                );
                const modObj = { exports: {} as any };
                moduleCache.set(mod, modObj.exports);

                try {
                  fn(virtualRequire, modObj, modObj.exports, virtualProcess, virtualConsole, Buffer);
                  moduleCache.set(mod, modObj.exports);
                  return modObj.exports;
                } catch (err: any) {
                  moduleCache.delete(mod);
                  throw err;
                }
              };

              // Execute script
              const runner = new Function(
                'console',
                'process',
                'require',
                'Buffer',
                scriptCode
              );

              try {
                runner(virtualConsole, virtualProcess, virtualRequire, Buffer);
                closeRingBuffer(sabStdout);
                closeRingBuffer(sabStderr);
                self.postMessage({ type: 'process:exit', pid, code: 0 } as WorkerOutboundMessage);
              } catch (e: any) {
                if (e && e.__isExit) {
                  closeRingBuffer(sabStdout);
                  closeRingBuffer(sabStderr);
                  self.postMessage({ type: 'process:exit', pid, code: e.code } as WorkerOutboundMessage);
                } else {
                  writeToRingBuffer(sabStderr, (e?.stack || e?.message || String(e)) + '\n');
                  closeRingBuffer(sabStdout);
                  closeRingBuffer(sabStderr);
                  self.postMessage({ type: 'process:exit', pid, code: 1 } as WorkerOutboundMessage);
                }
              }
            } else {
              writeToRingBuffer(sabStdout, `Command '${command}' executed\n`);
              closeRingBuffer(sabStdout);
              closeRingBuffer(sabStderr);
              self.postMessage({ type: 'process:exit', pid, code: 0 } as WorkerOutboundMessage);
            }
          } finally {
            processes.delete(pid);
          }
        }, 10);
        break;
      }

      case 'process:kill': {
        const { pid } = msg;
        const proc = processes.get(pid);
        if (proc) {
          proc.killed = true;
        }
        break;
      }
    }
  } catch (err: any) {
    if ('id' in msg) {
      self.postMessage({
        type: 'fs:response',
        id: (msg as any).id,
        error: err?.message || String(err),
      } as WorkerOutboundMessage);
    } else {
      self.postMessage({
        type: 'error',
        message: err?.message || String(err),
      } as WorkerOutboundMessage);
    }
  }
};
