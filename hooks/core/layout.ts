import type { Filter, TimelineEvent } from '../../types'
import { isProblem } from './timeline'

/**
 * Which rows the timeline shows, in what order, how deep, and with which tree connectors. Everything
 * about subagent grouping, folding, focus, filters and search lives behind `visibleOf`.
 */

/**
 * `orphan`: a subagent's call whose Agent row is gone, so it can't be grouped. `context`: an Agent row
 * the filter or search would hide, kept so the calls under it still show whose they are. `tree`: the
 * connectors drawn before the glyph.
 */
export type Row = { ev: TimelineEvent; depth: number; descendants: number; orphan: boolean; context: boolean; tree: string }

const FILTERS: Record<Filter, (ev: TimelineEvent) => boolean> = {
  all: () => true,
  skills: ev => ev.kind === 'skill',
  tools: ev => ev.kind === 'tool' || ev.kind === 'agent',
  mcp: ev => ev.kind === 'mcp',
  model: ev => ev.kind === 'model',
  errors: isProblem,
}

const matches = (ev: TimelineEvent, needle: string) =>
  `${ev.name}\n${ev.detail}\n${ev.args ?? ''}\n${ev.output ?? ''}`.toLowerCase().includes(needle)

/**
 * Calls in time order, except that a subagent's calls follow the Agent row that started it, one level
 * deeper. A collapsed Agent row hides everything beneath it. A call whose Agent row is gone (cleared,
 * or past MAX_EVENTS) stays where it fell, indented once.
 */
export function arrange(list: readonly TimelineEvent[], fold: readonly string[]): Row[] {
  const ownerOf = new Map<string, string>()
  for (const ev of list) if (ev.spawnedAgentId) ownerOf.set(ev.spawnedAgentId, ev.id)
  const kids = new Map<string, TimelineEvent[]>()
  const roots: TimelineEvent[] = []
  for (const ev of list) {
    const owner = ev.agentId ? ownerOf.get(ev.agentId) : undefined
    if (owner && owner !== ev.id) kids.set(owner, [...(kids.get(owner) ?? []), ev])
    else roots.push(ev)
  }
  const out: Row[] = []
  const seen = new Set<string>()
  const walk = (ev: TimelineEvent, depth: number, hidden: boolean): number => {
    if (seen.has(ev.id)) return 0
    seen.add(ev.id)
    const row: Row = { ev, depth, descendants: 0, orphan: !!ev.agentId && !ownerOf.has(ev.agentId), context: false, tree: '' }
    if (!hidden) out.push(row)
    const hideKids = hidden || fold.includes(ev.id)
    for (const kid of kids.get(ev.id) ?? []) row.descendants += 1 + walk(kid, depth + 1, hideKids)
    return row.descendants
  }
  for (const ev of roots) walk(ev, ev.agentId ? 1 : 0, false)
  return out
}

/** Box-drawing connectors for rows in tree order: `├─`/`└─` on the row, `│ ` for each ancestor with more below. */
function withTree(rows: Row[]): Row[] {
  // seen[d]: a later row sits at depth d before anything shallower, so a connector at d continues.
  const seen: boolean[] = []
  // An orphan heads no group, so it and the rows beneath it hang off a dashed line of their own.
  let orphaned = false
  const out = rows.map(r => {
    if (r.depth <= 1) orphaned = r.orphan
    return { ...r, orphaned }
  })
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i]
    if (!row) continue
    const d = row.depth
    let tree = ''
    for (let k = 1; k < d; k++) tree += k === 1 && row.orphaned ? '┆ ' : seen[k] ? '│ ' : '  '
    if (d > 0) tree += row.orphan && d === 1 ? '┆ ' : seen[d] ? '├─' : '└─'
    row.tree = tree
    seen.length = d + 1
    seen[d] = !(row.orphan && d === 1)
  }
  return out.map(({ orphaned: _o, ...r }) => r)
}

/**
 * The rows the timeline shows: prompts as separators, everything else through the filter and search.
 * Grouping is worked out before filtering, so a subagent's calls stay under its Agent row whatever the
 * filter; that row stays too, as context. `focus` narrows to one Agent row and everything beneath it.
 */
export function visibleOf(list: readonly TimelineEvent[], f: Filter, q: string, fold: readonly string[], focus = '') {
  const needle = q.trim().toLowerCase()
  // A search looks inside folded groups too, and the focused group is always open.
  let rows = arrange(list, needle ? [] : fold.filter(id => id !== focus))
  const root = focus ? rows.findIndex(r => r.ev.id === focus) : -1
  const base = rows[root]
  if (base) {
    let end = root + 1
    // Orphans sit one level deep but belong to no group, so they end it too.
    while (end < rows.length && (rows[end]?.depth ?? 0) > base.depth && !rows[end]?.orphan) end++
    rows = rows.slice(root, end).map(r => ({ ...r, depth: r.depth - base.depth }))
  }
  const keep = (ev: TimelineEvent) => (!needle || matches(ev, needle)) && (ev.kind === 'prompt' || FILTERS[f](ev))
  const rowOfLoop = new Map<string, number>()
  rows.forEach((r, i) => r.ev.spawnedAgentId && rowOfLoop.set(r.ev.spawnedAgentId, i))
  const kept = new Set<number>()
  const context = new Set<number>()
  rows.forEach((r, i) => {
    if (!keep(r.ev)) return
    kept.add(i)
    let up = r.ev.agentId ? rowOfLoop.get(r.ev.agentId) : undefined
    while (up !== undefined && up !== i && !context.has(up)) {
      context.add(up)
      const parent = rows[up]?.ev.agentId
      up = parent ? rowOfLoop.get(parent) : undefined
    }
  })
  return withTree(rows.flatMap((r, i) => (kept.has(i) ? [r] : context.has(i) ? [{ ...r, context: true }] : [])))
}
