import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    const { predictionId } = req.query;
    if (!predictionId) return res.status(400).json({ error: 'Missing predictionId' });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    const prediction = await replicate.predictions.get(predictionId as string);

    return res.status(200).json({ prediction });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Error fetching prediction' });
  }
}
