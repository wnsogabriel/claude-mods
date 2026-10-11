import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, Pendencia } from '../types'
import {
  aplicar, contagem, encerrarSessao, espelharTodoWrite, moverParaAgora,
  parseAcao, removerPendencia, resumoConclusao, resumoParaModelo, textoRetomar,
} from './tarefas'
import type { Estado } from './tarefas'

const agoraRef = atom({ plugin: 'painel-tarefas', key: 'agora' } as const, [] as Item[])
const pendenciasRef = atom({ plugin: 'painel-tarefas', key: 'pendencias' } as const, [] as Pendencia[])
const adiadasRef = atom({ plugin: 'painel-tarefas', key: 'adiadas' } as const, 0)
const projetoRef = atom({ plugin: 'painel-tarefas', key: 'projeto' } as const, '')
const nowRef = atom({ plugin: 'painel-tarefas', key: 'now' } as const, 0)
const isOpenRef = atom({ plugin: 'painel-tarefas', key: 'isOpen' } as const, false)
const resumoRef = { plugin: 'painel-tarefas', key: 'resumo' } as const

const PANE = 'painel-tarefas'
const TOOL = 'mcp__painel-tarefas__tarefas'
const AUTO_ABRIR_A_PARTIR = 3
const MINUTO = 60_000

const INSTRUCAO = [
  '# Painel de tarefas (mod painel-tarefas)',
  'Você tem a ferramenta `tarefas`, que alimenta um painel visível ao usuário.',
  '- Em pedidos com 3 ou mais etapas, chame `tarefas` com `acao: "planejar"` antes de começar, e use `iniciar`/`concluir` conforme avança.',
  '- Quando o usuário disser que algo fica para depois ("deixa pra depois", "depois a gente vê", "anota isso"), chame `acao: "adiar"` com um `motivo` curto em português, sem pedir confirmação.',
  '- Ao retomar uma pendência, use `acao: "retomar"` com o id dela.',
].join('\n')

const SCHEMA = {
  type: 'object',
  properties: {
    acao: { type: 'string', enum: ['planejar', 'iniciar', 'concluir', 'adiar', 'retomar'] },
    itens: { type: 'array', items: { type: 'string' }, description: 'planejar: as etapas, em ordem' },
    id: { type: 'string', description: 'iniciar/concluir/adiar/retomar: id do item, como listado na resposta' },
    texto: { type: 'string', description: 'adiar: texto de uma pendência nova (quando não há id)' },
    motivo: { type: 'string', description: 'adiar: por que ficou para depois' },
  },
  required: ['acao'],
}

const novoId = () => crypto.randomUUID().slice(0, 8)
const chaveStore = (projeto: string) => `pendencias:${projeto}`

async function lerEstado($: EngineInterface): Promise<Estado> {
  return {
    agora: await read($, agoraRef),
    pendencias: await read($, pendenciasRef),
    adiadas: await read($, adiadasRef),
  }
}

/** Grava o estado da sessão, persiste as pendências do projeto e publica o resumo para outros mods. */
async function gravar($: EngineInterface, e: Estado): Promise<void> {
  await update($, agoraRef, () => e.agora)
  await update($, pendenciasRef, () => e.pendencias)
  await update($, adiadasRef, () => e.adiadas)
  await $.state.set(resumoRef, contagem(e))
  const projeto = await read($, projetoRef)
  if (projeto !== '') await $.store.set(chaveStore(projeto), e.pendencias)
}

async function raizDoProjeto($: EngineInterface, cwd: string): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'])
    const raiz = r.stdout.trim()
    if (r.exitCode === 0 && raiz !== '') return raiz.replaceAll('\\', '/')
  } catch {
    // sem git: a pasta da sessão é o projeto
  }
  return cwd.replaceAll('\\', '/')
}

async function abrir($: EngineInterface): Promise<void> {
  const projeto = await read($, projetoRef)
  const nome = projeto.split('/').filter(Boolean).at(-1) ?? 'projeto'
  const r = await $.ui.open({ id: PANE, title: `Tarefas · ${nome}` })
  if (r.isPlaced) await update($, isOpenRef, () => true)
}

