import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateService, updateMessage, type Updater } from '../../src/main/updates'
import type { UpdateState } from '@shared/types'

type Check = Awaited<ReturnType<Updater['checkForUpdates']>>

function setup(enabled = true, check: () => Promise<Check> = async () => ({ isUpdateAvailable: false, updateInfo: { version: '1.0.0-beta.1' } })) {
  const states: UpdateState[] = []
  const updater = { checkForUpdates: vi.fn(check), quitAndInstall: vi.fn() }
  const load = vi.fn(async () => updater)
  const service = new UpdateService({ enabled, load, onState: (s) => states.push(s) })
  return { service, updater, load, states }
}

/** A download that finishes (or fails) when the test says. */
function download() {
  let finish!: () => void
  let fail!: (error: Error) => void
  const promise = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  return { promise, finish, fail }
}

describe('UpdateService', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.useRealTimers())

  it('never loads the updater or checks in a build that doesn’t update itself', async () => {
    vi.useFakeTimers()
    const { service, load, states } = setup(false)
    service.start()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(await service.check()).toEqual({ available: false, status: 'idle', version: null, message: null })
    expect(load).not.toHaveBeenCalled()
    expect(states).toEqual([])
  })

  it('checks a minute after launch, then every six hours, off the launch path', async () => {
    vi.useFakeTimers()
    const { service, updater, load } = setup()
    service.start()
    service.start()
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('says when this is the latest version', async () => {
    const { service, states } = setup()
    expect(await service.check()).toMatchObject({ available: true, status: 'idle', version: null })
    expect(states.map((s) => s.status)).toEqual(['checking', 'idle'])
  })

  it('downloads a newer version in the background, then installs it only once it’s ready', async () => {
    const pending = download()
    const { service, updater, states } = setup(true, async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.0-beta.2' },
      downloadPromise: pending.promise
    }))
    // The check answers before the download is done.
    expect(await service.check()).toMatchObject({ status: 'downloading', version: '1.0.0-beta.2' })
    service.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    // Checking again while it downloads doesn't start another.
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    pending.finish()
    await vi.waitFor(() => expect(service.state().status).toBe('ready'))
    expect(states.at(-1)).toMatchObject({ status: 'ready', version: '1.0.0-beta.2' })

    // Once it's ready there's nothing more to check for until Cue restarts.
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    service.install()
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledTimes(1))
  })

  it('fails quietly on its own, and says why when you asked', async () => {
    const offline = new Error('net::ERR_INTERNET_DISCONNECTED')
    const { service, updater, states } = setup(true, async () => {
      throw offline
    })
    vi.useFakeTimers()
    service.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(states.at(-1)).toMatchObject({ status: 'idle', message: null })

    vi.useRealTimers()
    expect(await service.check()).toMatchObject({
      status: 'error',
      message: 'Couldn’t reach GitHub to check for updates. Check your connection and try again.'
    })

    // The next check starts over.
    updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: { version: '1.0.0-beta.1' } })
    expect(await service.check()).toMatchObject({ status: 'idle', message: null })
  })

  it('goes back to waiting when a download fails, so the next check tries again', async () => {
    const pending = download()
    const { service, states } = setup(true, async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.0-beta.2' },
      downloadPromise: pending.promise
    }))
    await service.check()
    pending.fail(new Error('Code signature at URL … did not pass validation'))
    await vi.waitFor(() => expect(service.state().status).toBe('error'))
    expect(states.at(-1)).toMatchObject({ version: null, message: expect.stringContaining('usecue.today') })
  })

  it('tries loading the updater again after it failed to load', async () => {
    const { service, updater, load } = setup()
    load.mockRejectedValueOnce(new Error('Cannot find module'))
    expect(await service.check()).toMatchObject({ status: 'error' })
    expect(await service.check()).toMatchObject({ status: 'idle' })
    expect(load).toHaveBeenCalledTimes(2)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})

describe('updateMessage', () => {
  it('tells being offline apart from everything else, without the updater’s own words', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })
    expect(updateMessage(dns)).toMatch(/connection/)
    expect(updateMessage(new Error('net::ERR_NAME_NOT_RESOLVED'))).toMatch(/connection/)
    const other = updateMessage(new Error('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: Cannot find latest-mac.yml'))
    expect(other).toBe('Couldn’t update Cue. Try again later, or download the latest version from usecue.today.')
  })
})
