import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import { forSurface } from '../lib/theme'
import type { Theme } from '../lib/theme'
import { drawJevPane } from './pane'

// The Jev tab's drawing. What runs on a timer (reading the journal), /jev and opening
// the tab live in register.tsx: the engine takes one unmatched hook per event per
// module and never follows `$` into an imported function.

export const JEV_PANE = 'jev'

// The engine's scan accepts only an atom made in the same file: every file declares
// the values it reads or writes, with the same key and initial value as the others.
const jevA = atom({ plugin: 'mission-control', key: 'jev' } as const, null)

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerJev(on: On, theme: Theme): void {
  const c = theme.colors
  on('ui.render', { component: 'Pane', requestId: JEV_PANE }, async ($, e) => {
    const jev = await read($, jevA)
    return drawJevPane($.ui.resolve(e), { jev }, e.props.bodyColumns, e.props.scroll.bodyRows, forSurface(theme, e.surface))
  }).catch(($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={c.surface} paddingX={1}>
        <Text color={c.critical} bold>
          mission-control: вкладка «{theme.titles.jev}» упала
        </Text>
        <Text color={c.ink2} wrap="wrap">
          {reason(next.error)}
        </Text>
      </Box>
    )
  })
}
