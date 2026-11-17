"""The iPhone app's page, laid out in HTML, for the App Store images there is no capture of:
Notes on the iPhone (`notes.py`) and the iPad (`ipad-13/make.py`).

The first eight screens are the app's own React Native screens, run through Expo's web
target. This lays a page out from the same styles: the sizes, colors and spacing here are
the ones in `apps/mobile/src` (`ui/theme.ts`, `ui/Header.tsx`, `ui/NoteStrip.tsx`,
`editor/DayPage.tsx`, `editor/LooseEnds.tsx`, `editor/Row.tsx`, `editor/Marker.tsx`,
`editor/LinkLine.tsx`), with the browser's line boxes and SF Pro's metrics, which is how
Expo's web target set the others. What the other screens already show is taken from them
pixel for pixel: the status bar, the search and settings buttons, the month's and the
earlier to-dos' chevrons and the sites' icons from `screens/01-today.png` and
`screens/05-links.png`, and the link button's symbol from the link headline in
`store/05-links.png`.

SF Pro can't be redistributed, so the text is set in Inter, the closest open face,
tracked to SF Pro's widths at each size (within 1%) and lowered to its baseline. To match
the other screens exactly, run this on a Mac that has SF Pro, with `TEXT` and `DISPLAY`
set to it and `TRACK` and `BASELINE` set for it. Headlines are Newsreader, as on the
others, at the size and spacing measured from them.

Needs Pillow, Playwright and a Chrome or Chromium, like `creative/make.py`.
"""
import base64
import io
import os
import shutil
from contextlib import contextmanager

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

# The app's light colors (apps/mobile/src/ui/theme.ts).
C = {
    'bg': '#FFFFFF',
    'text': '#1C1C1E',
    'text2': '#6C6C72',
    'text3': '#8E8E94',
    'lineStrong': 'rgba(0, 0, 0, 0.24)',
    'accent': '#2C2C31',
    'onAccent': '#FFFFFF',
}
GRAPHITE = '#1C1C1E'
PAPER = '#EFEFF1'
PAPER_BOTTOM = '#EAEAEC'

# Faces: SF Pro Text below 20 pt and SF Pro Display from 20 pt, as iOS does.
TEXT = 'Inter'
DISPLAY = 'Inter Display'
# Inter's tracking that sets each size as wide as SF Pro sets it on the other screens.
TRACK = {34: -0.008, 28: -0.01, 17: -0.026, 16: -0.022, 15: -0.02, 14: -0.015}
# SF Pro's line box, ascender plus descender, as the browser lays out a line with no
# line height of its own.
NATURAL = 1.193
# In the same line box Inter's baseline sits 2 px (at 3×) higher than SF Pro's on the
# other screens; this lowers every line of text to meet it.
BASELINE = '0.036em'

# Pages are laid out in points and rendered at 3×, the iPhone's scale, so what is taken
# from the iPhone screens lands pixel for pixel.
SCALE = 3

# Editor metrics (ui/theme.ts), the marker (editor/Marker.tsx) and a site's icon
# (editor/LinkLine.tsx).
GUTTER, MARKER, INDENT = 20, 28, 28
FONT, LINE, PAD = 17, 24, 4
BOX, ICON = 18, 16
# Where the centre of a line's capitals sits below the top of its row.
CAP_CENTRE = PAD + LINE - FONT * 0.593
# The header's buttons: 36 pt, 4 apart, with a 21 pt symbol whose glyph ends on the gutter.
BUTTON, SYMBOL = 36, 21

