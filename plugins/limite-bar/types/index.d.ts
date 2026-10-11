export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'limite-bar': {
      limits: Limit[]
      contextPercent: number | null
      sessionTokens: number
      now: number
    }
  }
}

/** O que o mod painel-tarefas publica em `$.state` (leitura apenas; ele é o dono). */
export type ResumoTarefas = { feitos: number; total: number; pendencias: number }

declare module 'claude-code' {
  interface PluginState {
    'painel-tarefas': { resumo: ResumoTarefas | null }
  }
}
