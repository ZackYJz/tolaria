import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
  await page.locator('[data-testid="note-list-container"]')
    .getByText('Alpha Project', { exact: true })
    .click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function insertCallout(page: Page) {
  await page.locator('.bn-block-content').last().click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await expect(page.locator('#bn-suggestion-menu')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('#tolaria-fatal-render-error')).toHaveCount(0)
  await page.keyboard.type('call')
  const calloutItem = page.getByRole('option', { name: /Callout/i })
  await expect(calloutItem).toBeVisible({ timeout: 5_000 })
  await calloutItem.click()
  const callout = page.locator('.tolaria-callout')
  await expect(callout).toBeVisible({ timeout: 5_000 })
  return callout
}

test('callout slash command inserts a full-width Notion-style block with a selectable icon', async ({ page }) => {
  const callout = await insertCallout(page)
  await expect(page.locator('.tolaria-slash-menu__submenu')).toHaveCount(0)
  await expect(callout.locator('.tolaria-callout__header')).toHaveCount(0)
  await expect(callout.getByRole('button', { name: 'Icon' })).toContainText('💡')
  await expect.poll(async () => callout.evaluate((element) => {
    const blockContent = element.closest<HTMLElement>('.bn-block-content')
    if (!blockContent) return false
    return Math.abs(element.getBoundingClientRect().width - blockContent.getBoundingClientRect().width) < 1
  })).toBe(true)
  await expect.poll(async () => callout.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('.tolaria-callout__icon-button')
    const body = element.querySelector<HTMLElement>('.tolaria-callout__body')
    if (!icon || !body) return null
    const calloutStyle = getComputedStyle(element)
    const iconBounds = icon.getBoundingClientRect()
    const bodyBounds = body.getBoundingClientRect()
    return {
      bodyTop: Math.round(bodyBounds.top),
      columnGap: calloutStyle.columnGap,
      hasVisibleBackground: !['rgba(0, 0, 0, 0)', 'transparent'].includes(calloutStyle.backgroundColor),
      iconHeight: Math.round(iconBounds.height),
      iconTop: Math.round(iconBounds.top),
      iconWidth: Math.round(iconBounds.width),
      paddingBottom: calloutStyle.paddingBottom,
      paddingTop: calloutStyle.paddingTop,
    }
  })).toEqual({
    bodyTop: expect.any(Number),
    columnGap: '8px',
    hasVisibleBackground: true,
    iconHeight: 24,
    iconTop: expect.any(Number),
    iconWidth: 24,
    paddingBottom: '16px',
    paddingTop: '16px',
  })
  const verticalAlignment = await callout.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('.tolaria-callout__icon-button')
    const body = element.querySelector<HTMLElement>('.tolaria-callout__body')
    if (!icon || !body) return Number.POSITIVE_INFINITY
    return Math.abs(icon.getBoundingClientRect().top - body.getBoundingClientRect().top)
  })
  expect(verticalAlignment).toBeLessThan(1)

  await callout.getByRole('button', { name: 'Icon' }).click()
  const emojiPicker = page.getByTestId('emoji-picker')
  await expect(emojiPicker).toBeVisible()
  await page.getByTestId('emoji-picker-search').fill('rocket')
  await emojiPicker.getByTitle('rocket').click()
  await expect(callout.getByRole('button', { name: 'Icon' })).toContainText('🚀')

  await callout.locator('.tolaria-callout__body').click()
  await page.keyboard.type('First line')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Second line')
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  const rawContent = (await page.locator('.cm-line').allTextContents()).join('\n')

  expect(rawContent).toContain('> [!note] 🚀\n> First line\n> Second line')
  expect(rawContent).not.toMatch(/\\$/mu)
})
