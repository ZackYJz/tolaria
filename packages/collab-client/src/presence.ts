/**
 * Who is in a document, read from its awareness states. Each client publishes
 * `{ user: { name, color } }`, which is also what BlockNote's cursors show.
 */

export interface PresentUser {
  clientId: number
  name: string
  color: string
  /** True for the client looking at the list. */
  self: boolean
}

/** Text and cursor colours that stay readable on light and dark editor backgrounds. */
export const PRESENCE_COLORS = ['#d9480f', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#e67700', '#5f3dc4'] as const

const FALLBACK_NAME = '?'

function field(state: unknown, key: string): unknown {
  return state instanceof Object ? (state as Record<string, unknown>)[key] : undefined
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/** A stable colour for a name, so a person looks the same to everyone. */
export function userColor(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]
}

/** Up to two letters standing for a name: "Ada Lovelace" is "AL". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words.at(-1) as string] : words
  const short = letters.map((word) => [...word][0]).join('')
  return (short || FALLBACK_NAME).toLocaleUpperCase()
}

/** Everyone who announced a user, the viewer first, the others by name. */
export function presentUsers(states: ReadonlyMap<number, unknown>, selfId: number): PresentUser[] {
  const users: PresentUser[] = []
  for (const [clientId, state] of states) {
    const user = field(state, 'user')
    if (!(user instanceof Object)) continue
    const name = text(field(user, 'name'), FALLBACK_NAME)
    users.push({ clientId, name, color: text(field(user, 'color'), userColor(name)), self: clientId === selfId })
  }
  return users.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
}
