# Implementation Plan: File Change Listener API for Sandbox File System

**Branch**: `003-change-listener-api` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/.buddhi/specs/003-change-listener-api/spec.md`

---

## Summary

Implement an event-driven file change listener API on the sandbox file system namespace (`sb.fs.on('change', ...)` and `sb.fs.off('change', ...)`). 

The Web Worker VFS layer acts as the single source of truth for all mutations. When any file or directory is created, modified, or removed—either via host SDK methods (`sb.fs.writeFile`, `sb.fs.mkdir`, `sb.fs.rm`) or inside running guest Node.js processes (`fs.writeFileSync`, `fs.promises.writeFile`, `fs.unlinkSync`, `fs.rmdirSync`, package extractions)—the worker dispatches an outbound bridge message `{ type: 'fs:change', path, changeType: 'create' | 'update' | 'delete' }`. `WorkerBridge` on the main thread catches these events and routes them to registered listeners on `FsNamespace`, with automatic path normalization, robust unsubscription, error isolation, and memory cleanup.

---

## Technical Context

**Language/Version**: TypeScript 5.4+, Rust 1.83+ (`wasm32-unknown-unknown`), Node.js >= 20.0.0

**Primary Dependencies**:
- Monorepo: `pnpm` workspaces
- SDK: `fflate` (decompression), `buddhilive-sandbox-core` (Rust WASM)
- Service Worker: Native Service Worker API, `MessageChannel`
- Testing: `vitest` (unit tests), `@playwright/test` (browser E2E)

**Storage**: In-memory POSIX VirtualFS with node hierarchy in Web Worker; optional OPFS/IndexedDB persistence.

**Testing**: Vitest for unit tests in `packages/sdk/test/fs-change-listener.test.ts`.

**Target Platform**: Modern Evergreen Browsers (Chrome >= 120, Firefox >= 120, Safari >= 17) with Cross-Origin Isolation (`COOP: same-origin`, `COEP: require-corp`).

**Project Type**: Multi-package client-side SDK & WebAssembly runtime monorepo.

**Performance Goals**:
- Host SDK file change event latency < 20ms from operation invocation.
- In-worker script mutation dispatch to host listener < 50ms.
- 0 main thread lag (fully asynchronous non-blocking dispatch).

**Constraints**:
- Main thread isolation: file watching hooks and VFS tree evaluation remain inside the Web Worker.
- Safe execution: uncaught exceptions inside consumer listeners must not crash other listeners or filesystem operations.
- Single source of truth: worker emits canonical events, avoiding duplicate or out-of-order events.

**Scale/Scope**: All file system operations in `packages/sdk` across host calls and guest Node processes.

---

## AGENTS.md Compliance Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Grounded Changes**: Edits grounded in existing source files (`packages/sdk/src/types.ts`, `packages/sdk/src/worker/sandbox.worker.ts`, `packages/sdk/src/worker-bridge.ts`, `packages/sdk/src/fs-namespace.ts`, `packages/sdk/src/sandbox.ts`).
- [x] **Main Thread Isolation**: File system state transitions and node traversal remain strictly inside the Web Worker; notifications communicated via `postMessage`.
- [x] **Cross-Origin Isolation**: No new workers or shared buffers required; existing cross-origin isolation maintained.
- [x] **Self-Contained Distribution**: No new external dependencies; bundled inline with `@buddhilive/sandbox`.
- [x] **Evidence-Based Verification**: Verification through `vitest` unit tests and typecheck via `pnpm run typecheck`.

---

## Project Structure

### Documentation (this feature)

```text
.buddhi/specs/003-change-listener-api/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0 research & single-source-of-truth architecture
├── data-model.md        # Phase 1 data models & protocol messages
├── quickstart.md        # Phase 1 developer quickstart guide
├── contracts/           # Phase 1 TypeScript interface contracts
│   └── fs-listener.ts
└── tasks.md             # Phase 2 task breakdown (to be created by /tasks)
```

### Source Code (repository root)

```text
packages/
└── sdk/
    ├── src/
    │   ├── types.ts                    # Add FileChangeEvent, FileChangeListener, WorkerOutboundMessage 'fs:change'
    │   ├── worker-bridge.ts            # Handle 'fs:change' messages & onFsChange() registration
    │   ├── fs-namespace.ts             # Expose .on('change', ...), .off('change', ...), dispatch loop
    │   ├── sandbox.ts                  # Cleanup fs listeners on dispose()
    │   └── worker/
    │       └── sandbox.worker.ts       # Track node existence ('create' vs 'update'), post 'fs:change' on writes, mkdir, rm
    └── test/
        └── fs-change-listener.test.ts  # Vitest suite covering SDK mutations, worker mutations, unsubscribe, error isolation
