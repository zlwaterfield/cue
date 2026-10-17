# Fold back into the app

Changes the brand work suggests for the Cue codebase, in priority order.

## 1. Swap in the new tokens (`tokens/tokens.css` / `tokens.json`)
Five values changed. Every other value is unchanged.

| Token | Light | Dark | Why |
| --- | --- | --- | --- |
| `--text-3` | #A6A6AC → **#8E8E94** | #626268 → **#76767D** | Was 2.4–2.9:1. Now at least 3:1 in both modes. |
| `--line-strong` | #000000 @ 17% → **@ 24%** | #FFFFFF @ 20% → **@ 26%** | Empty checkboxes were faint. Still under 3:1 (see §3). |
| `--bg-subtle` | — | #242427 → **#2C2C30** | Keycaps in the ⌘K palette were invisible on `--bg-elevated` (1.01:1). |
| `--toast-bg` | — | #2C2C31 → **#333338** | The toast barely separated from sheets in dark mode. |

## 2. Done items: decide on `--text-3`
Done items use `--text-3`, which doesn't meet AA (3.26:1 light, 3.48:1 on dark sheets). Options:
- **Keep `--text-3` and the strikethrough** (recommended for the calm look). Completed items are deliberately receded, and the new value is much more legible than before. Flag this as a known AA exception.
- **Strict AA:** render done items in `--text-2` with strikethrough, and keep `--text-3` for placeholders and disabled items only.

## 3. Checkbox border (WCAG 1.4.11)
Unchecked boxes are identified only by their outline. Strict non-text contrast needs `--line-strong` at #000000 @ 42% / #FFFFFF @ 33%. That reads heavy, so it's a judgment call. Even if you keep 24% / 26%, make the focus ring (`--accent-soft`) obvious on keyboard focus.

## 4. The caret is the brand now
- Caret: 2 px wide, `--accent`, rounded ends, height ≈ line height − 4 px, which matches the symbol's proportions.
- Blink: a calm 1.1 s cycle with a hard on/off. Never fade. Respect *Reduce Motion* by not blinking.
- Make sure the caret is visible the moment the window appears, so launch-to-typing feels instant.

## 5. Empty state
An empty day can show a single placeholder line in `--text-3` ("Start typing…") with the caret already in front of it. That's the icon, live.

## 6. App icon
Replace the placeholder with the new `.icon` (see `app-icon/ICON-COMPOSER.md`) and `Cue.iconset`. Remove the old gradient icon assets (#3D3D45 → #1C1C21).

## 7. About window / onboarding
Use `logo/cue-lockup-on-light.svg` / `-on-dark.svg` (the outlined Newsreader wordmark). Don't load Newsreader as a font in the app. SF Pro stays the only UI font.
