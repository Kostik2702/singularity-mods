import type { EngineInterface } from 'claude-code'

/**
 * Whether the terminal draws pictures (kitty graphics: Ghostty and kitty); anywhere else
 * an Image draws its alt, so the slate keeps its glyph art. False when the environment
 * cannot be read. Shared by the tabs; `$` is followed into a function a file of the
 * module's own exports.
 */
export async function drawsPictures($: EngineInterface): Promise<boolean> {
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
