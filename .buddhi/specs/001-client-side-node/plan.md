# Implementation Plan: Client-Side Node.js Sandbox NPM SDK

**Branch**: `001-client-side-node` | **Date**: 2026-09-09 | **Spec**: [spec.md](file:///e:/Projects/buddhi-ai-sandbox/.buddhi/specs/001-client-side-node/spec.md)

**Input**: Feature specification from `.buddhi/specs/001-client-side-node/spec.md`

---

## Summary

Build `@buddhilive/sandbox` — a published NPM package that lets browser applications
instantiate a fully functional Node.js-compatible execution environment without any
backend infrastructure. The core is a custom Rust WASM module embedding the QuickJS
interpreter for JS execution, a POSIX-compatible in-memory virtual filesystem (VirtualFS),
a virtual process table (ProcessManager), and a virtual TCP port registry (PortManager).
The TypeScript SDK wraps the WASM Worker with a clean async API (`sandbox.fs.*`,
`sandbox.process.*`, `sandbox.ports.*`). A registered Service Worker bridges virtual
HTTP servers to `<iframe>`-accessible preview URLs at `/__preview/:port/`. Package
installation fetches NPM registry tarballs via `browser fetch()`, extracts them with
`fflate` into VirtualFS, and resolves modules via a custom Node.js-compatible resolver.
A lazy-loaded `ToolchainBundle` (Python + Clang compiled to WASM) handles native builds
only on demand.

---

## Technical Context

**Language/Version**: Rust 1.78+ (WASM core) · TypeScript 5.4+ (SDK, Service Worker)

**Primary Dependencies**:
- `wasm-bindgen` + `wasm-pack` (Rust → WASM + JS bindings)
- `qjs-rs` / `quickjs-wasm-rs` (QuickJS interpreter embedded in Rust WASM)
- `fflate` (browser-native gzip + tar extraction, ~10KB gzipped)
- `vite` + `vite-plugin-dts` (SDK bundler, lib mode, dual ESM/CJS output)
- `vitest` + `@playwright/test` (unit + browser E2E testing)

**Storage**: In-memory (default) · OPFS (Origin Private File System, opt-in) · IndexedDB (opt-in fallback)

**Testing**: `cargo test` for Rust WASM unit tests · `vitest` for SDK unit/integration · `Playwright` for browser E2E

**Target Platform**: Modern evergreen browsers (Chrome 92+, Firefox 93+, Safari 15.2+, Edge 92+) with COOP/COEP enabled; WASM32 target

**Project Type**: NPM library (monorepo with 4 packages)

**Performance Goals**:
- Sandbox ready in ≤ 1,500 ms (warm cache)
- Core bundle ≤ 15 MB compressed
- Preview request latency ≤ 25 ms
- Host UI thread ≥ 60 FPS throughout

**Constraints**:
- `SharedArrayBuffer` requires COOP/COEP headers on host page
- WASM memory capped at 4 GB by browser (handle OOM gracefully)
- No synchronous DOM access from WASM Worker
- NPM registry CORS must be handled (configurable mirror URL)

**Scale/Scope**: Single-user browser session; concurrent sandbox instances per tab; designed for web IDEs and interactive tutorial platforms

---

## AGENTS.md Compliance Check

*GATE: Must pass before implementation begins. Re-check after architecture is finalised.*

- [x] **Build commands**: `pnpm install` (workspace) · `wasm-pack build` (Rust) · `pnpm build` (TS SDK) · no server-side or backend infra
- [x] **Architectural constraints**: All execution in Web Workers (FR-002); main thread never blocks; WASM core never touches DOM
- [x] **External dependencies**: `fflate`, `qjs-rs`, `wasm-bindgen`, `vite`, `vitest`, `playwright` — all well-maintained, permissively licensed (MIT/Apache-2.0), no unapproved additions

---

## Architectural Decisions (System-Design)

### Decision 1 — JS Execution Model Inside WASM

**Problem**: WASM cannot `fork()`. Each "process" spawned in the sandbox needs an execution context.

| Option | Gains | Costs | Decision |
|--------|-------|-------|----------|
| **One WASM Worker per process** | True OS-level isolation | High memory/startup overhead; 1 Worker boot per `spawn()` call; cannot share VirtualFS state easily | ❌ Rejected |
| **QuickJS embedded in Rust WASM** (selected) | Single Worker; cheap per-process overhead; QuickJS is small (~700KB uncompressed); shares VirtualFS state in Rust memory | Not V8; some ES2022+ features need polyfilling; incompatible with native addons (P4) | ✅ Selected |
| **Full V8 via WASM** | Widest JS compatibility | ~30MB binary; violates SC-002 (≤15MB); extremely slow startup | ❌ Rejected |

**Chosen**: QuickJS interpreter embedded in the Rust WASM binary via `qjs-rs`. Each
`spawn()` creates a new QuickJS context within the same WASM instance, running on the
single dedicated Web Worker thread. The `ToolchainBundle` (P4) provides native build
execution separately in its own secondary Worker.

---

### Decision 2 — Worker ↔ Main Thread I/O Bridge

**Problem**: `require()`, `fs.readFileSync()`, and synchronous Node.js APIs require
blocking reads from within the QuickJS JS context running in the WASM Worker, while the
main thread SDK must still receive streaming stdout/stderr without blocking.

| Option | Gains | Costs | Decision |
|--------|-------|-------|----------|
| **SharedArrayBuffer + Atomics** (selected) | Enables synchronous fs/process APIs (readFileSync, require); SAB ring buffer gives low-latency streaming I/O | Requires COOP/COEP headers on host; slightly more complex setup | ✅ Selected |
| **Async postMessage only** | No COOP/COEP requirement | Cannot support `*Sync` Node.js APIs; `require()` breaks; SDK API no longer Node-compatible | ❌ Rejected |

**SAB Layout (per process)**:
```
 Offset  Size   Purpose
 0       4      Flags (0=empty, 1=data, 2=closed) [Atomics target]
 4       4      Write head (uint32)
 8       4      Read head (uint32)
 12      4      Data length (uint32)
 16      N      Ring buffer data region (default N = 65536 bytes)
```
Two SABs per process: one for `stdout`, one for `stderr`. `stdin` uses a third SAB
(reversed direction: main thread writes, Worker reads via `Atomics.wait()`).

---

### Decision 3 — Preview URL Scheme

**Problem**: Expose virtual HTTP servers to `<iframe>` without a real backend.

| Option | Gains | Costs | Decision |
|--------|-------|-------|----------|
| **Subdomain `<id>.sandbox.internal`** | Clean URL isolation per sandbox | Requires wildcard DNS; not reliable in all browsers without a real domain; SW scope issues | ❌ Rejected |
| **Path-scoped `/__preview/:port/`** (selected) | Works with a single Service Worker scope; reliable cross-browser; no DNS setup | Slightly less URL isolation, but acceptable for a same-origin preview | ✅ Selected |

---

## Project Structure

### Documentation (this feature)

```text
.buddhi/specs/001-client-side-node/
├── spec.md              # Feature specification (/specify output)
├── plan.md              # This file (/plan output)
└── tasks.md             # Actionable task breakdown (/tasks output — not yet created)
```

### Source Code (repository root — pnpm monorepo)

```text
buddhi-ai-sandbox/                        # pnpm workspace root
├── package.json                          # workspace: ["packages/*"]
├── pnpm-workspace.yaml
├── .npmrc                                # shamefully-hoist=true
│
├── packages/
│   │
│   ├── wasm-core/                        # Rust WASM package — the execution engine
│   │   ├── Cargo.toml                    # crate: buddhilive-sandbox-core
│   │   ├── src/
│   │   │   ├── lib.rs                    # wasm_bindgen entry points
│   │   │   ├── vfs/
│   │   │   │   ├── mod.rs               # VirtualFS public API
│   │   │   │   ├── inode.rs             # Inode table (HashMap<u64, INode>)
│   │   │   │   ├── file.rs              # FileNode: buffer, metadata, permissions
│   │   │   │   └── symlink.rs           # Symlink resolution logic
│   │   │   ├── process/
│   │   │   │   ├── mod.rs               # ProcessManager: spawn/kill/table
│   │   │   │   ├── context.rs           # QuickJS context wrapper per process
│   │   │   │   ├── io.rs                # stdin/stdout/stderr SAB ring-buffer I/O
│   │   │   │   └── resolver.rs          # Node.js require() module resolver
│   │   │   ├── ports/
│   │   │   │   ├── mod.rs               # PortManager: virtual TCP listen/close
│   │   │   │   └── http.rs             # HTTP request/response demux over MessageChannel
│   │   │   └── error.rs                 # SandboxError, OOMError types
│   │   ├── build.rs                      # wasm-pack build script hooks
│   │   └── pkg/                          # wasm-pack output (gitignored)
│   │
│   ├── sdk/                              # TypeScript SDK — the NPM-published package
│   │   ├── package.json                  # name: @buddhilive/sandbox
│   │   ├── vite.config.ts               # lib mode, dual ESM/CJS, vite-plugin-dts
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                 # Public exports: Sandbox, types
│   │   │   ├── sandbox.ts               # Sandbox class: create(), dispose()
│   │   │   ├── worker-bridge.ts         # Worker spawn, SAB init, postMessage protocol
│   │   │   ├── fs-namespace.ts          # sandbox.fs.* proxy over postMessage
│   │   │   ├── process-namespace.ts     # sandbox.process.* + ProcessHandle
│   │   │   ├── ports-namespace.ts       # sandbox.ports.* EventEmitter
│   │   │   ├── npm-installer.ts         # npm install: registry fetch + tarball extract
│   │   │   ├── module-resolver.ts       # Client-side Node.js require() resolution
│   │   │   ├── worker/
│   │   │   │   └── sandbox.worker.ts   # Web Worker entry: loads WASM, handles messages
│   │   │   └── types.ts                 # SandboxOptions, ProcessHandle, FileStat, etc.
│   │   ├── tests/
│   │   │   ├── unit/                    # vitest unit tests (mocked Worker)
│   │   │   └── e2e/                     # Playwright browser E2E tests
│   │   └── dist/                        # build output (gitignored)
│   │
│   ├── service-worker/                   # Service Worker package
│   │   ├── package.json                  # name: @buddhilive/sandbox-sw
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── sw.ts                    # SW entry: fetch intercept + port routing
│   │   │   ├── port-registry.ts         # Map<port, WorkerPort> for preview routing
│   │   │   ├── request-bridge.ts        # HTTP req → MessageChannel → WASM → response
│   │   │   └── reconnect.ts             # SW restart reconnection handshake
│   │   └── dist/
│   │       └── sw.js                    # Built SW script (consumer registers this)
│   │
│   └── toolchain-bundle/                 # Lazy-loaded native build toolchain (P4)
│       ├── package.json                  # name: @buddhilive/sandbox-toolchain
│       ├── src/
│       │   ├── index.ts                 # ToolchainBundle class: load() + detect()
│       │   ├── python.ts                # Python WASM runtime wrapper (CPython → WASM)
│       │   ├── clang.ts                 # Clang/Musl WASM wrapper
│       │   └── node-gyp-runner.ts       # node-gyp execution orchestrator
│       └── wasm/                         # Pre-built Python + Clang WASM blobs
│           ├── python.wasm              # CPython compiled to WASM (~8MB)
│           └── clang-musl.wasm          # Clang + Musl libc (~20MB, lazy-loaded)
│
├── apps/
│   └── sandbox-demo/                     # Vite demo app for E2E testing
│       ├── index.html
│       └── src/
│           └── main.ts                  # Imports @buddhilive/sandbox, runs demos
│
└── .buddhi/
    └── specs/001-client-side-node/
        ├── spec.md
        └── plan.md  ← this file
```

---

## Implementation Phases

### Phase 0 — Monorepo Scaffold & Toolchain Bootstrap (P1 prerequisite)

**Goal**: Create the pnpm workspace, configure Rust + wasm-pack build pipeline, and
produce a "hello from WASM" stub that proves the end-to-end build works.

**Files to create**:
- `package.json` (root workspace)
- `pnpm-workspace.yaml`
- `packages/wasm-core/Cargo.toml` + `packages/wasm-core/src/lib.rs` (stub)
- `packages/sdk/package.json` + `packages/sdk/vite.config.ts`
- `packages/sdk/src/worker/sandbox.worker.ts` (stub: loads WASM, sends `ready`)
- `packages/sdk/src/sandbox.ts` (stub: `Sandbox.create()` → resolves on `ready`)

**Build pipeline**:
```bash
# Install Rust wasm32 target
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Build WASM core
cd packages/wasm-core && wasm-pack build --target no-modules --out-dir pkg

# Build SDK
cd packages/sdk && pnpm build
```

**Verification**: `Sandbox.create()` resolves from a Vite dev app.

---

### Phase 1 — VirtualFS & Core Process Execution (P1 — User Story 1)

**Goal**: Implement VirtualFS in Rust and QuickJS-based process execution. Allow
`sandbox.fs.writeFile()` + `sandbox.process.spawn('node', [...])` to work end-to-end.

**Key implementations**:

1. **VirtualFS** (`packages/wasm-core/src/vfs/`):
   - `HashMap<u64, INode>` inode table keyed by inode number
   - `INode` variants: `File { data: Vec<u8>, meta: FileMeta }`, `Directory { children: HashMap<String, u64> }`, `Symlink { target: String }`
   - POSIX operations exposed via `#[wasm_bindgen]`: `read_file`, `write_file`, `mkdir`, `readdir`, `rm`, `stat`, `symlink`
   - Path resolution: walk inode tree, follow symlinks (max 40 hops, ELOOP otherwise)

2. **SAB I/O Bridge** (`packages/wasm-core/src/process/io.rs`):
   - `StdioRingBuffer` struct: wraps a `SharedArrayBuffer` view, lock-free SPSC ring buffer
   - Write side (WASM): write bytes, `Atomics.notify()` on flag slot
   - Read side (main thread): `Atomics.waitAsync()` on flag slot, drain ring buffer into `ReadableStream`

3. **QuickJS Process Context** (`packages/wasm-core/src/process/context.rs`):
   - Each `spawn()` call creates a `QuickJsContext` wrapping a `qjs_rs::Context`
   - Node.js built-in stubs: `process.stdout.write` → SAB stdout write; `process.stderr.write` → SAB stderr write; `process.exit(code)` → postMessage `{type:'exit', pid, code}`
   - `require()` stub: calls `ProcessManager.resolve_module()` which reads from VirtualFS

4. **ProcessManager** (`packages/wasm-core/src/process/mod.rs`):
   - `HashMap<u32, ProcessEntry>` process table keyed by PID
   - `spawn(cmd, args, sab_stdout, sab_stderr, sab_stdin) -> u32` returns PID
   - `kill(pid)` terminates the QuickJS context

5. **SDK TypeScript layer**:
   - `ProcessHandle`: `{ pid, stdout: ReadableStream, stderr: ReadableStream, stdin: WritableStream, exit: Promise<number> }`
   - `sandbox.process.spawn()` → postMessage `{type:'spawn', ...}` → Worker responds with `{type:'spawned', pid, sabStdout, sabSterr, sabStdin}` → SDK wraps SABs in streams

**Verification**: `sandbox.process.spawn('node', ['/hello.js'])` emits `"Hello"` on `stdout` stream; exit code `0` resolves from `exit` promise.

---

### Phase 2 — Service Worker HTTP Preview Bridge (P2 — User Story 2)

**Goal**: When Node.js code calls `.listen(3000)`, expose `/__preview/3000/` as a
Service Worker-intercepted URL that forwards HTTP to the WASM virtual server.

**Key implementations**:

1. **PortManager** (`packages/wasm-core/src/ports/`):
   - `HashMap<u16, PortEntry>` mapping port number to a `MessagePort` for HTTP dispatch
   - `listen(port)` → posts `{type:'port:listen', port}` to main thread → main thread forwards to Service Worker via `BroadcastChannel`
   - `close(port)` → posts `{type:'port:close', port}`

2. **Service Worker** (`packages/service-worker/src/sw.ts`):
   - On `fetch` event: match URL path `/^\\/__preview\\/(\\d+)(\\/.*)/`
   - Extract port, look up `portRegistry.get(port)` for the `MessagePort` to the WASM Worker
   - Create `MessageChannel`, post `{type:'http:request', method, url, headers, body, replyPort}` to Worker's `MessagePort`
   - Return `new Response(stream)` using `TransformStream` filled by replies from the Worker

3. **Request bridge** (`packages/service-worker/src/request-bridge.ts`):
   - `bridgeRequest(port, request): Promise<Response>` handles body streaming
   - On no registered port or worker gone: return `new Response(null, { status: 503 })`

4. **SW ↔ Worker reconnection** (`packages/service-worker/src/reconnect.ts`):
   - On SW `activate` event: broadcast `{type:'sw:ready'}` via `BroadcastChannel('sandbox-sw')`
   - Worker listens on same channel, re-registers all active ports on receipt

5. **SDK PortManager namespace** (`packages/sdk/src/ports-namespace.ts`):
   - `EventEmitter`-style: `sandbox.ports.on('listen', ({port, url}) => ...)`
   - `url` value: `window.location.origin + '/__preview/' + port + '/'`

**Verification**: `http.createServer((_, res) => res.end('ok')).listen(3000)` → `sandbox.ports.on('listen')` fires → `fetch('/__preview/3000/')` returns `"ok"` with status 200.

---

### Phase 3 — NPM Package Installation & Module Resolution (P3 — User Story 3)

**Goal**: Implement `npm install <pkg>` that fetches from registry, extracts tarball
into VirtualFS, and makes it available to `require()`.

**Key implementations**:

1. **NPM Installer** (`packages/sdk/src/npm-installer.ts`):
   - `install(pkg: string, version = 'latest'): Promise<void>`
   - Step 1: `fetch('https://registry.npmjs.org/{pkg}')` → parse `dist-tags.latest` → get `dist.tarball` URL
   - Step 2: `fetch(tarball)` → `Response.body` piped through `DecompressionStream('gzip')` → `fflate.untar()` to get file entries
   - Step 3: For each entry: `sandbox.fs.writeFile('/node_modules/' + entry.name, entry.data)`
   - Step 4: Update `/package.json` `dependencies` field
   - CORS: `registry.npmjs.org` returns `access-control-allow-origin: *` — direct fetch is safe; configurable via `SandboxOptions.registryUrl`

2. **Module Resolver** (`packages/sdk/src/module-resolver.ts` + `packages/wasm-core/src/process/resolver.rs`):
   - Node.js resolution algorithm: `require('lodash')` → check `/node_modules/lodash/package.json` `exports`/`main` → fall back to `index.js`
   - Symlink resolution via VirtualFS `stat` + `readlink` calls
   - ESM `import` statements: resolved at parse time by QuickJS module loader hook

3. **`process.exec()` shorthand** (`packages/sdk/src/process-namespace.ts`):
   - `exec(cmd): Promise<{stdout, stderr, exitCode}>` — buffers full output, returns when exit

4. **Symlink support** (VirtualFS `packages/wasm-core/src/vfs/symlink.rs`):
   - `symlink(target, path)`: create `INode::Symlink { target }` at path
   - `resolve_path(path)`: walk path components, follow `Symlink` nodes up to 40 hops

**Verification**: `sandbox.process.exec('npm install lodash')` → exit 0 → script `const _ = require('lodash'); console.log(_.VERSION)` prints version string.

---

### Phase 4 — Native Build Toolchain (P4 — User Story 4)

**Goal**: Lazy-load Python + Clang WASM when `npm install` detects `binding.gyp` or
native lifecycle hooks. Execute `node-gyp` within the virtual environment.

**Key implementations**:

1. **Toolchain detection** (`packages/sdk/src/npm-installer.ts`):
   - After extracting tarball: if `binding.gyp` exists in package root, emit `{type:'toolchain:needed'}` event
   - `ToolchainBundle.load()` downloads `@buddhilive/sandbox-toolchain` chunk on demand

2. **ToolchainBundle** (`packages/toolchain-bundle/src/index.ts`):
   - `load(): Promise<void>` → dynamic `import()` of Python WASM and Clang WASM chunks
   - Initializes Python interpreter WASM instance in a **secondary Worker** (isolated from the main sandbox Worker to prevent OOM contamination)
   - `run(cmd, args): Promise<{stdout, stderr, exitCode}>`

3. **node-gyp runner** (`packages/toolchain-bundle/src/node-gyp-runner.ts`):
   - Invokes Python with `node-gyp configure` then `node-gyp build`
   - Maps compiler output paths to VirtualFS paths
   - On unsupported syscall or asm: catches WASM trap → writes diagnostic to stderr → exits with code 1 → removes incomplete `build/` directory

4. **Progress events**:
   - SDK emits `sandbox.on('toolchain:download-start', {bytesTotal})` and `sandbox.on('toolchain:download-progress', {bytesLoaded})` for host UI progress bars

**Verification**: `npm install bcrypt` → toolchain download event fires → Python + Clang WASM load → `node-gyp` compiles → `require('bcrypt')` succeeds.

---

### Phase 5 — Edge Case Hardening & Resource Limits

**Goal**: Implement OOM handling, non-terminating loop kill, COOP/COEP header injection,
and configurable resource limits.

**Key implementations**:

1. **OOM Guard** (`packages/wasm-core/src/error.rs`):
   - Rust `#[global_allocator]` custom allocator that tracks WASM heap usage
   - On allocation failure: `throw_val(JsValue::from("OOMError"))` → Worker posts `{type:'error', kind:'OOM'}` → SDK rejects with `OOMError`

2. **Process kill / infinite loop** (`packages/sdk/src/worker/sandbox.worker.ts`):
   - `sandbox.process.kill(pid)` → postMessage `{type:'kill', pid}` to Worker
   - Worker terminates the QuickJS context synchronously (QuickJS supports `JS_SetInterruptHandler` for polling-based interrupt)
   - WASM Worker is never terminated itself — only the QuickJS context for that PID

3. **COOP/COEP header injection** (`packages/service-worker/src/sw.ts`):
   - On `fetch` event for same-origin non-preview requests: add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers so preview iframes inherit isolation

4. **SandboxOptions resource limits** (`packages/sdk/src/types.ts`):
   ```typescript
   interface SandboxOptions {
     maxMemoryMb?: number;         // default: 512
     commandTimeoutMs?: number;    // default: 30_000
     registryUrl?: string;         // default: 'https://registry.npmjs.org'
     persistenceAdapter?: 'opfs' | 'indexeddb' | null; // default: null (ephemeral)
   }
   ```

---

## API Surface (TypeScript)

```typescript
// Main public API
export class Sandbox {
  static create(options?: SandboxOptions): Promise<Sandbox>;
  readonly fs: VirtualFSNamespace;
  readonly process: ProcessNamespace;
  readonly ports: PortsNamespace;
  on(event: 'toolchain:download-start' | 'toolchain:download-progress' | 'error', cb: Function): this;
  dispose(): Promise<void>;
}

export interface ProcessHandle {
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exit: Promise<number>;
}

export interface SandboxOptions {
  maxMemoryMb?: number;
  commandTimeoutMs?: number;
  registryUrl?: string;
  persistenceAdapter?: 'opfs' | 'indexeddb' | null;
}

// Namespaces
interface VirtualFSNamespace {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<FileStat>;
  symlink(target: string, path: string): Promise<void>;
}

interface ProcessNamespace {
  spawn(cmd: string, args?: string[], opts?: SpawnOptions): ProcessHandle;
  exec(cmd: string, opts?: SpawnOptions): Promise<ExecResult>;
  kill(pid: number): void;
}

interface PortsNamespace {
  on(event: 'listen', cb: (info: { port: number; url: string }) => void): this;
  on(event: 'close', cb: (info: { port: number }) => void): this;
}
```

---

## postMessage Protocol (Worker ↔ Main Thread)

```typescript
// Main → Worker
{ type: 'spawn', pid: number, cmd: string, args: string[], sabStdout: SharedArrayBuffer, sabStderr: SharedArrayBuffer, sabStdin: SharedArrayBuffer }
{ type: 'kill', pid: number }
{ type: 'fs:write', path: string, data: Uint8Array }
{ type: 'fs:read', id: string, path: string }
{ type: 'fs:readdir', id: string, path: string }
{ type: 'fs:mkdir', path: string, recursive: boolean }
{ type: 'fs:rm', path: string, recursive: boolean }
{ type: 'fs:stat', id: string, path: string }
{ type: 'fs:symlink', target: string, path: string }

// Worker → Main
{ type: 'ready' }
{ type: 'spawned', pid: number }
{ type: 'exit', pid: number, code: number }
{ type: 'port:listen', port: number }
{ type: 'port:close', port: number }
{ type: 'fs:read:result', id: string, data: Uint8Array }
{ type: 'fs:readdir:result', id: string, entries: string[] }
{ type: 'fs:stat:result', id: string, stat: FileStat }
{ type: 'error', kind: 'OOM' | 'CRASH', message: string }
```

---

## Build & Publish Configuration

```toml
# packages/wasm-core/Cargo.toml (key sections)
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1

[features]
default = ["quickjs"]
toolchain = ["python-wasm", "clang-wasm"]   # only in toolchain-bundle
```

```typescript
// packages/sdk/vite.config.ts (key sections)
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (fmt) => `sandbox.${fmt}.js`,
    },
    rollupOptions: {
      external: [],          // bundle everything including WASM binary
    },
  },
  plugins: [dts({ insertTypesEntry: true })],
  worker: { format: 'es' },  // inline worker as blob URL
});
```

---

## Verification Plan

### Automated Tests

| Layer | Command | Coverage |
|-------|---------|----------|
| Rust WASM unit | `cd packages/wasm-core && cargo test` | VirtualFS ops, path resolution, symlinks, SAB ring buffer |
| SDK unit | `cd packages/sdk && pnpm test` | Sandbox.create(), ProcessHandle streams, fs namespace, PortManager events |
| Browser E2E (Playwright) | `pnpm test:e2e` | Full P1–P3 acceptance scenarios in real Chrome/Firefox/Safari |
| Bundle size check | `pnpm build && du -sh packages/sdk/dist/*.wasm` | Assert ≤ 15MB compressed |

### E2E Scenario Coverage

- **P1-S2**: Write `hello.js`, spawn node, assert stdout = `"Hello from sandbox\n"`, exit = 0
- **P1-S3**: spawn with `process.exit(1)`, assert exit = 1, stderr non-empty
- **P2-S2**: Listen on 3000, `fetch('/__preview/3000/')`, assert body + status 200
- **P2-S3**: Server crashes mid-request → assert 502 response, no browser hang
- **P3-S1**: `exec('npm install lodash')` → assert `/node_modules/lodash` exists, exit 0
- **P3-S2**: `require('lodash')` → assert no resolution error
- **P3-S3**: `npm install non-existent-pkg-404` → assert non-zero exit, stderr contains "404"

### Manual Verification

- Install `@buddhilive/sandbox` from a local `npm pack` in a fresh Vite app → confirm `Sandbox.create()` resolves within 1,500ms on warm cache
- Confirm host UI thread stays at 60 FPS during script execution (Chrome DevTools Performance panel)
- Confirm COOP/COEP headers are present on preview iframe responses (Network panel)

---

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| pnpm monorepo (4 packages) | Rust WASM, TypeScript SDK, Service Worker, and native toolchain have distinct build pipelines (wasm-pack vs Vite vs SW bundler) | A single package would require a custom build orchestrator; wasm-pack and Vite cannot be unified without complex glue |
| QuickJS embedded in Rust WASM | Need per-process JS execution inside a single WASM Worker; QuickJS is the only embeddable engine under the 15MB budget | One Worker per process (V8-backed) exceeds memory budget and startup time; WASM-compiled V8 is 30MB+ |
| SharedArrayBuffer + Atomics | `require()` and `fs.*Sync()` Node.js APIs require synchronous reads from within the QuickJS interpreter thread | Async-only postMessage cannot satisfy synchronous Node.js fs/require semantics |
