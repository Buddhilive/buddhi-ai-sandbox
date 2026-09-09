# AGENTS.md

> Project instructions and conventions for AI coding agents.

## Overview
- **Project**: `buddhi-ai-sandbox`
- **Type**: Multi-package monorepo (pnpm workspace) containing client-side TypeScript SDKs and a Rust WebAssembly runtime
- **Primary Language/Runtime**: TypeScript 5.4+, Rust 1.83+ (`wasm32-unknown-unknown`), Node.js >= 20.0.0
- **Package Manager**: `pnpm` (workspace enabled)

---

## What is This Project?

`buddhi-ai-sandbox` is an ultra-lightweight, zero-backend, client-side Node.js sandbox running entirely inside modern web browsers. It eliminates the need for expensive container infrastructure, cloud VMs, or remote Docker servers for running user code, interactive tutorials, AI agent runners, and browser-based IDEs.

### Architecture Components

1. **Rust WebAssembly Core (`packages/wasm-core`)**:
   - Crate: `buddhilive-sandbox-core`
   - In-memory POSIX-compliant VirtualFS with `InodeTable`, file metadata, directory hierarchy traversal, and symlink resolution (with 40-hop limit against ELOOP cycles).
   - Low-latency SPSC (single-producer single-consumer) lock-free `SharedArrayBuffer` ring-buffer with atomic signaling for synchronous `stdout`, `stderr`, and `stdin` streaming.
   - Virtual TCP/HTTP port manager maintaining socket state and dispatching HTTP request/response payloads.

2. **Client-Side TypeScript SDK (`packages/sdk`)**:
   - Published as `@buddhilive/sandbox` on npm.
   - Wraps Web Worker execution with an async API (`sandbox.fs.*`, `sandbox.process.*`, `sandbox.ports.*`).
   - Self-contained packaging with inline worker bundle for universal compatibility across Next.js, Vite, Webpack, and Rollup.
   - Pure-JS NPM package installer fetching manifests and tarballs directly from `registry.npmjs.org`, decompressed via `fflate`.
   - Node.js module resolver handling CommonJS `require()`, ES dynamic `import()`, and package entrypoints.

3. **Service Worker HTTP Preview Bridge (`packages/service-worker`)**:
   - Published as `@buddhilive/sandbox-sw`.
   - Intercepts requests to `/__preview/:port/*` and forwards them across `MessageChannel` to internal virtual HTTP servers (`http.createServer().listen(...)`).
   - Injects `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to ensure preview iframes inherit cross-origin isolation.

4. **On-Demand Dynamic Native Toolchain (`packages/toolchain-bundle`)**:
   - Published as `@buddhilive/sandbox-toolchain`.
   - Lazily downloads and initializes Python WASM and Clang/Musl WASM compilers only when `binding.gyp` is detected during package installation, keeping initial SDK bundle size under 100 KB.

5. **Demo Application (`apps/sandbox-demo`)**:
   - Interactive browser application demonstrating script editing, process execution, and live virtual previews.

---

## Commands

### Workspace & Setup
- **Install dependencies**: `pnpm install`
- **Build all workspace packages**: `pnpm run build`
- **Typecheck SDK**: `pnpm --filter=@buddhilive/sandbox run typecheck`
- **Run local demo**: `pnpm dev` (serves `apps/sandbox-demo` at `http://localhost:5173` with COOP/COEP headers)

### Testing
- **WASM Core Unit/Integration Tests (Cargo)**: `pnpm test:wasm` (or `cd packages/wasm-core && cargo test`)
- **SDK Unit Tests (Vitest)**: `pnpm --filter=@buddhilive/sandbox run test:unit`
- **E2E Browser Tests (Playwright)**: `pnpm --filter=@buddhilive/sandbox run test:e2e`

### Rust WebAssembly Build
- **Compile WASM Core**: `cd packages/wasm-core && wasm-pack build --target web --out-dir pkg`

---

## Development Conventions & Non-Negotiables

1. **Grounded Changes**: Ground all edits in real file paths and existing monorepo conventions. Never invent non-existent directories.
2. **Main Thread Isolation**: All runtime execution, filesystem emulation, and compilation MUST execute inside dedicated Web Workers. The browser UI main thread must remain responsive at 60 FPS.
3. **Cross-Origin Isolation**: `SharedArrayBuffer` requires Cross-Origin Isolation (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`). Vite development and preview servers must preserve these headers.
4. **Self-Contained Distribution**: `@buddhilive/sandbox` is distributed as a single, zero-config bundle containing inline worker code to ensure compatibility with consumer bundlers.
5. **Evidence-Based Verification**: Always run verification commands through `terminal-runner` or terminal tools and report actual exit codes and stdout/stderr output.
6. **Spec-Driven Development (SDD)**: Features follow the SDD lifecycle:
   1. `/specify` — create feature branch and refine `spec.md`
   2. `/plan` — synthesize technical architecture into `plan.md`
   3. `/tasks` — break down tasks by user story in `tasks.md`
   4. `/implement` — execute tasks story by story
   5. `/verify` — prove working behavior with real test evidence
   - Use `/quick-plan` for lightweight, non-SDD changes.
