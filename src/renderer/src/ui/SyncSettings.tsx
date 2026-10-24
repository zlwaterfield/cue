import { useEffect, useRef, useState } from 'react'
import { PLANS, type BillingStatus, type Plan } from '@shared/billing'
import { MONTHS } from '@shared/dates'
import { statusLine } from '@shared/sync/status'
import { isEmailAddress, NOT_AN_EMAIL } from '@shared/text'
import type { SyncResult, SyncState } from '@shared/types'
import { backend } from '../data/backend'
import { refreshSync, syncState } from '../store/sync'
import { useStore } from '../store/ui'

/**
 * The Sync row in Settings. Sync is off until you sign in, with Apple or with your email
 * and a six-digit code. Builds without a sync server don't show this at all. The words
 * are the iPhone's (`shared/sync/status`).
 */
export function SyncSettings() {
  const state = useStore(syncState, (s) => s)
  useEffect(refreshSync, [])
  if (!state.available) return null
  return <div className="setting is-stacked">{state.email ? <SignedIn state={state} /> : <SignIn state={state} />}</div>
}

/** The time, updated every `ms`, so "Synced 2 min ago" stays true while Settings is open. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

function SignedIn({ state }: { state: SyncState }) {
  const now = useNow(15_000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A failed sync leaves the status Offline or paused, and the status line says why, so
  // Sync Now has nothing to add.
  const syncNow = async (): Promise<void> => {
    setBusy(true)
    await backend.sync.syncNow()
    setBusy(false)
  }
  const deleteAccount = async (): Promise<void> => {
    const result = await backend.sync.deleteAccount()
    setError(result && !result.ok ? result.error : null)
  }
  const billing = state.billing?.required ? state.billing : null
  // A billing error is about the state it was shown in.
  useEffect(() => setError(null), [billing?.active])
  // Stripe's pages open in the browser; coming back to Cue picks up the change.
  const openBilling = async (open: () => Promise<SyncResult>): Promise<void> => {
    const result = await open()
    setError(result.ok ? null : result.error)
  }
  return (
    <>
      <div className="setting-split">
        <div>
          <div className="setting-label">Sync</div>
          <div className="setting-help">
            On as <strong>{state.email}</strong>
          </div>
          <div className="setting-help">{statusLine(state, now)}</div>
          {billing && <div className="setting-help">{planLine(billing)}</div>}
          {error && <div className="setting-error">{error}</div>}
        </div>
        <button className="button" onClick={() => void syncNow()} disabled={busy || state.status === 'syncing'}>
          Sync Now
        </button>
      </div>
      {billing && !billing.active && (
        <div className="button-row">
          {(['yearly', 'monthly'] as Plan[]).map((plan) => (
            <button key={plan} className={plan === 'yearly' ? 'button' : 'button is-quiet'} onClick={() => void openBilling(() => backend.sync.subscribe(plan))}>
              Subscribe {plan === 'yearly' ? 'Yearly' : 'Monthly'} · {PLANS[plan].price}
            </button>
          ))}
        </div>
      )}
      <div className="button-row">
        {billing?.active && billing.plan !== 'comp' && (
          <button className="button is-quiet" onClick={() => void openBilling(() => backend.sync.manageSubscription())}>
            Manage Subscription…
          </button>
        )}
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

/** The subscription, under the sync status, on a server that charges for sync. */
function planLine(billing: BillingStatus): string {
  if (!billing.active) return `Sync needs a subscription: ${PLANS.monthly.price} a month or ${PLANS.yearly.price} a year. Notes on this Mac stay here either way.`
  if (billing.plan === 'comp' || !billing.plan) return 'Sync is free for this account.'
  const { price, per } = PLANS[billing.plan]
  const plan = `${price} a ${per}.`
  if (!billing.renewsAt) return plan
  const date = new Date(billing.renewsAt)
  const day = `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`
  return billing.cancelsAtPeriodEnd ? `${plan} Ends on ${day}.` : `${plan} Renews on ${day}.`
}

type Step = { kind: 'off' } | { kind: 'email' } | { kind: 'code'; email: string } | { kind: 'apple'; back: Step }

/**
 * Off, then Sign in with Apple or your email, then (for email) the code. If the server
 * ended the session, Off says so and offers to sign in again the same way (or, for a
 * deleted account, to turn sync on afresh).
 */
