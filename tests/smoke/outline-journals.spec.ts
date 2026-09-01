import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function writeJournal(vaultPath: string, date: string, tasks: string[]): string {
  const journalPath = path.join(vaultPath, 'journals', `${date}.md`)
  fs.mkdirSync(path.dirname(journalPath), { recursive: true })
  fs.writeFileSync(journalPath, `---
title: ${date}
type: Journal
_display: outline
_width: wide
---

# ${date}

${tasks.map((task) => `- ${task}`).join('\n')}
`)
  return journalPath
}

async function createNextOutlineBullet(page: Page, outlineEditor: Locator): Promise<Locator> {
  const items = outlineEditor.locator('[data-content-type="bulletListItem"]')
  const visibleItems = outlineEditor.locator('[data-content-type="bulletListItem"]:visible')
  const insertionPoint = await visibleItems.count() > 0
    ? visibleItems.last()
    : outlineEditor.locator('[data-content-type="heading"]').first()
  await insertionPoint.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')

  const nextItem = items.last()
  await expect(nextItem).toBeVisible()
  return nextItem
}

async function dispatchImmediateImeEnter(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      isComposing: true,
      key: 'Enter',
    }))
    element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph',
    }))
    element.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中文输入',
    }))
  })
}

test('@smoke creates an outline note from the new-note menu', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    await expect(page.locator('[data-note-display="outline"]')).toBeVisible()
    await expect(page.locator('.editor-content-width--wide')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch to normal note width' })).toBeVisible()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i)

    const outlineEditor = page.locator('[data-note-display="outline"]')
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]')).toHaveCount(0)
    const title = outlineEditor.locator('[data-content-type="heading"]').first()
    await title.click()
    await page.keyboard.type('Outline title')
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]').last()).not.toBeVisible()
    await page.keyboard.press('Enter')

    const firstItem = outlineEditor.locator('[data-content-type="bulletListItem"]').first()
    await expect(firstItem).toBeVisible()
    await expect.poll(() => firstItem.locator('.bn-inline-content').evaluate((element) => (
      getComputedStyle(element, '::before').content
    ))).toBe('none')
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

test('creates the next outline item when Enter arrives before IME composition settles', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Outline' }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    await createNextOutlineBullet(page, outlineEditor)
    await page.keyboard.insertText('中文输入')

    await dispatchImmediateImeEnter(outlineEditor.locator('.bn-editor'))

    await page.keyboard.insertText('下一条')

    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^中文输入$/ })).toHaveCount(1)
    await expect(outlineEditor.locator('[data-content-type="bulletListItem"]', { hasText: /^下一条$/ })).toHaveCount(1)
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('creates the next document block when Enter arrives before IME composition settles', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByRole('button', { name: 'Create new note' }).click()
    await page.getByRole('menuitem', { name: 'Document' }).click()

    const editor = page.locator('.bn-editor')
    const title = editor.locator('[data-content-type="heading"]').first()
    await title.click()
    await page.keyboard.insertText('中文输入')
    await dispatchImmediateImeEnter(editor)
    await page.keyboard.insertText('下一行')

    await expect(title).toHaveText('中文输入')
    await expect(editor.locator('[data-content-type="paragraph"]', { hasText: /^下一行$/ })).toHaveCount(1)
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
    await createNextOutlineBullet(page, outlineEditor)
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
    await createNextOutlineBullet(page, outlineEditor)
    await expect(bullets).toHaveCount(1)
    await page.keyboard.insertText('保留的条目')
    await expect(bullets).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(bullets).toHaveCount(2)
    await expect(bullets.last()).toHaveText('')

    await bullets.last().click()
    await page.keyboard.press('Backspace')

    await expect(bullets).toHaveCount(1)
    await expect(bullets.filter({ hasText: /^$/ })).toHaveCount(0)
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

test('creates Journal tasks from the slash menu without wrapping list labels', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()
  const todayKey = localDateKey(new Date())
  const journalPath = path.join(tempVaultDir, 'journals', `${todayKey}.md`)

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByText('Journals', { exact: true }).click()

    const outlineEditor = page.locator('[data-note-display="outline"]')
    await createNextOutlineBullet(page, outlineEditor)
    await page.keyboard.type('/')

    const menu = page.locator('.tolaria-slash-menu')
    await expect(menu).toBeVisible()
    const numberedListItem = menu.locator('.tolaria-slash-menu__item').filter({ hasText: 'Numbered List' })
    await expect(numberedListItem).toBeVisible()
    const numberedListLayout = await numberedListItem.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }))
    expect(numberedListLayout.whiteSpace).toBe('nowrap')
    expect(numberedListLayout.height).toBeLessThanOrEqual(40)

    await page.keyboard.type('todo')
    await page.getByRole('option', { name: /^TODO$/ }).click()
    await page.keyboard.type('Write release notes')
    await page.keyboard.press('Meta+s')

    const task = outlineEditor.locator('[data-content-type="checkListItem"]', {
      hasText: 'TODO Write release notes',
    })
    await expect(task).toHaveCount(1)
    await expect(task.getByRole('checkbox')).not.toBeChecked()
    await expect(task.locator('[data-journal-task-status]')).toHaveText('TODO')
    await expect.poll(() => fs.readFileSync(journalPath, 'utf8')).toContain('- [ ] TODO Write release notes')
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})

