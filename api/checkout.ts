import { AbacatePay } from 'abacate-pay-sdk';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { productId, productName, priceCents, userId, email } = req.body;

  if (!productId || !userId || !priceCents) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.ABACATEPAY_ACCESS_TOKEN) {
    console.error('Missing ABACATEPAY_ACCESS_TOKEN');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const abacatepay = new AbacatePay(process.env.ABACATEPAY_ACCESS_TOKEN);
    
    // As URLs de callback dependem do ambiente
    const baseUrl = process.env.VITE_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.headers.origin || 'http://localhost:5173');

    const response = await abacatepay.billing.create({
        frequency: productName.toLowerCase().includes('mensal') ? 'MONTHLY' : 'ANNUALLY',
        methods: ['PIX', 'CREDIT_CARD'], // Aceitando ambos se possível, ou apenas PIX
        products: [{
            externalId: productId,
            name: productName,
            description: `Assinatura do Plano ${productName}`,
            quantity: 1,
            price: priceCents 
        }],
        returnUrl: `${baseUrl}/?payment=success`,
        completionUrl: `${baseUrl}/?payment=completion`,
        customerId: userId // Utilizando o próprio ID do usuário para associá-lo, ou email
    });

    // A resposta deve ter a URL para o checkout
    return res.status(200).json({ url: response?.data?.url || response?.url });
  } catch (error) {
    console.error('Error creating AbacatePay billing:', error);
    return res.status(500).json({ error: 'Failed to create checkout' });
  }
}
