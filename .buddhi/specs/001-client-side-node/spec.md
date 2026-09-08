# Feature Specification: Client-Side Node.js Sandbox NPM SDK

**Feature Branch**: `001-client-side-node`

**Created**: 2026-09-08

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Client-Side NPM SDK & Core Node.js Execution (Priority: P1)

As a frontend developer building a web-based IDE, AI agent runner, or interactive tutorial,
I want to install a published NPM package (e.g., `@buddhilive/sandbox`) into my client-side
JavaScript or TypeScript project, instantiate a sandbox instance directly in the browser,
write files to an in-memory virtual filesystem, and execute Node.js scripts with streaming
standard I/O, so that I can run Node.js code client-side without any backend container
infrastructure.

**Why this priority**: This represents the foundational MVP deliverable. Without an
installable, typed client SDK packaging the Rust-compiled WebAssembly binaries and Web Worker
orchestration, host applications cannot initialize or interact with the virtual POSIX/Node.js
runtime.

**Independent Test**: Can be tested independently by creating a minimal Vite/Next.js/vanilla
TS app, installing the published package via NPM, calling `Sandbox.create()`, writing an
`index.js` file via `sandbox.fs.writeFile()`, running it with
`sandbox.process.spawn('node', ['index.js'])`, and asserting that the string emitted on
`stdout` matches the expected output with exit code `0`.

**Acceptance Scenarios**:

1. **Given** a modern browser app that imports the SDK via `import { Sandbox } from '@mysandbox/core'`,
   **When** the host invokes `const sandbox = await Sandbox.create()`,
   **Then** the SDK boots the Rust-WASM engine in a dedicated Web Worker and transitions to
   a ready state within the specified timeout.

2. **Given** an initialized sandbox instance,
   **When** the host calls `sandbox.fs.writeFile('/workspace/hello.js', 'console.log("Hello from sandbox");')`
   and executes `sandbox.process.spawn('node', ['/workspace/hello.js'])`,
   **Then** the process terminates with exit code `0` and emits `"Hello from sandbox\n"` on
   the `stdout` stream.

3. **Given** a Node.js process executing within the sandbox,
   **When** the process writes data to `process.stderr` or invokes `process.exit(1)`,
   **Then** the SDK stream emits the diagnostic error text on `stderr` and resolves the exit
   promise with code `1` without destabilizing the host browser tab.

---

### User Story 2 - In-Browser Web Application Preview via Virtual URL (Priority: P2)

As a developer running web servers (such as Express, Fastify, or Vite) inside the sandbox,
I want the SDK to detect listening network ports and expose an in-browser local preview URL,
so that the running web application can be rendered directly in an `<iframe>` or preview
window without external network requests or reverse proxies.

**Why this priority**: In-browser web development requires visual feedback. By capturing
virtual TCP/HTTP server listeners inside the sandbox and bridging them to a browser Service
Worker, applications can run and be viewed entirely offline on the client device.

**Independent Test**: Can be tested independently by executing a script that runs
`http.createServer(...).listen(3000)`, listening to the `sandbox.ports.on('listen')` event
in the host app, pointing an `<iframe>` to the returned preview URL, and asserting that the
HTTP response body and status code 200 render within the frame.

**Acceptance Scenarios**:

1. **Given** an active sandbox with the SDK's Service Worker registered,
   **When** internal code calls `.listen(3000)`,
   **Then** the SDK emits a `listen` event with port `3000` and a virtual preview URL
   (e.g., `https://<sandbox-id>.sandbox.internal:3000/` or scoped path `/__preview/:port/`).

2. **Given** a generated preview URL,
   **When** an `<iframe>` or separate tab issues an HTTP GET request to that URL,
   **Then** the Service Worker intercepts the request, forwards the payload across a
   MessageChannel to the virtual TCP listener inside Rust WASM, and streams the HTTP response
   back to the client.

3. **Given** a preview connection,
   **When** the internal Node.js server stops listening or crashes,
   **Then** subsequent requests to the preview URL immediately return a synthetic HTTP 502/503
   service unavailable response rather than hanging indefinitely.

---

### User Story 3 - Pure-JS NPM Package Installation & Module Resolution (Priority: P3)

As a developer executing arbitrary code in the sandbox, I want to run `npm install <package>`
directly within the virtual environment, so that the sandbox fetches package tarballs from
the public NPM registry, unpacks them into the virtual `/node_modules`, and makes them
available to `require()` and `import` statements.

