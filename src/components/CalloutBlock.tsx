import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react'
import { useState } from 'react'
import { useAppLocale } from '../hooks/useAppPreferences'
import { translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { CALLOUT_BLOCK_TYPE } from '../utils/calloutMarkdown'
import { resolveCalloutDefinition } from '../utils/calloutCatalog'
import { isEmoji } from '../utils/emoji'
import { EmojiPicker } from './EmojiPicker'
import { Button } from './ui/button'

const DEFAULT_CALLOUT_ICON = '💡'

const CALLOUT_BLOCK_CONFIG = {
  type: CALLOUT_BLOCK_TYPE,
  propSchema: {
    calloutType: { default: 'note' },
    title: { default: '' },
  },
  content: 'inline',
} as const

type CalloutBlockViewProps = ReactCustomBlockRenderProps<
  typeof CALLOUT_BLOCK_TYPE,
  typeof CALLOUT_BLOCK_CONFIG.propSchema,
  'inline'
>

function CalloutBlockView({ block, contentRef, editor }: CalloutBlockViewProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const locale = useAppLocale()
  const { calloutType, title } = block.props
  const family = resolveCalloutDefinition({ type: calloutType }).family
  const icon = isEmoji(title) ? title : DEFAULT_CALLOUT_ICON
  const iconLabel = translate(locale, 'customize.icon')

  return (
    <aside
      className={`tolaria-callout tolaria-callout--${family}`}
      data-callout-type={calloutType}
    >
      <div className="tolaria-callout__icon-control" contentEditable={false}>
        <Button
          aria-label={iconLabel}
          className="tolaria-callout__icon-button"
          onClick={() => setIsPickerOpen(current => !current)}
          onMouseDown={event => event.preventDefault()}
          size="icon-sm"
          title={iconLabel}
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true" className="tolaria-callout__emoji">{icon}</span>
        </Button>
        {isPickerOpen && (
          <EmojiPicker
            onClose={() => setIsPickerOpen(false)}
            onSelect={(emoji) => {
              editor.updateBlock(block, { props: { title: emoji } })
              trackEvent('editor_callout_icon_changed')
            }}
          />
        )}
      </div>
      <div ref={contentRef} className="tolaria-callout__body" />
    </aside>
  )
}

export const CalloutBlockSpec = createReactBlockSpec(
  CALLOUT_BLOCK_CONFIG,
  { render: CalloutBlockView },
)
