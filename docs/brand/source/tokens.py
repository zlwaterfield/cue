"""Final Cue color tokens + contrast math. Writes tokens.css, tokens.json, contrast.md."""
import json

# token: (light hex, light opacity, dark hex, dark opacity, role, note-if-changed)
TOKENS = [
    ('--bg',             '#FFFFFF', 1,     '#18181A', 1,     'Window background', ''),
    ('--bg-elevated',    '#FFFFFF', 1,     '#232326', 1,     'Palette, sheets', ''),
    ('--bg-subtle',      '#F5F5F6', 1,     '#2C2C30', 1,     'Keycaps, segmented controls', 'dark was #242427 — invisible on --bg-elevated (1.01:1); now 1.13:1'),
    ('--bg-hover',       '#000000', 0.045, '#FFFFFF', 0.06,  'Hover fill', ''),
    ('--text',           '#1C1C1E', 1,     '#ECECEF', 1,     'Primary text', ''),
    ('--text-2',         '#6C6C72', 1,     '#9D9DA4', 1,     'Secondary text', ''),
    ('--text-3',         '#8E8E94', 1,     '#76767D', 1,     'Tertiary, placeholders, done items', 'was #A6A6AC / #626268 (2.4–2.9:1); raised to a 3:1 floor'),
    ('--line',           '#000000', 0.07,  '#FFFFFF', 0.075, 'Hairlines, day separators', ''),
    ('--line-strong',    '#000000', 0.24,  '#FFFFFF', 0.26,  'Checkbox borders', 'was 17% / 20%; raised so empty checkboxes read'),
    ('--accent',         '#2C2C31', 1,     '#E6E6EA', 1,     'Checked boxes, links, caret', ''),
    ('--on-accent',      '#FFFFFF', 1,     '#18181A', 1,     'Checkmark on accent', ''),
    ('--accent-soft',    '#2C2C31', 0.10,  '#E6E6EA', 0.14,  'Search highlight, focus ring', ''),
    ('--selection',      '#2C2C31', 0.07,  '#E6E6EA', 0.08,  'Selected-lines band', ''),
    ('--text-selection', '#2C2C31', 0.16,  '#E6E6EA', 0.22,  'Text selection', ''),
    ('--toast-bg',       '#1F1F23', 1,     '#333338', 1,     'Toast', 'dark was #2C2C31 — too close to --bg-elevated'),
    ('--toast-text',     '#F2F2F4', 1,     '#F2F2F4', 1,     'Toast', ''),
]


def hex8(h, a):
    if a >= 1:
        return h
    return h + '%02X' % round(a * 255)


