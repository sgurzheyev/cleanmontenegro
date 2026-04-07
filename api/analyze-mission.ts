/**
 * Read-only AI audit of mission before/after photo URLs (OpenAI).
 * Constitution v6.0: does NOT mutate wallets, balances, or mission financial state.
 * Mission status / payouts are handled only by dedicated RPCs (e.g. supervisor approval).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type FraudAuditJson = {
  verified_status: 'fraud' | 'verified' | string;
  reasoning: string;
  landmark_consistency_score: number;
  trash_removal_score: number;
  suggested_score?: number;
};

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { missionId } = req.body as { missionId?: string };

    if (!missionId || typeof missionId !== 'string') {
      return res.status(400).json({ error: 'missionId is required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return res.status(500).json({ error: 'Supabase server config missing' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: mission, error: missionErr } = await supabase
      .from('missions')
      .select('id, title, description, photo_urls, after_photo_urls')
      .eq('id', missionId)
      .maybeSingle();

    if (missionErr) {
      console.error('analyze-mission: mission fetch error', missionErr.message);
      return res.status(500).json({ error: 'Failed to fetch mission' });
    }

    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' });
    }

    const photo_urls = (mission.photo_urls || []) as string[];
    const after_photo_urls = (mission.after_photo_urls || []) as string[];
    const mission_title = (mission.title || '') as string;
    const mission_description = (mission.description || '') as string;

    const systemPrompt =
      `You are the ultimate 'God-Mode' AI Auditor for CleanMontenegro, a marketplace for cleaning tasks. ` +
      `You evaluate tasks based on Before/After photos and the customer's text description.\n\n` +
      `MISSION CONTEXT:\n` +
      `Title: "${mission_title}"\n` +
      `Description: "${mission_description}"\n\n` +
      `Perform the following strict checks in order. If ANY step fails, immediately flag as "fraud".\n\n` +
      `STEP 1: TROLL, NSFW & PROFANITY FILTER (CRITICAL)\n` +
      `- Scan all images for nudity, inappropriate content, animal body parts, or irrelevant troll images.\n` +
      `- Analyze the mission text and images for hidden phone numbers, emails, or social media handles (users trying to bypass our platform).\n` +
      `- Check text for profanity or abusive language.\n` +
      `- IF FOUND: verified_status = "fraud", reasoning = "Policy Violation: [Explain what was found]".\n\n` +
      `STEP 2: CONTEXT & RELEVANCE\n` +
      `- Does the 'Before' imagery match the Mission Context? If the text says "clean the apartment kitchen" but the photo is a desert, or if the text is nonsense, fail it.\n\n` +
      `STEP 3: LOCATION GEOMETRY (THE ANTI-CHEAT)\n` +
      `- Ensure the 'After' photos are taken at the EXACT SAME location as the 'Before' photos.\n` +
      `- For OUTDOORS: Match buildings, horizon, static objects.\n` +
      `- For INDOORS: Match room layout, furniture, walls. Allow slight angle changes for tight spaces.\n\n` +
      `STEP 4: TASK COMPLETION\n` +
      `- Based on the Mission Context, did the worker actually complete the requested task (e.g., washed windows, removed specific garbage)?\n\n` +
      `OUTPUT FORMAT (JSON ONLY):\n` +
      `{\n` +
      `  "verified_status": "verified" | "fraud",\n` +
      `  "reasoning": "Step-by-step breakdown (Step 1-4) explaining your decision.",\n` +
      `  "landmark_consistency_score": 0.0 to 1.0,\n` +
      `  "trash_removal_score": 0.0 to 1.0\n` +
      `}`;

    const userPrompt =
      `before_photos:\n${photo_urls.join('\n')}\n\n` +
      `after_photos:\n${after_photo_urls.join('\n')}\n`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const text = await openaiRes.text().catch(() => '');
      console.error('analyze-mission: OpenAI error', openaiRes.status, text);
      return res.status(500).json({ error: 'AI analysis request failed' });
    }

    const json = (await openaiRes.json()) as any;
    const content: string = json?.choices?.[0]?.message?.content ?? '';

    const raw = extractJsonObject(content);
    if (!raw) {
      return res.status(500).json({ error: 'AI did not return valid JSON' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    const maybeSuggested = Number(parsed?.suggested_score);
    const maybeLandmark = Number(parsed?.landmark_consistency_score);
    const maybeTrash = Number(parsed?.trash_removal_score);
    const maybeStatus = String(parsed?.verified_status ?? '').trim();
    const maybeReasoning = String(parsed?.reasoning ?? '').trim();

    if (
      maybeReasoning &&
      maybeStatus &&
      Number.isFinite(maybeLandmark) &&
      Number.isFinite(maybeTrash)
    ) {
      const audit = parsed as FraudAuditJson;
      const landmark = Number(audit.landmark_consistency_score);
      const trash = Number(audit.trash_removal_score);
      const verifiedStatus = String(audit.verified_status ?? '').trim();
      const reasoning = String(audit.reasoning ?? '').trim();

      const in01 = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
      if (!in01(landmark) || !in01(trash)) {
        return res.status(500).json({ error: 'AI returned invalid scores' });
      }
      if (!reasoning) {
        return res.status(500).json({ error: 'AI returned empty reasoning' });
      }

      const suggestedFromModel = Number(audit.suggested_score);
      const suggested =
        Number.isFinite(suggestedFromModel) && in01(suggestedFromModel)
          ? suggestedFromModel
          : verifiedStatus.toLowerCase() === 'fraud'
            ? 0
            : (landmark + trash) / 2;
      const score = Math.round(suggested * 100);
      const verdict =
        `[${verifiedStatus || 'unknown'}] ` +
        `${reasoning}\n` +
        `Landmark match: ${(landmark * 100).toFixed(0)}% • Trash removal: ${(trash * 100).toFixed(0)}%`;

      return res.status(200).json({ score, verdict });
    }

    const score = Number(parsed?.score);
    const verdict = String(parsed?.verdict ?? '').trim();
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(500).json({ error: 'AI returned invalid score' });
    }
    if (!verdict) {
      return res.status(500).json({ error: 'AI returned empty verdict' });
    }

    return res.status(200).json({ score: Math.round(score), verdict });
  } catch (err: any) {
    console.error('analyze-mission error:', err?.message || err);
    return res.status(500).json({ error: 'AI analysis failed' });
  }
}
