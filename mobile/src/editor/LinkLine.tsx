import { memo, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { bareLabel } from '@shared/links'
import { useLinkPreview } from '../core/links'
import { metrics, useColors } from '../ui/theme'

/**
 * A line that is only a link, shown as its page: the site's icon, the page's title (a
 * post's text, for a post on X) and where it's from, in the line's own type and rhythm.
 * Never more than two lines. Until the page has answered, it shows the link's address.
 */
export const LinkLine = memo(function LinkLine({ url, done, onWidth }: { url: string; done: boolean; onWidth: (width: number) => void }) {
  const c = useColors()
  const preview = useLinkPreview(url)
  const [broken, setBroken] = useState<string | null>(null)
  const icon = preview?.icon && preview.icon !== broken ? preview.icon : null
  const title = preview?.title
  return (
    <View style={styles.link} onLayout={(e) => onWidth(e.nativeEvent.layout.width)} testID={`link:${url}`}>
      <View style={[styles.iconBox, done && styles.faded]}>
        {icon ? (
          // Icons are drawn for light pages; a dark glyph on a transparent icon would vanish in dark.
          <Image source={{ uri: icon }} style={styles.icon} onError={() => setBroken(icon)} />
        ) : (
          <SymbolView name="link" size={14} weight="medium" tintColor={c.text2} />
        )}
      </View>
      <Text
        numberOfLines={title ? 2 : 1}
        style={[styles.title, { color: done ? c.text3 : c.text }, done && styles.done]}
        testID={title ? `link-title:${title}` : undefined}
      >
        {title ?? bareLabel(url)}
        {title ? <Text style={[styles.byline, { color: done ? c.text3 : c.text2 }]}>{`  ${preview!.byline}`}</Text> : null}
      </Text>
    </View>
  )
})

const ICON = 16

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingVertical: metrics.rowPadding
  },
  iconBox: {
    width: ICON + 8,
    height: metrics.lineHeight,
    justifyContent: 'center'
  },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: 4,
    backgroundColor: '#FFFFFF'
  },
  faded: {
    opacity: 0.5
  },
  title: {
    flexShrink: 1,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight
  },
  byline: {
    fontSize: 15
  },
  done: {
    textDecorationLine: 'line-through'
  }
})
