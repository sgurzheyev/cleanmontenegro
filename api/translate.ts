import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = new Set(['en', 'ar', 'ru', 'de', 'it', 'es']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, targetLanguage } = req.body as {
      text?: string;
      targetLanguage?: string;
    };

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    const target = (targetLanguage || 'en').toLowerCase().split('-')[0];
    if (!ALLOWED.has(target)) {
      return res.status(400).json({ error: 'Unsupported target language' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a translation engine. Translate user text precisely to target language. Return only translated text, no explanations.',
          },
          {
            role: 'user',
            content: `Target language: ${target}\nText:\n${text}`,
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errPayload = await openaiRes.text().catch(() => '');
      console.error('translate api openai error:', errPayload || openaiRes.status);
      return res.status(500).json({ error: 'Translation provider request failed' });
    }

    const payload = (await openaiRes.json()) as any;
    const translatedText = payload?.choices?.[0]?.message?.content?.trim?.() || '';
    if (!translatedText) {
      console.error('translate api: empty translation payload');
      return res.status(500).json({ error: 'No translation returned' });
    }

    return res.status(200).json({ translation: translatedText });
  } catch (err: any) {
    console.error('translate api error:', err?.message || err);
    return res.status(500).json({ error: 'Translation failed' });
  }
}
