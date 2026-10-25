import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/main/db'
import { Repository } from '@shared/repository'
import { uuidv7 } from '@shared/ids'
import type { Item } from '@shared/types'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cue-test-'))
}

export function memoryRepo(clock?: () => number): Repository {
  return new Repository(openDatabase(':memory:'), { clock })
}

let pos = 0
export function newItem(partial: Partial<Item> = {}): Item {
  return {
    id: uuidv7(),
    date: '2026-10-17',
    parentId: null,
    position: `a${(pos++).toString().padStart(4, '0')}`,
    type: 'bullet',
    text: 'hello',
    done: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    version: '',
    ...partial
  }
}
