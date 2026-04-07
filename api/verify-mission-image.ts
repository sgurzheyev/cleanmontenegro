import type { VercelRequest, VercelResponse } from '@vercel/node';

type VisionResult = {
  status: 'approved' | 'rejected';
  reason?: 'sexual_content' | 'unrelated' | 'low_quality' | 'not_trash' | string;
  keywords?: string[];
  suggestions?: string;
};

// Функция для генерации промпта на нужном языке
const getPrompt = (lang: string) => {
  const langMap: Record<string, string> = {
    ru: "Russian (Русский)",
    ar: "Arabic (العربية)",
    de: "German (Deutsch)",
    es: "Spanish (Español)",
    it: "Italian (Italiano)",
    fr: "French (Français)"
  };
  
  const targetLang = langMap[lang.toLowerCase()] || "English";

  return `Analyze this image for a cleanup mission. Return ONLY a valid JSON object:
  {"status": "approved" | "rejected", "reason": "...", "keywords": ["..."], "suggestions": "..."}

  Rules:
  - APPROVE if it shows waste, trash, debris, or a messy environment that needs cleaning.
  - REJECT if it's a selfie, a clean place, unrelated content, or sexual.

  LANGUAGE MISSION:
  1. Provide up to 3 'keywords' describing the waste (e.g., "plastic", "construction waste").
  2. Provide 'suggestions' as a helpful, motivating one-line advice for the user.
  3. CRITICAL: You MUST write BOTH 'keywords' and 'suggestions' in ${targetLang}.
  
  Example in ${targetLang}: {"status":"approved", "keywords":["пластик","бутылки"], "suggestions":"Отличная работа! Собери пластик в отдельный пакет для переработки."}`;
};

function extractJson(text: string): VisionResult | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as VisionResult;
    if (parsed.status === 'approved' || parsed.status === 'rejected') {
      if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Получаем base64 и язык пользователя (по умолчанию английский)
    const body = req.body as { imageBase64?: string; mimeType?: string; userLanguage?: string };
    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType || 'image/jpeg';
    const userLanguage = body?.userLanguage || 'en'; 

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
        model: 'gpt-4o-mini', // Используем быструю и дешевую модель с поддержкой зрения
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: getPrompt(userLanguage) },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'low' },
              },
            ],
          },
        ],
        response_format: { type: "json_object" } // Принудительно просим JSON
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('verify-mission-image OpenAI error', openaiRes.status, errText);
      return res.status(502).json({ error: 'Vision service unavailable' });
    }

    const data = (await openaiRes.json()) as any;
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text);

    if (!parsed) {
      return res.status(422).json({ error: 'Invalid vision response', raw: text.slice(0, 200) });
    }

    return res.status(200).json(parsed);
  } catch (e: unknown) {
    console.error('verify-mission-image error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}