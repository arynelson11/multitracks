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
    baseURL: 'https://api.abacatepay.com/v2',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const baseUrl = process.env.VITE_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || req.headers.origin
    || 'http://localhost:5173';

  const items = [{ id: productId, quantity: 1 }];

  // Try /subscriptions/create first (for products with subscription cycle defined)
  try {
    const payload = {
      items,
      completionUrl: `${baseUrl}/?payment=success`,
    };
    console.log('Trying /subscriptions/create:', JSON.stringify(payload));
    const response = await api.post('/subscriptions/create', payload);
    console.log('Subscriptions response:', JSON.stringify(response.data));

    const url = response.data?.data?.url;
    if (url) return res.status(200).json({ url });
  } catch (err: any) {
    console.warn('/subscriptions/create failed:', JSON.stringify(err?.response?.data || err?.message));
  }

  // Fallback: /checkouts/create (one-time payment link)
  try {
    const payload = {
      items,
      completionUrl: `${baseUrl}/?payment=success`,
    };
    console.log('Trying /checkouts/create:', JSON.stringify(payload));
    const response = await api.post('/checkouts/create', payload);
    console.log('Checkouts response:', JSON.stringify(response.data));

    const url = response.data?.data?.url;
    if (url) return res.status(200).json({ url });

    return res.status(500).json({ error: 'No checkout URL returned', raw: response.data });
  } catch (err: any) {
    const errData = err?.response?.data;
    console.error('/checkouts/create failed:', JSON.stringify(errData || err?.message));
    return res.status(500).json({
      error: 'Failed to create checkout',
      details: errData || err?.message,
    });
  }
}
