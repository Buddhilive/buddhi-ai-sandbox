# Data Model: File Change Listener API

**Branch**: `003-change-listener-api` | **Date**: 2026-09-11

---

## 1. Type Definitions & Schemas

### `FileChangeType`
Enumeration of possible file system mutation types:
```typescript
export type FileChangeType = 'create' | 'update' | 'delete';
```

### `FileChangeEvent`
The public payload passed to listeners:
```typescript
export interface FileChangeEvent {
  /**
   * Normalized absolute POSIX path of the affected file or directory.
   * Always starts with '/'.
   * Example: '/src/index.ts', '/package.json'
   */
  path: string;

  /**
   * Nature of the file system mutation.
   * - 'create': A file or directory was created where none existed previously.
   * - 'update': An existing file's contents were modified/overwritten.
   * - 'delete': An existing file or directory was removed.
   */
  type: FileChangeType;
}
```

### `FileChangeListener`
Callback signature for subscription:
```typescript
export type FileChangeListener = (event: FileChangeEvent) => void;
```

---

## 2. Protocol Messages (Web Worker Bridge)

### Outbound Bridge Message (`WorkerOutboundMessage`)
Sent from Web Worker to Host Main Thread over `Worker.postMessage()`:
```typescript
export type WorkerOutboundMessage =
  | ... // existing variants
  | {
      type: 'fs:change';
      path: string;
      changeType: FileChangeType;
    };
```

---

## 3. Entity Relationships

```
+------------------------+
|      FsNamespace       |
+------------------------+
| - listeners: Set       |
| - bridge: WorkerBridge |
+------------------------+
            |
            | dispatches FileChangeEvent
            v
+------------------------+
|   FileChangeListener   |
|   (Consumer Handler)   |
+------------------------+
            ^
            | receives 'fs:change'
+------------------------+
|      WorkerBridge      |
+------------------------+
            ^
            | postMessage({ type: 'fs:change', ... })
+------------------------+
|     sandbox.worker     |
| (VFS Mutation Handler) |
+------------------------+
```
