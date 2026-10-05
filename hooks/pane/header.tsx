import type { ButtonProps } from 'claude-code'

import type { Filter, View } from '../../types'
import { COLORS, compact, GLYPHS, usd } from '../core/format'
import type { PaneActions } from './controller'
import type { Kit } from './kit'
import type { PaneModel } from './model'

/** The pane's header: past-session and focus banners, view tabs, filters, search, summary and key hints. */
export function Header({ ui, m, act }: { ui: Kit; m: PaneModel; act: PaneActions }) {
  const { Box, Text, Button, Input } = ui
  const { past, focusEv, view: v, filter: f } = m

  // Filters are light toggles: the active one bracketed and at full strength, the rest dim.
  const chip = (value: Filter, label: string, hotkey: string) => (
    <Button
      key={`f-${value}`}
      plain
      label={f === value ? `[${label}]` : label}
      hotkey={hotkey}
      dimColor={f !== value}
      onPress={() => act.setFilter(value)}
    />
  )
  const viewTab = (value: View, label: string, hotkey: string | undefined, onPress: () => unknown) => (
    <Button key={`v-${value}`} label={label} hotkey={hotkey} variant={v === value ? 'primary' : 'secondary'} onPress={onPress} />
  )
  const keyHint = (key: string, label: string, hotkey: string, onPress: ButtonProps['onPress']) => (
    <Button key={key} plain dimColor label={label} hotkey={hotkey} onPress={onPress} />
  )

  const summaryLine = [
    `${m.calls} calls`,
    m.steps.length ? `${m.steps.length} steps` : '',
    `${m.running} running`,
    `${m.problems} errors`,
    m.tokTotal ? `${compact(m.tokTotal)} tok` : '',
    !past && m.cost ? usd(m.cost) : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Box flexDirection="column" gap={1}>
      {past && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color="yellow" bold>
            Past session:
          </Text>
          <Box flexShrink={1}>
            <Text color="yellow" wrap="truncate-end">
              {past.title}
            </Text>
          </Box>
          <Button key="live" label="Back to live" hotkey="v" onPress={act.goLive} />
        </Box>
      )}
      {focusEv && v !== 'history' && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={COLORS.agent} bold>
            Focused: {GLYPHS.agent} {focusEv.name}
          </Text>
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {focusEv.detail}
            </Text>
          </Box>
          <Button key="unfocus" label="Show all" hotkey="i" onPress={() => act.toggleFocus()} />
        </Box>
      )}
      {/* Which view, and what to do with it. */}
      <Box flexDirection="row" gap={2} flexWrap="wrap" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" gap={1}>
          {viewTab('timeline', 'Timeline', undefined, act.showTimeline)}
          {viewTab('stats', 'Stats', 'x', act.toggleStats)}
          {viewTab('history', 'History', 'h', act.toggleHistory)}
        </Box>
        <Box flexDirection="row" gap={2}>
          {keyHint('export', 'export', 'w', act.exportShown)}
          {!past &&
            (m.confirming ? (
              <Button key="clear" plain label="clear? press c again" hotkey="c" onPress={act.clear} />
            ) : (
              keyHint('clear', 'clear', 'c', act.clear)
            ))}
          {!past && m.undoCount > 0 && keyHint('undo', `undo clear (${m.undoCount})`, 'u', act.undoClear)}
        </Box>
      </Box>
      {/* What the view shows. */}
      {v !== 'history' && (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text dimColor>Show</Text>
            {chip('all', 'All', 'a')}
            {chip('skills', 'Skills', 's')}
            {chip('tools', 'Tools', 't')}
            {chip('mcp', 'MCP', 'm')}
            {chip('model', 'Model', 'l')}
            {chip('errors', m.problems ? `Errors (${m.problems})` : 'Errors', 'e')}
          </Box>
          {Input && (
            <Input
              key="search"
              label="Find: "
              placeholder="name, args or output (f)"
              value={m.query}
              submitLabel="done"
              onInput={value => void act.setQuery(value)}
              onSubmit={value => void act.setQuery(value)}
            />
          )}
        </Box>
      )}
      {/* Where you are, and how to move. */}
      <Box flexDirection="column">
        {v !== 'history' && <Text>{summaryLine}</Text>}
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {v !== 'stats' && [
            keyHint('k-next', 'next', 'j', () => act.move(1)),
            keyHint('k-prev', 'prev', 'k', () => act.move(-1)),
            keyHint('k-open', 'open', 'o', () => act.toggleOpen()),
          ]}
          {v === 'timeline' && [
            keyHint('k-fold', 'fold', 'z', () => act.toggleFold()),
            !focusEv && keyHint('k-focus', 'focus', 'i', () => act.toggleFocus()),
            keyHint('k-copy', 'copy', 'y', press => act.copy(press)),
            keyHint('k-top', 'top', 'g', act.jumpTop),
            keyHint('k-end', 'end', 'b', act.jumpEnd),
          ]}
          {v === 'stats' && keyHint('k-sort', `sort: ${m.sort}`, 'r', act.cycleSort)}
          {Input && v !== 'history' && keyHint('k-find', 'find', 'f', act.focusSearch)}
        </Box>
      </Box>
    </Box>
  )
}
