import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { WebBookmarkView } from './WebBookmarkBlock'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../hooks/useAppPreferences', () => ({ useAppLocale: () => 'en' }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true }))
vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))
const props = { url: '', title: '', description: '', image: '', favicon: '' }
beforeEach(() => invoke.mockReset())
it('creates a bookmark from a pasted URL and saves fetched metadata', async () => {
  invoke.mockResolvedValue({ ...props, url: 'https://example.com/', title: 'Example article', description: 'An article summary' })
  const onSave = vi.fn()
  render(<WebBookmarkView value={props} onSave={onSave} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create bookmark' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Example article', description: 'An article summary' })))
})

it('rejects unsafe URLs without making a request', async () => {
  render(<WebBookmarkView value={props} onSave={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'javascript:alert(1)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create bookmark' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid')
  expect(invoke).not.toHaveBeenCalled()
})

it('keeps failed requests visible and lets the user explicitly save without a preview', async () => {
  invoke.mockImplementation((command: string) => command === 'get_bookmark_metadata' ? Promise.reject(new Error('Unavailable')) : Promise.resolve(null))
  const onSave = vi.fn()
  render(<WebBookmarkView value={props} onSave={onSave} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create bookmark' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
  expect(onSave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save without preview' }))
  expect(onSave).toHaveBeenCalledWith({ ...props, url: 'https://example.com/' })
})

it('does not overwrite a saved bookmark when a pending edit is cancelled', async () => {
  let resolve: (value: typeof props) => void = () => {}
  invoke.mockReturnValue(new Promise<typeof props>(done => { resolve = done }))
  const onSave = vi.fn()
  render(<WebBookmarkView value={{ ...props, url: 'https://example.com/', title: 'Saved title' }} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit bookmark' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create bookmark' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  resolve({ ...props, title: 'Late result' })
  await waitFor(() => expect(screen.getByRole('link')).toHaveTextContent('Saved title'))
  expect(onSave).not.toHaveBeenCalled()
})

it('shows the URL form again when undo restores an empty bookmark', () => {
  const onSave = vi.fn()
  const { rerender } = render(<WebBookmarkView value={{ ...props, url: 'https://example.com/', title: 'Saved' }} onSave={onSave} />)
  rerender(<WebBookmarkView value={props} onSave={onSave} />)
  expect(screen.getByRole('textbox')).toHaveValue('')
})

it('ignores an in-flight edit after an external value change', async () => {
  let resolve: (value: typeof props) => void = () => {}
  invoke.mockReturnValue(new Promise<typeof props>(done => { resolve = done }))
  const onSave = vi.fn()
  const { rerender } = render(<WebBookmarkView value={{ ...props, url: 'https://example.com/', title: 'Saved' }} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit bookmark' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create bookmark' }))
  rerender(<WebBookmarkView value={{ ...props, url: 'https://restored.example/', title: 'Restored' }} onSave={onSave} />)
  resolve({ ...props, title: 'Late result' })
  await waitFor(() => expect(screen.getByRole('link')).toHaveTextContent('Restored'))
  expect(onSave).not.toHaveBeenCalled()
})

it('cancels a saved bookmark edit with Escape without saving', () => {
  const onSave = vi.fn()
  render(<WebBookmarkView value={{ ...props, url: 'https://example.com/', title: 'Saved' }} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit bookmark' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://other.example/' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(screen.getByRole('link')).toHaveTextContent('Saved')
  expect(onSave).not.toHaveBeenCalled()
})

it('keeps an unsaved URL draft on Escape', () => {
  render(<WebBookmarkView value={props} onSave={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(screen.getByRole('textbox')).toHaveValue('https://example.com/')
})
