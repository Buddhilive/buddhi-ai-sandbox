# Implementation Plan: Next.js & Full-Stack Vibe Coding Support

**Branch**: `004-nextjs-fullstack-vibe-coding` | **Date**: 2026-09-11 | **Spec**: [spec.md](file:///C:/DevDojo/Buddhi/buddhi-ai-sandbox/.buddhi/specs/004-nextjs-fullstack-vibe-coding/spec.md)

**Input**: Feature specification from `/.buddhi/specs/004-nextjs-fullstack-vibe-coding/spec.md`

---

## Summary

Enable full-stack and Next.js vibe coding inside `buddhi-ai-sandbox` across three foundational pillars:
1. **Persistent Server Process Lifecycle**: Prevent Web Worker processes running HTTP servers (`http.createServer().listen(port)`) from immediately posting `process:exit` and closing stdio ring buffers upon initial script evaluation; maintain active process execution and log streaming until `process.kill(pid)` or `server.close()`.
2. **Automated Service Worker Port Bridge (`sandbox-sw`)**: When `server.listen(port)` is invoked in the Web Worker, establish and pass a `MessagePort` channel through `@buddhilive/sandbox` to `@buddhilive/sandbox-sw`, registering the port so that incoming browser requests to `/__preview/:port/*` route to the worker's `http:request` handler.
3. **Next.js Virtual Toolchain Dev Runner & VFS Packages**: In `packages/toolchain-bundle`, provide a prebundled Next.js environment in VFS (unpacking/resolving `next`, `react`, and `react-dom` shims) and intercept `spawn('next', ['dev'])` (and `spawn('npm', ['run', 'dev'])`) in the worker process runner to spin up a live, esbuild-backed virtual Next.js dev server.

---

## Technical Context

**Language/Version**: TypeScript 5.4+, Rust 1.83+ (`wasm32-unknown-unknown`), Node.js >= 20.0.0
**Primary Dependencies**: `esbuild-wasm`, `@buddhilive/sandbox` (SDK), `@buddhilive/sandbox-sw` (Service Worker), `@buddhilive/sandbox-toolchain` (Toolchain Bundle)
**Storage**: In-memory VFS (`buddhilive-sandbox-core` Rust WASM POSIX filesystem)
**Testing**: Vitest (`pnpm --filter=@buddhilive/sandbox run test:unit`), Cargo (`pnpm test:wasm`), Playwright (`pnpm --filter=@buddhilive/sandbox run test:e2e`)
**Target Platform**: Modern web browsers with WebAssembly, Web Workers, Service Workers, `SharedArrayBuffer`, and Cross-Origin Isolation (`COOP: same-origin`, `COEP: require-corp`)
**Project Type**: Multi-package monorepo (pnpm workspace) client-side SDK & Web Worker runtime
**Performance Goals**:
- Port registration and preview bridge establishment: < 50ms
- Next.js dev server boot to port listening: < 2.5s
- Service worker request-to-response latency: < 50ms overhead
**Constraints**:
- Main thread isolation: 0 blocking operations on main thread; UI at 60 FPS
- No external cloud servers or VM dependencies: 100% zero-backend client-side execution
- Cross-Origin Isolation preservation: all iframe previews must preserve COOP/COEP

---

## AGENTS.md Compliance Check

*GATE: Must pass before execution.*

- [x] **Project build & test commands adhered to**: `pnpm build`, `pnpm --filter=@buddhilive/sandbox run test:unit`, `pnpm --filter=@buddhilive/sandbox run typecheck`.
- [x] **Architectural constraints respected**: All execution remains inside Web Workers and Service Workers; main thread only acts as coordinator; `SharedArrayBuffer` stdio streaming preserved.
- [x] **No unapproved external dependencies introduced**: Leverages existing `esbuild-wasm`, internal `http` shims, `MessageChannel`, and `BroadcastChannel`.

---

## Project Structure

### Documentation (this feature)

```text
.buddhi/specs/004-nextjs-fullstack-vibe-coding/
├── spec.md              # Feature specification
├── plan.md              # This architecture & technical plan
└── tasks.md             # Tasks by user story (/tasks workflow)
```

### Source Code Touched

```text
packages/
├── sdk/
│   ├── src/
│   │   ├── ports-namespace.ts           # Intercepts port:listen, registers port + MessagePort with Service Worker
│   │   ├── process-namespace.ts         # Handles process lifecycle, signals, and kill
│   │   ├── types.ts                     # Protocol types for port:register, port:listen, and worker messages
│   │   └── worker/
│   │       ├── sandbox.worker.ts        # Long-running process event loop tracking & 'next' / 'npm' command dispatch
│   │       └── shims/
│   │           ├── http.ts              # Server.listen() MessagePort creation, active server tracking, port:listen event
│   │           └── events.ts            # EventEmitter shims for server lifecycles
│   └── tests/
│       └── unit/
│           ├── process-server-lifecycle.test.ts # Tests keeping server process alive & graceful kill
│           └── ports-sw-bridge.test.ts          # Tests automatic port registration & message forwarding
├── service-worker/
│   └── src/
│       ├── sw.ts                        # Added 'message' listener for port:register with MessagePort transfer
│       ├── reconnect.ts                 # Extended handshake for main-thread & worker reconnection
│       ├── port-registry.ts             # PortRegistry with MessagePort references
│       └── request-bridge.ts            # bridgeRequest dispatching to portEntry.messagePort
└── toolchain-bundle/
    └── src/
        ├── index.ts                     # ToolchainBundle entrypoint with NextDevServer exports
        ├── esbuild-compiler.ts          # Page / App router bundling
        ├── next-runtime.ts              # Next.js environment installer (prebundled shims in VFS)
        └── next-dev-server.ts           # Virtual Next.js dev server with HTTP listener, routing, and HMR
```

---

## Architectural Design & Deep Dive

### 1. Process Lifecycle & Event Loop (Keep Server Alive)

**Problem**:
In `sandbox.worker.ts`, synchronous execution of `runner(virtualConsole, virtualProcess, virtualRequire, Buffer)` is followed immediately by:
```ts
closeRingBuffer(sabStdout);
closeRingBuffer(sabStderr);
self.postMessage({ type: 'process:exit', pid, code: 0 });
processes.delete(pid);
```
This forces any HTTP server (`http.createServer().listen(port)`) to exit on tick 0.

**Solution**:
1. Associate each running process (`ProcessContext`) with an `activeServers: Set<Server>` and `activeHandles: number`.
2. When `http.Server.prototype.listen()` is called:
   - Add the server to the process context.
   - Listen for the server's `'close'` event.
3. After `runner()` completes synchronously:
   - Check if `proc.activeServers.size > 0` or `activeHttpServers.size > 0` or `proc.activeHandles > 0`.
   - If active handles exist: **DO NOT** post `process:exit` and **DO NOT** close stdio ring buffers. Set `proc.isListening = true`.
4. When `server.close()` fires:
   - Remove the server from `proc.activeServers`.
   - If no more active servers/handles remain:
     - Close stdio ring buffers (`closeRingBuffer(sabStdout)`, `closeRingBuffer(sabStderr)`).
     - Post `{ type: 'process:exit', pid, code: 0 }`.
     - Remove `processes.delete(pid)`.
5. When `process:kill` is received on worker:
   - Close any associated servers (`for (const s of proc.activeServers) s.close();`).
   - Close stdio ring buffers.
   - Post `{ type: 'process:exit', pid, code: 130 }`.
   - Remove `processes.delete(pid)`.

---

### 2. Service Worker Integration & Request Bridging (`sandbox-sw`)

**Problem**:
`packages/service-worker` has `bridgeRequest` which expects `portEntry.messagePort` to send `{ type: 'http:request' }`, but:
- `reconnect.ts` only listened to `BroadcastChannel` (which cannot transfer `MessagePort`s).
- `sw.ts` had no `self.addEventListener('message')` handler for receiving transferred `MessagePort`s.
- `ports-namespace.ts` on the main thread never talked to `navigator.serviceWorker`.

**Solution**:
1. **Worker-side `Server.listen()`**:
   - Create a `MessageChannel` for the listening port.
   - Keep `channel.port1` inside the worker; attach listener:
     ```ts
     channel.port1.onmessage = (event) => {
       const msg = event.data;
       if (msg.type === 'http:request') {
         server.dispatchRequest({
           method: msg.method,
           path: msg.path,
           headers: msg.headers,
           body: msg.body,
           replyPort: msg.replyPort
         });
       }
     };
     ```
   - Post to main thread: `self.postMessage({ type: 'port:listen', port, bridgePort: channel.port2 }, [channel.port2])`.
2. **Main Thread (`PortsNamespace`)**:
   - When receiving `{ type: 'port:listen', port, bridgePort }`:
     - If `navigator.serviceWorker && navigator.serviceWorker.controller`:
       ```ts
       navigator.serviceWorker.controller.postMessage(
         { type: 'port:register', port },
         [bridgePort]
       );
       ```
     - If service worker is still waiting or registering, attach `navigator.serviceWorker.ready.then(reg => reg.active?.postMessage(...))` to guarantee delivery.
   - When receiving `port:close`:
     - Send `{ type: 'port:unregister', port }` to `navigator.serviceWorker.controller`.
3. **Service Worker (`sw.ts`)**:
   - Add `message` listener:
     ```ts
     self.addEventListener('message', (event) => {
       const { type, port } = event.data || {};
       if (type === 'port:register' && typeof port === 'number') {
         const messagePort = event.ports && event.ports[0];
         globalPortRegistry.register(port, messagePort);
       } else if (type === 'port:unregister' && typeof port === 'number') {
         globalPortRegistry.unregister(port);
       }
     });
     ```
   - In `bridgeRequest`:
     When request comes to `/__preview/:port/*`:
     Forward to `portEntry.messagePort`. `ServerResponse` in worker flushes chunks and ends response back across `replyPort`.

---

### 3. Next.js Virtual Toolchain Dev Runner & VFS Packages

**Problem**:
Spawning `sb.process.spawn('next', ['dev'])` or `spawn('npm', ['run', 'dev'])` currently hits line 822 of `sandbox.worker.ts` and exits with a mock message `Command 'next' executed`.

**Solution**:
1. **Next.js Virtual Environment (`packages/toolchain-bundle/src/next-runtime.ts`)**:
   - Provides `installNextShims(vfs)`:
     Populates `/workspace/node_modules/next`, `/workspace/node_modules/react`, and `/workspace/node_modules/react-dom` with lightweight package manifests and runtime export shims (e.g. `next/link`, `next/image`, `next/navigation`, `react/jsx-runtime`, `react-dom/server`).
2. **Next.js Dev Server (`packages/toolchain-bundle/src/next-dev-server.ts`)**:
   - Scans `/workspace` for Next.js project structure:
     - App router: `app/page.tsx`, `app/layout.tsx`, `app/api/...`
     - Pages router: `pages/index.tsx`, `pages/_app.tsx`, `pages/api/...`
   - Uses `EsbuildCompiler` (from `esbuild-compiler.ts`) to transform TSX/JSX components.
   - Boots a virtual `http.Server` via `http.createServer()`:
     - Serves standard HTML skeleton with bundled React payload.
     - Routes `/api/*` to API handler functions.
     - Serves static assets from `/workspace/public`.
     - Injects HMR script connected to `/__preview/hmr`.
   - Calls `server.listen(port || 3000)`.
   - Emits build logs to `stdout`:
     ```
       ▲ Next.js 14.2.0 (Buddhi Sandbox)
       - Local:        http://localhost:3000
       ✓ Ready in 1.4s
     ```
3. **Worker Command Dispatch**:
   - In `sandbox.worker.ts`:
     When `command === 'next'` or (`command === 'npm' && args[0] === 'run' && args[1] === 'dev'`):
     Initialize toolchain Next dev server in the worker context, run server, keep process alive.

---

## Complexity Tracking

| Violation / Trade-off | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Transferring `MessagePort` through Main Thread to Service Worker | Web Workers cannot post directly to `ServiceWorkerGlobalScope` without transferable channel | Pure `BroadcastChannel` cannot transfer `MessagePort`s, leading to 503 fallback |
| Lightweight in-worker Next.js runner instead of full Node `next` binary | Full Next.js binary requires child processes, native SWC binaries, and multi-gigabyte node_modules | Unfeasible in zero-backend browser environment; esbuild-wasm + shims provides < 100KB footprint and instant startup |
