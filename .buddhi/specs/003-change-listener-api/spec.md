# Feature Specification: File Change Listener API for Sandbox File System

**Feature Branch**: `003-change-listener-api`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Implement a file change listener API for the sandbox file system:
```typescript
sb.fs.on('change', (event: { path: string; type: 'create' | 'update' | 'delete' }) => void);
```

---

## Summary

Provide an event-driven file change observation API on `@buddhilive/sandbox` (`sb.fs.on('change', ...)` and `sb.fs.off('change', ...)`). The API notifies consumers of file system mutations occurring in the virtual file system, differentiating between `'create'`, `'update'`, and `'delete'`. 

The mechanism covers mutations originating from both the host TypeScript SDK (`sb.fs.writeFile`, `sb.fs.mkdir`, `sb.fs.rm`) and guest Node.js processes executing inside the Web Worker (e.g. `fs.writeFileSync`, `fs.promises.writeFile`, `fs.unlink`, package installations, build tools). All paths are delivered as normalized absolute POSIX paths.

---

## User Scenarios & Testing

### User Story 1 — Host SDK File Change Event Subscription (Priority: P1)

An application developer building a web-based IDE or interactive tutorial uses `@buddhilive/sandbox` to manipulate files via the SDK (`sb.fs.writeFile`, `sb.fs.rm`, `sb.fs.mkdir`). By subscribing to `sb.fs.on('change', listener)`, the host application updates its UI file tree or trigger auto-saves in real-time. The developer can unsubscribe using either the returned cleanup function or `sb.fs.off('change', listener)`.

**Why this priority**: Core MVP capability. Allows client applications to reactively observe host-driven file system modifications with zero polling.

**Independent Test**:
Initialize a sandbox instance, register a `sb.fs.on('change', ...)` listener, call `sb.fs.writeFile`, `sb.fs.writeFile` again (update), and `sb.fs.rm`. Assert that `'create'`, `'update'`, and `'delete'` events fire with correct paths. Call the returned unsubscribe function and assert no subsequent events are received.

**Acceptance Scenarios**:

1. **Given** an active sandbox with a registered change listener, **When** `sb.fs.writeFile('/app.js', 'hello')` is called on a non-existent path, **Then** a change event `{ path: '/app.js', type: 'create' }` is dispatched.
2. **Given** an existing file `/app.js`, **When** `sb.fs.writeFile('/app.js', 'hello world')` is called, **Then** a change event `{ path: '/app.js', type: 'update' }` is dispatched.
3. **Given** an existing file `/app.js`, **When** `sb.fs.rm('/app.js')` is called, **Then** a change event `{ path: '/app.js', type: 'delete' }` is dispatched.
4. **Given** a registered change listener, **When** the cleanup function returned by `sb.fs.on('change', ...)` is invoked, **Then** subsequent mutations do not invoke the listener.

---

### User Story 2 — Worker & Guest Process Mutation Propagation (Priority: P1)

A Node.js script, compilation command, or dev server running inside the sandbox Web Worker writes or deletes files using native Node.js `fs` methods (e.g., `fs.writeFileSync('/dist/bundle.js', ...)` or `fs.unlinkSync('/temp.txt')`). The Web Worker sends a change notification across the bridge to the main thread SDK, and `sb.fs` emits the change event to host listeners.

**Why this priority**: Essential for browser IDEs and dev-servers. In real sandbox workflows, files are created/modified by compilers (e.g. Vite, Next.js, tsc, esbuild) or user scripts running inside the sandbox worker. Without guest event bridging, host UI trees would quickly desynchronize.

**Independent Test**:
Spawn a Node.js process inside the sandbox that runs `fs.writeFileSync('/output.txt', 'done')` and `fs.unlinkSync('/output.txt')`. Assert that the host `sb.fs.on('change', ...)` listener receives the `'create'` and `'delete'` events.

**Acceptance Scenarios**:

1. **Given** a sandbox running a guest process, **When** guest code invokes `fs.writeFileSync('/data.json', '{}')`, **Then** the host listener receives `{ path: '/data.json', type: 'create' }`.
2. **Given** an existing file `/data.json`, **When** guest code overwrites it via `fs.promises.writeFile`, **Then** the host listener receives `{ path: '/data.json', type: 'update' }`.
3. **Given** an existing file `/data.json`, **When** guest code removes it via `fs.unlinkSync`, **Then** the host listener receives `{ path: '/data.json', type: 'delete' }`.
4. **Given** a directory created via guest `fs.mkdirSync('/dist')`, **When** executed, **Then** the host listener receives `{ path: '/dist', type: 'create' }`.

---

### User Story 3 — Recursive Directory Mutation & Path Normalization (Priority: P2)

When nested directories or bulk file deletions/creations occur (e.g., `sb.fs.rm('/src', { recursive: true })`), the listener receives normalized absolute POSIX paths for the affected files and directories, ensuring the consumer's file explorer model remains consistent.

**Why this priority**: Ensures robust consistency for nested project trees, avoiding missing delete events when parent folders are removed.

