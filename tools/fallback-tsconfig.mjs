// Prints a tsconfig that type-checks the mod before any session has loaded it (the
// engine lays .claude-plugin/types/ beside a mod only when it loads it): the
// engine's own compiler options, the given claude-code.d.ts included by path.
import { resolve } from 'node:path'

const [types, mod] = process.argv.slice(2)
if (types === undefined || mod === undefined) {
  console.error('usage: node tools/fallback-tsconfig.mjs <claude-code.d.ts> <mod folder>')
  process.exit(2)
}
const abs = path => resolve(path).replaceAll('\\', '/')
const config = {
  compilerOptions: {
    target: 'es2023',
    lib: ['es2023'],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
    types: [],
  },
  include: [abs(types), abs(`${mod}/hooks`), abs(`${mod}/types`), abs(`${mod}/tests`)],
}
console.log(JSON.stringify(config, null, 2))
