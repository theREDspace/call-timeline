import type { TimelineEvent } from '../../types'
import { BIG_OUTPUT, clock, compact, duration, GLYPHS, plural, stamp } from './format'
import { arrange } from './layout'
import { isCall, loopLabel } from './timeline'
import { OUTCOME_LABEL, turnSummary, turnsOf } from './turns'

/** What an export writes and where: the file's text, built from rows alone, with no I/O. */

const EXPORT_DIR = '.claude/call-timeline'

export function toMarkdown(list: readonly TimelineEvent[], now: number, title = 'Call timeline') {
  const { byPrompt } = turnsOf(list, now)
  const lines = [`# ${title}`, '', `Exported ${new Date(now).toISOString()} · ${plural(list.filter(isCall).length, 'call')}`, '']
  for (const { ev, depth, orphan } of arrange(list, [])) {
    if (ev.kind === 'prompt') {
      lines.push('', `## ${clock(ev.startedAt)} › ${ev.name}`, '')
      const summary = turnSummary(ev, byPrompt.get(ev.id))
      const outcome = ev.outcome ? OUTCOME_LABEL[ev.outcome] : ''
      const problems = byPrompt.get(ev.id)?.problems ?? 0
      const tail = [summary, problems ? plural(problems, 'error') : '', outcome].filter(Boolean).join(' · ')
      if (tail) lines.push(`_${tail}_`, '')
      continue
    }
    const ms = (ev.endedAt ?? now) - ev.startedAt
    const status = ev.status === 'ok' ? duration(ms) : `**${ev.status}** · ${duration(ms)}`
    const size = ev.outputChars && ev.outputChars >= BIG_OUTPUT ? ` · ${compact(ev.outputChars)} ch` : ''
    const repeat = ev.repeat ? ` · ↻${ev.repeat}` : ''
    const detail = ev.detail ? ` — \`${ev.detail.replace(/`/g, "'")}\`` : ''
    const owner = orphan ? ` · (subagent ${loopLabel(ev)})` : ''
    lines.push(`${'  '.repeat(depth)}- ${clock(ev.startedAt)} ${GLYPHS[ev.kind]} **${ev.name}** ${status}${size}${repeat}${owner}${detail}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * The export file for `arg` (`md`, `json`, or a path whose extension picks the format) over `list`.
 * `past` is the archived session being viewed, if any: it names the file's title and default stamp.
 */
export function exportFile(arg: string, list: readonly TimelineEvent[], now: number, past?: { id: string; title: string }) {
  let format: 'md' | 'json' = 'md'
  let path = ''
  for (const word of arg.split(/\s+/).filter(Boolean)) {
    if (word === 'md' || word === 'json') format = word
    else path = word
  }
  if (path) format = /\.json$/i.test(path) ? 'json' : 'md'
  else path = `${EXPORT_DIR}/timeline-${stamp(past ? (list[0]?.startedAt ?? now) : now)}.${format}`
  const text =
    format === 'json'
      ? `${JSON.stringify({ exportedAt: now, session: past?.id, events: list }, null, 2)}\n`
      : toMarkdown(list, now, past ? `Call timeline: ${past.title}` : undefined)
  return { path, format, text }
}
