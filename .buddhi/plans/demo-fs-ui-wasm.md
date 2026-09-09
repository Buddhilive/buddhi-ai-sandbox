# Plan: Demo FS Starter, UI Preview, and WASM Verification

## Overview
- Project: `apps/sandbox-demo` & `packages/sdk`
- Goals:
  1. Diagnose why no `.wasm` file is downloaded in DevTools Network tab and connect the Rust WebAssembly core (`packages/wasm-core`).
  2. Implement built-in `fs` and `path` module emulation in the sandbox worker environment so Node.js scripts can run `require('fs')`.
  3. Replace the minimal demo script with a real Node.js File System (`fs`) starter example.
  4. Add a Live UI Preview pane and an HTML UI generator preset to preview rendered HTML/CSS from inside the sandbox.

---

## 1. WebAssembly Core Verification & Resolution
- **Finding**: `apps/sandbox-demo` imports `@buddhilive/sandbox`, but `packages/sdk/src/worker/sandbox.worker.ts` currently uses a pure JS/TS mock filesystem and does not import `buddhilive-sandbox-core` (`packages/wasm-core/pkg`). As a result, no `.wasm` file is requested by the browser.
- **Resolution**:
  - Add workspace dependency `buddhilive-sandbox-core` to `packages/sdk/package.json`.
  - In `sandbox.worker.ts`, import `initSync`/`init` and bind VFS operations to the Rust WASM module.
  - Vite will bundle and fetch `buddhilive_sandbox_core_bg.wasm`, making it visible in DevTools Network tab.

---

## 2. Built-in `fs` Module in Sandbox Worker
- Implement built-in `fs` in `virtualRequire`:
  - `fs.readFileSync(path, encoding)`
  - `fs.writeFileSync(path, content, encoding)`
  - `fs.readdirSync(path)`
  - `fs.statSync(path)`
  - `fs.existsSync(path)`
  - `fs.mkdirSync(path)`
  - `fs.promises` equivalent async APIs.
- Provide `path.join`, `path.resolve`, etc.

---

## 3. Demo Enhancements (`apps/sandbox-demo`)
- Add preset dropdown:
  1. **Node.js `fs` Starter** (Default): Writes files, reads them back, lists `/workspace`, checks stat.
  2. **UI / HTML Generator**: Generates an interactive styled HTML page (`/workspace/index.html`) and triggers live preview.
  3. **HTTP Server Preview**: Starts an HTTP server on port 3000 bridged to the preview route.
- Add 3rd panel: **Live UI Preview** (`<iframe id="preview">`) alongside Code Editor and Terminal Output.
- In `main.ts`, automatically render `/workspace/index.html` into the preview iframe or handle port listening events.

---

## 4. Verification Plan
- Unit tests: `pnpm --filter=@buddhilive/sandbox run test:unit`
- Typecheck: `pnpm --filter=@buddhilive/sandbox run typecheck`
- Playwright E2E: `pnpm --filter=@buddhilive/sandbox run test:e2e`
- Browser DevTools verification: check Network tab for `.wasm` download and test presets.
