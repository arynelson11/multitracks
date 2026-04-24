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

  const { productId, userId, email } = req.body;

  if (!productId || !userId || !email) {
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

  // Endpoint correto para assinaturas: /subscriptions/create
  // O productId já é o ID do produto cadastrado no AbacatePay com ciclo definido
  const payload: any = {
    items: [{ id: productId, quantity: 1 }],
    methods: ['PIX'],
    returnUrl: `${baseUrl}/?payment=success`,
    completionUrl: `${baseUrl}/?payment=completion`,
    metadata: { supabaseUserId: userId },
  };

  // Se tiver customerId do AbacatePay, passa para pré-preencher o checkout
  if (req.body.abacateCustomerId) {
    payload.customerId = req.body.abacateCustomerId;
  }

  console.log('Creating subscription:', JSON.stringify(payload));

  try {
    const response = await api.post('/subscriptions/create', payload);
    console.log('Subscription response:', JSON.stringify(response.data));

    const url = response.data?.data?.url;
    if (!url) {
      return res.status(500).json({ error: 'No checkout URL returned', raw: response.data });
    }
    return res.status(200).json({ url });
  } catch (err: any) {
    const errData = err?.response?.data;
    console.error('Subscription creation failed:', JSON.stringify(errData || err?.message));
    return res.status(500).json({
      error: 'Failed to create checkout',
      details: errData || err?.message,
    });
  }
}
