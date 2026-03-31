import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: 'Audio URL is required' });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'Missing REPLICATE_API_TOKEN environment variable' });
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    console.log('[Replicate] Starting Demucs 6-stem separation for', audioUrl);

    // Call Replicate model cjwbw/demucs with htdemucs_6s to get 6 stems
    // Returns: object containing URLs to the output stems: vocals, bass, drums, other, piano, guitar
    const output = await replicate.run(
      "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
      {
        input: {
          audio: audioUrl,
          model_name: "htdemucs_6s",
        }
      }
    );

    console.log('[Replicate] Separation complete', output);

    return res.status(200).json({ success: true, stems: output });
  } catch (error: any) {
    console.error('[Replicate Error]:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
