import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { COMMANDS_BY_ID, toAccelerator } from '../shared/commands'

/**
 * Native application menu generated from the shared command list. Menu items send
 * the command id to the renderer, which owns all editor behavior. Only shortcuts
 * that include ⌘ are registered as key equivalents; plain keys like Tab or ⌥↑ stay
 * with the editor so they never interfere with text editing.
 */

export function sendCommand(id: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('command', id)
}

function command(id: string, label?: string): MenuItemConstructorOptions {
  const meta = COMMANDS_BY_ID[id]
  if (!meta) throw new Error(`Unknown command ${id}`)
  return {
    label: label ?? meta.title,
    accelerator: toAccelerator(meta.shortcut),
    click: () => sendCommand(id)
  }
}

const separator: MenuItemConstructorOptions = { type: 'separator' }

export function buildMenu(options: { isDev: boolean }): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        command('app.about', 'About Cue'),
        separator,
        command('app.settings', 'Settings…'),
        separator,
        { role: 'services' },
        separator,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        separator,
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        command('item.create', 'New Item'),
        separator,
        command('export.markdown'),
        command('export.json'),
        command('import.json'),
        separator,
        command('app.revealData'),
        separator,
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        command('edit.undo'),
        command('edit.redo'),
        separator,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        separator,
        command('search.open', 'Find…'),
        separator,
        {
          label: 'Speech',
          submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }]
        }
      ]
    },
    {
      label: 'Item',
      submenu: [
        command('item.toggleDone', 'Complete / Reopen'),
        command('item.toggleTodo', 'Toggle Bullet / To-do'),
        {
          label: 'Convert To',
          submenu: [command('item.toText', 'Plain Text'), command('item.toBullet', 'Bullet'), command('item.toTodo', 'To-do')]
        },
        separator,
        command('item.indent'),
        command('item.outdent'),
        command('item.moveUp', 'Move Up'),
        command('item.moveDown', 'Move Down'),
        separator,
        command('move.today', 'Move to Today'),
        command('move.tomorrow', 'Move to Tomorrow'),
        command('move.nextWeekday', 'Move to Next Weekday'),
        command('move.nextWeek', 'Move to Next Week'),
        command('move.date', 'Move to Date…'),
        separator,
        command('item.delete', 'Delete')
      ]
    },
    {
      label: 'Go',
      submenu: [
        command('palette.open', 'Command Palette…'),
        separator,
        command('go.today', 'Today'),
        command('go.tomorrow', 'Tomorrow'),
        command('go.week', 'This Week'),
        separator,
        command('go.prevDay', 'Previous Day'),
        command('go.nextDay', 'Next Day'),
        command('go.date', 'Go to Date…')
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Appearance',
          submenu: [
            command('theme.system', 'System'),
            command('theme.light', 'Light'),
            command('theme.dark', 'Dark')
          ]
        },
        separator,
        { role: 'togglefullscreen' },
        ...(options.isDev
          ? ([separator, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [command('help.shortcuts', 'Keyboard Shortcuts'), command('palette.open', 'Command Palette…')]
    }
  ]
  return Menu.buildFromTemplate(template)
}
