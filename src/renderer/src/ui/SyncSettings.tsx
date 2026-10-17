import { useEffect, useState } from 'react'
import type { SyncResult, SyncState } from '@shared/types'
import { backend } from '../data/backend'
import { refreshSync, syncState } from '../store/sync'
import { useStore } from '../store/ui'

/**
 * The Sync row in Settings. Sync is off until you sign in with your email and a
 * six-digit code. Builds without a sync server don't show this at all.
 */
export function SyncSettings() {
  const state = useStore(syncState, (s) => s)
  useEffect(refreshSync, [])
  if (!state.available) return null
  return (
    <div className="setting is-stacked">
      {state.email ? <SignedIn state={state} /> : <SignIn message={state.message} />}
    </div>
  )
}

function SignedIn({ state }: { state: SyncState }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const syncNow = async (): Promise<void> => {
    setBusy(true)
    const result = await backend.sync.syncNow()
    setBusy(false)
    setError(result.ok ? null : result.error)
  }
  const deleteAccount = async (): Promise<void> => {
    const result = await backend.sync.deleteAccount()
    if (result && !result.ok) setError(result.error)
  }
  return (
    <>
      <div className="setting-split">
        <div>
          <div className="setting-label">Sync</div>
          <div className="setting-help">
            On as <strong>{state.email}</strong>. {describe(state)}
          </div>
          {(error ?? state.message) && <div className="setting-error">{error ?? state.message}</div>}
        </div>
        <button className="button" onClick={() => void syncNow()} disabled={busy}>
          {busy || state.status === 'syncing' ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>
      <div className="button-row">
        <button className="button is-quiet" onClick={() => void backend.sync.signOut()}>
          Turn Off Sync
        </button>
        <button className="button is-quiet" onClick={() => void deleteAccount()}>
          Delete Account…
        </button>
      </div>
    </>
  )
}

function describe(state: SyncState): string {
  const waiting = state.pending === 1 ? '1 change' : `${state.pending} changes`
  switch (state.status) {
    case 'offline':
      return state.pending ? `Offline. ${waiting} will sync when you’re back online.` : 'Offline.'
    case 'error':
      return state.pending ? `${waiting} waiting to sync.` : ''
    case 'syncing':
      return 'Syncing…'
    default:
      return state.lastSyncedAt ? `Synced ${ago(state.lastSyncedAt)}.` : 'Syncing…'
  }
}

function ago(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

type Step = { kind: 'off' } | { kind: 'email' } | { kind: 'code'; email: string }

function SignIn({ message }: { message: string | null }) {
  const [step, setStep] = useState<Step>({ kind: 'off' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<SyncResult>, onSuccess?: () => void): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (result.ok) onSuccess?.()
    else setError(result.error)
  }

  const sendCode = (e: React.FormEvent): void => {
    e.preventDefault()
    const address = email.trim()
    if (!address) return
    void run(
      () => backend.sync.sendCode(address),
      () => {
        setCode('')
        setStep({ kind: 'code', email: address })
      }
    )
  }

  const verify = (e: React.FormEvent): void => {
    e.preventDefault()
    if (step.kind !== 'code' || !code.trim()) return
    void run(() => backend.sync.verifyCode(step.email, code))
  }

  return (
    <>
      <div className="setting-split">
        <div>
          <div className="setting-label">Sync</div>
          <div className="setting-help">
            {step.kind === 'code'
              ? `Enter the code we emailed to ${step.email}.`
              : 'Off. Your notes are stored only on this Mac. Turn on sync to keep them on your other devices too.'}
          </div>
          {(error ?? message) && <div className="setting-error">{error ?? message}</div>}
        </div>
        {step.kind === 'off' && (
          <button className="button" onClick={() => setStep({ kind: 'email' })}>
            Turn On Sync…
          </button>
        )}
      </div>
      {step.kind === 'email' && (
        <form className="inline-form" onSubmit={sendCode}>
          <input
            className="field"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
          />
          <button className="button" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send Code'}
          </button>
        </form>
      )}
      {step.kind === 'code' && (
        <form className="inline-form" onSubmit={verify}>
          <input
            className="field is-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Sign-in code"
          />
          <button className="button" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Turn On Sync'}
          </button>
          <button className="button is-quiet" type="button" onClick={() => setStep({ kind: 'email' })}>
            Use a Different Email
          </button>
        </form>
      )}
    </>
  )
}
