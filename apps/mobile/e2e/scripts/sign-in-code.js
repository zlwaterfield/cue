// Read the sign-in code for EMAIL from the local Mailpit inbox, then clear it.
// Same approach as the Mac app's sync tests (tests/syncServer.ts).
const mailbox = typeof MAILPIT !== 'undefined' ? MAILPIT : 'http://127.0.0.1:54324'
const query = encodeURIComponent('to:"' + EMAIL + '"')
const search = json(http.get(mailbox + '/api/v1/search?query=' + query).body)
if (!search.messages || !search.messages.length) throw new Error('No sign-in email for ' + EMAIL)
const message = json(http.get(mailbox + '/api/v1/message/' + search.messages[0].ID).body)
const match = /\b(\d{6,10})\b/.exec(message.Text)
if (!match) throw new Error('No code in the sign-in email')
http.request(mailbox + '/api/v1/messages', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ IDs: search.messages.map((m) => m.ID) })
})
output.code = match[1]
