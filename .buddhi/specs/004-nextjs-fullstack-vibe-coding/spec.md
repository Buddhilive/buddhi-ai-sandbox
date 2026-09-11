# Feature Specification: Next.js & Full-Stack Vibe Coding Support

**Feature Branch**: `004-nextjs-fullstack-vibe-coding`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "To properly support Next.js / full-stack vibe coding, buddhi-ai-sandbox (and specifically your packages/toolchain-bundle / worker) should handle: 1. Process Lifecycle (Keep Server Alive), 2. Service Worker Integration (sandbox-sw), 3. Toolchain / Package Management (npm & next)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Long-Running HTTP Server Process Lifecycle (Priority: P1)

Developers building full-stack applications run scripts that start HTTP servers via Node's `http.createServer().listen(port)`. The sandbox must maintain the active process in the Web Worker, keeping stdio ring buffers open and emitting runtime console output, rather than immediately terminating upon synchronous script execution completion.

**Why this priority**: Without persistent process lifecycles, any web server script (Express, Next.js, raw Node HTTP) instantly exits, making previewing web applications impossible.

**Independent Test**:
Spawn a Node process running `http.createServer((req, res) => res.end('hello')).listen(3000)`. Verify the process does not post `process:exit`, remains running, and writes subsequent logs to `stdout`.

**Acceptance Scenarios**:
1. **Given** a script calling `http.createServer().listen(port)`, **When** executed via `sandbox.process.spawn('node', ['server.js'])`, **Then** the process remains in running state beyond initial execution tick without posting `process:exit`.
2. **Given** a running server process, **When** `process.kill(pid)` is invoked on the main thread, **Then** the worker closes stdio ring buffers, emits `process:exit` with exit code 130, and frees process memory.
3. **Given** an active server instance, **When** `server.close()` is called in worker code and no other active listeners/servers exist, **Then** the worker terminates the process and emits `process:exit` with code 0.

---

### User Story 2 - Automated Service Worker Port Registration & Bridge (Priority: P1)

When a virtual HTTP server starts listening inside the worker, the sandbox must automatically register the port with the service worker (`@buddhilive/sandbox-sw`) and establish a direct communication channel (`MessagePort` / request bridge), enabling incoming browser requests to `/__preview/:port/*` to route directly into the worker's HTTP request handler.

**Why this priority**: Users need live previews of their running servers in browser iframes. The service worker must be synchronized automatically when ports open and close without manual developer glue code.

**Independent Test**:
Start a virtual HTTP server on port 3000. Send a fetch request to `/__preview/3000/`. Verify the service worker routes the request to the worker's `http:request` handler and returns the response with correct headers and status code.

**Acceptance Scenarios**:
1. **Given** a virtual HTTP server listening on port 3000 in the worker, **When** `server.listen(3000)` executes, **Then** `@buddhilive/sandbox` registers port 3000 with the Service Worker and connects a request bridge channel.
2. **Given** an active port registration, **When** the browser navigates to `/__preview/3000/api/health`, **Then** `sandbox-sw` intercepts the fetch event, bridges it to the virtual HTTP server, and returns the response with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
3. **Given** a registered port, **When** the server closes or the process is killed, **Then** the SDK unregisters the port from `sandbox-sw` and subsequent requests return 503 Service Unavailable.

---

### User Story 3 - Next.js Toolchain Dev Runner & VFS Packages (Priority: P2)

Full-stack vibe coding requires running modern web frameworks like Next.js inside the browser sandbox. `packages/toolchain-bundle` provides a prebundled virtual Next.js runtime environment (with `node_modules` manifests/shims for `next`, `react`, `react-dom`) and intercepts `spawn('next', ['dev'])` or `spawn('npm', ['run', 'dev'])` to execute an esbuild-backed virtual dev server that serves compiled pages and handles live reloading.

**Why this priority**: Allows Next.js projects to run entirely in-browser with zero backend dependencies, enabling instant full-stack vibe coding.

**Independent Test**:
Create a minimal Next.js project layout (`/workspace/app/page.tsx` or `/workspace/pages/index.tsx`). Run `sandbox.process.spawn('next', ['dev'])`. Verify port 3000 opens, toolchain compiles the page with esbuild, and `/__preview/3000/` renders the React component output.

**Acceptance Scenarios**:
1. **Given** a Next.js project in VFS, **When** `sandbox.process.spawn('next', ['dev'])` is called, **Then** the worker dispatches to the toolchain bundle rather than stubbing out command execution.
2. **Given** the toolchain dev server is initializing, **When** `node_modules` are resolved, **Then** the VFS provides prebundled stubs/runtimes for `next`, `react`, and `react-dom` so imports resolve cleanly.
3. **Given** a running Next dev server, **When** a source file in `/workspace` changes, **Then** the toolchain detects the change via `fs:external_change`, re-compiles the bundle, and emits an HMR update.