const minutos = (desde: number | undefined, now: number) =>
  desde === undefined ? '' : ` · ${Math.max(0, Math.floor((now - desde) / MINUTO))}min`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const projeto = await raizDoProjeto($, e.cwd)
    const salvas = ((await $.store.get(chaveStore(projeto))) as Pendencia[] | undefined) ?? []
    await update($, projetoRef, () => projeto)
    await update($, pendenciasRef, () => salvas)
    await update($, nowRef, () => Date.now())
    await $.state.set(resumoRef, contagem(await lerEstado($)))

    await $.tool.register({
      name: 'tarefas',
      description:
        'Gerencia o painel de tarefas visível ao usuário: planejar etapas (Agora), iniciar/concluir, ' +
        'adiar para Pendências (persistem por projeto, com motivo) e retomar pendências. Responde com a lista atual e os ids.',
      inputSchema: SCHEMA,
      isDeferred: false,
    })
    await $.command.register({ name: 'tarefas', description: 'Abre ou fecha o painel de tarefas e pendências' })
    $.clock.every(MINUTO, () => {
      void $.clock.now().then(n => update($, nowRef, () => n))
    })
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'painel-tarefas:instrucao', text: INSTRUCAO, scope: 'session' }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const acao = parseAcao(e as unknown as Record<string, unknown>)
    if ('erro' in acao) return { deny: acao.erro }
    const antes = await lerEstado($)
    const r = aplicar(antes, acao, await $.clock.now(), novoId)
    if ('erro' in r) return { deny: r.erro }
    await gravar($, r.estado)

    if (acao.acao === 'planejar' && acao.itens.length >= AUTO_ABRIR_A_PARTIR && !(await read($, isOpenRef))) {
      void abrir($).catch(() => undefined)
    }
    const fim = resumoConclusao(r.estado)
    if (fim !== null && resumoConclusao(antes) === null) $.ui.toast(fim, { timeoutMs: 6000 })
    return { result: resumoParaModelo(r.estado) }
  }).catch(() => ({ deny: 'painel-tarefas: falha interna ao atualizar o painel' }))

  // Só observa: uma falha aqui nunca pode bloquear o TodoWrite nativo.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await gravar($, espelharTodoWrite(await lerEstado($), e.todos, await $.clock.now()))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tarefas' }, async $ => {
    if (await read($, isOpenRef)) {
      await $.ui.close({ id: PANE })
      await update($, isOpenRef, () => false)
      return { text: 'Painel de tarefas fechado.' }
    }
    await abrir($)
    return { text: 'Painel de tarefas aberto.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isOpenRef, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const estado = await lerEstado($)
    if (estado.agora.some(i => i.status !== 'feito')) {
      await gravar($, encerrarSessao(estado, await $.clock.now(), novoId))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const estado = await lerEstado($)
    const now = (await read($, nowRef)) || Date.now()

    const linhaAgora = (i: Item) => (
      <Text
        key={i.id}
        color={i.status === 'fazendo' ? 'claude' : undefined}
        bold={i.status === 'fazendo'}
        dimColor={i.status === 'feito'}
        strikethrough={i.status === 'feito'}
        wrap="wrap"
      >
        {i.status === 'feito' ? '✓' : i.status === 'fazendo' ? '▸' : '○'} {i.texto}
        {i.status === 'fazendo' ? minutos(i.iniciadoEm, now) : ''}
      </Text>
    )

    const linhaPendencia = (p: Pendencia) => (
      <Box key={p.id} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Text wrap="wrap">○ {p.texto}</Text>
          </Box>
          <Button
            key={`retomar-${p.id}`}
            plain
            label="▶"
            onPress={async () => {
              await $.prompt.fill({ text: textoRetomar(p), mode: 'replace' })
              await gravar($, moverParaAgora(await lerEstado($), p.id, novoId))
            }}
          />
          <Text> </Text>
          <Button
            key={`concluir-${p.id}`}
            plain
            label="✓"
            onPress={async () => {
              await gravar($, removerPendencia(await lerEstado($), p.id))
              $.ui.toast(`✓ Pendência concluída: ${p.texto}`)
            }}
          />
          <Text> </Text>
          <Button
            key={`remover-${p.id}`}
            plain
            label="✕"
            onPress={async () => gravar($, removerPendencia(await lerEstado($), p.id))}
          />
        </Box>
        <Text dimColor wrap="wrap">  adiado: {p.motivo}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>AGORA</Text>
        {estado.agora.length === 0
          ? <Text dimColor>Nada planejado nesta sessão.</Text>
          : estado.agora.map(linhaAgora)}
        <Text> </Text>
        <Text bold>PENDÊNCIAS ({estado.pendencias.length})</Text>
        {estado.pendencias.length === 0
          ? <Text dimColor>Nenhuma pendência neste projeto.</Text>
          : estado.pendencias.map(linhaPendencia)}
        {Input === undefined ? null : (
          <Input
            key="nova"
            placeholder="+ nova pendência…"
            onSubmit={async valor => {
              if (valor.trim() === '') return
              const r = aplicar(
                await lerEstado($),
                { acao: 'adiar', texto: valor.trim().slice(0, 300), motivo: 'adicionado manualmente' },
                await $.clock.now(),
                novoId,
              )
              if (!('erro' in r)) await gravar($, r.estado)
            }}
          />
        )}
      </Box>
    )
  })
}