function SignIn({ state }: { state: SyncState }) {
  const [step, setStep] = useState<Step>({ kind: 'off' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only the latest Sign in with Apple may move the steps; a cancelled one resolves late.
  const attempt = useRef(0)

  const go = (next: Step): void => {
    setStep(next)
    setError(null)
  }

  const run = async (kind: 'send' | 'verify', action: () => Promise<SyncResult>, onSuccess?: () => void): Promise<void> => {
    if (busy) return
    setBusy(kind)
    setError(null)
    const result = await action()
    setBusy(null)
    if (result.ok) onSuccess?.()
    else setError(result.error)
  }

  const sendCode = (address: string): void => {
    void run(
      'send',
      () => backend.sync.sendCode(address),
      () => {
        setCode('')
        go({ kind: 'code', email: address })
      }
    )
  }

  /** Apple's page opens in the browser; Cue waits here until it comes back. */
  const signInWithApple = (): void => {
    if (busy || step.kind === 'apple') return
    const current = ++attempt.current
    go({ kind: 'apple', back: step })
    void backend.sync.signInWithApple().then((result) => {
      // Signed in, the account shows in place of this row.
      if (result.ok || attempt.current !== current) return
      setStep(step)
      setError(result.error || null)
    })
  }

  const cancelApple = (): void => {
    if (step.kind !== 'apple') return
    attempt.current += 1
    backend.sync.cancelSignIn()
    go(step.back)
  }

  const submitEmail = (e: React.FormEvent): void => {
    e.preventDefault()
    const address = email.trim()
    if (!address) return
    if (isEmailAddress(address)) sendCode(address)
    else setError(NOT_AN_EMAIL)
  }

  const verify = (e: React.FormEvent): void => {
    e.preventDefault()
    if (step.kind !== 'code' || !code.trim()) return
    void run('verify', () => backend.sync.verifyCode(step.email, code))
  }

  const previous = state.previousEmail
  let help: React.ReactNode
  if (step.kind === 'code') help = `Enter the code we sent to ${step.email}.`
  else if (step.kind === 'apple') help = 'Finish signing in with Apple in your browser.'
  else if (step.kind === 'email') help = 'Continue with Apple, or enter your email and we’ll send a six-digit code.'
  else if (state.needsSignIn) help = <span className="setting-notice">{state.message}</span>
  else help = 'Off. Your notes are stored only on this Mac. Turn on sync to keep them on your other devices too.'

  return (
    <>
      <div className="setting-split">
        <div>
          <div className="setting-label">Sync</div>
          <div className="setting-help">{help}</div>
          {error && <div className="setting-error">{error}</div>}
        </div>
        {step.kind === 'off' && (
          <div className="setting-actions">
            {state.needsSignIn && (
              <button className="button is-quiet" onClick={() => void backend.sync.signOut()}>
                Not Now
              </button>
            )}
            {previous ? (
              <button
                className="button"
                onClick={() => (state.previousMethod === 'apple' ? signInWithApple() : sendCode(previous))}
                disabled={!!busy}
              >
                {busy ? 'Sending…' : 'Sign In Again…'}
              </button>
            ) : (
              <button className="button" onClick={() => go({ kind: 'email' })}>
                Turn On Sync…
              </button>
            )}
          </div>
        )}
        {step.kind === 'apple' && (
          <div className="setting-actions">
            <button className="button" onClick={cancelApple}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {step.kind === 'email' && (
        <>
          <div className="button-row">
            <AppleButton onClick={signInWithApple} disabled={!!busy} />
          </div>
          <form className="inline-form" onSubmit={submitEmail} noValidate>
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
            <button className="button" type="submit" disabled={!!busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send Code'}
            </button>
            <button className="button is-quiet" type="button" onClick={() => go({ kind: 'off' })}>
              Cancel
            </button>
          </form>
        </>
      )}
      {step.kind === 'code' && (
        <>
          <form className="inline-form" onSubmit={verify} noValidate>
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
            <button className="button" type="submit" disabled={!!busy || !code.trim()}>
              {busy === 'verify' ? 'Checking…' : 'Turn On Sync'}
            </button>
          </form>
          <div className="button-row">
            <button className="button is-quiet" onClick={() => sendCode(step.email)} disabled={!!busy}>
              {busy === 'send' ? 'Sending…' : 'Send a New Code'}
            </button>
            <button className="button is-quiet" onClick={() => go({ kind: 'email' })}>
              Use a Different Email
            </button>
          </div>
        </>
      )}
    </>
  )
}

/** Apple's button: black on light, white on dark, with the Apple logo (Human Interface Guidelines). */
function AppleButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="button is-apple" type="button" onClick={onClick} disabled={disabled}>
      <svg width="11" height="13" viewBox="0 0 814 1000" aria-hidden>
        <path
          fill="currentColor"
          d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
        />
      </svg>
      Continue with Apple
    </button>
  )
}
