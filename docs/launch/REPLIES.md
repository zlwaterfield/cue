# Prepared replies

These are the questions HN and Reddit will ask, roughly in the order they'll come. Write the
real answers before launch day, so you aren't making policy in a comment box at 9 am. The
drafts below say only what the repo and the site already say. `[brackets]` mark decisions
you still need to make.

**How to reply:**
- Thank people first, and concede whatever is true.
- Link to the doc that already answers it.
- If it's a bug, open an issue and reply with the link.
- Never argue.

---

**"Electron? For a notes app?"**

> Fair. It costs a 122 MB download and about 108 MB of memory at idle, more than a native app
> would. I chose it because Chromium's text editing was the most reliable base I found for a
> nested editor, and I hold the rest to budgets: 240 ms from launch to typing, and 1.5 ms per
> keystroke (p95 3.7 ms), measured on the packaged app by `pnpm bench`. If any of them regress,
> it's a bug.

**"Is sync end-to-end encrypted?"**

> No, and the privacy policy says so. Notes are encrypted in transit and at rest, and row-level
> security means an account can only read its own rows, but they aren't end-to-end encrypted.
> Sync is off by default, so without it nothing leaves your Mac. If you build Cue yourself you
> can run your own Supabase project. [Is E2E on the roadmap? Decide: "not planned", "after
> 1.0", or "I'd like to; here's the issue".]

**"Intel Mac? Windows? Linux? Android?"**

> Apple silicon only for now. [Intel: say yes or no. It's an electron-builder target, so the
> real cost is testing and the bench.] Windows and Linux would mostly be packaging, since it's
> Electron, but I only use a Mac, and I don't want to ship something I don't use every day.
> [Android: not planned / open to a contributor.]

**"Why free? What happens when you get bored?"**

> It's a personal project, not a business. I built it for myself and there's no plan to charge.
> If I ever stopped, nothing would be lost: your notes are one SQLite file on your Mac, you can
> export them to Markdown at any time, the code is MIT, and you can run your own sync server.

**"Why SQLite and not plain Markdown files, like Obsidian?"**

> Speed and crash safety. Launching in 240 ms with five years of notes, and searching 36k items
> in half a millisecond, is easier with one indexed file. So is surviving `kill -9` mid-edit,
> which the tests check. Markdown is the way out, though: File ▸ Export as Markdown writes one
> file per day, and Markdown is also how copy and paste work.

**"How is this different from Obsidian daily notes / Logseq journals / Apple Notes?"**

> Those are general note tools with a daily page added on. Cue is only the daily page, so it can
> do things they can't: earlier unfinished to-dos show up on today, ⌘D and "move to fri" move
> lines between days, and it's ready to type the instant it opens. If you want links, graphs
> and plugins, Obsidian is the better tool.

**"…vs Things / Todoist / Tweek / NotePlan / Sunsama?"**

> Things and Todoist are project managers. Cue has no projects, tags or priorities, on purpose.
> Tweek is closest in spirit, a week of days, but [your honest take]. NotePlan combines
> calendar, notes and tasks; Cue is deliberately much smaller.

**"No reminders or recurring tasks? That's a dealbreaker."**

> That's fair, and Cue is the wrong tool if you need them. They're on the "not planned" list in
> the README. Every feature like that is another question the app asks you before you can type,
> and keeping it out is the point. [Optional: "Lots of people pair Cue with Reminders for that."]

**"You said no AI, but there's MCP?"**

> There's nothing in the app that writes, suggests or summarizes. MCP is a door for the
> assistant you already use. It needs sync on, you connect it yourself, and you can disconnect
> it at any time. It can't delete anything: there's no tool for it, and the database refuses
> deletes from an assistant's token anyway. Your notes only go to Claude or OpenAI if you
> connect them.

**"What happens to my data in a beta?"**

> It saves as you type, with no save step. The end-to-end tests `kill -9` the app mid-edit and
> check that nothing was lost. There's a daily snapshot for 14 days, and export runs at any
> time. It's my daily driver. Still, it's a beta, so export now and then.

**"How do I update?"**

> [Once the update check ships: "Cue checks on launch and tells you." If it doesn't ship in
> time: "Download the new DMG from the site; your notes stay where they are."]

**"iPad? Widgets? Shortcuts? Apple Watch?"**

> [Decide.] The iPhone build has tablet support switched on, but I haven't designed for iPad
> yet.

**"Why isn't the iPhone app on the App Store?"**

> It's in TestFlight while it's in beta. [The App Store release is planned for January.]

**"The name is impossible to search for."**

> True. "Cue daily notes" or usecue.today finds it.

**"Can I self-host sync?"**

> Yes, if you build the apps yourself and point them at your own Supabase project. docs/SYNC.md
> walks through it.

**"Can I import from X?"**

> [Decide. A Markdown import, one file per day, would cover Obsidian and Logseq users and is
> worth considering before January.]
