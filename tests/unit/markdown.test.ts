import { describe, expect, it } from 'vitest'
import { linesToMarkdown, parseMarkdownLines } from '../../core/markdown'
import { fold, matchRanges } from '../../core/text'

describe('markdown', () => {
  it('round-trips structure through the clipboard format', () => {
    const lines = [
      { depth: 0, type: 'text' as const, done: false, text: 'Notes' },
      { depth: 0, type: 'todo' as const, done: false, text: 'Call Sam' },
      { depth: 1, type: 'todo' as const, done: true, text: 'Find number' },
      { depth: 1, type: 'bullet' as const, done: false, text: 'ask about Friday' }
    ]
    const md = linesToMarkdown(lines)
    expect(md).toBe('Notes\n- [ ] Call Sam\n  - [x] Find number\n  - ask about Friday')
    expect(parseMarkdownLines(md).map(({ raw: _raw, ...l }) => l)).toEqual(lines)
  })

  it('normalizes indentation and markers from other apps', () => {
    const parsed = parseMarkdownLines('    * one\n        • two\n\t\t\t1. three\n    [x] four\n    ☐ five')
    expect(parsed.map((l) => [l.depth, l.type, l.done, l.text])).toEqual([
      [0, 'bullet', false, 'one'],
      [1, 'bullet', false, 'two'],
      [2, 'bullet', false, 'three'],
      [0, 'todo', true, 'four'],
      [0, 'todo', false, 'five']
    ])
  })

  it('separates paragraphs from lists in document mode', () => {
    const md = linesToMarkdown(
      [
        { depth: 0, type: 'text', done: false, text: 'Intro' },
        { depth: 0, type: 'bullet', done: false, text: 'a' },
        { depth: 0, type: 'text', done: false, text: '' },
        { depth: 0, type: 'text', done: false, text: 'Outro' }
      ],
      { document: true }
    )
    expect(md).toBe('Intro\n\n- a\n\nOutro')
  })
})

describe('search folding', () => {
  it('is case and accent insensitive and maps highlights back', () => {
    expect(fold('Café ÉCLAIR')).toBe('cafe eclair')
    expect(matchRanges('Le Café du Coin', ['cafe'])).toEqual([[3, 7]])
  })
})
