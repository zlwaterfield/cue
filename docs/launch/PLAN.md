# Cue launch plan

Written Sun Oct 25, 2026, against `1.0.0-beta.1` (released Oct 25), 6 stars, 0 downloads so far.

The rest of the kit is beside this file: [COPY.md](COPY.md) has the drafts for every
channel, [REPLIES.md](REPLIES.md) the answers to the questions launch threads ask, and
[ASSETS.md](ASSETS.md) what's already made and what's still missing.

## The short version

**Launch twice, for two different audiences.**

1. **The builders' launch. Tue Nov 10, 2026.** Show HN, r/macapps, X/Bluesky/LinkedIn,
   and the MCP directories. This audience is on Apple-silicon Macs, fine with TestFlight and
   "beta", and it cares about everything Cue is proud of: MIT, local-first, no telemetry,
   measured performance, MCP. They also give the sharpest feedback before 1.0.
2. **The everyone launch. Tue Jan 12, 2027.** The iPhone app on the App Store, 1.0 with
   auto-updates, Product Hunt, Mac press and YouTube. A general audience wants an App Store
   link and a "1.0", and January is when people go looking for a new system. "A page a day"
   is a new-year pitch.

**The goal is not revenue.** Cue is free and isn't a business, so success means people who
are still typing into it a month later, a backlog of real feedback before 1.0, and a body of
work under your name. That makes HN and r/macapps more important than a Product Hunt badge.

**Before strangers download it, fix three things:** updates, the download link, and sync
capacity. Details below.

### Why not one big day?

You could wait for App Store approval and do HN and Product Hunt in the same week. That's
simpler, but you'd lose the November feedback loop, and you'd ship 1.0 without it. Two
launches also give the second one something to say: what changed because of the first.

---

## Before launch

### Blockers (the week of Oct 26)

1. **There is no way to update.** The app has no update check (there's no `autoUpdater`,
   `electron-updater` or "new version" anywhere in `apps/desktop/src`). Without one, every
   launch-day download stays on beta.1, and beta.2's fixes reach nobody. The release already
   publishes `latest-mac.yml`, the `.zip` and the `.blockmap`, so `electron-updater` is mostly
   a matter of wiring it up, and the README already lists it for stable 1.0. At the very least,
   check GitHub's latest release at launch and show "Cue 1.0.0-beta.2 is out" with a link.
2. **The Download button goes to a GitHub release page with four files** (`.zip`,
   `.blockmap`, `.dmg`, `latest-mac.yml`). A non-developer won't know which one to click. Make
   `usecue.today/download/mac` redirect straight to the DMG: either give the DMG a name without
   the version and use `releases/latest/download/Cue-arm64.dmg`, or add a Vercel redirect that
   you update with each release. GitHub's `download_count` becomes your download number, and it
   starts from a clean 0.
3. **Sync capacity for a spike.** Check your Supabase plan's current limits on:
   - **Realtime concurrent connections.** Every signed-in device holds one, and the free
     plan's limit is low.
   - **Auth email.** Supabase's built-in sender only allows a few emails an hour. If production
     isn't on custom SMTP (I couldn't tell from the repo), email sign-in breaks on launch day.
   - **Edge Function invocations**, for MCP.

   Paying for Pro for the launch month is cheap insurance. Also have someone outside your Apple
   team test Sign in with Apple.
4. **TestFlight.**
   - Confirm the public link's build has passed Beta App Review for external testers.
   - Upload a fresh build just before Nov 10. Builds expire after 90 days, so a fresh one won't
     die in the middle of the January push.
   - The public link allows up to 10,000 testers.

### Should do (the week of Nov 2)

5. **Decide how you'll answer "is sync end-to-end encrypted?"** It isn't, and HN will ask
   within the first hour. See REPLIES.md.
6. **Give it to 15–30 people a week early.** Pick friends and people who'll actually use it
   daily. Fix what they hit, and ask 3–5 of them for a one-line quote you can use in January.
7. **Ship beta.2 about five days before launch** with what they found, so the version strangers
   download is the one that's been shaken out.
