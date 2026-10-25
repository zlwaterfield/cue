import { useColorScheme } from 'react-native'

/**
 * Brand kit v1.0 (brand/tokens): monochrome graphite, no hue. These must match
 * `brand/tokens/tokens.json`, like the Mac app's `app.css`.
 */
const light = {
  bg: '#FFFFFF',
  bgElevated: '#FFFFFF',
  bgSubtle: '#F5F5F6',
  bgHover: '#0000000B',
  bgSelected: '#FFFFFF',
  text: '#1C1C1E',
  text2: '#6C6C72',
  text3: '#8E8E94',
  line: '#00000012',
  lineStrong: '#0000003D',
  accent: '#2C2C31',
  onAccent: '#FFFFFF',
  accentSoft: '#2C2C311A',
  selection: '#2C2C3112',
  textSelection: '#2C2C3129',
  toastBg: '#1F1F23',
  toastText: '#F2F2F4'
}

const dark: typeof light = {
  bg: '#18181A',
  bgElevated: '#232326',
  bgSubtle: '#2C2C30',
  bgHover: '#FFFFFF0F',
  bgSelected: '#3A3A3F',
  text: '#ECECEF',
  text2: '#9D9DA4',
  text3: '#76767D',
  line: '#FFFFFF13',
  lineStrong: '#FFFFFF42',
  accent: '#E6E6EA',
  onAccent: '#18181A',
  accentSoft: '#E6E6EA24',
  selection: '#E6E6EA14',
  textSelection: '#E6E6EA38',
  toastBg: '#333338',
  toastText: '#F2F2F4'
}

export type Colors = typeof light
export const colors = { light, dark }

/**
 * Editor metrics: iOS body text with hanging markers. A screen has two left edges: the
 * outer one (`gutter`), where the month, the week's first day and the markers start, and
 * the inner one (`gutter + marker`), where every line of text starts. A nested line's
 * marker sits on its parent's text edge.
 */
export const metrics = {
  fontSize: 17,
  lineHeight: 24,
  rowPadding: 4,
  /** Height of a single-line row. */
  rowHeight: 32,
  marker: 28,
  indent: 28,
  gutter: 20,
  column: 680
}

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light
}
