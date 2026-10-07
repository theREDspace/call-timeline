import type { Archive, SessionSummary } from '../../types'
import { relabelMcp } from '../core/events'
import { isCall, isProblem } from '../core/timeline'
import type { Host } from './host'
import { storedServerNames } from './servers'

/**
 * Past sessions in the plugin's store: an index of summaries, newest first, and one slimmed timeline per
 * session. Only this module knows the keys or the shapes on disk.
 */

/** Past sessions kept in the store. */
export const HISTORY_MAX = 10
const INDEX_KEY = 'sessions'
const sessionKey = (id: string) => `session:${id}`

const isSummary = (v: unknown): v is SessionSummary =>
  !!v && typeof v === 'object' && typeof (v as SessionSummary).id === 'string' && typeof (v as SessionSummary).startedAt === 'number'

async function readIndex(host: Host) {
  const raw = await host.store.get(INDEX_KEY)
  return Array.isArray(raw) ? raw.filter(isSummary) : []
}

/** Re-reads the index into state. History is a convenience: a store that can't be read keeps what was last read. */
export async function refreshHistory(host: Host) {
  try {
    const index = await readIndex(host)
    await host.history.set(() => index)
  } catch {
    // Show what was last read.
  }
}

/** Saves this session's timeline (without arguments or results, to keep the store small) and lists it first. */
export async function saveSession(host: Host) {
  const list = await host.events.get()
  const calls = list.filter(isCall)
  if (calls.length === 0) return
  const id = await host.sessionId()
  const title = list.find(ev => ev.kind === 'prompt' && ev.name !== '(continuation)')?.name ?? '(no prompt)'
  const slim = list.map(({ args: _a, output: _o, ...rest }) => rest)
  const summary: SessionSummary = {
    id,
    title,
    startedAt: list[0]?.startedAt ?? (await host.now()),
    savedAt: await host.now(),
    calls: calls.length,
    problems: calls.filter(isProblem).length,
    costUsd: (await host.sessionCost.get()) || undefined,
  }
  const archived: Archive = { id, title, events: slim }
  await host.store.set(sessionKey(id), archived)
  const index = [summary, ...(await readIndex(host)).filter(s => s.id !== id)]
  for (const old of index.slice(HISTORY_MAX)) await host.store.delete(sessionKey(old.id))
  const kept = index.slice(0, HISTORY_MAX)
  await host.store.set(INDEX_KEY, kept)
  await host.history.set(() => kept)
}

/** Saves, swallowing failures: a full or unwritable store loses history, never the live timeline. */
export async function trySaveSession(host: Host) {
  try {
    await saveSession(host)
  } catch {
    // Nothing to do; the next turn tries again.
  }
}

/** A saved session, or undefined when it is no longer in the store. */
export async function loadArchive(host: Host, id: string): Promise<Archive | undefined> {
  const arc = (await host.store.get(sessionKey(id))) as Partial<Archive> | undefined
  if (!arc || !Array.isArray(arc.events)) return undefined
  // Sessions saved before a server's name was known show its id; name it now if it has been seen since.
  const names = await storedServerNames(host)
  const events = arc.events.map(ev => relabelMcp(ev, names))
  return { id, title: typeof arc.title === 'string' && arc.title ? arc.title : '(no prompt)', events }
}
