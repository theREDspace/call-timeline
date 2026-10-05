import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { SessionSummary, TimelineEvent } from '../types'

/** The engine's ops the plugin calls, answered from memory: store, session, ui. */
function world(on: On, session: { id: string; cost?: () => number | undefined; percent?: number }) {
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.id', async () => ({ value: session.id }))
  on('session.usage', async () => {
    const usd = session.cost?.()
    return {
      value: {
        startedAt: 0,
        context: { window: 200_000, percent: session.percent },
        rateLimits: [],
        ...(usd === undefined ? {} : { cost: { usd } }),
      },
    }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', async () => ({ value: undefined }))
  on('ui.scroll', async () => ({}))
  /** The timeline as last saved to history: every row, without arguments or results. */
  const saved = () => ((store.get(`session:${session.id}`) as { events?: TimelineEvent[] } | undefined)?.events ?? [])
  return { store, toasts, saved }
}

/** A tool call from a subagent loop, or to a tool this session's types don't list. */
const call = ($: Engine, input: { tool: string; [k: string]: unknown }) => $.tool.call(input as Parameters<Engine['tool']['call']>[0])

const PANE_PROPS = {
  title: 'Call Timeline',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

const STEP_USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 0,
}

test('a turn records model steps, calls, repeats, cost, context and history', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let cost = 1
  const { store, toasts, saved } = world(on, { id: 'sess-1', cost: () => cost, percent: 42 })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    await clock.advance(300)
    yield { kind: 'text', index: 0, text: 'working' }
    await clock.advance(700)
    return { turnId: e.turnId, index: e.index, answer: 'working', toolUses: [], stopReason: 'tool_use', usage: STEP_USAGE }
  })
  on('tool.call', async () => ({ result: null, text: 'x'.repeat(5000), isError: true }))
  on('turn.complete', async () => ({ text: '' }))

  await $.prompt.submit({ text: 'run the tests', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'run the tests', turnId: 'turn-1' })
  for await (const _ of $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-opus-5-5', messageCount: 3 })) {
    // drain
  }
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: `t${i}` })
  cost = 1.25
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 5000, isAborted: false, reason: 'answer' })

  const list = saved()
  const prompt = list.find(ev => ev.kind === 'prompt')
  expect(prompt?.turnId).toBe('turn-1')
  expect(prompt?.status).toBe('ok')
  expect(prompt?.outcome).toBe('answer')
  expect(prompt?.costUsd).toBe(0.25)
  expect(prompt?.contextPercent).toBe(42)

  const step = list.find(ev => ev.kind === 'model')
  expect(step?.name).toBe('opus-5-5')
  expect(step?.status).toBe('ok')
  expect(step!.firstAt! - step!.startedAt).toBe(300)
  expect(step?.tokens).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 0 })

  const bash = list.filter(ev => ev.name === 'Bash')
  expect(bash.map(ev => ev.repeat)).toEqual([undefined, 2, 3])
  expect(bash[0]?.outputChars).toBe(5000)
  expect(bash[0]?.status).toBe('error')
  expect(toasts.some(t => t.includes('failed 3×'))).toBe(true)

  const index = store.get('sessions') as SessionSummary[]
  expect(index[0]?.id).toBe('sess-1')
  expect(index[0]?.calls).toBe(3)
  expect(list.every(ev => ev.args === undefined && ev.output === undefined)).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'call-timeline', surface, component: 'Pane', requestId: 'timeline', props: {
        title: 'Call Timeline',
        isFocused: false,
        bodyColumns: 100,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /· 1 step ·/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.25/ })).toBeDefined()
  }
})

test('an interrupted turn marks its running calls aborted', async ($, on) => {
  mock.clock(on, { now: 2_000_000 })
  const { saved } = world(on, { id: 'sess-2' })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  let release: () => void = () => {}
  on('tool.call', () => new Promise(resolve => (release = () => resolve({ result: null, text: 'late' }))))

  await $.turn.start({ text: '', turnId: 'turn-2' })
  const pending = $.tool.call({ tool: 'Bash', command: 'sleep 100', tool_use_id: 'slow' })
  await $.turn.complete({ turnId: 'turn-2', answer: '', durationMs: 100, isAborted: true, reason: 'aborted' })

  const list = saved()
  expect(list.find(ev => ev.kind === 'prompt')?.name).toBe('(continuation)')
  expect(list.find(ev => ev.kind === 'prompt')?.outcome).toBe('aborted')
  expect(list.find(ev => ev.id === 'slow')?.status).toBe('aborted')
  release()
  await pending
})

