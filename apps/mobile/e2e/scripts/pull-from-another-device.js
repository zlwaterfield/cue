// The other device (signed in by push-from-another-device.js) downloads the account and
// looks for TEXT among its live items.
const url = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : 'http://127.0.0.1:54321'
const pulled = http.post(url + '/rest/v1/rpc/sync_pull', {
  headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + output.peerToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({ since: 0, max_rows: 1000 })
})
const records = json(pulled.body).records
output.found = records.some((r) => r.text === TEXT && !r.deleted)
