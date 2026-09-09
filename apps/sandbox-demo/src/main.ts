import { Sandbox } from '@buddhilive/sandbox';

const statusEl = document.getElementById('status') as HTMLElement;
const runBtn = document.getElementById('run-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const editorEl = document.getElementById('code-editor') as HTMLTextAreaElement;
const terminalEl = document.getElementById('terminal-output') as HTMLPreElement;

let sandbox: Sandbox | null = null;

function appendTerminal(text: string, isError = false) {
  const span = document.createElement('span');
  if (isError) {
    span.style.color = '#ef4444';
  }
  span.textContent = text;
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

async function init() {
  try {
    statusEl.textContent = 'Sandbox: Booting WebAssembly runtime in Worker...';
    sandbox = await Sandbox.create();
    statusEl.textContent = 'Sandbox: Ready (Client-Side Node.js)';
    runBtn.disabled = false;
    appendTerminal('=== BuddhiLive Client-Side Node.js Sandbox Initialized ===\n');
    appendTerminal('POSIX In-Memory VirtualFS mounted at /\n\n');
  } catch (err: any) {
    statusEl.textContent = 'Sandbox: Failed to initialize';
    appendTerminal(`Failed to initialize sandbox: ${err?.message || err}\n`, true);
  }
}

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

init();
