"""Build the Cue brand kit into ./kit"""
import io
import json
import os
import shutil

import cairosvg
from PIL import Image, ImageFilter

import brand as B
import tokens as T

OUT = '/root/cue-brand/kit'
shutil.rmtree(OUT, ignore_errors=True)


def w(path, text):
    p = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f:
        f.write(text)
    return p


def png(svg, path, width=None, height=None, bg=None):
    p = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=p, output_width=width, output_height=height,
                     background_color=bg)
    return p


def svg_img(svg, width=None):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=width))).convert('RGBA')


# =============================================================== 1. LOGO
for name, fill in (('on-light', B.TEXT), ('on-dark', B.TEXT_DARK)):
    s = B.symbol_svg(fill, 24)
    w(f'logo/cue-symbol-{name}.svg', s)
    for px in (16, 32, 64, 128, 256, 512):
        png(s, f'logo/png/cue-symbol-{name}-{px}.png', px, px)
    s, (lw, lh) = B.lockup_svg(120, fill)
    w(f'logo/cue-lockup-{name}.svg', s)
    for scale in (1, 2, 4):
        png(s, f'logo/png/cue-lockup-{name}@{scale}x.png', round(lw * scale / 1.2))
# brand-ink versions (accent ink) for the lockup
s, _ = B.lockup_svg(120, B.INK)
w('logo/cue-lockup-ink.svg', s)

# =============================================================== 2. APP ICON
APP = ['light', 'dark', 'tinted-light', 'tinted-dark', 'clear-light', 'clear-dark']


def mac_png(appearance, size, simple=False, shadow=True):
    """Flat macOS PNG on the 1024 grid, with the template drop shadow."""
    big = svg_img(B.icon_svg(appearance, simple=simple), 1024)
    if shadow and not appearance.startswith('clear'):
        a = big.split()[3]
        sh = Image.new('RGBA', big.size, (0, 0, 0, 0))
        mask = a.point(lambda v: int(v * 0.30))  # #000000 @ 30%
        sh.putalpha(mask)
        sh = sh.filter(ImageFilter.GaussianBlur(14))
        canvas = Image.new('RGBA', big.size, (0, 0, 0, 0))
        canvas.alpha_composite(sh, (0, 12))
        canvas.alpha_composite(big)
        big = canvas
    return big.resize((size, size), Image.LANCZOS) if size != 1024 else big


for ap in APP:
    w(f'app-icon/macos/cue-icon-{ap}.svg', B.icon_svg(ap))
    mac_png(ap, 1024).save(f'{OUT}/app-icon/macos/cue-icon-{ap}-1024.png')
w('app-icon/macos/cue-icon-small-light.svg', B.icon_svg('light', simple=True))
w('app-icon/macos/cue-icon-small-dark.svg', B.icon_svg('dark', simple=True))

# .iconset + .icns (light; 16/32 use the simplified small master)
iconset = f'{OUT}/app-icon/macos/Cue.iconset'
os.makedirs(iconset, exist_ok=True)
for base in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = base * scale
        simple = px <= 32
        img = mac_png('light', px, simple=simple)
        suffix = '' if scale == 1 else '@2x'
        img.save(f'{iconset}/icon_{base}x{base}{suffix}.png')
master = mac_png('light', 1024)
master.save(f'{OUT}/app-icon/macos/Cue.icns', format='ICNS',
            append_images=[mac_png('light', 16, True), mac_png('light', 32, True), mac_png('light', 64, True)])

# iOS full-bleed (system masks)
for ap in ('light', 'dark', 'tinted-dark'):
    s = B.icon_svg(ap, platform='ios')
    w(f'app-icon/ios/cue-ios-{ap}.svg', s)
    png(s, f'app-icon/ios/cue-ios-{ap}-1024.png', 1024, 1024)

