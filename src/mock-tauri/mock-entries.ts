/**
 * Mock vault entries for browser development.
 * Provides realistic VaultEntry[] data for browser dev mode.
 */

import type { VaultEntry } from '../types'
import { MOCK_ENTRIES_PART_1 } from './mockEntriesPart1'
import { MOCK_ENTRIES_PART_2 } from './mockEntriesPart2'
import { MOCK_ENTRIES_PART_3 } from './mockEntriesPart3'

// The hand-written demo entries live in three files to keep each one small.
export const MOCK_ENTRIES: VaultEntry[] = [...MOCK_ENTRIES_PART_1, ...MOCK_ENTRIES_PART_2, ...MOCK_ENTRIES_PART_3]
