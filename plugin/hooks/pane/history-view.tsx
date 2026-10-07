import type { RenderElement } from 'claude-code'

import { day, usd } from '../core/format'
import { HISTORY_MAX } from '../services/history'
import type { PaneActions } from './controller'
import type { Kit } from './kit'
import type { PaneModel } from './model'

/** The list of saved sessions, newest first; a session's date opens it. */
export function HistoryView({ ui, m, act, width, current }: { ui: Kit; m: PaneModel; act: PaneActions; width: number; current: string }): RenderElement {
  const { Box, Text, Button } = ui
  if (m.sessions.length === 0) {
    return <Text dimColor>No saved sessions yet. Each session is saved after every turn; the last {HISTORY_MAX} are kept.</Text>
  }
  const titleW = Math.max(16, width - 48)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box width={18}><Text bold>Started</Text></Box>
        <Box width={titleW}><Text bold>First prompt</Text></Box>
        <Box width={8}><Text bold>Calls</Text></Box>
        <Box width={8}><Text bold>Errors</Text></Box>
        <Box width={9}><Text bold>Cost</Text></Box>
      </Box>
      {m.sessions.map(s => (
        <Box key={s.id} flexDirection="row">
          <Box width={18}>
            <Button key={`t-${s.id}`} plain label={day(s.startedAt)} onPress={() => act.openSession(s.id)} />
          </Box>
          <Box width={titleW}>
            <Text inverse={m.selected === s.id} bold={s.id === current} wrap="truncate-end">
              {s.id === current ? `${s.title} (this session)` : s.title}
            </Text>
          </Box>
          <Box width={8}><Text>{String(s.calls)}</Text></Box>
          <Box width={8}>
            <Text color={s.problems ? 'red' : undefined} dimColor={!s.problems}>
              {String(s.problems)}
            </Text>
          </Box>
          <Box width={9}><Text dimColor>{s.costUsd !== undefined ? usd(s.costUsd) : '—'}</Text></Box>
        </Box>
      ))}
    </Box>
  )
}
