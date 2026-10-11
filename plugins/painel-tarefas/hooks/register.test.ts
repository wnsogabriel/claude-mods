import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__painel-tarefas__tarefas'
const PROJETO = 'C:/proj/loja'
const CHAVE = `pendencias:${PROJETO}`
const PANE_PROPS = {
  title: 'Tarefas',
  bodyColumns: 50,
  scroll: { offset: 0, bodyRows: 30 },
  isFocused: false,
  placement: 'dock' as const,
  view: {},
}
const PANE = { plugin: 'painel-tarefas', component: 'Pane', requestId: 'painel-tarefas', props: PANE_PROPS } as const

/** O mundo abaixo do plugin: store em memória, git, registros, painel, prompt e toasts. */
function mundo(on: On, inicial: Record<string, unknown> = {}) {
  mock.clock(on, { now: Date.parse('2026-10-11T12:00:00Z') })
  const store: Record<string, unknown> = { ...inicial }
  const toasts: string[] = []
  const fills: string[] = []
  on('store.get', ($, e) => ({ value: store[e.key] }))
  on('store.set', ($, e) => { store[e.key] = e.value; return { value: undefined } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `${PROJETO}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__painel-tarefas__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('prompt.fill', ($, e) => { fills.push(e.text); return { isFilled: true } })
  return { store, toasts, fills }
}

const iniciar = ($: Engine) =>
  $.session.start({ cwd: 'C:\\proj\\loja\\src', surface: 'desktop', isInteractive: true })

test('planejar pela ferramenta preenche Agora e responde com ids', async ($, on) => {
  mundo(on)
  await iniciar($)
  const r = await $.tool.call({ tool: TOOL, acao: 'planejar', itens: ['Hero', 'Formulário', 'Responsivo'] })
  expect(r.deny).toBeUndefined()
  expect(String(r.result)).toContain('○ Hero')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Formulário/ })).toBeDefined()
  await ui.unmount()
})

test('entrada inválida é recusada', async ($, on) => {
  mundo(on)
  await iniciar($)
  const r = await $.tool.call({ tool: TOOL, acao: 'planejar', itens: [] })
  expect(r.deny).toContain('itens')
})

test('adiar persiste pela raiz do git do projeto', async ($, on) => {
  const { store } = mundo(on)
  await iniciar($)
  await $.tool.call({ tool: TOOL, acao: 'adiar', texto: 'Header mobile', motivo: 'foco no checkout' })
  expect((store[CHAVE] as { texto: string }[]).map(p => p.texto)).toEqual(['Header mobile'])
})

test('pendências salvas carregam no início da sessão', async ($, on) => {
  mundo(on, { [CHAVE]: [{ id: 'p1', texto: 'Fonte', motivo: 'm', criadoEm: 0 }] })
  await iniciar($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'PENDÊNCIAS (1)' })).toBeDefined()
    await ui.unmount()
  }
})

test('painel: ▶ preenche o prompt e move para Agora; ✕ remove', async ($, on) => {
  const { fills, store } = mundo(on, {
    [CHAVE]: [
      { id: 'p1', texto: 'Header', motivo: 'foco no checkout', criadoEm: 0 },
      { id: 'p2', texto: 'Fonte', motivo: 'marca', criadoEm: 0 },
    ],
  })
  await iniciar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'retomar-p1' })
  expect(fills).toEqual(['Vamos retomar: Header (adiado: foco no checkout)'])
  await ui.press({ key: 'remover-p2' })
  expect(await ui.find({ type: 'Text', text: 'PENDÊNCIAS (0)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Header/ })).toBeDefined()
  expect(store[CHAVE]).toEqual([])
  await ui.unmount()
})

test('painel: campo adiciona pendência manual', async ($, on) => {
  mundo(on)
  await iniciar($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'nova', text: 'Revisar SEO' })
  expect(await ui.find({ type: 'Text', text: /adicionado manualmente/ })).toBeDefined()
  await ui.unmount()
})

test('toast ao concluir tudo', async ($, on) => {
  const { toasts } = mundo(on)
  await iniciar($)
  const r = await $.tool.call({ tool: TOOL, acao: 'planejar', itens: ['A'] })
  const id = /\[(\w+)\]/.exec(String(r.result))?.[1] ?? ''
  await $.tool.call({ tool: TOOL, acao: 'concluir', id })
  expect(toasts).toEqual(['✓ 1 tarefa concluída'])
})
