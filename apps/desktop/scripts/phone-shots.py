"""
Writes the home page's iPhone shot, light and dark (Pillow, Playwright and a Chrome or
Chromium).

    python3 apps/desktop/scripts/phone-shots.py
    python3 apps/desktop/scripts/phone-shots.py --screens <folder>

With `--screens` it also writes the light screens at full size, `today.png` and
`notes.png` (1320 × 2868), which is where the images for X get their iPhones
(`scripts/x-carousel.mjs`).

The phone holds the same day as the Mac window behind it on the page
(`scripts/screenshots.mjs`), so when that day's lines change, change `LINES` here too.

There is no capture of that day on a phone: the screens can only be captured on a Mac.
So the light one is laid out in HTML from the app's own styles by
`brand/app-store/page.py`, which says how, and what it takes pixel for pixel from the App
Store screens. This adds what the app has gained since those screens: a top bar with
only links and settings, a week strip without dots, and the tabs at the bottom
(`apps/mobile/src/ui/Header.tsx`, `ui/TabBar.tsx`). The tabs' glass is drawn as a plain
translucent capsule, and SF Symbols' sun is drawn by hand, as `page.py` draws the note.

The dark one is derived from the light one. The iPhone app's screens are grey from end
to end, so going light to dark is one tone curve per channel, and the curve is measured
rather than guessed: `01-today.png` and `07-dark.png` share their status bar, month
label and weekday letters pixel for pixel, so pairing those rows gives the app's own
light-to-dark mapping. It lands on the brand tokens exactly (#1C1C1E → #ECECEF,
#6C6C72 → #9D9DA4, #8E8E94 → #76767D), and on the rows it was not fitted on it matches
the real dark screenshot within 8/255 for 94% of pixels — the rest being the two days'
different content, not the curve.

Capture real screenshots of the day, light and dark, and all of this can go.
"""
import os
import sys

import numpy as np
from PIL import Image

# The repository root, three folders up: this script reads the App Store screens and
# writes into the site.
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SCREENS = os.path.join(ROOT, 'brand', 'app-store', 'screens')
OUT = os.path.join(ROOT, 'site', 'images')

sys.path.insert(0, os.path.join(ROOT, 'brand', 'app-store'))
import page  # noqa: E402
from page import BUTTON, C, GUTTER, NATURAL, SYMBOL  # noqa: E402

# The iPhone 17 Pro Max, as the App Store screens are: 440 × 956 pt, with 34 pt under
# the home indicator.
WIDTH, HEIGHT, INSET_BOTTOM = 440, 956, 34

# The day in the Mac window (scripts/screenshots.mjs): (depth, kind, text).
MONTH = 'November 2026'
WEEK = [('M', 16), ('T', 17), ('W', 18), ('T', 19), ('F', 20), ('S', 21), ('S', 22)]
TODAY = 18
SUBTITLE = 'Wednesday, November 18'
EARLIER = '1 open from earlier day'
LINES = [
    (0, 'text', 'Slow morning. Coffee, errands, then the long run.'),
    (0, 'done', 'Pick up dry cleaning'),
    (0, 'todo', 'Call Mom about Thanksgiving'),
    (0, 'todo', 'Groceries'),
    (1, 'bullet', 'oat milk'),
    (1, 'bullet', 'eggs'),
    (1, 'bullet', 'lemons'),
    (0, 'bullet', 'Offsite ideas'),
    (1, 'bullet', 'Cabin near the lake? https://example.com/cabin'),
    (1, 'bullet', 'Cooking class instead of a dinner'),
    (0, 'todo', 'Send the Q4 plan to Priya'),
]

# The tabs (ui/TabBar.tsx): a 56 pt capsule of two 84 pt tabs, and search in a circle.
BAR, TAB, PADDING = 56, 84, 4

SCALE = 0.5
QUALITY = 86

# The rows `01-today.png` and `07-dark.png` share: the status bar and the month
# label. The weekday letters below them are shared too, but the selected day's
# circle sits among them and differs, so they are left out.
SHARED = [(40, 130, 0, 1320), (230, 300, 40, 560)]


