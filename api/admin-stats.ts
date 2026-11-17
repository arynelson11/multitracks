import { createAdminRouter } from './_lib/admin/http.js'
import { ADMIN_HANDLERS } from './_lib/admin/registry.js'

// Endpoint único do admin, roteado por ?action= (ações em api/_lib/admin,
// registradas em registry.ts). A Vercel do plano Hobby aceita no máximo 12
// funções em api/: ação nova entra aqui como ?action=, nunca como arquivo novo.
// O ?source=asaas|replicate do painel antigo saiu na T28: sem ?action= a
// resposta é 400 (ação desconhecida).
export default createAdminRouter(ADMIN_HANDLERS)
