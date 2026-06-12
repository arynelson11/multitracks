// Utilitário local: define uma senha numa conta existente via Supabase Admin API.
// Usado pra conseguir logar por email+senha no app desktop (Electron não faz o
// round-trip do login Google). Não contém segredos: lê tudo do ambiente.
//
// Uso:
//   node --env-file=.env.local scripts/set-admin-password.mjs <email> <novaSenha>
//
// Precisa de VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local.
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const [, , email, password] = process.argv

if (!url || !serviceKey) {
  console.error('Faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env.local.')
  process.exit(1)
}
if (!email || !password) {
  console.error('Uso: node --env-file=.env.local scripts/set-admin-password.mjs <email> <novaSenha>')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Localiza o usuário pelo email (pagina a lista por segurança).
let user = null
for (let page = 1; page <= 20 && !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) {
    console.error('Erro ao listar usuários:', error.message)
    process.exit(1)
  }
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null
  if (data.users.length < 1000) break
}

if (!user) {
  console.error(`Usuário não encontrado: ${email}`)
  process.exit(1)
}

const { error } = await admin.auth.admin.updateUserById(user.id, { password })
if (error) {
  console.error('Erro ao definir senha:', error.message)
  process.exit(1)
}

console.log(`✅ Senha definida para ${email}. Agora entre no app desktop com email + senha.`)
