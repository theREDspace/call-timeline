/**
 * Hardening: the only way text from a call, a result or a prompt gets into the timeline. Terminal
 * escapes and bidi overrides are stripped, secrets redacted, and long values capped.
 */

export const ARGS_CAP = 2000
export const OUTPUT_CAP = 1500
/** Bulky inputs (file bodies, edit strings) keep only their head. */
const BULKY_CAP = 200
/** How far past a cap the scrubbers read, so a secret straddling the cut is still caught. */
const SCAN_SLACK = 2000

// Terminal escapes in tool output can repaint the screen, fake text, or write the clipboard (OSC 52);
// bidi overrides can make text read differently than it is. Keep \t and \n, drop the rest.
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
const ESC = /\x1b[@-_]?/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g

/** Strips terminal escapes, control characters and bidi overrides; keeps tabs and newlines. */
export const sanitize = (s: string) => s.replace(OSC, '').replace(CSI, '').replace(ESC, '').replace(CONTROL, '')

const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
  [/\b(sk-(?:ant-)?|gh[pousr]_|github_pat_|xox[abprs]-|glpat-|npm_)[A-Za-z0-9_-]{10,}/g, '$1***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted jwt]'],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1***:***@'],
  [
    /((?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{4,}/gi,
    '$1***',
  ],
  [/(--(?:password|token|api-key|secret)[\s=]+)\S+/gi, '$1***'],
]
const redact = (s: string) => SECRETS.reduce((acc, [re, to]) => acc.replace(re, to), s)

/** Sanitized, redacted, capped: the only form text from a call or prompt is stored in. */
export function clean(s: string, max: number) {
  const scrubbed = redact(sanitize(s.slice(0, max + SCAN_SLACK)))
  if (s.length <= max + SCAN_SLACK && scrubbed.length <= max) return scrubbed
  return `${scrubbed.slice(0, max)}\n… (${Math.max(0, s.length - max)} more chars)`
}

const SECRET_FIELD = /pass(word|wd)?$|^pwd$|secret|token$|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential/i
const BULKY_FIELDS = new Set(['content', 'old_string', 'new_string', 'new_source'])

function scrub(v: unknown, field = '', depth = 0): unknown {
  if (typeof v === 'string') {
    if (field && SECRET_FIELD.test(field) && v) return '***'
    if (BULKY_FIELDS.has(field) && v.length > BULKY_CAP) return `${redact(sanitize(v.slice(0, BULKY_CAP + SCAN_SLACK))).slice(0, BULKY_CAP)}… (${v.length} chars)`
    return clean(v, ARGS_CAP)
  }
  if (v === null || typeof v !== 'object' || depth > 8) return v
  if (Array.isArray(v)) return v.map(x => scrub(x, field, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k, depth + 1)]))
}

/** A tool call's arguments as pretty JSON, every field scrubbed, the engine's own bookkeeping left out. */
export function argsJson(input: { [k: string]: unknown }) {
  const { tool: _t, tool_use_id: _id, agentId: _a, ...rest } = input
  try {
    const json = JSON.stringify(scrub(rest), null, 2)
    return json.length > ARGS_CAP ? `${json.slice(0, ARGS_CAP)}\n… (${json.length - ARGS_CAP} more chars)` : json
  } catch {
    return ''
  }
}
