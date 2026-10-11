import { describe, expect, test } from 'claude-code/testing'

import {
  alertsToFire, alertText, bar, duration, projection, pruneFired,
  resetIn, segments, textoTarefas, tokens, tokensGastos, tone,
} from './format'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.parse('2026-10-11T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('tone', () => {
  test('limites de cor', () => {
    expect(tone(59.9)).toBe('success')
    expect(tone(60)).toBe('warning')
    expect(tone(85)).toBe('warning')
    expect(tone(85.1)).toBe('error')
  })
})

describe('bar', () => {
  test('10 blocos arredondados', () => {
    expect(bar(0)).toBe('░░░░░░░░░░')
    expect(bar(4)).toBe('░░░░░░░░░░')
    expect(bar(5)).toBe('█░░░░░░░░░')
    expect(bar(50)).toBe('█████░░░░░')
    expect(bar(100)).toBe('██████████')
    expect(bar(130)).toBe('██████████')
  })
})

describe('duration / resetIn', () => {
  test('formatos', () => {
    expect(duration(0)).toBe('agora')
    expect(duration(30_000)).toBe('<1min')
    expect(duration(12 * MIN)).toBe('12min')
    expect(duration(HOUR + 48 * MIN)).toBe('1h48')
    expect(duration(2 * HOUR + 5 * MIN)).toBe('2h05')
  })
  test('resetIn', () => {
    expect(resetIn(undefined, NOW)).toBeNull()
    expect(resetIn('lixo', NOW)).toBeNull()
    expect(resetIn(iso(NOW - MIN), NOW)).toBe('agora')
    expect(resetIn(iso(NOW + HOUR + 48 * MIN), NOW)).toBe('1h48')
  })
})

describe('projection', () => {
  const resetsAt = iso(NOW + 3 * HOUR) // janela começou há 2h
  test('acaba antes do reset', () => {
    // 60% em 2h → 0,5%/min → 40% restantes em 80min < 180min
    expect(projection({ kind: 'five_hour', percentUsed: 60, resetsAt }, NOW))
      .toEqual({ kind: 'acaba', ms: 80 * MIN })
  })
  test('folga', () => {
    expect(projection({ kind: 'five_hour', percentUsed: 20, resetsAt }, NOW))
      .toEqual({ kind: 'folga' })
  })
  test('amostra pequena', () => {
    expect(projection({ kind: 'five_hour', percentUsed: 4, resetsAt }, NOW)).toBeNull()
    const fresh = iso(NOW + 5 * HOUR - 5 * MIN)
    expect(projection({ kind: 'five_hour', percentUsed: 30, resetsAt: fresh }, NOW)).toBeNull()
  })
  test('sem resetsAt', () => {
    expect(projection({ kind: 'five_hour', percentUsed: 60 }, NOW)).toBeNull()
  })
})

describe('tokens', () => {
  test('formatos', () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(182_400)).toBe('182k')
    expect(tokens(1_200_000)).toBe('1,2M')
  })
})

describe('alertsToFire', () => {
  const resetsAt = iso(NOW + HOUR)
  test('cruza 80', () => {
    const a = alertsToFire([{ kind: 'five_hour', percentUsed: 81, resetsAt }], [])
    expect(a).toHaveLength(1)
    expect(a[0]?.threshold).toBe(80)
    expect(a[0]?.keys).toEqual([`five_hour:80:${resetsAt}`])
  })
  test('cruza 80 e 95 juntos: só um aviso, duas chaves', () => {
    const a = alertsToFire([{ kind: 'five_hour', percentUsed: 96, resetsAt }], [])
    expect(a).toHaveLength(1)
    expect(a[0]?.threshold).toBe(95)
    expect(a[0]?.keys).toHaveLength(2)
  })
  test('chave já disparada', () => {
    const fired = [`five_hour:80:${resetsAt}`]
    expect(alertsToFire([{ kind: 'five_hour', percentUsed: 82, resetsAt }], fired)).toEqual([])
  })
  test('resetsAt novo libera', () => {
    const fired = [`five_hour:80:${iso(NOW - HOUR)}`]
    expect(alertsToFire([{ kind: 'five_hour', percentUsed: 82, resetsAt }], fired)).toHaveLength(1)
  })
  test('kind desconhecido ignorado', () => {
    expect(alertsToFire([{ kind: 'spend_limit', percentUsed: 99, resetsAt }], [])).toEqual([])
  })
})

describe('alertText / pruneFired', () => {
  test('texto 5h', () => {
    const limit = { kind: 'five_hour', percentUsed: 81, resetsAt: iso(NOW + HOUR + 12 * MIN) }
    expect(alertText({ limit, threshold: 80, keys: [] }, NOW))
      .toBe('⚠ Limite de 5h em 80% — reseta em 1h12')
  })
  test('poda chaves vencidas', () => {
    const old = `five_hour:80:${iso(NOW - MIN)}`
    const live = `seven_day:95:${iso(NOW + HOUR)}`
    expect(pruneFired([old, live], NOW)).toEqual([live])
  })
})

describe('segments', () => {
  const view = {
    limits: [
      { kind: 'five_hour', percentUsed: 60, resetsAt: iso(NOW + 3 * HOUR) },
      { kind: 'seven_day', percentUsed: 22, resetsAt: iso(NOW + 48 * HOUR) },
    ],
    contextPercent: 64,
    sessionTokens: 182_400,
  }
  const text = (s: { text: string }[]) => s.map(x => x.text).join('')
  test('completo', () => {
    const t = text(segments(view, NOW, false))
    expect(t).toContain('5h ██████░░░░ 60%')
    expect(t).toContain('reseta 3h00')
    expect(t).toContain('ritmo: acaba em ~1h20')
    expect(t).toContain('sem ██░░░░░░░░ 22%')
    expect(t).toContain('sessão 182k tok')
    expect(t).toContain('ctx 64%')
  })
  test('compacto', () => {
    expect(text(segments(view, NOW, true))).toBe('5h 60% 3h00 ~1h20 │ sem 22% │ ctx 64%')
  })
  test('sem dados', () => {
    const t = text(segments({ limits: [], contextPercent: null, sessionTokens: 0 }, NOW, true))
    expect(t).toBe('5h — │ sem — │ ctx —')
  })
  test('cor do 5h segue o tom', () => {
    const s = segments(view, NOW, false)
    expect(s[0]?.color).toBe('warning')
  })
})

describe('tokensGastos', () => {
  test('ignora leitura de cache (a conversa relida a cada turno)', () => {
    expect(tokensGastos({
      input_tokens: 100, output_tokens: 50,
      cache_creation_input_tokens: 30, cache_read_input_tokens: 90_000,
    })).toBe(180)
  })
})

describe('textoTarefas', () => {
  test('progresso e pendências', () => {
    expect(textoTarefas({ feitos: 2, total: 5, pendencias: 3 })).toBe('📋 2/5 · 3 pend.')
    expect(textoTarefas({ feitos: 0, total: 0, pendencias: 1 })).toBe('📋 1 pend.')
    expect(textoTarefas({ feitos: 1, total: 4, pendencias: 0 })).toBe('📋 1/4')
    expect(textoTarefas({ feitos: 0, total: 0, pendencias: 0 })).toBeNull()
  })
})
