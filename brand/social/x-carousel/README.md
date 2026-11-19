# Images for X

Four images for a post on X saying Cue is out of beta and on the App Store, in the order
to attach them. Each one is 1440 × 1800 (4:5) and a PNG.

| # | Image | Headline | Screen |
| --- | --- | --- | --- |
| 1 | [01-out-of-beta](01-out-of-beta.png) | Out of beta. On the App Store. | The Mac's week, with the iPhone's day in front |
| 2 | [02-mac-move](02-mac-move.png) | Move anything to any day. | Move to on the Mac, ⇧⌘M, reading "fri" |
| 3 | [03-iphone-swipe](03-iphone-swipe.png) | Not today? Swipe it to tomorrow. | A to-do swiped on the iPhone |
| 4 | [04-dark](04-dark.png) | Just as calm after dark. | The Mac and the iPhone in dark |

## Why 4:5

X shows a post's images as a carousel you swipe through. It shows an image whole only
inside a range of shapes and crops anything outside it from the centre: width over height
from about 0.75 to 1.33 on the web, and about 0.75 to 1.18 in the iPhone app. The App
Store screenshots are about 0.46, so X cuts off their top and bottom. 4:5 is 0.8, inside
both ranges, and it is the tallest common shape that is. A post takes up to four images.

X hasn't published these numbers. They come from people measuring the carousel after it
changed in mid 2026, and they may move. Check a draft on the web and on a phone before
posting.

## Rebuilding

    pnpm x-carousel

`apps/desktop/scripts/x-carousel.mjs` lays each image out in HTML at 720 × 900 CSS pixels
and takes it in Chrome at 2x. The Mac windows are the README screenshots in `docs/images`,
and the iPhones are the plain App Store screens in `brand/app-store/screens`, in the same
frame `brand/app-store/creative/make.py` draws. The headlines are set in Newsreader on
the brand's graphite palette. Pass part of a file name to render only that image, such as
`pnpm x-carousel carousel/03`. The same script writes the design polish post's images,
in [`../x-polish`](../x-polish).
