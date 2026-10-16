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
