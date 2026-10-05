import type { RenderElement } from 'claude-code'

import type { PaneActions } from './controller'
import { Header } from './header'
import { HistoryView } from './history-view'
import type { Kit } from './kit'
import type { PaneModel } from './model'
import { StatsView } from './stats-view'
import { TimelineView } from './timeline-view'

/** The whole pane: the header, then the view it is on. `current` is this session's id, which History marks. */
export function drawPane({ ui, m, act, width, current }: { ui: Kit; m: PaneModel; act: PaneActions; width: number; current: string }): RenderElement {
  const { Box } = ui
  const body =
    m.view === 'history'
      ? HistoryView({ ui, m, act, width, current })
      : m.view === 'stats'
        ? StatsView({ ui, m, width })
        : TimelineView({ ui, m, act, width })
  return (
    <Box flexDirection="column" gap={1}>
      {Header({ ui, m, act })}
      {body}
    </Box>
  )
}
