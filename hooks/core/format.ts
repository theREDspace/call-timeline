import type { EventKind } from '../../types'

/** Presentation vocabulary: how each kind of row is colored and marked, in the pane and in exports. */
export const COLORS: Record<EventKind, string> = {
  skill: 'magenta',
  tool: 'cyan',
  mcp: 'blue',
  agent: 'yellow',
  model: 'gray',
  prompt: 'white',
}
export const GLYPHS: Record<EventKind, string> = { skill: '★', tool: '●', mcp: '◆', agent: '▲', model: '≈', prompt: '›' }

export const oneLine = (s: string, max = 80) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** `HH:MM:SS`, local time. */
export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
/** `YYYYMMDD-HHMMSS`, for file names. */
export const stamp = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
}
/** `YYYY-MM-DD HH:MM`. */
export const day = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
// Round once, then split, so 119.6s reads 2m0s rather than 1m60s.
export const duration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  const tenths = Math.round(ms / 100)
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${s % 60}s`
}
export const compact = (n: number) => {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}
export const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)

/** A result this long is flagged on its row; past BIG_OUTPUT * 10 it is flagged loudly. */
export const BIG_OUTPUT = 2000
