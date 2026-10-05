import { expect, test } from 'claude-code/testing'

import { paneActions } from '../hooks/pane/controller'
import { CLEAR_CONFIRM_MS, readPane } from '../hooks/pane/model'
import { exportTimeline } from '../hooks/services/exporter'
import { HISTORY_MAX, loadArchive, refreshHistory, saveSession, trySaveSession } from '../hooks/services/history'
import { recordCall, recordSkillCommand, recordTurnEnd, recordTurnStart, resume } from '../hooks/services/recorder'
import { followEnd } from '../hooks/services/rows'
import type { SessionSummary } from '../types'
import { fakeHost, row } from './fake-host'

const press = { surface: 'terminal' } as Parameters<ReturnType<typeof paneActions>['copy']>[0]

// ── history ──────────────────────────────────────────────────────────────────

test('saveSession stores a slim timeline, lists it first, and keeps only the newest sessions', async () => {
  const f = fakeHost({ sessionId: 's-new' })
  f.state.events.value = [row({ id: 'p', kind: 'prompt', name: 'do it' }), row({ id: 'c', args: '{"secret":1}', output: 'big' })]
  f.state.sessionCost.value = 0.5
  const older: SessionSummary[] = Array.from({ length: HISTORY_MAX }, (_, i) => ({ id: `s${i}`, title: '', startedAt: i, savedAt: i, calls: 1, problems: 0 }))
  f.store.set('sessions', older)
  for (const s of older) f.store.set(`session:${s.id}`, { id: s.id, title: '', events: [] })

  await saveSession(f.host)

  const index = f.store.get('sessions') as SessionSummary[]
  expect(index).toHaveLength(HISTORY_MAX)
  expect(index[0]).toMatchObject({ id: 's-new', title: 'do it', calls: 1, costUsd: 0.5 })
  expect(f.store.has(`session:s${HISTORY_MAX - 1}`)).toBe(false)
  expect(f.state.history.value[0]?.id).toBe('s-new')
  const arc = await loadArchive(f.host, 's-new')
  expect(arc?.events.every(ev => ev.args === undefined && ev.output === undefined)).toBe(true)
})

test('saveSession skips a session with no calls; history survives an unreadable store', async () => {
  const f = fakeHost()
  f.state.events.value = [row({ id: 'p', kind: 'prompt' })]
  await saveSession(f.host)
  expect(f.store.size).toBe(0)

  f.state.history.value = [{ id: 'kept', title: '', startedAt: 0, savedAt: 0, calls: 1, problems: 0 }]
  f.host.store.get = async () => {
    throw new Error('store down')
  }
  await refreshHistory(f.host)
  expect(f.state.history.value[0]?.id).toBe('kept')
  f.state.events.value = [row({ id: 'c' })]
  await trySaveSession(f.host)
  expect(await loadArchive(fakeHost().host, 'missing')).toBeUndefined()
})

// ── export ───────────────────────────────────────────────────────────────────

test('exportTimeline writes the shown timeline and says where', async () => {
  const f = fakeHost({ cwd: '/work' })
  f.state.events.value = [row({ id: 'a' }), row({ id: 'b' })]
  expect(await exportTimeline(f.host, 'out.json')).toBe('Exported 2 events to /work/out.json')
  expect((JSON.parse(f.files.get('out.json') ?? '{}') as { events: unknown[] }).events).toHaveLength(2)

  f.state.archive.value = { id: 'old', title: 'Old one', events: [row({ id: 'x' })] }
  expect(await exportTimeline(f.host, '/tmp/t.md')).toBe('Exported 1 events to /tmp/t.md')
  expect(f.files.get('/tmp/t.md')).toContain('# Call timeline: Old one')
})

// ── recorder ─────────────────────────────────────────────────────────────────

