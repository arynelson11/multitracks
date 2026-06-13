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
