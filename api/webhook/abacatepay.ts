/// <reference types="node" />
import { createClient } from '@supabase/supabase-js';

// Inicializa o cliente do Supabase com Service Role para poder ignorar RLS no webhook
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

export default async function handler(req: any, res: any) {
  // Apenas aceita POST de webhooks
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const payload = req.body;
    console.log('AbacatePay Webhook Event:', JSON.stringify(payload));

    // AbacatePay geralmente manda o payload no body, e pelos seus prints, os eventos são 'checkout.completed' ou 'subscription.completed'.
    const eventName = payload?.event || payload?.type;
    const isPaid = 
      payload?.status === 'PAID' || 
      payload?.data?.status === 'PAID' || 
      eventName === 'checkout.completed' || 
      eventName === 'subscription.completed' ||
      eventName === 'transparent.completed';
    
    // Extrai os campos do payload dependendo da estrutura exata
    const customerId = payload?.customerId || payload?.data?.customerId || payload?.metadata?.customerId;
    
    // Para planos, vamos precisar saber pelo menos o que ele pagou
    let planName = 'pro_mensal'; // Default seguro
    
    // Tenta encontrar em produtos ou metadados
    const products = payload?.products || payload?.data?.products || [];
    if (products.length > 0) {
      if (products[0].name?.toLowerCase().includes('essencial')) {
         planName = products[0].name.toLowerCase().includes('anual') ? 'essencial_anual' : 'essencial_mensal';
      } else if (products[0].name?.toLowerCase().includes('pro')) {
         planName = products[0].name.toLowerCase().includes('anual') ? 'pro_anual' : 'pro_mensal';
      }
    }

    if (isPaid && customerId) {
      // Atualiza o plano do usuário no Supabase
      const { error } = await supabase
        .from('profiles')
        .update({ plan: planName })
        .eq('id', customerId);

      if (error) {
        console.error('Falha ao atualizar o plano no Supabase:', error);
        return res.status(500).json({ error: 'Failed to update user profile' });
      }

      console.log(`Plano do usuário ${customerId} atualizado para ${planName}`);
      return res.status(200).json({ received: true, updated: true });
    }

    // Mesmo que não seja "PAID" responde ok para o webhook não ficar retry
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
