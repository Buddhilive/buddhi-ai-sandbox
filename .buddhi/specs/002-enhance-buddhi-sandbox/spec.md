# Feature Specification: Full Next.js Support in buddhi-ai-sandbox

**Feature Branch**: `002-enhance-buddhi-sandbox`

**Created**: 2026-09-10

**Status**: Draft

**Input**: "Enhance buddhi-ai-sandbox to fully support running Next.js projects in dev mode and production mode"

---

## Summary

Extend `@buddhilive/sandbox` so that a real Next.js project (targeting Next.js 16, the latest stable release) can be installed via the sandbox built-in NPM installer, compiled, and served — both in `next dev` (HMR, file-watching) and `next start` (production server) modes — entirely client-side inside the browser Web Worker / WebAssembly runtime, with live previews through the existing Service Worker bridge.

The strategy for Next.js native Rust compiler (`@next/swc`) is to **intercept the native addon load and substitute `esbuild-wasm`** (browser build) so the real `next` npm package is installed and run unchanged; native modules are shimmed transparently.

---

## User Scenarios & Testing

### User Story 1 — Run `next start` (Production Preview) (Priority: P1)

A developer has a Next.js project with a pre-built `.next/` directory. They write the project files into the sandbox VFS, run `npm run build`, and then execute `next start`. The Service Worker bridge captures requests to port 3000 and renders the live app in a preview iframe, supporting App Router, Pages Router, API Routes, and SSG pages.

**Why this priority**: Production mode is the simplest server path — no file watcher, no HMR WebSocket, no JIT compiler loop. It establishes the foundational Node.js module surface (net, stream, crypto, events, url, buffer, querystring, zlib) needed by all subsequent stories.

**Independent Test**: Write a minimal `app/page.tsx` into the VFS, run `next build`, then spawn `next start`. Assert `GET /__preview/3000/` returns HTTP 200 with React-rendered HTML.

**Acceptance Scenarios**:

1. **Given** a sandbox with Next.js 16 installed and a pre-built `.next/` output in the VFS, **When** `next start` is spawned, **Then** port 3000 fires `port:listen` and `GET /__preview/3000/` returns HTTP 200 with server-rendered HTML.
2. **Given** a Pages Router SSG page, **When** the production server receives `GET /`, **Then** the pre-rendered HTML is served with correct status and headers.
3. **Given** an API Route returning `{ message: "ok" }`, **When** `GET /__preview/3000/api/hello` is requested, **Then** the JSON response is returned with `Content-Type: application/json`.
4. **Given** the sandbox hits its memory quota during build, **When** the OOM condition is triggered, **Then** an `OOMError` is emitted and the preview iframe shows an error state.

---

### User Story 2 — Run `next dev` (Development Mode with HMR) (Priority: P1)

A developer writes/edits source files into the sandbox VFS and starts the Next.js dev server. The dev server compiles the project using the `esbuild-wasm` shim in place of `@next/swc` and begins serving on port 3000. When the developer writes a changed file back into the VFS, a synthetic `fs.watch` event triggers, Next.js detects the change, recompiles the affected module, and pushes an HMR update so the preview iframe refreshes without a full reload.

**Why this priority**: Dev mode is the primary use case for AI-agent code editors and interactive tutorial platforms. Without HMR the feedback loop collapses to rebuild-and-reload which defeats the live-preview promise. P1 alongside Story 1 per requirements.

**Independent Test**: Write `app/page.tsx` returning `<h1>Hello v1</h1>`. Start `next dev`. Assert iframe shows "Hello v1". Then overwrite with `<h1>Hello v2</h1>`. Assert iframe updates within 3 seconds without full page reload.

**Acceptance Scenarios**:

