/**
 * Hybrid logical clock.
 *
 * Versions look like `0mgf3k2x1c-0000-a1b2c3d4e5f6` (wall-clock ms in base 36,
 * a counter, and the device id), are fixed width, and compare correctly as plain
 * strings. They track wall time closely, never go backwards on a device even if the
 * system clock does, always exceed any version this device has already seen, and
 * never tie across devices (the device id breaks ties). That makes item-level
 * last-write-wins deterministic on every replica.
 */

const WALL_WIDTH = 10
const COUNTER_WIDTH = 4
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1

export interface HLCState {
  wall: number
  counter: number
}

export function formatVersion(wall: number, counter: number, node: string): string {
  return `${wall.toString(36).padStart(WALL_WIDTH, '0')}-${counter.toString(36).padStart(COUNTER_WIDTH, '0')}-${node}`
}

export function parseVersion(version: string): { wall: number; counter: number; node: string } | null {
  const m = /^([0-9a-z]{10})-([0-9a-z]{4})-([0-9a-z]+)$/.exec(version)
  if (!m) return null
  return { wall: parseInt(m[1], 36), counter: parseInt(m[2], 36), node: m[3] }
}

export class HybridLogicalClock {
  private wall = 0
  private counter = 0

  constructor(
    readonly node: string,
    private readonly clock: () => number = Date.now
  ) {
    if (!/^[0-9a-z]+$/.test(node)) throw new Error('HLC node id must be lowercase alphanumeric')
  }

  /** Advance past a version that is already stored (e.g. at startup). */
  observe(version: string | null | undefined): void {
    if (!version) return
    const parsed = parseVersion(version)
    if (!parsed) return
    if (parsed.wall > this.wall || (parsed.wall === this.wall && parsed.counter > this.counter)) {
      this.wall = parsed.wall
      this.counter = parsed.counter
    }
  }

  /** A fresh version for a local write. */
  now(): string {
    const physical = this.clock()
    if (physical > this.wall) {
      this.wall = physical
      this.counter = 0
    } else {
      this.counter += 1
      if (this.counter > MAX_COUNTER) {
        this.wall += 1
        this.counter = 0
      }
    }
    return formatVersion(this.wall, this.counter, this.node)
  }

  /** Merge a version received from another device. */
  receive(version: string): void {
    this.observe(version)
  }

  state(): HLCState {
    return { wall: this.wall, counter: this.counter }
  }
}
