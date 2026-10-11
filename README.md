# claude-mods

Mods para o [Claude Code](https://claude.com/claude-code), feitos para o app desktop (aba Code) e compatíveis com o terminal.

| Mod | O que faz |
| --- | --- |
| **limite-bar** | Faixa acima do prompt com o uso dos limites de **5h** e **semanal**, tempo até o reset, **projeção de ritmo** ("nesse ritmo, acaba em ~40min"), tokens da sessão e contexto ocupado. Avisa em 80% e 95%. |
| **painel-tarefas** | Painel lateral com as tarefas do pedido atual (**Agora**) e **Pendências** que ficam salvas por projeto, com o motivo de terem sido adiadas. Botão ▶ retoma uma pendência direto no prompt. |

```
5h ███████░░░ 72% · reseta 1h48 · ritmo: acaba em ~40min │ sem ██░░░░░░░░ 22% · reseta seg 14:00 │ sessão 182k tok │ ctx 64% │ 📋 2/5 · 3 pend.
```

## Instalação

Requer Claude Code **2.1.295** ou mais recente. Num terminal com `claude`:

```
/plugin install limite-bar --marketplace wnsogabriel/claude-mods
/plugin install painel-tarefas --marketplace wnsogabriel/claude-mods
```

Responda `y` para adicionar o marketplace e escolha o escopo **user**. Instalado no escopo user, o mod também carrega nas sessões do app desktop.

Os dois mods são independentes; juntos, a faixa do `limite-bar` ganha o contador `📋` que abre o painel.

## Uso

### limite-bar

- Aparece sozinho acima do prompt. Antes da primeira resposta da sessão mostra `5h —` (o dado de limite chega com a resposta).
- Cores: verde < 60%, amarelo 60–85%, vermelho > 85%.
- Projeção só aparece depois de 10 min de janela e 5% de uso (antes disso a amostra é pequena demais).
- `sessão … tok` soma entrada nova + escrita de cache + saída. Leitura de cache fica de fora (é a conversa relida a cada turno).
- Janela estreita (ou painel aberto ao lado) → modo compacto.
- Esconder: `[-]` ao lado da faixa, ou `ctrl+x ctrl+a`.

### painel-tarefas

- `/tarefas` abre/fecha o painel.
- O Claude planeja pedidos de 3+ etapas no painel e vai marcando o progresso.
- Diga "deixa pra depois" e o item vira pendência, com o motivo.
- Pendências: ▶ retomar (preenche o prompt, não envia) · ✓ concluir · ✕ remover · campo para adicionar à mão.
- O que não terminou numa sessão vira pendência automaticamente.
- Pendências são separadas por projeto (raiz do repositório git, ou a pasta da sessão).

## Desenvolvimento

Estrutura: cada mod em `plugins/<mod>/` (`.claude-plugin/plugin.json`, `hooks/register.tsx`, lógica pura testável em `hooks/*.ts`, contrato de estado em `types/index.d.ts`). Specs em `docs/specs/`, decisões em `docs/adr/`.

Rodar um mod direto desta pasta, com recarga ao salvar:

```
claude --plugin-dir ./plugins/limite-bar --plugin-dir ./plugins/painel-tarefas
```

No app desktop, a variável `CLAUDE_CODE_PLUGIN_DIRS` (no bloco `env` de `~/.claude/settings.json`) faz o mesmo.

Validar e testar:

```
claude plugin validate plugins/limite-bar
claude plugin test plugins/limite-bar
```

Checagem de tipos: ao carregar um mod de uma pasta, o Claude Code grava os tipos em `plugins/<mod>/.claude-plugin/types/` (ignorados pelo git); depois disso, `npx tsc -p plugins/<mod>`.

Ative o hook de pré-commit (varredura de segredos com [Gitleaks](https://github.com/gitleaks/gitleaks)):

```
git config core.hooksPath .githooks
```

O CI (`.github/workflows/ci.yml`) roda Gitleaks, `validate` e `test` de cada mod em todo push e PR. O Dependabot mantém as Actions atualizadas.

Nenhum mod usa chave de API, rede ou segredo. Não há variáveis de ambiente obrigatórias.

> A API de mods do Claude Code é *early access* e pode mudar entre versões. O CI fixa a versão do `claude` usada nos testes.

## Licença

[MIT](LICENSE)
