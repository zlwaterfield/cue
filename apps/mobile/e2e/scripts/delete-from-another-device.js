// Another device deletes the account: it signs in to EMAIL over HTTP (email code from
// Mailpit) and calls sync_delete_account, as Settings → Delete Account… does.
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

const deleted = http.post(url + '/rest/v1/rpc/sync_delete_account', {
  headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
  body: '{}'
})
if (deleted.status >= 300) throw new Error('sync_delete_account failed: ' + deleted.status + ' ' + deleted.body)
