"""Landing hero + one-page usage guide (HTML), rendered to PNG/PDF with Chromium."""
import os
import brand as B
import tokens as T

OUT = '/root/cue-brand/kit'
LOCKUP = open('/root/cue-brand/kit/source/lockup-current.svg').read().replace('<svg ', '<svg class="lockup" ', 1)
SYMBOL = B.symbol_svg('currentColor', 24).replace('<svg ', '<svg class="sym" ', 1)
TOKENS_CSS = T.css()
FONT_LINK = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
             '<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">')

CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

HERO = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cue — every day is a page</title>
{FONT_LINK}
<style>
{TOKENS_CSS}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }}
a {{ color: inherit; text-decoration: none; }}
.wrap {{ max-width: 1120px; margin: 0 auto; padding: 0 24px; }}
nav {{ display: flex; align-items: center; justify-content: space-between; height: 76px; }}
nav .lockup {{ height: 30px; width: auto; color: var(--text); }}
nav .links {{ display: flex; gap: 28px; font-size: 15px; color: var(--text-2); }}
nav .links a:hover {{ color: var(--text); }}
header.hero {{ text-align: center; padding: 72px 0 56px; }}
h1 {{ font-family: "Newsreader", "New York", ui-serif, Georgia, serif; font-weight: 400;
  font-size: clamp(48px, 7vw, 84px); line-height: 1.02; letter-spacing: -0.02em; margin: 0 0 22px; }}
.lede {{ max-width: 620px; margin: 0 auto; font-size: 20px; color: var(--text-2); }}
kbd {{ font: 500 0.82em ui-monospace, "SF Mono", monospace; padding: 2px 7px; border-radius: 6px;
  background: var(--bg-subtle); color: var(--text); border: 1px solid var(--line); }}
.ctas {{ display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 34px; }}
.btn {{ display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 20px; border-radius: 12px;
  font-size: 16px; font-weight: 500; }}
.btn.primary {{ background: var(--accent); color: var(--on-accent); }}
.btn.primary:hover {{ opacity: .9; }}
.btn.secondary {{ border: 1px solid var(--line-strong); color: var(--text); }}
.btn.secondary:hover {{ background: var(--bg-hover); }}
.meta {{ margin-top: 18px; font-size: 14px; color: var(--text-2); }}
.window {{ max-width: 880px; margin: 0 auto 96px; border-radius: 14px; background: var(--bg-elevated);
  border: 1px solid var(--line); box-shadow: 0 1px 2px #0000000A, 0 24px 60px -20px #00000033; overflow: hidden; text-align: left; }}
.titlebar {{ height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--line); }}
.titlebar span {{ width: 12px; height: 12px; border-radius: 50%; background: var(--line-strong); }}
.page {{ padding: 36px 56px 48px; }}
.date {{ font-size: 24px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px; }}
.sub {{ font-size: 14px; color: var(--text-2); margin: 0 0 24px; }}
.row {{ display: flex; align-items: flex-start; gap: 12px; padding: 5px 0; font-size: 17px; }}
.row.nested {{ padding-left: 30px; }}
.box {{ flex: none; width: 18px; height: 18px; margin-top: 3px; border-radius: 5px; border: 1.5px solid var(--line-strong);
  display: grid; place-items: center; }}
.box.done {{ background: var(--accent); border-color: var(--accent); color: var(--on-accent); }}
.box svg {{ width: 14px; height: 14px; }}
.done-text {{ color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--text-3); }}
.dot {{ flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--text-2); margin: 11px 6px 0 7px; }}
.note {{ padding: 14px 0 5px; }}
.caret {{ display: inline-block; width: 2px; height: 22px; background: var(--accent); border-radius: 1px; vertical-align: -5px;
  animation: blink 1.1s steps(1) infinite; }}
@keyframes blink {{ 50% {{ opacity: 0; }} }}
@media (prefers-reduced-motion: reduce) {{ .caret {{ animation: none; }} }}
@media (max-width: 640px) {{ .page {{ padding: 24px 20px 32px; }} nav .links {{ gap: 16px; }} }}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a href="/" aria-label="Cue home">{LOCKUP}</a>
    <div class="links"><a href="#">GitHub</a><a href="#">Download</a></div>
  </nav>
  <header class="hero">
    <h1>Every day is a page.</h1>
    <p class="lede">Open Cue and start typing into today. <kbd>Tab</kbd> nests, <kbd>⌘↩</kbd> completes,
      <kbd>⌘D</kbd> pushes to tomorrow, <kbd>⌘K</kbd> does everything else.</p>
    <div class="ctas">
      <a class="btn primary" href="#">Download for macOS</a>
      <a class="btn secondary" href="#">View on GitHub</a>
    </div>
    <p class="meta">Free and open source · Local-first · Launch to typing in ~240 ms</p>
  </header>
  <div class="window" role="img" aria-label="Cue showing today's page with to-dos and notes">
    <div class="titlebar"><span></span><span></span><span></span></div>
    <div class="page">
      <p class="date">Saturday, October 17</p>
      <p class="sub">Today</p>
      <div class="row"><span class="box done">{CHECK}</span><span class="done-text">Draft the release notes</span></div>
      <div class="row"><span class="box"></span><span>Review the sync-conflict PR</span></div>
      <div class="row nested"><span class="dot"></span><span>Check the merge path when both devices edit offline</span></div>
      <div class="row"><span class="box"></span><span>Book the bike service</span></div>
      <div class="row note"><span>Idea: ⌘D should carry nested items along with their parent.</span></div>
      <div class="row"><span class="caret"></span></div>
    </div>
  </div>
