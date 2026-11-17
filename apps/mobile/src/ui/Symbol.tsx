import { SymbolView as ExpoSymbolView, type AndroidSymbol, type SFSymbol as AnySFSymbol, type SymbolViewProps, type SymbolWeight } from 'expo-symbols'
import medium from 'expo-symbols/androidWeights/medium'
import regular from 'expo-symbols/androidWeights/regular'
import semiBold from 'expo-symbols/androidWeights/semiBold'

/**
 * The app's icons are SF Symbols. iOS draws them as they are; Android has no SF Symbols, so
 * each one is drawn as its nearest Material Symbol (the font expo-symbols ships for Android).
 * Only the symbols named here can be used, so a new icon gets its Android twin as it's added.
 */
const MATERIAL = {
  'arrow.turn.down.right': 'subdirectory_arrow_right',
  'arrow.uturn.backward': 'undo',
  briefcase: 'work',
  calendar: 'calendar_today',
  'calendar.badge.plus': 'event_upcoming',
  checklist: 'checklist',
  checkmark: 'check',
  'checkmark.square': 'check_box',
  'chevron.down': 'keyboard_arrow_down',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'clock.arrow.circlepath': 'history',
  'decrease.indent': 'format_indent_decrease',
  'increase.indent': 'format_indent_increase',
  'keyboard.chevron.compact.down': 'keyboard_hide',
  link: 'link',
  'list.bullet': 'format_list_bulleted',
  magnifyingglass: 'search',
  note: 'sticky_note_2',
  'note.text': 'description',
  'person.crop.circle': 'account_circle',
  plus: 'add',
  'sun.max': 'light_mode',
  sunrise: 'wb_twilight',
  trash: 'delete',
  xmark: 'close'
} as const satisfies Partial<Record<AnySFSymbol, AndroidSymbol>>

/** An SF Symbol the app uses, which has a Material Symbol for Android. */
export type SFSymbol = keyof typeof MATERIAL

/** Material Symbols come in fewer weights; heavier SF weights use the semibold font. */
function androidWeight(weight: SymbolWeight | undefined) {
  switch (weight) {
    case 'medium':
      return medium
    case 'semibold':
    case 'bold':
    case 'heavy':
    case 'black':
      return semiBold
    default:
      return regular
  }
}

type Props = Omit<SymbolViewProps, 'name' | 'weight'> & { name: SFSymbol; weight?: SymbolWeight }

/** expo-symbols' SymbolView, taking an SF Symbol name on every platform. */
export function SymbolView({ name, weight, ...props }: Props) {
  return (
    <ExpoSymbolView
      {...props}
      name={{ ios: name, android: MATERIAL[name] }}
      weight={{ ios: weight ?? 'unspecified', android: androidWeight(weight) }}
    />
  )
}
