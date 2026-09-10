# Implementation Plan: Full Next.js 16 Support in buddhi-ai-sandbox

**Branch**: `002-enhance-buddhi-sandbox` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/.buddhi/specs/002-enhance-buddhi-sandbox/spec.md`

---

## Summary

Enhance `@buddhilive/sandbox` and its monorepo packages to support running full Next.js 16 projects in both **development mode (`next dev` with HMR)** and **production mode (`next start`)** completely client-side in the browser.

The architecture centers around 5 coordinated advancements:
1. **Modular Node.js Emulation Surface** in `packages/sdk`: Implement browser-compatible shims for `events`, `buffer`, `stream`, `crypto`, `http`, `net`, `tls`, `zlib`, `os`, `assert`, `util`, `string_decoder`, `child_process`, `worker_threads`.
2. **Native Addon Interceptor & SWC Shim**: Synchronously intercept `@next/swc` / `.node` native imports and route JSX/TSX transpilation to `esbuild-wasm` packaged inside `@buddhilive/sandbox-toolchain`.
3. **Virtual File Watcher (`fs.watch`)**: Implement change detection that notifies Next.js/chokidar on `sandbox.fs` file mutations to trigger automatic recompilations.
4. **Streaming Service Worker HTTP Bridge**: Upgrade `packages/service-worker` from buffered response passing to true chunked `ReadableStream` delivery for React Server Components (RSC) and server actions.
5. **HMR WebSocket Message Bridge**: Relay `/_next/webpack-hmr` frames over a dedicated `MessageChannel` between the dev server in the Worker and the preview iframe, bypassing Service Worker limitations.

---

## Technical Context

**Language/Version**: TypeScript 5.4+, Rust 1.83+ (`wasm32-unknown-unknown`), Node.js >= 20.0.0

**Primary Dependencies**: 
- Monorepo: `pnpm` workspaces
- SDK: `fflate` (for gzip/zlib decompression), `buddhilive-sandbox-core` (Rust WASM)
- Toolchain: `esbuild-wasm` (browser edition), `wa-sqlite` (WASM SQLite engine)
- Service Worker: Native Service Worker API, `MessageChannel`
- Testing: `vitest` (unit tests), `@playwright/test` (Chromium E2E)

**Storage**: In-memory POSIX VirtualFS backed by Rust WASM inode table; optional browser persistence via OPFS / IndexedDB.

**Testing**: Vitest for unit tests of Node shims; Playwright for browser E2E tests validating Next.js 16 dev and production rendering.

**Target Platform**: Modern Evergreen Browsers (Chrome >= 120, Firefox >= 120, Safari >= 17) with Cross-Origin Isolation (`COOP: same-origin`, `COEP: require-corp`) for `SharedArrayBuffer`.

**Project Type**: Multi-package client-side SDK & runtime monorepo.

**Performance Goals**:
- Next.js initial build & preview ready < 30 seconds.
- HMR hot update < 3 seconds on single-file save.
- Baseline SDK bundle increase < 15 KB gzipped (offline toolchain loaded lazily).

**Constraints**:
- Main thread isolation (Web Worker execution strictly enforced).
- Maximum memory quota configurable up to 1024 MB (default warning at 512 MB).
- 100% offline toolchain assets bundled in `@buddhilive/sandbox-toolchain`.

**Scale/Scope**: Full support for Next.js 16 App Router, Pages Router, API Routes, Middleware, SSG, SSR, i18n, next/image, next/font, and SQLite.

---

## AGENTS.md Compliance Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Grounded Changes**: Grounded in existing packages (`packages/wasm-core`, `packages/sdk`, `packages/service-worker`, `packages/toolchain-bundle`, `apps/sandbox-demo`).
- [x] **Main Thread Isolation**: All runtime emulation, compilation, and HTTP processing executed in Web Workers.
- [x] **Cross-Origin Isolation**: Preserved via Vite headers and Service Worker injected headers (`COOP: same-origin`, `COEP: require-corp`).
- [x] **Self-Contained Distribution**: `@buddhilive/sandbox` continues to ship inline worker bundle; heavy WASM tools dynamically imported via toolchain bundle.
- [x] **Evidence-Based Verification**: All automated checks to be executed via `vitest` and `playwright`.
- [x] **No Unapproved Dependencies**: Only browser-standard WASM packages (`esbuild-wasm`, `wa-sqlite`) introduced.

---

## Project Structure

### Documentation (this feature)

```text
.buddhi/specs/002-enhance-buddhi-sandbox/
├── spec.md              # Feature specification
├── plan.md              # This file (implementation plan)
├── research.md          # Phase 0 research & architectural decisions
├── data-model.md        # Phase 1 data models & protocol messages
├── quickstart.md        # Phase 1 developer quickstart guide
├── contracts/           # Phase 1 TypeScript interface contracts
│   ├── node-shims.ts
│   └── toolchain-bundle.ts
└── tasks.md             # Phase 2 task breakdown (created by /tasks)
```

### Source Code (repository root)

```text
packages/
├── sdk/                                      # @buddhilive/sandbox
│   ├── src/
│   │   ├── worker/
│   │   │   ├── sandbox.worker.ts             # Main worker entry point orchestrator
│   │   │   └── shims/                        # Modular Node.js emulation layer
│   │   │       ├── events.ts                 # EventEmitter polyfill
│   │   │       ├── buffer.ts                 # Buffer implementation mapping to Uint8Array
│   │   │       ├── stream.ts                 # Readable, Writable, Transform, pipeline
│   │   │       ├── crypto.ts                 # WebCrypto bridge (hashes, random, hmac)
│   │   │       ├── http.ts                   # Virtual HTTP server, IncomingMessage, ServerResponse
│   │   │       ├── net.ts                    # Virtual TCP socket stubs & address helpers
│   │   │       ├── tls.ts                    # TLS socket stubs
│   │   │       ├── zlib.ts                   # Deflate/inflate/gzip using fflate
│   │   │       ├── os.ts                     # Operating system environment metadata
│   │   │       ├── assert.ts                 # Assert module
│   │   │       ├── util.ts                   # promisify, format, inspect, inherits
│   │   │       ├── string-decoder.ts         # StringDecoder implementation
│   │   │       ├── child-process.ts          # Safe stubs for optional child processes
│   │   │       ├── worker-threads.ts         # Worker threads stubs
│   │   │       ├── fs-watcher.ts             # Virtual FS watch / chokidar event source
│   │   │       ├── addon-interceptor.ts      # Native addon & @next/swc interception
│   │   │       └── hmr-bridge.ts             # Virtual WebSocket bridge for Next.js HMR
│   │   ├── fs-namespace.ts                   # Emits file change notifications to worker
│   │   ├── process-namespace.ts              # Process spawning & streaming
│   │   ├── ports-namespace.ts                # Port event dispatching
│   │   ├── types.ts                          # Extended SandboxOptions & message types
│   │   ├── worker-bridge.ts                  # Upgraded message channel bridge
│   │   └── sandbox.ts                        # Sandbox entrypoint with 1024MB quota check
│   └── tests/
│       ├── unit/                             # Vitest tests for each Node.js shim
│       │   ├── shims-events.test.ts
│       │   ├── shims-buffer.test.ts
│       │   ├── shims-stream.test.ts
│       │   ├── shims-crypto.test.ts
│       │   ├── shims-http.test.ts
│       │   └── shims-watcher.test.ts
│       └── e2e/                              # Playwright tests for Next.js
│           ├── nextjs-start.spec.ts
│           └── nextjs-dev.spec.ts
│
├── toolchain-bundle/                         # @buddhilive/sandbox-toolchain
│   ├── src/
│   │   ├── index.ts                          # Dynamic loader for compilers & runtimes
│   │   ├── esbuild-compiler.ts               # Bundled esbuild-wasm wrapper
│   │   ├── sqlite-runtime.ts                 # Bundled wa-sqlite runtime
│   │   ├── image-processor.ts                # OffscreenCanvas image optimizer for next/image
│   │   ├── clang.ts
│   │   ├── python.ts
│   │   └── node-gyp-runner.ts
│   └── package.json
│
├── service-worker/                           # @buddhilive/sandbox-sw
│   ├── src/
│   │   ├── request-bridge.ts                 # Upgraded streaming HTTP chunk forwarder
│   │   ├── sw.ts                             # Service worker route interception & COOP/COEP
│   │   ├── hmr-injector.ts                   # Injected client script for WebSocket proxying
│   │   └── port-registry.ts                  # Active port tracking
│   └── package.json
│
├── wasm-core/                                # buddhilive-sandbox-core
│   └── src/
│       ├── vfs/                              # Added file modification callback hooks
│       └── lib.rs
│
└── apps/
    └── sandbox-demo/                         # Live testbed demo
        ├── src/
        │   ├── App.tsx                       # UI with Next.js template selector
        │   └── templates/
        │       └── nextjs-app/               # Sample Next.js 16 App Router project
        │           ├── app/
        │           │   ├── layout.tsx
        │           │   ├── page.tsx
        │           │   └── api/
        │           │       └── hello/route.ts
        │           ├── package.json
        │           └── next.config.js
        └── package.json