</div>
</body>
</html>
'''


def swatch(hexv, name, note='', border=False):
    b = 'border:1px solid #E4E4E7;' if border else ''
    return (f'<div class="sw"><div class="chip" style="background:{hexv};{b}"></div>'
            f'<div><div class="sn">{name}</div><div class="sh">{hexv}{(" · " + note) if note else ""}</div></div></div>')


def mini(svg_inner, bg, extra=''):
    return f'<div class="mini" style="background:{bg};{extra}">{svg_inner}</div>'


lock_dark = LOCKUP
icon_light = B.icon_svg('light')
icon_dark = B.icon_svg('dark')
# a "don't" example: hue applied
lock_hue = LOCKUP

GUIDE = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cue — brand usage guide</title>
{FONT_LINK}
<style>
@page {{ size: 1600px 1132px; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #FFFFFF; color: #1C1C1E; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Geist", system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.sheet {{ width: 1600px; height: 1132px; padding: 56px 64px; display: grid; grid-template-columns: 1.05fr 1fr 1fr; grid-template-rows: auto 1fr; column-gap: 48px; row-gap: 32px; }}
.head {{ grid-column: 1 / -1; display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 1px solid #EBEBEC; padding-bottom: 24px; }}
.head .lockup {{ height: 48px; width: auto; }}
.head .t {{ text-align: right; color: #6C6C72; }}
.head .t b {{ display: block; color: #1C1C1E; font: 400 28px/1.1 "Newsreader", Georgia, serif; letter-spacing: -0.01em; margin-bottom: 4px; }}
h2 {{ font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #6C6C72; font-weight: 600; margin: 0 0 12px; }}
section {{ margin-bottom: 26px; }}
p {{ margin: 0 0 8px; color: #3A3A3F; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }}
.tile {{ height: 120px; border-radius: 12px; display: grid; place-items: center; }}
.tile .lockup {{ height: 44px; width: auto; }}
.cs {{ position: relative; height: 170px; border-radius: 12px; background: #F5F5F6; display: grid; place-items: center; }}
.cs .frame {{ position: relative; padding: 30px; outline: 1.5px dashed #8E8E94; outline-offset: 0; }}
.cs .frame .lockup {{ height: 56px; width: auto; display: block; outline: 1px solid #00000014; }}
.cs .x {{ position: absolute; font: 600 12px/1 ui-monospace, "SF Mono", monospace; color: #6C6C72; }}
.sizes {{ display: flex; align-items: flex-end; gap: 28px; padding: 18px 20px; border-radius: 12px; background: #F5F5F6; }}
.sizes .lab {{ font-size: 12px; color: #6C6C72; margin-top: 6px; }}
.dd {{ display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }}
.mini {{ height: 78px; border-radius: 10px; display: grid; place-items: center; overflow: hidden; }}
.mini .lockup {{ height: 26px; width: auto; }}
.cap {{ font-size: 12px; margin-top: 6px; color: #3A3A3F; }}
.cap.no::before {{ content: "✕ "; color: #1C1C1E; font-weight: 700; }}
.cap.yes::before {{ content: "✓ "; color: #1C1C1E; font-weight: 700; }}
.sw {{ display: flex; gap: 10px; align-items: center; }}
.chip {{ width: 36px; height: 36px; border-radius: 8px; flex: none; }}
.sn {{ font-size: 13px; }}
.sh {{ font: 12px ui-monospace, "SF Mono", "Geist Mono", monospace; color: #6C6C72; }}
.grid2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }}
.type {{ display: grid; gap: 10px; }}
.type .s {{ font: 400 34px/1.05 "Newsreader", Georgia, serif; letter-spacing: -0.02em; }}
.type .k {{ font-size: 12px; color: #6C6C72; }}
ul {{ margin: 0; padding-left: 18px; color: #3A3A3F; }} li {{ margin: 3px 0; }}
.icons {{ display: flex; gap: 14px; align-items: center; }}
.icons svg {{ width: 92px; height: 92px; }}
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div style="color:#1C1C1E">{LOCKUP}</div>
    <div class="t"><b>Brand usage</b>Cue identity v1.0 · October 2026 · graphite, no hue</div>
  </div>

  <div>
    <section>
      <h2>The mark</h2>
      <p>The lockup is the written word and the caret: <i>cue</i> followed by the next line. The caret is part of the mark — never drop it, move it, or animate it in static use.</p>
      <div class="pair">
        <div class="tile" style="background:#FFFFFF;border:1px solid #EBEBEC;color:#1C1C1E">{LOCKUP}</div>
        <div class="tile" style="background:#18181A;color:#ECECEF">{LOCKUP}</div>
      </div>
      <p style="margin-top:8px;font-size:12px;color:#6C6C72">Single color only: #1C1C1E on light, #ECECEF on dark. Brand ink #2C2C31 / #E6E6EA is also allowed.</p>
    </section>
    <section>
      <h2>Clear space</h2>
      <div class="cs"><div class="frame" style="color:#1C1C1E">{LOCKUP}
        <span class="x" style="top:9px;left:50%;transform:translateX(-50%)">x</span>
        <span class="x" style="bottom:9px;left:50%;transform:translateX(-50%)">x</span>
        <span class="x" style="left:10px;top:50%;transform:translateY(-50%)">x</span>
        <span class="x" style="right:10px;top:50%;transform:translateY(-50%)">x</span></div></div>
      <p style="margin-top:8px">Keep clear space of <b>x</b> = the x-height of the wordmark on every side. For the symbol alone, ¼ of its size.</p>
    </section>
    <section>
      <h2>Minimum sizes</h2>
      <div class="sizes">
        <div><div style="color:#1C1C1E">{LOCKUP.replace('class="lockup"', 'class="lockup" style="height:18px;width:auto;display:block"')}</div><div class="lab">Lockup 18 px tall · 7 mm print</div></div>
        <div><div style="color:#1C1C1E">{SYMBOL.replace('width="24" height="24"', 'width="16" height="16"')}</div><div class="lab">Symbol 16 px</div></div>
        <div><div style="color:#1C1C1E">{SYMBOL.replace('width="24" height="24"', 'width="32" height="32"')}</div><div class="lab">32 px</div></div>
      </div>
      <p style="margin-top:8px">Below 18 px tall, use the symbol. The symbol is drawn on a 1.5-unit grid so it lands on whole pixels at 16, 24, 32 and 48 px; scale it in those steps on screen.</p>
    </section>
  </div>

  <div>
    <section>
      <h2>Do / don't</h2>
      <div class="dd">
        <div>{mini(LOCKUP, '#FAFAFB', 'color:#1C1C1E;border:1px solid #EBEBEC')}<div class="cap yes">Paper or white ground</div></div>
        <div>{mini(LOCKUP, '#18181A', 'color:#ECECEF')}<div class="cap yes">Night ground</div></div>
        <div>{mini(SYMBOL.replace('width="24" height="24"', 'width="36" height="36"'), '#F5F5F6', 'color:#1C1C1E')}<div class="cap yes">Symbol where space is tight</div></div>
        <div>{mini(LOCKUP, '#FFFFFF', 'color:#3E66AE;border:1px solid #EBEBEC')}<div class="cap no">Add a hue</div></div>
        <div>{mini(LOCKUP.replace('class="lockup"', 'class="lockup" style="filter:drop-shadow(2px 4px 0 #00000059) drop-shadow(0 0 6px #FFFFFFCC)"'), 'linear-gradient(#FFFFFF,#D4D4D8)', 'color:#5A5A60;border:1px solid #EBEBEC')}<div class="cap no">Shadows, gloss, gradients</div></div>
        <div>{mini('<span style="font:600 30px/1 -apple-system, Geist, sans-serif;letter-spacing:-.02em">cue|</span>', '#FFFFFF', 'color:#1C1C1E;border:1px solid #EBEBEC')}<div class="cap no">Retype it in another font</div></div>
        <div>{mini('<span style="display:flex;align-items:center;gap:18px">' + LOCKUP.replace('class="lockup"', 'class="lockup" style="height:26px;width:auto;transform:scaleX(1.35)"') + '</span>', '#FFFFFF', 'color:#1C1C1E;border:1px solid #EBEBEC')}<div class="cap no">Stretch or condense</div></div>
        <div>{mini(LOCKUP, 'repeating-linear-gradient(45deg,#8E8E94 0 8px,#C9C9CE 8px 16px)', 'color:#1C1C1E')}<div class="cap no">Busy or low-contrast grounds</div></div>
        <div>{mini('<span style="display:flex;align-items:center;gap:8px;color:#1C1C1E">' + SYMBOL + LOCKUP.replace('class="lockup"', 'class="lockup" style="height:22px;width:auto"') + '</span>', '#FFFFFF', 'border:1px solid #EBEBEC')}<div class="cap no">Symbol + lockup together</div></div>
      </div>
    </section>
    <section>
      <h2>App icon</h2>
      <div class="icons">{icon_light.replace('<svg ', '<svg aria-hidden="true" ', 1)}{icon_dark.replace('<svg ', '<svg aria-hidden="true" ', 1)}</div>
      <ul>
        <li>Paper body #FAFAFB → #ECECEF; ink #2C2C31 (written line @ 28%, rules @ 10%).</li>
        <li>Dark body #232327 → #141416; ink #E6E6EA (written @ 30%, rules @ 12%).</li>
        <li>At 16 and 32 px use the simplified icon: current line + caret only.</li>
        <li>Never place the mark or a hue on the icon; never redraw it with a gloss.</li>
      </ul>
    </section>
  </div>

  <div>
    <section>
      <h2>Palette</h2>
      <div class="grid2">
        {swatch('#1C1C1E', 'Graphite', 'logo, text')}
        {swatch('#ECECEF', 'Graphite light', 'logo on dark', True)}
        {swatch('#2C2C31', 'Ink', 'accent, light')}
        {swatch('#E6E6EA', 'Ink light', 'accent, dark', True)}
        {swatch('#FAFAFB', 'Paper', 'marketing ground', True)}
        {swatch('#18181A', 'Night', 'dark ground')}
        {swatch('#6C6C72', 'Text 2', 'light')}
        {swatch('#9D9DA4', 'Text 2', 'dark')}
        {swatch('#8E8E94', 'Text 3', 'light · 3:1')}
        {swatch('#76767D', 'Text 3', 'dark · 3:1')}
      </div>
      <p style="margin-top:10px;font-size:12px;color:#6C6C72">Full light/dark product tokens: tokens/tokens.css and tokens.json. Body text and links use Text or Text 2 only — Text 3 does not meet AA.</p>
    </section>
    <section>
      <h2>Typography</h2>
      <div class="type">
        <div><div class="s">Every day is a page.</div><div class="k">Newsreader 400–500, optical size 72 · wordmark, website headlines, marketing only · tracking −2%</div></div>
        <div><div style="font-size:17px">Open Cue and start typing into today.</div><div class="k">SF Pro (system font) · the app, website body and UI</div></div>
        <div><div style="font:500 14px ui-monospace,'SF Mono','Geist Mono',monospace">⌘↩ ⌘D ⌘K</div><div class="k">SF Mono · shortcuts and code. Geist / Geist Mono stand in on non-Apple raster assets.</div></div>
      </div>
    </section>
    <section>
      <h2>Voice</h2>
      <p>Calm, plain, precise. Short sentences, real numbers, lowercase product name in the mark and "Cue" in running text. No hustle, no exclamation marks, no sparkle.</p>
    </section>
  </div>
</div>
</body>
</html>
'''

