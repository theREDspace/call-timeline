import { expect, test } from 'claude-code/testing'

import { callRow, describe, modelName, promptRow, stepResult, stepRow } from '../hooks/core/events'
import { exportFile, toMarkdown } from '../hooks/core/export'
import { compact, duration, oneLine, usd } from '../hooks/core/format'
import { arrange, visibleOf } from '../hooks/core/layout'
import { argsJson, clean, sanitize } from '../hooks/core/redact'
import { nextSort, outLabel, statsOf } from '../hooks/core/stats'
import {
  agentRootOf,
  append,
  appendCall,
  capped,
  finishTurn,
  hasRecentSkill,
  interrupt,
  MAX_EVENTS,
  patchIn,
  sameFailures,
  startTurn,
} from '../hooks/core/timeline'
import { turnSummary, turnsOf, waterfall } from '../hooks/core/turns'
import type { TimelineEvent } from '../types'
import { row } from './fake-host'

const USAGE = { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }

// ── redact ───────────────────────────────────────────────────────────────────

test('sanitize strips terminal escapes, control characters and bidi overrides but keeps tabs and newlines', async () => {
  expect(sanitize('a\x1b[31mred\x1b[0m\tb\nc\x07‮evil\x1b]52;c;Zm9v\x07d')).toBe('ared\tb\ncevild')
})

test('clean redacts common secrets', async () => {
  const text = [
    'key sk-ant-abcdefghijklmnop',
    'gh ghp_abcdefghijklmnop1234',
    'aws AKIAABCDEFGHIJKLMNOP',
    'auth Bearer abcdefgh12345678',
    'url https://user:hunter22@example.com/x',
    'password=supersecret',
    '--token abc123def',
  ].join('\n')
  const out = clean(text, 2000)
  for (const leak of ['abcdefghijklmnop', 'ABCDEFGHIJKLMNOP', 'abcdefgh12345678', 'hunter22', 'supersecret', 'abc123def']) {
    expect(out.includes(leak)).toBe(false)
  }
  expect(out).toContain('sk-ant-***')
  expect(out).toContain('https://***:***@example.com')
})

test('clean caps long text and says how much was cut', async () => {
  const out = clean('x'.repeat(5000), 100)
  expect(out.startsWith('x'.repeat(100))).toBe(true)
  expect(out).toContain('(4900 more chars)')
})

test('argsJson masks secret fields, trims bulky ones, and leaves out engine bookkeeping', async () => {
  const json = argsJson({ tool: 'Write', tool_use_id: 't1', agentId: 'a', file_path: '/x', content: 'y'.repeat(500), api_key: 'k' })
  const parsed = JSON.parse(json) as Record<string, string>
  expect(parsed.tool).toBeUndefined()
  expect(parsed.tool_use_id).toBeUndefined()
  expect(parsed.api_key).toBe('***')
  expect(parsed.content).toContain('(500 chars)')
  expect(parsed.file_path).toBe('/x')
})

// ── format ───────────────────────────────────────────────────────────────────

test('format helpers', async () => {
  expect(duration(250)).toBe('250ms')
  expect(duration(1540)).toBe('1.5s')
  expect(duration(119_600)).toBe('2m0s')
  expect(compact(999)).toBe('999')
  expect(compact(1500)).toBe('1.5k')
  expect(compact(25_000)).toBe('25k')
  expect(compact(2_500_000)).toBe('2.5M')
  expect(usd(0.004)).toBe('<$0.01')
  expect(usd(1.234)).toBe('$1.23')
  expect(oneLine('a\n  b   c', 4)).toBe('a b…')
})

// ── events ───────────────────────────────────────────────────────────────────

test('describe names each kind of call and picks the argument worth showing', async () => {
  expect(describe({ tool: 'Skill', skill: 'pdf', args: 'x.pdf' })).toEqual({ kind: 'skill', name: 'pdf', detail: 'x.pdf' })
  expect(describe({ tool: 'Agent', subagent_type: 'Explore', description: 'look' })).toEqual({ kind: 'agent', name: 'Explore', detail: 'look' })
  expect(describe({ tool: 'mcp__github__search_issues' })).toEqual({ kind: 'mcp', name: 'github › search_issues', detail: '' })
  expect(describe({ tool: 'Read', file_path: '/a/b/c.ts' }).detail).toBe('c.ts')
  expect(describe({ tool: 'Bash', command: 'ls' }).detail).toBe('ls')
})

