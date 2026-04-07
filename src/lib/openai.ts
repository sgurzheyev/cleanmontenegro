export type AiResult = { score: number; verdict: string };

/**
 * Runs AI fraud/validation analysis for a mission via secure server-side API.
 * The OpenAI API key is never exposed to the client.
 */
export async function runMissionAiAnalysis(missionId: string): Promise<AiResult> {
  const res = await fetch('/api/analyze-mission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missionId }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error || `AI analysis failed (${res.status})`);
  }

  const data = (await res.json()) as { score?: number; verdict?: string };
  const score = Number(data?.score);
  const verdict = String(data?.verdict ?? '').trim();

  if (!Number.isFinite(score) || !verdict) {
    throw new Error('Invalid response from AI analysis');
  }

  return { score, verdict };
}
