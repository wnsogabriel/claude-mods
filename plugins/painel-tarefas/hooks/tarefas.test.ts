import { describe, expect, test } from 'claude-code/testing'

import {
  aplicar, contagem, encerrarSessao, espelharTodoWrite, moverParaAgora,
  parseAcao, removerPendencia, resumoConclusao, resumoParaModelo, textoRetomar,
} from './tarefas'
import type { Estado } from './tarefas'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const seq = () => {
  let n = 0
  return () => `x${++n}`
}
const vazio = (): Estado => ({ agora: [], pendencias: [], adiadas: 0 })

describe('parseAcao', () => {
  test('aceita ações válidas', () => {
    expect(parseAcao({ acao: 'planejar', itens: ['a', 'b'] })).toEqual({ acao: 'planejar', itens: ['a', 'b'] })
    expect(parseAcao({ acao: 'concluir', id: 'a1' })).toEqual({ acao: 'concluir', id: 'a1' })
    expect(parseAcao({ acao: 'adiar', texto: 'x', motivo: 'm' })).toEqual({ acao: 'adiar', texto: 'x', motivo: 'm' })
  })
  test('recusa entrada inválida', () => {
    expect(parseAcao({ acao: 'apagar_tudo' })).toHaveProperty('erro')
    expect(parseAcao({ acao: 'planejar', itens: [] })).toHaveProperty('erro')
    expect(parseAcao({ acao: 'planejar', itens: [1] })).toHaveProperty('erro')
    expect(parseAcao({ acao: 'concluir' })).toHaveProperty('erro')
    expect(parseAcao({ acao: 'adiar', id: 'a1' })).toHaveProperty('erro')
    expect(parseAcao({ acao: 'adiar', motivo: 'm' })).toHaveProperty('erro')
  })
  test('limita tamanho do texto', () => {
    const r = parseAcao({ acao: 'adiar', texto: 'a'.repeat(1000), motivo: 'm' })
    expect('texto' in r && r.texto?.length).toBe(300)
  })
})

describe('aplicar', () => {
  test('planejar substitui a lista Agora', () => {
    const r = aplicar(vazio(), { acao: 'planejar', itens: ['A', 'B'] }, NOW, seq())
    if ('erro' in r) throw new Error(r.erro)
    expect(r.estado.agora).toEqual([
      { id: 'x1', texto: 'A', status: 'pendente' },
      { id: 'x2', texto: 'B', status: 'pendente' },
    ])
  })
  test('iniciar deixa só um item fazendo', () => {
    const gen = seq()
    let e = vazio()
    const p = aplicar(e, { acao: 'planejar', itens: ['A', 'B'] }, NOW, gen)
    if ('erro' in p) throw new Error(p.erro)
    e = p.estado
    const i1 = aplicar(e, { acao: 'iniciar', id: 'x1' }, NOW, gen)
    if ('erro' in i1) throw new Error(i1.erro)
    const i2 = aplicar(i1.estado, { acao: 'iniciar', id: 'x2' }, NOW + 1000, gen)
    if ('erro' in i2) throw new Error(i2.erro)
    expect(i2.estado.agora.map(i => i.status)).toEqual(['pendente', 'fazendo'])
    expect(i2.estado.agora[1]?.iniciadoEm).toBe(NOW + 1000)
  })
  test('concluir', () => {
    const p = aplicar(vazio(), { acao: 'planejar', itens: ['A'] }, NOW, seq())
    if ('erro' in p) throw new Error(p.erro)
    const c = aplicar(p.estado, { acao: 'concluir', id: 'x1' }, NOW, seq())
    if ('erro' in c) throw new Error(c.erro)
    expect(c.estado.agora[0]?.status).toBe('feito')
  })
  test('id inexistente é erro', () => {
    expect(aplicar(vazio(), { acao: 'concluir', id: 'nada' }, NOW, seq())).toHaveProperty('erro')
  })
  test('adiar item de Agora move para Pendências', () => {
    const gen = seq()
    const p = aplicar(vazio(), { acao: 'planejar', itens: ['A', 'B'] }, NOW, gen)
    if ('erro' in p) throw new Error(p.erro)
    const a = aplicar(p.estado, { acao: 'adiar', id: 'x2', motivo: 'foco no checkout' }, NOW, gen)
    if ('erro' in a) throw new Error(a.erro)
    expect(a.estado.agora.map(i => i.id)).toEqual(['x1'])
    expect(a.estado.pendencias).toEqual([{ id: 'x3', texto: 'B', motivo: 'foco no checkout', criadoEm: NOW }])
    expect(a.estado.adiadas).toBe(1)
  })
  test('adiar por texto cria pendência', () => {
    const a = aplicar(vazio(), { acao: 'adiar', texto: 'Trocar fonte', motivo: 'aguardar marca' }, NOW, seq())
    if ('erro' in a) throw new Error(a.erro)
    expect(a.estado.pendencias[0]?.texto).toBe('Trocar fonte')
  })
  test('retomar traz pendência para Agora', () => {
    const gen = seq()
    const a = aplicar(vazio(), { acao: 'adiar', texto: 'T', motivo: 'm' }, NOW, gen)
    if ('erro' in a) throw new Error(a.erro)
    const r = aplicar(a.estado, { acao: 'retomar', id: 'x1' }, NOW, gen)
    if ('erro' in r) throw new Error(r.erro)
    expect(r.estado.pendencias).toEqual([])
    expect(r.estado.agora).toEqual([{ id: 'x2', texto: 'T', status: 'pendente' }])
  })
})

