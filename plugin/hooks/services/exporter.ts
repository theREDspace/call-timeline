import { exportFile } from '../core/export'
import type { Host } from './host'

/**
 * Writes the timeline being shown (the live one, or the past session open) and says where.
 * `arg` is `md`, `json`, or a path whose extension picks the format.
 */
export async function exportTimeline(host: Host, arg: string) {
  const past = await host.archive.get()
  const list = past ? past.events : await host.events.get()
  const { path, text } = exportFile(arg, list, await host.now(), past ?? undefined)
  await host.writeFile(path, text)
  const where = path.startsWith('/') ? path : `${await host.cwd()}/${path}`
  return `Exported ${list.length} events to ${where}`
}
