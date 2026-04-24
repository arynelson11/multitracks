/// <reference types="node" />
import axios from 'axios';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = process.env.ABACATEPAY_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'Server misconfiguration' });

  const api = axios.create({
    baseURL: 'https://api.abacatepay.com/v2',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  const [checkoutsRes, subscriptionsRes] = await Promise.allSettled([
    api.get('/checkouts'),
    api.get('/subscriptions'),
  ]);

  const checkouts: any[] = checkoutsRes.status === 'fulfilled'
    ? (checkoutsRes.value.data?.data ?? [])
    : [];

  const subscriptions: any[] = subscriptionsRes.status === 'fulfilled'
    ? (subscriptionsRes.value.data?.data ?? [])
    : [];

  const paidCheckouts = checkouts.filter((c: any) => c.status === 'PAID');
  const totalRevenueCents = paidCheckouts.reduce((sum: number, c: any) => sum + (c.amount ?? 0), 0);
  const activeSubscriptions = subscriptions.filter((s: any) => s.status === 'ACTIVE');

  // Recent 10 payments across both lists
  const recent = [...checkouts, ...subscriptions]
    .sort((a, b) => new Date(b.createdAt ?? b.created_at ?? 0).getTime() - new Date(a.createdAt ?? a.created_at ?? 0).getTime())
    .slice(0, 10)
    .map((c: any) => ({
      id: c.id,
      status: c.status,
      amount: c.amount ?? 0,
      createdAt: c.createdAt ?? c.created_at ?? null,
      metadata: c.metadata ?? null,
    }));

  return res.status(200).json({
    totalRevenueBRL: totalRevenueCents / 100,
    paidCount: paidCheckouts.length,
    totalCheckouts: checkouts.length,
    activeSubscriptions: activeSubscriptions.length,
    totalSubscriptions: subscriptions.length,
    recent,
  });
}
