import type { EventStatus, TimelineEvent, TurnOutcome } from '../../types'
import { promptRow } from './events'

/**
 * The timeline as a value: every way the list of rows changes, as pure functions of the old list. Hooks
 * hand these to `update`, so each change is one atomic step whatever else is running.
 */

export const MAX_EVENTS = 800
/** A prompt this recent with no turn yet is the one a starting turn belongs to. */
const PROMPT_TURN_WINDOW_MS = 10_000
/** A skill row this recent already stands for a skill the slash command ran. */
const SKILL_DEDUPE_MS = 5000

export const isProblem = (ev: TimelineEvent) => ev.status === 'error' || ev.status === 'denied'
export const isCall = (ev: TimelineEvent) => ev.kind !== 'prompt' && ev.kind !== 'model'
export const runningIn = (list: readonly TimelineEvent[]) => list.filter(ev => ev.status === 'running' && ev.kind !== 'prompt').length

/** Keeps the newest MAX_EVENTS, dropping whole turns, so no call outlives its prompt row. */
export function capped(list: TimelineEvent[]) {
  if (list.length <= MAX_EVENTS) return list
  const kept = list.slice(-MAX_EVENTS)
  if (kept[0]?.kind === 'prompt') return kept
  const first = kept.findIndex(ev => ev.kind === 'prompt')
  return first > 0 ? kept.slice(first) : kept
}

/** The row stamped with its Agent row's name, so it can still say whose it is once that row is gone. */
function withOwner(list: readonly TimelineEvent[], ev: TimelineEvent): TimelineEvent {
  if (!ev.agentId) return ev
  const owner = list.find(one => one.spawnedAgentId === ev.agentId)
  return owner ? { ...ev, agentName: owner.name } : ev
}

/** Who ran an orphaned call: the subagent type its Agent row had, or else the loop's id. */
export const loopLabel = (ev: TimelineEvent) => ev.agentName ?? (ev.agentId ? ev.agentId.slice(0, 8) : '')

/** Adds a row at the end, naming its subagent, within the cap. */
export const append = (ev: TimelineEvent) => (list: TimelineEvent[]) => capped([...list, withOwner(list, ev)])

/** The current turn's rows, newest first: everything after the last prompt. */
function sinceTurn(list: readonly TimelineEvent[]) {
  const out: TimelineEvent[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    const one = list[i]
    if (!one || one.kind === 'prompt') break
    out.push(one)
  }
  return out
}
/** Same loop, name and arguments. */
const sameCall = (a: TimelineEvent, b: TimelineEvent) => a.kind === b.kind && a.name === b.name && a.args === b.args && a.agentId === b.agentId

/** Adds a call, tagged `repeat` when identical calls came before it this turn: a loop in the making. */
export const appendCall = (ev: TimelineEvent) => (list: TimelineEvent[]) => {
  const n = sinceTurn(list).filter(one => sameCall(one, ev)).length + 1
  return append(n > 1 ? { ...ev, repeat: n } : ev)(list)
}

/** How many calls identical to `ev` have failed this turn. */
export const sameFailures = (list: readonly TimelineEvent[], ev: TimelineEvent) =>
  sinceTurn(list).filter(one => sameCall(one, ev) && one.status === 'error').length

/** Merges `fields` into the row `id`, wherever it is. */
export const patchIn = (id: string, fields: Partial<TimelineEvent>) => (list: TimelineEvent[]) =>
  list.some(one => one.id === id) ? list.map(one => (one.id === id ? { ...one, ...fields } : one)) : list

/** Marks everything in flight aborted; the list itself when nothing is. */
export const interrupt = (list: TimelineEvent[]) =>
  list.some(ev => ev.status === 'running')
    ? list.map(ev =>
        ev.status === 'running' ? { ...ev, status: 'aborted' as const, endedAt: ev.startedAt, output: ev.output ?? '(interrupted)' } : ev,
      )
    : list

/**
 * Ties the newest prompt to the turn it started; a turn with no prompt of its own (a continuation, a
 * scheduled wake-up) gets a prompt row so its calls still have a turn. `added` says which happened.
 */
export function startTurn(list: TimelineEvent[], turn: { turnId: string; text: string; at: number; costAtStart?: number }) {
  const fields: Partial<TimelineEvent> = { turnId: turn.turnId, status: 'running', endedAt: undefined, costAtStart: turn.costAtStart }
  let at = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.kind === 'prompt') {
      at = i
      break
    }
  }
  const p = list[at]
  if (p && !p.turnId && turn.at - p.startedAt < PROMPT_TURN_WINDOW_MS) {
    return { list: list.map((one, i) => (i === at ? { ...one, ...fields } : one)), added: false }
  }
  const row: TimelineEvent = { ...promptRow(turn.text, turn.at, '(continuation)'), ...fields }
  return { list: capped([...list, row]), added: true }
}

/** The status a turn's prompt row ends with. */
const turnStatus = (outcome: TurnOutcome): EventStatus => (outcome === 'answer' ? 'ok' : outcome === 'aborted' ? 'aborted' : 'error')

/**
 * Closes the turn's prompt row with how it ended, what it cost and the context fill. An interrupted
 * turn also stops everything still in flight: Esc stops it all at once.
 */
export const finishTurn =
  (turn: { turnId: string; outcome: TurnOutcome; at: number; cost?: number; contextPercent?: number }) => (list: TimelineEvent[]) =>
    list.map(one => {
      if (one.kind === 'prompt' && one.turnId === turn.turnId) {
        return {
          ...one,
          status: turnStatus(turn.outcome),
          outcome: turn.outcome,
          endedAt: turn.at,
          costUsd: turn.cost !== undefined && one.costAtStart !== undefined ? Math.max(0, turn.cost - one.costAtStart) : undefined,
          contextPercent: turn.contextPercent,
        }
      }
      if (turn.outcome === 'aborted' && one.status === 'running') return { ...one, status: 'aborted' as const, endedAt: turn.at }
      return one
    })

/** Whether a skill row named `skill` was added in the last few seconds. */
export const hasRecentSkill = (list: readonly TimelineEvent[], skill: string, at: number) =>
  list.some(one => one.kind === 'skill' && one.name === skill && at - one.startedAt < SKILL_DEDUPE_MS)

/** The Agent row a focus on `id` means: the row itself if it is one, or the one its call ran under. */
export function agentRootOf(list: readonly TimelineEvent[], id: string) {
  const ev = list.find(one => one.id === id)
  if (ev?.spawnedAgentId) return ev
  return ev?.agentId ? list.find(one => one.spawnedAgentId === ev.agentId) : undefined
}
