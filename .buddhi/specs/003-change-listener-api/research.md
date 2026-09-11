# Research & Architectural Decisions: File Change Listener API

**Branch**: `003-change-listener-api` | **Date**: 2026-09-11

---

## 1. Single-Source-of-Truth Event Architecture

### Problem
File mutations can originate from two places:
1. Host TypeScript SDK: `sb.fs.writeFile()`, `sb.fs.mkdir()`, `sb.fs.rm()`.
2. Guest Node.js runtime inside Web Worker: `fs.writeFileSync()`, `fs.promises.writeFile()`, `fs.unlinkSync()`, `fs.rmdirSync()`, package extraction (`fflate`), or compiler outputs.

If the host SDK synthesized events locally for host operations while also receiving events from the worker for guest operations, there would be a risk of duplicate events, race conditions, or mismatched ordering.

### Decision
**The Web Worker VFS layer is the single source of truth for all file change events.**
- All host SDK `fs` operations already send RPC messages (`fs:write`, `fs:mkdir`, `fs:rm`) to the worker.
- All guest Node.js `fs` shims already execute directly inside the worker and mutate the worker VFS.
- Whenever any mutation occurs inside the worker VFS, the worker dispatches a unified outbound message:
  ```typescript
  self.postMessage({
    type: 'fs:change',
    path: canonicalPath,
    changeType: 'create' | 'update' | 'delete',
  });
  ```
- The main thread `WorkerBridge` listens for `fs:change` and dispatches it directly to `FsNamespace` listeners.
- This guarantees:
  1. Identical handling and guarantees for host and guest operations.
  2. Perfectly sequenced event stream matching true VFS state transitions.
  3. No duplicate events.

---

## 2. Accurate 'create' vs 'update' Differentiation

### Analysis
Currently, `sandbox.worker.ts` treats all writes with a generic `notifyFsChange(path, 'change')`. To support `'create' | 'update' | 'delete'`, the system must know whether the target existed prior to the write.

### Decision
In `sandbox.worker.ts`:
- For `fs:write` and `fs.writeFileSync`:
  ```typescript
  const { node: existingNode } = resolveNode(path);
  const changeType: 'create' | 'update' = existingNode && !existingNode.isDir ? 'update' : 'create';
  // ... perform write ...
  postFsChange(path, changeType);
  ```
- For `fs:mkdir` and `fs.mkdirSync`:
  - If directory didn't exist: `'create'`.
- For `fs:rm`, `fs.unlinkSync`, `fs.rmdirSync`:
  - If target existed: `'delete'`.
  - For recursive directory deletion: collect all descendant absolute paths in bottom-up order, emitting `'delete'` for each descendant followed by the directory.

---

## 3. Path Normalization

### Decision
All paths are canonicalized using POSIX rules before dispatching:
- Leading slash `/` guaranteed.
- Trailing slashes stripped (except root `/`).
- Dot segments (`.` and `..`) resolved.
- Multiple contiguous slashes (`//`) collapsed to a single `/`.

---

## 4. API Design & Lifecycle Management

### Decision
`FsNamespace` on the main thread will expose:
```typescript
on(event: 'change', listener: FileChangeListener): () => void;
off(event: 'change', listener: FileChangeListener): void;
```
- `on()` returns a cleanup function: calling `const unsubscribe = sb.fs.on('change', ...); unsubscribe();` removes the listener.
- `off()` removes the specified listener reference.
- Multiple listeners are tracked in a `Set<FileChangeListener>`.
- Listener invocation is wrapped in `try...catch` so an exception in one consumer does not break other consumers.
- Disposing the sandbox (`sb.dispose()`) clears all listener sets and detaches bridge subscriptions.
