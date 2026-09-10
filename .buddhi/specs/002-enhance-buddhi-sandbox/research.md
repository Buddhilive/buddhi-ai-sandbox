# Phase 0 Research: Next.js 16 Runtime on Client-Side Sandbox

## 1. Problem Space & Constraints
Next.js 16 uses a hybrid architecture:
- Build/Transpilation: Next.js by default delegates JS/TS/JSX parsing to `@next/swc` (native Rust binary via N-API / `.node`). Turbopack is also native Rust.
- Server Runtime: Next.js server runs on Node.js, utilizing `http`, `net`, `stream`, `crypto`, `events`, `zlib`, `buffer`, `path`, `fs`.
- Dev Mode (HMR): File watching via `chokidar` (using `fs.watch`), hot module replacement over WebSocket (`/_next/webpack-hmr`).
- Client Browser Preview: Serviced by Service Worker bridge (`packages/service-worker`), requiring COOP/COEP headers and streaming HTTP.

## 2. Emulation Strategy & Architecture Decisions

### Decision 1: `@next/swc` Interception via `esbuild-wasm`
- **Context**: Real Next.js 16 checks for platform-specific `@next/swc` binaries (e.g. `@next/swc-wasm-nodejs` or `@next/swc-darwin-arm64`). If none match, it fails.
- **Alternative 1**: Compile full `@next/swc` to `wasm32-unknown-unknown` for browsers. (Rejected: `@next/swc` uses Rust crates with OS bindings, thread pools, and exceeds 40MB).
- **Alternative 2**: Intercept `require('@next/swc')` and provide an in-memory bridge to `esbuild-wasm`. (Selected).
- **Implementation**:
  - `NativeAddonInterceptor` intercepts any `require` matching `@next/swc*` or `.node` extensions.
  - Returns a JS object implementing `transformSync(src, options)` and `transform(src, options)`.
  - Maps SWC AST/JSX options to `esbuild.transformSync(src, { loader: 'tsx', jsx: 'automatic', ... })`.

### Decision 2: File Watching (`fs.watch` / `chokidar`)
- **Context**: `next dev` invokes `chokidar` to detect file updates.
- **Current Sandbox**: Only synchronous/in-memory VFS with no file change notification.
- **Design**:
  - Create `VirtualFsWatcher` inside `packages/sdk/src/worker/shims/fs-watcher.ts`.
  - Implements Node's `fs.watch(filename, options, listener)` and `fs.watchFile`.
  - Whenever `vfs_write_file`, `vfs_mkdir`, or `vfs_rm` is executed, the watcher notifies matching path listeners with `'change'` or `'rename'`.
  - Debounce events at 50ms to prevent duplicate triggers.

### Decision 3: Streaming HTTP & RSC Wire Protocol
- **Context**: React Server Components (RSC) emit `text/x-component` chunks incrementally.
- **Current Service Worker**: Buffers the entire response payload via `channel.port1.onmessage` and resolves with a single `new Response(body)`.
- **Design**:
  - Update `packages/service-worker/src/request-bridge.ts` to support chunked streaming:
    - Instead of one message, support `{ type: 'http:chunk', chunk }` and `{ type: 'http:end' }`.
    - Stream incoming chunks into a `ReadableStream<Uint8Array>` passed directly to `new Response(stream, { headers, status })`.
  - Update `packages/sdk/src/worker/shims/http.ts`:
    - `ServerResponse.prototype.write(chunk)` sends `{ type: 'http:chunk', chunk }` over `replyPort`.
    - `ServerResponse.prototype.end(chunk?)` sends optional final chunk and `{ type: 'http:end' }`.

### Decision 4: HMR WebSocket Bridge
- **Context**: Browsers cannot route WebSocket connections through standard Service Worker `fetch` handlers.
- **Design**:
  - `HmrWebSocketBridge` in `packages/sdk/src/worker/shims/hmr-bridge.ts`:
    - Registers a virtual WebSocket server on the worker side for `/_next/webpack-hmr`.
    - In `packages/service-worker/src/sw.ts` or in the host preview iframe injector, inject a lightweight polyfill script that intercepts `new WebSocket(url)` when url points to `/__preview/:port/_next/webpack-hmr`.
    - Proxies WebSocket frames via `MessageChannel` directly between the preview iframe and the worker.

### Decision 5: Offline Bundling in `toolchain-bundle`
- **Context**: User selected 100% offline bundling in `@buddhilive/sandbox-toolchain`.
- **Design**:
  - Package `esbuild-wasm` browser assets and `wa-sqlite` WASM binaries inside `@buddhilive/sandbox-toolchain/dist/assets/`.
  - Expose lazy loaders `ToolchainBundle.getEsbuildCompiler()` and `ToolchainBundle.getSqliteRuntime()`.
  - Base `@buddhilive/sandbox` stays lightweight (<100KB gzipped) by importing `@buddhilive/sandbox-toolchain` dynamically on demand.

### Decision 6: Node.js Built-in Modules Surface
Required shim inventory in `packages/sdk/src/worker/shims/`:
1. `events.ts`: Standard EventEmitter.
2. `buffer.ts`: `Buffer` class mapping to `Uint8Array` with hex/base64/utf8 codecs.
3. `stream.ts`: `Readable`, `Writable`, `Transform`, `PassThrough`, `pipeline`, `finished`, plus web stream bridges.
4. `crypto.ts`: `createHash`, `createHmac`, `randomBytes`, `randomUUID`, `timingSafeEqual`.
5. `http.ts`: `createServer`, `IncomingMessage`, `ServerResponse`, `Agent`, `STATUS_CODES`.
6. `net.ts`: `Socket`, `Server`, `isIP`, `isIPv4`, `isIPv6`.
7. `tls.ts`: `connect`, `createServer`, `TLSSocket` (stubs).
8. `zlib.ts`: `gzip`, `gunzip`, `deflate`, `inflate`, `createGzip`, `createGunzip` via `fflate`.
9. `os.ts`: `platform()`, `arch()`, `cpus()`, `homedir()`, `tmpdir()`, `endianness()`, `release()`.
10. `assert.ts`: minimal assert methods.
11. `util.ts`: `promisify`, `inherits`, `format`, `inspect`, `types`.
12. `string_decoder.ts`: `StringDecoder` class.
13. `child_process.ts`: stub returning no-op EventEmitter.
14. `worker_threads.ts`: stub.
15. `url.ts` / `querystring.ts`: wrapper around standard `URL` and `URLSearchParams`.
