import { describe, expect, it } from 'vitest'
import { initials, PRESENCE_COLORS, presentUsers, userColor } from '../src/presence.ts'

describe('presence', () => {
  it('lists who announced a user, the viewer first and the others by name', () => {
    const states = new Map<number, unknown>([
      [3, { user: { name: 'Luca', color: '#111111' } }],
      [1, { user: { name: 'Ada', color: '#222222' } }],
      [2, { user: { name: 'Me', color: '#333333' } }],
      [4, { cursor: 'no user yet' }],
      [5, null],
    ])

    expect(presentUsers(states, 2).map(({ name, self }) => [name, self])).toEqual([
      ['Me', true],
      ['Ada', false],
      ['Luca', false],
    ])
  })

  it('falls back to a placeholder name and a derived colour', () => {
    const [user] = presentUsers(new Map([[1, { user: { name: '  ', color: 7 } }]]), 9)

    expect(user).toEqual({ clientId: 1, name: '?', color: userColor('?'), self: false })
  })

  it('gives a name the same colour every time, from the palette', () => {
    expect(userColor('Ada Lovelace')).toBe(userColor('Ada Lovelace'))
    expect(PRESENCE_COLORS).toContain(userColor('Luca'))
  })

  it.each([
    ['Ada Lovelace', 'AL'],
    ['luca', 'L'],
    ['  Jean   Luc  Picard ', 'JP'],
    ['', '?'],
    ['émile zola', 'ÉZ'],
  ])('shortens %j to %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
