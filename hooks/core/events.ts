import type { TurnStepInput, TurnStepResult, TurnUsage } from 'claude-code'

import type { EventKind, EventStatus, TimelineEvent, Tokens } from '../../types'
import { compact, oneLine } from './format'
import { ARGS_CAP, argsJson, clean, OUTPUT_CAP, sanitize } from './redact'

/**
 * Turning what the engine reports (a prompt, a tool call, a model request) into timeline rows. Every
 * piece of text goes through `clean`, so nothing here can store raw input.
 */

const rand = () => Math.random().toString(36).slice(2, 8)
/** A row id unique within the session: `<prefix>-<at>-<random>`. */
export const newId = (prefix: string, at: number) => `${prefix}-${at}-${rand()}`

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const baseName = (p: string) => p.split('/').pop() ?? p

/** MCP servers' display names, by the server segment of their tools' wire names (`mcp__<server>__<tool>`). */
export type ServerNames = Record<string, string>

/** The server segment of an MCP tool's wire name, or '' for any other tool. */
export const mcpServerOf = (tool: string) => (tool.startsWith('mcp__') ? (tool.split('__')[1] ?? '') : '')

/**
 * How an MCP server is named in a row: its display name when known (a connector's `claude.ai ` prefix
 * dropped, so `claude.ai Gmail` is `Gmail`), else the head of its wire name, which for a connector is an id.
 */
function serverLabel(server: string, names: ServerNames = {}) {
  const known = sanitize(names[server] ?? '').replace(/^claude\.ai\s+/i, '')
  return known || server.slice(0, 16)
}

/**
 * An MCP row's name with its server's display name, for rows recorded before the name was known. Those
 * carry the head of the wire name, so any server whose wire name starts with it matches.
 */
export function relabelMcp(ev: TimelineEvent, names: ServerNames): TimelineEvent {
  if (ev.kind !== 'mcp') return ev
  const [head = '', ...rest] = ev.name.split(' › ')
  if (!rest.length || head.length < 16) return ev
  const server = Object.keys(names).find(s => s !== head && s.slice(0, 16) === head)
  return server ? { ...ev, name: [serverLabel(server, names), ...rest].join(' › ') } : ev
}

/** What a call is, and the one argument worth showing beside its name. */
export function describe(
  e: { tool: string; [k: string]: unknown },
  servers: ServerNames = {},
): { kind: EventKind; name: string; detail: string } {
  const t = sanitize(e.tool)
  if (t === 'Skill') return { kind: 'skill', name: sanitize(str(e.skill)) || 'skill', detail: str(e.args) }
  if (t === 'Agent' || t === 'Task')
    return { kind: 'agent', name: sanitize(str(e.subagent_type)) || 'agent', detail: str(e.description) }
  if (t.startsWith('mcp__')) {
    const [, server = '', ...rest] = t.split('__')
    return { kind: 'mcp', name: `${serverLabel(server, servers)} › ${rest.join('__')}`, detail: '' }
  }
  const detail =
    str(e.command) ||
    (str(e.file_path) && baseName(str(e.file_path))) ||
    str(e.pattern) ||
    str(e.url) ||
    str(e.query) ||
    str(e.description) ||
    str(e.prompt)
  return { kind: 'tool', name: t, detail }
}

/** A prompt row. `fallback` names it when there is no text: an empty prompt, or a turn with none. */
export function promptRow(text: string, at: number, fallback: string): TimelineEvent {
  return {
    id: newId('prompt', at),
    kind: 'prompt',
    name: oneLine(clean(text, 200), 60) || fallback,
    detail: '',
    startedAt: at,
    endedAt: at,
    status: 'ok',
    args: text ? clean(text, ARGS_CAP) : undefined,
  }
}

/** A running row for a tool, skill, MCP or Agent call. */
export function callRow(
  input: { tool: string; tool_use_id?: string; agentId?: string; [k: string]: unknown },
  at: number,
  servers?: ServerNames,
): TimelineEvent {
  const { kind, name, detail } = describe(input, servers)
  return {
    id: input.tool_use_id || newId('call', at),
    kind,
    name,
    detail: oneLine(clean(detail, 200)),
    startedAt: at,
    status: 'running',
    agentId: input.agentId,
    args: argsJson(input),
  }
}

/** A finished call's fields: how it ended and the head of what it returned. */
export function callResult(status: EventStatus, full: string, at: number): Partial<TimelineEvent> {
  return { endedAt: at, status, output: clean(full, OUTPUT_CAP), outputChars: full.length }
}

/** A skill run by slash command: it never goes through the Skill tool, so it is a done row of its own. */
export function skillCommandRow(skill: string, at: number): TimelineEvent {
  return { id: newId('skill', at), kind: 'skill', name: sanitize(skill), detail: '/ command', startedAt: at, endedAt: at, status: 'ok' }
}

export const modelName = (id: string) => sanitize(id).replace(/^claude-/, '').replace(/-\d{8}$/, '') || 'model'

const tokensOf = (u: TurnUsage): Tokens => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})
/** Everything the request was answered over: uncached, cache-read and cache-written. */
export const tokensIn = (t: Tokens) => t.input + t.cacheRead + t.cacheWrite

function stepDetail(index: number, tokens: Tokens | undefined, stop: string | undefined) {
  const parts = [`step ${index + 1}`]
  if (tokens) {
    parts.push(`${compact(tokensIn(tokens))} in${tokens.cacheRead ? ` (${compact(tokens.cacheRead)} cached)` : ''}`)
    parts.push(`${compact(tokens.output)} out`)
  }
  if (stop) parts.push(stop === 'tool_use' ? '→ tools' : stop === 'end_turn' ? '→ answer' : stop)
  return parts.join(' · ')
}

/** A running row for one model request. */
export function stepRow(e: TurnStepInput, at: number): TimelineEvent {
  return {
    id: newId(`step-${e.index}`, at),
    kind: 'model',
    name: modelName(e.model),
    detail: `step ${e.index + 1} · ${e.messageCount} messages${e.effort !== undefined ? ` · effort ${e.effort}` : ''}`,
    startedAt: at,
    status: 'running',
    agentId: e.agentId,
  }
}

/** A finished model request's fields. A request with no stop reason never answered: aborted or failed. */
export function stepResult(row: TimelineEvent, index: number, r: TurnStepResult, aborted: boolean): Partial<TimelineEvent> {
  const tokens = r.usage ? tokensOf(r.usage) : undefined
  const stop = r.stopReason ?? undefined
  const status: EventStatus = r.stopReason === null ? (aborted ? 'aborted' : 'error') : r.stopReason === 'refusal' ? 'error' : 'ok'
  return {
    name: r.usage ? modelName(r.usage.model) : row.name,
    status,
    tokens,
    stopReason: stop,
    detail: r.stopReason === null ? `step ${index + 1} · no response` : stepDetail(index, tokens, stop),
  }
}

/** A failed model request's fields. */
export const stepFailure = (err: unknown): Partial<TimelineEvent> => ({ status: 'error', output: clean(String(err), OUTPUT_CAP) })
