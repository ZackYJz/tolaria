import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

test('@smoke creates an outline note from the new-note menu', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    await expect(page.locator('[data-note-display="outline"]')).toBeVisible()
    await expect(page.locator('.editor-content-width--wide')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch to normal note width' })).toBeVisible()
    await expect(page.locator('[data-content-type="bulletListItem"]').first()).toBeVisible()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i)

    const outlineEditor = page.locator('[data-note-display="outline"]')
    const firstItem = outlineEditor.locator('[data-content-type="bulletListItem"]').first()
    await firstItem.click()
    await page.keyboard.press('End')
    await page.keyboard.type('First item')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second item')

    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'First item' })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'Second item' })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="paragraph"]')).toHaveCount(0)

    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(outlineEditor.locator('[data-content-type="paragraph"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const anchor = window.getSelection()?.anchorNode
      const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
      return element?.closest('[data-content-type]')?.getAttribute('data-content-type')
    })).toBe('bulletListItem')
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('creates the next outline item with one Enter after an IME composition', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    const firstItem = outlineEditor.locator('[data-content-type="bulletListItem"]').first()
    await firstItem.click()
    await page.keyboard.insertText('中文输入')

    await outlineEditor.locator('.bn-editor').evaluate((editor) => {
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Enter',
        isComposing: true,
        key: 'Enter',
      }))
      editor.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中文输入',
      }))
    })

    await page.keyboard.press('Enter')
    await page.keyboard.insertText('下一条')

    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^中文输入$/ })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^下一条$/ })).toHaveCount(1)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('creates the next outline item when compositionend precedes the deliberate Enter', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    const firstItem = outlineEditor.locator('[data-content-type="bulletListItem"]').first()
    await firstItem.click()
    await page.keyboard.insertText('中文输入')

    await outlineEditor.locator('.bn-editor').evaluate((editor) => {
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中文输入',
      }))
    })

    await page.keyboard.press('Enter')
    await page.keyboard.insertText('下一条')

    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^中文输入$/ })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^下一条$/ })).toHaveCount(1)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('deletes an empty outline bullet with Backspace', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    const bullets = outlineEditor.locator('[data-content-type="bulletListItem"]')
    await bullets.first().click()
    await page.keyboard.insertText('保留的条目')
    await page.keyboard.press('Enter')
    await expect(bullets.last()).toHaveText('')
    const bulletCountBeforeDelete = await bullets.count()

    await bullets.last().click()
    await page.keyboard.press('Backspace')

    await expect(bullets).toHaveCount(bulletCountBeforeDelete - 1)
    await page.keyboard.insertText('继续输入')
    await expect(bullets.locator('text=保留的条目继续输入')).toHaveCount(1)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('@smoke opens today and navigates between outline Journals', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByText('Journals', { exact: true }).click()

    await expect(page.getByRole('navigation', { name: 'Journal date navigation' })).toBeVisible()
    await expect(page.locator('[data-note-display="outline"]')).toBeVisible()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/\d{4}-\d{2}-\d{2}/)

    const todayFilename = await page.getByTestId('breadcrumb-filename-trigger').textContent()
    await page.getByRole('button', { name: 'Previous day' }).click()

    await expect(page.getByTestId('breadcrumb-filename-trigger')).not.toHaveText(todayFilename ?? '')
    await expect(page.getByRole('navigation', { name: 'Journal date navigation' })).toBeVisible()
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('keeps existing document paragraphs inside list items after switching to outline', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()
  const notePath = path.join(tempVaultDir, 'plain-body.md')
  fs.writeFileSync(notePath, `---
type: Note
---

# Plain Body

First paragraph

Second paragraph
`)

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByTestId('note-list-container').getByText('Plain Body', { exact: true }).click()
    await page.getByRole('button', { name: 'Open the properties panel' }).click()
    await page.getByRole('combobox', { name: 'Display as' }).click()
    await page.getByRole('option', { name: 'Outline' }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    await expect(outlineEditor).toBeVisible()
    await expect(outlineEditor.locator('[data-content-type="paragraph"]')).toHaveCount(0)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'First paragraph' })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'Second paragraph' })).toHaveCount(1)

    const firstParagraph = outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'First paragraph' })
    await firstParagraph.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await expect(outlineEditor.locator('[data-content-type="paragraph"]')).toHaveCount(0)
    await expect(firstParagraph).toBeVisible()

    const secondParagraph = outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: 'Second paragraph' })
    await secondParagraph.click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await page.keyboard.press('Meta+s')
    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/_display:\s+outline/)
    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/- First paragraph/)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('keeps outline hierarchy rails aligned with block bullets on a wide canvas', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()
  const outlinePath = path.join(tempVaultDir, 'outline-layout.md')
  fs.writeFileSync(outlinePath, `---
type: Note
_display: outline
---

# Outline Layout

- Parent block

  \`\`\`typescript
  const answer = 42
  \`\`\`

  Child paragraph
`)

  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openFixtureVault(page, tempVaultDir)
    await page.getByTestId('note-list-container').getByText('Outline Layout', { exact: true }).click()

    await expect(page.locator('.editor-content-width--normal')).toBeVisible()
    await page.getByRole('button', { name: 'Switch to wide note width' }).click()
    await expect.poll(() => fs.readFileSync(outlinePath, 'utf8')).toMatch(/_width:\s+wide/)

    const outlineRoot = page.locator('.editor-content-width--wide')
    const nestedGroup = outlineRoot.locator('.bn-block-group .bn-block-group').first()
    const nestedCode = nestedGroup.locator('[data-content-type="codeBlock"]').first()
    await expect(nestedCode).toBeVisible()

    const parentItem = outlineRoot.locator('[data-content-type="bulletListItem"]').first()
    await parentItem.hover()
    await page.getByRole('button', { name: 'Collapse item' }).click()
    await expect(nestedCode).toBeHidden()

    const collapsedMarker = await parentItem.evaluate((item) => ({
      background: getComputedStyle(item, '::before').backgroundImage,
      ellipsisContent: getComputedStyle(item.querySelector('.bn-inline-content')!, '::after').content,
    }))
    expect(collapsedMarker.background).toContain('radial-gradient')
    expect(collapsedMarker.ellipsisContent).toBe('none')

    const markerClickPoint = await parentItem.evaluate((item) => {
      const bounds = item.getBoundingClientRect()
      const markerWidth = Number.parseFloat(getComputedStyle(item, '::before').width)
      return { x: bounds.left + markerWidth / 2, y: bounds.top + bounds.height / 2 }
    })
    await page.mouse.click(markerClickPoint.x, markerClickPoint.y)
    await expect(nestedCode).toBeVisible()

    const geometry = await outlineRoot.evaluate((root) => {
      const editor = root.querySelector<HTMLElement>('.bn-editor')
      const parent = root.querySelector<HTMLElement>('[data-content-type="bulletListItem"]')
      const group = root.querySelector<HTMLElement>('.bn-block-group .bn-block-group')
      const code = group?.querySelector<HTMLElement>('[data-content-type="codeBlock"]')
      const titleBlock = root.querySelector<HTMLElement>('.bn-block-outer:has(h1)')
      if (!editor || !parent || !group || !code || !titleBlock) throw new Error('Missing outline geometry target')

      const parentStyle = getComputedStyle(parent)
      const parentMarkerStyle = getComputedStyle(parent, '::before')
      const groupRailStyle = getComputedStyle(group, '::before')
      const codeMarkerStyle = getComputedStyle(code, '::before')
      const parentRect = parent.getBoundingClientRect()
      const groupRect = group.getBoundingClientRect()
      const codeRect = code.getBoundingClientRect()

      const parentBulletCenter = parentRect.left
        + Number.parseFloat(parentStyle.paddingLeft)
        + Number.parseFloat(parentMarkerStyle.width) / 2
      const hierarchyRail = groupRect.left + Number.parseFloat(groupRailStyle.left)
      const childBulletCenter = codeRect.left
        + Number.parseFloat(codeMarkerStyle.left)
        + Number.parseFloat(codeMarkerStyle.width) / 2

      return {
        childBulletBackground: codeMarkerStyle.backgroundImage,
        childBulletCenter,
        codeLeft: codeRect.left,
        editorWidth: editor.getBoundingClientRect().width,
        hierarchyRail,
        parentBulletBackground: parentMarkerStyle.backgroundImage,
        parentBulletCenter,
        titleUnderlineWidth: Number.parseFloat(getComputedStyle(titleBlock).borderBottomWidth),
      }
    })

    expect(geometry.editorWidth).toBeGreaterThan(1_000)
    expect(geometry.titleUnderlineWidth).toBeGreaterThan(0)
    expect(Math.abs(geometry.hierarchyRail - geometry.parentBulletCenter)).toBeLessThan(1)
    expect(geometry.childBulletBackground).not.toBe('none')
    expect(geometry.childBulletBackground).toBe(geometry.parentBulletBackground)
    expect(geometry.childBulletCenter).toBeGreaterThan(geometry.parentBulletCenter)
    expect(geometry.codeLeft).toBeGreaterThan(geometry.childBulletCenter)

    await page.getByRole('button', { name: 'Switch to normal note width' }).click()
    const normalRoot = page.locator('.editor-content-width--normal')
    await expect(normalRoot).toBeVisible()
    const normalEditorWidth = await normalRoot.locator('.bn-editor').evaluate((editor) => editor.getBoundingClientRect().width)
    expect(normalEditorWidth).toBeLessThan(geometry.editorWidth)
    await expect.poll(() => fs.readFileSync(outlinePath, 'utf8')).toMatch(/_width:\s+normal/)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})
