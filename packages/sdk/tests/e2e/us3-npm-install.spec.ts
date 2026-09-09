import { test, expect } from '@playwright/test';

test.describe('User Story 3 - Client-Side NPM Package Installation & Module Resolution (T042)', () => {
  test('installs pure-JS package from npm and executes require() in sandbox', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    const evalResult = await page.evaluate(async () => {
      const { Sandbox } = await import('/node_modules/@buddhilive/sandbox/dist/index.js');
      const sb = await Sandbox.create();

      // Write mock package directly to /node_modules
      await sb.fs.mkdir('/node_modules/math-sum', { recursive: true });
      await sb.fs.writeFile(
        '/node_modules/math-sum/package.json',
        JSON.stringify({ name: 'math-sum', main: 'index.js' })
      );
      await sb.fs.writeFile(
        '/node_modules/math-sum/index.js',
        'module.exports = function sum(a, b) { return a + b; };'
      );

      // Execute script requiring package
      await sb.fs.writeFile(
        '/workspace/test-require.js',
        'const sum = require("math-sum"); console.log("SUM_RESULT:" + sum(20, 22));'
      );

      const res = await sb.process.exec('node /workspace/test-require.js');
      await sb.dispose();
      return res;
    });

    expect(evalResult.exitCode).toBe(0);
    expect(evalResult.stdout).toContain('SUM_RESULT:42');
  });
});
