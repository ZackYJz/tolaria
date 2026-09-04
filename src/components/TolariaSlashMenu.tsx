import { useComponentsContext, useDictionary, type SuggestionMenuProps } from '@blocknote/react'
import type { TolariaSlashMenuItem } from './tolariaEditorFormattingConfig'

export function TolariaSlashMenu({
  items,
  loadingState,
  onItemClick,
  selectedIndex,
}: SuggestionMenuProps<TolariaSlashMenuItem>) {
  const Components = useComponentsContext()
  const dictionary = useDictionary()

  if (!Components) return null

  const renderedItems = items.flatMap((item, index) => {
    const nodes = []
    if (item.group !== items[index - 1]?.group) {
      nodes.push(
        <Components.SuggestionMenu.Label className="bn-suggestion-menu-label" key={`group-${item.group}`}>
          {item.group}
        </Components.SuggestionMenu.Label>,
      )
    }
    nodes.push(
      <Components.SuggestionMenu.Item
        className="bn-suggestion-menu-item"
        id={`bn-suggestion-menu-item-${index}`}
        isSelected={index === selectedIndex}
        item={item}
        key={item.key}
        onClick={() => onItemClick?.(item)}
      />,
    )
    return nodes
  })

  const loader =
    loadingState === 'loaded' ? null : <Components.SuggestionMenu.Loader className="bn-suggestion-menu-loader" />

  return (
    <Components.SuggestionMenu.Root id="bn-suggestion-menu" className="bn-suggestion-menu tolaria-slash-menu">
      {renderedItems}
      {renderedItems.length === 0 && loadingState !== 'loading-initial' && (
        <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item">
          {dictionary.suggestion_menu.no_items_title}
        </Components.SuggestionMenu.EmptyItem>
      )}
      {loader}
    </Components.SuggestionMenu.Root>
  )
}
