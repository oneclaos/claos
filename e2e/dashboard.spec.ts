import { test, expect, Page } from '@playwright/test'

// Helper to login (assumes test credentials are set up)
async function login(page: Page, password: string = process.env.TEST_PASSWORD || 'test123') {
  await page.goto('/login')
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 10000 })
}

test.describe('Dashboard', () => {
  test.skip(({ browserName }) => !process.env.TEST_PASSWORD, 'Requires TEST_PASSWORD env var')

  test('shows sidebar navigation', async ({ page }) => {
    await login(page)
    
    // Check sidebar elements
    await expect(page.locator('nav')).toBeVisible()
    await expect(page.locator('text=Dashboard')).toBeVisible()
    await expect(page.locator('text=Files')).toBeVisible()
    await expect(page.locator('text=Groups')).toBeVisible()
  })

  test('can navigate to files page', async ({ page }) => {
    await login(page)
    
    // Click Files in sidebar
    await page.click('text=Files')
    
    // Should navigate to files
    await expect(page).toHaveURL(/\/files/)
    await expect(page.locator('text=File Manager')).toBeVisible()
  })

  test('can navigate to groups page', async ({ page }) => {
    await login(page)
    
    // Click Groups in sidebar
    await page.click('text=Groups')
    
    // Should navigate to groups
    await expect(page).toHaveURL(/\/groups/)
  })

  test('can navigate to settings', async ({ page }) => {
    await login(page)
    
    // Click Settings in sidebar
    await page.click('text=Settings')
    
    // Should navigate to settings
    await expect(page).toHaveURL(/\/settings/)
  })
})
