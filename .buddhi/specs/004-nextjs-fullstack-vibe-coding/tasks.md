# Tasks: Next.js & Full-Stack Vibe Coding Support

**Feature Branch**: `004-nextjs-fullstack-vibe-coding`
**Specification**: [.buddhi/specs/004-nextjs-fullstack-vibe-coding/spec.md](file:///C:/DevDojo/Buddhi/buddhi-ai-sandbox/.buddhi/specs/004-nextjs-fullstack-vibe-coding/spec.md)
**Implementation Plan**: [.buddhi/specs/004-nextjs-fullstack-vibe-coding/plan.md](file:///C:/DevDojo/Buddhi/buddhi-ai-sandbox/.buddhi/specs/004-nextjs-fullstack-vibe-coding/plan.md)

---

## Phase 1: Setup & Prerequisite Validation

**Purpose**: Baseline verification of current tests and monorepo packages before changes.

- [x] T001 Run baseline typecheck and tests across `packages/sdk` via `pnpm --filter=@buddhilive/sandbox run typecheck` and `pnpm --filter=@buddhilive/sandbox run test:unit`
- [x] T002 [P] Verify monorepo package configuration and exports in `packages/sdk/package.json`, `packages/service-worker/package.json`, and `packages/toolchain-bundle/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared protocol types and message handlers that underpin all user stories.

**⚠️ CRITICAL**: No user story implementation can begin until foundational message channels and types are defined.

- [x] T003 [P] Update protocol interfaces in `packages/sdk/src/types.ts` to include `bridgePort?: MessagePort` in `port:listen` and `WorkerOutboundMessage`
- [x] T004 [P] Add Service Worker message event listener in `packages/service-worker/src/sw.ts` to receive `{ type: 'port:register', port }` and store `event.ports[0]` into `globalPortRegistry`

**Checkpoint**: Protocol types and service worker message receptor ready.

---

## Phase 3: User Story 1 - Long-Running HTTP Server Process Lifecycle (Priority: P1) 🎯 MVP

**Goal**: Web Worker processes running scripts that invoke `http.createServer().listen(port)` must stay alive, keep stdio ring buffers open, and only terminate on `process.kill(pid)` or `server.close()`.

**Independent Test**: Spawn a node process running an HTTP server. Verify the process stays active without posting `process:exit` immediately, streams stdout logs, and terminates cleanly when killed.

### Tests for User Story 1

- [x] T005 [P] [US1] Create unit test in `packages/sdk/tests/unit/process-server-lifecycle.test.ts` asserting persistent process execution when `listen()` is called and clean exit on `kill()`

### Implementation for User Story 1

- [x] T006 [US1] Update `packages/sdk/src/worker/shims/http.ts` to track active server instances, assign process ownership, and emit `'close'` lifecycle events
- [x] T007 [US1] Update process execution runner in `packages/sdk/src/worker/sandbox.worker.ts`:
  - Track `activeServers` on the process handle
  - Do NOT close stdio ring buffers or post `process:exit` if an active server is listening after script evaluation
  - In `server.close()`, exit the process if no active servers/handles remain
  - In `process:kill`, close all servers, close ring buffers, post `process:exit` with exit code 130, and clean up process state
- [x] T008 [US1] Run unit test `pnpm --filter=@buddhilive/sandbox test tests/unit/process-server-lifecycle.test.ts` and confirm it passes

**Checkpoint**: User Story 1 functional - HTTP server processes stay alive and terminate gracefully.

---

## Phase 4: User Story 2 - Automated Service Worker Port Registration & Bridge (Priority: P1)

**Goal**: When `server.listen(port)` is called inside the worker, `@buddhilive/sandbox` automatically registers the port and establishes a `MessagePort` bridge with `@buddhilive/sandbox-sw` so `/__preview/:port/*` routes to the worker's HTTP handler.

**Independent Test**: Start a virtual HTTP server on port 3000. Send a preview request and verify it routes to the worker handler and returns the virtual server response.

### Tests for User Story 2

- [x] T009 [P] [US2] Create unit test in `packages/sdk/tests/unit/ports-sw-bridge.test.ts` verifying automatic `MessagePort` transfer to the Service Worker and request dispatching

### Implementation for User Story 2

- [x] T010 [US2] Update `packages/sdk/src/worker/shims/http.ts` on `server.listen(port)`:
  - Create a `MessageChannel` for the port
  - Attach listener on `channel.port1` to dispatch incoming `http:request` events to `server.dispatchRequest(...)`
  - Post `channel.port2` to main thread in `self.postMessage({ type: 'port:listen', port, bridgePort: channel.port2 }, [channel.port2])`
- [x] T011 [US2] Update `packages/sdk/src/ports-namespace.ts` on receiving `port:listen`:
  - Automatically forward `bridgePort` to `navigator.serviceWorker.controller` via `postMessage({ type: 'port:register', port }, [bridgePort])`
  - On `port:close`, send `postMessage({ type: 'port:unregister', port })`
- [x] T012 [US2] Update `packages/service-worker/src/sw.ts` and `packages/service-worker/src/request-bridge.ts`:
  - Register transferred `MessagePort` in `globalPortRegistry`
  - Ensure chunked and completed responses stream through `replyPort` without gateway timeouts
- [x] T013 [US2] Run tests `pnpm --filter=@buddhilive/sandbox test tests/unit/ports-sw-bridge.test.ts` and `pnpm --filter=@buddhilive/sandbox test tests/unit/ports.test.ts` to confirm pass

**Checkpoint**: User Stories 1 AND 2 functional - live servers stay alive and preview requests route seamlessly.

---

## Phase 5: User Story 3 - Next.js Virtual Toolchain Dev Runner & VFS Packages (Priority: P2)

**Goal**: Provide prebundled Next.js runtime environment in VFS and route `sb.process.spawn('next', ['dev'])` or `spawn('npm', ['run', 'dev'])` to an esbuild-backed virtual dev server.

**Independent Test**: Create an `app/page.tsx` file in VFS. Spawn `next dev`. Verify port 3000 starts, compiles the TSX page, and serves rendered HTML.

### Tests for User Story 3

- [x] T014 [P] [US3] Create unit test in `packages/toolchain-bundle/tests/next-dev-server.test.ts` testing Next.js VFS environment installation, TSX compilation, and route serving

### Implementation for User Story 3

- [x] T015 [P] [US3] Implement `packages/toolchain-bundle/src/next-runtime.ts` providing `installNextShims(vfs)` to populate `/workspace/node_modules/next`, `react`, and `react-dom` package manifests and shims
- [x] T016 [US3] Implement `packages/toolchain-bundle/src/next-dev-server.ts`:
  - Discover `app/page.tsx` / `pages/index.tsx` entrypoints
  - Compile with `EsbuildCompiler`
  - Bind virtual `http.Server` on port 3000
  - Serve HTML wrapper + client bundle and route `/api/*`
  - Integrate with `globalHmrServer` for file change re-bundling
- [x] T017 [US3] Export `NextRuntime` and `NextDevServer` in `packages/toolchain-bundle/src/index.ts`
- [x] T018 [US3] Update command dispatch in `packages/sdk/src/worker/sandbox.worker.ts`:
  - Intercept `next` and `npm run dev` commands
  - Launch `NextDevServer` via `ToolchainBundle`
  - Stream build logs to `stdout` ring buffer and keep process alive
- [x] T019 [US3] Run `pnpm --filter=@buddhilive/sandbox-toolchain test` or vitest on `next-dev-server.test.ts` to confirm pass

**Checkpoint**: All user stories functional - Next.js full-stack vibe coding works in browser sandbox.

---

## Phase 6: Polish & Full Verification

**Purpose**: Typechecks, integration validation, and full workspace build.

- [x] T020 [P] Typecheck all packages (`pnpm --filter=@buddhilive/sandbox run typecheck` and workspace typechecks)
- [x] T021 Run all SDK unit tests (`pnpm --filter=@buddhilive/sandbox run test:unit`)
- [x] T022 Build full monorepo workspace (`pnpm run build`)
