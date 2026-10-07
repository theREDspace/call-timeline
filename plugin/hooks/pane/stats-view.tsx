import type { RenderElement } from 'claude-code'

import type { StatsSort } from '../../types'
import { COLORS, duration, GLYPHS } from '../core/format'
import { visibleOf } from '../core/layout'
import { outLabel, statsOf } from '../core/stats'
import type { Kit } from './kit'
import { WIDE } from './timeline-view'
import type { PaneModel } from './model'

/** Per-name totals over what the timeline would show: the same filter, search and focus. */
export function StatsView({ ui, m, width }: { ui: Kit; m: PaneModel; width: number }): RenderElement {
  const { Box, Text } = ui
  const rows = statsOf(
    visibleOf(m.all, m.filter, m.query, [], m.focus).flatMap(r => (r.context || r.ev.kind === 'prompt' ? [] : [r.ev])),
    m.now,
    m.sort,
  )
  if (rows.length === 0) return <Text dimColor>{m.query || m.filter !== 'all' ? 'No calls match.' : 'No calls yet.'}</Text>

  // The numeric columns take 67 cells; names get the rest, up to 32, or 60 in a wide pane.
  const nameW = Math.max(12, Math.min(width >= WIDE ? 60 : 32, width - 67))
  const col = (w: number, label: string, key: StatsSort | '') => (
    <Box width={w}>
      <Text bold underline={key !== '' && key === m.sort}>
        {label}
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {col(nameW, 'Name', 'name')}
        {col(7, 'Calls', 'count')}
        {col(9, 'Total', 'total')}
        {col(9, 'Avg', '')}
        {col(9, 'P95', '')}
        {col(9, 'Max', 'max')}
        {col(10, 'Out', 'out')}
        {col(7, 'Errors', 'errors')}
        {col(7, 'Denied', '')}
      </Box>
      {rows.map(s => (
        <Box key={`${s.kind}:${s.name}`} flexDirection="row">
          <Box width={nameW}>
            <Text color={COLORS[s.kind]} wrap="truncate-end">
              {GLYPHS[s.kind]} {s.name}
            </Text>
          </Box>
          <Box width={7}><Text>{String(s.count)}</Text></Box>
          <Box width={9}><Text>{duration(s.total)}</Text></Box>
          <Box width={9}><Text dimColor>{duration(Math.round(s.total / s.count))}</Text></Box>
          <Box width={9}><Text dimColor>{duration(s.p95)}</Text></Box>
          <Box width={9}><Text>{duration(s.max)}</Text></Box>
          <Box width={10}><Text dimColor={!s.out}>{outLabel(s.kind, s.out)}</Text></Box>
          <Box width={7}>
            <Text color={s.errors ? 'red' : undefined} dimColor={!s.errors}>
              {String(s.errors)}
            </Text>
          </Box>
          <Box width={7}>
            <Text color={s.denied ? 'yellow' : undefined} dimColor={!s.denied}>
              {String(s.denied)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
