/**
 * The launch video, written down once.
 *
 * `capture.mjs` runs each beat's `act` against the real app and records when it
 * started and ended; `compose.mjs` reads the same beats back and puts the
 * captions on screen over that footage. Change the film here, not in either.
 *
 * Captions stay at seven words or fewer: the video is watched without sound.
 */

/** Logical size of the app window, and the scale it is captured at. */
export const WINDOW = { width: 900, height: 630, scale: 3 }

/**
 * Days before today, written before recording starts, so ⌘F has something to
 * find. All of it is done or plain text, so Today opens clean.
 */
export const SEED = [
  ['1:1 with Priya: Q4 planning, hiring, the offsite', '[x] Book the dentist'],
  ['Ideas for the team offsite', '[x] Draft the Q4 plan for Priya'],
  ["Priya's feedback: tighten the roadmap, cut the dashboard", '[x] Renew passport']
]

/** The opening card, before the app appears. */
export const OPENING = { seconds: 2.4, caption: 'Every day is a page.' }

/**
 * The iPhone beat, cut from the App Store screenshots. It follows the dark beat,
 * so the phone is the dark screenshot and the film stays on Night to the end.
 */
export const DEVICES = {
  seconds: 5.2,
  caption: 'Your Mac and your iPhone.',
  sub: 'Sync is optional, and free.',
  screen: 'brand/app-store/screens/07-dark.png'
}

/** The closing card. */
export const CLOSING = {
  seconds: 4.2,
  caption: 'Every day is a page.',
  sub: 'Free and open source, for Mac and iPhone.',
  url: 'usecue.today'
}

export const beats = [
  {
    name: 'open',
    caption: 'Open it and type.',
    async act(ui) {
      await ui.pause(1100)
    }
  },
  {
    name: 'write',
    caption: 'No projects. No tags. No priorities.',
    async act(ui) {
      await ui.type('Slow morning. Coffee, errands, then the long run.')
      await ui.pause(420)
    }
  },
  {
    name: 'todos',
    caption: 'Text, bullets and to-dos.',
    async act(ui) {
      await ui.press('Enter')
      await ui.type('[] Pick up dry cleaning')
      await ui.pause(360)
      await ui.press('Enter')
      await ui.type('Call Mom about Thanksgiving')
      await ui.pause(320)
    }
  },
  {
    name: 'lists',
    caption: 'Nested as deep as you like.',
    async act(ui) {
      await ui.press('Enter')
      await ui.type('Groceries')
      await ui.press('Enter')
      await ui.press('Tab')
      await ui.key('Meta+Shift+Enter')
      await ui.type('oat milk')
      await ui.press('Enter')
      await ui.type('eggs')
      await ui.press('Enter')
      await ui.type('lemons')
      await ui.pause(300)
      await ui.press('Enter')
      await ui.press('Enter')
      await ui.key('Meta+Shift+Enter')
      await ui.type('Send the Q4 plan to Priya')
      await ui.pause(500)
    }
  },
  {
    name: 'complete',
    caption: 'Check it off.',
    async act(ui) {
      for (let i = 0; i < 5; i++) await ui.press('ArrowUp', { after: 95 })
      await ui.pause(260)
      await ui.key('Meta+Enter')
      await ui.pause(900)
    }
  },
  {
    name: 'defer',
    caption: 'Not today? Send it to tomorrow.',
    async act(ui) {
      await ui.press('ArrowUp', { after: 220 })
      await ui.key('Meta+d')
      await ui.pause(1700)
    }
  },
  {
    name: 'palette',
    caption: 'One palette, and it knows dates.',
    async act(ui) {
      await ui.key('Meta+k')
      await ui.pause(520)
      await ui.type('move to fri', { cps: 11 })
      await ui.pause(1500)
      await ui.press('Escape', { after: 650 })
    }
  },
  {
    name: 'search',
    caption: 'Find anything you ever wrote.',
    async act(ui) {
      await ui.key('Meta+f')
      await ui.pause(480)
      await ui.type('priya', { cps: 9 })
      await ui.pause(1900)
      await ui.press('Escape', { after: 600 })
    }
  },
  {
    name: 'dark',
    caption: 'Light or dark.',
    async act(ui) {
      await ui.theme('dark')
      await ui.pause(1700)
    }
  },
  {
    name: 'shortcuts',
    caption: 'Every action has a shortcut.',
    async act(ui) {
      await ui.key('Meta+/')
      await ui.pause(2600)
      await ui.press('Escape', { after: 500 })
    }
  }
]
