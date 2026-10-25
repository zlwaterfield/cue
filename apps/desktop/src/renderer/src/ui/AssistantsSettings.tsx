import { useEffect, useState } from 'react'
import { ASSISTANTS_URL, CONNECTED_ASSISTANTS_URL, MCP_URL } from '@shared/assistants'
import { backend } from '../data/backend'
import { syncState } from '../store/sync'
import { useStore } from '../store/ui'

/**
 * The Assistants pane in Settings: the URL an assistant connects to over MCP, and how. An
 * assistant works with the account, not this Mac, so until sync is on the pane says so and
 * points to Sync. Builds without a sync server have no Assistants category, as for Sync.
 * The words are the iPhone's (`app/settings/assistants.tsx`).
 */
export function AssistantsSettings({ goToSync }: { goToSync: () => void }) {
  const email = useStore(syncState, (s) => s.email)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async (): Promise<void> => {
    await backend.clipboardWrite(MCP_URL)
    setCopied(true)
  }

  return (
    <>
      <div className="setting is-stacked">
        <div className="setting-split">
          {email ? (
            <div>
              <div className="setting-label">MCP server URL</div>
              <div className="setting-help">
                Add it as a custom connector in Claude, ChatGPT or another assistant, then sign in as <strong>{email}</strong>{' '}
                and press Allow.
              </div>
            </div>
          ) : (
            <div>
              <div className="setting-label">Turn on sync first</div>
              <div className="setting-help">
                An assistant connects to your Cue account, not to this Mac, so it only works once sync is on and you’re signed in.
                Then add this URL as a custom connector in Claude, ChatGPT or another assistant.
              </div>
            </div>
          )}
          {email ? (
            <button className="button" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          ) : (
            <button className="button" onClick={goToSync}>
              Go to Sync
            </button>
          )}
        </div>
        <code className="setting-url">{MCP_URL}</code>
      </div>
      <div className="setting">
        <div>
          <div className="setting-label">How it works</div>
          <div className="setting-help">What an assistant can and can’t do with your days.</div>
        </div>
        <button className="button is-quiet" onClick={() => void backend.openExternal(ASSISTANTS_URL)}>
          Learn More
        </button>
      </div>
      {email && (
        <div className="setting">
          <div>
            <div className="setting-label">Connected assistants</div>
            <div className="setting-help">See and disconnect the assistants you’ve connected.</div>
          </div>
          <button className="button is-quiet" onClick={() => void backend.openExternal(CONNECTED_ASSISTANTS_URL)}>
            Manage…
          </button>
        </div>
      )}
    </>
  )
}