**Why this priority**: Real-world Node.js development relies heavily on third-party libraries.
Enabling client-side package retrieval and resolution against the public registry makes the
sandbox functionally comparable to a standard local Node.js environment.

**Independent Test**: Can be tested independently by running
`await sandbox.process.exec('npm install chalk')`, verifying the creation of
`/node_modules/chalk`, and confirming that a script executing `const chalk = require('chalk')`
runs successfully without module resolution errors.

**Acceptance Scenarios**:

1. **Given** a network-connected browser session,
   **When** the user executes `sandbox.process.exec('npm install lodash')`,
   **Then** the package manifest and archive are downloaded from the NPM registry via browser
   fetch, extracted into `/node_modules`, and recorded in `/package.json`.

2. **Given** a package installed in `/node_modules`,
   **When** a script invokes `require('lodash')`,
   **Then** the internal module resolver locates the entrypoint file from the virtual
   filesystem and executes it correctly.

3. **Given** an attempt to install a non-existent package,
   **When** `npm install non-existent-pkg-404` runs,
   **Then** the process exits with a non-zero exit code and writes a registry 404 error
   message to `stderr`.

---

### User Story 4 - On-Demand Dynamic Toolchain for Native C/Python Builds (Priority: P4)

As a developer installing packages that require native compilation steps (such as `node-gyp`,
Python configuration scripts, or C/C++ builds), I want the sandbox to dynamically load an
on-demand WebAssembly compilation module only when needed, so that native builds succeed
without imposing a 30MB+ payload on initial sandbox boot.

**Why this priority**: Native toolchains (Clang, Musl, Python compiled to WASM) are large
and resource-intensive. Decoupling them into an on-demand dynamic module preserves fast boot
times for pure-JS use cases while still supporting packages with compilation lifecycles.

**Independent Test**: Can be tested independently by running `npm install` on a package
containing a `binding.gyp` file, observing that the SDK triggers an asset download event for
the build toolchain, executes the Python/C compilation within the virtual environment, and
produces a working native addon without crashing the page.

**Acceptance Scenarios**:

1. **Given** a sandbox operating without the native toolchain loaded,
   **When** an `npm install` command detects a package requiring a build script (`binding.gyp`
   or native lifecycle hook),
   **Then** the SDK emits a progress event, downloads the auxiliary WASM toolchain bundle
   (Python + C compiler), and initializes it within the worker.

2. **Given** the loaded toolchain module,
   **When** `node-gyp` executes during package installation,
   **Then** Python and the C compiler execute within the virtual environment, compile the
   source files, and output the compiled artifact into the package's build directory.

3. **Given** a package build that invokes unsupported platform-specific assembly or kernel
   calls,
   **When** compilation fails,
   **Then** the compiler writes clear diagnostic logs to `stderr`, exits gracefully with a
   failure code, and removes incomplete build outputs.

---

### Edge Cases

- **Browser WebAssembly Memory Limits (OOM)**: If a heavy build or memory leak pushes
  WebAssembly beyond allocated memory limits (e.g., 2GB-4GB browser caps), the sandbox must
  catch the allocation fault, emit an `OOMError` through the SDK, and terminate the offending
  process without crashing the host web application.

- **Service Worker Lifecycle & Desynchronization**: If the host page refreshes or the Service
  Worker restarts during an active preview session, the SDK must re-establish its
  communication channels on startup and restore active virtual port mappings.

- **NPM Registry CORS Policies**: If the NPM registry or CDN endpoints lack permissive CORS
  headers for direct browser `fetch()`, the SDK must allow configuring a custom registry
  endpoint or CORS mirror URL via constructor options.

- **Non-Terminating Loops in Sandboxed Code**: If user code runs an infinite synchronous loop
  (e.g., `while(true){}`), the execution running in the background Web Worker must be
  interruptible or terminable via `sandbox.process.kill(pid)` without freezing the browser's
  UI thread.

- **Symlink Support in Node Modules**: Standard `npm` installations rely on symbolic links
  (particularly in `.bin`). The Rust-WASM virtual filesystem must implement POSIX-compatible
  symlink resolution.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The solution MUST be packaged and distributed as an NPM package
  (`@<scope>/<name>`) providing TypeScript type definitions and ES module / CommonJS exports
  for client-side web applications.