8. **Re-film the launch video on a Mac.** `brand/video/README.md` notes that the current take
   was filmed off a Mac, with Inter and Geist Mono standing in for SF.
9. **Make an MCP clip.** It's the single most shareable thing you can make. See ASSETS.md.
10. **README.** Put a short moving clip near the top and make "Download for Mac" the first
    link. Then the README, which HN will land on, sells the app in the first screen.
11. **GitHub repo hygiene:**
    - Turn on Discussions, so questions and bugs don't share a queue.
    - Add bug and feature issue templates.
    - Upload `brand/social/github-social-preview.png` as the repo's social preview.
    - Add topics: `macos`, `ios`, `daily-notes`, `todo`, `local-first`, `mcp`, `electron`,
      `react-native`, `typescript`.
12. **Dry run on Mon Nov 9.** On a clean Mac (or a new user account), go site → download →
    open → type → turn on sync → TestFlight on a phone → connect Claude over MCP. Time it, and
    fix anything confusing.

### Not now

- Paid ads, BetaList, Indie Hackers (no business story to tell), TikTok/Reels cuts.
- Windows and Linux builds. Expect to be asked (see REPLIES.md), but don't let the launch slip
  for them.

---

## Channels

### Tier 1: Nov 10

| Channel | Timing | Why | Notes |
| --- | --- | --- | --- |
| **Show HN** | Tue Nov 10, 8:30 am ET | The best audience fit by far | Link to the GitHub repo, since the README carries the benchmarks. Post the first comment right away. Plan to be at the keyboard all day. |
| **X, Bluesky, Mastodon, Threads** | 8:45 am ET | Your network, and the video travels well | Native video upload. Link the site, not the HN thread (see "Don'ts"). |
| **LinkedIn** | Morning | You lead an engineering team, so your network is real here | A more personal post. Copy is in COPY.md. |
| **r/macapps** | Nov 10, midday | The most relevant subreddit, and free + open source goes down well there | Read its self-promotion rules and use the right flair before posting. Upload the video natively. |

### Tier 1, but submit the week before: MCP directories

Cue's remote MCP server already has OAuth, a consent page, Terms and Privacy, which are the
parts these directories ask for. Some of them review submissions, so start now.

- **Claude connectors directory** (Anthropic). It lists over 950 servers now. Find the current
  submission form in Anthropic's docs.
- **ChatGPT apps directory** (OpenAI Developer Platform). Submissions opened Dec 2025, and they
  want a privacy policy, terms, a support contact, a domain verification token, logos and
  screenshots. Review isn't instant.
- **Official MCP Registry, Smithery, PulseMCP, mcp.so, Glama**, and a PR to
  `punkpeye/awesome-mcp-servers`.

### Tier 2: Nov 11–20

- **r/ClaudeAI and r/mcp**, with the MCP clip. "My to-do app has no AI, but Claude can use it"
  is a good angle for those audiences.