os.makedirs(f'{OUT}/hero', exist_ok=True)
os.makedirs(f'{OUT}/guide', exist_ok=True)
open(f'{OUT}/hero/index.html', 'w').write(HERO)
open(f'{OUT}/guide/usage-guide.html', 'w').write(GUIDE)

# ---------- render with Chromium, using local font files (no network in the sandbox)
from playwright.sync_api import sync_playwright
LOCAL = '''@font-face{font-family:"Newsreader";font-weight:400;src:url("file:///root/fonts/Newsreader-Display-Regular.ttf")}
@font-face{font-family:"Newsreader";font-weight:500;src:url("file:///root/fonts/Newsreader-Display-Medium.ttf")}
@font-face{font-family:"Geist";src:url("file:///root/fonts/Geist-Regular.ttf")}
@font-face{font-family:"Geist Mono";src:url("file:///root/fonts/GeistMono-Regular.ttf")}
body{font-family:-apple-system,"Geist",sans-serif}'''
with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ('light', 'dark'):
        pg = br.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=2, color_scheme=scheme)
        pg.goto(f'file://{OUT}/hero/index.html')
        pg.add_style_tag(content=LOCAL + '.caret{animation:none}')
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/hero/hero-{scheme}.png')
        pg.close()
    pg = br.new_page(viewport={'width': 1600, 'height': 1132}, device_scale_factor=2)
    pg.goto(f'file://{OUT}/guide/usage-guide.html')
    pg.add_style_tag(content=LOCAL)
    pg.wait_for_timeout(400)
    pg.screenshot(path=f'{OUT}/guide/usage-guide.png')
    pg.pdf(path=f'{OUT}/guide/usage-guide.pdf', width='1600px', height='1132px', print_background=True)
    br.close()
print('pages ok')