# Icon Composer layered source: one SVG per foreground group on the 1024 canvas.
# Icon Composer treats the whole canvas as the icon shape (macOS 26 included), so the
# layers use the full-bleed scale, same as iOS, not the 824 macOS body.
layers = B.icon_layers(B.INK, k=1024 / 824)
order = [('01-rules', 'rules'), ('02-written-line', 'written'), ('03-current-line', 'current'), ('04-caret', 'caret')]
for fname, key in order:
    body = layers[key]
    # layers are exported at full opacity; opacity lives in Icon Composer
    body = body.replace(f' fill-opacity="{B.op(B.RULE_OPACITY)}"', '').replace(f' fill-opacity="{B.op(B.WRITTEN_OPACITY)}"', '')
    w(f'app-icon/icon-composer/Assets/{fname}.svg',
      f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{body}</svg>\n')
small = B.icon_layers(B.INK, simple=True, k=1024 / 824)['current+caret']
w('app-icon/icon-composer/Assets/small-current-and-caret.svg',
  f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{small}</svg>\n')

# Preview sheet of all appearances on contextual wallpapers
sheet = Image.new('RGBA', (6 * 300 + 7 * 24, 300 + 48 + 40), (0, 0, 0, 0))
walls = {'light': '#D9D9DE', 'dark': '#2A2A2F', 'tinted-light': '#D9D9DE', 'tinted-dark': '#2A2A2F',
         'clear-light': '#B9BCC4', 'clear-dark': '#3A3D45'}
for i, ap in enumerate(APP):
    x = 24 + i * 324
    tile = Image.new('RGBA', (300, 300), walls[ap])
    ic = mac_png(ap, 260)
    tile.alpha_composite(ic, (20, 20))
    sheet.alpha_composite(tile, (x, 24))
sheet.save(f'{OUT}/app-icon/preview-appearances.png')

# =============================================================== 3. TOKENS
w('tokens/tokens.css', T.css())
w('tokens/tokens.json', T.json_tokens())
w('tokens/contrast.md', T.contrast_md())

# =============================================================== shared drawing bits
CMD = ('<g fill="none" stroke="{c}" stroke-width="1.6" stroke-linecap="round">'
       '<rect x="9" y="9" width="6" height="6"/><circle cx="6.6" cy="6.6" r="2.4"/><circle cx="17.4" cy="6.6" r="2.4"/>'
       '<circle cx="6.6" cy="17.4" r="2.4"/><circle cx="17.4" cy="17.4" r="2.4"/></g>')


def keycap(x, y, label, fg, bg, edge, h=40, mono=22):
    """Keycap with label; '⌘' drawn as a path, other glyphs set in Geist Mono."""
    parts = []
    cx = x + 12
    inner = []
    for ch in label:
        if ch == '⌘':
            sz = mono * 0.95
            inner.append(f'<g transform="translate({B.op(cx)} {B.op(y + h / 2 - sz / 2)}) scale({B.op(sz / 24)})">{CMD.format(c=fg)}</g>')
            cx += sz + 2
        else:
            el, adv = B.text_el(ch, 'GeistMono-Regular', mono, cx, y + h / 2 + mono * 0.36, fg)
            inner.append(el)
            cx += adv + 1
    width = cx - x + 10
    parts.append(f'<rect x="{x}" y="{y}" width="{B.op(width)}" height="{h}" rx="9" fill="{bg}" stroke="{edge}" stroke-width="1.5"/>')
    parts.extend(inner)
    return ''.join(parts), width


def shortcut_row(x, y, items, fg, fg2, kbg, kedge, h=40, mono=20, label=20):
    out = []
    cx = x
    for keys, desc in items:
        el, kw = keycap(cx, y, keys, fg, kbg, kedge, h, mono)
        out.append(el)
        cx += kw + 12
        t, tw = B.text_el(desc, 'Geist-Regular', label, cx, y + h / 2 + label * 0.36, fg2)
        out.append(t)
        cx += tw + 36
    return ''.join(out), cx - x - 36


SHORTCUTS = [('⇥', 'nest'), ('⌘↩', 'done'), ('⌘D', 'tomorrow'), ('⌘K', 'everything')]

# =============================================================== 4. README HEADER
def readme_header(mode):
    W, H = 1280, 320
    dark = mode == 'dark'
    ground = B.NIGHT if dark else B.PAPER
    fg = B.TEXT_DARK if dark else B.TEXT
    fg2 = B.TEXT2_DARK if dark else B.TEXT2
    ink = B.INK_DARK if dark else B.INK
    edge = '#FFFFFF' if dark else '#000000'
    edge_op = 0.08 if dark else 0.07
    els, bbox = B.lockup(104, fg, 96, 168)
    tag, _ = B.text_el('Every day is a page. Start typing.', 'Newsreader-Display-Regular', 34, 98, 236, fg2)
    # ruled-paper motif on the right: written line, current line + caret, rules
    mx = 812
    motif = (f'<rect x="{mx}" y="92" width="300" height="20" rx="10" fill="{ink}" fill-opacity="{B.WRITTEN_OPACITY}"/>'
             f'<rect x="{mx}" y="144" width="184" height="20" rx="10" fill="{ink}"/>'
             f'<rect x="{mx + 210}" y="122" width="12" height="64" rx="6" fill="{ink}"/>'
             f'<rect x="{mx}" y="216" width="372" height="3" rx="1.5" fill="{ink}" fill-opacity="{B.RULE_OPACITY}"/>'
             f'<rect x="{mx}" y="256" width="372" height="3" rx="1.5" fill="{ink}" fill-opacity="{B.RULE_OPACITY}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Cue — every day is a page">'
            f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="24" fill="{ground}" stroke="{edge}" stroke-opacity="{edge_op}" stroke-width="2"/>'
            f'{els}{tag}{motif}</svg>\n')


for mode in ('light', 'dark'):
    s = readme_header(mode)
    w(f'readme/readme-header-{mode}.svg', s)
    png(s, f'readme/readme-header-{mode}.png', 2560)
w('readme/README-snippet.md', '''<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme-header-dark.svg">
  <img alt="Cue — every day is a page. Start typing." src="assets/readme-header-light.svg" width="100%">
</picture>
''')

# =============================================================== 5. SOCIAL PREVIEW 1280x640
def social():
    W, H = 1280, 640
    icon = B.icon_svg('light')
    icon_inner = icon[icon.index('>') + 1: icon.rindex('</svg>')]
    els, _ = B.lockup(132, B.TEXT_DARK, 476, 292)
    tag, _ = B.text_el('Every day is a page.', 'Newsreader-Display-Regular', 46, 480, 370, B.TEXT2_DARK)
    sub, _ = B.text_el('Daily notes and to-dos for macOS. Keyboard-first, local-first, open source.',
                       'Geist-Regular', 22, 481, 414, B.TEXT3_DARK)
    row, _ = shortcut_row(480, 470, SHORTCUTS, B.TEXT_DARK, B.TEXT2_DARK, '#232326', '#3A3A40', 44, 20, 20)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Cue — every day is a page">'
            f'<rect width="{W}" height="{H}" fill="{B.NIGHT}"/>'
            f'<g transform="translate(96 166) scale(0.3125)">{icon_inner}</g>'
            f'{els}{tag}{sub}{row}</svg>\n')


s = social()
w('social/github-social-preview.svg', s)
png(s, 'social/github-social-preview.png', 1280, 640)
png(s, 'social/github-social-preview@2x.png', 2560, 1280)

# =============================================================== 6. DMG BACKGROUND 540x380
def dmg():
    W, H = 540, 380
    hint, _ = B.text_el('Drag Cue to Applications', 'Geist-Regular', 13, 270, 318, B.TEXT2, anchor='middle')
    arrow = (f'<g stroke="{B.INK}" stroke-opacity="0.28" stroke-width="2" stroke-linecap="round" fill="none">'
             f'<path d="M222 170 H316"/><path d="M306 162 L316 170 L306 178"/></g>')
    rules = ''.join(f'<rect x="40" y="{y}" width="460" height="1" fill="{B.INK}" fill-opacity="0.06"/>' for y in (272,))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<rect width="{W}" height="{H}" fill="{B.PAPER}"/>{arrow}{rules}{hint}</svg>\n')


s = dmg()
w('dmg/dmg-background.svg', s)
png(s, 'dmg/dmg-background.png', 540, 380)
png(s, 'dmg/dmg-background@2x.png', 1080, 760)
w('dmg/README.md', '''# DMG background

- `dmg-background.png` 540 × 380 and `dmg-background@2x.png` 1080 × 760.
- Combine for Finder: `tiffutil -cathidpicheck dmg-background.png dmg-background@2x.png -out dmg-background.tiff`
- Window 540 × 380, icon size 128. Icon centers: **Cue.app at (150, 170)**, **Applications at (390, 170)**.
- create-dmg: `--window-size 540 380 --icon-size 128 --icon "Cue.app" 150 170 --app-drop-link 390 170 --background dmg-background.tiff`
- Colors: ground #FAFAFB; arrow #2C2C31 @ 28%; rule #2C2C31 @ 6%; label #6C6C72 (Geist Regular 13 px, outlined).
''')

# =============================================================== 7. WEB ICONS
fav = f'''<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
<style>rect{{fill:{B.TEXT}}}@media (prefers-color-scheme: dark){{rect{{fill:{B.TEXT_DARK}}}}}</style>
{B.symbol_shapes('').replace(' fill=""', '')}</svg>
'''
w('web/favicon.svg', fav)
ico_imgs = [mac_png('light', s_, simple=True, shadow=False) for s_ in (16, 32, 48)]
ico_imgs[2].save(f'{OUT}/web/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)],
                 append_images=ico_imgs[:2])
ios = svg_img(B.icon_svg('light', platform='ios'), 1024)
ios.convert('RGB').resize((180, 180), Image.LANCZOS).save(f'{OUT}/web/apple-touch-icon.png')
for px in (192, 512):
    mac_png('light', px, shadow=False).save(f'{OUT}/web/icon-{px}.png')
# maskable: full-bleed paper, content inside the 80% safe circle
mask_svg = B.icon_svg('light', platform='ios').replace('<svg ', '<svg ', 1)
mk = svg_img(mask_svg, 1024)
safe = Image.new('RGBA', (1024, 1024), B.PAPER)
inner = mk.resize((820, 820), Image.LANCZOS)
safe.alpha_composite(inner, (102, 102))
safe.convert('RGB').resize((512, 512), Image.LANCZOS).save(f'{OUT}/web/icon-maskable-512.png')
w('web/site.webmanifest', json.dumps({
    'name': 'Cue', 'short_name': 'Cue',
    'icons': [{'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
              {'src': '/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
    'theme_color': '#FFFFFF', 'background_color': '#FFFFFF', 'display': 'standalone'}, indent=2) + '\n')
w('web/head-snippet.html', '''<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#18181A" media="(prefers-color-scheme: dark)">
''')

print('built', OUT)