def lum(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def composite(fg, a, bg):
    f = [int(fg[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join('%02X' % round(f[i] * a + b[i] * (1 - a)) for i in range(3))


def get(mode, name):
    for t in TOKENS:
        if t[0] == name:
            return (t[1], t[2]) if mode == 'light' else (t[3], t[4])


def contrast_rows():
    rows = []
    for mode in ('light', 'dark'):
        for fg in ('--text', '--text-2', '--text-3', '--accent'):
            for bg in ('--bg', '--bg-elevated'):
                fh = get(mode, fg)[0]
                bh = get(mode, bg)[0]
                r = contrast(fh, bh)
                rows.append((mode, fg, fh, bg, bh, r))
    return rows


def verdict(r, fg):
    if r >= 7:
        return 'AAA'
    if r >= 4.5:
        return 'AA'
    if r >= 3:
        return 'Fails AA body text (passes 3:1 large text / UI)'
    return 'Fails'


def css():
    def block(mode):
        out = []
        for name, lh, la, dh, da, role, _ in TOKENS:
            h, a = (lh, la) if mode == 'light' else (dh, da)
            comment = f'{h} @ {round(a * 100, 1):g}%' if a < 1 else role
            if a < 1:
                comment += f' — {role}'
            out.append(f'  {name}: {hex8(h, a)}; /* {comment} */')
        return '\n'.join(out)
    return f"""/* Cue — color tokens v1.0
 * Monochrome graphite. No hue in the product UI.
 * Translucent values are 8-digit hex (#RRGGBBAA); comments give base hex @ opacity.
 * The alpha byte rounds to the nearest 1/255, e.g. #000000 @ 4.5% -> #0000000B (4.3%).
 */

:root,
:root[data-theme="light"] {{
  color-scheme: light;
{block('light')}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
{chr(10).join('  ' + l for l in block('dark').split(chr(10)))}
  }}
}}

:root[data-theme="dark"] {{
  color-scheme: dark;
{block('dark')}
}}
"""


def json_tokens():
    data = {'$description': 'Cue color tokens v1.0 — hex throughout; opacity is 0–1 applied to hex.',
            'light': {}, 'dark': {}}
    for name, lh, la, dh, da, role, note in TOKENS:
        for mode, h, a in (('light', lh, la), ('dark', dh, da)):
            e = {'hex': h, 'opacity': a, 'hex8': hex8(h, a), 'role': role}
            data[mode][name.lstrip('-')] = e
    data['brand'] = {
        'paper': {'hex': '#FAFAFB', 'role': 'Icon paper (top), light marketing ground'},
        'paper-2': {'hex': '#ECECEF', 'role': 'Icon paper (bottom)'},
        'ink': {'hex': '#2C2C31', 'role': 'Brand ink on light'},
        'ink-dark': {'hex': '#E6E6EA', 'role': 'Brand ink on dark'},
        'graphite': {'hex': '#1C1C1E', 'role': 'Logo single-color on light'},
        'graphite-light': {'hex': '#ECECEF', 'role': 'Logo single-color on dark'},
        'night': {'hex': '#18181A', 'role': 'Dark marketing ground'},
        'night-top': {'hex': '#232327', 'role': 'Dark icon body (top)'},
        'night-bottom': {'hex': '#141416', 'role': 'Dark icon body (bottom)'},
    }
    return json.dumps(data, indent=2) + '\n'


def contrast_md():
    lines = ['# Cue — contrast table', '',
             'WCAG 2.x contrast of text tokens against backgrounds. AA body text and links need 4.5:1.', '',
             '| Mode | Foreground | Background | Ratio | Result |', '| --- | --- | --- | --- | --- |']
    for mode, fg, fh, bg, bh, r in contrast_rows():
        flag = '' if r >= 4.5 else ' ⚠'
        lines.append(f'| {mode} | `{fg}` {fh} | `{bg}` {bh} | {r:.2f}:1 | {verdict(r, fg)}{flag} |')
    lines += ['', '## Flags', '',
              '- **`--text-3` falls short of AA in both modes** (3.26:1 light; 3.93:1 / 3.48:1 dark). '
              'It is raised from the old values (2.42 / 2.93 / 2.59) to a 3:1 floor and must stay off body copy and links. '
              'Use it only for placeholders, disabled items and de-emphasized metadata; see the app notes for done items.',
              '- **`--line-strong` (checkbox borders) is below the 3:1 non-text guideline (WCAG 1.4.11).** '
              f'At 24% it composites to {composite("#000000", 0.24, "#FFFFFF")} on white '
              f'({contrast(composite("#000000", 0.24, "#FFFFFF"), "#FFFFFF"):.2f}:1); dark 26% composites to '
              f'{composite("#FFFFFF", 0.26, "#18181A")} ({contrast(composite("#FFFFFF", 0.26, "#18181A"), "#18181A"):.2f}:1). '
              'Strict compliance needs #000000 @ 42% / #FFFFFF @ 33%, which reads heavy on a calm page — your call.',
              '- `--text`, `--text-2` and `--accent` pass AA everywhere; `--text` and `--accent` pass AAA.', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    for r in contrast_rows():
        print(r[0], r[1], r[3], round(r[5], 2))
