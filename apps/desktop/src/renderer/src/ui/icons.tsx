/** A small, consistent 16px stroke icon set for the command palette. */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {children}
    </svg>
  )
}

const calendar = (
  <>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" {...stroke} />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...stroke} />
  </>
)

export const icons: Record<string, React.ReactNode> = {
  plus: <Svg><path d="M8 3.5v9M3.5 8h9" {...stroke} /></Svg>,
  complete: (
    <Svg>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.5" {...stroke} />
    </Svg>
  ),
  todo: (
    <Svg>
      <rect x="3" y="3" width="10" height="10" rx="2.5" {...stroke} />
      <path d="M5.8 8.1l1.5 1.5 2.9-3.2" {...stroke} />
    </Svg>
  ),
  text: <Svg><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" {...stroke} /></Svg>,
  bullet: (
    <Svg>
      <path d="M7 4.5h5.5M7 8h5.5M7 11.5h5.5" {...stroke} />
      <circle cx="4" cy="4.5" r="1" fill="currentColor" />
      <circle cx="4" cy="8" r="1" fill="currentColor" />
      <circle cx="4" cy="11.5" r="1" fill="currentColor" />
    </Svg>
  ),
  indent: <Svg><path d="M3 3.5h10M7.5 8h5.5M3 12.5h10M3 6.2L5.2 8 3 9.8" {...stroke} /></Svg>,
  outdent: <Svg><path d="M3 3.5h10M7.5 8h5.5M3 12.5h10M5.2 6.2L3 8l2.2 1.8" {...stroke} /></Svg>,
  up: <Svg><path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" {...stroke} /></Svg>,
  down: <Svg><path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" {...stroke} /></Svg>,
  trash: <Svg><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" {...stroke} /></Svg>,
  today: (
    <Svg>
      {calendar}
      <rect x="5" y="8.5" width="2.5" height="2.5" rx="0.6" fill="currentColor" />
    </Svg>
  ),
  tomorrow: (
    <Svg>
      {calendar}
      <path d="M6.5 10h3.5M8.7 8.6L10 10l-1.3 1.4" {...stroke} />
    </Svg>
  ),
  week: (
    <Svg>
      {calendar}
      <path d="M5 9.5h6M5 11.5h6" {...stroke} strokeWidth={1.1} />
    </Svg>
  ),
  calendar: <Svg>{calendar}</Svg>,
  moveDate: (
    <Svg>
      <path d="M13.5 7V5.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2H7M2.5 6.5h11M5.5 2v3M10.5 2v3" {...stroke} />
      <path d="M9.5 11.5h5M12.8 9.8l1.7 1.7-1.7 1.7" {...stroke} />
    </Svg>
  ),
  prev: <Svg><path d="M9.5 3.5L5 8l4.5 4.5" {...stroke} /></Svg>,
  next: <Svg><path d="M6.5 3.5L11 8l-4.5 4.5" {...stroke} /></Svg>,
  undo: <Svg><path d="M6 4L3.5 6.5 6 9M3.5 6.5h6.25a3 3 0 0 1 0 6H7" {...stroke} /></Svg>,
  redo: <Svg><path d="M10 4l2.5 2.5L10 9M12.5 6.5H6.25a3 3 0 0 0 0 6H9" {...stroke} /></Svg>,
  search: (
    <Svg>
      <circle cx="7" cy="7" r="4.5" {...stroke} />
      <path d="M10.4 10.4L13.5 13.5" {...stroke} />
    </Svg>
  ),
  keyboard: (
    <Svg>
      <rect x="1.5" y="4" width="13" height="8.5" rx="2" {...stroke} />
      <path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5.5 9.7h5" {...stroke} strokeWidth={1.6} />
    </Svg>
  ),
  settings: (
    <Svg>
      <path d="M3 5h10M3 11h10" {...stroke} />
      <circle cx="6" cy="5" r="1.7" {...stroke} fill="var(--bg-elevated)" />
      <circle cx="10" cy="11" r="1.7" {...stroke} fill="var(--bg-elevated)" />
    </Svg>
  ),
  exportFile: <Svg><path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 9v4h9V9" {...stroke} /></Svg>,
  importFile: <Svg><path d="M8 2.5V10M5 7l3 3 3-3M3.5 9v4h9V9" {...stroke} /></Svg>,
  folder: <Svg><path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" {...stroke} /></Svg>,
  theme: (
    <Svg>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </Svg>
  ),
  info: (
    <Svg>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M8 7.3v3.4M8 5.2h.01" {...stroke} strokeWidth={1.6} />
    </Svg>
  ),
  select: (
    <Svg>
      <rect x="2.5" y="4.5" width="11" height="7" rx="2" {...stroke} />
    </Svg>
  ),
  link: (
    <Svg>
      <path d="M6.8 9.2a2.9 2.9 0 0 0 4.1 0l2.2-2.2a2.9 2.9 0 0 0-4.1-4.1l-.9.9" {...stroke} />
      <path d="M9.2 6.8a2.9 2.9 0 0 0-4.1 0L2.9 9a2.9 2.9 0 0 0 4.1 4.1l.9-.9" {...stroke} />
    </Svg>
  ),
  sync: (
    <Svg>
      <path d="M12.8 6.6A5 5 0 0 0 3.6 5.3M3.2 9.4a5 5 0 0 0 9.2 1.3" {...stroke} />
      <path d="M3.4 2.8v2.7h2.7M12.6 13.2v-2.7H9.9" {...stroke} />
    </Svg>
  )
}

const BY_COMMAND: Record<string, keyof typeof icons> = {
  'search.open': 'search',
  'help.shortcuts': 'keyboard',
  'app.settings': 'settings',
  'app.about': 'info',
  'app.checkForUpdates': 'importFile',
  'go.today': 'today',
  'go.tomorrow': 'tomorrow',
  'go.week': 'week',
  'go.prevDay': 'prev',
  'go.nextDay': 'next',
  'go.date': 'calendar',
  'links.open': 'link',
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'item.create': 'plus',
  'item.toggleDone': 'complete',
  'item.toggleTodo': 'todo',
  'item.toText': 'text',
  'item.toBullet': 'bullet',
  'item.toTodo': 'todo',
  'item.indent': 'indent',
  'item.outdent': 'outdent',
  'item.moveUp': 'up',
  'item.moveDown': 'down',
  'item.delete': 'trash',
  'item.select': 'select',
  'move.today': 'moveDate',
  'move.tomorrow': 'moveDate',
  'move.nextWeekday': 'moveDate',
  'move.nextWeek': 'moveDate',
  'move.date': 'moveDate',
  'export.markdown': 'exportFile',
  'export.json': 'exportFile',
  'import.json': 'importFile',
  'app.revealData': 'folder',
  'sync.now': 'sync',
  'theme.system': 'theme',
  'theme.light': 'theme',
  'theme.dark': 'theme'
}

export function commandIcon(id: string): React.ReactNode {
  return icons[BY_COMMAND[id] ?? 'next']
}
