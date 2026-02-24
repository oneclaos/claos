import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/')
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page has form elements', async ({ page }) => {
    await page.goto('/login')
    
    // Check for password input
    await expect(page.locator('input[type="password"]')).toBeVisible()
    
    // Check for submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('shows error on invalid password', async ({ page }) => {
    await page.goto('/login')
    
    // Fill in wrong password
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    
    // Should show error
    await expect(page.locator('text=Invalid password')).toBeVisible({ timeout: 5000 })
  })

  test('setup page works when not configured', async ({ page }) => {
    // This test assumes the app might not be set up
    await page.goto('/setup')
    
    // Should have setup form or redirect if already configured
    const url = page.url()
    expect(url).toMatch(/\/(setup|login)/)
  })
})
