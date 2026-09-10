# Phase 1 Quickstart: Running Next.js 16 in BuddhiLive Sandbox

This guide shows how to run a Next.js 16 project (App Router) in dev mode and production mode inside `@buddhilive/sandbox`.

## 1. Setup Sandbox with Memory Quota

```typescript
import { Sandbox } from '@buddhilive/sandbox';

const sandbox = await Sandbox.create({
  maxMemoryMb: 1024, // Recommended for Next.js builds
  commandTimeoutMs: 60000,
});
```

## 2. Write Next.js App Router Files

```typescript
// 1. Package configuration
await sandbox.fs.writeFile('/workspace/package.json', JSON.stringify({
  name: 'my-next-app',
  version: '0.1.0',
  scripts: {
    dev: 'next dev',
    build: 'next build',
    start: 'next start'
  },
  dependencies: {
    next: '^16.0.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0'
  }
}, null, 2));

// 2. Next.js configuration
await sandbox.fs.writeFile('/workspace/next.config.js', `
  module.exports = {
    reactStrictMode: true,
  };
`);

// 3. Root layout
await sandbox.fs.mkdir('/workspace/app', { recursive: true });
await sandbox.fs.writeFile('/workspace/app/layout.tsx', `
  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }
`);

// 4. Home page (React Server Component)
await sandbox.fs.writeFile('/workspace/app/page.tsx', `
  export default function HomePage() {
    return (
      <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>Welcome to Next.js in BuddhiLive Sandbox!</h1>
        <p>Running 100% client-side in WebAssembly & Web Workers.</p>
      </main>
    );
  }
`);
```

## 3. Run Development Mode with Live Preview & HMR

```typescript
// Listen for virtual server binding
sandbox.ports.on('listen', ({ port, url }) => {
  console.log(`Next.js Dev Server listening on port ${port}: ${url}`);
  // Mount in your UI:
  document.getElementById('preview-iframe').src = url;
});

// Spawn next dev
const proc = await sandbox.process.spawn('node', ['node_modules/.bin/next', 'dev'], {
  cwd: '/workspace'
});

// Trigger HMR: edit file
await sandbox.fs.writeFile('/workspace/app/page.tsx', `
  export default function HomePage() {
    return (
      <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>HMR Update Received!</h1>
        <p>Hot reloaded in browser without full refresh.</p>
      </main>
    );
  }
`);
```

## 4. Run Production Build & Start

```typescript
// 1. Run build
const buildProc = await sandbox.process.exec('node node_modules/.bin/next build');
console.log('Build output:', buildProc.stdout);

// 2. Start production server
const startProc = await sandbox.process.spawn('node', ['node_modules/.bin/next', 'start'], {
  cwd: '/workspace'
});
```
