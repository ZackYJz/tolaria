import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const editorElement = document.createElement('div')
const mocks = vi.hoisted(() => ({ suggestionMenuItemProps: vi.fn() }))

vi.mock('@blocknote/react', () => ({
  useBlockNoteEditor: () => ({ domElement: editorElement }),
  useComponentsContext: () => ({
    SuggestionMenu: {
      EmptyItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Item: (props: {
        item: { title: string }
        onClick: () => void
      }) => {
        mocks.suggestionMenuItemProps(props)
        const { item, onClick } = props
        return <button type="button" onClick={onClick}>{item.title}</button>
      },
      Label: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Loader: () => <div>Loading</div>,
      Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    },
  }),
  useDictionary: () => ({ suggestion_menu: { no_items_title: 'No items' } }),
}))

import { TolariaSlashMenu } from './TolariaSlashMenu'
import type { TolariaSlashMenuItem } from './tolariaEditorFormattingConfig'

function calloutItem(): TolariaSlashMenuItem {
  return {
    aliases: [],
    key: 'callout',
    onItemClick: vi.fn(),
    title: 'Callout',
  }
}

describe('TolariaSlashMenu', () => {
  it('passes only supported props to the BlockNote suggestion item', () => {
    render(<TolariaSlashMenu
      items={[calloutItem()]}
      loadingState="loaded"
      selectedIndex={0}
      onItemClick={vi.fn()}
    />)

    expect(mocks.suggestionMenuItemProps).toHaveBeenCalledWith(
      expect.not.objectContaining({ onMouseEnter: expect.anything() }),
    )
    expect(screen.getByRole('button', { name: 'Callout' })).toBeVisible()
  })

  it('selects the callout command directly without opening a submenu', () => {
    const item = calloutItem()
    const onItemClick = vi.fn()
    render(<TolariaSlashMenu
      items={[item]}
      loadingState="loaded"
      selectedIndex={0}
      onItemClick={onItemClick}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Callout' }))
    expect(screen.queryByRole('menu', { name: 'Callout' })).not.toBeInTheDocument()
    expect(onItemClick).toHaveBeenCalledWith(item)
  })
})