# Taken from the other screens: a crop in 3× pixels, and the point it was centred on.
# The buttons' crops start and end on whole points, so they land on whole pixels.
TODAY = 'screens/01-today.png'
LINKS = 'screens/05-links.png'
PIECES = {
    'search': (TODAY, (1062, 216, 1152, 303), (369.5, 86)),
    'settings': (TODAY, (1182, 216, 1272, 303), (409.5, 86)),
    'chevron.down': (TODAY, (419, 246, 457, 270), None),
    'chevron.right': (TODAY, (75, 821, 96, 856), None),
    'wifi': (TODAY, (1021, 76, 1072, 113), None),
    'battery': (TODAY, (1087, 73, 1172, 116), None),
}
# The sites' icons, 16 pt, as the Links screen shows them.
SITES = {
    'Small Kitchen': (147, 1467),
    'Field Guide': (147, 1641),
    '@mayaruns': (147, 1740),
    'Trailmaps': (147, 1911),
    'Atlas of Small Places': (147, 2010),
}


def path(*parts):
    return os.path.join(HERE, *parts)


def data_uri(data, mime):
    return f'data:{mime};base64,' + base64.b64encode(data).decode()


def png_uri(image):
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    return data_uri(buffer.getvalue(), 'image/png')


def piece(name):
    source, box, _ = PIECES[name]
    return Image.open(path(source)).convert('RGB').crop(box)


def site_icon(byline):
    x, y = SITES[byline]
    return Image.open(path(LINKS)).convert('RGB').crop((x, y, x + ICON * SCALE, y + ICON * SCALE))


def placed(image, left, top, width=None, style='', cls=''):
    """An image at a place on the page, in points: at 3× pixels, or `width` points wide."""
    w = image.width / SCALE if width is None else width
    h = image.height * w / image.width
    # At its own size it lands on whole pixels: copied, not resampled, at a point that
    # isn't quite one.
    if width is None:
        style = 'image-rendering:pixelated;' + style
    return (f'<img class="{cls}" src="{png_uri(image)}" alt="" style="position:absolute;'
            f'left:{left:.4f}px;top:{top:.4f}px;width:{w:.4f}px;height:{h:.4f}px;{style}">')


def at_button(name, cx, cy):
    """A header button taken from the other screens, moved to the button centred at cx, cy."""
    _, box, (ox, oy) = PIECES[name]
    return placed(piece(name), cx + box[0] / SCALE - ox, cy + box[1] / SCALE - oy)


def link_symbol(height):
    """SF Symbols' link, from the 05-links headline, as ink `height` pixels tall."""
    grey = Image.open(path('store', '05-links.png')).convert('L').crop((620, 185, 700, 265))
    paper, ink = 239, 28
    alpha = grey.point(lambda v: max(0, min(255, round((paper - v) * 255 / (paper - ink)))))
    # The headline symbols are 66 px tall.
    side = round(alpha.width * height / 66)
    alpha = alpha.resize((side, side), Image.LANCZOS)
    symbol = Image.new('RGBA', alpha.size, C['text2'])
    symbol.putalpha(alpha)
    return symbol


def note_symbol(size, stroke, color, text=True):
    """SF Symbols' note, or note.text with three lines on it: a page with its corner turned.

    `size` is the ink's height and `stroke` the line's weight, both in CSS pixels.
    """
    # Drawn on 24 units, the page 18 across, so the ink is 18 units plus a stroke.
    k = (size - stroke) / 18
    s = stroke / k
    box = 24 * k
    lines = '<path d="M7.8 8.6H16.2M7.8 12.3H16.2M7.8 16H11.6"/>' if text else ''
    return (
        f'<svg width="{box:.3f}" height="{box:.3f}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
        f'stroke-width="{s:.3f}" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M7 3H17A4 4 0 0 1 21 7V14.5L14.5 21H7A4 4 0 0 1 3 17V7A4 4 0 0 1 7 3Z"/>'
        f'<path d="M21 14.5H17.4A2.9 2.9 0 0 0 14.5 17.4V21"/>{lines}</svg>'
    )


def track(size):
    return f'{TRACK[size]}em'


def t(text):
    """Text, lowered to SF Pro's baseline."""
    return f'<span class="t">{text}</span>'


CHECK = ('<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4.2 8.4l2.4 2.4 5.2-5.6" '
         f'fill="none" stroke="{C["onAccent"]}" stroke-width="1.9" stroke-linecap="round" '
         'stroke-linejoin="round"/></svg>')


