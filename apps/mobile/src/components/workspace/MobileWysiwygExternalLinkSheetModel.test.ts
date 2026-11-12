import { describe, expect, it } from 'vitest'
import {
  nativeWysiwygCanSaveExternalLink,
  nativeWysiwygInitialExternalLinkValue,
  nativeWysiwygNormalizedExternalLink,
} from './MobileWysiwygExternalLinkSheetModel'

describe('native WYSIWYG external link sheet model', () => {
  it('prefills the active TenTap link when the selection is already linked', () => {
    expect(nativeWysiwygInitialExternalLinkValue({ activeLink: 'https://tolaria.app/docs' }))
      .toBe('https://tolaria.app/docs')
    expect(nativeWysiwygInitialExternalLinkValue({ activeLink: null })).toBe('')
  })

  it('uses the desktop external URL normalization rules', () => {
    expect(nativeWysiwygNormalizedExternalLink('tolaria.app/docs')).toBe('https://tolaria.app/docs')
    expect(nativeWysiwygNormalizedExternalLink('https://tolaria.app/docs')).toBe('https://tolaria.app/docs')
    expect(nativeWysiwygNormalizedExternalLink('javascript:alert(1)')).toBeNull()
    expect(nativeWysiwygNormalizedExternalLink('not a url')).toBeNull()
  })

  it('only enables save for URL values that can become desktop external links', () => {
    expect(nativeWysiwygCanSaveExternalLink('tolaria.app')).toBe(true)
    expect(nativeWysiwygCanSaveExternalLink('2026')).toBe(false)
  })
})
