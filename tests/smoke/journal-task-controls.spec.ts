import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function writeJournal(vaultPath: string, date: string): string {
  const journalPath = path.join(vaultPath, 'journals', `${date}.md`)
  fs.mkdirSync(path.dirname(journalPath), { recursive: true })
  fs.writeFileSync(journalPath, `---
title: ${date}
type: Journal
_display: outline
_width: wide
---

# ${date}

- TODO Existing task
`)
  return journalPath
}

test('Journal task controls match Logseq checklist behavior', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()
  const todayKey = localDateKey(new Date())
  const journalPath = writeJournal(tempVaultDir, todayKey)

  try {
    await openFixtureVault(page, tempVaultDir)
    await page.getByText('Journals', { exact: true }).click()

    const editor = page.locator('[data-note-display="outline"]')
    await expect(page.locator('[data-journal-task-editor]')).toHaveCount(1)
    const existingTask = editor.locator('[data-content-type="bulletListItem"]', {
      hasText: 'Existing task',
    })
    await expect(existingTask.getByRole('checkbox')).toHaveCount(0)
    await existingTask.locator('.bn-inline-content').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' remains plain text')
    await expect(existingTask.locator('.bn-inline-content')).toHaveText(
      'TODO Existing task remains plain text',
    )
    const heading = editor.locator('[data-content-type="heading"]').first()
    await heading.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/todo')
    await page.getByRole('option', { name: /^TODO$/ }).click()
    await page.keyboard.type('Write release notes')

    const task = editor.locator('[data-content-type="checkListItem"]', {
      hasText: 'Write release notes',
    })
    const checkbox = task.getByRole('checkbox')
    const status = task.locator('[data-journal-task-status]')
    await expect(task).toHaveCount(1)
    await expect(task.locator('.bn-inline-content')).toHaveText('TODO Write release notes')
    await expect(task.locator('.bn-inline-content')).not.toContainText('/todo')
    await expect(checkbox).not.toBeChecked()
    await expect(status).toHaveText('TODO')
    await expect.poll(async () => {
      const bulletBox = await task.evaluate((element) => {
        const styles = getComputedStyle(element, '::before')
        const rect = element.getBoundingClientRect()
        return {
          centerX: rect.x + Number.parseFloat(styles.width) / 2,
          centerY: rect.y + Number.parseFloat(styles.height) / 2,
          content: styles.content,
        }
      })
      const checkboxBox = await checkbox.boundingBox()
      const statusBox = await status.boundingBox()
      const textBox = await task.locator('.bn-inline-content').boundingBox()
      if (!checkboxBox || !statusBox || !textBox) return false
      const checkboxCenterY = checkboxBox.y + checkboxBox.height / 2
      const statusCenterY = statusBox.y + statusBox.height / 2
      return bulletBox.content !== 'none'
        && bulletBox.centerX < checkboxBox.x
        && checkboxBox.x < statusBox.x
        && statusBox.x < textBox.x + textBox.width
        && Math.abs(bulletBox.centerY - checkboxCenterY) < 4
        && Math.abs(checkboxCenterY - statusCenterY) < 4
    }).toBe(true)

    await status.click()
    await expect(status).toHaveText('DOING')
    await expect(checkbox).not.toBeChecked()

    await status.click()
    await expect(checkbox).toBeChecked()
    await expect(status).toHaveAttribute('data-journal-task-status', 'DONE')
    expect(await status.evaluate((element) => ({
      display: getComputedStyle(element).display,
      journalRoot: !!element.closest('[data-journal-task-editor]'),
      selectorMatches: element.matches(
        "[data-journal-task-editor] .journal-task-status[data-journal-task-status='DONE']",
      ),
    }))).toEqual({ display: 'none', journalRoot: true, selectorMatches: true })
    await expect(status).toBeHidden()

    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
    await expect(status).toHaveText('TODO')
    await expect(status).toBeVisible()

    await page.keyboard.press('Meta+s')
    await expect.poll(() => fs.readFileSync(journalPath, 'utf8')).toContain('- TODO Existing task remains plain text')
    await expect.poll(() => fs.readFileSync(journalPath, 'utf8')).toContain('- [ ] TODO Write release notes')
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})