class Page:
    """One screen of the app, `width` × `height` points, built from the top down."""

    def __init__(self, width, height):
        self.width, self.height = width, height
        self.parts = []

    def add(self, html):
        self.parts.append(html)

    # ------------------------------------------------------------------ Status bar

    def iphone_status(self):
        """The iPhone's status bar, from the other screens. Its safe area is 62 pt."""
        self.add(placed(Image.open(path(TODAY)).convert('RGB').crop((0, 0, 1320, 186)), 0, 0))
        return 62

    def ipad_status(self, time='9:41', date='Wed Oct 28'):
        """The iPad's status bar: the time and date, Wi-Fi and the battery. Its safe area is 24 pt."""
        mid = 12
        # The iPhone's symbols, at the iPad's smaller size.
        k = 0.8
        battery, wifi = piece('battery'), piece('wifi')
        bw, ww = battery.width / SCALE * k, wifi.width / SCALE * k
        right = self.width - 22
        self.add(f'<div class="status" style="left:22px;top:{mid}px">{t(time)}<span style="width:7px"></span>{t(date)}</div>')
        self.add(placed(battery, right - bw, mid - battery.height / SCALE * k / 2, bw))
        self.add(placed(wifi, right - bw - 6 - ww, mid - wifi.height / SCALE * k / 2, ww))
        return 24

    # ------------------------------------------------------------------ Header

    def header(self, top, label, today_pill=False, notes_open=False):
        """The bar (ui/Header.tsx): the month or Notes, then Today, notes, links, search, settings."""
        bar = top + 2
        mid = bar + 22
        if label == 'Notes':
            self.add(f'<div class="bar" style="top:{bar}px">{t("Notes")}</div>')
        else:
            month, year = label.split(' ')
            chevron = piece('chevron.down')
            self.add(f'<div class="bar" style="top:{bar}px">{t(month)}'
                     f'<span class="t" style="color:{C["text3"]}">&nbsp;{year}</span>'
                     f'<img src="{png_uri(chevron)}" alt="" style="width:{chevron.width / SCALE:.3f}px;'
                     f'height:{chevron.height / SCALE:.3f}px;margin-left:6px"></div>')
        right = self.width - (GUTTER - (BUTTON - SYMBOL) / 2)
        settings, search, links, notes = (right - BUTTON / 2 - (BUTTON + 4) * i for i in range(4))
        if today_pill:
            pill_right = notes - BUTTON / 2 - 4 - 4
            self.add(f'<div class="pill" style="right:{self.width - pill_right}px;top:{mid}px">{t("Today")}</div>')
        symbol = note_symbol(58 / SCALE, 5 / SCALE, C['text'] if notes_open else C['text2'], text=notes_open)
        self.add(f'<div class="symbol" style="left:{notes}px;top:{mid}px">{symbol}</div>')
        link = link_symbol(58)
        self.add(placed(link, links - link.width / SCALE / 2, mid - link.height / SCALE / 2))
        self.add(at_button('search', search, mid))
        self.add(at_button('settings', settings, mid))
        return bar + 44

    def week(self, top, days, selected, today, marked):
        """The week strip: seven days sharing the width, the first and last circles on the gutter
        where the screen is narrow enough for that."""
        inset = max(0, (GUTTER + 17 - self.width / 14) * 7 / 6)
        cells = []
        for letter, number in days:
            sel, now = number == selected, number == today
            circle = f'background:{C["accent"]};color:{C["onAccent"]};' if sel else ''
            weight = 'font-weight:700;' if now else ''
            dot = C['text3'] if number in marked and not sel else 'transparent'
            cells.append(
                f'<div class="day"><div class="wd" style="color:{C["text"] if now else C["text2"]}">{t(letter)}</div>'
                f'<div class="num" style="{circle}{weight}">{t(number)}</div>'
                f'<div class="dot" style="background:{dot}"></div></div>')
        self.add(f'<div class="week" style="left:{inset}px;right:{inset}px;top:{top}px">{"".join(cells)}</div>')
        # 4 + the letter + 4 + the circle + 4 + the dot + 4, and 6 below.
        return top + 4 + 11 * NATURAL + 4 + 34 + 4 + 4 + 4 + 6

    def notes_strip(self, top, notes, open_note):
        """The notes there are, where the week is (ui/NoteStrip.tsx)."""
        tabs = ''.join(
            f'<div class="tab" style="{f"background:{C["accent"]};color:{C["onAccent"]}" if n == open_note else f"color:{C["text2"]}"}">{t(n)}</div>'
            for n in notes)
        plus = (f'<div class="add"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1V13M1 7H13" '
                f'stroke="{C["text2"]}" stroke-width="1.9" stroke-linecap="round"/></svg></div>')
        self.add(f'<div class="strip" style="top:{top + 6}px">{tabs}{plus}</div>')
        return top + 6 + 34 + 12

    # ------------------------------------------------------------------ Page head

    def day_head(self, top, title, subtitle):
        """A day's title and date (editor/DayPage.tsx)."""
        self.add(f'<div class="head" style="top:{top + 14}px"><div class="title">{t(title)}</div>'
                 f'<div class="subtitle">{t(subtitle)}</div></div>')
        return top + 14 + 34 * NATURAL + 2 + 15 * NATURAL + 10

    def note_head(self, top, kind, actions):
        """A note's head: what kind of page it is, and what can be done with it."""
        words = ''.join(t(a) for a in actions)
        self.add(f'<div class="head row" style="top:{top + 14}px;height:{15 * NATURAL}px">'
                 f'<div class="kind">{t(kind)}</div><div class="actions">{words}</div></div>')
        return top + 14 + 15 * NATURAL + 2

    def loose_ends(self, top, label):
        """The earlier to-dos, folded (editor/LooseEnds.tsx): 36 pt, pulled up 4, 12 below."""
        mid = top - 4 + 18
        chevron = piece('chevron.right')
        self.add(placed(chevron, PIECES['chevron.right'][1][0] / SCALE, mid - chevron.height / SCALE / 2))
        self.add(f'<div class="loose" style="top:{mid}px">{t(label)}</div>')
        return top - 4 + 36 + 4 + 8

    # ------------------------------------------------------------------ Lines

    def lines(self, top, lines, title_first=False):
        """The page's lines (editor/Row.tsx): (depth, kind, text), kind one of text, bullet, todo,
        done or link; a link's text is (title, byline), shown with its site's icon."""
        rows, y = [], top
        for i, (depth, kind, text) in enumerate(lines):
            title = title_first and i == 0
            left = GUTTER + depth * INDENT
            if kind == 'bullet':
                rows.append(f'<div class="dot-marker" style="left:{left + (BOX - 6) / 2}px;'
                            f'top:{y + CAP_CENTRE - 3:.3f}px"></div>')
            elif kind in ('todo', 'done'):
                rows.append(f'<div class="box{" done" if kind == "done" else ""}" style="left:{left}px;'
                            f'top:{y + CAP_CENTRE - BOX / 2:.3f}px">{CHECK if kind == "done" else ""}</div>')
            elif kind == 'link':
                text, byline = text
                rows.append(placed(site_icon(byline), left + (BOX - ICON) / 2, y + CAP_CENTRE - ICON / 2,
                                   style='border-radius:4px', cls='site'))
                text = f'{text}<span class="byline">  {byline}</span>'
            cls = 'line' + (' title' if title else '') + (' struck' if kind == 'done' else '') + (' link' if kind == 'link' else '')
            rows.append(f'<div class="{cls}" style="left:{left + MARKER}px;top:{y}px;'
                        f'width:{self.width - GUTTER - left - MARKER}px">{t(text)}</div>')
            y += (34 if title else LINE) + 2 * PAD
        self.add(f'<div id="rows">{"".join(rows)}</div>')
        return y

    # ------------------------------------------------------------------ Rendering

    def html(self):
        return f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; width: {self.width}px; height: {self.height}px; overflow: hidden;
  background: {C["bg"]}; -webkit-font-smoothing: antialiased; }}
