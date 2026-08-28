import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { VaultEntry } from '../../types'
import { translate, type AppLocale } from '../../lib/i18n'
import {
  journalDateFromEntry,
  journalDateKey,
  shiftJournalDate,
  type JournalOpenSource,
} from '../../utils/journals'

interface JournalDateNavigatorProps {
  entry: VaultEntry
  locale?: AppLocale
  onOpenDate: (date: Date, source: JournalOpenSource) => void
}

export function JournalDateNavigator({
  entry,
  locale = 'en',
  onOpenDate,
}: JournalDateNavigatorProps) {
  const date = journalDateFromEntry(entry)
  if (!date) return null

  const friendlyDate = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
  const previousLabel = translate(locale, 'journal.previousDay')
  const nextLabel = translate(locale, 'journal.nextDay')
  const todayLabel = translate(locale, 'journal.today')

  return (
    <nav
      aria-label={translate(locale, 'journal.navigation')}
      className="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-border bg-muted/20 px-4"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={previousLabel}
        title={previousLabel}
        onClick={() => onOpenDate(shiftJournalDate(date, -1), 'previous')}
      >
        <CaretLeft aria-hidden="true" />
      </Button>
      <div className="mx-2 flex min-w-0 items-baseline gap-2" title={friendlyDate}>
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
          {journalDateKey(date)}
        </span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{friendlyDate}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        aria-label={todayLabel}
        title={todayLabel}
        onClick={() => onOpenDate(new Date(), 'today')}
      >
        <CalendarBlank aria-hidden="true" />
        {todayLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => onOpenDate(shiftJournalDate(date, 1), 'next')}
      >
        <CaretRight aria-hidden="true" />
      </Button>
    </nav>
  )
}