describe('auxiliares', () => {
  const estado: Estado = {
    agora: [
      { id: 'a1', texto: 'A', status: 'feito' },
      { id: 'a2', texto: 'B', status: 'fazendo', iniciadoEm: NOW },
      { id: 'a3', texto: 'C', status: 'pendente' },
    ],
    pendencias: [{ id: 'p1', texto: 'Header', motivo: 'foco no checkout', criadoEm: NOW }],
    adiadas: 1,
  }
  test('contagem', () => {
    expect(contagem(estado)).toEqual({ feitos: 1, total: 3, pendencias: 1 })
  })
  test('textoRetomar', () => {
    expect(textoRetomar(estado.pendencias[0]!)).toBe('Vamos retomar: Header (adiado: foco no checkout)')
  })
  test('moverParaAgora', () => {
    const e = moverParaAgora(estado, 'p1', seq())
    expect(e.pendencias).toEqual([])
    expect(e.agora.at(-1)).toEqual({ id: 'x1', texto: 'Header', status: 'pendente' })
  })
  test('removerPendencia', () => {
    expect(removerPendencia(estado, 'p1').pendencias).toEqual([])
  })
  test('encerrarSessao salva o que não terminou', () => {
    const e = encerrarSessao(estado, NOW, seq())
    expect(e.agora).toEqual([])
    expect(e.pendencias.map(p => p.texto)).toEqual(['Header', 'B', 'C'])
    expect(e.pendencias[1]?.motivo).toBe('sessão encerrada antes de concluir')
  })
  test('resumoConclusao só quando tudo está feito', () => {
    expect(resumoConclusao(estado)).toBeNull()
    const tudo: Estado = { ...estado, agora: estado.agora.map(i => ({ ...i, status: 'feito' as const })) }
    expect(resumoConclusao(tudo)).toBe('✓ 3 tarefas concluídas · 1 adiada para pendências')
    expect(resumoConclusao({ ...tudo, adiadas: 0 })).toBe('✓ 3 tarefas concluídas')
    expect(resumoConclusao(vazio())).toBeNull()
  })
  test('resumoParaModelo lista ids', () => {
    const t = resumoParaModelo(estado)
    expect(t).toContain('[a2] ▸ B')
    expect(t).toContain('[p1] Header — adiado: foco no checkout')
  })
  test('espelharTodoWrite', () => {
    const e = espelharTodoWrite(vazio(), [
      { content: 'X', status: 'completed', activeForm: 'x' },
      { content: 'Y', status: 'in_progress', activeForm: 'y' },
    ], NOW)
    expect(e.agora).toEqual([
      { id: 't1', texto: 'X', status: 'feito' },
      { id: 't2', texto: 'Y', status: 'fazendo', iniciadoEm: NOW },
    ])
  })
})
