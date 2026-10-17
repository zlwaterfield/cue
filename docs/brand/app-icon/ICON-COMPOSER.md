# Cue app icon — Icon Composer source

The layered source lives in `icon-composer/Assets/`. Every layer is an SVG on the 1024 × 1024 canvas, filled with #2C2C31 at 100%. Opacity is set per layer in Icon Composer, not baked into the SVG, so the system can derive the dark, tinted and clear appearances.

## Build the .icon

1. Create a new Icon Composer document. Set the platforms to macOS and iOS ("shared" squares).
2. Background fill: **Linear gradient, top #FAFAFB → bottom #ECECEF**.
   - Dark appearance override: **#232327 → #141416**.
3. Add one group per layer, ordered back to front:

| Order | Layer | Fill (light) | Opacity (light) | Fill (dark) | Opacity (dark) | Glass |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `01-rules.svg` | #2C2C31 | 10% | #E6E6EA | 12% | Off |
| 2 | `02-written-line.svg` | #2C2C31 | 28% | #E6E6EA | 30% | Off |
| 3 | `03-current-line.svg` | #2C2C31 | 100% | #E6E6EA | 100% | On, low specular |
| 4 | `04-caret.svg` | #2C2C31 | 100% | #E6E6EA | 100% | On, low specular |

4. Shadow: **Neutral**. Translucency: **Off** for the rules and the written line, and the system default for the line and caret.
5. Tinted and clear: let Icon Composer derive them from the layers. Then check the previews against `macos/cue-icon-tinted-*.png` and `macos/cue-icon-clear-*.png`. If the written line disappears in clear mode, raise its clear-appearance opacity to 40%.
6. Small sizes: at 16 and 32 pt, swap in `small-current-and-caret.svg` (line and caret only, larger). The `.iconset` already does this for the legacy ICNS.

The `.icon` bundle format isn't publicly documented, so this kit ships the layers and settings rather than a hand-assembled bundle.

## Appearance previews (flat renders, hex)

| Appearance | Body top → bottom | Body opacity | Ink | Written line | Rules | Edge |
| --- | --- | --- | --- | --- | --- | --- |
| Light | #FAFAFB → #ECECEF | 100% | #2C2C31 | #2C2C31 @ 28% | #2C2C31 @ 10% | #000000 @ 8% |
| Dark | #232327 → #141416 | 100% | #E6E6EA | #E6E6EA @ 30% | #E6E6EA @ 12% | #FFFFFF @ 12% |
| Tinted light | #F2F2F3 → #E2E2E5 | 100% | #3A3A3F | #3A3A3F @ 30% | #3A3A3F @ 12% | #000000 @ 8% |
| Tinted dark | #1A1A1C → #0E0E10 | 100% | #FFFFFF | #FFFFFF @ 32% | #FFFFFF @ 14% | #FFFFFF @ 10% |
| Clear light | #FFFFFF | 42% | #1C1C1E | #1C1C1E @ 30% | #1C1C1E @ 12% | #FFFFFF @ 55% |
| Clear dark | #000000 | 38% | #FFFFFF | #FFFFFF @ 34% | #FFFFFF @ 14% | #FFFFFF @ 22% |

Legacy PNG/ICNS drop shadow: #000000 @ 30%, y-offset 12 px, blur 14 px (at 1024).

## Geometry (1024 canvas)

- Body: 824 × 824 at (100, 100), corner radius 185 (macOS template). On macOS 26, Icon Composer applies the continuous-corner mask itself.
- Written line: x 236, y 300, 424 × 52, r 26
- Current line: x 236, y 432, 256 × 52, r 26
- Caret: x 528, y 376, 32 × 164, r 16
- Rules: x 236, y 636 and y 736, 552 × 8, r 4
- Small master: the 24-unit symbol scaled ×25 from (212, 212)

## iOS

iOS takes a full-bleed 1024 square, and the system applies the mask. The same composition scales by 1024/824 (×1.2427) around the centre, so the margins match what the macOS body shows: `ios/cue-ios-*.svg` / `.png`. When the iPhone app ships, use the same `.icon` document. Icon Composer generates the iOS light, dark, tinted and clear variants from the same layers. Don't add a second, different composition for iOS.

## Rebuilding the ICNS on a Mac

`iconutil -c icns macos/Cue.iconset -o Cue.icns`. The `.iconset` is the canonical source. The `Cue.icns` in this kit was built on Linux and lacks the 16@1x and 32@1x slots.
