/// <reference types="node" />
import axios from 'axios';

export default async function handler(req: any, res: any) {
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

  const { productId, productName, priceCents, userId, email, name } = req.body;

  if (!productId || !userId || !priceCents || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const token = process.env.ABACATEPAY_ACCESS_TOKEN;
  if (!token) {
    console.error('Missing ABACATEPAY_ACCESS_TOKEN');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const api = axios.create({
    baseURL: 'https://api.abacatepay.com/v1',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const baseUrl = process.env.VITE_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || req.headers.origin
    || 'http://localhost:5173';

  // Passo 1: criar o customer no AbacatePay
  let customerId: string | undefined;
  try {
    const customerPayload = {
      name: name || email.split('@')[0],
      email,
      cellphone: '',
      taxId: '',
    };
    console.log('Creating AbacatePay customer:', JSON.stringify(customerPayload));
    const customerRes = await api.post('/customer/create', customerPayload);
    console.log('Customer response:', JSON.stringify(customerRes.data));
    customerId = customerRes.data?.data?.id;
  } catch (err: any) {
    const errData = err?.response?.data;
    console.warn('Customer creation failed (proceeding without customerId):', JSON.stringify(errData || err?.message));
  }

  // Passo 2: criar o billing
  const billingPayload: any = {
    frequency: 'ONE_TIME',
    methods: ['PIX'],
    products: [{
      externalId: productId,
      name: productName,
      description: `Assinatura ${productName}`,
      quantity: 1,
      price: priceCents,
    }],
    returnUrl: `${baseUrl}/?payment=success`,
    completionUrl: `${baseUrl}/?payment=completion`,
  };

  if (customerId) {
    billingPayload.customerId = customerId;
  } else {
    billingPayload.customer = {
      name: name || email.split('@')[0],
      email,
      cellphone: '',
      taxId: '',
    };
  }

  console.log('Creating billing:', JSON.stringify(billingPayload));

  try {
    const billingRes = await api.post('/billing/create', billingPayload);
    console.log('Billing response:', JSON.stringify(billingRes.data));

    const url = billingRes.data?.data?.url || billingRes.data?.url;
    if (!url) {
      return res.status(500).json({ error: 'No checkout URL returned', raw: billingRes.data });
    }
    return res.status(200).json({ url });
  } catch (err: any) {
    const errData = err?.response?.data;
    console.error('Billing creation failed:', JSON.stringify(errData || err?.message));
    return res.status(500).json({
      error: 'Failed to create checkout',
      details: errData || err?.message,
    });
  }
}
