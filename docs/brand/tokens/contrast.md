# Cue — contrast table

WCAG 2.x contrast of text tokens against backgrounds. AA body text and links need 4.5:1.

| Mode | Foreground | Background | Ratio | Result |
| --- | --- | --- | --- | --- |
| light | `--text` #1C1C1E | `--bg` #FFFFFF | 17.01:1 | AAA |
| light | `--text` #1C1C1E | `--bg-elevated` #FFFFFF | 17.01:1 | AAA |
| light | `--text-2` #6C6C72 | `--bg` #FFFFFF | 5.22:1 | AA |
| light | `--text-2` #6C6C72 | `--bg-elevated` #FFFFFF | 5.22:1 | AA |
| light | `--text-3` #8E8E94 | `--bg` #FFFFFF | 3.26:1 | Fails AA body text (passes 3:1 large text / UI) ⚠ |
| light | `--text-3` #8E8E94 | `--bg-elevated` #FFFFFF | 3.26:1 | Fails AA body text (passes 3:1 large text / UI) ⚠ |
| light | `--accent` #2C2C31 | `--bg` #FFFFFF | 13.89:1 | AAA |
| light | `--accent` #2C2C31 | `--bg-elevated` #FFFFFF | 13.89:1 | AAA |
| dark | `--text` #ECECEF | `--bg` #18181A | 15.04:1 | AAA |
| dark | `--text` #ECECEF | `--bg-elevated` #232326 | 13.29:1 | AAA |
| dark | `--text-2` #9D9DA4 | `--bg` #18181A | 6.58:1 | AA |
| dark | `--text-2` #9D9DA4 | `--bg-elevated` #232326 | 5.82:1 | AA |
| dark | `--text-3` #76767D | `--bg` #18181A | 3.93:1 | Fails AA body text (passes 3:1 large text / UI) ⚠ |
| dark | `--text-3` #76767D | `--bg-elevated` #232326 | 3.48:1 | Fails AA body text (passes 3:1 large text / UI) ⚠ |
| dark | `--accent` #E6E6EA | `--bg` #18181A | 14.24:1 | AAA |
| dark | `--accent` #E6E6EA | `--bg-elevated` #232326 | 12.59:1 | AAA |

## Flags

- **`--text-3` falls short of AA in both modes** (3.26:1 light; 3.93:1 / 3.48:1 dark). It is raised from the old values (2.42 / 2.93 / 2.59) to a 3:1 floor and must stay off body copy and links. Use it only for placeholders, disabled items and de-emphasized metadata; see the app notes for done items.
- **`--line-strong` (checkbox borders) is below the 3:1 non-text guideline (WCAG 1.4.11).** At 24% it composites to #C2C2C2 on white (1.78:1); dark 26% composites to #545456 (2.35:1). Strict compliance needs #000000 @ 42% / #FFFFFF @ 33%, which reads heavy on a calm page — your call.
- `--text`, `--text-2` and `--accent` pass AA everywhere; `--text` and `--accent` pass AAA.
