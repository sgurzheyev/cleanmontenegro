import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  validateMissionDescription,
  filterMissionDescription,
  MISSION_DESCRIPTION_POLICY_ERROR,
} from '../src/lib/missionContentPolicy';
import imageCompression from 'browser-image-compression';
import { PROFILE_GLASS_PANEL } from '../constants';
import { fileToBase64Parts } from '../src/lib/imageBase64';

/** Before /api/verify-mission-image — keeps payload under Vercel body limits (~4.5MB). */
const VERIFY_MISSION_IMAGE_COMPRESSION = {
  maxWidthOrHeight: 1200,
  initialQuality: 0.7,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

export interface PhotoVerificationState {
  verifying: boolean;
  allApproved: boolean;
  hasRejected: boolean;
  /** AI-generated tags for mission metadata (non-blocking) */
  aiTags?: string[];
}

type Props = {
  taskType: 'city' | 'home';
  orderDescription: string;
  setOrderDescription: (v: string) => void;
  orderPhotos: File[];
  setOrderPhotos: (files: File[]) => void;
  onDescriptionPolicyError: (msg: string | null) => void;
  onPhotoVerificationChange: (s: PhotoVerificationState) => void;
  onTextWarning?: (msg: string | null) => void;
  hasTextWarning?: boolean;
};

function mergeKeywordsFromResponse(data: {
  keywords?: string[];
  suggestions?: string;
}): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  
  if (Array.isArray(data.keywords)) {
    for (const k of data.keywords) {
      if (typeof k === 'string') push(k);
    }
  }
  
  // ИСПРАВЛЕНИЕ: Больше не режем предложение по запятым! Берем целиком.
  if (typeof data.suggestions === 'string' && data.suggestions.trim()) {
    push(data.suggestions.trim());
  }
  
  return out.slice(0, 8);
}

const CreateMission: React.FC<Props> = ({
  taskType,
  orderDescription,
  setOrderDescription,
  orderPhotos,
  setOrderPhotos,
  onDescriptionPolicyError,
  onPhotoVerificationChange,
  onTextWarning,
  hasTextWarning = false,
}) => {
  const { t, i18n } = useTranslation();
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  const [photoStatuses, setPhotoStatuses] = useState<('pending' | 'done')[]>([]);
  const [aiKeywords, setAiKeywords] = useState<string[]>([]);
  const lastFilesKey = useRef<string>('');
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeDescription = useCallback(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 72), 320);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    resizeDescription();
  }, [orderDescription, resizeDescription]);

  const runVerification = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setPhotoStatuses([]);
        setAiKeywords([]);
        onPhotoVerificationChange({
          verifying: false,
          allApproved: true,
          hasRejected: false,
          aiTags: [],
        });
        return;
      }
      setCheckingPhotos(true);
      onPhotoVerificationChange({
        verifying: true,
        allApproved: true,
        hasRejected: false,
        aiTags: [],
      });
      const statuses: ('pending' | 'done')[] = files.map(() => 'pending');
      setPhotoStatuses(statuses);

      const collectedKeywords: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const compressed = await imageCompression(file, VERIFY_MISSION_IMAGE_COMPRESSION);
          const { base64, mimeType } = await fileToBase64Parts(compressed);
          
          // ОТПРАВЛЯЕМ ЗАПРОС С УЧЕТОМ ЯЗЫКА
          const res = await fetch('/api/verify-mission-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              imageBase64: base64, 
              mimeType,
              userLanguage: i18n.language || 'en' // <-- СЕРВЕР ТЕПЕРЬ ЗНАЕТ ЯЗЫК
            }),
          });
          
          const data = (await res.json().catch(() => ({}))) as {
            status?: string;
            keywords?: string[];
            suggestions?: string;
          };
          
          const merged = mergeKeywordsFromResponse(data);
          for (const kw of merged) {
            if (!collectedKeywords.includes(kw)) collectedKeywords.push(kw);
          }
        } catch {
          /* ignore — non-blocking */
        }
        statuses[i] = 'done';
        setPhotoStatuses([...statuses]);
      }

      const tags = collectedKeywords.slice(0, 8);
      setAiKeywords(tags);
      setCheckingPhotos(false);
      onPhotoVerificationChange({
        verifying: false,
        allApproved: true,
        hasRejected: false,
        aiTags: tags,
      });
    },
    [onPhotoVerificationChange, i18n.language] // <-- ДОБАВИЛИ ЗАВИСИМОСТЬ
  );

  useEffect(() => {
    const key = orderPhotos.map((f) => `${f.name}-${f.size}-${f.lastModified}`).join('|');
    if (key === lastFilesKey.current) return;
    lastFilesKey.current = key;
    setAiKeywords([]);
    void runVerification(orderPhotos);
  }, [orderPhotos, runVerification]);

  useEffect(() => {
    const { textWarningKey } = filterMissionDescription(orderDescription);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  }, [orderDescription, onTextWarning, t]);

  const handleDescriptionChange = (v: string) => {
    setOrderDescription(v);
    const r = validateMissionDescription(v);
    onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
    const { textWarningKey } = filterMissionDescription(v);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('uploadPhoto')}
          </label>
          <label className="flex min-h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 px-2 text-center text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
            {orderPhotos.length > 0 ? `${orderPhotos.length} ${t('photosSelected')}` : t('tapToAddReferencePhotos')}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []).slice(0, 10);
                setOrderPhotos(files);
              }}
            />
          </label>
          {orderPhotos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {orderPhotos.length <= 4 ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/10 border border-amber-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                  {t('lowProofWork')}
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  {t('highProofWork')}
                </span>
              )}
              {checkingPhotos && (
                <span className="text-[10px] text-cyan-300 animate-pulse">
                  {t('aiVerifyingPhoto')}
                </span>
              )}
            </div>
          )}
          {photoStatuses.length > 0 && (
            <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
              {orderPhotos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span
                    className={
                      photoStatuses[i] === 'done'
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }
                  >
                    {photoStatuses[i] === 'pending' || checkingPhotos
                      ? t('aiVerifyingPhotoShort')
                      : '✓'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('shortDescriptionAndArea')}
        </label>
        <textarea
          ref={descriptionRef}
          value={orderDescription}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          rows={2}
          placeholder={
            taskType === 'city' ? t('describeCitySpot') : t('describeHomeTask')
          }
          className={`w-full min-h-[4.5rem] max-h-[20rem] overflow-y-auto ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none ${
            hasTextWarning ? 'border-b-2 border-dashed border-[#ea580c]' : ''
          }`}
        />
        {aiKeywords.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
              {t('aiSuggestions') || 'AI suggestions'}:
            </span>
            {aiKeywords.map((kw, idx) => (
              <button
                key={`${kw}-${idx}`}
                type="button"
                onClick={() => {
                  const newVal =
                    orderDescription.trim() ? `${orderDescription.trim()} ${kw}` : kw;
                  setOrderDescription(newVal);
                  const r = validateMissionDescription(newVal);
                  onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
                  const { textWarningKey } = filterMissionDescription(newVal);
                  onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
                  requestAnimationFrame(() => resizeDescription());
                }}
                className="rounded-full border border-teal-500/40 bg-teal-500/15 px-2.5 py-1 text-[10px] font-semibold text-teal-100 shadow-sm ring-1 ring-teal-500/15 cursor-pointer transition-all hover:bg-teal-500/25 hover:border-teal-400/60 hover:ring-teal-400/30 active:scale-95"
              >
                {kw}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default CreateMission;