test('shows DOING tasks from older journals at the bottom of the latest journal', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const todayKey = localDateKey(today)
  const yesterdayKey = localDateKey(yesterday)
  const olderJournalPath = writeJournal(tempVaultDir, yesterdayKey, [
    'DOING Long-running work',
    'TODO Later work',
  ])
  const latestJournalPath = writeJournal(tempVaultDir, todayKey, ['DOING Today work'])

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByText('Journals', { exact: true }).click()

    const doingTasks = page.getByRole('region', { name: 'DOING' })
    await expect(doingTasks).toBeVisible()
    await expect(doingTasks.getByText('Long-running work')).toBeVisible()
    await expect(doingTasks.getByText('Today work')).toBeVisible()
    await expect(doingTasks.getByText('Later work')).toHaveCount(0)

    await doingTasks.getByRole('button', { name: 'Long-running work: Done' }).click()

    await expect(doingTasks.getByText('Long-running work')).toHaveCount(0)
    await expect.poll(() => fs.readFileSync(olderJournalPath, 'utf8')).toContain('- DONE Long-running work')
    expect(fs.readFileSync(olderJournalPath, 'utf8')).toContain('- TODO Later work')

    const todayTask = page.locator('[data-content-type="checkListItem"]', { hasText: 'Today work' })
    await todayTask.click()
    await page.keyboard.press('Meta+Enter')

    await expect(todayTask).toHaveText('DONE Today work')
    await expect(doingTasks.getByText('Today work')).toHaveCount(0)
    await expect(todayTask.getByRole('checkbox')).toBeChecked()
    await expect.poll(() => fs.readFileSync(latestJournalPath, 'utf8')).toContain('- [x] DONE Today work')
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

\`\`\`text
Top-level code
\`\`\`

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
    const topLevelCode = outlineRoot.locator(
      '.bn-editor > .bn-block-group > .bn-block-outer > .bn-block > [data-content-type="codeBlock"]',
    ).first()
    const nestedGroup = outlineRoot.locator('.bn-block-group .bn-block-group').first()
    const nestedCode = nestedGroup.locator('[data-content-type="codeBlock"]').first()
    await expect(topLevelCode).toBeVisible()
    await expect(nestedCode).toBeVisible()

    const topLevelMarker = await topLevelCode.evaluate((code) => ({
      background: getComputedStyle(code, '::before').backgroundImage,
      content: getComputedStyle(code, '::before').content,
    }))
    expect(topLevelMarker.background).toContain('radial-gradient')
    expect(topLevelMarker.content).not.toBe('none')

    const nestedCodeBlockId = await nestedCode.locator('xpath=ancestor::*[@data-id][1]')
      .getAttribute('data-id')
    expect(nestedCodeBlockId).toBeTruthy()
    const nestedLanguageOverlay = page.locator(
      `.editor__code-block-language-overlay[data-code-block-id="${nestedCodeBlockId}"]`,
    )
    await expect(nestedLanguageOverlay.locator('[data-slot="select-trigger"]')).toBeVisible()

    const parentItem = outlineRoot.locator('[data-content-type="bulletListItem"]').first()
    await parentItem.hover()
    await page.getByRole('button', { name: 'Collapse item' }).click()
    await expect(nestedCode).toBeHidden()
    await expect(nestedLanguageOverlay).toHaveCount(0)

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
    await expect(nestedLanguageOverlay.locator('[data-slot="select-trigger"]')).toBeVisible()

    const geometry = await outlineRoot.evaluate((root) => {
      const editor = root.querySelector<HTMLElement>('.bn-editor')
      const parent = root.querySelector<HTMLElement>('[data-content-type="bulletListItem"]')
      const group = root.querySelector<HTMLElement>('.bn-block-group .bn-block-group')
      const code = group?.querySelector<HTMLElement>('[data-content-type="codeBlock"]')
      const topCode = root.querySelector<HTMLElement>(
        '.bn-editor > .bn-block-group > .bn-block-outer > .bn-block > [data-content-type="codeBlock"]',
      )
      const titleBlock = root.querySelector<HTMLElement>('.bn-block-outer:has(h1)')
      if (!editor || !parent || !group || !code || !topCode || !titleBlock) throw new Error('Missing outline geometry target')

      const parentStyle = getComputedStyle(parent)
      const parentMarkerStyle = getComputedStyle(parent, '::before')
      const groupRailStyle = getComputedStyle(group, '::before')
      const codeMarkerStyle = getComputedStyle(code, '::before')
      const topCodeMarkerStyle = getComputedStyle(topCode, '::before')
      const parentRect = parent.getBoundingClientRect()
      const groupRect = group.getBoundingClientRect()
      const codeRect = code.getBoundingClientRect()
      const topCodeRect = topCode.getBoundingClientRect()

      const parentBulletCenter = parentRect.left
        + Number.parseFloat(parentStyle.paddingLeft)
        + Number.parseFloat(parentMarkerStyle.width) / 2
      const hierarchyRail = groupRect.left + Number.parseFloat(groupRailStyle.left)
      const childBulletCenter = codeRect.left
        + Number.parseFloat(codeMarkerStyle.left)
        + Number.parseFloat(codeMarkerStyle.width) / 2
      const topCodeBulletCenter = topCodeRect.left
        + Number.parseFloat(topCodeMarkerStyle.left)
        + Number.parseFloat(topCodeMarkerStyle.width) / 2

      return {
        childBulletBackground: codeMarkerStyle.backgroundImage,
        childBulletCenter,
        codeLeft: codeRect.left,
        editorWidth: editor.getBoundingClientRect().width,
        hierarchyRail,
        parentBulletBackground: parentMarkerStyle.backgroundImage,
        parentBulletCenter,
        titleUnderlineWidth: Number.parseFloat(getComputedStyle(titleBlock).borderBottomWidth),
        topCodeBulletCenter,
      }
    })

    expect(geometry.editorWidth).toBeGreaterThan(1_000)
    expect(geometry.titleUnderlineWidth).toBeGreaterThan(0)
    expect(Math.abs(geometry.hierarchyRail - geometry.parentBulletCenter)).toBeLessThan(1)
    expect(geometry.childBulletBackground).not.toBe('none')
    expect(geometry.childBulletBackground).toBe(geometry.parentBulletBackground)
    expect(geometry.childBulletCenter).toBeGreaterThan(geometry.parentBulletCenter)
    expect(geometry.codeLeft).toBeGreaterThan(geometry.childBulletCenter)
    expect(Math.abs(geometry.topCodeBulletCenter - geometry.parentBulletCenter)).toBeLessThan(1)

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
