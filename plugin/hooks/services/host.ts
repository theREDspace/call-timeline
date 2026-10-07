import type { EngineInterface, SessionUsage, UiPressArgument } from 'claude-code'

import type { Archive, Filter, SessionSummary, StatsSort, TimelineEvent, View } from '../../types'

/**
 * The port between the plugin's logic and the engine: everything the recorder, history, export and the
 * pane controller need from outside, as plain functions. `register.tsx` builds the one real Host from a
 * hook's `$` (the engine reads every `$` call and state key off that file); tests can build their own.
 */

/** One value in the session's state: read it, or apply a change and get the new value back. */
export type Cell<T> = { get: () => Promise<T>; set: (fn: (cur: T) => T) => Promise<T> }

export type HostState = {
  /** The live timeline. */
  events: Cell<TimelineEvent[]>
  /** What the last Clear removed, for Undo. */
  cleared: Cell<TimelineEvent[]>
  filter: Cell<Filter>
  view: Cell<View>
  selected: Cell<string>
  expanded: Cell<string>
  query: Cell<string>
  follow: Cell<boolean>
  confirmClearAt: Cell<number>
  collapsed: Cell<string[]>
  statsSort: Cell<StatsSort>
  history: Cell<SessionSummary[]>
  archive: Cell<Archive | null>
  sessionCost: Cell<number>
  focused: Cell<string>
}

/** Where the pane scrolls to: its top, its end, or the element with a key. */
export type ScrollTarget = 'start' | 'end' | { key: string }

export type Host = HostState & {
  now: () => Promise<number>
  /** Runs `fn` once, `ms` from now. */
  after: (ms: number, fn: () => void) => void
  sessionId: () => Promise<string>
  cwd: () => Promise<string>
  usage: () => Promise<SessionUsage>
  /** Connected MCP servers' display names, by the server segment of their tools' wire names. */
  mcpServers: () => Promise<Record<string, string>>
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  writeFile: (path: string, text: string) => Promise<void>
  status: (text: string | undefined) => void
  toast: (text: string, timeoutMs: number) => void
  /** Scrolls the timeline pane. */
  scroll: (to: ScrollTarget) => Promise<unknown>
  copy: (text: string, surface: UiPressArgument['surface']) => ReturnType<EngineInterface['ui']['copy']>
  /** Puts the cursor in the pane's search field. */
  focusSearch: () => void
}
