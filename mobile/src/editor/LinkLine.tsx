import { memo, useState } from 'react'
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { bareLabel } from '@shared/links'
import { useLinkPreview } from '../core/links'
import { metrics, useColors } from '../ui/theme'

/**
 * A line that is only a link, shown as its page: the site's icon, the page's title (a
 * post's text, for a post on X) and where it's from, in the line's own type and rhythm.
 * Never more than two lines. Until the page has answered, it shows the link's address.
 *
 * On a plain line the icon hangs in the marker column (`LinkIcon`), so the title starts
 * on the text edge like every other line; beside a bullet or a box it leads the title.
 */
export const LinkLine = memo(function LinkLine({
  url,
  done,
  icon = true,
  onWidth
}: {
  url: string
  done: boolean
  icon?: boolean
  onWidth: (width: number) => void
}) {
  const c = useColors()
  const preview = useLinkPreview(url)
  const title = preview?.title
  return (
    <View style={styles.link} onLayout={(e) => onWidth(e.nativeEvent.layout.width)} testID={`link:${url}`}>
      {icon ? <SiteIcon url={url} done={done} style={styles.iconBox} /> : null}
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

/** The site's icon in the marker column, centred on where a box would be. */
export const LinkIcon = memo(function LinkIcon({ url, done }: { url: string; done: boolean }) {
  return (
    <View style={styles.hanging}>
      <SiteIcon url={url} done={done} style={styles.hangingBox} />
    </View>
  )
})

function SiteIcon({ url, done, style }: { url: string; done: boolean; style: StyleProp<ViewStyle> }) {
  const c = useColors()
  const preview = useLinkPreview(url)
  const [broken, setBroken] = useState<string | null>(null)
  const icon = preview?.icon && preview.icon !== broken ? preview.icon : null
  return (
    <View style={[style, done && styles.faded]}>
      {icon ? (
        // Icons are drawn for light pages; a dark glyph on a transparent icon would vanish in dark.
        <Image source={{ uri: icon }} style={styles.icon} onError={() => setBroken(icon)} />
      ) : (
        <SymbolView name="link" size={14} weight="medium" tintColor={c.text2} />
      )}
    </View>
  )
}

const ICON = 16
/** The to-do box's size (`Marker`), which a hanging icon centres on. */
const BOX = 18

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
  hanging: {
    width: metrics.marker,
    paddingVertical: metrics.rowPadding
  },
  hangingBox: {
    width: BOX,
    height: metrics.lineHeight,
    alignItems: 'center',
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
