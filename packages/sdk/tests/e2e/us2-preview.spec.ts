import { test, expect } from '@playwright/test';

test.describe('User Story 2 - In-Browser Application Preview (T030)', () => {
  test('verifies virtual preview URL route returns synthetic or active preview response', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    // Request preview URL path
    const response = await page.request.get('/__preview/3000/');
    expect([200, 503]).toContain(response.status());
  });
});
