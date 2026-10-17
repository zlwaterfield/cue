"""Shared geometry, color and text-outlining helpers for the Cue brand kit."""
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

FONTS_DIR = '/root/fonts'

# ---------------------------------------------------------------- palette
INK = '#2C2C31'          # accent / brand ink (light)
INK_DARK = '#E6E6EA'     # accent / brand ink (dark)
TEXT = '#1C1C1E'
TEXT_DARK = '#ECECEF'
TEXT2 = '#6C6C72'
TEXT2_DARK = '#9D9DA4'
TEXT3 = '#8E8E94'
TEXT3_DARK = '#76767D'
PAPER = '#FAFAFB'        # icon paper, top
PAPER_2 = '#ECECEF'      # icon paper, bottom
NIGHT = '#18181A'        # dark ground (= dark --bg)
NIGHT_TOP = '#232327'    # dark icon, top
NIGHT_BOTTOM = '#141416' # dark icon, bottom
WHITE = '#FFFFFF'
BLACK = '#000000'

WRITTEN_OPACITY = 0.28   # the already-written line
RULE_OPACITY = 0.10      # ruled hairlines (light)
RULE_OPACITY_DARK = 0.12


def op(x):
    return f'{x:.3g}'

# ---------------------------------------------------------------- symbol
# 24-unit grid; every value is a multiple of 1.5 so it lands on whole
# pixels at 16 px (1 unit = 2/3 px) and at 24/32/48 px.
SYMBOL_LINE = dict(x=4.5, y=13.5, w=9, h=3, r=1.5)     # the written line
SYMBOL_CARET = dict(x=16.5, y=3, w=3, h=18, r=1.5)     # the caret


def symbol_shapes(fill, scale=1.0, dx=0.0, dy=0.0):
    out = []
    for s in (SYMBOL_LINE, SYMBOL_CARET):
        out.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"/>' % (
            op(dx + s['x'] * scale), op(dy + s['y'] * scale), op(s['w'] * scale),
            op(s['h'] * scale), op(s['r'] * scale), fill))
    return ''.join(out)


def symbol_svg(fill, size=24, title='Cue'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24" '
            f'role="img" aria-label="{title}">{symbol_shapes(fill)}</svg>\n')

# ---------------------------------------------------------------- text outlining
_fonts = {}


def font(name):
    if name not in _fonts:
        _fonts[name] = TTFont(f'{FONTS_DIR}/{name}.ttf')
    return _fonts[name]


def text_path(s, fname, size, x=0.0, y=0.0, tracking=0.0, anchor='start'):
    """Return (svg path d, advance width) for s set at baseline (x, y)."""
    f = font(fname)
    upm = f['head'].unitsPerEm
    cmap = f.getBestCmap()
    gs = f.getGlyphSet()
    hmtx = f['hmtx']
    k = size / upm
    glyphs = [cmap.get(ord(ch), '.notdef') for ch in s]
    adv = [hmtx[g][0] * k + tracking * size for g in glyphs]
    total = sum(adv) - (tracking * size if glyphs else 0)
    if anchor == 'middle':
        x -= total / 2
    elif anchor == 'end':
        x -= total
    pen = SVGPathPen(gs)
    cx = x
    for g, a in zip(glyphs, adv):
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, cx, y)))
        cx += a
    return pen.getCommands(), total


def text_el(s, fname, size, x, y, fill, tracking=0.0, anchor='start', opacity=None):
    d, w = text_path(s, fname, size, x, y, tracking, anchor)
    o = f' fill-opacity="{op(opacity)}"' if opacity is not None else ''
    return f'<path d="{d}" fill="{fill}"{o}/>', w


def ink_bounds(s, fname, size):
    f = font(fname)
    k = size / f['head'].unitsPerEm
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    bp = BoundsPen(gs)
    cx = 0
    for ch in s:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(bp, (k, 0, 0, -k, cx, 0)))
        cx += f['hmtx'][g][0] * k
    return bp.bounds  # (xmin, ymin, xmax, ymax) in y-down coords

# ---------------------------------------------------------------- wordmark lockup
# The lockup is the written word plus the caret: "cue|". It is the symbol's
# idea at full size — the word stands in for the written line.
WORD = 'cue'
WORD_FONT = 'Newsreader-Display-Medium'
WORD_TRACK = -0.02            # em
CARET_W = 0.072               # em
CARET_TOP = -0.66             # em above baseline (y-down: negative is up)
CARET_BOTTOM = 0.16           # em below baseline
CARET_GAP = 0.085             # em between the 'e' ink and the caret


def lockup(size, fill, x=0.0, baseline=0.0, caret_fill=None):
    """Return (svg elements, bbox) for the lockup with font size `size`."""
    d, _ = text_path(WORD, WORD_FONT, size, x, baseline, WORD_TRACK)
    b = ink_bounds(WORD, WORD_FONT, size)
    # ink right edge with tracking applied
    f = font(WORD_FONT)
    k = size / f['head'].unitsPerEm
    cmap = f.getBestCmap()
    adv_before_e = sum(f['hmtx'][cmap[ord(c)]][0] * k + WORD_TRACK * size for c in WORD[:-1])
    gs = f.getGlyphSet()
    bp = BoundsPen(gs)
    gs[cmap[ord('e')]].draw(bp)
    e_right = adv_before_e + bp.bounds[2] * k
    cx = x + e_right + CARET_GAP * size
    cw = CARET_W * size
    ct = baseline + CARET_TOP * size
    cb = baseline + CARET_BOTTOM * size
    els = (f'<path d="{d}" fill="{fill}"/>'
           f'<rect x="{op(cx)}" y="{op(ct)}" width="{op(cw)}" height="{op(cb - ct)}" rx="{op(cw / 2)}" fill="{caret_fill or fill}"/>')
    left = x + b[0] * 1.0
    bbox = (x + b[0], ct, cx + cw, cb)
    return els, bbox


