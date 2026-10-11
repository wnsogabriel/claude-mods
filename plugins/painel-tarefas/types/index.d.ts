export type Status = 'pendente' | 'fazendo' | 'feito'
export type Item = { id: string; texto: string; status: Status; iniciadoEm?: number }
export type Pendencia = { id: string; texto: string; motivo: string; criadoEm: number }
export type Contagem = { feitos: number; total: number; pendencias: number }

declare module 'claude-code' {
  interface PluginState {
    'painel-tarefas': {
      agora: Item[]
      pendencias: Pendencia[]
      adiadas: number
      projeto: string
      now: number
      isOpen: boolean
      resumo: Contagem | null
    }
  }
}
