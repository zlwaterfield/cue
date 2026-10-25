# Assets

## What you already have

The brand kit is unusually complete for a launch. Most of what you need exists.

| Asset | Where | Use it for |
| --- | --- | --- |
| Launch video, 1920×1080, about 45 s, silent, captioned | `brand/video/launch.mp4` and `launch-poster.png` | X, LinkedIn, r/macapps, the site, Product Hunt (via YouTube) |
| og:image and og:video | `site/images/og.png`, `og.mp4` | Link previews, already wired up |
| GitHub social preview | `brand/social/github-social-preview.png` | Repo settings → Social preview. Check it's uploaded. |
| README screenshots | `docs/images/*.png` (week light and dark, ⌘K, ⌘F, move-to-date, shortcuts) | Reddit galleries, press, Product Hunt gallery source |
| iPhone App Store screenshots, both required sizes | `brand/app-store/store*/` | The App Store, and Product Hunt gallery source |
| App Store creative (16:9, 21:9, 3:2) | `brand/app-store/creative/` | The App Store, and could become a Product Hunt image |
| Hero renders | `brand/hero/hero-{light,dark}.png` | Press |
| Icon in every appearance, logo, symbol | `brand/app-icon/`, `brand/logo/` | Product Hunt thumbnail, press kit, directory listings |
| One-page usage guide (PDF) | `brand/guide/` | Press kit, and for seed testers |

## What's missing

In priority order.

1. **An MCP demo clip** (before Nov 10). About 15–20 s, 16:9, silent, captioned like the
   launch video.
   - Show a Claude chat on the left and Cue's Mac window on the right. You type "add 'call the
     dentist' to tomorrow and check off the invoice", and a second later both changes appear
     in the window.
   - This is the most shareable thing Cue has, because nothing else in the category does it.
     Use it on X, r/ClaudeAI, r/mcp, the directory listings and the `/assistants` page.
2. **The launch video, re-filmed on a Mac** (before Nov 10). It's the same storyboard, but in SF
   Pro. `pnpm build && pnpm video` on a Mac with ffmpeg.
3. **2–3 short loops for the README and Reddit** (before Nov 10). 5–8 s each, MP4 (GitHub
   plays it inline) and GIF:
   - ⌘D sending a to-do to tomorrow
   - ⌘K understanding "move to fri"
   - Swipe to tomorrow on the iPhone

   They can be cut from the launch-video footage.
4. **A direct DMG link** (`usecue.today/download/mac`). It isn't an image, but it's the asset
   every post links to. See PLAN.md, blocker 2.
5. **A press kit page** (`usecue.today/press`, before you pitch in December). One page with:
   - a paragraph about Cue
   - your bio and a high-resolution headshot (`site/images/zach.webp` is tiny)
   - the logo and icon zip, the screenshots and the video
   - the "use of the brand" rule from `brand/README.md`

   It's mostly links into `brand/`.
6. **Product Hunt gallery** (December). 1270×760, 4–7 images. The first one shows in the feed,
   so make it the hero.
   1. "Every day is a page." The week view, light.
   2. "Not today? ⌘D." Moving to tomorrow, with the iPhone swipe beside it.
   3. "⌘K does everything." The palette resolving "move to fri".
   4. "Your assistant can use it too." A still from the MCP clip.
   5. "Fast, and measured." The benchmark table, set in type.
   6. "Just as calm after dark." Dark mode, on the Mac and the iPhone.
   7. "What it doesn't do." The list: no projects, tags, priorities, reminders or AI.

   `brand/app-store/creative/make.py` already renders with Chrome and Pillow, so a
   `brand/product-hunt/make.py` beside it could use the same palette and type.
7. **Product Hunt thumbnail**, 240×240. It can be a GIF: the symbol with its caret blinking,
   in the brand's 1.1 s hard on/off. "The caret is the brand", in motion, at the one size where
   motion is allowed.
8. **The launch video on YouTube**, unlisted is fine. Product Hunt takes a YouTube link, not a
   file.
9. **An iPhone App Preview** (for the App Store in January). 886×1920, portrait, from the
   iPhone app. `brand/app-store/README.md` notes there are none yet.
10. **13" iPad screenshots.** App Store Connect will ask for them because `supportsTablet` is
    on. Either make them, or turn tablet support off before you submit.

## Specs

| Where | Size and format | Notes |
| --- | --- | --- |
| HN | none | Text only. The README is the asset. |
| X | Video up to 1920×1080, under 2:20 | Upload natively; captions are already burned in |
| Bluesky | Video up to 3 min, 100 MB | |
| LinkedIn | Video 16:9, or 1:1 for more feed space | |
| Reddit | Native video or an image gallery | Native uploads do much better than links |
| Product Hunt | Thumbnail 240×240 (GIF OK); gallery 1270×760; video as a YouTube link | |
| App Store | See `brand/app-store/README.md` | |
| ChatGPT apps directory | Light and dark logos, screenshots | Check OpenAI's current requirements |
