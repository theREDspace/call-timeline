import type { TimelineEvent } from '../../types'
import { patchIn, runningIn } from '../core/timeline'
import type { Host } from './host'

/** Writes to the timeline that must keep more than one thing in step: the undo buffer, the status line, the scroll. */

/** Says in the status line how many calls are in flight; clears it when none are. */
export const showRunning = (host: Pick<Host, 'status'>, list: readonly TimelineEvent[]) => {
  const n = runningIn(list)
  host.status(n > 0 ? `⏵ ${n} running` : undefined)
}

/**
 * Applies `fn` to the live list and to the undo buffer alike, so an undo doesn't restore rows stale.
 * Resolves to the new live list.
 */
export const updateRows = async (host: Host, fn: (list: TimelineEvent[]) => TimelineEvent[]) => {
  await host.cleared.set(fn)
  return host.events.set(fn)
}

/** Finishes or amends a row wherever it is. Resolves to the new live list. */
export const patch = (host: Host, id: string, fields: Partial<TimelineEvent>) => updateRows(host, patchIn(id, fields))

/** Keeps the newest row in view when following. The pane has no stick-to-bottom of its own. */
export const followEnd = async (host: Host) => {
  if (!(await host.follow.get())) return
  // Scroll once the new row has been drawn. The pane may have closed meanwhile; a scroll with nowhere
  // to go is nothing to report.
  host.after(60, () => void host.scroll('end').catch(() => {}))
}
