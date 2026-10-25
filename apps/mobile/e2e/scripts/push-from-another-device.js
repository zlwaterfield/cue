// Another device writes a to-do on today's page: it signs in to the same account over
// HTTP (email code from Mailpit) and calls sync_push, exactly as the Mac does.
const url = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'http://127.0.0.1:54321'
const key = SUPABASE_KEY
const mailbox = typeof MAILPIT !== 'undefined' ? MAILPIT : 'http://127.0.0.1:54324'
const headers = { apikey: key, 'Content-Type': 'application/json' }

http.post(url + '/auth/v1/otp', { headers: headers, body: JSON.stringify({ email: EMAIL, create_user: false }) })
const query = encodeURIComponent('to:"' + EMAIL + '"')
const search = json(http.get(mailbox + '/api/v1/search?query=' + query).body)
const message = json(http.get(mailbox + '/api/v1/message/' + search.messages[0].ID).body)
http.request(mailbox + '/api/v1/messages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: search.messages.map((m) => m.ID) }) })
const code = /\b(\d{6,10})\b/.exec(message.Text)[1]
const session = json(http.post(url + '/auth/v1/verify', { headers: headers, body: JSON.stringify({ type: 'email', email: EMAIL, token: code }) }).body)

const now = Date.now()
const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
const record = {
  id: hex() + hex() + '-' + hex() + '-4' + hex().slice(1) + '-8' + hex().slice(1) + '-' + hex() + hex() + hex(),
  date: TODAY,
  parentId: null,
  // Sorts after the phone's first lines by default; 'Zz' sorts before them.
  position: typeof POSITION !== 'undefined' ? POSITION : 'az',
  type: 'todo',
  text: TEXT,
  done: false,
  createdAt: now,
  updatedAt: now,
  deleted: false,
  // A hybrid-logical-clock version, as every device stamps its writes.
  version: now.toString(36).padStart(10, '0') + '-0000-maestro'
}
const pushed = http.post(url + '/rest/v1/rpc/sync_push', {
  headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: [record] })
})
if (pushed.status !== 200) throw new Error('sync_push failed: ' + pushed.status + ' ' + pushed.body)
// Kept for pull-from-another-device.js.
output.peerToken = session.access_token