test('row builders', async () => {
  const p = promptRow('', 5, '(empty prompt)')
  expect(p.name).toBe('(empty prompt)')
  expect(p.args).toBeUndefined()
  const c = callRow({ tool: 'Bash', command: 'npm test', tool_use_id: 'u1', agentId: 'loop' }, 7)
  expect(c).toMatchObject({ id: 'u1', kind: 'tool', status: 'running', agentId: 'loop', detail: 'npm test' })
  expect(modelName('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
})

test('stepResult reads status and detail off the stop reason', async () => {
  const s = stepRow({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 2 }, 0)
  const base = { turnId: 't', index: 0, answer: '', toolUses: [] }
  expect(stepResult(s, 0, { ...base, stopReason: 'tool_use', usage: USAGE }, false)).toMatchObject({
    status: 'ok',
    detail: 'step 1 · 1.1k in (1.0k cached) · 50 out · → tools',
  })
  expect(stepResult(s, 0, { ...base, stopReason: 'refusal', usage: USAGE }, false).status).toBe('error')
  expect(stepResult(s, 0, { ...base, stopReason: null, usage: null }, true)).toMatchObject({ status: 'aborted', detail: 'step 1 · no response' })
  expect(stepResult(s, 0, { ...base, stopReason: null, usage: null }, false).status).toBe('error')
})

// ── timeline ─────────────────────────────────────────────────────────────────

test('capped keeps the newest rows and never leaves a call without its prompt', async () => {
  const list: TimelineEvent[] = []
  for (let i = 0; i < MAX_EVENTS + 5; i++) list.push(row({ id: `r${i}`, kind: i % 10 === 0 ? 'prompt' : 'tool' }))
  const kept = capped(list)
  expect(kept.length).toBeLessThanOrEqual(MAX_EVENTS)
  expect(kept[0]?.kind).toBe('prompt')
  expect(kept.at(-1)?.id).toBe(`r${MAX_EVENTS + 4}`)
})

test('appendCall counts identical calls within the turn only', async () => {
  const call = (id: string) => row({ id, args: '{"command":"ls"}' })
  let list = append(row({ id: 'p1', kind: 'prompt' }))([])
  list = appendCall(call('a'))(list)
  list = appendCall(call('b'))(list)
  expect(list.map(ev => ev.repeat)).toEqual([undefined, undefined, 2])
  list = append(row({ id: 'p2', kind: 'prompt' }))(list)
  list = appendCall(call('c'))(list)
  expect(list.at(-1)?.repeat).toBeUndefined()
})

test('append names the subagent a call ran under', async () => {
  const list = [row({ id: 'ag', kind: 'agent', name: 'Explore', spawnedAgentId: 'loop' })]
  expect(append(row({ id: 'r', agentId: 'loop' }))(list).at(-1)?.agentName).toBe('Explore')
})

test('sameFailures counts only failed identical calls this turn', async () => {
  const list = [
    row({ id: 'p', kind: 'prompt' }),
    row({ id: 'a', args: 'x', status: 'error' }),
    row({ id: 'b', args: 'x', status: 'ok' }),
    row({ id: 'c', args: 'x', status: 'error' }),
    row({ id: 'd', args: 'y', status: 'error' }),
  ]
  expect(sameFailures(list, row({ id: 'z', args: 'x' }))).toBe(2)
})

test('patchIn and interrupt', async () => {
  const list = [row({ id: 'a', status: 'running', startedAt: 10, endedAt: undefined }), row({ id: 'b' })]
  expect(patchIn('b', { name: 'X' })(list)[1]?.name).toBe('X')
  expect(patchIn('missing', { name: 'X' })(list)).toBe(list)
  const stopped = interrupt(list)
  expect(stopped[0]).toMatchObject({ status: 'aborted', endedAt: 10, output: '(interrupted)' })
  expect(interrupt(stopped)).toBe(stopped)
})

test('startTurn ties a fresh prompt to the turn, or adds a continuation row', async () => {
  const prompt = { ...promptRow('hi', 1000, ''), turnId: undefined }
  const tied = startTurn([prompt], { turnId: 't1', text: 'hi', at: 2000, costAtStart: 1 })
  expect(tied.added).toBe(false)
  expect(tied.list[0]).toMatchObject({ turnId: 't1', status: 'running', costAtStart: 1, endedAt: undefined })

  const stale = startTurn([prompt], { turnId: 't2', text: '', at: 60_000 })
  expect(stale.added).toBe(true)
  expect(stale.list.at(-1)).toMatchObject({ kind: 'prompt', name: '(continuation)', turnId: 't2', status: 'running' })
})

test('finishTurn closes the prompt with cost and context, and an abort stops what runs', async () => {
  const list = [
    row({ id: 'p', kind: 'prompt', turnId: 't', status: 'running', costAtStart: 1 }),
    row({ id: 'c', status: 'running', endedAt: undefined }),
  ]
  const done = finishTurn({ turnId: 't', outcome: 'aborted', at: 500, cost: 1.5, contextPercent: 30 })(list)
  expect(done[0]).toMatchObject({ status: 'aborted', outcome: 'aborted', endedAt: 500, costUsd: 0.5, contextPercent: 30 })
  expect(done[1]).toMatchObject({ status: 'aborted', endedAt: 500 })
  const ok = finishTurn({ turnId: 't', outcome: 'answer', at: 500 })(list)
  expect(ok[0]?.status).toBe('ok')
  expect(ok[1]?.status).toBe('running')
})

test('hasRecentSkill and agentRootOf', async () => {
  const list = [
    row({ id: 'sk', kind: 'skill', name: 'pdf', startedAt: 1000 }),
    row({ id: 'ag', kind: 'agent', spawnedAgentId: 'loop' }),
    row({ id: 'r', agentId: 'loop' }),
  ]
  expect(hasRecentSkill(list, 'pdf', 3000)).toBe(true)
  expect(hasRecentSkill(list, 'pdf', 9000)).toBe(false)
  expect(agentRootOf(list, 'ag')?.id).toBe('ag')
  expect(agentRootOf(list, 'r')?.id).toBe('ag')
  expect(agentRootOf(list, 'sk')).toBeUndefined()
})

// ── layout ───────────────────────────────────────────────────────────────────

const nested = [
  row({ id: 'p', kind: 'prompt' }),
  row({ id: 'ag', kind: 'agent', name: 'Explore', spawnedAgentId: 'loop' }),
  row({ id: 'main', name: 'Grep' }),
  row({ id: 'k1', name: 'Read', agentId: 'loop' }),
  row({ id: 'k2', kind: 'mcp', name: 'gh › search', agentId: 'loop' }),
  row({ id: 'lost', name: 'Glob', agentId: 'gone' }),
]

test('arrange nests a subagent’s calls under its Agent row and folds them away', async () => {
  expect(arrange(nested, []).map(r => `${r.ev.id}:${r.depth}`)).toEqual(['p:0', 'ag:0', 'k1:1', 'k2:1', 'main:0', 'lost:1'])
  const folded = arrange(nested, ['ag'])
  expect(folded.map(r => r.ev.id)).toEqual(['p', 'ag', 'main', 'lost'])
  expect(folded.find(r => r.ev.id === 'ag')?.descendants).toBe(2)
  expect(folded.find(r => r.ev.id === 'lost')?.orphan).toBe(true)
})

test('visibleOf draws tree connectors, keeps Agent rows as context, and narrows to a focus', async () => {
  const all = visibleOf(nested, 'all', '', [])
  expect(all.map(r => r.tree)).toEqual(['', '', '├─', '└─', '', '┆ '])

  const mcp = visibleOf(nested, 'mcp', '', [])
  expect(mcp.map(r => `${r.ev.id}${r.context ? '*' : ''}`)).toEqual(['p', 'ag*', 'k2'])

  // A search looks inside folded groups; unlike a filter, it hides prompts that don't match.
  expect(visibleOf(nested, 'all', 'read', ['ag']).map(r => `${r.ev.id}${r.context ? '*' : ''}`)).toEqual(['ag*', 'k1'])

  const focus = visibleOf(nested, 'all', '', [], 'ag')
  expect(focus.map(r => `${r.ev.id}:${r.depth}`)).toEqual(['ag:0', 'k1:1', 'k2:1'])
})

// ── turns ────────────────────────────────────────────────────────────────────

test('turnsOf totals each turn, and turnSummary says it in one line', async () => {
  const list = [
    row({ id: 'p', kind: 'prompt', startedAt: 0, endedAt: 4000, costUsd: 0.25, contextPercent: 40 }),
    row({ id: 'm', kind: 'model', startedAt: 0, endedAt: 1000, tokens: { input: 100, output: 50, cacheRead: 900, cacheWrite: 0 } }),
    row({ id: 'c', startedAt: 1000, endedAt: 3000, status: 'error' }),
  ]
  const { byPrompt, turnOf } = turnsOf(list, 9999)
  const t = byPrompt.get('p')
  expect(t).toMatchObject({ start: 0, end: 4000, calls: 1, steps: 1, problems: 1, tokIn: 1000, tokOut: 50 })
  expect(turnOf.get('c')).toBe(t)
  expect(turnSummary(list[0]!, t)).toBe('4.0s · 1 calls · 1 steps · 1.0k→50 tok · $0.25 · ctx 40%')
})

test('waterfall places a bar within its turn and splits a model step at its first token', async () => {
  const turn = { start: 0, end: 1000, calls: 0, steps: 1, problems: 0, tokIn: 0, tokOut: 0 }
  expect(waterfall(row({ id: 'c', startedAt: 500, endedAt: 1000 }), turn, 0, 10)).toEqual({ lead: 5, wait: 0, run: 5 })
  expect(waterfall(row({ id: 'm', kind: 'model', startedAt: 0, firstAt: 300, endedAt: 1000 }), turn, 0, 10)).toEqual({ lead: 0, wait: 3, run: 7 })
  // Always at least one cell, even for an instant call at the turn's end.
  expect(waterfall(row({ id: 'z', startedAt: 1000, endedAt: 1000 }), turn, 0, 10)).toEqual({ lead: 9, wait: 0, run: 1 })
})

// ── stats ────────────────────────────────────────────────────────────────────

test('statsOf aggregates per name, and sorts by the chosen column', async () => {
  const list = [
    row({ id: 'a', name: 'Bash', startedAt: 0, endedAt: 100, outputChars: 10 }),
    row({ id: 'b', name: 'Bash', startedAt: 0, endedAt: 300, status: 'error' }),
    row({ id: 'c', name: 'Read', startedAt: 0, endedAt: 1000, status: 'denied' }),
    row({ id: 'm', kind: 'model', name: 'opus', startedAt: 0, endedAt: 50, tokens: { input: 1, output: 7, cacheRead: 0, cacheWrite: 0 } }),
    row({ id: 'p', kind: 'prompt' }),
  ]
  const byTotal = statsOf(list, 0, 'total')
  expect(byTotal.map(s => s.name)).toEqual(['Read', 'Bash', 'opus'])
  expect(byTotal[1]).toMatchObject({ count: 2, total: 400, max: 300, p95: 300, out: 10, errors: 1 })
  expect(byTotal[0]?.denied).toBe(1)
  expect(byTotal[2]?.out).toBe(7)
  expect(statsOf(list, 0, 'name').map(s => s.name)).toEqual(['Bash', 'opus', 'Read'])
  expect(statsOf(list, 0, 'count')[0]?.name).toBe('Bash')
})

test('nextSort cycles and outLabel picks the unit', async () => {
  expect(nextSort('total')).toBe('count')
  expect(nextSort('name')).toBe('total')
  expect(outLabel('model', 1500)).toBe('1.5k tok')
  expect(outLabel('tool', 20)).toBe('20 ch')
  expect(outLabel('tool', 0)).toBe('—')
})

// ── export ───────────────────────────────────────────────────────────────────

test('toMarkdown writes turns as headings and calls as nested bullets', async () => {
  const md = toMarkdown(
    [
      row({ id: 'p', kind: 'prompt', name: 'fix it', status: 'aborted', outcome: 'aborted' }),
      row({ id: 'ag', kind: 'agent', name: 'Explore', spawnedAgentId: 'loop', detail: 'find `x`' }),
      row({ id: 'k', name: 'Read', agentId: 'loop', status: 'error', outputChars: 5000, repeat: 2 }),
    ],
    0,
  )
  expect(md).toContain('# Call timeline')
  expect(md).toContain('› fix it')
  expect(md).toContain('interrupted')
  expect(md).toContain("**Explore** 0ms — `find 'x'`")
  expect(md).toContain('  - ')
  expect(md).toContain('**error** · 0ms · 5.0k ch · ↻2')
})

test('exportFile picks format and path from its argument', async () => {
  const list = [row({ id: 'a' })]
  expect(exportFile('', list, 0).path).toMatch(/^\.claude\/call-timeline\/timeline-\d{8}-\d{6}\.md$/)
  const json = exportFile('json', list, 0)
  expect(json.format).toBe('json')
  expect((JSON.parse(json.text) as { events: unknown[] }).events).toHaveLength(1)
  expect(exportFile('out/run.json', list, 0)).toMatchObject({ path: 'out/run.json', format: 'json' })
  expect(exportFile('md out/run.txt', list, 0)).toMatchObject({ path: 'out/run.txt', format: 'md' })
  expect(exportFile('', list, 0, { id: 's', title: 'old' }).text).toContain('# Call timeline: old')
})
