import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'
import { alertsToFire, alertText, grupos, KNOWN_KINDS, pruneFired, textoTarefas, tokensGastos } from './format'

const limits = atom({ plugin: 'limite-bar', key: 'limits' } as const, [] as Limit[])
const contextPercent = atom({ plugin: 'limite-bar', key: 'contextPercent' } as const, null as number | null)
const sessionTokens = atom({ plugin: 'limite-bar', key: 'sessionTokens' } as const, 0)
const now = atom({ plugin: 'limite-bar', key: 'now' } as const, 0)
// Publicado pelo mod painel-tarefas, quando instalado; ausente, o contador não aparece.
const tarefasResumo = { plugin: 'painel-tarefas', key: 'resumo' } as const

const FIRED = 'firedAlerts'
const COMPACT_BELOW = 90

const known = (all: readonly Limit[]): Limit[] =>
  all
    .filter(l => KNOWN_KINDS.includes(l.kind))
    .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t = await $.clock.now()
    const usage = await $.session.usage()
    await update($, limits, () => known(usage.rateLimits))
    await update($, contextPercent, () => usage.context.percent ?? null)
    await update($, now, () => t)

    const fired = ((await $.store.get(FIRED)) as string[] | undefined) ?? []
    await $.store.set(FIRED, pruneFired(fired, t))

    $.clock.every(60_000, () => {
      void $.clock.now().then(n => update($, now, () => n))
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    const t = await $.clock.now()
    const current = known(e.rateLimits)
    await update($, limits, () => current)
    await update($, contextPercent, () => e.context.percent ?? null)
    await update($, now, () => t)

    const fired = ((await $.store.get(FIRED)) as string[] | undefined) ?? []
    const alerts = alertsToFire(current, fired)
    if (alerts.length > 0) {
      for (const a of alerts) $.ui.toast(alertText(a, t), { timeoutMs: 8000 })
      await $.store.set(FIRED, [...fired, ...alerts.flatMap(a => a.keys)])
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u !== undefined) {
      await update($, sessionTokens, n => (n ?? 0) + tokensGastos(u))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const view = {
      limits: await read($, limits),
      contextPercent: await read($, contextPercent),
      sessionTokens: await read($, sessionTokens),
    }
    const t = (await read($, now)) || (await $.clock.now())
    const blocos = grupos(view, t, e.props.bodyColumns < COMPACT_BELOW)
    const resumo = await $.state.get(tarefasResumo).then(r => r.value, () => undefined)
    const tarefas = resumo == null ? null : textoTarefas(resumo)
    // Cada bloco é indivisível (flexShrink 0); sem espaço, o bloco inteiro desce de linha.
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {blocos.map((bloco, b) => (
          <Box key={`b${b}`} flexDirection="row" flexShrink={0}>
            {bloco.map((s, i) => (
              <Text key={`b${b}s${i}`} color={s.color} dimColor={s.dim} wrap="end">
                {s.text}
              </Text>
            ))}
          </Box>
        ))}
        {tarefas === null ? null : (
          <Box key="tarefas-box" flexShrink={0}>
            <Button key="tarefas" plain label={tarefas} onPress={() => void $.command.run({ command: 'tarefas' })} />
          </Box>
        )}
      </Box>
    )
  })
}
