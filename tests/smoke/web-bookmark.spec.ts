import { expect, test } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let vault: string

test.beforeEach(async ({ page }) => {
  await page.route('https://example.com/preview.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#123c2d"/></svg>' }))
  vault = createFixtureVaultCopy()
  await openFixtureVault(page, vault)
  await page.locator('[data-testid="note-list-container"]').getByText('Alpha Project', { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible()
  await page.evaluate(() => {
    window.__mockHandlers.get_bookmark_metadata = () => ({ url: 'https://example.com/', title: 'A useful web page', description: 'Saved page summary for later reading.', image: 'https://example.com/preview.svg', favicon: '' })
  })
})

test.afterEach(() => removeFixtureVaultCopy(vault))

test('creates a web bookmark through slash, edits it, and restores it after switching notes', async ({ page }) => {
  await page.locator('.bn-block-content').last().click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('/bookmark')
  await page.getByRole('option', { name: /Web bookmark/i }).click()
  await expect(page.locator('#bn-suggestion-menu')).toBeHidden()
  const bookmark = page.locator('.tolaria-bookmark')
  await expect(bookmark.getByRole('textbox')).toBeFocused()
  await bookmark.getByRole('textbox').fill('https://example.com/')
  await bookmark.getByRole('button', { name: 'Create bookmark' }).click()
  await expect(bookmark.getByRole('link')).toContainText('A useful web page')
  await expect(bookmark).toContainText('Saved page summary')
  await bookmark.hover()
  await bookmark.getByRole('button', { name: 'Edit bookmark' }).click()
  await expect(bookmark.getByRole('textbox')).toHaveValue('https://example.com/')
  await bookmark.getByRole('button', { name: 'Cancel' }).click()
  await page.keyboard.press('Meta+s')
  await page.locator('[data-testid="note-list-container"]').getByText('Note B', { exact: true }).click()
  await page.locator('[data-testid="note-list-container"]').getByText('Alpha Project', { exact: true }).click()
  await expect(page.locator('.tolaria-bookmark__title')).toHaveText('A useful web page')
  await expect(page.locator('.tolaria-bookmark__image')).toBeVisible()
  await expect.poll(() => page.locator('.tolaria-bookmark__card').evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none')
  await page.screenshot({ path: '/tmp/tolaria-web-bookmark.png' })
})
