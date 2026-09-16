import { Sandbox } from '@buddhilive/sandbox';

const statusEl = document.getElementById('status') as HTMLElement;
const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const refreshPreviewBtn = document.getElementById('refresh-preview-btn') as HTMLButtonElement;
const editorEl = document.getElementById('code-editor') as HTMLTextAreaElement;
const terminalEl = document.getElementById('terminal-output') as HTMLPreElement;
const previewIframe = document.getElementById('preview') as HTMLIFrameElement;
const exampleSelect = document.getElementById('example-select') as HTMLSelectElement;

let sandbox: Sandbox | null = null;

const PRESETS: Record<string, string> = {
  fs: `// Node.js File System (fs) in WebAssembly VirtualFS
const fs = require('fs');
const path = require('path');

console.log("Hello from inside the client-side Node.js Sandbox!");
console.log("Process version:", process.version);
console.log("Platform:", process.platform);

console.log("\\n=== Node.js File System (fs) Demo ===");
const workDir = '/workspace';
const sampleFile = path.join(workDir, 'greeting.txt');

// 1. Write file using fs.writeFileSync
fs.writeFileSync(sampleFile, 'Hello from Node.js fs module in WebAssembly sandbox!\\nTimestamp: ' + new Date().toISOString());
console.log("✓ Created file:", sampleFile);

// 2. Read file using fs.readFileSync
const data = fs.readFileSync(sampleFile, 'utf-8');
console.log("✓ Read file content:\\n" + data);

// 3. Inspect metadata using fs.statSync
const stat = fs.statSync(sampleFile);
console.log(\`✓ File stat - Size: \${stat.size} bytes, IsFile: \${stat.isFile()}\`);

// 4. Create an interactive HTML UI file
const htmlPath = path.join(workDir, 'index.html');
const sampleHtml = \`<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; background: #f0fdf4; color: #166534; }
    .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    h2 { margin-top: 0; color: #15803d; }
    code { background: #dcfce7; padding: 0.2rem 0.4rem; border-radius: 4px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🌿 Live HTML from Node.js VirtualFS</h2>
    <p>This file was generated inside the sandbox using: <br><code>fs.writeFileSync('/workspace/index.html', ...)</code></p>
    <p>Read from <code>\${sampleFile}</code>: <em>\${data.split('\\n')[0]}</em></p>
  </div>
</body>
</html>\`;

fs.writeFileSync(htmlPath, sampleHtml);
console.log("✓ Created live HTML preview file:", htmlPath);

// 5. List directory contents using fs.readdirSync
const files = fs.readdirSync(workDir);
console.log("✓ Directory listing (/workspace):", files);
`,

  ui: `// Interactive HTML / UI Generator Preset
const fs = require('fs');

console.log("Hello from inside the client-side Node.js Sandbox!");
console.log("Process version:", process.version);
console.log("Platform:", process.platform);

console.log("\\n=== Generating Interactive HTML UI in Sandbox ===");

const htmlContent = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sandbox UI Preview</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      color: #f8fafc;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .container {
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 1rem;
      padding: 2rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    h1 {
      font-size: 1.4rem;
      margin-top: 0;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    .counter-box {
      margin: 1.5rem 0;
      padding: 1rem;
      background: #0f172a;
      border-radius: 0.5rem;
      border: 1px solid #334155;
    }
    .count-display {
      font-size: 2.5rem;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 0.5rem;
    }
    button {
      background: #0284c7;
      color: white;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 0.375rem;
      font-size: 0.95rem;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s, transform 0.1s;
    }
    button:hover { background: #0369a1; }
    button:active { transform: scale(0.96); }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      padding: 0.25rem 0.5rem;
      border-radius: 9999px;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 WebAssembly Sandbox UI</h1>
    <p>This interactive component is stored in the POSIX VirtualFS and rendered live in the browser!</p>
    <div class="counter-box">
      <div id="counter" class="count-display">0</div>
      <button id="inc-btn">Click to Increment</button>
    </div>
    <span class="badge">✓ Zero Backend • 100% Client-Side</span>
  </div>
  <script>
    let count = 0;
    const btn = document.getElementById('inc-btn');
    const display = document.getElementById('counter');
    btn.addEventListener('click', () => {
      count++;
      display.textContent = count;
    });
  </script>
</body>
</html>\`;

fs.writeFileSync('/workspace/index.html', htmlContent);
console.log("✓ Wrote /workspace/index.html (" + htmlContent.length + " bytes)");
console.log("✓ Live UI Preview updated on the right panel!");
`,

  http: `// Virtual HTTP Server Example
const http = require('http');

console.log("Hello from inside the client-side Node.js Sandbox!");
console.log("Process version:", process.version);
console.log("Platform:", process.platform);

console.log("\\n=== Starting Virtual HTTP Server ===");

const server = http.createServer((req, res) => {
  console.log("Incoming request:", req.url);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(\`✓ Server listening on port \${PORT}\`);
  console.log(\`✓ Preview bridge route: /__preview/\${PORT}/\`);
});
`,
};