test('recordCall finishes the row by how the call ended, and only failures toast', async () => {
  const f = fakeHost()
  await recordCall(f.host, { tool: 'Bash', command: 'rm x', tool_use_id: 'd' }, async () => ({ deny: 'no' }))
  await recordCall(f.host, { tool: 'Bash', command: 'ls', tool_use_id: 'o' }, async () => ({ text: 'a\nb' }))
  await expect(recordCall(f.host, { tool: 'Bash', command: 'boom', tool_use_id: 'e' }, async () => Promise.reject(new Error('x')))).rejects.toThrow('x')

  const byId = Object.fromEntries(f.state.events.value.map(ev => [ev.id, ev]))
  expect(byId.d).toMatchObject({ status: 'denied', output: 'no' })
  expect(byId.o).toMatchObject({ status: 'ok', outputChars: 3 })
  expect(byId.e?.status).toBe('error')
  expect(f.toasts).toEqual(['● Bash: error'])
  expect(f.statuses.at(-1)).toBeUndefined()
})

test('recordSkillCommand skips a skill the Skill tool is already running, and recent duplicates', async () => {
  const f = fakeHost()
  let inner = 0
  await recordCall(f.host, { tool: 'Skill', skill: 'pdf', tool_use_id: 's1' }, async () => {
    await recordSkillCommand(f.host, 'pdf')
    inner = f.state.events.value.length
    return { text: '' }
  })
  expect(inner).toBe(1)
  await recordSkillCommand(f.host, 'pdf')
  expect(f.state.events.value).toHaveLength(1)
  await recordSkillCommand(f.host, 'docx')
  expect(f.state.events.value.at(-1)).toMatchObject({ kind: 'skill', name: 'docx', detail: '/ command' })
})

test('a turn that ends in error toasts, prices itself and saves history', async () => {
  const f = fakeHost({ cost: 2, percent: 55 })
  await recordTurnStart(f.host, { turnId: 't', text: '' })
  await recordCall(f.host, { tool: 'Read', file_path: '/a', tool_use_id: 'r' }, async () => ({ text: 'x' }))
  f.session.cost = 2.75
  await recordTurnEnd(f.host, { turnId: 't', reason: 'error' })
  expect(f.state.events.value[0]).toMatchObject({ status: 'error', outcome: 'error', costUsd: 0.75, contextPercent: 55 })
  expect(f.state.sessionCost.value).toBe(2.75)
  expect(f.toasts).toContain('› turn ended: API error')
  expect(f.store.has('session:sess')).toBe(true)
})

test('resume aborts rows a previous process left running and reloads cost and history', async () => {
  const f = fakeHost({ cost: 3 })
  f.state.events.value = [row({ id: 'r', status: 'running', endedAt: undefined })]
  f.store.set('sessions', [{ id: 'old', title: '', startedAt: 0, savedAt: 0, calls: 1, problems: 0 }])
  await resume(f.host)
  expect(f.state.events.value[0]?.status).toBe('aborted')
  expect(f.state.sessionCost.value).toBe(3)
  expect(f.state.history.value.map(s => s.id)).toEqual(['old'])
})

test('followEnd scrolls to the end only while following', async () => {
  const f = fakeHost()
  await followEnd(f.host)
  f.advance(100)
  expect(f.scrolls).toEqual(['end'])
  f.state.follow.value = false
  await followEnd(f.host)
  f.advance(100)
  expect(f.scrolls).toHaveLength(1)
})

// ── pane controller ──────────────────────────────────────────────────────────

test('clear needs a second press within the window, and undo brings the rows back', async () => {
  const f = fakeHost()
  const act = paneActions(f.host)
  f.state.events.value = [row({ id: 'a' }), row({ id: 'b' })]

  await act.clear()
  expect(f.state.events.value).toHaveLength(2)
  expect((await readPane(f.host)).confirming).toBe(true)
  f.advance(CLEAR_CONFIRM_MS)
  expect(f.state.confirmClearAt.value).toBe(0)

  await act.clear()
  await act.clear()
  expect(f.state.events.value).toHaveLength(0)
  expect(f.state.cleared.value).toHaveLength(2)

  f.state.events.value = [row({ id: 'new' })]
  await act.undoClear()
  expect(f.state.events.value.map(ev => ev.id)).toEqual(['a', 'b', 'new'])
  expect(f.state.cleared.value).toHaveLength(0)
})