---

### Edge Cases

- **Multiple servers in a single process**: A script opens multiple ports (e.g. 3000 and 8080). The process must stay alive until *all* servers are closed.
- **Port collision**: A script tries to listen on a port already in use. It must emit an `EADDRINUSE` error event on the server instance.
- **Worker termination while requests are pending**: In-flight requests must return a 504 Gateway Timeout or 503 Service Unavailable rather than hanging forever.
- **Service worker not ready during `listen`**: If the service worker is not yet registered/activated, the SDK must queue or retry port registration once the service worker activates.
- **Large request/response payloads**: Requests with JSON bodies, multi-part data, or streaming chunked responses must correctly bridge across `MessagePort` channels.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Web Worker execution context MUST track active event loop handles (including active `http.Server` instances and open sockets) and refrain from terminating the process while handles remain open.
- **FR-002**: Web Worker MUST keep `sabStdout` and `sabStderr` ring-buffers open and writable throughout the entire lifetime of a long-running process.
- **FR-003**: Web Worker MUST terminate the process, close stdio ring-buffers, and emit `process:exit` when `process.kill(pid)` is received or when all active servers/handles close.
- **FR-004**: Virtual `http.Server.listen()` MUST emit `port:listen` containing the port number and initialize ready state.
- **FR-005**: SDK `PortsNamespace` and Worker Bridge MUST automatically intercept `port:listen` and transfer port registration with request-handling capabilities to `sandbox-sw`.
- **FR-006**: Service worker (`@buddhilive/sandbox-sw`) MUST accept port registration containing a communication channel (`MessagePort`) directly from the SDK main thread.
- **FR-007**: Service worker `bridgeRequest` MUST forward incoming HTTP requests (`method`, `url`, `headers`, `body`) over the registered channel to the worker's `http:request` handler.
- **FR-008**: Virtual `ServerResponse` in worker MUST stream response status, headers, and data chunks back through the bridge channel to resolve the service worker `fetch` event.
- **FR-009**: Virtual `http.Server.close()` and process termination MUST emit `port:close`, prompting SDK and Service Worker to unregister the port.
- **FR-010**: `packages/toolchain-bundle` MUST provide a prebundled Next.js runtime environment containing virtual package manifests and shims for `next`, `react`, and `react-dom`.
- **FR-011**: Worker process dispatcher MUST intercept `next` and `npm run dev` commands, routing execution to the toolchain's virtual dev server instead of executing placeholder stubs.
- **FR-012**: The toolchain Next dev server MUST compile TSX/JSX project entrypoints using `esbuild` and host them via a virtual `http.Server` listening on port 3000.
- **FR-013**: The toolchain dev server MUST subscribe to VFS file change events (`fs:external_change`) and trigger fast rebuilds and HMR broadcasts.

### Key Entities

- **ProcessHandle**: Represents an executing process in the worker, tracking `pid`, `killed` status, active servers, stdio SABs, and exit status.
- **VirtualHttpServer**: In-worker HTTP server instance maintaining port binding, request listeners, and socket emulation.
- **PortRegistration**: Service worker record associating a port number with an active `MessagePort` and request dispatch callback.
- **ToolchainDevServer**: Virtual Next.js development server running inside the worker, orchestrating `esbuild` compilation, static assets, and SSR/client HTML rendering.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Node script starting an `http.Server` stays alive for > 30 seconds without premature exit, emitting logs on demand.
- **SC-002**: Direct fetch to `/__preview/:port/` resolves with status 200 and expected payload within 500ms when a virtual server is listening.
- **SC-003**: Spawning `next dev` boots the dev server on port 3000 within 2.5 seconds using prebundled toolchain assets.
- **SC-004**: Stopping the server with `proc.kill()` shuts down the port, unregisters it from the Service Worker, and emits `process:exit` with code 130 within 100ms.
- **SC-005**: 100% pass rate on all existing and new unit/integration tests across `packages/sdk`, `packages/service-worker`, and `packages/toolchain-bundle`.

---

## Assumptions

- **Browser Environment**: Target browser supports `SharedArrayBuffer`, `MessageChannel`, `ServiceWorker`, and Web Workers with Cross-Origin Isolation headers.
- **Virtual Next.js Scope**: The in-worker Next.js dev server focuses on standard Next.js App/Pages router patterns (React SSR + client hydration, API routes, static pages) compiled via in-bundle `esbuild`, without requiring native Node binary bindings.
- **Package Prebundling**: Essential runtime packages (`next`, `react`, `react-dom`) are bundled into `packages/toolchain-bundle` or unpacked into VFS on demand.
