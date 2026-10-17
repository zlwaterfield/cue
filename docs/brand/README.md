# Cue — brand kit v1.0 ("The Next Line")

Cue is a page you type into, so the brand is a page you type into: one written line, then the caret waiting on the next. It's monochrome graphite with no hue, and typography does the rest.

## In this repo

- The app's colors are these tokens, in `src/renderer/src/styles/app.css`.
- The app icon is `build/icon.icns`, built from `app-icon/macos/Cue.iconset` with
  `iconutil -c icns app-icon/macos/Cue.iconset -o build/icon.icns`. The kit's Linux-built
  `Cue.icns` is not included.
- The DMG background is `build/dmg-background.tiff`
  (`tiffutil -cathidpicheck dmg/dmg-background.png dmg/dmg-background@2x.png -out build/dmg-background.tiff`).
- The caret, the "Start typing…" empty state and the About window follow `APP-FEEDBACK.md`.
  Done items keep `--text-3` with a strikethrough, as a known WCAG AA exception (§2).

## Contents

| Folder | What's inside |
| --- | --- |
| `logo/` | Lockup (`cue` + caret) and symbol (line + caret) as SVG, single-color #1C1C1E on light and #ECECEF on dark, plus a brand-ink version (#2C2C31). PNGs at 1/2/4× and the symbol at 16–512 px. All text is outlined. |
| `app-icon/` | macOS 1024 icons on Apple's grid (824 body) in light, dark, tinted-light, tinted-dark, clear-light and clear-dark, as SVG and PNG. Also `Cue.iconset`, `Cue.icns`, the Icon Composer layers and settings (`ICON-COMPOSER.md`), iOS full-bleed variants, and `preview-appearances.png`. |
| `tokens/` | `tokens.css` (CSS custom properties, 8-digit hex for translucency), `tokens.json` (hex + opacity), and `contrast.md`. |
| `readme/` | GitHub README header in light and dark (SVG plus 2× PNG), with a `<picture>` snippet. |
| `social/` | GitHub social preview, 1280 × 640 (SVG, PNG, @2x). |
| `dmg/` | DMG background, 540 × 380 and @2x, with icon positions and a create-dmg line. |
| `web/` | `favicon.svg` (adapts to dark mode), `favicon.ico` (16/32/48), `apple-touch-icon.png`, icon-192/512, a maskable 512, `site.webmanifest`, and a `<head>` snippet. |
| `hero/` | A self-contained landing-page hero (`index.html`, light and dark via tokens) and PNG renders. |
| `guide/` | The one-page usage guide (PDF, PNG and HTML). |
| `APP-FEEDBACK.md` | Changes to fold back into the app. |
| `source/` | The Python scripts that generated everything. Re-run them to regenerate the kit. |

## Typography

- **App:** SF Pro (system font) only. SF Mono for shortcuts.
- **Wordmark and website display:** Newsreader (Production Type, SIL OFL; free on Google Fonts), weight 400–500 at optical size 72, tracking −2%. The wordmark is Newsreader Medium, outlined, followed by the caret.
- **Website body:** the system stack (`-apple-system, BlinkMacSystemFont, system-ui`).
- **Non-Apple raster assets** (social preview, DMG label): Geist and Geist Mono (OFL), outlined, stand in for SF, whose license limits use outside Apple-platform UI.

## Mark rules (short version — see `guide/`)

- The caret is part of the lockup. Keep it, and never animate it in static use.
- Use a single color: #1C1C1E on light and #ECECEF on dark, or brand ink #2C2C31 / #E6E6EA.
- Clear space is the wordmark's x-height. The lockup's minimum height is 18 px. Below that, use the symbol, which works down to 16 px.
- No hue, gradients, gloss or shadows on the mark.

## Palette

Brand: Graphite #1C1C1E · Graphite light #ECECEF · Ink #2C2C31 · Ink light #E6E6EA · Paper #FAFAFB · Paper 2 #ECECEF · Night #18181A · Night top #232327 · Night bottom #141416.
Product tokens: `tokens/`. There is no signature hue, and none is proposed. The brand doesn't need one.
