import type { TimelineEvent, TurnOutcome } from '../../types'
import { tokensIn } from './events'
import { compact, duration, plural, usd } from './format'
import { isProblem } from './timeline'

/** Turns: the span, counts and totals of each prompt's work, and where each row falls within it. */

export type Turn = { start: number; end: number; calls: number; steps: number; problems: number; tokIn: number; tokOut: number }

/** Each row's turn (the prompt it followed), with the span the waterfall bars are drawn against. */
export function turnsOf(list: readonly TimelineEvent[], now: number) {
  const byPrompt = new Map<string, Turn>()
  const turnOf = new Map<string, Turn>()
  const fresh = (at: number): Turn => ({ start: at, end: at, calls: 0, steps: 0, problems: 0, tokIn: 0, tokOut: 0 })
  let cur: Turn | undefined
  for (const ev of list) {
    if (ev.kind === 'prompt') {
      cur = fresh(ev.startedAt)
      // A turn runs until turn.complete says it ended, whatever its last call did.
      cur.end = ev.status === 'running' ? now : Math.max(ev.startedAt, ev.endedAt ?? ev.startedAt)
      byPrompt.set(ev.id, cur)
      continue
    }
    // Rows before the first prompt (or after a clear) form a turn of their own.
    cur ??= fresh(ev.startedAt)
    if (ev.kind === 'model') {
      cur.steps += 1
      if (ev.tokens) {
        cur.tokIn += tokensIn(ev.tokens)
        cur.tokOut += ev.tokens.output
      }
    } else {
      cur.calls += 1
      if (isProblem(ev)) cur.problems += 1
    }
    cur.end = Math.max(cur.end, ev.endedAt ?? now)
    turnOf.set(ev.id, cur)
  }
  return { byPrompt, turnOf }
}

/** How a turn ended, when that is worth saying; an answer is not. */
export const OUTCOME_LABEL: Record<TurnOutcome, string> = { answer: '', aborted: 'interrupted', refusal: 'refused', error: 'API error' }

/** The prompt row's summary: time, calls, steps, tokens, cost, context. */
export function turnSummary(ev: TimelineEvent, t: Turn | undefined) {
  const parts: string[] = []
  if (t && (t.calls || t.steps || ev.status === 'running' || ev.outcome)) {
    parts.push(ev.status === 'running' ? `${duration(t.end - t.start)}…` : duration(t.end - t.start))
  }
  if (t?.calls) parts.push(plural(t.calls, 'call'))
  if (t?.steps) parts.push(plural(t.steps, 'step'))
  if (t && (t.tokIn || t.tokOut)) parts.push(`${compact(t.tokIn)}→${compact(t.tokOut)} tok`)
  if (ev.costUsd !== undefined) parts.push(usd(ev.costUsd))
  if (ev.contextPercent !== undefined) parts.push(`ctx ${ev.contextPercent}%`)
  return parts.join(' · ')
}

/**
 * A row's waterfall bar, `width` cells wide: `lead` cells before it (where it fell within its turn), then
 * `wait` cells waiting for a model's first token, then `run` cells working. Overlapping bars are parallel work.
 */
/**
 * The time axis drawn above a turn's bars, `width` cells: `0` at the left, the turn's length at the
 * right, and its midpoint between when there is room.
 */
export function ruler(spanMs: number, width: number) {
  const cells = Array.from({ length: width }, () => '─')
  const marks: [number, string][] = [[0, '0'], [1, duration(spanMs)]]
  if (width >= 30) marks.push([0.5, duration(Math.round(spanMs / 2))])
  for (const [at, label] of marks) {
    const anchor = at === 0 ? 0 : at === 1 ? width - label.length : Math.round(at * width - label.length / 2)
    const from = Math.max(0, Math.min(width - label.length, anchor))
    for (let i = 0; i < label.length && from + i < width; i++) cells[from + i] = label[i] ?? ''
  }
  return cells.join('')
}

export function waterfall(ev: TimelineEvent, turn: Turn | undefined, now: number, width: number) {
  const ms = (ev.endedAt ?? now) - ev.startedAt
  const start = turn?.start ?? ev.startedAt
  const span = Math.max(1, (turn?.end ?? now) - start)
  const lead = Math.min(width - 1, Math.round(((ev.startedAt - start) / span) * width))
  const len = Math.max(1, Math.min(width - lead, Math.round((ms / span) * width)))
  const waitMs = ev.kind !== 'model' ? 0 : ev.firstAt !== undefined ? ev.firstAt - ev.startedAt : ev.status === 'running' ? ms : 0
  const wait = Math.min(len, Math.round((waitMs / span) * width))
  return { lead, wait, run: len - wait }
}
