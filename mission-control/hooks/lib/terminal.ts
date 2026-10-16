import type { EngineInterface } from 'claude-code'

import { parsePixmap } from './pixmap'
import type { Pixmap } from './pixmap'

/**
 * Set once the engine said it draws a picture's alt here (a blit refused for it): the
 * terminal was taken for one that draws pictures and is not, so the slate goes back to
 * its cells. A module value: a reload looks again.
 */
let picturesRefused = false

/** The engine draws a picture's alt here: no more pictures this load. */
export function refusePictures(): void {
  picturesRefused = true
}

/** Does a blit's refusal say the engine draws the Image's alt here (no kitty graphics)? */
export function saysAlt(deny: string | undefined): boolean {
  return deny !== undefined && /\balt\b|placeholder/i.test(deny)
}

/**
 * Whether the terminal draws pictures: the engine draws an Image only through kitty graphics
 * with Unicode placeholders, which Ghostty and kitty have. WezTerm has kitty graphics but no
 * placeholders, so it is not one: taken for one, its Legion showed the Image's empty alt
 * whenever the one probe after a start met another tab on screen. Anywhere else an Image
 * draws its alt, so the slate draws its pictures in cells. False when the environment
 * cannot be read, or once the engine refused a picture here. Shared by the tabs; `$` is
 * followed into a function a file of the module's own exports.
 */
export async function drawsPictures($: EngineInterface): Promise<boolean> {
  if (picturesRefused) return false
  try {
    return /ghostty|kitty/i.test(`${(await $.env.get('TERM_PROGRAM')) ?? ''} ${(await $.env.get('TERM')) ?? ''}`)
  } catch {
    return false
  }
}

/**
 * The ranks' portraits in `dir` by slug (`inquisitor.png` → inquisitor), so a rank with
 * no picture keeps its plain card. Empty when the folder cannot be read.
 */
export async function listPortraits($: EngineInterface, dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.png')) continue
      found[entry.name.slice(0, -'.png'.length)] = `${dir.replace(/[\\/]+$/, '')}/${entry.name}`
    }
  } catch {
    // no folder (yet): no portraits
  }
  return found
}

/** Pixmaps read so far, by the picture's path: a pixmap does not change while the mod runs. */
const pixmaps = new Map<string, Pixmap | null>()

/**
 * The pixmap beside a picture (`x.png` → `x.pix.json`, made by tools/make-art.py), for
 * the terminals that draw no pictures; null when there is none.
 */
export async function loadPixmap($: EngineInterface, png: string): Promise<Pixmap | null> {
  const known = pixmaps.get(png)
  if (known !== undefined) return known
  let found: Pixmap | null = null
  try {
    const text = await $.fs.read(png.replace(/\.png$/i, '.pix.json'))
    found = typeof text === 'string' ? parsePixmap(text) : null
  } catch {
    found = null
  }
  pixmaps.set(png, found)
  return found
}
