import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { audioUrl } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'Audio URL is required' });

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

    // CREATE prediction asynchronously instead of waiting (prevents 10s Vercel timeout)
    const prediction = await replicate.predictions.create({
      version: "25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
      input: {
        audio: audioUrl,
        model_name: "htdemucs_6s",
      }
    });

    return res.status(200).json({ success: true, prediction });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
