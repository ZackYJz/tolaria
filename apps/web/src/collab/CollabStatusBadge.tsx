import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import type { CollabProvider, CollabStatus } from '../../../../packages/collab-client/src/collabProvider'
import { DOC_META, DOC_META_MAP } from '../../../../packages/protocol/src/index'
import { Badge } from '../../../../src/components/ui/badge'
import { type AppLocale, type TranslationKey, translate } from '../../../../src/lib/i18n'

interface StatusProps {
  provider: CollabProvider
  locale: AppLocale
}

const STATUS_LABELS: Record<CollabStatus, TranslationKey> = {
  connecting: 'collab.status.connecting',
  syncing: 'collab.status.syncing',
  synced: 'collab.status.synced',
  offline: 'collab.status.offline',
  closed: 'collab.status.closed',
}

function useCollabStatus(provider: CollabProvider): CollabStatus {
  return useSyncExternalStore(
    (notify) => provider.onStatus(notify),
    () => provider.status,
  )
}

/** Connection and sync state of the note, announced to assistive technology when it changes. */
export function CollabStatusBadge({ provider, locale }: StatusProps) {
  const status = useCollabStatus(provider)
  return (
    <Badge
      variant={status === 'offline' ? 'destructive' : 'secondary'}
      className="collab-status"
      role="status"
      data-status={status}
      data-testid="collab-status"
    >
      <span className="collab-status__dot" aria-hidden="true" />
      {translate(locale, STATUS_LABELS[status])}
    </Badge>
  )
}

function useConflictCopy(doc: Y.Doc): string | undefined {
  const meta = doc.getMap<string>(DOC_META_MAP)
  return useSyncExternalStore(
    (notify) => {
      meta.observe(notify)
      return () => meta.unobserve(notify)
    },
    () => meta.get(DOC_META.conflictCopy),
  )
}

/** Tells the user where their edits went when they could not be merged with the file. */
export function ConflictNotice({ doc, locale }: { doc: Y.Doc; locale: AppLocale }) {
  const copy = useConflictCopy(doc)
  if (!copy) return null
  return (
    <p className="collab-conflict" role="alert" data-testid="collab-conflict">
      {translate(locale, 'collab.conflict', { file: copy })}
    </p>
  )
}
