"""App Store creative assets — the product page header and search results images.

These are not screenshots. App Store Connect's creative asset slots take landscape
art at fixed sizes (brand/app-store/README.md lists them), so this builds them from
the same screens, headline and palette as the portrait screenshots in ../store.

    python3 brand/app-store/creative/make.py

Needs Pillow and Playwright, and a Chrome or Chromium on the machine. Renders with
Chrome at a device scale factor, then flattens to RGB — App Store Connect rejects
images with an alpha channel.
"""
import base64
import os
import shutil

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SCREENS = os.path.join(ROOT, 'docs', 'app-store', 'screens')

# Brand palette, from brand/README.md.
GRAPHITE = '#1C1C1E'
TEXT_2 = '#6C6C72'
PAPER_TOP = '#EFEFF1'
PAPER_BOTTOM = '#EAEAEC'

HEADLINE = 'Every day<br>is a page.'
SUBLINE = 'Notes, to-dos and links.<br>Your iPhone and Mac, in sync.'

# The iPhone 17 Pro Max, as a fraction of the screen width: 440 × 956 pt with a
# 62 pt display corner, a 125 × 36 pt Dynamic Island, and the 27/1080 bezel the
# portrait screenshots in ../store use.
SCREEN_RATIO = 2868 / 1320
BEZEL = 0.025
SCREEN_RADIUS = 62 / 440
ISLAND = {'w': 125 / 440, 'h': 36 / 440, 'top': 12 / 440}


def data_uri(path, mime):
    with open(path, 'rb') as f:
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode()


FONT = data_uri(os.path.join(ROOT, 'site', 'fonts', 'newsreader-latin.woff2'), 'font/woff2')
LOCKUP = open(os.path.join(ROOT, 'docs', 'brand', 'logo', 'cue-lockup-on-light.svg')).read().replace(
    '<svg ', '<svg class="lockup" ', 1)

# The lockup's height and the air under it, against the headline's size, as the
# portrait screenshots set them.
LOCKUP_HEIGHT = 0.577
LOCKUP_GAP = 0.40


def phone(name, left, top, width):
    """One iPhone, positioned from the left and top of the canvas in CSS pixels."""
    src = data_uri(os.path.join(SCREENS, name), 'image/png')
    return (f'<div class="phone" style="--sw:{width}px;left:{left}px;top:{top}px">'
            f'<div class="screen"><img src="{src}" alt="">'
            f'<div class="island"></div></div></div>')


def page(spec):
    w, h = spec['css']
    size = spec['copy']['headline']
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Newsreader"; font-weight: 400; font-style: normal;
  src: url("{FONT}") format("woff2"); }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; width: {w}px; height: {h}px; overflow: hidden; }}
body {{ background: linear-gradient(180deg, {PAPER_TOP}, {PAPER_BOTTOM});
  -webkit-font-smoothing: antialiased; }}
.copy {{ position: absolute; left: {spec['copy']['left']}px; top: {spec['copy']['top']}px;
  width: {spec['copy']['width']}px; }}
.lockup {{ display: block; height: {size * LOCKUP_HEIGHT}px; width: auto;
  margin-bottom: {size * LOCKUP_GAP}px; }}
h1 {{ margin: 0; color: {GRAPHITE};
  font: 400 {size}px/1.04 "Newsreader", Georgia, serif;
  font-variation-settings: "opsz" 72; letter-spacing: -0.02em; }}
p {{ margin: {size * 0.42}px 0 0; color: {TEXT_2};
  font: {spec['copy']['sub']}px/1.42 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  letter-spacing: -0.01em; }}
.phone {{ position: absolute; --bz: calc(var(--sw) * {BEZEL}); background: {GRAPHITE};
  padding: var(--bz); width: calc(var(--sw) + 2 * var(--bz));
  border-radius: calc(var(--sw) * {SCREEN_RADIUS + BEZEL}); }}
.screen {{ position: relative; width: var(--sw); height: calc(var(--sw) * {SCREEN_RATIO});
  border-radius: calc(var(--sw) * {SCREEN_RADIUS}); overflow: hidden; background: #fff; }}
.screen img {{ display: block; width: 100%; }}
.island {{ position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(var(--sw) * {ISLAND['top']}); width: calc(var(--sw) * {ISLAND['w']});
  height: calc(var(--sw) * {ISLAND['h']}); border-radius: 999px; background: #000; }}
</style></head><body>
<div class="copy">{LOCKUP}<h1>{HEADLINE}</h1><p>{SUBLINE}</p></div>
{''.join(spec['phones'])}
</body></html>'''


# Each asset is one of App Store Connect's creative asset slots. The CSS canvas is
# the pixel size divided by the device scale factor, so the render is exact.
SPECS = [
    {
        'name': 'universal-16x9-5244x2950.png',
        'css': (2622, 1475), 'scale': 2,
        'copy': {'left': 150, 'top': 390, 'width': 800, 'headline': 150, 'sub': 40},
        'phones': [phone('01-today.png', 1046, 220, 650),
                   phone('07-dark.png', 1789, 420, 650)],
    },
    {
        'name': 'header-21x9-3840x1646.png',
        'css': (1920, 823), 'scale': 2,
        'copy': {'left': 120, 'top': 155, 'width': 690, 'headline': 106, 'sub': 29},
        'phones': [phone('01-today.png', 922, 110, 380),
                   phone('07-dark.png', 1371, 190, 380)],
    },
    {
        'name': 'search-3x2-3840x2560.png',
        'css': (1920, 1280), 'scale': 2,
        'copy': {'left': 150, 'top': 285, 'width': 860, 'headline': 146, 'sub': 39},
        'phones': [phone('01-today.png', 1141, 240, 580)],
    },
]


def overview(paths):
    """A contact sheet of the three assets, for the README."""
    pad, gap, inner = 30, 30, 1400
    shots = []
    for path in paths:
        im = Image.open(path)
        shots.append(im.resize((inner, round(im.height * inner / im.width)), Image.LANCZOS))
    sheet = Image.new('RGB', (inner + pad * 2,
                              sum(s.height for s in shots) + gap * (len(shots) - 1) + pad * 2),
                      '#FAFAFB')
    y = pad
    for s in shots:
        sheet.paste(s, (pad, y))
        y += s.height + gap
    return sheet


def main():
    out = HERE
    with sync_playwright() as p:
        chrome = shutil.which('google-chrome') or shutil.which('chromium')
        if not chrome:
            raise SystemExit('no google-chrome or chromium on PATH')
        browser = p.chromium.launch(
            executable_path=chrome,
            args=['--no-sandbox', '--force-color-profile=srgb', '--disable-lcd-text'])
        for spec in SPECS:
            w, h = spec['css']
            pg = browser.new_page(viewport={'width': w, 'height': h},
                                  device_scale_factor=spec['scale'])
            pg.set_content(page(spec))
            pg.wait_for_timeout(500)
            path = os.path.join(out, spec['name'])
            pg.screenshot(path=path)
            pg.close()
            # No alpha channel, and no more of a PNG than the art needs.
            im = Image.open(path).convert('RGB')
            im.save(path, optimize=True)
            print(f'{spec["name"]}  {im.width} × {im.height}')
        browser.close()
    sheet = overview([os.path.join(out, s['name']) for s in SPECS])
    sheet.save(os.path.join(out, 'overview.png'), optimize=True)
    print(f'overview.png  {sheet.width} × {sheet.height}')


if __name__ == '__main__':
    main()
