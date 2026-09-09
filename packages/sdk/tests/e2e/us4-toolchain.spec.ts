import { test, expect } from '@playwright/test';
import { ToolchainBundle } from '@buddhilive/sandbox-toolchain';

test.describe('User Story 4 - Native Build Toolchain (T052)', () => {
  test('dynamically loads ToolchainBundle and executes native compilation pipeline', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    const progress: number[] = [];
    const toolchain = await ToolchainBundle.load((loaded, total) => {
      progress.push(Math.round((loaded / total) * 100));
    });

    const buildRes = await toolchain.runNodeGyp('/node_modules/native-addon');

    expect(progress.length).toBeGreaterThan(0);
    expect(buildRes.exitCode).toBe(0);
    expect(buildRes.stdout).toContain('node-gyp configure');
    expect(buildRes.stdout).toContain('Clang WASM');
  });
});