```

**Structure Decision**: Monorepo modular extension. Rather than complicating `packages/sdk` with one giant monolithic worker file, the Node.js emulation is decomposed into clean, independently testable shim modules under `packages/sdk/src/worker/shims/`. Toolchain assets are packaged offline in `packages/toolchain-bundle`.

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 15 Node.js shim files in `packages/sdk/src/worker/shims/` | Next.js relies on standard Node APIs (events, stream, buffer, crypto, http, etc.) | Single-file implementation would exceed 5000 lines, making debugging, unit testing, and isolated refactoring impossible. |
| Intercepting `@next/swc` with `esbuild-wasm` | Next.js 16 requires native Rust SWC binary by default which cannot run in browser | Compiling full `@next/swc` to browser WASM is prohibitive (>40MB, OS thread pool dependencies). `esbuild-wasm` is mature, fast, and satisfies JSX/TS compilation. |
| Dedicated `MessageChannel` for HMR WebSocket | Next.js dev server uses WebSocket (`/_next/webpack-hmr`) for hot reload | Service Workers cannot intercept WebSocket upgrade requests by browser specification. |
| Streaming response bridge in `service-worker` | React Server Components (RSC) emit chunked wire format (`text/x-component`) | Buffering entire response causes RSC streaming to hang or fail first paint. |
