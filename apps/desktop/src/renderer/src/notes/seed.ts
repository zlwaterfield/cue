import { generateNKeysBetween } from 'fractional-indexing'
import { addDays, todayISO } from '@shared/dates'
import { uuidv7 } from '@shared/ids'
import type { ISODate, Item, ItemType } from '@shared/types'
import { backend } from '../data/backend'
import { SCRATCH } from './model'

/** PROTOTYPE — `?seed=1`. A believable week and a few notes, for screenshots in a browser. */

type Line = [type: ItemType, text: string, depth?: number, done?: boolean]

function page(date: ISODate, lines: Line[]): Item[] {
  const keys = generateNKeysBetween(null, null, lines.length)
  const parents: string[] = []
  const now = Date.now()
  return lines.map(([type, text, depth = 0, done = false], i) => {
    const id = uuidv7(now + i)
    parents[depth] = id
    return { id, date, parentId: depth ? parents[depth - 1] : null, position: keys[i], type, text, done, createdAt: now, updatedAt: now, deleted: false, version: '' }
  })
}

const SCRATCH_LINES: Line[] = [
  ['text', 'Hi Dana, thanks for sending the contract over.'],
  ['text', 'Two things before I sign: the notice period reads 90 days where we agreed 30, and the renewal clause is missing the cap we discussed.'],
  ['text', 'Happy to jump on a call Thursday if that’s easier.']
]

const STARRED: Line[][] = [
  [
    ['text', 'Gift ideas'],
    ['bullet', 'Mum: the blue Le Creuset, or the garden kneeler'],
    ['bullet', 'Sam: record player needle, Ottolenghi book'],
    ['bullet', 'Priya: that candle from the place in Hudson']
  ],
  [
    ['text', 'Books to read'],
    ['todo', 'The Remains of the Day', 0, true],
    ['todo', 'Seeing Like a State'],
    ['todo', 'A Swim in a Pond in the Rain'],
    ['todo', 'The Power Broker (again)']
  ],
  [
    ['text', '1:1 with Priya'],
    ['bullet', 'Hiring plan for Q1'],
    ['bullet', 'On-call rotation feels heavy'],
    ['bullet', 'Conference in March?']
  ]
]

export async function seed(): Promise<void> {
  try {
    if (sessionStorage.getItem('cue-dev-items')) return
  } catch {
    // No storage here: seed every time.
  }
  const today = todayISO()
  const items = [
    ...page(today, [
      ['todo', 'Reply to Dana about the contract'],
      ['todo', 'Review the beta 4 release notes', 0, true],
      ['todo', 'Book flights for the offsite'],
      ['bullet', 'Standup: sync fix is in, links ship Monday'],
      ['bullet', 'Ask about the March conference', 1],
      ['todo', 'Pick up the dry cleaning']
    ]),
    ...page(addDays(today, 1), [
      ['todo', 'Call the dentist'],
      ['todo', 'Draft the Q1 plan']
    ]),
    ...page(SCRATCH, SCRATCH_LINES),
    ...STARRED.flatMap((lines, i) => page(addDays(SCRATCH, i + 1), lines))
  ]
  await backend.saveItems(items)
}
