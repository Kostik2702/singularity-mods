// A plain painter for a drawn tree: lays Boxes and Texts out into rows of cells the
// way the terminal does for the trees this mod draws (a Text is one row, a column Box
// stacks, a row Box sets side by side, a Box's width pads, margins and paddings add).
// A row wider than an unclipped Box is left wider, so an overflow shows. Enough to hold
// a slate's frames to exact widths and to look at a tab in a test;
// never a stand-in for the live paint (tools/drive-tui).
import type { RenderNode } from 'claude-code'

type Node = { type: string; props?: Record<string, unknown>; children?: readonly RenderNode[] }

function text(node: RenderNode | Node): string {
  if (typeof node === 'string') return node
  return ((node as Node).children ?? []).map(text).join('')
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

/** Pads a row to `width`; cuts it only where the Box clips (`overflow: hidden`), as Ink does. */
function pad(line: string, width: number, clips: boolean): string {
  const n = [...line].length
  if (n >= width) return clips ? [...line].slice(0, width).join('') : line
  return line + ' '.repeat(width - n)
}

/** A Raster's cells as the glyphs they hold, row by row (colours dropped). */
function rasterRows(p: Record<string, unknown>): string[] {
  const columns = num(p.columns)
  const rows = num(p.rows)
  const bin = atob(String(p.cells ?? ''))
  const word = (i: number): number =>
    (bin.charCodeAt(i * 4) | (bin.charCodeAt(i * 4 + 1) << 8) | (bin.charCodeAt(i * 4 + 2) << 16) | (bin.charCodeAt(i * 4 + 3) << 24)) >>> 0
  const out: string[] = []
  for (let r = 0; r < rows; r += 1) {
    let line = ''
    for (let c = 0; c < columns; c += 1) line += String.fromCodePoint(word((r * columns + c) * 3))
    out.push(line)
  }
  return out
}

/** The rows a node paints, each a string of cells. */
export function paint(node: RenderNode): string[] {
  if (typeof node === 'string') return [node]
  const n = node as Node
  if (n.type === 'Text') return [text(n)]
  if (n.type === 'engine') return ['<engine>']
  if (n.type === 'Raster') return rasterRows(n.props ?? {})
  if (n.type === 'Image') {
    const p = n.props ?? {}
    const columns = num(p.columns)
    return Array.from({ length: num(p.rows) }, () => '▒'.repeat(columns))
  }
  if (n.type !== 'Box') return [`<${n.type}>`]
  const p = n.props ?? {}
  if (p.display === 'none') return []
  const kids = (n.children ?? []).filter(k => k !== '')
  const isRow = p.flexDirection !== 'column'
  let rows: string[]
  if (isRow) {
    const parts = kids.map(paint)
    const height = Math.max(0, ...parts.map(x => x.length))
    rows = []
    for (let i = 0; i < height; i += 1) {
      rows.push(
        parts
          .map(part => {
            const widest = Math.max(0, ...part.map(r => [...r].length))
            return pad(part[i] ?? '', widest, false)
          })
          .join(''),
      )
    }
  } else {
    rows = kids.flatMap(paint)
  }
  const left = num(p.paddingX) + num(p.paddingLeft) + num(p.padding)
  rows = rows.map(r => ' '.repeat(left) + r)
  if (typeof p.width === 'number') rows = rows.map(r => pad(r, p.width as number, p.overflow === 'hidden'))
  const top = num(p.marginTop) + num(p.marginY) + num(p.paddingTop) + num(p.paddingY)
  return [...Array.from({ length: top }, () => (typeof p.width === 'number' ? ' '.repeat(p.width) : '')), ...rows]
}

/** The painted rows joined, trailing spaces trimmed: what to print or match. */
export function screen(node: RenderNode): string {
  return paint(node)
    .map(r => r.replace(/\s+$/, ''))
    .join('\n')
}
