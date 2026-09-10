# Phase 1 Data Model & Message Contracts

## 1. Entities & State Definitions

### VirtualHttpServer
Manages the virtual HTTP port and lifecycle within the Web Worker.
```typescript
interface VirtualHttpServer {
  port: number;
  handler: (req: VirtualIncomingMessage, res: VirtualServerResponse) => void;
  connections: Set<VirtualSocket>;
  listening: boolean;
  messagePort?: MessagePort;
}
```

### VirtualFsWatcher
Tracks registered `fs.watch` and `fs.watchFile` listeners.
```typescript
interface WatchEntry {
  id: string;
  targetPath: string;
  recursive: boolean;
  callback: (eventType: 'change' | 'rename', filename: string | null) => void;
  closed: boolean;
}

interface VirtualFsWatcherRegistry {
  watchers: Map<string, WatchEntry>;
  notify(action: 'write' | 'delete' | 'mkdir', targetPath: string): void;
}
```

### NativeAddonInterceptor
Intercepts dynamic `.node` bindings and SWC calls.
```typescript
interface NativeAddonRegistry {
  shims: Map<string, NativeAddonFactory>;
  register(moduleName: string, factory: NativeAddonFactory): void;
  resolve(moduleName: string): any | null;
}

type NativeAddonFactory = () => any;
```

### HmrWebSocketSession
Maintains an active virtual WebSocket connection between the dev server and preview client.
```typescript
interface HmrWebSocketSession {
  id: string;
  url: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onmessage?: (data: string | Uint8Array) => void;
  onclose?: () => void;
}
```

### SqliteDatabaseInstance
Manages an active SQLite DB handle backed by `wa-sqlite` inside the VFS.
```typescript
interface SqliteDatabaseInstance {
  dbPath: string;
  handle: number; // WASM pointer
  isOpen: boolean;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}
```

## 2. Worker Protocol Enhancements

### New Inbound Messages (`WorkerInboundMessage`)
```typescript
export type WorkerInboundMessage =
  // Existing messages...
  | { type: 'http:request'; port: number; path: string; method: string; headers: Record<string, string>; body: ArrayBuffer | null; replyPort: MessagePort }
  | { type: 'ws:connect'; port: number; url: string; clientId: string; channelPort: MessagePort }
  | { type: 'fs:external_change'; path: string; changeType: 'change' | 'rename' };
```

### New Outbound Messages (`WorkerOutboundMessage`)
```typescript
export type WorkerOutboundMessage =
  // Existing messages...
  | { type: 'http:chunk'; streamId: string; chunk: Uint8Array }
  | { type: 'http:end'; streamId: string }
  | { type: 'ws:upgrade'; port: number; url: string }
  | { type: 'npm:progress'; loaded: number; total: number; package: string }
  | { type: 'toolchain:progress'; loaded: number; total: number; tool: string };
```

## 3. Streaming HTTP Wire Protocol (Service Worker <-> Worker)
Communication over transferred `replyPort`:
- `port.postMessage({ type: 'headers', status: number, statusText: string, headers: Record<string, string> })`
- `port.postMessage({ type: 'chunk', data: Uint8Array }, [data.buffer])`
- `port.postMessage({ type: 'end' })`
- `port.postMessage({ type: 'error', error: string })`
