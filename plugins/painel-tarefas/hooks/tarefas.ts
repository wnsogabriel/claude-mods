export type Status = 'pendente' | 'fazendo' | 'feito'
export type Item = { id: string; texto: string; status: Status; iniciadoEm?: number }
export type Pendencia = { id: string; texto: string; motivo: string; criadoEm: number }
export type Estado = { agora: Item[]; pendencias: Pendencia[]; adiadas: number }
export type Contagem = { feitos: number; total: number; pendencias: number }
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }

export type Acao =
  | { acao: 'planejar'; itens: string[] }
  | { acao: 'iniciar'; id: string }
  | { acao: 'concluir'; id: string }
  | { acao: 'adiar'; id?: string; texto?: string; motivo: string }
  | { acao: 'retomar'; id: string }

type Erro = { erro: string }

const MAX_TEXTO = 300
const MAX_ITENS = 30
const MOTIVO_FIM = 'sessão encerrada antes de concluir'
const SIMBOLO: Record<Status, string> = { pendente: '○', fazendo: '▸', feito: '✓' }

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, MAX_TEXTO) : null

/** Valida a entrada da ferramenta `tarefas` (vinda do modelo, tratada como não confiável). */
export function parseAcao(input: Record<string, unknown>): Acao | Erro {
  switch (input.acao) {
    case 'planejar': {
      const itens = input.itens
      if (!Array.isArray(itens) || itens.length === 0) return { erro: 'planejar exige `itens` com ao menos um texto' }
      const limpos = itens.slice(0, MAX_ITENS).map(texto)
      if (limpos.some(t => t === null)) return { erro: 'todo item de `itens` deve ser texto não vazio' }
      return { acao: 'planejar', itens: limpos as string[] }
    }
    case 'iniciar':
    case 'concluir':
    case 'retomar': {
      const id = texto(input.id)
      return id === null ? { erro: `${input.acao} exige \`id\`` } : { acao: input.acao, id }
    }
    case 'adiar': {
      const motivo = texto(input.motivo)
      if (motivo === null) return { erro: 'adiar exige `motivo`' }
      const id = texto(input.id)
      const t = texto(input.texto)
      if (id === null && t === null) return { erro: 'adiar exige `id` (item de Agora) ou `texto` (nova pendência)' }
      return id !== null ? { acao: 'adiar', id, motivo } : { acao: 'adiar', texto: t as string, motivo }
    }
    default:
      return { erro: 'acao deve ser planejar, iniciar, concluir, adiar ou retomar' }
  }
}

const naoAchou = (id: string): Erro => ({ erro: `nenhum item com id ${id}` })

export function aplicar(e: Estado, a: Acao, now: number, novoId: () => string): { estado: Estado } | Erro {
  switch (a.acao) {
    case 'planejar':
      return { estado: { ...e, agora: a.itens.map(t => ({ id: novoId(), texto: t, status: 'pendente' })) } }
    case 'iniciar': {
      if (!e.agora.some(i => i.id === a.id)) return naoAchou(a.id)
      const agora = e.agora.map((i): Item => {
        if (i.id === a.id) return { ...i, status: 'fazendo', iniciadoEm: now }
        if (i.status !== 'fazendo') return i
        const { iniciadoEm: _, ...resto } = i
        return { ...resto, status: 'pendente' }
      })
      return { estado: { ...e, agora } }
    }
    case 'concluir': {
      if (!e.agora.some(i => i.id === a.id)) return naoAchou(a.id)
      const agora = e.agora.map((i): Item => {
        if (i.id !== a.id) return i
        const { iniciadoEm: _, ...resto } = i
        return { ...resto, status: 'feito' }
      })
      return { estado: { ...e, agora } }
    }
    case 'adiar': {
      if (a.id !== undefined) {
        const item = e.agora.find(i => i.id === a.id)
        if (item === undefined) return naoAchou(a.id)
        const p: Pendencia = { id: novoId(), texto: item.texto, motivo: a.motivo, criadoEm: now }
        return {
          estado: { agora: e.agora.filter(i => i.id !== a.id), pendencias: [...e.pendencias, p], adiadas: e.adiadas + 1 },
        }
      }
      const p: Pendencia = { id: novoId(), texto: a.texto ?? '', motivo: a.motivo, criadoEm: now }
      return { estado: { ...e, pendencias: [...e.pendencias, p], adiadas: e.adiadas + 1 } }
    }
    case 'retomar':
      return e.pendencias.some(p => p.id === a.id) ? { estado: moverParaAgora(e, a.id, novoId) } : naoAchou(a.id)
  }
}

export function moverParaAgora(e: Estado, id: string, novoId: () => string): Estado {
  const p = e.pendencias.find(x => x.id === id)
  if (p === undefined) return e
  return {
    ...e,
    pendencias: e.pendencias.filter(x => x.id !== id),
    agora: [...e.agora, { id: novoId(), texto: p.texto, status: 'pendente' }],
  }
}

export function removerPendencia(e: Estado, id: string): Estado {
  return { ...e, pendencias: e.pendencias.filter(p => p.id !== id) }
}

export function encerrarSessao(e: Estado, now: number, novoId: () => string): Estado {
  const sobras = e.agora
    .filter(i => i.status !== 'feito')
    .map((i): Pendencia => ({ id: novoId(), texto: i.texto, motivo: MOTIVO_FIM, criadoEm: now }))
  return { ...e, agora: [], pendencias: [...e.pendencias, ...sobras] }
}

export function contagem(e: Estado): Contagem {
  return { feitos: e.agora.filter(i => i.status === 'feito').length, total: e.agora.length, pendencias: e.pendencias.length }
}

export function textoRetomar(p: Pendencia): string {
  return `Vamos retomar: ${p.texto} (adiado: ${p.motivo})`
}

export function resumoConclusao(e: Estado): string | null {
  if (e.agora.length === 0 || e.agora.some(i => i.status !== 'feito')) return null
  const n = e.agora.length
  const base = `✓ ${n} ${n === 1 ? 'tarefa concluída' : 'tarefas concluídas'}`
  if (e.adiadas === 0) return base
  return `${base} · ${e.adiadas} ${e.adiadas === 1 ? 'adiada' : 'adiadas'} para pendências`
}

export function resumoParaModelo(e: Estado): string {
  const agora = e.agora.length === 0
    ? '  (vazia)'
    : e.agora.map(i => `  [${i.id}] ${SIMBOLO[i.status]} ${i.texto}`).join('\n')
  const pend = e.pendencias.length === 0
    ? '  (nenhuma)'
    : e.pendencias.map(p => `  [${p.id}] ${p.texto} — adiado: ${p.motivo}`).join('\n')
  return `Agora:\n${agora}\nPendências:\n${pend}`
}

const DE_TODO: Record<Todo['status'], Status> = { pending: 'pendente', in_progress: 'fazendo', completed: 'feito' }

/** Espelha a lista do TodoWrite nativo em Agora, mantendo o início de quem já estava em andamento. */
export function espelharTodoWrite(e: Estado, todos: readonly Todo[], now: number): Estado {
  const agora = todos.map((t, n): Item => {
    const status = DE_TODO[t.status]
    const id = `t${n + 1}`
    if (status !== 'fazendo') return { id, texto: t.content, status }
    const antes = e.agora.find(i => i.texto === t.content && i.status === 'fazendo')
    return { id, texto: t.content, status, iniciadoEm: antes?.iniciadoEm ?? now }
  })
  return { ...e, agora }
}
