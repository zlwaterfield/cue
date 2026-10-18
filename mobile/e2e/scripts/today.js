// Today's date in the simulator's calendar (the Mac's), as Cue names pages: YYYY-MM-DD.
const now = new Date()
const pad = (n) => (n < 10 ? '0' : '') + n
output.today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
