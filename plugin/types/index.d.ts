export type EventKind = 'skill' | 'tool' | 'mcp' | 'agent' | 'model' | 'prompt'
export type EventStatus = 'running' | 'ok' | 'error' | 'denied' | 'aborted'
export type Filter = 'all' | 'skills' | 'tools' | 'mcp' | 'model' | 'errors'
export type View = 'timeline' | 'stats' | 'history'
export type StatsSort = 'total' | 'count' | 'max' | 'out' | 'errors' | 'name'
/** How a turn ended, as `turn.complete` reports it. */
export type TurnOutcome = 'answer' | 'aborted' | 'refusal' | 'error'

/** A model request's token counts. `input` is uncached; the cache counts are separate. */
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type TimelineEvent = {
  id: string
  kind: EventKind
  name: string
  detail: string
  startedAt: number
  endedAt?: number
  status: EventStatus
  /** The loop the call ran in; absent on the main loop. */
  agentId?: string
  /** The subagent type of the Agent row that started `agentId`'s loop, so the call can name it once that row is gone. */
  agentName?: string
  /** For an Agent call: the id of the subagent loop it started, which its calls carry as `agentId`. */
  spawnedAgentId?: string
  /** Full arguments, pretty JSON, sanitized, redacted and capped. */
  args?: string
  /** Head of the result text (or the deny reason), sanitized, redacted and capped. */
  output?: string
  /** The result's full length before capping: how much it put into context. */
  outputChars?: number
  /** Identical calls (same name and arguments) so far in this turn, this one included, when more than one. */
  repeat?: number
  /** Model steps: tokens the request used, as the API reported them. */
  tokens?: Tokens
  /** Model steps: when the first piece of the response arrived. */
  firstAt?: number
  /** Model steps: why the model stopped. */
  stopReason?: string
  /** Prompts: the turn the prompt started. */
  turnId?: string
  /** Prompts: how the turn ended. */
  outcome?: TurnOutcome
  /** Prompts: session cost when the turn started, to work out what the turn cost. */
  costAtStart?: number
  /** Prompts: what the turn cost, in US dollars. */
  costUsd?: number
  /** Prompts: context-window fill when the turn ended, 0–100. */
  contextPercent?: number
}

/** One past session in the history list. */
export type SessionSummary = {
  id: string
  title: string
  startedAt: number
  savedAt: number
  calls: number
  problems: number
  costUsd?: number
}

/** A past session opened for viewing: its saved events, read-only. */
export type Archive = { id: string; title: string; events: TimelineEvent[] }

declare module 'claude-code' {
  interface PluginState {
    'call-timeline': {
      events: TimelineEvent[]
      filter: Filter
      view: View
      /** The row the cursor (j/k) is on. */
      selected: string
      /** The row whose details are open. */
      expanded: string
      /** Search text; empty shows everything. */
      query: string
      /** Keep the newest row in view as events arrive. */
      follow: boolean
      /** When Clear was first pressed; a second press within the window clears. */
      confirmClearAt: number
      /** What the last Clear removed, for Undo. */
      cleared: TimelineEvent[]
      /** The token of the one module instance whose ticker may run. */
      tickOwner: string
      /** Agent rows whose subagent calls are folded away. */
      collapsed: string[]
      /** The Stats view's sort key. */
      statsSort: StatsSort
      /** Past sessions, newest first, as last read from the store. */
      history: SessionSummary[]
      /** A past session being viewed instead of the live one; null for live. */
      archive: Archive | null
      /** The session's cost as last read, for the header. */
      sessionCost: number
      /** An Agent row the timeline is narrowed to, with everything beneath it; empty for all. */
      focused: string
    }
  }
}
