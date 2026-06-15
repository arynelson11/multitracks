// Histórico de novidades do app. A cada release, adicione uma entrada no topo.
// A `version` mais recente (primeira do array) é comparada com a última vista
// pelo usuário (localStorage) pra decidir se mostra o popup de novidades.

export interface ChangelogEntry {
  version: string;        // ex: '1.1.0'
  date: string;           // ISO ex: '2026-06-13'
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.7',
    date: '2026-06-15',
    title: 'Planos atualizados',
    items: [
      'O Modo Ao Vivo, onde a banda acompanha pelo celular, agora faz parte dos planos Pro e Studio.',
      'Loop infinito das partes da música nos planos pagos. No Livre você repete um trecho até 4 vezes.',
      'No Studio, a banda controla as repetições e as seções direto do celular, sem limite de aparelhos.',
    ],
  },
  {
    version: '1.3.6',
    date: '2026-06-15',
    title: 'Repita partes da música ao vivo',
    items: [
      'Marque as seções da música (Intro, Verso, Refrão...) e repita qualquer parte: escolha quantas vezes ou deixe em loop infinito.',
      'Use o botão Voltar pra retornar a uma parte no fim da seção atual, sem cortar nada.',
      'Barra de seções nova com a forma de onda da música e as partes em cores.',
      'Atalhos no teclado: espaço toca/pausa, setas andam na música, e as letras I, V, P, R, B, F marcam as partes.',
      'A banda também repete e volta as partes pelo celular, no Modo Ao Vivo.',
      'As marcações, letra e cifra agora ficam salvas no aparelho, pra usar offline.',
    ],
  },
  {
    version: '1.3.5',
    date: '2026-06-15',
    title: 'Importar faixas do computador corrigido',
    items: [
      'Resolvido o travamento ao importar faixas direto do computador pelo app.',
      'As faixas agora carregam e aparecem no repertório normalmente.',
    ],
  },
  {
    version: '1.3.4',
    date: '2026-06-15',
    title: 'Atualizar ficou mais fácil',
    items: [
      'Quando sai uma versão nova, aparece um botão Atualizar no topo do app.',
      'A aba de Novidades também mostra um aviso com botão pra baixar.',
      'O app passa a checar atualização toda vez que você volta pra ele.',
    ],
  },
  {
    version: '1.3.3',
    date: '2026-06-15',
    title: 'Upload de músicas no app corrigido',
    items: [
      'Agora dá pra subir capa e faixas direto pelo app de computador.',
      'Resolvido o travamento ao adicionar arquivos do seu computador.',
      'O envio de pads do sistema também voltou a funcionar no app.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-06-13',
    title: 'Atualizações também no navegador',
    items: [
      'Quem usa pelo navegador agora é avisado quando sai uma versão nova.',
      'Um clique em Atualizar e você já está na versão mais recente, sem cache antigo.',
      'Sua aba de Perfil e Novidades disponível em todas as plataformas.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-06-13',
    title: 'Atualizações automáticas',
    items: [
      'No Windows, o app baixa e instala as novidades sozinho. É só reiniciar quando avisar.',
      'No Mac, o app avisa quando sai uma versão nova, com um clique pra baixar.',
      'Agora você não precisa ficar de olho no site pra atualizar.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-13',
    title: 'Seu perfil e novidades',
    items: [
      'Nova aba de Perfil: troque seu nome, foto e senha.',
      'Esta aba de Novidades, pra você acompanhar cada atualização.',
      'Tutorial guiado do app e da Separação de Faixas.',
      'Correções no Modo Ao Vivo no Windows.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-12',
    title: 'Playback Studio para desktop',
    items: [
      'App para Mac e Windows, com tudo funcionando offline.',
      'Modo Ao Vivo: a banda conecta pelo celular e acompanha a sessão.',
      'Controle pela banda: transporte, repertório, mixer, pads e tom.',
      'Letra e cifra com busca automática e rolagem sincronizada.',
    ],
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;
