# Tasks: File Change Listener API for Sandbox File System

**Branch**: `003-change-listener-api` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Phase 1: Setup & Foundational Types (Blocking Prerequisites)

**Purpose**: Core types, protocol messages, and public exports required before any user story implementation.

- [x] T001 Define `FileChangeType`, `FileChangeEvent`, `FileChangeListener`, and add `fs:change` to `WorkerOutboundMessage` in `packages/sdk/src/types.ts`
- [x] T002 Export `FileChangeType`, `FileChangeEvent`, and `FileChangeListener` from public SDK entry point `packages/sdk/src/index.ts`
- [x] T003 Scaffold unit test suite structure in `packages/sdk/test/fs-change-listener.test.ts`

**Checkpoint**: Core types defined and exported; test suite scaffold ready.

---

## Phase 2: User Story 1 — Host SDK File Change Event Subscription (Priority: P1) 🎯 MVP

**Goal**: Deliver a working MVP allowing host applications to subscribe to `sb.fs.on('change', ...)` and receive `'create'`, `'update'`, and `'delete'` events for operations initiated via the SDK (`sb.fs.writeFile`, `sb.fs.mkdir`, `sb.fs.rm`), with unsubscription support.

**Independent Test**: Register a listener via `sb.fs.on('change', ...)`, invoke `sb.fs.writeFile`, update the file, and `sb.fs.rm`. Assert correct event payloads and verify that invoking the returned unsubscribe function stops event delivery.

- [x] T004 [US1] Implement `onFsChange(listener)` and `offFsChange(listener)` in `packages/sdk/src/worker-bridge.ts` to receive `fs:change` messages from worker
- [x] T005 [US1] Implement `.on('change', listener)` and `.off('change', listener)` with cleanup return function in `packages/sdk/src/fs-namespace.ts`
- [x] T006 [US1] Implement `emitFsChangeEvent` and node existence checks (`create` vs `update`) for `fs:write`, `fs:mkdir`, and `fs:rm` handlers in `packages/sdk/src/worker/sandbox.worker.ts`
- [x] T007 [US1] Implement and run unit tests for Story 1 in `packages/sdk/test/fs-change-listener.test.ts`

**Checkpoint**: User Story 1 is fully functional and testable independently as the standalone MVP.

---

## Phase 3: User Story 2 — Worker & Guest Process Mutation Propagation (Priority: P1)

**Goal**: Ensure file mutations initiated by in-worker guest processes (e.g. Node.js scripts using `fs.writeFileSync`, `fs.promises.writeFile`, `fs.mkdirSync`, `fs.unlinkSync`, `fs.rmdirSync`) propagate across the worker bridge and trigger host change listeners.

**Independent Test**: Execute a guest Node.js script via `sb.process.spawn('node', ...)` that creates, updates, and deletes files, asserting that `sb.fs.on('change', ...)` fires matching events on the main thread.

- [x] T008 [US2] Wire `emitFsChangeEvent` into internal Node.js shim methods (`fs.writeFileSync`, `fs.promises.writeFile`, `fs.mkdirSync`, `fs.unlinkSync`, `fs.rmdirSync`) in `packages/sdk/src/worker/sandbox.worker.ts`
- [x] T009 [US2] Implement and run unit tests verifying guest process file change propagation in `packages/sdk/test/fs-change-listener.test.ts`

**Checkpoint**: Both host-driven and guest-driven mutations propagate reliably to host listeners.

---

## Phase 4: User Story 3 — Recursive Directory Mutation & Path Normalization (Priority: P2)

**Goal**: Guarantee all dispatched paths are canonical absolute POSIX paths, and ensure recursive directory deletions emit granular delete events for all affected child entries before emitting for the directory itself.

**Independent Test**: Create `/nested/dir/file.txt`, invoke `sb.fs.rm('/nested', { recursive: true })`, and assert delete events are dispatched for `/nested/dir/file.txt`, `/nested/dir`, and `/nested`. Test relative path arguments like `'./foo/bar.txt'` emit normalized `'/foo/bar.txt'`.

- [x] T010 [US3] Implement POSIX path canonicalization utility (`normalizePosixPath`) for all emitted change events in `packages/sdk/src/worker/sandbox.worker.ts`
- [x] T011 [US3] Implement recursive child deletion traversal in `packages/sdk/src/worker/sandbox.worker.ts` to emit delete events for descendant entries on recursive removal
- [x] T012 [US3] Implement and run unit tests for recursive directory deletions and path normalization in `packages/sdk/test/fs-change-listener.test.ts`

**Checkpoint**: Nested directory deletions and unnormalized path inputs emit accurate, canonical events.

---

## Phase 5: User Story 4 — Multiple Listeners & Error Isolation (Priority: P2)

**Goal**: Support multiple concurrent listeners on `sb.fs.on('change', ...)` with error isolation ensuring an uncaught error in one listener callback does not affect others, and ensure clean teardown on `sb.dispose()`.

**Independent Test**: Register two listeners where the first throws an Error. Trigger a file mutation, assert the second listener executes normally and the operation succeeds. Call `sb.dispose()` and verify no dangling listeners remain.

- [x] T013 [US4] Add safe execution (`try...catch`) around listener callbacks in `packages/sdk/src/worker-bridge.ts`
- [x] T014 [US4] Ensure `sb.dispose()` clears all registered change listeners in `packages/sdk/src/sandbox.ts` and `packages/sdk/src/worker-bridge.ts`
- [x] T015 [US4] Implement and run unit tests for multiple listeners, error isolation, and teardown in `packages/sdk/test/fs-change-listener.test.ts`

**Checkpoint**: Multiple listeners work reliably with full error isolation and leak-free lifecycle cleanup.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Validate type correctness, full test suite pass rate, and package build integrity.

- [x] T016 Run typecheck across the SDK (`pnpm --filter=@buddhilive/sandbox run typecheck`)
- [x] T017 Run full Vitest test suite (`pnpm --filter=@buddhilive/sandbox run test:unit`)
- [x] T018 Build monorepo packages to ensure clean production bundles (`pnpm run build`)

---

## Dependencies & Execution Order

### Phase Dependencies
- **Phase 1 (Setup & Types)**: No dependencies — starts immediately.
- **Phase 2 (User Story 1 - MVP)**: Depends on Phase 1 completion.
- **Phase 3 (User Story 2)**: Depends on Phase 2 completion (builds upon `emitFsChangeEvent` and bridge routing).
- **Phase 4 (User Story 3)**: Depends on Phase 2 & 3 completion.
- **Phase 5 (User Story 4)**: Depends on Phase 2 completion.
- **Phase 6 (Polish & Verification)**: Depends on all user stories being complete.

---

## Parallel Execution Opportunities

- T001 and T002 can be implemented together as foundational types.
- T004 (`worker-bridge.ts`) and T005 (`fs-namespace.ts`) touch separate files and can be authored together.
- T013 and T014 can be developed in parallel with Story 3 tasks.
