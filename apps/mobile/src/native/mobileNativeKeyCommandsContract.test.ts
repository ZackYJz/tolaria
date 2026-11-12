import { describe, expect, it } from 'vitest'
import {
  mobileLaunchSearchArgumentName,
  mobileLaunchSearchFromArguments,
  mobileLaunchSearchFromNativeInputs,
} from './mobileNativeKeyCommandsContract'

describe('mobileLaunchSearchFromArguments', () => {
  it('returns an empty search when the QA launch argument is absent', () => {
    expect(mobileLaunchSearchFromArguments(['TolariaMobile'])).toBe('')
  })

  it('normalizes raw query-string launch arguments', () => {
    expect(mobileLaunchSearchFromArguments([
      'TolariaMobile',
      mobileLaunchSearchArgumentName,
      'source=dev-vault&mobileKeyboardShortcutProbe=1',
    ])).toBe('?source=dev-vault&mobileKeyboardShortcutProbe=1')
  })

  it('keeps query arguments that already include a leading question mark', () => {
    expect(mobileLaunchSearchFromArguments([
      'TolariaMobile',
      mobileLaunchSearchArgumentName,
      '?layoutProbe=1',
    ])).toBe('?layoutProbe=1')
  })

  it('extracts the query from URL-shaped launch arguments', () => {
    expect(mobileLaunchSearchFromArguments([
      'TolariaMobile',
      mobileLaunchSearchArgumentName,
      'tolaria://mobile-ui-lab?layoutProbe=1&tabletPanels=all',
    ])).toBe('?layoutProbe=1&tabletPanels=all')
  })

  it('prefers simulator environment search over launch arguments', () => {
    expect(mobileLaunchSearchFromNativeInputs({
      args: [
        'TolariaMobile',
        mobileLaunchSearchArgumentName,
        'layoutProbe=1',
      ],
      environmentSearch: 'mobileKeyboardShortcutProbe=1',
    })).toBe('?mobileKeyboardShortcutProbe=1')
  })
})