1. **Given** source files in the VFS, **When** `next dev` is spawned, **Then** stdout emits the startup banner, port 3000 fires `port:listen`, and the preview iframe renders within 10 seconds.
2. **Given** `next dev` is running, **When** a component file is overwritten via `sandbox.fs.writeFile`, **Then** a synthetic watch event is emitted, the module recompiles, and an HMR patch is delivered to the iframe within 3 seconds.
3. **Given** a TypeScript compile error is introduced, **When** the file is saved, **Then** the dev server emits the error to stderr and the iframe shows the Next.js error overlay.
4. **Given** `next dev` is running, **When** `sandbox.dispose()` is called, **Then** the dev server is killed cleanly with no memory leaks.

---

### User Story 3 — React Server Components & Server Actions (Priority: P2)

App Router RSC pages and Server Actions work correctly: RSC payloads are generated server-side in the Worker runtime, serialized, and streamed. Server Actions are callable from the client and execute inside the sandbox Node.js context.

**Why this priority**: RSC is the default paradigm in Next.js App Router. Without it, `app/` directory apps cannot be used. P2 because it requires chunked transfer encoding in the virtual `http` module to be correct, which builds on P1.

**Independent Test**: Create an RSC page that reads from a VFS JSON file. Start `next dev`. Assert the iframe renders VFS-fetched data. Trigger a Server Action that mutates the file. Assert the page revalidates with new data.

**Acceptance Scenarios**:

1. **Given** an RSC page that awaits VFS data, **When** the page is requested, **Then** Next.js generates the RSC payload server-side and the browser receives streamed HTML with the correct data.
2. **Given** a Server Action that writes to the VFS, **When** the client triggers the action, **Then** VFS state is updated and the page revalidates.
3. **Given** a Suspense boundary around a slow RSC, **When** the page loads, **Then** the loading skeleton renders first and RSC content streams progressively.

---

### User Story 4 — Middleware, i18n Routing & Image/Font Optimization (Priority: P2)

Next.js Middleware (`middleware.ts`) runs at the virtual edge (emulated as a separate execution context in the Worker). i18n routing redirects to locale-specific paths. `next/image` serves optimized images via `OffscreenCanvas`. `next/font` loads fonts and injects CSS variables.

**Why this priority**: These complete the "full support" requirement. They depend on the core HTTP request dispatch pipeline (P1) and are independently bounded.

**Independent Test**: Write a `middleware.ts` redirecting `/secret` to `/login` with 302. Assert `GET /__preview/3000/secret` receives 302. Assert `next/image` renders an optimized `<img>`. Assert `next/font` injects the correct CSS variable.

**Acceptance Scenarios**:

1. **Given** a `middleware.ts` that sets a request header, **When** a request is made, **Then** the page handler receives the modified header.
2. **Given** i18n config with locales `['en', 'fr']` and defaultLocale `'en'`, **When** `GET /` is requested, **Then** the response redirects to `/en` and the locale is available in `params`.
3. **Given** `<Image src="/photo.jpg" width={800} height={600} />`, **When** the page renders, **Then** `/_next/image` serves a resized image using `OffscreenCanvas`.

---

### User Story 5 — SQLite Support via WASM SQLite (Priority: P3)

API Routes or Server Components using `better-sqlite3` or `@libsql/client` work inside the sandbox via a `wa-sqlite` WASM shim. The database file is stored in the sandbox VFS and can persist across browser sessions via OPFS.

**Why this priority**: SQLite is the most common in-browser database for full-stack sandbox demos. P3 because it requires a separate WASM bundle loaded lazily and is cleanly separable from the core Next.js runtime work.

**Independent Test**: Install `better-sqlite3`. Write an API Route creating a `todos` table, inserting a row, and returning all rows as JSON. Assert `GET /__preview/3000/api/todos` returns the inserted row.

**Acceptance Scenarios**:

1. **Given** `better-sqlite3` is installed, **When** an API Route opens a database at `/workspace/app.db`, **Then** the sandbox substitutes the `wa-sqlite` WASM implementation transparently.
2. **Given** rows are inserted, **When** the session persists via OPFS, **Then** the `.db` file is saved and reopening the sandbox restores the data.
3. **Given** concurrent API Route handlers querying the same database, **When** requests are made in parallel, **Then** WASM SQLite serializes access correctly with no data corruption.

