import type { TurnStepInput, TurnStepResult } from 'claude-code'

import type { EventStatus, TurnOutcome } from '../../types'
import { callResult, callRow, promptRow, skillCommandRow, stepFailure, stepResult, stepRow } from '../core/events'
import { GLYPHS } from '../core/format'
import { append, appendCall, finishTurn, hasRecentSkill, interrupt, sameFailures, startTurn } from '../core/timeline'
import { OUTCOME_LABEL } from '../core/turns'
import { refreshHistory, trySaveSession } from './history'
import type { Host } from './host'
import { followEnd, patch, showRunning, updateRows } from './rows'

/**
 * Records what the session does: prompts, turns, model requests, tool calls, subagents and slash-command
 * skills become rows in the timeline, and each turn's end saves the session to history. Each function
 * stands for one engine event; the hooks in `register.tsx` only hand them the event.
 */

/** The same call failing this many times in one turn raises a toast. */
const LOOP_TOAST_AT = 3

// Module-local: only drives skill de-duplication, so a reload resetting it is harmless.
const skillsInFlight = new Map<string, number>()

/**
 * Picks up where a previous load left off: rows still marked running belong to a process that is gone,
 * and the history index and session cost are read back into state.
 */
export async function resume(host: Host) {
  // After a hot reload the old module's hook may still finish a row, and its own update then overwrites this.
  showRunning(host, await host.events.set(interrupt))
  await host.cleared.set(interrupt)
  await refreshHistory(host)
  const cost = (await host.usage()).cost?.usd
  if (cost !== undefined) await host.sessionCost.set(() => cost)
}

/** A prompt the person submitted. */
export async function recordPrompt(host: Host, text: string) {
  await host.events.set(append(promptRow(text, await host.now(), '(empty prompt)')))
  await followEnd(host)
}

/** A turn starting: ties it to its prompt, or gives it a `(continuation)` row. */
export async function recordTurnStart(host: Host, e: { turnId: string; text: string }) {
  const at = await host.now()
  const costAtStart = (await host.usage()).cost?.usd
  let added = false
  await host.events.set(list => {
    const started = startTurn(list, { turnId: e.turnId, text: e.text, at, costAtStart })
    added = started.added
    return started.list
  })
  if (added) await followEnd(host)
}

/** A main-loop turn ending: closes its prompt row, says if it went wrong, and saves history. */
export async function recordTurnEnd(host: Host, e: { turnId: string; reason: TurnOutcome }) {
  const usage = await host.usage()
  const cost = usage.cost?.usd
  const outcome = e.reason
  showRunning(host, await updateRows(host, finishTurn({ turnId: e.turnId, outcome, at: await host.now(), cost, contextPercent: usage.context.percent })))
  if (cost !== undefined) await host.sessionCost.set(() => cost)
  if (outcome === 'refusal' || outcome === 'error') host.toast(`› turn ended: ${OUTCOME_LABEL[outcome]}`, 3000)
  await trySaveSession(host)
}

/**
 * One model request, relayed chunk by chunk: a row whose bar splits into waiting for the first token
 * (░) and generating (▇). `start` starts the request; `aborted` says whether the person stopped it.
 */
export async function* recordStep<C extends { kind: string }>(
  host: Host,
  e: TurnStepInput,
  start: () => AsyncIterable<C> & { result: Promise<TurnStepResult> },
  aborted: () => boolean,
): AsyncGenerator<C, TurnStepResult> {
  const row = stepRow(e, await host.now())
  await host.events.set(append(row))
  await followEnd(host)

  let firstAt: number | undefined
  let done = false
  const stream = start()
  try {
    for await (const chunk of stream) {
      if (firstAt === undefined && chunk.kind !== 'engine') {
        firstAt = await host.now()
        void patch(host, row.id, { firstAt })
      }
      yield chunk
    }
    const r = await stream.result
    done = true
    await patch(host, row.id, { ...stepResult(row, e.index, r, aborted()), endedAt: await host.now(), firstAt })
    return r
  } catch (err) {
    done = true
    await patch(host, row.id, { ...stepFailure(err), endedAt: await host.now(), firstAt })
    throw err
  } finally {
    // Closed early: the person interrupted, or the stream was abandoned.
    if (!done) await patch(host, row.id, { endedAt: await host.now(), firstAt, status: 'aborted' })
  }
}

/** An Agent call's loop, once it has one: ties the row to the loop so that loop's calls group under it. */
export const recordSpawn = (host: Host, toolUseId: string, agentId: string) => patch(host, toolUseId, { spawnedAgentId: agentId })

/**
 * One tool, skill, MCP or Agent call: a running row, finished with how `run` ended. Errors raise a
 * toast, louder when the same call keeps failing; denials don't (the person made them).
 */
export async function recordCall<R extends { deny?: string; isError?: boolean; text?: unknown }>(
  host: Host,
  e: { tool: string; [k: string]: unknown },
  run: () => Promise<R>,
): Promise<R> {
  const row = callRow(e, await host.now())
  showRunning(host, await host.events.set(appendCall(row)))
  await followEnd(host)

  const finish = async (status: EventStatus, full: string) => {
    const list = await patch(host, row.id, callResult(status, full, await host.now()))
    showRunning(host, list)
    if (status !== 'error') return
    const failures = sameFailures(list, row)
    if (failures === LOOP_TOAST_AT) host.toast(`↻ ${row.name} failed ${failures}× with the same arguments`, 5000)
    else host.toast(`${GLYPHS[row.kind]} ${row.name}: error`, 3000)
  }

  const skill = row.kind === 'skill' ? row.name : undefined
  if (skill) skillsInFlight.set(skill, (skillsInFlight.get(skill) ?? 0) + 1)
  try {
    const ran = await run()
    const status: EventStatus = ran.deny !== undefined ? 'denied' : ran.isError ? 'error' : 'ok'
    await finish(status, ran.deny ?? (typeof ran.text === 'string' ? ran.text : ''))
    return ran
  } catch (err) {
    await finish('error', String(err))
    throw err
  } finally {
    if (skill) {
      const left = (skillsInFlight.get(skill) ?? 1) - 1
      if (left > 0) skillsInFlight.set(skill, left)
      else skillsInFlight.delete(skill)
    }
  }
}

/** A skill run by slash command, which never goes through the Skill tool. Skipped when the tool already has it. */
export async function recordSkillCommand(host: Host, skill: string) {
  if (skillsInFlight.has(skill)) return
  const row = skillCommandRow(skill, await host.now())
  // The recent-row check covers a reload that reset skillsInFlight mid-call.
  await host.events.set(list => (hasRecentSkill(list, row.name, row.startedAt) ? list : append(row)(list)))
  await followEnd(host)
}
