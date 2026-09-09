import { test, expect } from '@playwright/test';

test.describe('User Story 1 - Client-Side Node.js Execution & FS / UI Demo', () => {
  test('downloads wasm, executes fs script with streaming stdout, and renders UI preview', async ({ page }) => {
    await page.goto('/');

    // Verify wasm file is served and reachable via HTTP GET
    const wasmRes = await page.request.get('/buddhilive_sandbox_core_bg.wasm');
    expect(wasmRes.status()).toBe(200);
    expect(wasmRes.headers()['content-type']).toContain('application/wasm');

    // Verify header status reaches Ready
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    // Click run script button for default fs starter demo
    const runBtn = page.locator('#run-btn');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify terminal output receives streamed execution including node fs operations
    const terminal = page.locator('#terminal-output');
    await expect(terminal).toContainText('Hello from inside the client-side Node.js Sandbox!', {
      timeout: 15_000,
    });
    await expect(terminal).toContainText('Process version: v20.12.0');
    await expect(terminal).toContainText('Platform: browser-wasm');
    await expect(terminal).toContainText('Node.js File System (fs) Demo');
    await expect(terminal).toContainText('Created file: /workspace/greeting.txt');
    await expect(terminal).toContainText('Read file content:');
    await expect(terminal).toContainText('Directory listing (/workspace):');
    await expect(terminal).toContainText('[Process exited with code 0]');

    // Verify Live UI Preview iframe receives rendered HTML from /workspace/index.html
    const previewIframe = page.frameLocator('#preview');
    await expect(previewIframe.locator('h2')).toContainText('Live HTML from Node.js VirtualFS');

    // Test UI Generator Preset
    const exampleSelect = page.locator('#example-select');
    await exampleSelect.selectOption('ui');
    await runBtn.click();

    await expect(terminal).toContainText('Generating Interactive HTML UI in Sandbox');
    await expect(previewIframe.locator('h1')).toContainText('WebAssembly Sandbox UI');
    const counterBtn = previewIframe.locator('#inc-btn');
    await counterBtn.click();
    await expect(previewIframe.locator('#counter')).toHaveText('1');
  });
});
