# Launch copy

These drafts are written in the site's voice: short sentences, first person, no hype, and
honest about the costs. `[brackets]` mark facts only you know. Replace them, don't guess them.

---

## 1. Show HN (Tue Nov 10)

**URL:** https://github.com/zlwaterfield/cue

**Title.** Pick one; each is at most 80 characters.

- `Show HN: Cue – Daily notes and to-dos for Mac and iPhone, keyboard-first` (72)
- `Show HN: Cue – An open-source daily notes app where the day is the only folder` (78)
- `Show HN: Cue – Daily notes for Mac and iPhone, with performance budgets` (71)

I'd use the first. It says what the app is, and the comment can carry the interesting parts.

**First comment.** Post this as soon as the submission is up.

> Hi HN, I'm Zach. Cue is a daily notes and to-do app for Mac and iPhone. Every day is a page:
> you open it and type into today. There are no projects, tags or priorities, and whatever you
> didn't get done moves to tomorrow with ⌘D.
>
> I built it because every tool I tried wanted a decision before it would take a note (which
> project? which tag?), and I wanted somewhere to put the day. It's been my daily driver on my
> Mac and iPhone for [N months].
>
> Some things that might interest people here:
>
> - **Performance has budgets.** `pnpm bench` drives the real packaged app: 240 ms from launch
>   to typing with five years of notes, 1.5 ms from keystroke to frame (p95 3.7 ms), and 0.5 ms
>   to search 36k items. A keystroke re-renders exactly one line, writes happen in the
>   background within 40 ms, and only the days on screen are loaded.
> - **Yes, it's Electron.** Chromium's text editing was the most reliable base I found for an
>   editor like this. The costs are a 122 MB download and 108 MB at idle, and the budgets are
>   how I keep the rest honest.
> - **Data safety.** The app stores everything in SQLite through `node:sqlite`. The end-to-end
>   tests `kill -9` the app mid-edit, it keeps a daily snapshot for 14 days, and you can export
>   everything to Markdown or JSON at any time.
> - **Local-first.** There's no account and no telemetry. Sync is optional and off by default.
>   It runs on Supabase, the newest edit wins per item, and if you build Cue yourself you can
>   point it at your own Supabase project.
> - **No AI in the app, and there won't be.** But it runs an MCP server, so Claude or ChatGPT can
>   read your days, add to-dos and move them. The server is just another sync client, and
>   nothing it can call deletes anything.
> - **One core, two apps.** The Mac app and the iPhone app (Expo / React Native) share the data
>   model, storage, sync engine and every editing operation.
>
> It's free and MIT-licensed, and I don't plan to charge for it. The Mac app is a signed DMG
> for Apple silicon, and the iPhone app is on TestFlight for now.
>
> It's a beta, so bug reports are very welcome. I'm most curious what would make you use it
> instead of what you use now, or why you wouldn't.

---

## 2. X / Threads (Nov 10)

Attach the launch video to post 1 and the MCP clip to post 5.