function appendTerminal(text: string, isError = false) {
  const span = document.createElement('span');
  if (isError) {
    span.style.color = '#ef4444';
  }
  span.textContent = text;
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

async function updateLivePreview() {
  if (!sandbox) return;
  try {
    const htmlContent = await sandbox.fs.readFile('/workspace/index.html', 'utf-8');
    previewIframe.srcdoc = htmlContent;
  } catch (_) {
    // If no /workspace/index.html exists, show a friendly placeholder
    previewIframe.srcdoc = `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: #64748b; background: #f8fafc; text-align: center; padding: 1rem;">
  <div>
    <h3>No UI rendered yet</h3>
    <p>Run a script that writes to <code>/workspace/index.html</code> to view live UI.</p>
  </div>
</body>
</html>`;
  }
}

async function init() {
  try {
    statusEl.textContent = 'Sandbox: Booting WebAssembly runtime...';
    sandbox = await Sandbox.create({
      wasmUrl: '/buddhilive_sandbox_core_bg.wasm',
    });
    statusEl.textContent = 'Sandbox: Ready';
    runBtn.disabled = false;

    // Listen for virtual port events
    sandbox.ports.on('listen', ({ port, url }) => {
      appendTerminal(`[Preview Bridge] Port ${port} active: ${url}\n`);
      previewIframe.removeAttribute('srcdoc');
      previewIframe.src = url;
    });

    appendTerminal('=== BuddhiLive Client-Side Node.js Sandbox Initialized ===\n');
    appendTerminal('WebAssembly Core & POSIX In-Memory VirtualFS mounted at /\n\n');

    // Initial placeholder in preview
    await updateLivePreview();
  } catch (err: any) {
    statusEl.textContent = 'Sandbox: Failed to initialize';
    appendTerminal(`Failed to initialize sandbox: ${err?.message || err}\n`, true);
  }
}

// Preset selection
editorEl.value = PRESETS['fs'];

exampleSelect.addEventListener('change', () => {
  const key = exampleSelect.value;
  if (PRESETS[key]) {
    editorEl.value = PRESETS[key];
  }
});

refreshPreviewBtn.addEventListener('click', () => {
  updateLivePreview();
});

runBtn.addEventListener('click', async () => {
  if (!sandbox) return;

  runBtn.disabled = true;
  statusEl.textContent = 'Sandbox: Running script...';

  try {
    const code = editorEl.value;
    await sandbox.fs.writeFile('/workspace/index.js', code);

    appendTerminal(`\n$ node /workspace/index.js\n`);
    const proc = await sandbox.process.spawn('node', ['/workspace/index.js']);

    const reader = proc.stdout.getReader();
    const errReader = proc.stderr.getReader();
    const decoder = new TextDecoder();

    const readOut = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) appendTerminal(decoder.decode(value, { stream: true }));
        }
      } catch (_) {}
    };

    const readErr = async () => {
      try {
        while (true) {
          const { done, value } = await errReader.read();
          if (done) break;
          if (value) appendTerminal(decoder.decode(value, { stream: true }), true);
        }
      } catch (_) {}
    };

    await Promise.all([readOut(), readErr()]);
    const exitCode = await proc.exit;
    appendTerminal(`[Process exited with code ${exitCode}]\n`);

    // Check and update live UI preview
    await updateLivePreview();
  } catch (err: any) {
    appendTerminal(`Execution error: ${err?.message || err}\n`, true);
  } finally {
    runBtn.disabled = false;
    statusEl.textContent = 'Sandbox: Ready';
  }
});

clearBtn.addEventListener('click', () => {
  terminalEl.textContent = '';
});

// --- PDF Research Engine Demo Integration ---
const viewSandboxBtn = document.getElementById('view-sandbox-btn') as HTMLButtonElement;
const viewPdfBtn = document.getElementById('view-pdf-btn') as HTMLButtonElement;
const sandboxMain = document.getElementById('sandbox-main') as HTMLElement;
const pdfMain = document.getElementById('pdf-main') as HTMLElement;
const examplePickerWrapper = document.getElementById('example-picker-wrapper') as HTMLElement;

const pdfDropzone = document.getElementById('pdf-dropzone') as HTMLElement;
const pdfFileInput = document.getElementById('pdf-file-input') as HTMLInputElement;
const pdfSampleBtn = document.getElementById('pdf-sample-btn') as HTMLButtonElement;
const pdfProgressCard = document.getElementById('pdf-progress-card') as HTMLElement;
const pdfStageBadge = document.getElementById('pdf-stage-badge') as HTMLElement;
const pdfProgressBar = document.getElementById('pdf-progress-bar') as HTMLElement;
const pdfProgressMsg = document.getElementById('pdf-progress-msg') as HTMLElement;
const pdfProgressPct = document.getElementById('pdf-progress-pct') as HTMLElement;
const pdfMetaCard = document.getElementById('pdf-meta-card') as HTMLElement;
const pdfMetaTitle = document.getElementById('pdf-meta-title') as HTMLElement;
const pdfMetaPages = document.getElementById('pdf-meta-pages') as HTMLElement;
const pdfMetaTime = document.getElementById('pdf-meta-time') as HTMLElement;
const pdfMarkdownOutput = document.getElementById('pdf-markdown-output') as HTMLTextAreaElement;
const pdfAstOutput = document.getElementById('pdf-ast-output') as HTMLElement;
const copyMarkdownBtn = document.getElementById('copy-markdown-btn') as HTMLButtonElement;
const copyJsonBtn = document.getElementById('copy-json-btn') as HTMLButtonElement;

