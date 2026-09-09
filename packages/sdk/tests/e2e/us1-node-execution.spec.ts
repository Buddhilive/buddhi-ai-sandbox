import { test, expect } from '@playwright/test';

test.describe('User Story 1 - Client-Side Node.js Execution (T019)', () => {
  test('initializes sandbox and executes Node.js script in browser with streaming stdout', async ({ page }) => {
    await page.goto('/');

    // Verify header status reaches Ready
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    // Click run script button
    const runBtn = page.locator('#run-btn');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify terminal output receives streamed execution
    const terminal = page.locator('#terminal-output');
    await expect(terminal).toContainText('Hello from inside the client-side Node.js Sandbox!', {
      timeout: 15_000,
    });
    await expect(terminal).toContainText('Process version: v20.12.0');
    await expect(terminal).toContainText('Platform: browser-wasm');
    await expect(terminal).toContainText('[Process exited with code 0]');
  });
});
