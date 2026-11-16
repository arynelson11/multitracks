import { createAdminRouter } from './_lib/admin/http.js'
import { ADMIN_HANDLERS } from './_lib/admin/registry.js'
import { legacyStats } from './_lib/admin/legacyStats.js'

// Endpoint único do admin, roteado por ?action= (ações em api/_lib/admin,
// registradas em registry.ts). A Vercel do plano Hobby aceita no máximo 12
// funções em api/: ação nova entra aqui como ?action=, nunca como arquivo novo.
// O ?source=asaas|replicate das abas antigas segue até a T28 (decisão D3);
// tirar o desvio é tirar o { legacy } abaixo.
export default createAdminRouter(ADMIN_HANDLERS, { legacy: legacyStats })
