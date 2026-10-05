import type { SessionUsage } from 'claude-code'

import type { Cell, Host, ScrollTarget } from '../hooks/services/host'
import type { Archive, Filter, SessionSummary, StatsSort, TimelineEvent, View } from '../types'

/** A Host answered from memory, for testing the services and the pane controller without an engine. */
export function fakeHost(opts: { now?: number; sessionId?: string; cost?: number; percent?: number; cwd?: string } = {}) {
  const cell = <T>(initial: T): Cell<T> & { value: T } => {
    const c = {
      value: initial,
      get: async () => c.value,
      set: async (fn: (cur: T) => T) => (c.value = fn(c.value)),
    }
    return c
  }
  const state = {
    events: cell<TimelineEvent[]>([]),
    cleared: cell<TimelineEvent[]>([]),
    filter: cell<Filter>('all'),
    view: cell<View>('timeline'),
    selected: cell(''),
    expanded: cell(''),
    query: cell(''),
    follow: cell(true),
    confirmClearAt: cell(0),
    collapsed: cell<string[]>([]),
    statsSort: cell<StatsSort>('total'),
    history: cell<SessionSummary[]>([]),
    archive: cell<Archive | null>(null),
    sessionCost: cell(0),
    focused: cell(''),
  }
  const store = new Map<string, unknown>()
  const files = new Map<string, string>()
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const scrolls: ScrollTarget[] = []
  const copies: string[] = []
  const timers: { at: number; fn: () => void }[] = []
  const session = { id: opts.sessionId ?? 'sess', cost: opts.cost, percent: opts.percent }
  let now = opts.now ?? 1_000_000

  const host: Host = {
    ...state,
    now: async () => now,
    after: (ms, fn) => void timers.push({ at: now + ms, fn }),
    sessionId: async () => session.id,
    cwd: async () => opts.cwd ?? '/repo',
    usage: async (): Promise<SessionUsage> =>
      ({
        startedAt: 0,
        context: { window: 200_000, percent: session.percent },
        rateLimits: [],
        ...(session.cost === undefined ? {} : { cost: { usd: session.cost } }),
      }),
    store: {
      get: async key => store.get(key),
      set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
      delete: async key => void store.delete(key),
    },
    writeFile: async (path, text) => void files.set(path, text),
    status: text => void statuses.push(text),
    toast: text => void toasts.push(text),
    scroll: async to => void scrolls.push(to),
    copy: async text => {
      copies.push(text)
      return { isCopied: true }
    },
    focusSearch: () => {},
  }

  /** Moves the clock on, running any `after` timers that come due. */
  const advance = (ms: number) => {
    now += ms
    for (const t of timers.splice(0).filter(t => (t.at <= now ? (t.fn(), false) : true))) timers.push(t)
  }

  return { host, state, store, files, toasts, statuses, scrolls, copies, session, advance }
}

/** A finished row with sensible defaults. */
export const row = (fields: Partial<TimelineEvent> & { id: string }): TimelineEvent => ({
  kind: 'tool',
  name: 'Bash',
  detail: '',
  startedAt: 0,
  endedAt: 0,
  status: 'ok',
  ...fields,
})
