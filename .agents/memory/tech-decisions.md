# Tech Decisions

No entries yet. Architecture and technology decisions and why they were made
get appended here by `/remember` or other harness work, one entry per line,
newest last.

## 001-client-side-node (2026-09-09)

- **JS execution model**: QuickJS embedded in Rust WASM (qjs-rs) — one QuickJS context per spawned process, all sharing the same WASM Worker. Rejected one-Worker-per-process (memory overhead) and WASM-compiled V8 (30MB+ binary, violates SC-002 ≤15MB). See plan.md §Decision 1.

- **Worker I/O bridge**: SharedArrayBuffer + Atomics (SPSC ring buffer, 64KB per stream, 3 SABs per process: stdout/stderr/stdin). Enables synchronous Node.js `require()` and `*Sync` fs APIs from within the QuickJS thread. Requires COOP/COEP headers on host page. Async-only postMessage rejected because it cannot satisfy synchronous Node.js semantics. See plan.md §Decision 2.

- **Preview URL scheme**: Path-scoped `/__preview/:port/` intercepted by a registered Service Worker. Rejected subdomain scheme (`<id>.sandbox.internal`) — requires wildcard DNS, unreliable cross-browser. See plan.md §Decision 3.

- **Monorepo structure**: pnpm workspace with 4 packages: `packages/wasm-core` (Rust), `packages/sdk` (TS, published as @buddhilive/sandbox), `packages/service-worker`, `packages/toolchain-bundle` (lazy P4). Build pipeline: wasm-pack (Rust) → Vite lib mode (TS SDK). Toolchain bundle lazy-loaded only when `binding.gyp` detected during npm install.

