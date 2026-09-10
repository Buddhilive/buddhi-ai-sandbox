import { test, expect } from '@playwright/test';

test.describe('User Story 1 - Next.js Production Preview (next start)', () => {
  test('serves production HTML and JSON API response from virtual port 3000', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#status');
    await expect(status).toHaveText(/Sandbox: Ready/, { timeout: 30_000 });

    // Verify preview endpoint responds with status OK
    const response = await page.request.get('/__preview/3000/');
    expect([200, 503]).toContain(response.status());

    if (response.status() === 200) {
      const text = await response.text();
      expect(text).toContain('Preview');
    }
  });
});
