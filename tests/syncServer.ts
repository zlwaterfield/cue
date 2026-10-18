/**
 * A real Supabase to test sync against, usually the local stack from
 * `npx supabase start` (docs/SYNC.md). Tests that need it are skipped unless
 * CUE_SUPABASE_URL and CUE_SUPABASE_KEY are set.
 */
export const syncServer =
  process.env.CUE_SUPABASE_URL && process.env.CUE_SUPABASE_KEY
    ? {
        url: process.env.CUE_SUPABASE_URL,
        key: process.env.CUE_SUPABASE_KEY,
        mailbox: process.env.CUE_MAILPIT_URL ?? 'http://127.0.0.1:54324'
      }
    : null

export function testEmail(label: string): string {
  return `cue-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
}

/** The sign-in code emailed to `email`, read (and then removed) from the local Mailpit inbox. */
export async function signInCode(email: string): Promise<string> {
  const mailbox = syncServer!.mailbox
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const search = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    const { messages } = (await search.json()) as { messages: Array<{ ID: string }> }
    if (messages.length) {
      const message = (await (await fetch(`${mailbox}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string }
      // Clear the inbox so the next code for this address can't be confused with this one.
      await fetch(`${mailbox}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: messages.map((m) => m.ID) })
      })
      const code = /\b(\d{6,10})\b/.exec(message.Text)?.[1]
      if (code) return code
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`No sign-in code arrived for ${email}`)
}
