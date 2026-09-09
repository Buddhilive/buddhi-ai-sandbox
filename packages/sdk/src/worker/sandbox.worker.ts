import { WorkerInboundMessage, WorkerOutboundMessage } from '../types.js';

// Worker state
let initialized = false;
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
        };
        ensureDir('/workspace');
        ensureDir('/node_modules');
        ensureDir('/tmp');

        self.postMessage({ type: 'ready' } as WorkerOutboundMessage);
        break;
      }

      case 'fs:write': {
        const { id, path, data } = msg;
        const { parent, name } = resolveNode(path);
        if (!parent || !name) {
          throw new Error(`ENOENT: cannot write to path ${path}`);
        }
        parent.children!.set(name, {
          isDir: false,
          data: new Uint8Array(data),
          mtime: Date.now(),
          mode: 0o644,
        });
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'fs:read': {
        const { id, path } = msg;
        const { node } = resolveNode(path);
        if (!node || node.isDir) {
          throw new Error(`ENOENT or EISDIR on ${path}`);
        }
        self.postMessage({ type: 'fs:response', id, result: node.data } as WorkerOutboundMessage);
        break;
      }

      case 'fs:mkdir': {
        const { id, path, recursive } = msg;
        const parts = normalizePath(path);
        let curr = rootNode;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!curr.children!.has(part)) {
            if (!recursive && i < parts.length - 1) {
              throw new Error(`ENOENT: no such parent directory`);
            }
            curr.children!.set(part, { isDir: true, children: new Map(), mtime: Date.now(), mode: 0o755 });
          }
          curr = curr.children!.get(part)!;
        }
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
        break;
      }

      case 'fs:readdir': {
        const { id, path } = msg;
        const { node } = resolveNode(path);
        if (!node || !node.isDir) {
          throw new Error(`ENOTDIR: not a directory, '${path}'`);
        }
        const entries = Array.from(node.children!.keys());
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
        self.postMessage({ type: 'fs:response', id, result: null } as WorkerOutboundMessage);
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
                stdout: {
                  write: (str: string) => writeToRingBuffer(sabStdout, String(str)),
                },
                stderr: {
                  write: (str: string) => writeToRingBuffer(sabStderr, String(str)),
                },
                exit: (code = 0) => {
                  throw { __isExit: true, code };
                },
                env: { NODE_ENV: 'development', PATH: '/node_modules/.bin' },
              };

              // Virtual require
              const virtualRequire = (mod: string) => {
                // Check if mod is local or in node_modules
                let targetFile = mod;
                if (!mod.startsWith('.') && !mod.startsWith('/')) {
                  targetFile = `/node_modules/${mod}/index.js`;
                }
                const res = resolveNode(targetFile);
                if (!res.node || !res.node.data) {
                  throw new Error(`Cannot find module '${mod}'`);
                }
                const fn = new Function('require', 'module', 'exports', 'process', 'console', new TextDecoder().decode(res.node.data));
                const modObj = { exports: {} as any };
                fn(virtualRequire, modObj, modObj.exports, virtualProcess, virtualConsole);
                return modObj.exports;
              };

              // Execute script
              const runner = new Function(
                'console',
                'process',
                'require',
                scriptCode
              );

              try {
                runner(virtualConsole, virtualProcess, virtualRequire);
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
