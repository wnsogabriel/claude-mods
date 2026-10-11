import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const HOUR = 3_600_000
const resetsAt = new Date(NOW + HOUR).toISOString()

const measure = (percentUsed: number, at = resetsAt) => ({
  context: { tokens: 1000, window: 200_000, percent: 1 },
  rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: at }],
  changed: ['rateLimits' as const],
})

test('81% gera um toast e não repete', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure(measure(81))
  await $.session.measure(measure(82))

  expect(toasts).toEqual(['⚠ Limite de 5h em 80% — reseta em 1h00'])
})

test('janela nova libera o aviso', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure(measure(81))
  await $.session.measure(measure(81, new Date(NOW + 5 * HOUR).toISOString()))

  expect(toasts).toHaveLength(2)
})

test('faixa compacta abaixo de 90 colunas', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  await $.session.measure(measure(40))

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({
      plugin: 'limite-bar',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80,
        scroll: { offset: 0, bodyRows: 4 }, view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: '5h 40%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
    await ui.unmount()
  }
})