---

### Edge Cases

- **`next build` exceeds memory quota**: Emit `OOMError`, allow consumer to raise `maxMemoryMb` up to 1024 MB. Log a warning when `next` is detected and the limit is still 512 MB.
- **Native addon intercepted too late**: The `NativeAddonInterceptor` MUST register synchronously during `sandbox_init`, before any `require()` call.
- **HMR WebSocket in Service Worker**: Service Workers cannot intercept WebSocket upgrades. The sandbox proxies `/_next/webpack-hmr` frames via `MessageChannel` between the Worker and the host page.
- **`fs.watch` / `chokidar`**: VFS must emit synthetic watch events when `sandbox.fs.writeFile` or `sandbox.fs.rm` mutates a watched path.
- **Large NPM install (~60 MB for `next`)**: The NPM installer must support chunked tarball downloads with `npm:progress` events and chunked VFS writes.
- **`crypto` module**: Map `node:crypto` to Web Crypto API (`globalThis.crypto`). Next.js uses it heavily for route hashing and nonce generation.
- **`stream / stream/web`**: RSC streaming requires `ReadableStream` / `TransformStream`. Map `node:stream/web` to native browser streams.
- **`process.env` at build time**: Must include `NODE_ENV`, `NEXT_TELEMETRY_DISABLED=1`, and user-supplied env vars.
- **Port collision**: If `next dev` and `next start` both request port 3000, the sandbox must auto-assign an available virtual port or emit a clear error.
- **Turbopack**: Explicitly out of scope. Only webpack-based pipeline with `@next/swc` shimmed is targeted.

---

## Requirements

### Functional Requirements

- **FR-001**: The sandbox MUST emulate the following additional Node.js built-in modules: `events`, `buffer`, `url`, `querystring`, `stream` (including `stream/web`, `stream/promises`), `crypto` (Web Crypto API), `net` (virtual TCP stubs), `tls` (no-op stubs), `zlib` (via `CompressionStream`), `os`, `assert`, `util`, `string_decoder`, `child_process` (stubbed), `worker_threads` (stubbed).
- **FR-002**: The sandbox MUST intercept `require('@next/swc')` and any `*.node` native addon imports, replacing them with browser-safe WASM or JS shims. Interception MUST be synchronous and registered before any user script executes.
- **FR-003**: The sandbox MUST provide an `esbuild-wasm` shim that replicates the `@next/swc` transform API (`transformSync`, `transform`) for JSX/TSX/TS compilation, loaded lazily via `toolchain-bundle`.
- **FR-004**: The virtual `http` module MUST handle: concurrent requests, chunked transfer encoding (RSC streaming), response headers (including `Set-Cookie`), request body parsing, and `Connection: keep-alive` lifecycle.
- **FR-005**: The sandbox MUST implement `fs.watch` / `fs.watchFile` that emits `change` events whenever `sandbox.fs.writeFile` or `sandbox.fs.rm` modifies a watched path, compatible with `chokidar`.
- **FR-006**: The sandbox MUST support HMR WebSocket by forwarding `/_next/webpack-hmr` frames via `MessageChannel` between the sandbox Worker and the host page, bypassing the Service Worker.
- **FR-007**: `SandboxOptions` MUST be extended with `maxMemoryMb` upper cap of 1024 MB and a new `nextjsOptions: { version?: string; turbopack?: boolean; telemetry?: boolean }` field.
- **FR-008**: The NPM installer MUST support installs >50 MB with progress streaming (`npm:progress` message type) and chunked VFS writes.
- **FR-009**: `toolchain-bundle` MUST be extended to lazily load: (a) `esbuild-wasm`, (b) `wa-sqlite`, (c) an `OffscreenCanvas`-based image processing shim.
- **FR-010**: The Service Worker MUST forward: streaming HTTP responses, `Set-Cookie` headers, and the RSC wire protocol (`text/x-component`).
- **FR-011**: The sandbox MUST emulate Next.js Middleware as a separate synchronous JS execution context in the Worker, running `middleware.ts` before the matched page handler.
- **FR-012**: The sandbox MUST support `next/font` by intercepting font manifest requests and serving from VFS or fetching from Google Fonts CDN.
- **FR-013**: The sandbox MUST emit `toolchain:needed` with `pkg: 'nextjs'` when the first `next` CLI command is detected, triggering lazy toolchain download before execution.
- **FR-014**: The sandbox MUST support i18n routing as implemented by Next.js 16 (locale prefix, accept-language detection in virtual request headers).

