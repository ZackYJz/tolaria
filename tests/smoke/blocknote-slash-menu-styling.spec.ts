import { test, expect, type Locator, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

async function openAlphaProject(page: Page) {
  await openFixtureVault(page, tempVaultDir)
  await page.getByText('Alpha Project', { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 10_000 })
}

async function openSlashMenu(page: Page) {
  await page.locator('.bn-editor').click()
  await page.keyboard.type('/')

  const menu = page.locator('.bn-suggestion-menu')
  await expect(menu).toBeVisible({ timeout: 5_000 })
  return menu
}

async function probeSlashMenuScroll(menu: Locator) {
  return menu.evaluate(async (node) => {
    const menuElement = node as HTMLElement
    const decoration = document.querySelector<HTMLElement>('[data-decoration-id]')
    if (!decoration) throw new Error('Missing suggestion menu decoration')

    let decorationRectReads = 0
    const originalGetBoundingClientRect = decoration.getBoundingClientRect.bind(decoration)
    decoration.getBoundingClientRect = () => {
      decorationRectReads += 1
      return originalGetBoundingClientRect()
    }

    const maxScrollTop = menuElement.scrollHeight - menuElement.clientHeight
    menuElement.scrollTop = Math.max(1, Math.floor(maxScrollTop / 2))
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    }))

    return {
      decorationRectReads,
      maxScrollTop,
      scrollTop: menuElement.scrollTop,
    }
  })
}

async function openConstrainedSlashMenu(page: Page) {
  await page.setViewportSize({ width: 900, height: 600 })
  await openAlphaProject(page)

  const firstBlock = page.locator('.bn-block-content').first()
  await firstBlock.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')

  const menu = page.locator('.bn-suggestion-menu')
  await expect(menu).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(200)
  return menu
}

async function readConstrainedMenuState(menu: Locator) {
  return menu.evaluate((node) => {
    const menuElement = node as HTMLElement
    const menuRect = menuElement.getBoundingClientRect()
    const decoration = document.querySelector<HTMLElement>('[data-decoration-id]')
    const editorScrollArea = decoration?.closest<HTMLElement>('.editor-scroll-area')
    if (!decoration || !editorScrollArea) {
      throw new Error('Missing slash menu anchor or editor scroll area')
    }

    return {
      anchorTop: decoration.getBoundingClientRect().top,
      editorClientHeight: editorScrollArea.clientHeight,
      editorScrollHeight: editorScrollArea.scrollHeight,
      editorScrollTop: editorScrollArea.scrollTop,
      menuClientHeight: menuElement.clientHeight,
      menuHeight: menuRect.height,
      menuMaxScrollTop: menuElement.scrollHeight - menuElement.clientHeight,
      menuScrollTop: menuElement.scrollTop,
      menuTop: menuRect.top,
      overscrollBehaviorY: getComputedStyle(menuElement).overscrollBehaviorY,
    }
  })
}

async function readMenuStyles(menu: Locator) {
  return menu.evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      spacing: style.getPropertyValue('--mantine-spacing-sm').trim(),
      radius: style.getPropertyValue('--mantine-radius-default').trim(),
      shadow: style.getPropertyValue('--mantine-shadow-md').trim(),
    }
  })
}

function expectMenuChrome(styles: Awaited<ReturnType<typeof readMenuStyles>>) {
  expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(styles.borderRadius).not.toBe('0px')
  expect(styles.boxShadow).not.toBe('none')
  expect(styles.spacing).not.toBe('')
  expect(styles.radius).not.toBe('')
  expect(styles.shadow).not.toBe('')
}

async function readSlashMenuItemStyles(item: Locator) {
  return item.evaluate((node) => {
    const item = node as HTMLElement
    const leftSection = item.querySelector<HTMLElement>(
      '.bn-mt-suggestion-menu-item-section[data-position="left"]',
    )!
    const shortcut = item.querySelector<HTMLElement>('.mantine-Badge-root')!
    const shortcutLabel = item.querySelector<HTMLElement>('.mantine-Badge-label')!
    const subtitle = item.querySelector<HTMLElement>('.bn-mt-suggestion-menu-item-subtitle')!
    const regularIcon = item.querySelector<HTMLElement>('.tolaria-slash-menu-icon__regular')!
    const fillIcon = item.querySelector<HTMLElement>('.tolaria-slash-menu-icon__fill')!
    const probe = document.createElement('span')
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-muted')
      .trim()
    document.body.appendChild(probe)
    const textMuted = getComputedStyle(probe).color
    probe.remove()

    return {
      fillOpacity: getComputedStyle(fillIcon).opacity,
      itemHeight: getComputedStyle(item).height,
      leftBackgroundColor: getComputedStyle(leftSection).backgroundColor,
      leftBorderRadius: getComputedStyle(leftSection).borderRadius,
      leftPadding: getComputedStyle(leftSection).padding,
      regularOpacity: getComputedStyle(regularIcon).opacity,
      shortcutBackgroundColor: getComputedStyle(shortcut).backgroundColor,
      shortcutBorderRadius: getComputedStyle(shortcut).borderRadius,
      shortcutColor: getComputedStyle(shortcutLabel).color,
      shortcutFontSize: getComputedStyle(shortcutLabel).fontSize,
      shortcutPadding: getComputedStyle(shortcut).padding,
      subtitleDisplay: getComputedStyle(subtitle).display,
      subtitleText: subtitle.textContent ?? '',
      textMuted,
    }
  })
}