```

---

## Detailed Implementation Design

### 1. Protocol & Types (`packages/sdk/src/types.ts`)
Add:
```typescript
export type FileChangeType = 'create' | 'update' | 'delete';

export interface FileChangeEvent {
  path: string;
  type: FileChangeType;
}

export type FileChangeListener = (event: FileChangeEvent) => void;
```
Extend `WorkerOutboundMessage`:
```typescript
| { type: 'fs:change'; path: string; changeType: FileChangeType }
```

### 2. Worker Event Dispatching (`packages/sdk/src/worker/sandbox.worker.ts`)
- Implement `emitFsChangeEvent(path: string, type: 'create' | 'update' | 'delete')`:
  - Normalizes path using POSIX normalization (`/` prefix, collapse `//`, resolve `.` and `..`).
  - Calls `self.postMessage({ type: 'fs:change', path: normalizedPath, changeType: type })`.
  - Also triggers existing `notifyFsChange(path, type === 'delete' ? 'rename' : 'change')` for internal Node `fs.watch`.
- In `fs:write` and mock `fs.writeFileSync` / `fs.promises.writeFile`:
  - Check `const existed = !!resolveNode(path).node;`
  - Perform write to VFS.
  - Emit event with `existed ? 'update' : 'create'`.
- In `fs:mkdir` and mock `fs.mkdirSync`:
  - Emit event with `'create'`.
- In `fs:rm` and mock `fs.unlinkSync` / `fs.rmdirSync`:
  - If target is a directory and `recursive`:
    - Recursively collect all descendant paths depth-first.
    - Emit `'delete'` for each descendant file/subfolder.
  - Emit `'delete'` for the target path itself.

### 3. Worker Bridge Listener Routing (`packages/sdk/src/worker-bridge.ts`)
- Add listener set `private fsChangeListeners: Set<FileChangeListener> = new Set();`
- In `this.worker.onmessage`:
  ```typescript
  if (msg.type === 'fs:change') {
    const event: FileChangeEvent = { path: msg.path, type: msg.changeType };
    for (const listener of this.fsChangeListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WorkerBridge] Error in fs:change listener:', err);
      }
    }
  }
  ```
- Expose `onFsChange(listener: FileChangeListener): () => void` and `offFsChange(listener: FileChangeListener): void`.

### 4. FsNamespace API Exposure (`packages/sdk/src/fs-namespace.ts`)
- Implement:
  ```typescript
  on(event: 'change', listener: FileChangeListener): () => void {
    if (event !== 'change') {
      throw new Error(`Unsupported fs event: ${event}`);
    }
    return this.bridge.onFsChange(listener);
  }

  off(event: 'change', listener: FileChangeListener): void {
    if (event !== 'change') return;
    this.bridge.offFsChange(listener);
  }
  ```

### 5. Lifecycle Management (`packages/sdk/src/sandbox.ts`)
- In `dispose()`:
  - Worker is terminated, which automatically halts all event dispatches and drops bridge listener sets.

---

## Complexity Tracking

| Trade-off | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Web Worker single-source-of-truth dispatch | Guarantees exact parity, timestamp ordering, and absence of duplicate events between host and worker actions | Firing synthetic events on host for SDK calls and separate events from worker would lead to duplicate `'create'`/`'update'` events and out-of-order delivery |