- **FR-002**: The SDK MUST initialize all Rust WebAssembly execution, filesystem emulation,
  and runtime logic inside Web Workers, keeping the host application's main thread unblocked.

- **FR-003**: The SDK MUST expose an idiomatic, asynchronous host interface (similar to
  `opensandbox`) structured with dedicated namespaces for `fs`, `process`, and `ports`.

- **FR-004**: The virtual filesystem MUST implement POSIX file operations (`readFile`,
  `writeFile`, `mkdir`, `readdir`, `rm`, `stat`, `symlink`) entirely in memory, with optional
  synchronization to browser persistent storage (IndexedDB or Origin Private File System).

- **FR-005**: The process manager MUST capture and expose real-time readable streams for
  standard I/O (`stdin`, `stdout`, `stderr`), process exit promises, and process cancellation
  (`kill`).

- **FR-006**: The SDK MUST include a Service Worker script that intercepts HTTP traffic to a
  designated virtual URL scheme and forwards requests to the internal listening port inside
  the sandbox.

- **FR-007**: The runtime MUST support fetching package metadata and tarballs from the public
  NPM registry directly over browser HTTPS.

- **FR-008**: The SDK MUST implement a lazy-loading mechanism that defers downloading the
  native build toolchain (Python runtime and C/C++ compiler WASM modules) until a package
  installation explicitly requires native compilation.

- **FR-009**: The native build subsystem MUST execute standard `node-gyp` and Python-based
  pre/post-install build scripts within the virtualized environment.

- **FR-010**: The SDK MUST allow consumers to configure resource limits, including maximum
  memory, command execution timeouts, and custom NPM registry mirror URLs.

### Key Entities

- **Sandbox**: The primary client-side SDK controller class instantiated by the host
  application; manages Web Worker lifecycles, memory boundaries, and subsystem coordination.

- **VirtualFS**: The POSIX filesystem instance running in WebAssembly; maintains the
  in-memory inode table, file metadata, buffers, and directory hierarchies.

- **ProcessHandle**: The handle returned when spawning an execution unit; exposes `stdin`
  (WritableStream), `stdout` (ReadableStream), `stderr` (ReadableStream), `pid`, and an
  exit code promise.

- **PortManager**: The networking registry that tracks internal TCP port binds and maps them
  to active Service Worker preview URLs.

- **ToolchainBundle**: The lazily-loaded binary package containing the WebAssembly-compiled
  Python runtime and C compiler toolchain used for native builds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host web application can install the SDK from NPM, import it, and instantiate
  a functional sandbox in under **1,500 ms** (warm browser cache on modern desktop hardware).

- **SC-002**: The core SDK bundle and baseline WebAssembly runtime (excluding the lazy-loaded
  native toolchain) does **not exceed 15 MB compressed**.

- **SC-003**: **100%** of standard, pure-JavaScript packages from the NPM registry (such as
  `express`, `lodash`, `chalk`, `date-fns`) install and execute without manual polyfills or
  patching.

- **SC-004**: Static HTTP preview requests routed through the Service Worker resolve with an
  internal transfer latency of **less than 25 ms**.

- **SC-005**: Common packages requiring standard `node-gyp` C/Python compilation finish
  building inside the browser in **under 60 seconds** without triggering "Page Unresponsive"
  dialogs.

- **SC-006**: The host browser main UI thread consistently maintains **60 FPS** during script
  execution and package installation workloads.

## Assumptions

- **Target Host Environment**: Modern evergreen desktop browsers (Chrome, Edge, Firefox,
  Safari) with support for WebAssembly, Web Workers, Service Workers, and Cross-Origin
  Isolation (`SharedArrayBuffer` enabled via COOP/COEP headers).

- **Client Distribution**: The primary consumer distribution is an NPM package intended for
  bundlers (Vite, Webpack, Rollup) and modern browser runtimes.

- **Network Connectivity**: The client machine has network access to fetch public NPM registry
  manifests and package tarballs.

- **Compilation Boundary**: In-browser C/Python compilation is limited to portable code
  compatible with WebAssembly/Musl targets; native code requiring raw x86 assembly, direct
  GPU hardware access, or kernel drivers is out of scope.

- **Storage Persistence**: Filesystem storage defaults to an ephemeral in-memory
  configuration, with persistent storage to browser OPFS or IndexedDB available as an opt-in
  adapter.