**Independent Test**:
Create `/pkg/a.js` and `/pkg/b.js`. Call `sb.fs.rm('/pkg', { recursive: true })`. Assert that delete events are received for child files and the directory.

**Acceptance Scenarios**:

1. **Given** a directory `/pkg` with child files `/pkg/a.js` and `/pkg/b.js`, **When** `/pkg` is deleted recursively, **Then** delete events are emitted for `/pkg/a.js`, `/pkg/b.js`, and `/pkg`.
2. **Given** relative or unnormalized paths (e.g. `sb.fs.writeFile('src/../src/index.js', ...)`), **When** written, **Then** the emitted event path is normalized to `'/src/index.js'`.

---

### User Story 4 — Multiple Listeners & Error Isolation (Priority: P2)

Multiple independent components (such as an editor tab manager, a file tree view, and an analytics logger) can register listeners simultaneously. If one listener throws an unhandled exception, it does not prevent other listeners from receiving the event or fail the file operation.

**Why this priority**: Reliability in multi-component host environments.

**Independent Test**:
Register Listener A (throws an Error) and Listener B (records event). Trigger `sb.fs.writeFile`. Assert Listener B receives the event and the file operation succeeds.

**Acceptance Scenarios**:

1. **Given** multiple listeners registered for `'change'`, **When** a file is modified, **Then** all listeners are called with identical event objects.
2. **Given** a listener that throws an error, **When** an event is emitted, **Then** the error is caught/logged to console and subsequent listeners execute normally.
3. **Given** a sandbox instance, **When** `sb.dispose()` is called, **Then** all internal listeners and worker bridge message subscriptions are cleared.

---

### Edge Cases

- **Path Normalization**: Redundant slashes, relative prefixes, and dot segments (`./`, `../`, `//`) must resolve to a single canonical POSIX path with a leading `/`.
- **Distinguishing Create vs Update**: The worker must inspect node existence prior to mutation: writing to a path that does not exist results in `'create'`; writing to a path that already exists results in `'update'`.
- **Rapid Consecutive Writes**: Rapid writes to the same path must dispatch in the correct chronological sequence without state corruption.
- **Empty or Root Path Edge Cases**: Root path `/` cannot be deleted; attempting to delete non-existent paths throws an error and emits no delete event.
- **Idempotent Cleanup**: Calling the unsubscribe function multiple times is safe and a no-op after the first invocation.

---

## Requirements

### Functional Requirements

- **FR-001**: `sb.fs` MUST expose `.on('change', listener: (event: FileChangeEvent) => void): () => void`.
- **FR-002**: `sb.fs` MUST expose `.off('change', listener: (event: FileChangeEvent) => void): void`.
- **FR-003**: The unsubscribe function returned by `.on('change', ...)` MUST unregister the listener when executed.
- **FR-004**: The event object MUST have the shape `{ path: string; type: 'create' | 'update' | 'delete' }`.
- **FR-005**: The system MUST emit `'create'` when a file or directory is newly created by SDK operations (`writeFile`, `mkdir`) or worker guest code.
- **FR-006**: The system MUST emit `'update'` when an existing file's contents are modified by SDK operations or worker guest code.
- **FR-007**: The system MUST emit `'delete'` when a file or directory is removed by SDK operations (`rm`) or worker guest code (`unlink`, `rmdir`).
- **FR-008**: When a directory is recursively removed, the system MUST emit `'delete'` events for the traversed child entries as well as the target directory.
- **FR-009**: All `event.path` values MUST be normalized absolute POSIX paths (always starting with `/`).
- **FR-010**: Worker-side file system modifications MUST be bridged across `WorkerOutboundMessage` to the main-thread `WorkerBridge`.
- **FR-011**: Exceptions thrown inside consumer listeners MUST be isolated with `try...catch` so that other listeners and filesystem operations are not interrupted.
- **FR-012**: Calling `sb.dispose()` MUST remove all registered listeners and detach worker bridge event listeners.

### Key Entities

- **`FileChangeEvent`**: `{ path: string; type: 'create' | 'update' | 'delete' }`.
- **`FileChangeListener`**: `(event: FileChangeEvent) => void`.
- **`FsNamespace`**: Host SDK namespace managing file operations, maintaining listener sets, and dispatching events from host and worker sources.
- **`WorkerOutboundMessage` (`fs:change`)**: Internal bridge message `{ type: 'fs:change'; path: string; changeType: 'create' | 'update' | 'delete' }`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Host SDK file mutation events fire within 20ms of operation completion.
- **SC-002**: Worker-originated file mutation events arrive on the main thread and fire listeners within 50ms.
- **SC-003**: 100% accuracy in `'create'` vs `'update'` classification verified by automated test suites.
- **SC-004**: Disposing the sandbox or unsubscribing drops active listener references with 0 memory leaks.
- **SC-005**: All existing unit, integration, and E2E test suites continue to pass without regression.

---

## Assumptions

- The sandbox environment supports `postMessage` communication between the Web Worker and main thread (standard Web Worker specification).
- All file paths within the sandbox virtual file system follow POSIX conventions.
- Standard Node.js `fs.watch` inside the worker continues to function alongside the new host SDK change listener.