body {{ position: relative; font-family: "{TEXT}"; color: {C["text"]}; }}
.t {{ position: relative; top: {BASELINE}; }}
.status {{ position: absolute; transform: translateY(-50%); display: flex;
  font: 600 15px/{NATURAL} "{TEXT}"; letter-spacing: 0; }}
.bar {{ position: absolute; left: {GUTTER}px; height: 44px; display: flex; align-items: center;
  font: 600 17px/{NATURAL} "{TEXT}"; letter-spacing: 0; }}
/* Two hairlines, which Expo's web target, like the other screens, draws 2 px wide. */
.pill {{ position: absolute; transform: translateY(-50%); border: 2px solid {C["lineStrong"]};
  border-radius: 14px; padding: 4px 11px; font: 600 14px/16px "{TEXT}"; letter-spacing: 0; }}
.symbol {{ position: absolute; transform: translate(-50%, -50%); display: flex; }}
.week {{ position: absolute; display: flex; }}
.day {{ flex: 1; display: flex; flex-direction: column; align-items: center; padding: 4px 0; }}
.wd {{ font: 600 11px/{NATURAL} "{TEXT}"; letter-spacing: 0.4px; margin-bottom: 4px; }}
.num {{ width: 34px; height: 34px; border-radius: 17px; display: flex; align-items: center;
  justify-content: center; font: 400 16px/{NATURAL} "{TEXT}"; letter-spacing: {track(16)};
  font-variant-numeric: tabular-nums; }}
