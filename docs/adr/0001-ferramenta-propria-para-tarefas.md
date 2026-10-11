# ADR 0001 — Ferramenta própria em vez de espelhar só o TodoWrite

Data: 2026-10-11 · Status: aceito

## Contexto

O `painel-tarefas` precisa saber o que o Claude está fazendo. O Claude Code já tem listas internas (`TodoWrite`, `TaskCreate`/`TaskUpdate`), mas na sessão do app desktop usada no desenvolvimento essas ferramentas não estavam disponíveis ao modelo. Além disso, nenhuma delas tem o conceito de pendência persistente com motivo.

## Decisão

O mod registra sua própria ferramenta `tarefas` (sempre carregada, `isDeferred: false`) e injeta uma seção curta no system prompt dizendo quando usá-la. Chamadas do `TodoWrite` nativo, quando existirem, são espelhadas em "Agora".

## Alternativas descartadas

- **Só espelhar `TodoWrite`/`TaskCreate`**: painel vazio onde essas ferramentas não existem; sem pendências.
- **Ler as tarefas do texto das respostas**: frágil, depende de formato livre.
- **Arquivo `TASKS.md` no projeto**: polui o repositório do usuário e exige escrita em disco a cada mudança; pode virar exportação opcional no futuro.

## Consequências

- Custo de contexto: a descrição da ferramenta e a instrução ocupam algumas centenas de tokens por sessão.
- A instrução no system prompt é do mod: removê-lo remove o comportamento.
