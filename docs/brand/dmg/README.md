# DMG background

- `dmg-background.png` 540 × 380 and `dmg-background@2x.png` 1080 × 760.
- Combine for Finder: `tiffutil -cathidpicheck dmg-background.png dmg-background@2x.png -out dmg-background.tiff`
- Window 540 × 380, icon size 128. Icon centers: **Cue.app at (150, 170)**, **Applications at (390, 170)**.
- create-dmg: `--window-size 540 380 --icon-size 128 --icon "Cue.app" 150 170 --app-drop-link 390 170 --background dmg-background.tiff`
- Colors: ground #FAFAFB; arrow #2C2C31 @ 28%; rule #2C2C31 @ 6%; label #6C6C72 (Geist Regular 13 px, outlined).
