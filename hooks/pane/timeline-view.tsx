import type { RenderElement } from 'claude-code'

import type { TimelineEvent } from '../../types'
import { tokensIn } from '../core/events'
import { BIG_OUTPUT, clock, COLORS, compact, duration, GLYPHS } from '../core/format'
import { type Row, visibleOf } from '../core/layout'
import { loopLabel } from '../core/timeline'
import { OUTCOME_LABEL, type Turn, turnSummary, turnsOf, waterfall } from '../core/turns'
import type { PaneActions } from './controller'
import type { Kit } from './kit'
import type { PaneModel } from './model'

type Props = { ui: Kit; m: PaneModel; act: PaneActions }

/** Every matching row, prompts as separators; the pane body scrolls over them. */
export function TimelineView({ ui, m, act, width }: Props & { width: number }): RenderElement {
  const { Box, Text } = ui
  const shown = visibleOf(m.all, m.filter, m.query, m.fold, m.focus)
  const { byPrompt, turnOf } = turnsOf(m.all, m.now)
  const barMax = Math.max(8, Math.min(24, width - 50))
  // Tokens each subagent's steps used, shown on the Agent row that started it.
  const agentTokens = new Map<string, number>()
  for (const ev of m.steps) if (ev.agentId && ev.tokens) agentTokens.set(ev.agentId, (agentTokens.get(ev.agentId) ?? 0) + tokensIn(ev.tokens) + ev.tokens.output)

  return (
    <Box flexDirection="column">
      {shown.length === 0 && (
        <Text dimColor>
          {m.query ? `Nothing matches “${m.query}”.` : m.filter === 'errors' ? 'No errors.' : 'Nothing yet. Calls appear here as they happen.'}
        </Text>
      )}
      {shown.map((row, i, arr) =>
        row.ev.kind === 'prompt'
          ? PromptRow({ ui, m, act, ev: row.ev, turn: byPrompt.get(row.ev.id), first: i === 0 })
          : CallRow({
              ui,
              m,
              act,
              row,
              turn: turnOf.get(row.ev.id),
              barMax,
              isLast: i === arr.length - 1,
              agentTok: row.ev.spawnedAgentId ? agentTokens.get(row.ev.spawnedAgentId) : undefined,
            }),
      )}
    </Box>
  )
}