> **1/** Every day is a page.
>
> I made Cue, a daily notes and to-do app for Mac and iPhone. Open it and type into today.
> Whatever you didn't finish moves to tomorrow with ⌘D.
>
> It's free and open source, and it needs no account. 🧵

> **2/** No projects, tags or priorities. The day is the only folder.

> **3/** Keyboard-first. Tab nests, ⌘↩ completes, and ⌘K does everything else, including dates
> like "move to fri".

> **4/** Fast, and measured. It's ready to type 240 ms after launch with five years of notes,
> and a keystroke renders in 1.5 ms. Every number has a budget, and a benchmark checks it
> against the real app.

> **5/** There's no AI inside Cue, and there won't be. There's a door instead: an MCP server,
> so Claude or ChatGPT can add a to-do or check one off, and it lands on your Mac a second
> later. Nothing it can call deletes anything.

> **6/** Free, MIT-licensed, no tracking. Mac (Apple silicon), plus the iPhone beta on
> TestFlight.
>
> usecue.today

**Bluesky / Mastodon** (one post, with the video; under 300 characters):

> Every day is a page. I made Cue: daily notes and to-dos for Mac and iPhone. Open it, type
> into today, and ⌘D moves what you didn't finish to tomorrow. Keyboard-first, free, open
> source, no account, no tracking. usecue.today

---

## 3. LinkedIn (Nov 10)

> For [the last N months] I've been building something just for me, outside of work: Cue, a
> daily notes and to-do app for Mac and iPhone.
>
> Every day is a page. You open it and type into today. There are no projects, tags or
> priorities to decide on first, and what you didn't get done moves to tomorrow with one
> shortcut.
>
> A few things I held myself to:
> → Every speed claim has a budget and a benchmark against the real app (240 ms to launch,
>   1.5 ms per keystroke).
> → Your notes stay on your device unless you turn on sync. There's no account and no tracking.
> → There's no AI in the app, but Claude or ChatGPT can use it over MCP.
> → It's free and open source, and it's staying that way.
>
> It's in beta and I use it every day. If you try it, I'd love to hear what you think.
> usecue.today

---

## 4. Reddit

### r/macapps (Nov 10)

Read the rules and pick the right flair first. Upload the video natively.

**Title:** `[Free, open source] Cue – daily notes and to-dos where the day is the only folder (Mac + iPhone)`

> Hi r/macapps, I'm the developer. Cue is a daily notes and to-do app. Every day is a page of
> text, bullets and to-dos. You open it and type into today, and what you didn't finish moves
> to tomorrow with ⌘D.
>
> - **No projects, tags or priorities.** Just days.
> - **Keyboard-first.** ⌘K for every command (it understands "move to fri"), ⌘F to search
>   every day, and a shortcut for everything. The mouse and drag and drop work too.
> - **Fast.** It's ready to type in about a quarter of a second, even with years of notes.
> - **Private.** Notes live in one SQLite file on your Mac. There's no account and no
>   analytics, and you can export to Markdown or JSON at any time.
> - **Optional sync** with the iPhone app (in beta on TestFlight).
> - **Free and MIT-licensed.** There's no paid tier, and none planned.
>
> Being upfront about it: it's Electron (122 MB), and it's Apple silicon only for now.
>
> Download: usecue.today/download · Source: github.com/zlwaterfield/cue
>
> It's a beta, so I'd really like to hear what breaks or what's missing.

### r/ClaudeAI and r/mcp (Nov 12–13)

Attach the MCP clip.

**Title:** `I made my to-do app's MCP server the only "AI feature" it has. Claude adds to-dos, and they show up on my Mac a second later`

> Cue is a daily notes and to-do app (Mac + iPhone, free, open source). I didn't want AI inside
> it, but I did want Claude to be able to see what I wrote this morning and add the thing we
> just agreed on.
>
> So it runs a remote MCP server at `https://www.usecue.today/mcp`, using OAuth. You add it as a
> custom connector. It has five tools: `get_day`, `find_todos`, `search`, `add_lines` and
> `update_lines`.
>
> Some design choices people here might like:
>
> - **It's just another sync client.** Its edits go through the same editing operations as the
>   app's, so a line lands exactly where it would if you'd typed it.
> - **Nothing deletes.** There's no tool for it, and the database refuses deletes from an
>   assistant's token even if it asks Supabase directly.
> - **Stateless, JSON-only MCP**, with no SDK. It's tested against the official TypeScript
>   client.
>
> How it works: github.com/zlwaterfield/cue/blob/main/docs/MCP.md

---

## 5. Product Hunt (Jan 12, 2027)

- **Name:** Cue
- **Tagline** (60 characters max):
  - `Every day is a page. Daily notes and to-dos for Mac.` (52)
  - `A page a day for notes and to-dos, on Mac and iPhone` (52)
- **Description** (260 characters max; this is 252):
  > Cue is a daily notes and to-do app for Mac and iPhone. Every day is a page: open it and type
  > into today. No projects, tags or priorities, and what you don't finish moves to tomorrow
  > with ⌘D. Keyboard-first, fast, free and open source, with no tracking.
- **Topics:** Productivity, Task Management, Notes, Mac, iPhone, Open Source
- **Links:** usecue.today, the App Store, GitHub
- **Pricing:** Free
- **Maker comment:**

> Hey Product Hunt! I'm Zach. I built Cue because every to-do app I tried wanted a project, a
> tag or a priority before it would take a note, and I just wanted a page for today.
>
> So in Cue, the day is the only folder. You open it and start typing. Bullets and to-dos nest
> as deep as you like, ⌘K does everything, and what you didn't finish rolls to tomorrow. On the
> iPhone, you swipe it there.
>
> What's new since the beta: [the top 3 things HN and Reddit asked for that you shipped].
>
> A few promises: no account unless you want sync, no tracking of any kind, and no AI inside
> the app. If you do use Claude or ChatGPT, it can add to your days over MCP. It's free and
> open source, with no paid plan coming.
>
> I'd love to know how you plan your day now, and whether Cue would fit in.

**What to ask your network on the day** (Product Hunt, not HN):

> Cue is on Product Hunt today: [link]. If you've used it, a comment about how you use it helps
> far more than an upvote. Thank you!

---

## 6. Pitch email: press, YouTube, newsletters (early December, for January)

Keep it short and personal, and send it one at a time. Mention a piece of theirs you actually
read.

**Subject:** A daily notes app with no AI inside, but Claude can use it

> Hi [name],
>
> [One honest line about their piece on X.]
>
> I've built Cue, a free, open-source daily notes and to-do app for Mac and iPhone. Every day is
> a page. You type into today, and what you didn't finish moves to tomorrow with ⌘D. There are
> no projects or tags, it's keyboard-first, and every speed claim is benchmarked against the
> real app.
>
> The part I think you'd find interesting: there's no AI in it, but it runs an MCP server, so
> Claude or ChatGPT can read your days and add to-dos. Edits sync to the Mac and iPhone about a
> second later, and nothing an assistant can call deletes anything.
>
> 1.0 and the App Store release are on [date]. Happy to send anything ahead of that.
> 45-second video: [link] · Press kit: usecue.today/press · Site: usecue.today
>
> Thanks,
> Zach

---

## 7. "Why I built Cue": a draft post for zlwaterfield.com

> # Every day is a page
>
> I've tried most to-do apps. [Things, Todoist, Notion, Obsidian's daily notes, a text file:
> your real list.] They all failed me the same way. Before they'd take a note, they wanted a
> decision: which project, which tag, how urgent. Most of what I write in a day doesn't have an
> answer to those questions yet. It just happened today.
>
> So I built the thing I wanted. In Cue, every day is a page. You open it and type into today:
> notes, bullets, to-dos, nested as deep as you like. Whatever you didn't finish moves to
> tomorrow with ⌘D. That's the whole system.
>
> ## Small on purpose
>
> Cue has no projects, tags, priorities, reminders or recurring tasks, and it isn't going to
> grow them. Every feature in a to-do app is a question it asks you, and I wanted an app that
> asks nothing.
>
> ## Fast, and measured
>
> An app you open fifty times a day has to be ready before you've finished thinking of what to
> write. So every speed claim in Cue has a budget, and a benchmark checks it against the real,
> packaged app. It's ready to type 240 ms after launch, even with five years of notes, and a
> keystroke reaches the screen in 1.5 ms. [One sentence on the hardest one to hit.]
>
> ## Yours
>
> Your notes live on your Mac in a single SQLite file. There's no account unless you want sync,
> there's no telemetry, and you can export everything to Markdown at any time. The code is MIT,
> all of it.
>
> ## A door, not an assistant
>
> There's no AI in Cue. But I talk to Claude all day, and it seemed a shame it couldn't see what
> I wrote this morning. So Cue runs an MCP server: your assistant can read your days and add to
> them, and it lands on your Mac a second later, like any other device. It can't delete
> anything.
>
> ## Try it
>
> It's free, it's in beta, and it's what I use every day. [usecue.today](https://usecue.today)
>
> See you tomorrow.