test('subagent calls nest under their Agent row, survive filters, and can be focused', async ($, on) => {
  mock.clock(on, { now: 3_000_000 })
  world(on, { id: 'sess-3' })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'loop-explore' }))
  let finishAgent: () => void = () => {}
  on('tool.call', async (_$, e) =>
    e.tool === 'Agent'
      ? new Promise(resolve => (finishAgent = () => resolve({ result: null, text: 'found it' })))
      : { result: null, text: 'ok' },
  )

  await $.turn.start({ text: 'look around', turnId: 'turn-3' })
  const agent = $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'find the config', prompt: 'p', tool_use_id: 'a1' })
  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'p',
    description: 'find the config',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  await call($, { tool: 'Read', file_path: '/repo/a.ts', tool_use_id: 'r1', agentId: 'loop-explore' })
  await call($, { tool: 'mcp__gh__search', query: 'x', tool_use_id: 'm1', agentId: 'loop-explore' })
  await call($, { tool: 'Grep', pattern: 'y', tool_use_id: 'r2', agentId: 'loop-gone' })
  finishAgent()
  await agent

  const ui = await $.ui.mount({ plugin: 'call-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: {
      title: 'Call Timeline',
      isFocused: true,
      bodyColumns: 100,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 60 },
      view: {},
    },
  })
  // Connectors tie the subagent's calls to its row; the call whose Agent row is unknown names its loop.
  expect(await ui.find({ type: 'Text', text: /├─/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /└─/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(subagent loop-gon\)/ })).toBeDefined()

  // MCP only: the Agent row stays as context, so the MCP call still sits under it.
  await ui.press({ key: 'f-mcp' })
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Read$/ })).toBeUndefined()
  await ui.press({ key: 'f-all' })

  // Focus narrows to the subagent and everything under it.
  // The harness has no scroll site for the pane, so the press's scroll to the top fails after focusing.
  await ui.press({ key: 'i-a1' }).catch(() => {})
  expect(await ui.find({ type: 'Text', text: /Focused: ▲ Explore/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Read$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Grep$/ })).toBeUndefined()
  await ui.press({ key: 'unfocus' }).catch(() => {})
  expect(await ui.find({ type: 'Text', text: /^Grep$/ })).toBeDefined()
})

test('/timeline opens the pane, exports, and opens history', async ($, on) => {
  mock.clock(on, { now: 4_000_000 })
  const { store } = world(on, { id: 'sess-4' })
  const files = new Map<string, string>()
  let opened = 0
  on('fs.write', async (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('ui.open', async () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('tool.call', async () => ({ result: null, text: 'ok' }))
  const run = (args: string) =>
    $.command.run({ command: 'timeline', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  await $.turn.start({ text: 'export me', turnId: 'turn-4' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'b1' })
  await $.turn.complete({ turnId: 'turn-4', answer: '', durationMs: 10, isAborted: false, reason: 'answer' })

  expect((await run('export out/t.json')).text).toBe('Exported 2 events to /repo/out/t.json')
  // The engine resolves a relative path against the working directory before writing.
  const written = [...files].find(([path]) => path.endsWith('/out/t.json'))?.[1]
  expect((JSON.parse(written ?? '{}') as { events: unknown[] }).events).toHaveLength(2)
  expect((await run('export')).text).toMatch(/\.claude\/call-timeline\/timeline-\d{8}-\d{6}\.md$/)

  expect((await run('')).text).toBe('Timeline pane opened.')
  expect((await run('history')).text).toBe('Timeline history opened.')
  expect(opened).toBe(2)
  expect((store.get('sessions') as SessionSummary[])[0]?.id).toBe('sess-4')

  // The history view lists this session, marked as the current one.
  const ui = await $.ui.mount({ plugin: 'call-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /export me \(this session\)/ })).toBeDefined()
})

test('a slash-command skill gets a row; the stats view totals by name', async ($, on) => {
  mock.clock(on, { now: 5_000_000 })
  world(on, { id: 'sess-5' })
  on('skill.prompt', async (_$, e) => ({ text: e.text }))
  on('tool.call', async (_$, e) => (e.tool === 'Bash' ? { result: null, text: 'no', isError: true } : { result: null, text: 'ok' }))

  await $.skill.prompt({ skill: 'pdf', text: 'run' })
  await $.tool.call({ tool: 'Bash', command: 'a', tool_use_id: 'b1' })
  await $.tool.call({ tool: 'Bash', command: 'b', tool_use_id: 'b2' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'call-timeline', surface, component: 'Pane', requestId: 'timeline', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /^pdf$/ })).toBeDefined()
    await ui.press({ key: 'v-stats' })
    expect(await ui.find({ type: 'Text', text: /^P95$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /★ pdf/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● Bash/ })).toBeDefined()
    // Only errors: the skill drops out of the totals.
    await ui.press({ key: 'f-errors' })
    expect(await ui.find({ type: 'Text', text: /★ pdf/ })).toBeUndefined()
    await ui.press({ key: 'f-all' })
    await ui.press({ key: 'v-stats' })
  }
})

test('a wide pane opens rows in a details column beside the list', async ($, on) => {
  mock.clock(on, { now: 6_000_000 })
  world(on, { id: 'sess-6' })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ result: null, text: 'all green' }))

  await $.turn.start({ text: 'check', turnId: 'turn-6' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', tool_use_id: 'r1' })

  const wide = { ...PANE_PROPS, bodyColumns: 240, scroll: { offset: 0, bodyRows: 40 } }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'call-timeline', surface, component: 'Pane', requestId: 'timeline', props: wide })
    // Nothing picked: the column shows the latest call, and no row opens inline.
    expect(await ui.find({ type: 'Text', text: /latest, j\/k to pick/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Arguments$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /all green/ })).toBeDefined()
    // Wide, each turn gets a time axis, and the counts read in the singular where they should.
    expect(await ui.find({ type: 'Text', text: /^0─+/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 calls · 0 running · 0 errors$/ })).toBeDefined()
    await ui.unmount()
  }

  // Opening a row pins the column to it.
  const ui = await $.ui.mount({ plugin: 'call-timeline', surface: 'desktop', component: 'Pane', requestId: 'timeline', props: wide })
  await ui.press({ key: 't-b1' })
  expect(await ui.find({ type: 'Text', text: /latest, j\/k to pick/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /^Arguments$/ })).toHaveLength(1)
  await ui.unmount()

  // Below the split width, the open row's details are back under it.
  const narrow = await $.ui.mount({ plugin: 'call-timeline', surface: 'terminal', component: 'Pane', requestId: 'timeline', props: PANE_PROPS })
  expect(await narrow.find({ type: 'Text', text: /latest, j\/k to pick/ })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /^Arguments$/ })).toBeDefined()
})