### Key Entities

- **`VirtualHttpServer`**: Upgraded virtual HTTP server managing route dispatch, concurrent request queuing, streaming responses, and virtual WebSocket upgrade for HMR.
- **`NativeAddonInterceptor`**: Registry mapping `*.node` / native package names to WASM shim factories. Registered synchronously at init. Consulted by `virtualRequire` before node_modules fallback.
- **`VirtualFsWatcher`**: Map of watched paths to listener callbacks. Updated by `sandbox.fs.*` mutations. Emits `change` / `rename` events compatible with Node.js `fs.FSWatcher`.
- **`EsbuildWasmShim`**: Lazily-loaded module implementing the `@next/swc` transform API using `esbuild-wasm`. Loaded when `next` CLI is first invoked.
- **`WaSqliteShim`**: Lazily-loaded module implementing `better-sqlite3` / `@libsql/client` sync API using `wa-sqlite`. Loaded when `better-sqlite3` is detected during `npm install`.
- **`HmrWebSocketBridge`**: `MessageChannel`-based proxy connecting Next.js internal HMR WebSocket server (in the Worker) to a `WebSocket`-like object in the host page.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A minimal Next.js 16 App Router app installs, builds, and renders first meaningful paint in the preview iframe within **30 seconds** of `next dev` invocation (including `next` package install time).
- **SC-002**: HMR recompilation after a single-file change completes and the preview iframe reflects the change within **3 seconds** of `sandbox.fs.writeFile` completing.
- **SC-003**: The baseline (non-Next.js path) SDK bundle size increase from new module shims is **< 15 KB gzipped**. All Next.js-specific WASM is lazy-loaded.
- **SC-004**: All E2E Playwright tests for the 5 user stories pass on Chromium (Chrome 120+) with no real backend dependency.
- **SC-005**: `next build` on an app with App Router, Pages Router, and 3 API Routes completes without OOM errors when `maxMemoryMb: 1024` is configured.
- **SC-006**: The real `next` package from `registry.npmjs.org` is installed without modification — no patching or forking required.
- **SC-007**: An API Route using `better-sqlite3` correctly reads and writes rows when the `wa-sqlite` shim is active, verified by E2E test.

---

## Assumptions

- Next.js 16 is the minimum supported version; older versions may work but are not explicitly tested.
- The sandbox consumer page is cross-origin isolated (COOP/COEP headers) as already required — this constraint is unchanged.
- `esbuild-wasm` (browser build) provides sufficient JSX/TS transform fidelity as an `@next/swc` shim for Next.js 16 webpack pipeline.
- `wa-sqlite` (compiled with asyncify or JSPI) can emulate `better-sqlite3` synchronous API via the existing SPSC ring-buffer blocking pattern.
- `next/image` optimization uses `OffscreenCanvas` and `createImageBitmap`, both available in Web Workers on Chrome 120+.
- `next/font/google` requires outbound `fetch()` from the Worker to `fonts.gstatic.com`; environments blocking outbound requests must supply local font files in the VFS.
- **Turbopack is explicitly out of scope** — only the webpack-based pipeline with `@next/swc` shimmed is targeted.
- `child_process` stubs satisfy Next.js import at module load time; actual invocation throws `ERR_NOT_SUPPORTED_IN_SANDBOX`.
- The default 512 MB memory limit will log a warning suggesting `maxMemoryMb: 1024` when `next` is detected.
