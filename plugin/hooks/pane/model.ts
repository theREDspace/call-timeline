import type { TimelineEvent } from '../../types'
import { tokensIn } from '../core/events'
import { visibleOf } from '../core/layout'
import { isCall, isProblem, runningIn } from '../core/timeline'
import type { Host } from '../services/host'

/** What the pane draws from: every value it reads from state in one snapshot, plus what derives from them. */

/** How long a first Clear waits for the second. */
export const CLEAR_CONFIRM_MS = 5000

export type PaneModel = Awaited<ReturnType<typeof readPane>>

export async function readPane(host: Host) {
  const past = await host.archive.get()
  const all = past ? past.events : await host.events.get()
  // A focus on a row that is gone (cleared, capped) is no focus.
  const focusSet = await host.focused.get()
  const focusEv = focusSet ? all.find(ev => ev.id === focusSet) : undefined
  const now = await host.now()
  const calls = all.filter(isCall)
  const steps = all.filter(ev => ev.kind === 'model')
  return {
    past,
    all,
    filter: await host.filter.get(),
    view: await host.view.get(),
    selected: await host.selected.get(),
    expanded: await host.expanded.get(),
    query: await host.query.get(),
    confirming: now - (await host.confirmClearAt.get()) < CLEAR_CONFIRM_MS,
    undoCount: (await host.cleared.get()).length,
    fold: await host.collapsed.get(),
    focusEv,
    focus: focusEv?.id ?? '',
    sort: await host.statsSort.get(),
    sessions: await host.history.get(),
    cost: await host.sessionCost.get(),
    now,
    calls: calls.length,
    steps,
    problems: calls.filter(isProblem).length,
    running: runningIn(all),
    tokTotal: steps.reduce((n, ev) => n + (ev.tokens ? tokensIn(ev.tokens) + ev.tokens.output : 0), 0),
  }
}

/** The rows on screen now: the live session's, or the past one being viewed. */
export const shownEvents = async (host: Host): Promise<TimelineEvent[]> => (await host.archive.get())?.events ?? (await host.events.get())

/** The ids j/k step through in the current view, read fresh rather than from a past draw. */
export async function visibleIds(host: Host) {
  if ((await host.view.get()) === 'history') return (await host.history.get()).map(s => s.id)
  const list = await shownEvents(host)
  const fo = await host.focused.get()
  const focus = list.some(ev => ev.id === fo) ? fo : ''
  return visibleOf(list, await host.filter.get(), await host.query.get(), await host.collapsed.get(), focus).map(r => r.ev.id)
}
