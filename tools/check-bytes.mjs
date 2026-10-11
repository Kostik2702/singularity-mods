// Fails when a text file holds a raw control byte (other than tab, LF, CR) or a BOM.
// The Edit/Write boundary has put U+0000 into source before (TKH-094), and no
// compiler, linter or test of this repo would notice it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const TEXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.sh'])

function* walk(path) {
  if (statSync(path).isFile()) {
    yield path
    return
  }
  for (const name of readdirSync(path)) {
    if (name === '.git' || name === 'node_modules' || name === '.tmp') continue
    const child = join(path, name)
    if (child.replaceAll('\\', '/').endsWith('.claude-plugin/types')) continue
    yield* walk(child)
  }
}

let files = 0
let bad = 0
for (const root of process.argv.slice(2)) {
  for (const file of walk(root)) {
    if (!TEXT.has(extname(file))) continue
    files += 1
    const text = readFileSync(file, 'utf8')
    if (text.charCodeAt(0) === 0xfeff) {
      console.log(`${file}: BOM`)
      bad += 1
    }
    text.split('\n').forEach((line, i) => {
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 0
        if (code < 32 && code !== 9 && code !== 13) {
          console.log(`${file}:${i + 1}: control byte U+${code.toString(16).padStart(4, '0')}`)
          bad += 1
        }
      }
    })
  }
}
console.log(`check-bytes: ${files} files, ${bad} problems`)
process.exit(bad === 0 ? 0 : 1)