- **r/opensource**. **r/productivity** only if its rules allow it (they're strict).
  **r/apple**'s weekly App Saturday thread.
- **Lobsters**, with the `show` tag, if you have or can get an invite.
- **Lists:**
  - `serhii-londar/open-source-mac-os-apps`, `jaywcjlove/awesome-mac`.
  - AlternativeTo, listed as an alternative to Tweek, NotePlan, Things, Logseq and Apple Notes.
  - A Homebrew cask (`brew install --cask cue`), once the repo clears Homebrew's notability bar
    for self-submitted apps (about 75 stars). The HN crowd will ask for this.
- **A technical follow-up on HN** (a normal submission, not Show HN), about a week later. See
  "Posts" below. This is often what actually reaches the front page.

### Tier 3: January (the everyone launch)

- **Product Hunt.** Schedule it ahead, at 12:01 am PT (3:01 am ET). Copy and gallery plan are in
  COPY.md and ASSETS.md.
- **Press.**
  - **MacStories.** Federico Viticci writes a lot about MCP and keyboard-driven apps; this is
    the single best press fit.
  - **9to5Mac, The Sweet Setup, Lifehacker**, and the "best to-do apps" roundups (Zapier's
    blog, The Verge).
- **YouTube.** Productivity and to-do app reviewers, such as Keep Productive (Francesco
  D'Alessio), and Mac app roundup channels.
- **Newsletters and podcasts.**
  - TLDR, Changelog News, and AI and MCP newsletters for the assistant angle.
  - Hacker Newsletter picks up good HN posts on its own.
  - Mac Power Users and Automators, as podcast pitches.

---

## Posts worth writing

These are content you own, and they can go back to HN on their own merits.

1. **"Why I built Cue"** on zlwaterfield.com. This is the launch post and the canonical "story"
   link. A draft is in COPY.md.
2. **"1.5 ms from keystroke to frame: performance budgets for an Electron editor"**, about Nov 17.
   - Cover how `pnpm bench` drives the packaged app, why one keystroke re-renders exactly one
     line, the 40 ms background writes, loading only the days on screen, and why Electron
     anyway.
   - This is the post most likely to land on HN's front page, because it's about something
     people argue over (Electron) and it brings numbers.
3. **"An MCP server that's just another sync client, and can't delete anything"**, about Dec 1.
   - Cover the hybrid logical clock, RLS doing the authorization, having no SDK, and the
     database refusing deletes even if the assistant asks Supabase directly.
   - Good for HN, r/mcp and the AI newsletters.

---

## Timeline

| When | What |
| --- | --- |
| Week of Oct 26 | Blockers 1–4. Invite the seed testers. Start the MCP directory submissions. |
| Week of Nov 2 | Ship beta.2. Re-film the video on a Mac, make the MCP clip, polish the README. Finalize the copy. |
| Mon Nov 9 | Dry run. Pre-write your answers (REPLIES.md). Get some sleep. |
| **Tue Nov 10** | **Builders' launch** (run of show below). |
| Nov 11–13 | Reddit second wave. Reply to everything. Ship beta.3 within days and say so in the HN thread. |
| ~Nov 17 | Performance post, submitted to HN. |
| Late Nov | Submit to the App Store. Homebrew cask. Avoid launching anything the week of US Thanksgiving (Nov 26). |
| ~Dec 1 | MCP post. |
| December | Fold the feedback into 1.0. Add auto-updates and a stable storage format (the README's own 1.0 bar). Make the Product Hunt gallery. Pitch press for January. |
| **Tue Jan 12, 2027** | **Everyone launch**: 1.0, the App Store, Product Hunt and press. |

## Launch day run of show (Tue Nov 10, Eastern)

| Time | What |
| --- | --- |
| 7:30 | Smoke test the live path: site, download, TestFlight link, sync sign-in, MCP connect. Open the Supabase dashboard. |
| 8:30 | Submit the Show HN, then post the first comment immediately. |
| 8:45 | Post on X, Bluesky, Mastodon and LinkedIn. |
| 9:00–18:00 | Answer every HN comment within 15–30 minutes. Thank people for criticism, concede what's true, and never argue. File each real bug as an issue and reply with the link. |
| ~12:00 | Post on r/macapps. |
| Evening | Write down the numbers and the top five requests. Post "thanks, here's what I'm fixing" as a reply in your own thread. |

**Don'ts.**
- Don't send anyone a direct link to the HN post asking for upvotes. HN detects voting rings
  and will bury it. Saying "it's on HN today" is fine.
- Don't change the title once it's posted.
- Don't argue about Electron. Concede the cost, and point to the numbers.

## Measuring it

Cue has no telemetry, by design, so count what's already countable:

| What | Where |
| --- | --- |
| Mac downloads | `gh api repos/zlwaterfield/cue/releases --jq '.[].assets[] \| {name, download_count}'` (once the direct link exists) |
| iPhone testers | App Store Connect → TestFlight |
| Sync accounts and active devices | Supabase (auth users, and recent `items` writes per user) |
| Assistant connections | Supabase OAuth clients and grants |
| Attention | Stars, issues, discussions, and Vercel's request logs for the site |

Retention is only visible for people with sync on. That's an acceptable trade, and saying so
in public is on-brand.
