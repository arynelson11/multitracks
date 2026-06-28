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
    version: '1.3.16',
    date: '2026-06-28',
    title: 'Separações novas ficam firmes',
    items: [
      'Ao reabrir uma separação, as faixas continuam carregando mesmo depois de gerar o click, adicionar a voz guia ou ajustar o mixer. Antes, nesses casos, elas podiam voltar a aparecer em branco.',
      'Separações antigas que já estavam com as faixas em branco ainda precisam ser refeitas uma vez pra voltar a funcionar.',
    ],
  },
  {
    version: '1.3.15',
    date: '2026-06-28',
    title: 'Suas separações voltam a abrir',
    items: [
      'Ao reabrir uma separação salva, as faixas agora carregam normalmente. Antes, depois de um tempo, elas podiam aparecer em branco.',
      'As separações feitas a partir de agora ficam guardadas de forma permanente, prontas pra abrir sempre que você quiser.',
      'Separações antigas que já estavam com as faixas em branco precisam ser refeitas uma vez pra voltar a funcionar.',
    ],
  },
  {
    version: '1.3.14',
    date: '2026-06-28',
    title: 'Espaço controla a página certa',
    items: [
      'Na tela de separação, apertar Espaço agora toca e pausa as faixas separadas, e não mais a playback que estava aberta por trás.',
      'Cada tela responde só ao próprio áudio: o que você faz controla a página em que você está.',
    ],
  },
  {
    version: '1.3.13',
    date: '2026-06-26',
    title: 'Planos mais claros',
    items: [
      'O plano Livre agora foca em experimentar a separação: você separa em 2 faixas (voz e instrumental) e ouve cada uma no mixer, até 5 músicas por mês.',
      'Baixar as faixas, separar em 4 ou 6, BPM detectado pela IA, voz guia e marcar seções pra repetir trechos ao vivo agora fazem parte dos planos Pro e Studio.',
      'Quem já é Pro ou Studio continua com tudo liberado, sem mudança.',
    ],
  },
  {
    version: '1.3.12',
    date: '2026-06-26',
    title: 'Editou na biblioteca, atualiza em todo lugar',
    items: [
      'Ao editar nome, tom, BPM ou capa de uma música na biblioteca, a alteração agora aparece também na música já baixada, no repertório e no Modo Ao Vivo. Antes ficava com os dados antigos de quando você baixou.',
      'A atualização vale tanto online quanto offline: a versão salva no aparelho também é corrigida.',
    ],
  },
  {
    version: '1.3.11',
    date: '2026-06-26',
    title: 'Separação de faixas repaginada',
    items: [
      'A tela de separação ganhou visual novo: controles numa barra no topo, faixas bem mais coloridas, cronômetro da música e botão de loop.',
      'Voz guia: agora você arrasta os marcadores na linha do tempo pra onde quiser, a auto detecção ficou mais precisa, e tem botão pra transformar em canal, igual ao click.',
      'O metrônomo manual e a voz guia voltaram a funcionar no app de computador.',
      'Salva tudo sozinho: marcadores, ajustes do mixer e os canais de click e voz guia. Tem botão Salvar e aviso de confirmação.',
      'Ao voltar da separação, você cai direto em Minhas Separações.',
    ],
  },
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