/** A prompt: the separator heading its turn, with the turn's summary. */
function PromptRow({ ui, m, act, ev, turn, first }: Props & { ev: TimelineEvent; turn: Turn | undefined; first: boolean }) {
  const { Box, Text, Button } = ui
  const isOpen = m.expanded === ev.id
  const summary = turnSummary(ev, turn)
  const outcome = ev.outcome ? OUTCOME_LABEL[ev.outcome] : ''
  return (
    <Box key={ev.id} flexDirection="column" marginTop={first ? 0 : 1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{clock(ev.startedAt)}</Text>
        <Button key={`t-${ev.id}`} plain label={isOpen ? '▾' : '▸'} onPress={() => act.toggleOpen(ev.id)} />
        <Box flexShrink={1}>
          <Text bold inverse={m.selected === ev.id} wrap="truncate-end">
            {ev.name}
          </Text>
        </Box>
        {summary && (
          <Text color={ev.status === 'running' ? 'green' : undefined} dimColor={ev.status !== 'running'}>
            {summary}
          </Text>
        )}
        {turn && turn.problems > 0 && <Text color="red">· {turn.problems} errors</Text>}
        {outcome && <Text color={ev.outcome === 'aborted' ? 'yellow' : 'red'}>· {outcome}</Text>}
      </Box>
      {isOpen && ev.args && <Text dimColor>{ev.args}</Text>}
    </Box>
  )
}

const statusColor = (ev: TimelineEvent) =>
  ev.status === 'error' ? 'red' : ev.status === 'denied' || ev.status === 'aborted' ? 'yellow' : ev.status === 'running' ? 'green' : undefined

/** A call or model step: time, waterfall bar, tree connectors, glyph, name, status and tags, and its details when open. */
function CallRow({
  ui,
  m,
  act,
  row,
  turn,
  barMax,
  isLast,
  agentTok,
}: Props & { row: Row; turn: Turn | undefined; barMax: number; isLast: boolean; agentTok: number | undefined }) {
  const { Box, Text, Button } = ui
  const { ev, descendants, orphan, context, tree } = row
  const isOpen = m.expanded === ev.id
  const ms = (ev.endedAt ?? m.now) - ev.startedAt
  const bar = waterfall(ev, turn, m.now, barMax)

  return (
    <Box key={ev.id} flexDirection="row" gap={1}>
      <Text dimColor>{clock(ev.startedAt)}</Text>
      <Box width={barMax} flexShrink={0}>
        <Text dimColor>{'·'.repeat(bar.lead)}</Text>
        {bar.wait > 0 && <Text color={COLORS[ev.kind]}>{'░'.repeat(bar.wait)}</Text>}
        {bar.run > 0 && <Text color={COLORS[ev.kind]}>{'▇'.repeat(bar.run)}</Text>}
      </Box>
      <Box flexDirection="row" flexShrink={0}>
        {tree && (
          <Text color={COLORS.agent} dimColor>
            {tree}
          </Text>
        )}
        <Text color={COLORS[ev.kind]} dimColor={context}>
          {GLYPHS[ev.kind]}
        </Text>
      </Box>
      <Text dimColor>{isLast ? ' ' : '│'}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" gap={1}>
          <Button key={`t-${ev.id}`} plain label={isOpen ? '▾' : '▸'} onPress={() => act.toggleOpen(ev.id)} />
          <Text bold={!context} inverse={m.selected === ev.id} color={COLORS[ev.kind]} dimColor={context} wrap="truncate">
            {ev.name}
          </Text>
          {CallTags({ ui, m, act, ev, ms, descendants, orphan, agentTok })}
        </Box>
        {!isOpen && ev.detail && (
          <Text dimColor wrap="truncate-end">
            {ev.detail}
          </Text>
        )}
        {isOpen && (ev.kind === 'model' ? StepDetails({ ui, ev }) : CallDetails({ ui, m, act, ev }))}
      </Box>
    </Box>
  )
}

/** What follows a call's name: status and duration, repeats, output size, subagent tokens, group and focus buttons, owner. */
function CallTags({
  ui,
  m,
  act,
  ev,
  ms,
  descendants,
  orphan,
  agentTok,
}: Props & { ev: TimelineEvent; ms: number; descendants: number; orphan: boolean; agentTok: number | undefined }) {
  const { Text, Button } = ui
  const color = statusColor(ev)
  const statusText = ev.status === 'running' ? `${duration(ms)}…` : ev.status === 'ok' ? duration(ms) : `${ev.status} · ${duration(ms)}`
  const chars = ev.outputChars ?? 0
  const big = ev.outputChars !== undefined && chars >= BIG_OUTPUT
  return [
    <Text key={`s-${ev.id}`} color={color} dimColor={!color}>
      {statusText}
    </Text>,
    ev.repeat !== undefined && (
      <Text key={`r-${ev.id}`} color={ev.status === 'error' ? 'red' : 'yellow'}>
        ↻{ev.repeat}
      </Text>
    ),
    big && (
      <Text key={`o-${ev.id}`} color={chars >= BIG_OUTPUT * 10 ? 'yellow' : undefined} dimColor={chars < BIG_OUTPUT * 10}>
        · {compact(chars)} ch
      </Text>
    ),
    agentTok !== undefined && (
      <Text key={`k-${ev.id}`} dimColor>
        · {compact(agentTok)} tok
      </Text>
    ),
    ev.spawnedAgentId && descendants > 0 && (
      <Button
        key={`g-${ev.id}`}
        plain
        dimColor
        label={m.fold.includes(ev.id) ? `+${descendants} rows` : `− ${descendants} rows`}
        onPress={() => act.toggleFold(ev.id)}
      />
    ),
    ev.spawnedAgentId && ev.id !== m.focus && (
      <Button key={`i-${ev.id}`} plain dimColor label="⊙ focus" onPress={() => act.toggleFocus(ev.id)} />
    ),
    orphan && (
      <Text key={`a-${ev.id}`} color={COLORS.agent} dimColor>
        (subagent {loopLabel(ev)})
      </Text>
    ),
  ]
}

/** An open model step: timing to first token and generation, token breakdown, any failure. */
function StepDetails({ ui, ev }: { ui: Kit; ev: TimelineEvent }) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={1}>
      <Text dimColor>{ev.detail}</Text>
      {ev.firstAt !== undefined && (
        <Text dimColor>
          first token after {duration(ev.firstAt - ev.startedAt)}
          {ev.endedAt !== undefined ? ` · generated for ${duration(ev.endedAt - ev.firstAt)}` : ''}
        </Text>
      )}
      {ev.tokens && (
        <Text dimColor>
          {ev.tokens.input} uncached · {ev.tokens.cacheRead} cache read · {ev.tokens.cacheWrite} cache write · {ev.tokens.output} out
        </Text>
      )}
      {ev.output && <Text color="red">{ev.output}</Text>}
    </Box>
  )
}

/** An open call: its arguments (copyable) and the head of its result. History keeps neither. */
function CallDetails({ ui, m, act, ev }: Props & { ev: TimelineEvent }) {
  const { Box, Text, Button, Code } = ui
  return (
    <Box flexDirection="column" paddingLeft={2} marginY={1} gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text dimColor>Arguments</Text>
        <Button key={`c-${ev.id}`} plain dimColor label="⧉ copy" onPress={press => act.copy(press, ev.id)} />
      </Box>
      {ev.args ? <Code source={ev.args} language="json" wrap="wrap" /> : <Text dimColor>{m.past ? '(not kept in history)' : '{}'}</Text>}
      <Text dimColor>
        {ev.status === 'running' ? 'Result (pending)' : 'Result'}
        {ev.outputChars !== undefined ? ` · ${compact(ev.outputChars)} chars` : ''}
      </Text>
      {ev.output ? (
        <Text color={ev.status === 'error' ? 'red' : undefined}>{ev.output}</Text>
      ) : (
        <Text dimColor>{m.past ? '(not kept in history)' : '—'}</Text>
      )}
    </Box>
  )
}
