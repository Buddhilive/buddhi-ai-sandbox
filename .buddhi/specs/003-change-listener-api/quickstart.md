# Developer Quickstart: File Change Listener API

**Branch**: `003-change-listener-api` | **Date**: 2026-09-11

---

## Basic Usage

```typescript
import { Sandbox } from '@buddhilive/sandbox';

const sb = await Sandbox.create();

// 1. Subscribe to file system change events
const unsubscribe = sb.fs.on('change', (event) => {
  console.log(`[FS Event] ${event.type.toUpperCase()}: ${event.path}`);
  // event.path is always normalized, e.g. '/src/index.ts'
  // event.type is 'create' | 'update' | 'delete'
});

// 2. Perform file operations via Host SDK
await sb.fs.writeFile('/index.js', 'console.log("hello");');
// => [FS Event] CREATE: /index.js

await sb.fs.writeFile('/index.js', 'console.log("updated");');
// => [FS Event] UPDATE: /index.js

await sb.fs.rm('/index.js');
// => [FS Event] DELETE: /index.js

// 3. Observe changes initiated inside Worker scripts
const proc = await sb.process.spawn('node', [
  '-e',
  'const fs = require("fs"); fs.writeFileSync("/out.txt", "123"); fs.unlinkSync("/out.txt");'
]);
await proc.wait();
// => [FS Event] CREATE: /out.txt
// => [FS Event] DELETE: /out.txt

// 4. Unsubscribe when done
unsubscribe();
// Or alternatively:
// sb.fs.off('change', handler);
```
