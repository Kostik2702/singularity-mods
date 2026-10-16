// The slate's awakening: for a few seconds after the session starts (or the mod reloads),
// the band above the prompt plays the cogitator's boot. When it began is a module value
// every file of the module shares; a reload starts it over, as a reload is a waking too.

/** How long the band plays the awakening. */
export const BOOT_MS = 4500
/** Each step of the boot log shows this long after the one before. */
export const BOOT_STEP_MS = 600
/** When the blessing replaces the gauge. */
export const BOOT_BLESS_MS = 3300

let bootAt: number | null = null

/** The awakening begins now. */
export function markBoot(now: number): void {
  bootAt = now
}

/** Milliseconds into the awakening at `now`, or null when none is playing. */
export function bootElapsed(now: number): number | null {
  if (bootAt === null) return null
  const t = now - bootAt
  return t >= 0 && t < BOOT_MS ? t : null
}
