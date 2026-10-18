/**
 * Fill a Cue database with years of realistic daily pages, for performance testing.
 *
 *   pnpm seed <data-dir> [years]
 *
 * Then launch with CUE_USER_DATA=<data-dir>.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db'
import { Repository } from '../src/shared/repository'
import { addDays, todayISO } from '../src/shared/dates'
import { uuidv7 } from '../src/shared/ids'
import type { Item, ItemType } from '../src/shared/types'
import { generateNKeysBetween } from 'fractional-indexing'

const dir = process.argv[2]
const years = Number(process.argv[3] ?? 5)
if (!dir) {
  console.error('usage: seed <data-dir> [years]')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
const repo = new Repository(openDatabase(join(dir, 'cue.sqlite')))

const words = 'call email review draft plan book ship fix write read prep sync design budget invoice gym groceries notes idea meeting launch retro roadmap dentist flight hotel dinner'.split(' ')
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]
const sentence = (): string => {
  const n = 2 + Math.floor(Math.random() * 7)
  const s = Array.from({ length: n }, () => pick(words)).join(' ')
  return s[0].toUpperCase() + s.slice(1)
}

const end = todayISO()
let date = addDays(end, -365 * years)
let total = 0
while (date <= end) {
  const count = 8 + Math.floor(Math.random() * 25)
  const items: Item[] = []
  const keys = generateNKeysBetween(null, null, count)
  let parent: Item | null = null
  for (let i = 0; i < count; i++) {
    const type: ItemType = pick(['text', 'bullet', 'todo', 'todo'])
    const nested = parent && Math.random() < 0.3
    const item: Item = {
      id: uuidv7(),
      date,
      parentId: nested ? parent!.id : null,
      position: keys[i],
      type,
      text: sentence(),
      done: type === 'todo' && Math.random() < 0.6,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      version: ''
    }
    if (!nested) parent = item
    items.push(item)
  }
  repo.saveItems(items)
  total += items.length
  date = addDays(date, 1)
}
console.log(`Seeded ${total} items across ${years} years into ${dir}`)
