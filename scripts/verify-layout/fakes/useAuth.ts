// Só no verificador de layout (faixa B da Parte 3): no lugar do src/hooks/useAuth.ts, uma conta
// de teste com o pior caso de texto (nome e e-mail compridos), admin pra mostrar o Painel de Upload.
// O vite.config.ts troca o módulo do app por este; nada daqui entra no app.
const noop = async () => {}

const USER = {
  id: 'verificador',
  email: 'maria.aparecida.figueiredo.louvor@igrejadabatistanova.com.br',
  created_at: '2026-07-10T12:00:00Z',
  user_metadata: { display_name: 'Maria Aparecida dos Santos Figueiredo' },
}

export function useAuth() {
  return {
    user: USER,
    session: null,
    loading: false,
    userPlan: 'free',
    isAdmin: true,
    blockedAt: null,
    refreshPlan: noop,
    updateProfile: noop,
    updatePassword: noop,
    signOutEverywhere: noop,
    deleteAccount: noop,
    signOut: noop,
  }
}
