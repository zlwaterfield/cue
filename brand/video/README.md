# Launch video

A short film of the real Mac app, for the launch post, the site and the app
listings.

| File | What it is |
| --- | --- |
| `launch.mp4` | 1920 × 1080, H.264, 30 fps, no audio |
| `launch-poster.png` | 1920 × 1080 still, for the `poster` attribute or a thumbnail |

It runs about three quarters of a minute: the brand line, then one day being
typed, checked off and moved to tomorrow, then ⌘K, ⌘F, dark, the shortcuts
sheet, the iPhone, and where to get it.

## Rebuilding it

```sh
pnpm build && pnpm video
```

`apps/desktop/scripts/launch-video.mjs` films the built app playing
[`storyboard.mjs`](../../apps/desktop/scripts/launch-video/storyboard.mjs) at 30 fps, then
draws the captions, the window and the cards around that footage one frame at a
time in [`stage.html`](../../apps/desktop/scripts/launch-video/stage.html) and encodes the
result. Needs `ffmpeg` on PATH and an X display; on Linux and CI it starts its
own Xvfb. Working frames land in `.video/`, which is not committed.

The words are all in `storyboard.mjs`, with the beats they belong to. Rewriting
a caption only needs the compose pass, but `pnpm video` does both and the whole
thing takes a few minutes.

## Rules it follows

- **Nothing is mocked.** Every keystroke in the footage was typed into the real
  app, and the days are written during the take. Only the iPhone is a still, cut
  from the App Store screenshots.
- **It plays silent.** There is no music and no voice, because it autoplays
  muted everywhere it will be seen. The captions carry it, at seven words or
  fewer, in Newsreader like the rest of the brand's display type.
- **The window is the README's window.** Same radius, shadow, hairline and
  traffic lights as `apps/desktop/scripts/frame.swift` puts on the screenshots in
  `docs/images`.
- **Monochrome, and it ends on Night.** The film turns dark where the app does
  and stays there, so the closing card is the lockup on `#18181A`.

## Using it

Off a Mac the app has no SF Pro and no SF Mono, so the capture stands Inter and
Geist Mono in their place, as `brand/README.md` ▸ Typography allows for
non-Apple renders. A take filmed on a Mac uses the real thing and is the one to
prefer for anything the App Store sees.

App Store app previews are a different shape again (886 × 1920 at 6.3", portrait
and from the iPhone app) and there are none yet; see `brand/app-store/README.md`.
