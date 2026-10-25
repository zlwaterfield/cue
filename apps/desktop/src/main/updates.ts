import type { UpdateState } from '@shared/types'

/**
 * Cue updating itself. A build from `pnpm release` looks for a newer version a minute
 * after launch and every six hours after that, downloads it in the background, and
 * installs it the next time Cue quits, or right away if you choose Restart to Update.
 * Nothing is asked of you and nothing interrupts typing. Development, test and
 * self-built apps never check.
 *
 * The feed is the repository's GitHub releases: electron-updater reads the
 * `latest-mac.yml` and zip that `pnpm release:upload` publishes, and Squirrel.Mac
 * installs it after checking it's signed by the same Developer ID. A beta moves to the
 * newest beta or stable release; a stable version only to stable ones.
 */

/** What the service needs from electron-updater's `MacUpdater`, or a fake in tests. */
export interface Updater {
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean
    updateInfo: { version: string }
    /** With automatic downloads, settles once Squirrel.Mac holds the update. */
    downloadPromise?: Promise<unknown> | null
  } | null>
  quitAndInstall(): void
}

export interface UpdateServiceOptions {
  /** False for anything but a release build: the service then never loads or checks. */
  enabled: boolean
  /** Loads the updater when the first check is due, so it stays off the launch path. */
  load: () => Promise<Updater>
  onState: (state: UpdateState) => void
}

const FIRST_CHECK = 60_000
const CHECK_EVERY = 6 * 60 * 60_000

const OFFLINE = 'Couldn’t reach GitHub to check for updates. Check your connection and try again.'
const FAILED = 'Couldn’t update Cue. Try again later, or download the latest version from usecue.today.'

export class UpdateService {
  private updater: Promise<Updater> | null = null
  private started = false
  private current: UpdateState

  constructor(private readonly options: UpdateServiceOptions) {
    this.current = { available: options.enabled, status: 'idle', version: null, message: null }
  }

  state(): UpdateState {
    return this.current
  }

  /** Schedules the background checks. */
  start(): void {
    if (!this.options.enabled || this.started) return
    this.started = true
    setTimeout(() => void this.check(false), FIRST_CHECK).unref?.()
    setInterval(() => void this.check(false), CHECK_EVERY).unref?.()
  }

  /**
   * Looks for a newer Cue and starts downloading it. Resolves when the check is done,
   * without waiting for the download. A check that runs on its own fails quietly; one
   * you asked for (`manual`) says why in `message`.
   */
  async check(manual = true): Promise<UpdateState> {
    const { status } = this.current
    if (!this.options.enabled || status === 'checking' || status === 'downloading' || status === 'ready') return this.current
    this.set({ status: 'checking', message: null })
    let result: Awaited<ReturnType<Updater['checkForUpdates']>>
    try {
      result = await (await this.load()).checkForUpdates()
    } catch (error) {
      this.fail(error, manual)
      return this.current
    }
    if (!result?.isUpdateAvailable) {
      this.set({ status: 'idle', version: null })
      return this.current
    }
    const version = result.updateInfo.version
    this.set({ status: 'downloading', version })
    void Promise.resolve(result.downloadPromise).then(
      () => this.set({ status: 'ready', version }),
      (error) => this.fail(error, manual)
    )
    return this.current
  }

  /** Quits and installs the downloaded update, then opens Cue again. */
  install(): void {
    if (this.current.status !== 'ready') return
    this.load().then(
      (updater) => updater.quitAndInstall(),
      (error) => this.fail(error, true)
    )
  }

  private load(): Promise<Updater> {
    if (!this.updater) {
      this.updater = this.options.load()
      // One that failed to load gets another try at the next check.
      this.updater.catch(() => (this.updater = null))
    }
    return this.updater
  }

  private fail(error: unknown, manual: boolean): void {
    console.error('Update failed', error)
    this.set({ status: manual ? 'error' : 'idle', version: null, message: manual ? updateMessage(error) : null })
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.options.onState(this.current)
  }
}

/** A failed check or download, in words a person can act on. Never raw updater text. */
export function updateMessage(error: unknown): string {
  const text = error instanceof Error ? `${(error as NodeJS.ErrnoException).code ?? ''} ${error.message}` : String(error)
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION/.test(text)
    ? OFFLINE
    : FAILED
}
