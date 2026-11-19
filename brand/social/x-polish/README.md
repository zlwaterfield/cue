# Images for X: the design polish

Four images for a post on X about the design pass after 1.0, in the order to attach them.
Each one is 1440 × 1800 (4:5) and a PNG, laid out like the 1.0 set in
[`../x-carousel`](../x-carousel), whose README says why 4:5.

| # | Image | Headline | Screen |
| --- | --- | --- | --- |
| 1 | [01-polish](01-polish.png) | A little polish. | The Mac's week, with the iPhone's day in front |
| 2 | [02-mac-calendar](02-mac-calendar.png) | A calendar with room to breathe. | Move to on the Mac: today ringed, Friday picked |
| 3 | [03-iphone-tabs](03-iphone-tabs.png) | Today and Notes, a thumb away. | Two iPhones, one on each tab |
| 4 | [04-mac-notes](04-mac-notes.png) | Every note gets a tab. | A starred note on the Mac, with the notes strip above it |

## The iPhones are drawn

The Mac windows are the README screenshots in `docs/images`, which are captures. The
iPhone screens in [`screens/`](screens) are not: there was no capture of the app's new
layout when these were made, so `apps/desktop/scripts/phone-shots.py` lays them out from
the app's own styles. The tabs' glass is a plain translucent capsule and the sun symbol is
drawn by hand. Once there are real screenshots, put them in `screens/` under the same
names and rebuild.

## Rebuilding

    python3 apps/desktop/scripts/phone-shots.py --screens brand/social/x-polish/screens
    pnpm x-carousel polish

The first writes the two iPhone screens (and the site's phone images, as it always does);
the second, run in `apps/desktop`, lays out the four images.
