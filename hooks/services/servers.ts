import type { ServerNames } from '../core/events'
import type { Host } from './host'

/**
 * MCP servers' display names. A connector's tools go by an id (`mcp__42224f91-…__list_events`); the engine
 * knows it as `claude.ai Google Calendar`. Names are asked of the engine once per unknown server and kept in
 * the store, so past sessions can be relabeled after the server is gone.
 */

const STORE_KEY = 'mcpServers'

/** Servers the engine had no name for in this process: not asked again on every call. Module-local, so a reload asks once more. */
const unnamed = new Set<string>()

const isNames = (v: unknown): v is ServerNames =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(n => typeof n === 'string')

/** Every name seen so far. A store that can't be read gives none. */
export async function storedServerNames(host: Host): Promise<ServerNames> {
  try {
    const raw = await host.store.get(STORE_KEY)
    return isNames(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** The names, with `server` looked up first when it is new. Lookup failures leave the row its id. */
export async function serverNames(host: Host, server: string): Promise<ServerNames> {
  const names = await storedServerNames(host)
  if (!server || server in names || unnamed.has(server)) return names
  let found: ServerNames = {}
  try {
    found = await host.mcpServers()
  } catch {
    // Keep what is known; the row shows the id.
  }
  if (!(server in found)) unnamed.add(server)
  if (!Object.keys(found).length) return names
  const merged = { ...names, ...found }
  try {
    await host.store.set(STORE_KEY, merged)
  } catch {
    // Named for this row anyway; the store tries again on the next new server.
  }
  return merged
}
