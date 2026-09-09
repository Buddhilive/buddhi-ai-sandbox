# BuddhiLive Sandbox

> **Ultra-lightweight, zero-backend, client-side Node.js sandbox running entirely in WebAssembly & Web Workers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-WASM-DEA584.svg)](https://www.rust-lang.org/)

BuddhiLive Sandbox allows modern web applications to instantiate an isolated, fully functional Node.js-compatible execution environment directly inside the user's browser. It eliminates the cost, latency, and operational burden of maintaining backend container pools (Docker, Kubernetes, Firecracker VMs) for running untrusted code, interactive tutorials, AI agent testbeds, and browser-based IDEs.

---

## Key Highlights

- ⚡ **Zero Backend Infrastructure**: Runs 100% client-side in dedicated Web Workers.
- 📁 **POSIX In-Memory VirtualFS**: Full filesystem emulation (`readFile`, `writeFile`, `mkdir`, `readdir`, `stat`, `symlink`) with optional browser persistence (OPFS / IndexedDB).
- 🔄 **Real-Time Streaming I/O**: Lock-free single-producer single-consumer (SPSC) ring buffers built on `SharedArrayBuffer` and `Atomics`.
- 🌐 **In-Browser Web Application Previews**: Captures internal HTTP listeners (`http.createServer().listen(3000)`) via a Service Worker and renders live previews at `/__preview/:port/` inside `<iframe>` tags.
- 📦 **Direct Client-Side NPM Installer**: Fetches manifests and tarballs from `registry.npmjs.org` over browser HTTPS and extracts packages directly into `/node_modules`.
- 🛠️ **On-Demand Dynamic Native Toolchain**: Lazily loads Python and Clang WASM compilers only when native compilation (`binding.gyp` / `node-gyp`) is detected, keeping baseline SDK bundle under **100 KB**.

---

## Monorepo Packages

```text
packages/
├── wasm-core/           # Rust WebAssembly core (buddhilive-sandbox-core)
│                        # Inode VFS, SPSC ring-buffer I/O, virtual TCP port table
├── sdk/                 # Main TypeScript client SDK (@buddhilive/sandbox)
│                        # Sandbox orchestrator, fs/process/ports namespaces, NPM installer
├── service-worker/      # Service Worker HTTP preview bridge (@buddhilive/sandbox-sw)
│                        # Intercepts /__preview/:port/* routes & COOP/COEP injection
└── toolchain-bundle/    # On-demand native compiler bundle (@buddhilive/sandbox-toolchain)
                         # Python WASM runtime & Clang/Musl C/C++ compiler for node-gyp

apps/
└── sandbox-demo/        # Interactive Vite demo application showcasing live execution
```

---

## Developer Setup & Getting Started

### Prerequisites

Ensure you have the following installed on your development machine:

1. **Node.js**: `v20.0.0` or higher ([Download](https://nodejs.org/))
2. **pnpm**: `v9.0.0` or higher (`npm install -g pnpm`)
3. **Rust Toolchain**: `v1.83.0` or higher ([rustup](https://rustup.rs/))
4. **Rust WASM Target**:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```
5. **wasm-pack**:
   ```bash
   cargo install wasm-pack
   ```

---

### Step-by-Step Installation

```bash
# 1. Clone repository
git clone https://github.com/Buddhilive/buddhi-ai-sandbox.git
cd buddhi-ai-sandbox

# 2. Install monorepo dependencies
pnpm install

# 3. Build the Rust WebAssembly core package
cd packages/wasm-core
wasm-pack build --target web --out-dir pkg
cd ../..

# 4. Build all TypeScript packages (SDK, Service Worker, Toolchain)
pnpm run build
```

---

### Running Tests

```bash
# Run Rust WebAssembly Core tests (Cargo)
pnpm test:wasm
# Or directly: cd packages/wasm-core && cargo test

# Run unit tests across all packages (Vitest)
pnpm test:unit

# Run end-to-end browser tests (Playwright Chromium)
pnpm test:e2e
```

---

### Running the Interactive Browser Demo

The demo application showcases writing scripts, streaming stdout/stderr, and previewing web applications:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The Vite server automatically serves the required `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers for `SharedArrayBuffer` execution.

---

## Basic Usage

```typescript
import { Sandbox } from '@buddhilive/sandbox';

// 1. Initialize sandbox
const sandbox = await Sandbox.create();

// 2. Write code to the virtual filesystem
await sandbox.fs.writeFile('/workspace/hello.js', `
  console.log("Hello from inside the client-side Node.js Sandbox!");
  console.log("Process version:", process.version);
`);

// 3. Spawn process and stream output
const proc = await sandbox.process.spawn('node', ['/workspace/hello.js']);
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}

const exitCode = await proc.exit;
console.log('Finished with exit code:', exitCode);

// 4. Dispose sandbox when finished
await sandbox.dispose();
```

---

## Distribution

For guidelines on packaging, versioning, and publishing to the NPM registry and public CDNs, refer to [DISTRIBUTION.md](DISTRIBUTION.md).

---

## License

MIT © [BuddhiAI](LICENSE)