def tone_curve(light, dark, channel):
    """The app's light-to-dark mapping for one channel, as a 256-entry table."""
    samples = {}
    for r0, r1, c0, c1 in SHARED:
        for a, b in zip(light[r0:r1, c0:c1, channel].ravel(), dark[r0:r1, c0:c1, channel].ravel()):
            samples.setdefault(int(a), []).append(int(b))

    points = []
    for value in sorted(samples):
        seen = sorted(samples[value])
        n = len(seen)
        # Too few samples to trust, or the two screens disagree about this grey.
        if n < 20 or seen[9 * n // 10] - seen[n // 10] > 12:
            continue
        points.append([value, float(seen[n // 2]), float(n)])

    # Darker ink can only map to lighter ink, so pool any pair that says otherwise
    # (pool adjacent violators), weighted by how many pixels each was measured from.
    i = 0
    while i < len(points) - 1:
        if points[i][1] < points[i + 1][1]:
            _, out_b, n_b = points.pop(i + 1)
            value, out_a, n_a = points[i]
            points[i] = [value, (out_a * n_a + out_b * n_b) / (n_a + n_b), n_a + n_b]
            i = max(i - 1, 0)
        else:
            i += 1

    curve = np.interp(np.arange(256), [p[0] for p in points], [p[1] for p in points])
    return np.clip(np.round(curve), 0, 255).astype(np.uint8)


def header(p, top, notes=False):
    """The bar (ui/Header.tsx): the month, or Notes, then links and settings."""
    bar, mid = top + 2, top + 24
    if notes:
        p.add(f'<div class="bar" style="top:{bar}px">{page.t("Notes")}</div>')
    else:
        month, year = MONTH.split(' ')
        chevron = page.piece('chevron.down')
        p.add(f'<div class="bar" style="top:{bar}px">{page.t(month)}'
              f'<span class="t" style="color:{C["text3"]}">&nbsp;{year}</span>'
              f'<img src="{page.png_uri(chevron)}" alt="" style="width:{chevron.width / page.SCALE:.3f}px;'
              f'height:{chevron.height / page.SCALE:.3f}px;margin-left:6px"></div>')
    right = p.width - (GUTTER - (BUTTON - SYMBOL) / 2)
    settings, links = right - BUTTON / 2, right - BUTTON / 2 - (BUTTON + 4)
    link = page.link_symbol(58)
    p.add(page.placed(link, links - link.width / page.SCALE / 2, mid - link.height / page.SCALE / 2))
    p.add(page.at_button('settings', settings, mid))
    return bar + 44


def week(p, top):
    """The week strip: the open day solid, and no dots."""
    inset = max(0, (GUTTER + 17 - p.width / 14) * 7 / 6)
    cells = ''.join(
        f'<div class="day"><div class="wd" style="color:{C["text"] if n == TODAY else C["text2"]}">{page.t(letter)}</div>'
        f'<div class="num" style="{f"background:{C['accent']};color:{C['onAccent']};font-weight:700" if n == TODAY else ""}">'
        f'{page.t(n)}</div></div>'
        for letter, n in WEEK)
    p.add(f'<div class="week" style="left:{inset}px;right:{inset}px;top:{top}px">{cells}</div>')
    # 4 + the letter + 4 + the circle + 4, and 8 below.
    return top + 4 + 11 * NATURAL + 4 + 34 + 4 + 8


def sun_symbol(size, stroke, color):
    """SF Symbols' sun.max: a disc and eight rays. `size` is the ink's height in CSS pixels."""
    rays = ''.join(f'<path d="M12 2.2V4.6" transform="rotate({45 * i} 12 12)"/>' for i in range(8))
    return (f'<svg width="{size}" height="{size}" viewBox="1.2 1.2 21.6 21.6" fill="none" stroke="{color}" '
            f'stroke-width="{stroke * 21.6 / size:.3f}" stroke-linecap="round"><circle cx="12" cy="12" r="4.3"/>{rays}</svg>')


def search_symbol():
    """The header's magnifying glass from the App Store screens, in the text's color."""
    grey = page.piece('search').convert('L')
    paper, ink = 255, 108
    alpha = grey.point(lambda v: max(0, min(255, round((paper - v) * 255 / (paper - ink)))))
    symbol = Image.new('RGBA', alpha.size, C['text'])
    symbol.putalpha(alpha)
    return symbol


def tab_bar(p, notes=False):
    """Today and Notes in one capsule, the open one lit; search in its own (ui/TabBar.tsx)."""
    surface = ('background:rgba(255,255,255,0.86);box-shadow:0 0 0 0.5px rgba(0,0,0,0.1),'
               '0 6px 18px -4px rgba(0,0,0,0.16);')
    label = "font:{w} 10.5px/1.193 '" + page.TEXT + "';letter-spacing:0.1px;color:{c}"
    tab = ('width:%dpx;height:%dpx;border-radius:%dpx;display:flex;flex-direction:column;align-items:center;'
           'justify-content:center;gap:2px;' % (TAB, BAR - 2 * PADDING, (BAR - 2 * PADDING) // 2))
    lit = 'background:rgba(44,44,49,0.1)'

    def one(name, on, symbol):
        color = C['text'] if on else C['text2']
        return (f'<div style="{tab}{lit if on else ""}">{symbol(color)}'
                f'<div style="{label.format(w=600 if on else 500, c=color)}">{name}</div></div>')

    today = one('Today', not notes, lambda color: sun_symbol(21, 1.9 if not notes else 1.6, color))
    notes = one('Notes', notes, lambda color: page.note_symbol(19, 1.9 if notes else 1.6, color))
    bottom = max(INSET_BOTTOM - 12, 12)
    top = p.height - bottom - BAR
    p.add(f'<div style="position:absolute;left:{GUTTER}px;top:{top}px;height:{BAR}px;border-radius:{BAR // 2}px;'
          f'padding:{PADDING}px;display:flex;gap:2px;{surface}">{today}{notes}</div>')
    p.add(f'<div style="position:absolute;left:{p.width - GUTTER - BAR}px;top:{top}px;width:{BAR}px;height:{BAR}px;'
          f'border-radius:{BAR // 2}px;{surface}"></div>')
    glass = search_symbol()
    p.add(page.placed(glass, p.width - GUTTER - BAR / 2 - glass.width / page.SCALE / 2,
                      top + BAR / 2 - glass.height / page.SCALE / 2, style='mix-blend-mode:multiply'))


def screen(browser):
    p = page.Page(WIDTH, HEIGHT)
    y = p.iphone_status()
    y = header(p, y)
    y = week(p, y)
    y = p.day_head(y, 'Today', SUBTITLE)
    y = p.loose_ends(y, EARLIER)
    p.lines(y, LINES)
    tab_bar(p)
    return page.render_page(browser, p)


# The Notes tab, for the images for X: a starred note, with scratch and one more beside it.
NOTES, OPEN = ['Scratch', 'Books to read', 'Gift ideas'], 'Books to read'
NOTE_LINES = [
    (0, 'text', 'Books to read'),
    (0, 'done', 'The Remains of the Day'),
    (0, 'todo', 'Seeing Like a State'),
    (0, 'todo', 'A Swim in a Pond in the Rain'),
    (1, 'bullet', 'Start with the Chekhov chapter'),
    (0, 'todo', 'Middlemarch'),
]


def notes_screen(browser):
    p = page.Page(WIDTH, HEIGHT)
    y = p.iphone_status()
    y = header(p, y, notes=True)
    y = p.notes_strip(y, NOTES, OPEN)
    y = p.note_head(y, '★ Starred', ['Share', 'Delete'])
    p.lines(y, NOTE_LINES, title_first=True)
    tab_bar(p, notes=True)
    return page.render_page(browser, p)


def read(name):
    return np.asarray(Image.open(os.path.join(SCREENS, name)).convert('RGB'), dtype=np.uint8)


def write(pixels, name):
    image = Image.fromarray(pixels)
    size = (round(image.width * SCALE), round(image.height * SCALE))
    image = image.resize(size, Image.LANCZOS)
    path = os.path.join(OUT, name)
    image.save(path, 'WEBP', quality=QUALITY, method=6)
    print(f'{os.path.relpath(path, ROOT)}  {size[0]} × {size[1]}  {os.path.getsize(path) // 1024} KB')


folder = sys.argv[sys.argv.index('--screens') + 1] if '--screens' in sys.argv else None
with page.chrome() as browser:
    today = screen(browser)
    if folder:
        os.makedirs(folder, exist_ok=True)
        for name, shot in (('today.png', today), ('notes.png', notes_screen(browser))):
            shot.save(os.path.join(folder, name), optimize=True)
            print(f'{os.path.relpath(os.path.join(folder, name), ROOT)}  {shot.width} × {shot.height}')
light = np.asarray(today, dtype=np.uint8)
curves = [tone_curve(read('01-today.png'), read('07-dark.png'), channel) for channel in range(3)]
dark = np.stack([curves[channel][light[:, :, channel]] for channel in range(3)], axis=2)

write(light, 'phone-light.webp')
write(dark, 'phone-dark.webp')
