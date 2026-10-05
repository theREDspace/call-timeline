import type { UiPressArgument } from 'claude-code'

import type { Filter, TimelineEvent, View } from '../../types'
import { nextSort } from '../core/stats'
import { agentRootOf, capped } from '../core/timeline'
import { exportTimeline } from '../services/exporter'
import { loadArchive, refreshHistory } from '../services/history'
import type { Host } from '../services/host'
import { showRunning } from '../services/rows'
import { CLEAR_CONFIRM_MS, shownEvents, visibleIds } from './model'

/**
 * Everything a press, hotkey or keystroke in the pane does. Each action reads state fresh rather than
 * trusting what the draw that bound it captured, so a stale tree can't act on stale rows.
 */
export function paneActions(host: Host) {
  /** Moves the cursor `delta` rows; following resumes only on the last row. */
  const move = async (delta: number) => {
    const ids = await visibleIds(host)
    if (ids.length === 0) return
    const cur = ids.indexOf(await host.selected.get())
    const at = cur < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, cur + delta))
    const id = ids[at]
    if (!id) return
    await host.selected.set(() => id)
    await host.follow.set(() => at === ids.length - 1)
    await host.scroll({ key: `t-${id}` })
  }

  const jumpTop = async () => {
    const first = (await visibleIds(host))[0]
    await host.follow.set(() => false)
    if (first) await host.selected.set(() => first)
    await host.scroll('start')
  }

  const jumpEnd = async () => {
    const last = (await visibleIds(host)).at(-1)
    await host.follow.set(() => true)
    if (last) await host.selected.set(() => last)
    await host.scroll('end')
  }

  /** Drops the cursor, open row, folds and focus: none carry over to a different set of rows. */
  const resetRows = async () => {
    await host.selected.set(() => '')
    await host.expanded.set(() => '')
    await host.collapsed.set(() => [])
    await host.focused.set(() => '')
  }

  /** Leaves a past session for the live one. */
  const goLive = async () => {
    await host.archive.set(() => null)
    await host.view.set(() => 'timeline')
    await resetRows()
    await host.follow.set(() => true)
  }

  /** Opens a past session read-only; this session's own entry goes back to live. */
  const openSession = async (id: string) => {
    if (id === (await host.sessionId())) return goLive()
    const arc = await loadArchive(host, id)
    if (!arc) return host.toast('That session is no longer saved.', 2500)
    await host.archive.set(() => arc)
    await host.view.set(() => 'timeline')
    await resetRows()
    await host.follow.set(() => false)
    await host.scroll('start')
  }

  /** Opens or closes a row's details; in History, opens the session. */
  const toggleOpen = async (id?: string) => {
    const target = id ?? (await host.selected.get())
    if (!target) return
    if ((await host.view.get()) === 'history') return openSession(target)
    await host.selected.set(() => target)
    await host.expanded.set(cur => (cur === target ? '' : target))
  }

  /** Folds or unfolds an Agent row's subagent calls. */
  const toggleFold = async (id?: string) => {
    const target = id ?? (await host.selected.get())
    const ev = (await shownEvents(host)).find(one => one.id === target)
    if (!ev?.spawnedAgentId) return host.toast('Select a subagent row (▲) first.', 2000)
    await host.selected.set(() => ev.id)
    await host.collapsed.set(list => (list.includes(ev.id) ? list.filter(x => x !== ev.id) : [...list, ev.id]))
  }

  /** Shows only one subagent: the given or selected Agent row, or the one the selected call ran under. */
  const toggleFocus = async (id?: string) => {
    if (!id && (await host.focused.get())) {
      await host.focused.set(() => '')
      return jumpEnd()
    }
    const root = agentRootOf(await shownEvents(host), id ?? (await host.selected.get()))
    if (!root) return host.toast('Select a subagent row (▲) or one of its calls first.', 2500)
    await host.focused.set(cur => (cur === root.id ? '' : root.id))
    await host.selected.set(() => root.id)
    await host.follow.set(() => false)
    await host.scroll('start')
  }

  /** Copies a row's name, arguments and result: the given row, or the selected one. */
  const copy = async (press: UiPressArgument, id?: string) => {
    if (id) await host.selected.set(() => id)
    const target = await host.selected.get()
    const ev = (await shownEvents(host)).find(one => one.id === target)
    if (!ev) return host.toast('Select a row first (j/k).', 2000)
    const text = [ev.name, ev.detail, '', 'Arguments:', ev.args || '{}', '', 'Result:', ev.output || '—'].join('\n')
    const done = await host.copy(text, press.surface)
    host.toast(done.isCopied ? `Copied ${ev.name}` : `Copy failed: ${done.reason}`, 2000)
  }

  const exportShown = async () => {
    try {
      host.toast(await exportTimeline(host, ''), 4000)
    } catch (err) {
      host.toast(`Export failed: ${String(err)}`, 4000)
    }
  }

  const toggleHistory = async () => {
    if ((await host.view.get()) === 'history') return host.view.set(() => 'timeline')
    await refreshHistory(host)
    await host.view.set(() => 'history')
    await host.selected.set(() => '')
  }

  /** The first press arms Clear; a second within the window clears, keeping the rows for Undo. */
  const clear = async () => {
    if (await host.archive.get()) return host.toast('Viewing a past session; press v to return to live.', 2500)
    const at = await host.now()
    if (at - (await host.confirmClearAt.get()) >= CLEAR_CONFIRM_MS) {
      await host.confirmClearAt.set(() => at)
      host.after(CLEAR_CONFIRM_MS, () => void host.confirmClearAt.set(c => (c === at ? 0 : c)))
      return
    }
    let removed: TimelineEvent[] = []
    await host.events.set(list => {
      removed = list
      return []
    })
    if (removed.length) await host.cleared.set(() => removed)
    await host.confirmClearAt.set(() => 0)
    await resetRows()
    host.status(undefined)
  }

  /** Puts the cleared rows back ahead of anything recorded since. */
  const undoClear = async () => {
    let back: TimelineEvent[] = []
    await host.cleared.set(list => {
      back = list
      return []
    })
    if (back.length) showRunning(host, await host.events.set(list => capped([...back, ...list])))
  }

  return {
    move,
    jumpTop,
    jumpEnd,
    goLive,
    openSession,
    toggleOpen,
    toggleFold,
    toggleFocus,
    copy,
    exportShown,
    toggleHistory,
    clear,
    undoClear,
    setFilter: (value: Filter) => host.filter.set(() => value),
    setQuery: (value: string) => host.query.set(() => value),
    showTimeline: () => host.view.set((): View => 'timeline'),
    toggleStats: () => host.view.set((cur): View => (cur === 'stats' ? 'timeline' : 'stats')),
    cycleSort: () => host.statsSort.set(nextSort),
    focusSearch: host.focusSearch,
  }
}

export type PaneActions = ReturnType<typeof paneActions>
