# limite-bar — Design

Data: 2026-10-11 · Status: implementado (v0.1.0)

## Objetivo

Mod do Claude Code que mostra, numa faixa acima do prompt, o consumo dos limites de uso (janela de 5h e semanal), o tempo até o reset, a projeção de quando o limite de 5h acaba no ritmo atual, os tokens da sessão e a ocupação do contexto. Avisa por toast ao cruzar 80% e 95%.

## Interface

Faixa `AbovePrompt`, uma linha. Alvo principal: **app desktop do Claude (aba Code)**, superfície `desktop`; a mesma faixa funciona no terminal. `bodyColumns` no desktop é medido em células da fonte de código do painel.

Modo completo (`bodyColumns >= 90`):

```
5h ███████░░░ 72% · reseta 1h48 · ritmo: acaba em ~40min │ sem ██░░░░░░░░ 22% · reseta seg 14:00 │ sessão 182k tok │ ctx 64%
```

Modo compacto (`bodyColumns < 90`):

```
5h 72% 1h48 ~40min │ sem 22% │ ctx 64%
```

- Barra de 10 blocos (`█` cheio, `░` vazio), arredondamento para o bloco mais próximo.
- Cor por janela: verde `< 60`, amarelo `60 ≤ p ≤ 85`, vermelho `> 85`.
- Reset da janela de 5h: contagem regressiva (`1h48`, `12min`, `<1min`). Semanal: dia abreviado + hora local (`seg 14:00`).
- Projeção (só janela de 5h):
  - `ritmo = percentUsed / minutosDecorridos`, onde `inicioJanela = resetsAt − 5h`.
  - `minutosAteAcabar = (100 − percentUsed) / ritmo`.
  - Se `minutosAteAcabar >= minutosAteReset` → `✓ folga`.
  - Caso contrário → `ritmo: acaba em ~Xmin` (ou `~1h10`).
  - Sem projeção (texto omitido) se `minutosDecorridos < 10` ou `percentUsed < 5` — amostra pequena demais para estimar.
- Sem dado de limite ainda (antes da primeira resposta): `5h —` / `sem —`.
- Contexto ausente (sessão nova ou recém-compactada): `ctx —`.
- Tokens: `950`, `182k`, `1,2M` (separador decimal vírgula).
- Enquanto `hasSurvey` for verdadeiro, a faixa cede (`next(e)`).
- Ocultar: usa o recolhimento nativo da faixa (`[-]` / ctrl+x ctrl+a) — o engine já oferece; nenhum botão próprio.

## Fonte dos dados

| Dado | Origem | Quando |
| --- | --- | --- |
| `rateLimits` (`five_hour`, `seven_day`: `percentUsed`, `resetsAt`) | `session.measure` (`e.rateLimits`) | fim de cada turno; janela mudou 1 ponto |
| `context.percent` | `session.measure` (`e.context`) | idem |
| tokens da sessão | `turn.complete` — soma de `input_tokens + cache_creation_input_tokens + output_tokens` (leitura de cache excluída: é a conversa relida a cada turno e inflaria o total) | fim de cada turno |
| hora atual | `$.clock` — tick de 60s só para redesenhar contagem regressiva e projeção | a cada minuto |

Leitura inicial em `session.start` via `$.session.usage()` para não começar vazio numa sessão retomada.

Sem polling de rede. Nenhuma chamada externa.

## Estado

`$.state` (sessão, sobrevive a hot-reload), contrato em `types/index.d.ts`:

```ts
'limite-bar': {
  limits: Limit[]          // { kind, percentUsed, resetsAt? }
  contextPercent: number | null
  sessionTokens: number
  now: number              // epoch ms do último tick
}
```

`$.store` (entre sessões): `firedAlerts: string[]` — chaves `"<kind>:<limiar>:<resetsAt>"` já avisadas. Podado no `session.start`: remove chaves cujo `resetsAt` já passou.

## Avisos

- Limiares 80 e 95, para `five_hour` e `seven_day`.
- Em `session.measure`: para cada janela e limiar com `percentUsed >= limiar` cuja chave não está em `firedAlerts` → toast + grava a chave.
- Se cruzar 80 e 95 no mesmo evento, só o aviso de 95 (marca as duas chaves).
- Texto: `⚠ Limite de 5h em 80% — reseta em 1h12` / `⚠ Limite semanal em 95% — reseta seg 14:00`.

## Arquivos

```
limite-bar/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.tsx     hooks: session.start, session.measure, turn.complete, ui.render(AbovePrompt); tick do relógio
  hooks/format.ts        funções puras: barra, cor, resetIn, resetAt, projeção, tokens, alertsToFire
  hooks/format.test.ts   testes unitários das funções puras
  hooks/register.test.ts testes de comportamento (claude plugin test)
  types/index.d.ts       contrato do $.state
```

Mod instalado em `~/.claude/dev-mods/<sessão>/limite-bar/` durante o desenvolvimento.

## Tratamento de erro

- `resetsAt` ausente ou inválido → sem contagem regressiva nem projeção para aquela janela; percentual continua.
- `resetsAt` no passado → `reseta agora`, sem projeção.
- `kind` desconhecido (ex.: `spend_limit` de gateway) → ignorado.
- Falha de `$.store` → toast pode repetir; nunca quebra a faixa.

## Testes

Unitários (`format.ts`):
- Cor em 59,9 / 60 / 85 / 85,1.
- Barra em 0, 4, 5, 50, 100.
- `resetIn`: 0, 30s, 12min, 1h48, passado.
- Projeção: folga, acaba antes do reset, amostra pequena (sem projeção).
- Tokens: 950, 182400, 1200000.
- `alertsToFire`: cruza 80; cruza 80 e 95 juntos; chave já disparada; `resetsAt` novo libera.

Comportamento (`claude plugin test`):
- `session.measure` a 81% → um toast; repetido → nenhum.
- `ui.render(AbovePrompt)` com `hasSurvey` → cede.
- `bodyColumns` 80 → modo compacto.

## Fora do escopo

Histórico, gráfico, custo em dólar, limiares configuráveis, gasto por turno, aviso de contexto cheio.

## Integração com painel-tarefas (v0.1.0)

Se o mod `painel-tarefas` estiver carregado, a faixa lê `$.state` `painel-tarefas.resumo` (`{ feitos, total, pendencias }`) e acrescenta ao final um botão `📋 f/t · n pend.` que roda `/tarefas`. Sem o mod, a leitura falha silenciosamente e nada aparece — os dois mods continuam independentes.