test('clear refuses while a past session is open', async () => {
  const f = fakeHost()
  f.state.archive.value = { id: 'old', title: '', events: [] }
  await paneActions(f.host).clear()
  expect(f.toasts[0]).toContain('Viewing a past session')
})

test('move walks the visible rows and resumes following on the last one', async () => {
  const f = fakeHost()
  const act = paneActions(f.host)
  f.state.events.value = [row({ id: 'p', kind: 'prompt' }), row({ id: 'a' }), row({ id: 'b' })]
  await act.move(1)
  expect(f.state.selected.value).toBe('p')
  expect(f.state.follow.value).toBe(false)
  await act.move(5)
  expect(f.state.selected.value).toBe('b')
  expect(f.state.follow.value).toBe(true)
  expect(f.scrolls.at(-1)).toEqual({ key: 't-b' })
  await act.jumpTop()
  expect(f.state.selected.value).toBe('p')
  expect(f.scrolls.at(-1)).toBe('start')
})

test('fold and focus work from an Agent row or one of its calls', async () => {
  const f = fakeHost()
  const act = paneActions(f.host)
  f.state.events.value = [row({ id: 'ag', kind: 'agent', spawnedAgentId: 'loop' }), row({ id: 'k', agentId: 'loop' }), row({ id: 'x' })]

  await act.toggleFold('x')
  expect(f.toasts.at(-1)).toContain('Select a subagent row')
  await act.toggleFold('ag')
  expect(f.state.collapsed.value).toEqual(['ag'])
  await act.toggleFold('ag')
  expect(f.state.collapsed.value).toEqual([])

  f.state.selected.value = 'k'
  await act.toggleFocus()
  expect(f.state.focused.value).toBe('ag')
  expect((await readPane(f.host)).focusEv?.id).toBe('ag')
  await act.toggleFocus()
  expect(f.state.focused.value).toBe('')
  expect(f.state.follow.value).toBe(true)
})

test('toggleOpen expands a row, and in History opens the session', async () => {
  const f = fakeHost({ sessionId: 'live' })
  const act = paneActions(f.host)
  f.state.events.value = [row({ id: 'a' })]
  await act.toggleOpen('a')
  expect(f.state.expanded.value).toBe('a')
  await act.toggleOpen('a')
  expect(f.state.expanded.value).toBe('')

  f.store.set('session:old', { id: 'old', title: 'Old', events: [row({ id: 'z' })] })
  f.state.view.value = 'history'
  await act.toggleOpen('old')
  expect(f.state.archive.value?.title).toBe('Old')
  expect(f.state.view.value).toBe('timeline')

  f.state.view.value = 'history'
  await act.toggleOpen('gone')
  expect(f.toasts.at(-1)).toBe('That session is no longer saved.')

  await act.openSession('live')
  expect(f.state.archive.value).toBeNull()
})

test('copy puts a row’s arguments and result on the clipboard', async () => {
  const f = fakeHost()
  const act = paneActions(f.host)
  await act.copy(press)
  expect(f.toasts.at(-1)).toBe('Select a row first (j/k).')
  f.state.events.value = [row({ id: 'a', name: 'Bash', args: '{"command":"ls"}', output: 'out' })]
  await act.copy(press, 'a')
  expect(f.copies[0]).toContain('Arguments:\n{"command":"ls"}')
  expect(f.copies[0]).toContain('Result:\nout')
  expect(f.toasts.at(-1)).toBe('Copied Bash')
})

test('view, filter, query and sort setters', async () => {
  const f = fakeHost()
  const act = paneActions(f.host)
  await act.toggleStats()
  expect(f.state.view.value).toBe('stats')
  await act.toggleStats()
  expect(f.state.view.value).toBe('timeline')
  await act.toggleHistory()
  expect(f.state.view.value).toBe('history')
  await act.toggleHistory()
  expect(f.state.view.value).toBe('timeline')
  await act.setFilter('mcp')
  await act.setQuery('grep')
  await act.cycleSort()
  const m = await readPane(f.host)
  expect([m.filter, m.query, m.sort]).toEqual(['mcp', 'grep', 'count'])
})
