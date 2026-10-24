# App Store screenshots

The iPhone app's App Store images, in upload order.

![The eight App Store images](overview.png)

| # | Image | Headline | Screen |
| --- | --- | --- | --- |
| 1 | [01-today](store/01-today.png) | Every day is a page. | Today, with to-dos, nested bullets and a list |
| 2 | [02-swipe](store/02-swipe.png) | Not today? Swipe it to tomorrow. | A to-do swiped left, past where tomorrow arms |
| 3 | [03-move](store/03-move.png) | Move anything to any day. | The Move to… sheet |
| 4 | [04-earlier](store/04-earlier.png) | Today starts with what you didn't finish. | The earlier to-dos, unfolded |
| 5 | [05-links](store/05-links.png) | Share a link. It lands in today. | Link previews, the newest one just shared |
| 6 | [06-search](store/06-search.png) | Find anything you've written. | Search for "priya" |
| 7 | [07-dark](store/07-dark.png) | Just as calm after dark. | Friday, in dark |
| 8 | [08-mac](store/08-mac.png) | Your iPhone and Mac, always in sync. | The same day on the phone and in the Mac's README screenshot |

- `store/` holds the images to upload, and `screens/` the plain screenshots inside them.
- All are 1320 × 2868 PNGs without alpha, the 6.9" iPhone size. App Store Connect scales
  them for smaller iPhones.
- The app's `supportsTablet` is on, so App Store Connect also asks for 13" iPad screenshots.
  There are none yet.

## How they were made

The screens are the iPhone app's own React Native screens, run through Expo's web target
in Chrome at the iPhone 17 Pro Max's size (440 × 956 pt at 3×). They use SF Pro with iOS's
tracking, SF Symbols drawn from SF Pro's outlines, and the iPhone's safe area. An
example account was written into the app's database, and link previews came from the
app's own parser. The iOS status bar, the sheet chrome and the held swipe were added
around them.

The headlines are set in Newsreader, the brand's display face, on the brand's graphite
palette. The example sites, their icons and the post on X are made up.
