import { AbacatepaySDK } from 'abacate-pay-sdk';

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
    const abacatepay = new AbacatepaySDK(process.env.ABACATEPAY_ACCESS_TOKEN);
    
    // As URLs de callback dependem do ambiente
    const baseUrl = process.env.VITE_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.headers.origin || 'http://localhost:5173');

    const billingParams: any = {
        frequency: 'SUBSCRIPTION',
        methods: ['PIX'], // Mantendo apenas PIX por segurança conforme sugestão do erro
        products: [{
            externalId: productId,
            name: productName,
            description: `Assinatura do Plano ${productName}`,
            quantity: 1,
            price: priceCents 
        }],
        returnUrl: `${baseUrl}/?payment=success`,
        completionUrl: `${baseUrl}/?payment=completion`,
        customerId: userId 
    };

    const response: any = await abacatepay.billing.create(billingParams);

    // A resposta deve ter a URL para o checkout
    return res.status(200).json({ url: response?.data?.url || response?.url });
  } catch (error: any) {
    console.error('Error creating AbacatePay billing:', error);
    return res.status(500).json({ 
        error: 'Failed to create checkout', 
        details: error?.message || error?.response?.data || error
    });
  }
}
