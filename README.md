# BuddhiLive Sandbox

Client-side Node.js sandbox running entirely in WebAssembly & Web Workers.

## Packages

- [`@buddhilive/sandbox`](packages/sdk): Main client-side SDK for Web apps, IDEs, and browser runtimes.
- [`buddhilive-sandbox-core`](packages/wasm-core): Rust WebAssembly core engine with Inode VFS, SPSC ring-buffer I/O, and virtual TCP tables.
- [`@buddhilive/sandbox-sw`](packages/service-worker): Service Worker preview bridge for routing `/__preview/:port/` to in-memory HTTP servers.
- [`@buddhilive/sandbox-toolchain`](packages/toolchain-bundle): On-demand dynamic Python and Clang WASM toolchain for `node-gyp` native addon compilation.
- [`sandbox-demo`](apps/sandbox-demo): Browser demo application showcasing script editing, live execution, and virtual previews.

## Development

```bash
# Install dependencies
pnpm install

# Build WebAssembly core (requires Rust & wasm-pack)
cd packages/wasm-core && wasm-pack build --target web --out-dir pkg

# Build all packages
pnpm run build

# Run unit tests
pnpm test:unit

# Start demo app
pnpm dev
```

## License

MIT © BuddhiLive
