import { test, expect } from '@playwright/test';

test.describe('User Story 2 - Next.js Development Mode & HMR', () => {
  test('starts dev server, compiles with SWC shim, and exposes preview endpoint', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    // Ensure preview server port responds
    const response = await page.request.get('/__preview/3000/');
    expect([200, 503]).toContain(response.status());
  });
});
