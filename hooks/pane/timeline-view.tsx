import type { RenderElement } from 'claude-code'

import type { TimelineEvent } from '../../types'
import { tokensIn } from '../core/events'
import { BIG_OUTPUT, clock, COLORS, compact, duration, GLYPHS, plural } from '../core/format'
import { type Row, visibleOf } from '../core/layout'
import { loopLabel } from '../core/timeline'
import { OUTCOME_LABEL, ruler, type Turn, turnSummary, turnsOf, waterfall } from '../core/turns'
import type { PaneActions } from './controller'
import type { Kit } from './kit'
import type { PaneModel } from './model'

type Props = { ui: Kit; m: PaneModel; act: PaneActions }

/** Columns at which a call takes one line (detail beside its name) and the waterfall grows with the pane. */
export const WIDE = 140

/** Waterfall cells: up to 24 in a narrow pane, about a third of a wide one, never more than 80. */
const barWidth = (width: number) => (width >= WIDE ? Math.min(80, Math.round(width * 0.3)) : Math.max(8, Math.min(24, width - 50)))

/** Columns from which the open row's details move out of the list into a column beside it. */
const SPLIT = 180

/**
 * How the timeline splits a pane `width` across: the list, and beside it from SPLIT columns a details
 * column of about a third of the pane (60 to 100 cells), two cells apart.
 */
export function splitOf(width: number) {
  if (width < SPLIT) return { split: false, listW: width, panelW: 0 }
  const panelW = Math.max(60, Math.min(100, Math.round(width * 0.35)))
  return { split: true, listW: width - panelW - 2, panelW }
}

/** The row whose details are open: the cursor's, else the expanded one. */
const openId = (m: PaneModel) => m.selected || m.expanded

/** Every matching row, prompts as separators; the pane body scrolls over them. With `split`, rows open beside the list. */
export function TimelineView({ ui, m, act, width, split }: Props & { width: number; split: boolean }): RenderElement {
  const { Box, Text } = ui
  const shown = visibleOf(m.all, m.filter, m.query, m.fold, m.focus)
  const { byPrompt, turnOf } = turnsOf(m.all, m.now)
  const barMax = barWidth(width)
  const wide = width >= WIDE
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
      {shown.flatMap((row, i, arr) => {
        if (row.ev.kind === 'prompt') {
          const turn = byPrompt.get(row.ev.id)
          const head = PromptRow({ ui, m, act, ev: row.ev, turn, first: i === 0, split })
          // A wide pane has room for the turn's time axis above its bars.
          const next = arr[i + 1]
          if (!wide || !turn || !next || next.ev.kind === 'prompt') return [head]
          return [
            head,
            <Box key={`axis-${row.ev.id}`} flexDirection="row" gap={1}>
              <Box width={8} flexShrink={0} />
              <Box width={barMax} flexShrink={0} overflow="hidden">
                <Text dimColor>{ruler(turn.end - turn.start, barMax)}</Text>
              </Box>
            </Box>,
          ]
        }
        return [
          CallRow({
              ui,
              m,
              act,
              row,
              turn: turnOf.get(row.ev.id),
              barMax,
              wide,
              split,
              isLast: i === arr.length - 1,
              agentTok: row.ev.spawnedAgentId ? agentTokens.get(row.ev.spawnedAgentId) : undefined,
            }),
        ]
      })}
    </Box>
  )
}

/** A prompt: the separator heading its turn, with the turn's summary. */
function PromptRow({ ui, m, act, ev, turn, first, split }: Props & { ev: TimelineEvent; turn: Turn | undefined; first: boolean; split: boolean }) {
  const { Box, Text, Button } = ui
  const isOpen = split ? openId(m) === ev.id : m.expanded === ev.id
  const summary = turnSummary(ev, turn)
  const outcome = ev.outcome ? OUTCOME_LABEL[ev.outcome] : ''
  return (
    <Box key={ev.id} flexDirection="column" marginTop={first ? 0 : 1}>
      <Box flexDirection="row" gap={1}>
        <Box width={8} flexShrink={0}>
          <Text dimColor>{clock(ev.startedAt)}</Text>
        </Box>
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
        {turn && turn.problems > 0 && <Text color="red">· {plural(turn.problems, 'error')}</Text>}
        {outcome && <Text color={ev.outcome === 'aborted' ? 'yellow' : 'red'}>· {outcome}</Text>}
      </Box>
      {!split && isOpen && ev.args && <Text dimColor>{ev.args}</Text>}
    </Box>
  )
}

