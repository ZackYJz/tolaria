import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }) => {
  tempVaultDir = createFixtureVaultCopy()
  const longBody = Array.from(
    { length: 24 },
    (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1} keeps the source document taller than the editor viewport.`,
  ).join('\n\n')
  fs.writeFileSync(
    path.join(tempVaultDir, 'reference-hub.md'),
    `# Reference Hub\n\nSource page.\n\n${longBody}\n`,
  )
  fs.writeFileSync(
    path.join(tempVaultDir, 'linked-reference.md'),
    '# Linked source\n\nGeneric introduction that is not the backlink.\n\nThis exact line links to [[Reference Hub]] explicitly.\n',
  )
  fs.writeFileSync(
    path.join(tempVaultDir, 'outline-reference.md'),
    [
      '---',
      '_display: outline',
      '---',
      '# Outline source',
      '',
      '- Parent cites [[Reference Hub]]',
      '  - Child context',
      '    1. Grandchild evidence',
      '- Sibling must stay hidden',
      '',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(tempVaultDir, 'unlinked-mention.md'),
    '# Mention source\n\nReference Hub appears here as plain text.\n',
  )
  fs.writeFileSync(
    path.join(tempVaultDir, 'reference-hub-follow-up.md'),
    '# Reference Hub follow-up\n\nThe body does not repeat the source title.\n',
  )
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('shows linked references and collapsible unlinked mentions below the note @smoke', async ({ page }) => {
  const noteList = page.getByTestId('note-list-container')
  await noteList.getByText('Reference Hub', { exact: true }).click()

  const references = page.getByTestId('page-references')
  await references.scrollIntoViewIfNeeded()
  await expect(references).toBeVisible()

  const lastDocumentBlock = page.locator('.bn-editor > .bn-block-group > .bn-block-outer').last()
  const [lastBlockBox, referencesBox] = await Promise.all([
    lastDocumentBlock.boundingBox(),
    references.boundingBox(),
  ])
  expect(lastBlockBox).not.toBeNull()
  expect(referencesBox).not.toBeNull()
  expect(referencesBox!.y).toBeGreaterThanOrEqual(lastBlockBox!.y + lastBlockBox!.height)
  expect(referencesBox!.y - (lastBlockBox!.y + lastBlockBox!.height)).toBeLessThan(160)

  const linkedToggle = page.getByRole('button', { name: /Linked references.*2/i })
  await expect(linkedToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(references.getByText('Linked source', { exact: true })).toBeVisible()
  await expect(references.getByText('This exact line links to Reference Hub explicitly.')).toBeVisible()
  await expect(references.getByText('Generic introduction that is not the backlink.')).toHaveCount(0)
  await expect(references.getByText('Outline source', { exact: true })).toBeVisible()
  await expect(references.getByText('Parent cites Reference Hub')).toBeVisible()
  await expect(references.getByText('Child context', { exact: true })).toBeVisible()
  await expect(references.getByText('Grandchild evidence', { exact: true })).toBeVisible()
  await expect(references.getByText('Sibling must stay hidden', { exact: true })).toHaveCount(0)

  const mentionToggle = page.getByRole('button', { name: /Unlinked mentions.*1/i })
  await expect(mentionToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(references.getByText('Mention source', { exact: true })).toHaveCount(0)

  await mentionToggle.click()
  await expect(references.getByText('Mention source', { exact: true })).toBeVisible()
  await expect(references.getByText('Reference Hub follow-up', { exact: true })).toHaveCount(0)

  await references.getByRole('button', { name: /Mention source/i }).click()
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('unlinked-mention')
})