.day .dot {{ width: 4px; height: 4px; border-radius: 2px; margin-top: 4px; }}
.strip {{ position: absolute; left: {GUTTER - 13}px; display: flex; gap: 6px; }}
.tab {{ height: 34px; border-radius: 17px; padding: 0 13px; display: flex; align-items: center;
  font: 500 15px/{NATURAL} "{TEXT}"; letter-spacing: {track(15)}; white-space: nowrap; }}
.add {{ width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; }}
.head {{ position: absolute; left: {GUTTER + MARKER}px; right: {GUTTER}px; }}
.head.row {{ display: flex; align-items: center; justify-content: space-between; }}
.title {{ font: 700 34px/{NATURAL} "{DISPLAY}"; letter-spacing: {track(34)}; }}
.subtitle {{ margin-top: 2px; font: 400 15px/{NATURAL} "{TEXT}"; letter-spacing: {track(15)};
  color: {C["text2"]}; }}
.kind {{ font: 500 14px/{NATURAL} "{TEXT}"; letter-spacing: {track(14)}; color: {C["text2"]}; }}
.actions {{ display: flex; gap: 18px; font: 400 15px/{NATURAL} "{TEXT}"; letter-spacing: {track(15)};
  color: {C["text2"]}; }}
.loose {{ position: absolute; left: {GUTTER + MARKER}px; transform: translateY(-50%);
  font: 400 15px/{NATURAL} "{TEXT}"; letter-spacing: {track(15)}; color: {C["text2"]}; }}
.line {{ position: absolute; padding: {PAD}px 0; font: 400 {FONT}px/{LINE}px "{TEXT}";
  letter-spacing: {track(17)}; }}
.line.title {{ font: 700 28px/34px "{DISPLAY}"; letter-spacing: {track(28)}; }}
.line.struck {{ color: {C["text3"]}; }}
.line.struck .t {{ text-decoration: line-through; }}
/* The smaller byline sits on its own baseline and makes each line of a link a point taller,
   as on the other screens. */
.line.link {{ line-height: {LINE + 1}px; }}
.byline {{ font-size: 15px; line-height: 1; letter-spacing: {track(15)}; color: {C["text2"]}; }}
.dot-marker {{ position: absolute; width: 6px; height: 6px; border-radius: 3px;
  background: {C["text2"]}; opacity: 0.8; }}
