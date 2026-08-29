import { describe, expect, it } from 'vitest'
import { extractPageReferenceContexts } from './pageReferenceContext'

const targets = ['Reference Hub']

describe('extractPageReferenceContexts', () => {
  it('returns the exact line containing a linked reference in a text note', () => {
    const content = [
      '---',
      'type: Note',
      '---',
      '# Source',
      '',
      'Introductory line.',
      'The decision was recorded in [[Reference Hub]] during review.',
      'A later line that should not be included.',
    ].join('\n')

    expect(extractPageReferenceContexts({ content, kind: 'linked', outline: false, targets })).toEqual([
      {
        lines: [{ depth: 0, marker: null, matched: true, text: 'The decision was recorded in [[Reference Hub]] during review.' }],
      },
    ])
  })

  it('returns the matching outline item and its complete child subtree', () => {
    const content = [
      '---',
      '_display: outline',
      '---',
      '- Parent links to [[Reference Hub]]',
      '  - Child one',
      '    1. Grandchild detail',
      '  - Child two',
      '- Sibling must stay outside the preview',
    ].join('\n')

    expect(extractPageReferenceContexts({ content, kind: 'linked', outline: true, targets })).toEqual([
      {
        lines: [
          { depth: 0, marker: '-', matched: true, text: 'Parent links to [[Reference Hub]]' },
          { depth: 1, marker: '-', matched: false, text: 'Child one' },
          { depth: 2, marker: '1.', matched: false, text: 'Grandchild detail' },
          { depth: 1, marker: '-', matched: false, text: 'Child two' },
        ],
      },
    ])
  })

  it('returns plain-text mention lines without treating fenced code as a mention', () => {
    const content = [
      '# Source',
      '',
      '```ts',
      "const example = 'Reference Hub'",
      '```',
      '',
      'Reference Hub was discussed without a link.',
    ].join('\n')

    expect(extractPageReferenceContexts({ content, kind: 'mention', outline: false, targets })).toEqual([
      {
        lines: [{ depth: 0, marker: null, matched: true, text: 'Reference Hub was discussed without a link.' }],
      },
    ])
  })
})
