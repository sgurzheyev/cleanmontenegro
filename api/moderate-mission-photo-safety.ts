import type { VercelRequest, VercelResponse } from '@vercel/node';

const PROMPT =
  'Analyze the image. Only return "EXPLICIT" if there is hardcore pornography, nudity, or explicit sexual acts. Otherwise, for ANYTHING else (faces, animals, trash, general clutter, vehicles, etc.), return "SAFE". Do not actively look for text or QR codes. Your default is SAFE. Return only "SAFE" or "EXPLICIT".';

function parseVerdict(text: string): 'SAFE' | 'EXPLICIT' | null {
  const t = text.trim().toUpperCase();
  if (t.includes('EXPLICIT')) return 'EXPLICIT';
  if (t.includes('SAFE')) return 'SAFE';
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as { imageBase64?: string; mimeType?: string };
    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType || 'image/jpeg';

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const dataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 24,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'low' },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('moderate-mission-photo-safety OpenAI error', openaiRes.status, errText);
      return res.status(502).json({ error: 'Vision service unavailable' });
    }

    const data = (await openaiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content || '';
    const verdict = parseVerdict(text);
    if (!verdict) {
      return res.status(422).json({ error: 'Invalid moderation response', raw: text.slice(0, 200) });
    }

    return res.status(200).json({ verdict });
  } catch (e: unknown) {
    console.error('moderate-mission-photo-safety', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
