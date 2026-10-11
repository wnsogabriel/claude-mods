# painel-tarefas — Design

Data: 2026-10-11 · Status: implementado (v0.1.0)

## Objetivo

Painel lateral no Claude Code (alvo principal: app desktop, aba Code) que mostra as tarefas do pedido atual (**Agora**) e uma lista de **Pendências** persistente por projeto, alimentada pelo Claude e pelo usuário.

## Como as tarefas entram

O mod registra a ferramenta `tarefas` (`mcp__painel-tarefas__tarefas`, `isDeferred: false` — sempre carregada):

| Ação | Campos | Efeito |
| --- | --- | --- |
| `planejar` | `itens: string[]` (1–30) | substitui Agora |
| `iniciar` | `id` | item vira `fazendo` (só um por vez) |
| `concluir` | `id` | item vira `feito` |
| `adiar` | `id` **ou** `texto`, + `motivo` | move de Agora para Pendências, ou cria pendência |
| `retomar` | `id` | move pendência para Agora |

- A entrada vem do modelo e é tratada como não confiável: `parseAcao` valida tipo, obrigatoriedade e corta textos em 300 caracteres. Entrada inválida → `{ deny }` com o motivo.
- Uma seção `painel-tarefas:instrucao` é acrescentada ao system prompt (`prompt.compose`, escopo `session`) orientando: planejar em pedidos de 3+ etapas; adiar sem pedir confirmação quando o usuário disser "deixa pra depois".
- Espelho: chamadas bem-sucedidas do `TodoWrite` nativo substituem Agora (quando a ferramenta existe na sessão; no app desktop ela pode não estar disponível — por isso a ferramenta própria).

## Dados

| Dado | Onde | Vida |
| --- | --- | --- |
| Agora `{ id, texto, status, iniciadoEm? }` | `$.state` | sessão |
| Pendências `{ id, texto, motivo, criadoEm }` | `$.state` + `$.store` chave `pendencias:<raiz>` | persistente por projeto |
| `resumo { feitos, total, pendencias }` | `$.state` | lido pelo `limite-bar` |

Raiz do projeto: `git -C <cwd> rev-parse --show-toplevel`; sem git, a pasta da sessão. Barras normalizadas para `/`.

Texto puro, sem HTML. Nenhum dado pessoal é coletado além do que o próprio usuário escrever.

## Painel

`Pane` id `painel-tarefas`, título `Tarefas · <nome do projeto>`.

- **AGORA**: `✓` feito (riscado, apagado), `▸` fazendo (destaque + minutos decorridos), `○` pendente.
- **PENDÊNCIAS (n)**: cada uma com `▶` (preenche o prompt com `Vamos retomar: <texto> (adiado: <motivo>)` **sem enviar** e move para Agora), `✓` (conclui, toast) e `✕` (remove), e o motivo abaixo.
- Campo `+ nova pendência…` (motivo `adicionado manualmente`); omitido em superfícies sem `Input` (mobile).
- Abertura: `/tarefas` abre/fecha; abre sozinho ao `planejar` 3+ itens se couber (o engine só posiciona abertura espontânea com janela larga).

## Comportamentos extras

- Toast `✓ N tarefas concluídas · M adiadas para pendências` quando Agora fica toda concluída.
- `session.end`: itens de Agora não concluídos viram pendências com motivo `sessão encerrada antes de concluir`.
- Contador `📋 f/t · n pend.` na faixa do `limite-bar` (clicável → `/tarefas`); sem `painel-tarefas`, não aparece.

## Robustez

- `tool.call` da ferramenta própria com `.catch` → `deny` com mensagem; observador do `TodoWrite` e `ui.close` com `.catch` → `next(e)`: falha do mod nunca bloqueia ferramenta nativa nem fechamento do painel.

## Testes

- `tarefas.test.ts`: validação, todas as ações, auxiliares (18 casos).
- `register.test.ts`: ferramenta → painel; recusa de entrada inválida; persistência pela raiz do git; carga no início; botões `▶`/`✕`; campo manual; toast de conclusão (desktop e terminal).

## Fora do escopo

Prioridade, prazos, integração com Jira/Linear/GitHub Issues, visão de todos os projetos, reordenar arrastando.