const statusText = (ev: TimelineEvent, ms: number) =>
  ev.status === 'running' ? `${duration(ms)}…` : ev.status === 'ok' ? duration(ms) : `${ev.status} · ${duration(ms)}`

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
  wide,
  split,
  isLast,
  agentTok,
}: Props & { row: Row; turn: Turn | undefined; barMax: number; wide: boolean; split: boolean; isLast: boolean; agentTok: number | undefined }) {
  const { Box, Text, Button } = ui
  const { ev, descendants, orphan, context, tree } = row
  const isOpen = split ? openId(m) === ev.id : m.expanded === ev.id
  // Split, the details are drawn beside the list rather than under the row.
  const inline = isOpen && !split
  const ms = (ev.endedAt ?? m.now) - ev.startedAt
  const bar = waterfall(ev, turn, m.now, barMax)

  return (
    <Box key={ev.id} flexDirection="row" gap={1}>
      {/* Fixed, clipped columns: the desktop pane draws digits and block glyphs at uneven widths. */}
      <Box width={8} flexShrink={0}>
        <Text dimColor>{clock(ev.startedAt)}</Text>
      </Box>
      <Box width={barMax} flexShrink={0} overflow="hidden">
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
          {wide && !inline && ev.detail && (
            <Box flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {ev.detail}
              </Text>
            </Box>
          )}
        </Box>
        {!wide && !inline && ev.detail && (
          <Text dimColor wrap="truncate-end">
            {ev.detail}
          </Text>
        )}
        {inline && (ev.kind === 'model' ? StepDetails({ ui, ev }) : CallDetails({ ui, m, act, ev }))}
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
  const chars = ev.outputChars ?? 0
  const big = ev.outputChars !== undefined && chars >= BIG_OUTPUT
  return [
    <Text key={`s-${ev.id}`} color={color} dimColor={!color}>
      {statusText(ev, ms)}
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
        label={m.fold.includes(ev.id) ? `+${plural(descendants, 'row')}` : `− ${plural(descendants, 'row')}`}
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

/**
 * The details column of a split pane, `rows` tall: the open row, or while none is, the latest call.
 * Drawn over the body's window by drawPane, so it stays in view as the list scrolls.
 */
export function DetailPanel({ ui, m, act, rows }: Props & { rows: number }): RenderElement {
  const { Box, Text } = ui
  const shown = visibleOf(m.all, m.filter, m.query, m.fold, m.focus)
  const open = openId(m)
  const picked = open ? m.all.find(ev => ev.id === open) : undefined
  const ev = picked ?? shown.findLast(r => r.ev.kind !== 'prompt')?.ev
  const frame = (body: RenderElement) => (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} height={rows} overflow="hidden">
      {body}
    </Box>
  )
  if (!ev) return frame(<Text dimColor>Select a row (j/k) to see its details here.</Text>)

  const ms = (ev.endedAt ?? m.now) - ev.startedAt
  const color = statusColor(ev)
  const head = (
    <Box flexDirection="row" gap={1}>
      <Text color={COLORS[ev.kind]}>{GLYPHS[ev.kind]}</Text>
      <Box flexShrink={1}>
        <Text bold color={ev.kind === 'prompt' ? undefined : COLORS[ev.kind]} wrap="truncate-end">
          {ev.name}
        </Text>
      </Box>
      {ev.kind !== 'prompt' && (
        <Text color={color} dimColor={!color}>
          {statusText(ev, ms)}
        </Text>
      )}
      <Text dimColor>· {clock(ev.startedAt)}</Text>
      {!picked && <Text dimColor>· latest, j/k to pick</Text>}
    </Box>
  )
  if (ev.kind === 'prompt') {
    const summary = turnSummary(ev, turnsOf(m.all, m.now).byPrompt.get(ev.id))
    return frame(
      <Box flexDirection="column" gap={1}>
        {head}
        {summary && <Text dimColor>{summary}</Text>}
        <Text>{ev.args || ev.name}</Text>
      </Box>,
    )
  }
  return frame(
    <Box flexDirection="column">
      {head}
      {ev.kind === 'model' ? StepDetails({ ui, ev }) : [<Text key={`d-${ev.id}`} dimColor>{ev.detail}</Text>, CallDetails({ ui, m, act, ev })]}
    </Box>,
  )
}
