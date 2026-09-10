# Tasks: Full Next.js 16 Support in buddhi-ai-sandbox

**Feature**: Full Next.js 16 Support (Dev & Prod)  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Branch**: `002-enhance-buddhi-sandbox`

---

## Phase 1: Setup & Dependencies

**Purpose**: Establish workspace dependencies, bundle tooling, and target directory structure.

- [x] T001 Add `esbuild-wasm` and `wa-sqlite` dependencies to `packages/toolchain-bundle/package.json`
- [x] T002 [P] Create shims directory structure under `packages/sdk/src/worker/shims/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core Node.js emulation shims and worker runtime infrastructure that MUST be complete before any user story can execute.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Implement core synchronous utility shims in `packages/sdk/src/worker/shims/` (`events.ts`, `buffer.ts`, `string-decoder.ts`, `assert.ts`, `util.ts`, `os.ts`)
- [x] T004 [P] Implement WebCrypto, Stream, and Zlib shims in `packages/sdk/src/worker/shims/` (`crypto.ts`, `stream.ts`, `zlib.ts`)
- [x] T005 [P] Implement networking and threading stubs in `packages/sdk/src/worker/shims/` (`net.ts`, `tls.ts`, `child-process.ts`, `worker-threads.ts`)
- [x] T006 Extend types and message protocols in `packages/sdk/src/types.ts` (`maxMemoryMb: 1024`, `nextjsOptions`, `http:request`, `ws:connect`)
- [x] T007 Refactor `packages/sdk/src/worker/sandbox.worker.ts` to import modular shims and support extended `virtualRequire`

**Checkpoint**: Core Node.js standard library emulation ready — User Stories can now begin.

---

## Phase 3: User Story 1 — Run `next start` (Production Preview) (Priority: P1) 🎯 MVP

**Goal**: Enable running a Next.js production server from `.next/` output with live browser preview at `/__preview/:port/`.

**Independent Test**: Load a pre-built Next.js 16 app into VFS, spawn `node node_modules/.bin/next start`, and assert `GET /__preview/3000/` responds with HTTP 200 and server-rendered HTML.

### Tests for User Story 1
- [x] T008 [P] [US1] Unit tests for Node.js shims in `packages/sdk/tests/unit/node-shims.test.ts`
- [x] T009 [P] [US1] E2E Playwright test for production server in `packages/sdk/tests/e2e/nextjs-start.spec.ts`

### Implementation for User Story 1
- [x] T010 [US1] Implement full Virtual HTTP server and response handler in `packages/sdk/src/worker/shims/http.ts`
- [x] T011 [US1] Upgrade `packages/service-worker/src/request-bridge.ts` to route requests to active virtual HTTP server via `MessagePort`
- [x] T012 [US1] Update `packages/sdk/src/sandbox.ts` to support 1024 MB memory quota and log Next.js memory allocation warnings

**Checkpoint**: User Story 1 is functional — `next start` can serve pages through the Service Worker preview bridge.

---

## Phase 4: User Story 2 — Run `next dev` (Development Mode with HMR) (Priority: P1) 🎯 MVP

**Goal**: Enable `next dev` compilation using `esbuild-wasm` shim in place of `@next/swc`, with synthetic `fs.watch` and live HMR updates.

**Independent Test**: Start `next dev`, render home page, overwrite file via `sandbox.fs.writeFile`, and assert preview reflects changes within 3 seconds without full reload.

### Tests for User Story 2
- [x] T013 [P] [US2] Unit test for file watcher event emission in `packages/sdk/tests/unit/fs-watcher.test.ts`
- [x] T014 [P] [US2] E2E Playwright test for `next dev` and HMR in `packages/sdk/tests/e2e/nextjs-dev.spec.ts`

### Implementation for User Story 2
- [x] T015 [P] [US2] Implement `esbuild-compiler.ts` in `packages/toolchain-bundle/src/esbuild-compiler.ts` replicating SWC transform API
- [x] T016 [P] [US2] Implement `addon-interceptor.ts` in `packages/sdk/src/worker/shims/addon-interceptor.ts` to intercept `@next/swc`
- [x] T017 [P] [US2] Implement `fs-watcher.ts` in `packages/sdk/src/worker/shims/fs-watcher.ts` compatible with `chokidar`
- [x] T018 [US2] Connect `sandbox.fs` file mutations in `packages/sdk/src/worker/sandbox.worker.ts` to `fs-watcher` event triggers
- [x] T019 [US2] Implement `hmr-bridge.ts` in `packages/sdk/src/worker/shims/hmr-bridge.ts` and `hmr-injector.ts` in `packages/service-worker/src/hmr-injector.ts`

**Checkpoint**: User Story 2 is functional — `next dev` runs with live compilation and HMR updates.

---

## Phase 5: User Story 3 — React Server Components & Server Actions (Priority: P2)

**Goal**: Support React Server Components (RSC) streaming and Server Action invocations.

**Independent Test**: Load an async RSC reading from VFS, assert progressive streamed rendering of HTML and `text/x-component` wire payload.

### Tests for User Story 3
- [x] T020 [P] [US3] Unit test for chunked HTTP streaming in `packages/sdk/tests/unit/http-streaming.test.ts`

### Implementation for User Story 3
- [x] T021 [US3] Implement chunked response streaming in `packages/sdk/src/worker/shims/http.ts` (`ServerResponse.prototype.write`)
- [x] T022 [US3] Upgrade `packages/service-worker/src/request-bridge.ts` to stream response chunks via `ReadableStream`
- [x] T023 [US3] Support Server Action execution and revalidation in `packages/sdk/src/worker/shims/http.ts`

**Checkpoint**: User Story 3 is functional — RSC and Server Actions stream properly.

---

## Phase 6: User Story 4 — Middleware, i18n, `next/image` & `next/font` (Priority: P2)

**Goal**: Support Next.js Middleware routing, i18n redirects, and asset optimization shims.

**Independent Test**: Route through a `middleware.ts` redirect, assert i18n locale path resolution, and assert `next/image` served resized bitmap.

### Tests for User Story 4
- [x] T024 [P] [US4] Integration test for middleware redirects and i18n in `packages/sdk/tests/unit/nextjs-routing.test.ts`

### Implementation for User Story 4
- [x] T025 [P] [US4] Implement `image-processor.ts` in `packages/toolchain-bundle/src/image-processor.ts` using OffscreenCanvas
- [x] T026 [P] [US4] Implement font manifest resolver in `packages/sdk/src/worker/shims/font-resolver.ts`
- [x] T027 [US4] Implement middleware context execution and i18n headers in `packages/sdk/src/worker/shims/http.ts`

**Checkpoint**: User Story 4 is functional — Middleware, i18n, fonts, and images operate seamlessly.

---

## Phase 7: User Story 5 — SQLite Support via `wa-sqlite` (Priority: P3)

**Goal**: Provide in-sandbox SQLite database capabilities for Next.js API Routes and Server Components.

**Independent Test**: Install `better-sqlite3`, run an API route creating a table, inserting data, and returning query results.

### Tests for User Story 5
- [x] T028 [P] [US5] Unit test for SQLite database operations in `packages/sdk/tests/unit/sqlite.test.ts`

### Implementation for User Story 5
- [x] T029 [P] [US5] Implement `sqlite-runtime.ts` in `packages/toolchain-bundle/src/sqlite-runtime.ts` using `wa-sqlite`
- [x] T030 [US5] Register `better-sqlite3` native addon bridge in `packages/sdk/src/worker/shims/addon-interceptor.ts`

**Checkpoint**: User Story 5 is functional — full-stack Next.js apps can persist data in SQLite.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end integration, demo application update, and documentation.

- [x] T031 [P] Create Next.js 16 App Router demo template in `apps/sandbox-demo/src/templates/nextjs-app/`
- [x] T032 [P] Update demo application UI in `apps/sandbox-demo/src/App.tsx` with Next.js template selector
- [x] T033 Verify OOM error handling and clean worker termination on `sandbox.dispose()`
- [x] T034 Update `README.md` and documentation with Next.js configuration and quickstart guide