.box {{ position: absolute; width: {BOX}px; height: {BOX}px; border-radius: 5.5px;
  border: 1.5px solid {C["lineStrong"]}; display: flex; align-items: center; justify-content: center; }}
.box.done {{ background: {C["accent"]}; border-color: {C["accent"]}; }}
</style></head><body>
{"".join(self.parts)}
<script>
// A line that wraps is taller; push the rows below it down, as the app's layout does.
let shift = 0;
for (const el of document.querySelectorAll('#rows > *')) {{
  el.style.top = (parseFloat(el.style.top) + shift) + 'px';
  if (el.classList.contains('line')) {{
    const one = el.classList.contains('title') ? {34 + 2 * PAD} : {LINE + 2 * PAD};
    shift += el.getBoundingClientRect().height - one;
  }}
}}
</script>
</body></html>'''


def headline_html(width, height, headline, mark, scale=1.0):
    """The paper, a mark (the lockup or a symbol) and the headline, as on the iPhone images.

    The iPhone images are 1320 px wide; `scale` sizes everything for a wider canvas.
    """
    font = data_uri(open(os.path.join(ROOT, 'site', 'fonts', 'newsreader-latin.woff2'), 'rb').read(), 'font/woff2')
    s = scale
    if mark == 'lockup':
        svg = open(os.path.join(ROOT, 'brand', 'logo', 'cue-lockup-on-light.svg')).read()
        mark_html = svg.replace('<svg ', f'<svg style="height:{LOCKUP["height"] * s}px;width:auto" ', 1)
        mark_top = LOCKUP['top'] * s
    else:
        mark_html = mark(SYMBOL_MARK['height'] * s, SYMBOL_MARK['stroke'] * s)
        mark_top = SYMBOL_MARK['centre'] * s
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Newsreader"; src: url("{font}") format("woff2"); font-weight: 200 800; }}
html, body {{ margin: 0; width: {width}px; height: {height}px; background: {PAPER};
  -webkit-font-smoothing: antialiased; }}
.mark {{ position: absolute; left: {width / 2}px; top: {mark_top}px; display: flex;
  transform: translate(-50%, {"0" if mark == "lockup" else "-50%"}); }}
h1 {{ position: absolute; left: 0; right: 0; top: {HEADLINE["top"] * s}px; margin: 0; text-align: center;
  color: {GRAPHITE}; font: 400 {HEADLINE["size"] * s}px/{HEADLINE["line"]} "Newsreader";
  font-variation-settings: "opsz" 72; letter-spacing: {HEADLINE["track"]}em; }}
</style></head><body><div class="mark">{mark_html}</div><h1>{headline}</h1></body></html>'''


# Measured from the iPhone images (1320 px wide): the headline's Newsreader, the symbol
# above it (66 px tall, centred at 224.5) and the lockup above "Every day is a page."
HEADLINE = {'size': 126.5, 'line': 1.0709, 'track': -0.018, 'top': 328.5}
SYMBOL_MARK = {'centre': 225, 'height': 66, 'stroke': 6.5}
LOCKUP = {'top': 180, 'height': 90}


@contextmanager
def chrome():
    executable = shutil.which('google-chrome') or shutil.which('chromium')
    if not executable:
        raise SystemExit('no google-chrome or chromium on PATH')
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=executable,
            args=['--no-sandbox', '--force-color-profile=srgb', '--disable-lcd-text'])
        try:
            yield browser
        finally:
            browser.close()


def render(browser, html, size, scale):
    page = browser.new_page(viewport={'width': size[0], 'height': size[1]}, device_scale_factor=scale)
    page.set_content(html)
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(300)
    png = page.screenshot()
    page.close()
    return Image.open(io.BytesIO(png)).convert('RGB')


def render_page(browser, page):
    return render(browser, page.html(), (page.width, page.height), SCALE)