def lockup_svg(size, fill, pad=0.0, title='Cue'):
    els, (x0, y0, x1, y1) = lockup(size, fill)
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{op(w)}" height="{op(h)}" '
            f'viewBox="{op(x0 - pad)} {op(y0 - pad)} {op(w)} {op(h)}" role="img" aria-label="{title}">{els}</svg>\n'), (w, h)

# ---------------------------------------------------------------- icon geometry
# macOS 1024 canvas, 824 x 824 body at (100, 100) on Apple's grid.
BODY = (100, 100, 824)


def squircle_path(x, y, size, r=185.0):
    """macOS icon body: 824 x 824 rounded square, corner radius 185 (Apple template).

    On macOS 26 the system applies its own continuous-corner mask via Icon
    Composer; this path is for the flat PNG/ICNS exports and previews.
    """
    x1, y1 = x + size, y + size
    return (f'M{x + r} {y} H{x1 - r} A{r} {r} 0 0 1 {x1} {y + r} V{y1 - r} '
            f'A{r} {r} 0 0 1 {x1 - r} {y1} H{x + r} A{r} {r} 0 0 1 {x} {y1 - r} '
            f'V{y + r} A{r} {r} 0 0 1 {x + r} {y} Z')


# Content on the 1024 canvas (full detail, used at 64 px and up)
ICON_WRITTEN = dict(x=236, y=300, w=424, h=52, r=26)
ICON_CURRENT = dict(x=236, y=432, w=256, h=52, r=26)
ICON_CARET = dict(x=528, y=376, w=32, h=164, r=16)
ICON_RULES = [dict(x=236, y=636, w=552, h=8, r=4), dict(x=236, y=736, w=552, h=8, r=4)]


def _rect(s, fill, opacity=None, t=lambda v: v, k=1.0):
    o = f' fill-opacity="{op(opacity)}"' if opacity is not None and opacity < 1 else ''
    return ('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"%s/>' % (
        op(t(s['x'], 'x')), op(t(s['y'], 'y')), op(s['w'] * k), op(s['h'] * k), op(s['r'] * k), fill, o))


def icon_layers(ink, written_op=WRITTEN_OPACITY, rule_op=RULE_OPACITY, simple=False, k=1.0, cx=512, cy=512):
    """Foreground layers, optionally scaled by k around (cx, cy) (for iOS full-bleed)."""
    def t(v, axis):
        c = cx if axis == 'x' else cy
        return (v - 512) * k + c
    if simple:  # 16/32 px: the symbol alone, large
        sk = 25.0 * k
        ox, oy = t(212, 'x'), t(212, 'y')
        return {'current+caret': symbol_shapes(ink, sk, ox, oy)}
    return {
        'rules': ''.join(_rect(r, ink, rule_op, t, k) for r in ICON_RULES),
        'written': _rect(ICON_WRITTEN, ink, written_op, t, k),
        'current': _rect(ICON_CURRENT, ink, None, t, k),
        'caret': _rect(ICON_CARET, ink, None, t, k),
    }


APPEARANCES = {
    # name: (body top, body bottom, body opacity, ink, written op, rule op, edge (hex, opacity))
    'light':        (PAPER, PAPER_2, 1.0, INK, WRITTEN_OPACITY, RULE_OPACITY, (BLACK, 0.08)),
    'dark':         (NIGHT_TOP, NIGHT_BOTTOM, 1.0, INK_DARK, 0.30, RULE_OPACITY_DARK, (WHITE, 0.12)),
    'tinted-light': ('#F2F2F3', '#E2E2E5', 1.0, '#3A3A3F', 0.30, 0.12, (BLACK, 0.08)),
    'tinted-dark':  ('#1A1A1C', '#0E0E10', 1.0, WHITE, 0.32, 0.14, (WHITE, 0.10)),
    'clear-light':  (WHITE, WHITE, 0.42, TEXT, 0.30, 0.12, (WHITE, 0.55)),
    'clear-dark':   (BLACK, BLACK, 0.38, WHITE, 0.34, 0.14, (WHITE, 0.22)),
}


def icon_svg(appearance='light', platform='macos', simple=False, backdrop=None):
    top, bottom, body_op, ink, wop, rop, (edge, edge_op) = APPEARANCES[appearance]
    gid = 'g' + appearance.replace('-', '')
    defs = (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>')
    parts = [defs]
    if backdrop:
        parts.append(backdrop)
    if platform == 'macos':
        body = squircle_path(*BODY)
        parts.append(f'<path d="{body}" fill="url(#{gid})" fill-opacity="{op(body_op)}"/>')
        parts.append(f'<path d="{body}" fill="none" stroke="{edge}" stroke-opacity="{op(edge_op)}" stroke-width="4"/>')
        layers = icon_layers(ink, wop, rop, simple)
    else:  # iOS: full-bleed square, the system applies the mask
        parts.append(f'<rect width="1024" height="1024" fill="url(#{gid})" fill-opacity="{op(body_op)}"/>')
        layers = icon_layers(ink, wop, rop, simple, k=1024 / 824)
    parts.extend(layers.values())
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            + ''.join(parts) + '</svg>\n')
