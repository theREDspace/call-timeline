import type { EventKind, StatsSort, TimelineEvent } from '../../types'
import { compact } from './format'

/** Per-name aggregates for the Stats view. */

export type Stat = {
  name: string
  kind: EventKind
  count: number
  total: number
  max: number
  p95: number
  /** Result characters for calls; output tokens for model steps. */
  out: number
  errors: number
  denied: number
}

const SORTS: Record<StatsSort, (a: Stat, b: Stat) => number> = {
  total: (a, b) => b.total - a.total,
  count: (a, b) => b.count - a.count || b.total - a.total,
  max: (a, b) => b.max - a.max,
  out: (a, b) => b.out - a.out || b.total - a.total,
  errors: (a, b) => b.errors + b.denied - (a.errors + a.denied) || b.total - a.total,
  name: (a, b) => a.name.localeCompare(b.name),
}
const SORT_ORDER: StatsSort[] = ['total', 'count', 'max', 'out', 'errors', 'name']

/** The sort after `cur` in the cycle `r` steps through. */
export const nextSort = (cur: StatsSort): StatsSort => SORT_ORDER[(SORT_ORDER.indexOf(cur) + 1) % SORT_ORDER.length] ?? 'total'

/** One Stat per kind and name, prompts left out, sorted by `sort`. */
export function statsOf(list: readonly TimelineEvent[], now: number, sort: StatsSort): Stat[] {
  const by = new Map<string, Stat & { times: number[] }>()
  for (const ev of list) {
    if (ev.kind === 'prompt') continue
    const key = `${ev.kind}:${ev.name}`
    const s = by.get(key) ?? { name: ev.name, kind: ev.kind, count: 0, total: 0, max: 0, p95: 0, out: 0, errors: 0, denied: 0, times: [] }
    const ms = (ev.endedAt ?? now) - ev.startedAt
    s.count += 1
    s.total += ms
    s.times.push(ms)
    s.out += ev.kind === 'model' ? (ev.tokens?.output ?? 0) : (ev.outputChars ?? 0)
    if (ev.status === 'error') s.errors += 1
    if (ev.status === 'denied') s.denied += 1
    by.set(key, s)
  }
  const out = [...by.values()].map(({ times, ...s }) => {
    times.sort((a, b) => a - b)
    return { ...s, max: times.at(-1) ?? 0, p95: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? 0 }
  })
  return out.sort(SORTS[sort])
}

/** The Out column: tokens for model steps, characters for calls, a dash for nothing. */
export const outLabel = (kind: EventKind, n: number) => (n ? `${compact(n)} ${kind === 'model' ? 'tok' : 'ch'}` : '—')
