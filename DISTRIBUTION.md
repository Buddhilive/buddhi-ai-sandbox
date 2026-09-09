# Distribution Guide: BuddhiLive Sandbox

This document outlines how packages in the `buddhi-ai-sandbox` monorepo are built, packaged, versioned, and distributed to public registries and consumers.

---

## Published Packages Overview

| Package Name | Path | Target Audience | Primary Distribution Channel |
|---|---|---|---|
| **`@buddhilive/sandbox`** | `packages/sdk` | Web apps, browser-based IDEs, AI agent runners, tutorials | NPM Registry, CDNs (`esm.sh`, `jsdelivr`, `unpkg`) |
| **`@buddhilive/sandbox-sw`** | `packages/service-worker` | Apps rendering in-browser web server previews in `<iframe>` | NPM Registry, CDNs |
| **`@buddhilive/sandbox-toolchain`** | `packages/toolchain-bundle` | Apps requiring on-demand `node-gyp` native addon builds | NPM Registry, CDNs (lazy dynamic import) |
| **`buddhilive-sandbox-core`** | `packages/wasm-core` | Internal engine compiled to WebAssembly via `wasm-pack` | Embedded directly into `@buddhilive/sandbox` |

---

## Distribution Requirements & Artifacts

### 1. `@buddhilive/sandbox`
- **Output Artifacts**:
  - `dist/index.js` (ESM bundle with embedded inline Web Worker)
  - `dist/index.cjs` (CommonJS bundle)
  - `dist/index.d.ts` (Complete rolled-up TypeScript declarations)
- **Target Size**: Under **20 KB** gzipped (uncompressed ~70 KB).
- **Zero Configuration**: Bundles the Web Worker inline so consumer apps (Next.js, Vite, Nuxt, Webpack) do not need complex asset loaders or worker plugins.

### 2. `@buddhilive/sandbox-sw`
- **Output Artifacts**:
  - `dist/sw.js` (Standalone Service Worker script for registering at site root or `/sw.js`)
  - `dist/sw.d.ts` (TypeScript types for Service Worker communication)
- **Scope**: Typically registered at `/` or `/__preview/` scope in the host domain.

### 3. `@buddhilive/sandbox-toolchain`
- **Output Artifacts**:
  - `dist/index.js` (Lazy loader for Python WASM and Clang WASM compilers)
  - `dist/index.d.ts` (Toolchain interfaces and runner types)
  - `wasm/*.wasm` (WebAssembly binary chunks loaded on-demand when `binding.gyp` is detected)

---

## Release Build Pipeline

Execute the full build and verification pipeline before publishing:

```bash
# 1. Install all dependencies
pnpm install

# 2. Build Rust WebAssembly Core
cd packages/wasm-core
wasm-pack build --target web --out-dir pkg
cd ../..

# 3. Build all TypeScript packages
pnpm run build

# 4. Verify typecheck
pnpm --filter=@buddhilive/sandbox run typecheck

# 5. Run unit tests and browser E2E tests
pnpm test:unit
pnpm test:e2e
```

---

## Publishing to NPM

### 1. Authentication
Ensure you are authenticated to the `@buddhilive` organization on npm:

```bash
npm login
# Verify active user
npm whoami
```

For automated CI environments, ensure `NPM_TOKEN` is configured in repository secrets with publishing permissions.

### 2. Versioning
Bump version numbers in all packages consistently:

```bash
# Example: Minor release
pnpm -r exec npm version minor --no-git-tag-version
```

### 3. Publishing Workspace Packages
Publish all public packages with public access:

```bash
pnpm -r --filter=!sandbox-demo publish --access public
```

---

## CDN Distribution

Once published to npm, `@buddhilive/sandbox` is immediately accessible through modern JavaScript CDNs:

### esm.sh
```html
<script type="module">
  import { Sandbox } from 'https://esm.sh/@buddhilive/sandbox';
  const sandbox = await Sandbox.create();
  // ...
</script>
```

### jsDelivr
```html
<script type="module">
  import { Sandbox } from 'https://cdn.jsdelivr.net/npm/@buddhilive/sandbox/+esm';
  const sandbox = await Sandbox.create();
  // ...
</script>
```

---

## Host Environment Requirements for Consumers

When integrating `@buddhilive/sandbox` into production applications, the host web server must provide Cross-Origin Isolation headers to enable `SharedArrayBuffer` support:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Framework Examples

#### Next.js (`next.config.js`)
```javascript
module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};
```

#### Vite (`vite.config.ts`)
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

---

## Automated CI/CD Release (GitHub Actions)

Recommended GitHub Actions workflow (`.github/workflows/release.yml`):

```yaml
name: Release Packages

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - run: cargo install wasm-pack
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - run: pnpm test:unit
      - run: pnpm -r --filter=!sandbox-demo publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
