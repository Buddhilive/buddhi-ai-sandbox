# BuddhiLive Sandbox

> **Ultra-lightweight, zero-backend, client-side Node.js sandbox running entirely in WebAssembly & Web Workers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-WASM-DEA584.svg)](https://www.rust-lang.org/)

BuddhiLive Sandbox allows modern web applications to instantiate an isolated, fully functional Node.js-compatible execution environment directly inside the user's browser. It eliminates the cost, latency, and operational burden of maintaining backend container pools (Docker, Kubernetes, Firecracker VMs) for running untrusted code, interactive tutorials, AI agent testbeds, and browser-based IDEs.

---

## Key Highlights

- ⚡ **Zero Backend Infrastructure**: Runs 100% client-side in dedicated Web Workers.
- 📁 **POSIX In-Memory VirtualFS**: Full filesystem emulation (`readFile`, `writeFile`, `mkdir`, `readdir`, `stat`, `symlink`) with optional browser persistence (OPFS / IndexedDB).
- 🔄 **Real-Time Streaming I/O**: Lock-free single-producer single-consumer (SPSC) ring buffers built on `SharedArrayBuffer` and `Atomics`.
- 🌐 **In-Browser Web Application Previews**: Captures internal HTTP listeners (`http.createServer().listen(3000)`) via a Service Worker and renders live previews at `/__preview/:port/` inside `<iframe>` tags.
- 📦 **Direct Client-Side NPM Installer**: Fetches manifests and tarballs from `registry.npmjs.org` over browser HTTPS and extracts packages directly into `/node_modules`.
- 🛠️ **On-Demand Dynamic Native Toolchain**: Lazily loads Python and Clang WASM compilers only when native compilation (`binding.gyp` / `node-gyp`) is detected, keeping baseline SDK bundle under **100 KB**.

---

## Monorepo Packages

```text
packages/
├── wasm-core/           # Rust WebAssembly core (buddhilive-sandbox-core)
│                        # Inode VFS, SPSC ring-buffer I/O, virtual TCP port table
├── sdk/                 # Main TypeScript client SDK (@buddhilive/sandbox)
│                        # Sandbox orchestrator, fs/process/ports namespaces, NPM installer
├── service-worker/      # Service Worker HTTP preview bridge (@buddhilive/sandbox-sw)
│                        # Intercepts /__preview/:port/* routes & COOP/COEP injection
└── toolchain-bundle/    # On-demand native compiler bundle (@buddhilive/sandbox-toolchain)
                         # Python WASM runtime & Clang/Musl C/C++ compiler for node-gyp

apps/
└── sandbox-demo/        # Interactive Vite demo application showcasing live execution
```

---

## Developer Setup & Getting Started

### Prerequisites

Ensure you have the following installed on your development machine:

1. **Node.js**: `v20.0.0` or higher ([Download](https://nodejs.org/))
2. **pnpm**: `v9.0.0` or higher (`npm install -g pnpm`)
3. **Rust Toolchain**: `v1.83.0` or higher ([rustup](https://rustup.rs/))
4. **Rust WASM Target**:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```
5. **wasm-pack**:
   ```bash
   cargo install wasm-pack
   ```

---

### Step-by-Step Installation

```bash
# 1. Clone repository
git clone https://github.com/Buddhilive/buddhi-ai-sandbox.git
cd buddhi-ai-sandbox

# 2. Install monorepo dependencies
pnpm install

# 3. Build the Rust WebAssembly core package
cd packages/wasm-core
wasm-pack build --target web --out-dir pkg
cd ../..

# 4. Build all TypeScript packages (SDK, Service Worker, Toolchain)
pnpm run build
```

---

### Running Tests

```bash
# Run Rust WebAssembly Core tests (Cargo)
pnpm test:wasm
# Or directly: cd packages/wasm-core && cargo test

# Run unit tests across all packages (Vitest)
pnpm test:unit

# Run end-to-end browser tests (Playwright Chromium)
pnpm test:e2e
```

---

### Running the Interactive Browser Demo

The demo application showcases writing scripts, streaming stdout/stderr, and previewing web applications:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The Vite server automatically serves the required `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers for `SharedArrayBuffer` execution.

---

## Basic Usage

```typescript
import { Sandbox } from '@buddhilive/sandbox';

// 1. Initialize sandbox
const sandbox = await Sandbox.create();

// 2. Write code to the virtual filesystem
await sandbox.fs.writeFile('/workspace/hello.js', `
  console.log("Hello from inside the client-side Node.js Sandbox!");
  console.log("Process version:", process.version);
`);

// 3. Spawn process and stream output
const proc = await sandbox.process.spawn('node', ['/workspace/hello.js']);
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}

const exitCode = await proc.exit;
console.log('Finished with exit code:', exitCode);

// 4. Dispose sandbox when finished
await sandbox.dispose();
```

---

## API Reference

### 1. `Sandbox`

The top-level orchestrator managing Web Worker lifecycles, memory quotas, and communication bridges.

#### `Sandbox.create(options?: SandboxOptions): Promise<Sandbox>`
Instantiates and boots an isolated WebAssembly sandbox execution worker.

```typescript
interface SandboxOptions {
  /** Maximum memory quota in MB (default: 512) */
  maxMemoryMb?: number;
  /** Default command timeout in milliseconds (default: 30000) */
  commandTimeoutMs?: number;
  /** Custom NPM registry URL (default: 'https://registry.npmjs.org') */
  registryUrl?: string;
  /** Persistence adapter for VirtualFS state ('opfs' | 'indexeddb' | null) */
  persistenceAdapter?: 'opfs' | 'indexeddb' | null;
  /** Custom URL or asset path to sandbox.worker.js */
  workerUrl?: string;
  /** Custom URL or asset path to buddhilive_sandbox_core_bg.wasm */
  wasmUrl?: string;
}
```

*Example:*
```typescript
const sandbox = await Sandbox.create({
  maxMemoryMb: 256,
  commandTimeoutMs: 15000,
  persistenceAdapter: 'opfs',
});
```

#### `sandbox.dispose(): Promise<void>`
Terminates the underlying Web Worker and releases all WebAssembly memory, ring buffers, and resources.

*Example:*
```typescript
await sandbox.dispose();
```

---

### 2. Filesystem API (`sandbox.fs`)

POSIX-compliant in-memory VirtualFS mounted at root `/`.

#### `sandbox.fs.writeFile(path: string, data: string | Uint8Array): Promise<void>`
Writes a UTF-8 string or binary buffer to the specified file path. Parent directories must exist or be created first.

```typescript
await sandbox.fs.writeFile('/workspace/config.json', JSON.stringify({ port: 3000 }));
await sandbox.fs.writeFile('/workspace/binary.dat', new Uint8Array([0x00, 0x01, 0x02]));
```

#### `sandbox.fs.readFile(path: string): Promise<Uint8Array>`
#### `sandbox.fs.readFile(path: string, encoding: 'utf-8'): Promise<string>`
Reads a file from the virtual filesystem as either binary `Uint8Array` or a UTF-8 decoded string.

```typescript
const text = await sandbox.fs.readFile('/workspace/config.json', 'utf-8');
const bytes = await sandbox.fs.readFile('/workspace/binary.dat');
```

#### `sandbox.fs.mkdir(path: string, options?: { recursive?: boolean }): Promise<void>`
Creates a directory in the virtual filesystem. `recursive` defaults to `true`.

```typescript
await sandbox.fs.mkdir('/workspace/src/components', { recursive: true });
```

#### `sandbox.fs.readdir(path: string): Promise<string[]>`
Returns an array of file and directory names contained within a directory.

```typescript
const entries = await sandbox.fs.readdir('/workspace');
console.log('Files:', entries); // ['hello.js', 'src']
```

#### `sandbox.fs.stat(path: string): Promise<FileStat>`
Retrieves metadata and status for a file or directory.

```typescript
interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
  mode: number;
}

const stat = await sandbox.fs.stat('/workspace/hello.js');
console.log(`Size: ${stat.size} bytes, isFile: ${stat.isFile}`);
```

#### `sandbox.fs.rm(path: string, options?: { recursive?: boolean }): Promise<void>`
Removes a file or directory. Set `recursive: true` to remove non-empty directories.

```typescript
await sandbox.fs.rm('/workspace/temp.txt');
await sandbox.fs.rm('/workspace/build', { recursive: true });
```

#### `sandbox.fs.symlink(target: string, path: string): Promise<void>`
Creates a symbolic link at `path` pointing to `target` (with a 40-hop cycle limit).

```typescript
await sandbox.fs.symlink('/workspace/src', '/workspace/link-to-src');
```

#### `sandbox.fs.setPersistenceAdapter(adapter: PersistenceAdapter | null): void`
Attaches or updates the storage persistence adapter (OPFS or IndexedDB) for synchronizing filesystem state.

---

### 3. Process Execution API (`sandbox.process`)

Executes commands and scripts inside the isolated sandbox environment with synchronous streaming I/O over `SharedArrayBuffer` ring buffers.

#### `sandbox.process.spawn(command: string, args?: string[], options?: { env?: Record<string, string>; cwd?: string }): Promise<ProcessHandle>`
Spawns a new process asynchronously and returns streaming stdio streams.

```typescript
interface ProcessHandle {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin: WritableStream<Uint8Array>;
  readonly exit: Promise<number>;
  kill(signal?: string): Promise<void>;
}
```

*Example:*
```typescript
const proc = await sandbox.process.spawn('node', ['/workspace/script.js'], {
  env: { NODE_ENV: 'production' },
  cwd: '/workspace',
});

// Stream stdout to console or terminal UI
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
(async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value));
  }
})();

// Wait for process exit
const exitCode = await proc.exit;
console.log('Process exited with:', exitCode);
```

#### `sandbox.process.exec(commandLine: string): Promise<ProcessExecResult>`
Convenience wrapper that runs a command line, buffers all `stdout` and `stderr` output, and resolves with the complete result once the process exits.

```typescript
interface ProcessExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

*Example:*
```typescript
const result = await sandbox.process.exec('node /workspace/hello.js');
console.log('Output:', result.stdout);
console.log('Errors:', result.stderr);
console.log('Exit Code:', result.exitCode);
```

#### `sandbox.process.kill(pid: number, signal?: string): Promise<void>`
Sends a termination signal to an active process by PID.

```typescript
await sandbox.process.kill(proc.pid, 'SIGTERM');
```

---

### 4. Port & Preview API (`sandbox.ports`)

Detects virtual network servers created within the sandbox (e.g. `http.createServer().listen(port)`) and wires them to live browser `<iframe>` previews via Service Worker interception at `/__preview/:port/`.

#### `sandbox.ports.on(event: 'listen' | 'close', listener: (event: ListenEvent) => void): () => void`
Registers a listener for virtual port lifecycle events. Returns an unsubscribe cleanup callback.

```typescript
interface ListenEvent {
  port: number;
  url: string; // e.g. "http://localhost:5173/__preview/3000/"
}
```

*Example:*
```typescript
// Subscribe to port events
const unsubscribe = sandbox.ports.on('listen', ({ port, url }) => {
  console.log(`Port ${port} is live at: ${url}`);
  previewIframe.src = url;
});

sandbox.ports.on('close', ({ port }) => {
  console.log(`Port ${port} closed`);
});

// Later: cleanup subscription
unsubscribe();
```

#### `sandbox.ports.off(event: 'listen' | 'close', listener: PortListener): void`
Removes an active listener callback for port events.

#### `sandbox.ports.getPreviewUrl(port: number): string | undefined`
Returns the preview URL currently active for the given virtual port number, or `undefined` if not listening.

```typescript
const url = sandbox.ports.getPreviewUrl(3000);
```

---

### 5. In-Sandbox Node.js Runtime Environment

When running scripts via `node`, the sandbox provides standard Node.js global variables and built-in modules:

#### Global Variables
- **`console`**: `log`, `info`, `warn`, `error` (synchronously streamed to `stdout` and `stderr` through atomic SPSC ring buffers).
- **`process`**:
  - `process.version` (`'v20.12.0'`)
  - `process.platform` (`'browser-wasm'`)
  - `process.pid` (virtual process ID)
  - `process.cwd()` (defaults to `'/workspace'`)
  - `process.env` (environment variables)
  - `process.stdout.write(str)` / `process.stderr.write(str)`
  - `process.exit(code)`

#### Built-in Modules (`require` / `node:`)
- **`fs` / `node:fs`**: Synchronous and asynchronous (`promises`) filesystem methods (`writeFileSync`, `readFileSync`, `readdirSync`, `statSync`, `existsSync`, `mkdirSync`, `unlinkSync`, and `fs.promises.*`).
- **`path` / `node:path`**: `join`, `resolve`, `basename`, `dirname`, `extname`.
- **`http` / `node:http`**: `http.createServer((req, res) => { ... }).listen(port, callback)`.
- **Module Resolution**: CommonJS `require(...)` supports relative workspace files (`require('./utils')`) and installed packages (`require('lodash')` from `/node_modules`).

---

### 6. Error Classes

The SDK exports dedicated error classes for granular runtime error inspection:

```typescript
import { SandboxError, OOMError } from '@buddhilive/sandbox';

try {
  await sandbox.process.exec('node /workspace/large-memory.js');
} catch (err) {
  if (err instanceof OOMError) {
    console.error('WebAssembly memory limit exceeded:', err.message);
  } else if (err instanceof SandboxError) {
    console.error(`Sandbox error [${err.code}]:`, err.message);
  }
}
```

## Distribution

For guidelines on packaging, versioning, and publishing to the NPM registry and public CDNs, refer to [DISTRIBUTION.md](DISTRIBUTION.md).

---

## License

MIT © [BuddhiAI](LICENSE)