function expectSimplifiedItemStyles(
  styles: Awaited<ReturnType<typeof readSlashMenuItemStyles>>,
) {
  expect(styles.itemHeight).toBe('34px')
  expect(styles.leftBackgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(styles.leftBorderRadius).toBe('0px')
  expect(styles.leftPadding).toBe('0px')
  expect(styles.shortcutBackgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect(styles.shortcutBorderRadius).toBe('0px')
  expect(styles.shortcutColor).toBe(styles.textMuted)
  expect(styles.shortcutFontSize).toBe('10px')
  expect(styles.shortcutPadding).toBe('0px')
  expect(styles.subtitleDisplay).toBe('none')
  expect(styles.subtitleText).toBe('')
}

async function readSlashMenuIconOpacities(item: Locator) {
  return item.evaluate((node) => {
    const item = node as HTMLElement
    const regularIcon = item.querySelector<HTMLElement>('.tolaria-slash-menu-icon__regular')!
    const fillIcon = item.querySelector<HTMLElement>('.tolaria-slash-menu-icon__fill')!
    return {
      fillOpacity: getComputedStyle(fillIcon).opacity,
      regularOpacity: getComputedStyle(regularIcon).opacity,
    }
  })
}

test.describe('BlockNote slash menu styling', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('slash menu keeps Mantine styling tokens in the editor', async ({ page }) => {
    await openAlphaProject(page)

    const menu = await openSlashMenu(page)
    expectMenuChrome(await readMenuStyles(menu))
    await expect(menu.getByText('Subheadings', { exact: true })).toHaveCount(0)
    await expect(menu.getByText(/^Heading [4-6]$/)).toHaveCount(0)
    const secondItem = menu.locator('.bn-suggestion-menu-item').nth(1)
    await expect(secondItem.locator('.tolaria-slash-menu-icon')).toBeVisible()

    const itemStyles = await readSlashMenuItemStyles(secondItem)
    expectSimplifiedItemStyles(itemStyles)
    expect(itemStyles.regularOpacity).toBe('1')
    expect(itemStyles.fillOpacity).toBe('0')

    await secondItem.hover()
    expect(await readSlashMenuIconOpacities(secondItem)).toEqual({
      fillOpacity: '1',
      regularOpacity: '0',
    })
  })

  test('scrolling the slash menu does not reposition it from the editor anchor', async ({ page }) => {
    await openAlphaProject(page)

    const menu = await openSlashMenu(page)
    const probe = await probeSlashMenuScroll(menu)

    expect(probe.maxScrollTop).toBeGreaterThan(0)
    expect(probe.scrollTop).toBeGreaterThan(0)
    expect(probe.decorationRectReads).toBe(0)
  })

  test('contains wheel scrolling when the viewport constrains the slash menu', async ({ page }) => {
    const menu = await openConstrainedSlashMenu(page)
    const menuBox = await menu.boundingBox()
    if (!menuBox) throw new Error('Slash menu has no bounding box')

    const before = await readConstrainedMenuState(menu)
    expect(before.editorScrollHeight).toBeGreaterThan(before.editorClientHeight)
    expect(before.menuMaxScrollTop).toBeGreaterThan(500)

    await page.mouse.move(
      menuBox.x + menuBox.width / 2,
      menuBox.y + menuBox.height / 2,
    )
    for (let index = 0; index < 10; index += 1) {
      await page.mouse.wheel(0, 160)
      await page.waitForTimeout(40)
    }

    const after = await readConstrainedMenuState(menu)
    expect(after.menuScrollTop).toBe(after.menuMaxScrollTop)
    expect(after.menuScrollTop).toBeGreaterThan(0)
    expect(after.overscrollBehaviorY).toBe('contain')
    expect(after.editorScrollTop).toBe(before.editorScrollTop)
    expect(after.anchorTop).toBe(before.anchorTop)
    expect(after.menuTop).toBe(before.menuTop)
    expect(after.menuHeight).toBe(before.menuHeight)
  })
})
