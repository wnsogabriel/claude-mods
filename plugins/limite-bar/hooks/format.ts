export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Tone = 'success' | 'warning' | 'error'
export type Segment = { text: string; color?: Tone; dim?: boolean }
export type View = { limits: Limit[]; contextPercent: number | null; sessionTokens: number }
export type Alert = { limit: Limit; threshold: number; keys: string[] }

const MIN = 60_000
const FIVE_HOURS = 5 * 60 * MIN
const THRESHOLDS = [80, 95] as const
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const
const LABEL: Record<string, string> = { five_hour: 'de 5h', seven_day: 'semanal' }
export const KNOWN_KINDS: readonly string[] = Object.keys(LABEL)

const SEP: Segment = { text: ' │ ', dim: true }

export function tone(p: number): Tone {
  if (p < 60) return 'success'
  return p <= 85 ? 'warning' : 'error'
}

export function bar(p: number, width = 10): string {
  const clamped = Math.min(100, Math.max(0, p))
  const filled = Math.round((clamped / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function duration(ms: number): string {
  if (ms <= 0) return 'agora'
  if (ms < MIN) return '<1min'
  const total = Math.floor(ms / MIN)
  if (total < 60) return `${total}min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${h}h${String(m).padStart(2, '0')}`
}

function parse(resetsAt: string | undefined): number | null {
  if (resetsAt === undefined) return null
  const t = Date.parse(resetsAt)
  return Number.isNaN(t) ? null : t
}

export function resetIn(resetsAt: string | undefined, now: number): string | null {
  const t = parse(resetsAt)
  return t === null ? null : duration(t - now)
}

export function resetAt(resetsAt: string | undefined): string | null {
  const t = parse(resetsAt)
  if (t === null) return null
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${WEEKDAYS[d.getDay()]} ${hh}:${mm}`
}

export function projection(
  l: Limit,
  now: number,
): { kind: 'folga' } | { kind: 'acaba'; ms: number } | null {
  const reset = parse(l.resetsAt)
  if (reset === null) return null
  const untilReset = reset - now
  if (untilReset <= 0) return null
  const elapsed = now - (reset - FIVE_HOURS)
  if (elapsed < 10 * MIN || l.percentUsed < 5) return null
  const toEnd = (100 - l.percentUsed) / (l.percentUsed / elapsed)
  return toEnd >= untilReset ? { kind: 'folga' } : { kind: 'acaba', ms: Math.max(0, toEnd) }
}

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

const keyOf = (l: Limit, t: number) => `${l.kind}:${t}:${l.resetsAt ?? ''}`

export function alertsToFire(limits: Limit[], fired: readonly string[]): Alert[] {
  const out: Alert[] = []
  for (const l of limits) {
    if (!KNOWN_KINDS.includes(l.kind)) continue
    const fresh = THRESHOLDS.filter(t => l.percentUsed >= t && !fired.includes(keyOf(l, t)))
    if (fresh.length === 0) continue
    out.push({ limit: l, threshold: Math.max(...fresh), keys: fresh.map(t => keyOf(l, t)) })
  }
  return out
}

export function alertText(a: Alert, now: number): string {
  const when = a.limit.kind === 'five_hour'
    ? (() => { const r = resetIn(a.limit.resetsAt, now); return r === null ? '' : ` — reseta em ${r}` })()
    : (() => { const r = resetAt(a.limit.resetsAt); return r === null ? '' : ` — reseta ${r}` })()
  return `⚠ Limite ${LABEL[a.limit.kind]} em ${a.threshold}%${when}`
}

export function pruneFired(fired: readonly string[], now: number): string[] {
  return fired.filter(k => {
    const t = parse(k.split(':').slice(2).join(':'))
    return t === null || t > now
  })
}

const pct = (p: number) => `${Math.round(p)}%`

function fiveHour(l: Limit | undefined, now: number, compact: boolean): Segment[] {
  if (l === undefined) return [{ text: '5h —', dim: true }]
  const r = resetIn(l.resetsAt, now)
  const p = projection(l, now)
  if (compact) {
    const proj = p === null ? '' : p.kind === 'folga' ? ' ✓' : ` ~${duration(p.ms)}`
    return [{ text: `5h ${pct(l.percentUsed)}${r === null ? '' : ` ${r}`}${proj}`, color: tone(l.percentUsed) }]
  }
  const out: Segment[] = [{ text: `5h ${bar(l.percentUsed)} ${pct(l.percentUsed)}`, color: tone(l.percentUsed) }]
  if (r !== null) out.push({ text: ` · reseta ${r}` })
  if (p?.kind === 'folga') out.push({ text: ' · ✓ folga', color: 'success' })
  if (p?.kind === 'acaba') out.push({ text: ` · ritmo: acaba em ~${duration(p.ms)}`, color: 'warning' })
  return out
}

function sevenDay(l: Limit | undefined, compact: boolean): Segment[] {
  if (l === undefined) return [{ text: 'sem —', dim: true }]
  if (compact) return [{ text: `sem ${pct(l.percentUsed)}`, color: tone(l.percentUsed) }]
  const out: Segment[] = [{ text: `sem ${bar(l.percentUsed)} ${pct(l.percentUsed)}`, color: tone(l.percentUsed) }]
  const r = resetAt(l.resetsAt)
  if (r !== null) out.push({ text: ` · reseta ${r}` })
  return out
}

export function segments(view: View, now: number, compact: boolean): Segment[] {
  const find = (kind: string) => view.limits.find(l => l.kind === kind)
  const ctx: Segment = view.contextPercent === null
    ? { text: 'ctx —', dim: true }
    : { text: `ctx ${pct(view.contextPercent)}`, color: tone(view.contextPercent) }
  return [
    ...fiveHour(find('five_hour'), now, compact),
    SEP,
    ...sevenDay(find('seven_day'), compact),
    ...(compact ? [] : [SEP, { text: `sessão ${tokens(view.sessionTokens)} tok` }]),
    SEP,
    ctx,
  ]
}

export type Uso = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

/**
 * Tokens que pesam de verdade num turno: entrada nova, escrita de cache e saída.
 * A leitura de cache fica de fora — é a conversa inteira relida a cada turno e inflaria o total.
 */
export function tokensGastos(u: Uso): number {
  return u.input_tokens + u.cache_creation_input_tokens + u.output_tokens
}

export type ContagemTarefas = { feitos: number; total: number; pendencias: number }

/** Texto do contador do painel-tarefas; null quando não há nada para mostrar. */
export function textoTarefas(c: ContagemTarefas): string | null {
  const partes: string[] = []
  if (c.total > 0) partes.push(`${c.feitos}/${c.total}`)
  if (c.pendencias > 0) partes.push(`${c.pendencias} pend.`)
  return partes.length === 0 ? null : `📋 ${partes.join(' · ')}`
}