if (viewSandboxBtn && viewPdfBtn) {
  viewSandboxBtn.addEventListener('click', () => {
    sandboxMain.style.display = 'grid';
    pdfMain.style.display = 'none';
    examplePickerWrapper.style.display = 'flex';
    viewSandboxBtn.style.color = '#f8fafc';
    viewPdfBtn.style.color = 'var(--accent)';
  });

  viewPdfBtn.addEventListener('click', () => {
    sandboxMain.style.display = 'none';
    pdfMain.style.display = 'grid';
    examplePickerWrapper.style.display = 'none';
    viewPdfBtn.style.color = '#f8fafc';
    viewSandboxBtn.style.color = '#94a3b8';
  });
}

async function processPdfBuffer(buffer: Uint8Array, name: string) {
  if (!sandbox) return;

  pdfProgressCard.style.display = 'block';
  pdfMetaCard.style.display = 'none';
  pdfMarkdownOutput.value = 'Processing PDF extraction pipeline...';
  pdfAstOutput.textContent = 'Processing...';

  const startTime = performance.now();

  try {
    const result = await sandbox.pdfEngine.extract(buffer, {
      cacheInVfs: true,
      documentId: name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      onProgress: (p) => {
        pdfStageBadge.textContent = p.stage;
        pdfProgressBar.style.width = `${p.percent}%`;
        pdfProgressPct.textContent = `${Math.round(p.percent)}%`;
        pdfProgressMsg.textContent = p.message;
      },
    });

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

    pdfMetaCard.style.display = 'block';
    pdfMetaTitle.innerHTML = `<strong>Title:</strong> ${result.metadata.title || name}`;
    pdfMetaPages.innerHTML = `<strong>Pages:</strong> ${result.metadata.totalPages}`;
    pdfMetaTime.innerHTML = `<strong>Duration:</strong> ${elapsed}s`;

    pdfMarkdownOutput.value = result.markdown;
    pdfAstOutput.textContent = JSON.stringify(
      {
        id: result.id,
        metadata: result.metadata,
        toc: result.toc,
        pagesCount: result.pages.length,
        pages: result.pages,
      },
      null,
      2
    );
  } catch (err: any) {
    pdfProgressMsg.textContent = `Error: ${err?.message || err}`;
    pdfProgressBar.style.background = '#ef4444';
    pdfMarkdownOutput.value = `Extraction failed:\n${err?.message || err}`;
  }
}

if (pdfDropzone && pdfFileInput) {
  pdfDropzone.addEventListener('click', () => pdfFileInput.click());

  pdfDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    pdfDropzone.style.borderColor = 'var(--accent)';
    pdfDropzone.style.background = 'rgba(14, 165, 233, 0.15)';
  });

  pdfDropzone.addEventListener('dragleave', () => {
    pdfDropzone.style.borderColor = 'var(--border)';
    pdfDropzone.style.background = 'rgba(15, 23, 42, 0.6)';
  });

  pdfDropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    pdfDropzone.style.borderColor = 'var(--border)';
    pdfDropzone.style.background = 'rgba(15, 23, 42, 0.6)';

    const file = e.dataTransfer?.files[0];
    if (file && file.name.endsWith('.pdf')) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await processPdfBuffer(buffer, file.name);
    }
  });

  pdfFileInput.addEventListener('change', async () => {
    const file = pdfFileInput.files?.[0];
    if (file) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await processPdfBuffer(buffer, file.name);
    }
  });
}

if (pdfSampleBtn) {
  pdfSampleBtn.addEventListener('click', async () => {
    const sampleBytes = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 75 >>\nstream\nBT /F1 14 Tf 72 720 Td (Attention Is All You Need) Tj 0 -24 Td (Abstract) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000214 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n340\n%%EOF\n"
    );
    await processPdfBuffer(sampleBytes, 'sample_research_paper.pdf');
  });
}

if (copyMarkdownBtn && pdfMarkdownOutput) {
  copyMarkdownBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(pdfMarkdownOutput.value);
    copyMarkdownBtn.textContent = 'Copied!';
    setTimeout(() => (copyMarkdownBtn.textContent = 'Copy'), 2000);
  });
}

if (copyJsonBtn && pdfAstOutput) {
  copyJsonBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(pdfAstOutput.textContent || '');
    copyJsonBtn.textContent = 'Copied!';
    setTimeout(() => (copyJsonBtn.textContent = 'Copy JSON'), 2000);
  });
}

init();
