import { createClient } from '@supabase/supabase-js';
import { verifyUser } from './_lib/auth.js';
import { applyCors } from './_lib/cors.js';
import { asaasFromEnv } from './_lib/asaas.js';
import { BillingError, cancelSubscriptionForUser, type CancelResult } from './_lib/billing.js';

// Exclui a conta do PRÓPRIO usuário autenticado. O id vem sempre do JWT
// (verifyUser), nunca do body: o usuário só pode apagar a si mesmo.
//
// Antes de apagar qualquer coisa, cancela a assinatura no Asaas (senão o cartão
// seguiria sendo cobrado por uma conta que não existe): cancelamento imediato,
// e dentro de 7 dias da primeira cobrança com a mesma regra do arrependimento.
// Se o Asaas falhar ou ainda houver remoção pendente, a conta NÃO é apagada e o
// usuário recebe um erro claro. Os registros de pagamento ficam, sem o vínculo
// com a pessoa (guarda fiscal; a FK vira null).
export default async function handler(req: any, res: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    applyCors(req, res, 'POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

    const supabaseUrl    = process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const auth = await verifyUser(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Assinatura primeiro.
    let canceled: CancelResult | null = null;
    try {
        canceled = await cancelSubscriptionForUser(
            { db: supabase, asaas: asaasFromEnv(5000) },
            { userId: auth.userId, source: 'account_deleted', immediate: true },
        );
    } catch (e) {
        if (!(e instanceof BillingError && e.code === 'not_found')) {
            const status = e instanceof BillingError ? e.httpStatus : 500;
            const detail = e instanceof BillingError && e.code !== 'db_error'
                ? e.message
                : 'Não deu para cancelar sua assinatura agora. Tente de novo em alguns minutos.';
            console.error('[delete-account] cancelamento falhou, conta mantida:', e instanceof Error ? e.message : 'erro');
            // pending_stop já começa com "Sua conta não foi excluída"
            const message = detail.startsWith('Sua conta não foi excluída') ? detail : `Sua conta não foi excluída. ${detail}`;
            return res.status(status).json({ error: message });
        }
        // sem assinatura: segue
    }

    // 2. Login (o perfil sai junto pela FK on delete cascade). Músicas e faixas
    //    com user_id ficam órfãs mas inacessíveis.
    const { error } = await supabase.auth.admin.deleteUser(auth.userId);
    if (error) {
        console.error('delete-account error:', error.message);
        return res.status(500).json({
            error: canceled
                ? 'Não foi possível excluir a conta agora. Sua assinatura já foi cancelada e nada mais será cobrado. Tente de novo.'
                : 'Não foi possível excluir a conta. Tente de novo.',
        });
    }
    await supabase.from('profiles').delete().eq('id', auth.userId);

    return res.status(200).json({ ok: true, subscription: canceled });
}
