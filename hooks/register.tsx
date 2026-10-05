import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Archive, Filter, SessionSummary, StatsSort, TimelineEvent, View } from '../types'
import { newId } from './core/events'
import { paneActions } from './pane/controller'
import { drawPane } from './pane/draw'
import { kitOf } from './pane/kit'
import { readPane } from './pane/model'
import { exportTimeline } from './services/exporter'
import { refreshHistory, trySaveSession } from './services/history'
import type { Host } from './services/host'
import { recordCall, recordPrompt, recordSkillCommand, recordSpawn, recordStep, recordTurnEnd, recordTurnStart, resume } from './services/recorder'

/**
 * Call Timeline's entry: the only file that touches the engine. The engine reads every `$` call and
 * state key off the hooks module, so the atoms and the one adapter from `$` to a Host live here, and
 * each hook just hands its event to the module that handles it.
 *
 *   core/      pure logic over rows: building, hardening, list changes, layout, turns, stats, export text
 *   services/  the Host port, and recording, history and export written against it
 *   pane/      the pane's view model, its actions, and the drawing
 */

const PANE = 'timeline'
const TITLE = 'Call Timeline'

const events = atom({ plugin: 'call-timeline', key: 'events' } as const, [] as TimelineEvent[])
const filter = atom({ plugin: 'call-timeline', key: 'filter' } as const, 'all' as Filter)
const view = atom({ plugin: 'call-timeline', key: 'view' } as const, 'timeline' as View)
const selected = atom({ plugin: 'call-timeline', key: 'selected' } as const, '')
const expanded = atom({ plugin: 'call-timeline', key: 'expanded' } as const, '')
const query = atom({ plugin: 'call-timeline', key: 'query' } as const, '')
const follow = atom({ plugin: 'call-timeline', key: 'follow' } as const, true)
const confirmClearAt = atom({ plugin: 'call-timeline', key: 'confirmClearAt' } as const, 0)
const cleared = atom({ plugin: 'call-timeline', key: 'cleared' } as const, [] as TimelineEvent[])
const tickOwner = atom({ plugin: 'call-timeline', key: 'tickOwner' } as const, '')
const collapsed = atom({ plugin: 'call-timeline', key: 'collapsed' } as const, [] as string[])
const statsSort = atom({ plugin: 'call-timeline', key: 'statsSort' } as const, 'total' as StatsSort)
const history = atom({ plugin: 'call-timeline', key: 'history' } as const, [] as SessionSummary[])
const archive = atom({ plugin: 'call-timeline', key: 'archive' } as const, null as Archive | null)
const sessionCost = atom({ plugin: 'call-timeline', key: 'sessionCost' } as const, 0)
const focused = atom({ plugin: 'call-timeline', key: 'focused' } as const, '')

/** The Host every module works through, over this hook's `$`. */
function hostOf($: EngineInterface): Host {
  return {
    events: { get: () => read($, events), set: fn => update($, events, fn) },
    cleared: { get: () => read($, cleared), set: fn => update($, cleared, fn) },
    filter: { get: () => read($, filter), set: fn => update($, filter, fn) },
    view: { get: () => read($, view), set: fn => update($, view, fn) },
    selected: { get: () => read($, selected), set: fn => update($, selected, fn) },
    expanded: { get: () => read($, expanded), set: fn => update($, expanded, fn) },
    query: { get: () => read($, query), set: fn => update($, query, fn) },
    follow: { get: () => read($, follow), set: fn => update($, follow, fn) },
    confirmClearAt: { get: () => read($, confirmClearAt), set: fn => update($, confirmClearAt, fn) },
    collapsed: { get: () => read($, collapsed), set: fn => update($, collapsed, fn) },
    statsSort: { get: () => read($, statsSort), set: fn => update($, statsSort, fn) },
    history: { get: () => read($, history), set: fn => update($, history, fn) },
    archive: { get: () => read($, archive), set: fn => update($, archive, fn) },
    sessionCost: { get: () => read($, sessionCost), set: fn => update($, sessionCost, fn) },
    focused: { get: () => read($, focused), set: fn => update($, focused, fn) },
    now: () => $.clock.now(),
    after: (ms, fn) => void $.clock.after(ms, fn),
    sessionId: () => $.session.id(),
    cwd: () => $.session.cwd(),
    usage: () => $.session.usage(),
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
    },
    writeFile: (path, text) => $.fs.write(path, text),
    status: text => $.ui.status(text),
    toast: (text, timeoutMs) => $.ui.toast(text, { timeoutMs }),
    scroll: to => $.ui.scroll({ in: PANE, to }),
    copy: (text, surface) => $.ui.copy({ text, surface }),
    focusSearch: () => void $.ui.focus({ requestId: PANE, key: 'search' }),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'timeline',
      description: 'Open the call timeline pane, export it, or browse past sessions',
      argumentHint: '[export [md|json|path] | history]',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    await resume(hostOf($))

    // Redraw once a second while anything runs, so elapsed times and bars count up. A reload starts a
    // new ticker; the token in state tells the old one to stop, which a module variable could not.
    const token = newId('tick', await $.clock.now())
    await update($, tickOwner, () => token)
    const tick = $.clock.every(1000, () => {
      void (async () => {
        if ((await read($, tickOwner)) !== token) return tick.cancel()
        if ((await read($, events)).some(ev => ev.status === 'running')) $.ui.invalidate('ui.render')
      })()
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // The exit has a short bound; the last turn.complete already saved nearly everything.
    await trySaveSession(hostOf($))
    return next(e)
  })

  on('command.run', { command: 'timeline' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'export') {
      try {
        return { text: await exportTimeline(hostOf($), rest.join(' ')) }
      } catch (err) {
        return { text: `Export failed: ${String(err)}` }
      }
    }
    if (sub === 'history') {
      await refreshHistory(hostOf($))
      await update($, view, () => 'history')
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: 'Timeline history opened.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Timeline pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await recordPrompt(hostOf($), e.text)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await recordTurnStart(hostOf($), e)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    // A subagent's run is a turn too; its steps already carry its cost under its Agent row.
    if (!e.agentId) await recordTurnEnd(hostOf($), e)
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    return yield* recordStep(hostOf($), e, () => next(e), () => next.signal.aborted)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.agentId) await recordSpawn(hostOf($), e.tool_use_id, ran.agentId)
    return ran
  })

  on('tool.call', ($, e, next) => recordCall(hostOf($), e as { tool: string; [k: string]: unknown }, () => next(e)))

  on('skill.prompt', async ($, e, next) => {
    await recordSkillCommand(hostOf($), e.skill)
    return next(e)
  })

  // Scrolling up stops following new rows; scrolling back to the end resumes it.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'person') {
      const atEnd = e.offset + e.bodyRows >= e.contentRows
      await update($, follow, f => (f === atEnd ? f : atEnd))
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const host = hostOf($)
    const m = await readPane(host)
    return drawPane({
      ui: kitOf($.ui.resolve(e)),
      m,
      act: paneActions(host),
      width: e.props.bodyColumns ?? 60,
      current: m.view === 'history' ? await $.session.id() : '',
    })
  })
}
