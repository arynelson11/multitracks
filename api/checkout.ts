/// <reference types="node" />
import { AbacatepaySDK } from 'abacate-pay-sdk';

export default async function handler(req: any, res: any) {
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

  const { productId, productName, priceCents, userId, email, name, cellphone, taxId } = req.body;

  if (!productId || !userId || !priceCents || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.ABACATEPAY_ACCESS_TOKEN) {
    console.error('Missing ABACATEPAY_ACCESS_TOKEN');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const abacatepay = new AbacatepaySDK(process.env.ABACATEPAY_ACCESS_TOKEN);

    const baseUrl = process.env.VITE_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.headers.origin || 'http://localhost:5173');

    const billingParams: any = {
        frequency: 'MULTIPLE_PAYMENT',
        methods: ['PIX'],
        products: [{
            externalId: productId,
            name: productName,
            description: `Assinatura do Plano ${productName}`,
            quantity: 1,
            price: priceCents
        }],
        returnUrl: `${baseUrl}/?payment=success`,
        completionUrl: `${baseUrl}/?payment=completion`,
        customer: {
            name: name || email.split('@')[0],
            email: email,
            cellphone: cellphone || '',
            taxId: taxId || '',
        },
    };

    const response: any = await abacatepay.billing.create(billingParams);

    if (response?.error) {
        console.error('AbacatePay API error:', response.error);
        return res.status(400).json({ error: 'Checkout creation failed', details: response.error });
    }

    return res.status(200).json({ url: response?.data?.url || response?.url });
  } catch (error: any) {
    console.error('Error creating AbacatePay billing:', error);
    return res.status(500).json({
        error: 'Failed to create checkout',
        details: error?.message || error?.response?.data || error
    });
  }
}
