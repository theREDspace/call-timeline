import type { RenderElement } from 'claude-code'

import type { PaneActions } from './controller'
import { Header } from './header'
import { HistoryView } from './history-view'
import type { Kit } from './kit'
import type { PaneModel } from './model'
import { StatsView } from './stats-view'
import { DetailPanel, splitOf, TimelineView } from './timeline-view'

/**
 * The whole pane: the header, then the view it is on. `current` is this session's id, which History marks.
 * A wide timeline puts the open row's details in a column on the right, drawn at the body's scroll
 * `offset` and `rows` tall so it stays in view while the list (and header) scroll beneath.
 */
export function drawPane({
  ui,
  m,
  act,
  width,
  current,
  offset = 0,
  rows = 40,
}: {
  ui: Kit
  m: PaneModel
  act: PaneActions
  width: number
  current: string
  offset?: number
  rows?: number
}): RenderElement {
  const { Box } = ui
  const { split, listW, panelW } = m.view === 'timeline' ? splitOf(width) : splitOf(0)
  const body =
    m.view === 'history'
      ? HistoryView({ ui, m, act, width, current })
      : m.view === 'stats'
        ? StatsView({ ui, m, width })
        : TimelineView({ ui, m, act, width: listW, split })
  const main = (
    <Box flexDirection="column" gap={1} width={split ? listW : undefined}>
      {Header({ ui, m, act, width: split ? listW : width })}
      {body}
    </Box>
  )
  if (!split) return main
  return (
    <Box>
      {main}
      <Box position="absolute" top={offset} left={listW + 2} width={panelW}>
        {DetailPanel({ ui, m, act, rows })}
      </Box>
    </Box>
  )
}
