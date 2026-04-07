import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import imageCompression from 'browser-image-compression';
import { supabase } from '../services/supabase';

/** Constitution v6.0 — same as CreateMission / verify-mission pipeline: max 1200px, quality 0.7 */
const GARBAGE_REPORT_IMAGE_COMPRESSION = {
  maxWidthOrHeight: 1200,
  initialQuality: 0.7,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

const MIN_VIDEO_DURATION_SEC = 2;

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function getVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const d = v.duration;
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error('invalid duration'));
        return;
      }
      resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('video load failed'));
    };
    v.src = url;
  });
}

export interface WorkResultUploaderProps {
  missionId: string;
  /** Mission pin — used with completion GPS for `completion_distance_meters`. */
  missionLat: number;
  missionLng: number;
  onSuccess?: () => void;
}

export const WorkResultUploader: React.FC<WorkResultUploaderProps> = ({
  missionId,
  missionLat,
  missionLng,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [afterPhotoFiles, setAfterPhotoFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  const onAfterPhotosChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (!list?.length) return;
      const next: File[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.type.startsWith('image/')) next.push(f);
      }
      setAfterPhotoFiles(next);
      event.target.value = '';
    },
    []
  );

  const onVideoChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('video/')) {
      setVideoFile(null);
      setVideoDurationSec(null);
      return;
    }
    try {
      const dur = await getVideoDurationSeconds(file);
      setVideoDurationSec(dur);
      if (dur < MIN_VIDEO_DURATION_SEC - 0.05) {
        setVideoFile(null);
        showToast('error', t('garbageReportVideoTooShort'));
        return;
      }
      setVideoFile(file);
    } catch {
      setVideoFile(null);
      setVideoDurationSec(null);
      showToast('error', t('garbageReportVideoTooShort'));
    }
  }, [showToast, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (afterPhotoFiles.length < 1) {
      showToast('error', t('garbageReportNeedPhoto'));
      return;
    }
    if (!videoFile) {
      showToast('error', t('garbageReportVideoRequired'));
      return;
    }
    let effectiveVideoDuration = videoDurationSec;
    if (effectiveVideoDuration == null) {
      try {
        effectiveVideoDuration = await getVideoDurationSeconds(videoFile);
        setVideoDurationSec(effectiveVideoDuration);
      } catch {
        showToast('error', t('garbageReportVideoTooShort'));
        return;
      }
    }
    if (effectiveVideoDuration < MIN_VIDEO_DURATION_SEC - 0.05) {
      showToast('error', t('garbageReportVideoTooShort'));
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        showToast('error', t('garbageReportSignIn'));
        return;
      }

      const uploadedPhotoUrls: string[] = [];
      for (const file of afterPhotoFiles.slice(0, 9)) {
        let toUpload: File = file;
        try {
          const compressed = await imageCompression(file, GARBAGE_REPORT_IMAGE_COMPRESSION);
          toUpload = compressed as File;
        } catch (err) {
          console.warn('Garbage report image compression failed, uploading original:', err);
        }
        const safeFileName = `mission_${missionId}_${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('order-photos')
          .upload(safeFileName, toUpload, { upsert: false, contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const {
          data: { publicUrl },
        } = supabase.storage.from('order-photos').getPublicUrl(safeFileName);
        uploadedPhotoUrls.push(publicUrl);
      }

      const isWebm = videoFile.type.includes('webm');
      const ext = isWebm ? 'webm' : 'mp4';
      const videoName = `garbage_${missionId}_${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
      const { error: videoErr } = await supabase.storage.from('liveness-videos').upload(videoName, videoFile, {
        upsert: false,
        contentType: videoFile.type || 'video/mp4',
      });
      if (videoErr) throw videoErr;
      const {
        data: { publicUrl: videoPublicUrl },
      } = supabase.storage.from('liveness-videos').getPublicUrl(videoName);

      const completionPos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!('geolocation' in navigator)) {
          reject(new Error('no geolocation'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const completionLat = completionPos.coords.latitude;
      const completionLng = completionPos.coords.longitude;
      const completionDistanceMeters = Math.round(
        distanceMeters(completionLat, completionLng, missionLat, missionLng)
      );

      const { error: rpcError } = await supabase.rpc('complete_public_mission_with_report', {
        p_mission_id: missionId,
        p_after_photo_urls: uploadedPhotoUrls,
        p_completion_lat: completionLat,
        p_completion_lng: completionLng,
        p_completion_distance_meters: completionDistanceMeters,
        p_proof_video_url: videoPublicUrl,
      });

      if (rpcError) throw rpcError;

      setToast(null);
      showToast('success', t('garbageReportSuccess'));
      setAfterPhotoFiles([]);
      setVideoFile(null);
      setVideoDurationSec(null);
      onSuccess?.();
    } catch (err: unknown) {
      console.error('Garbage report submit:', err);
      const geoErr =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof (err as GeolocationPositionError).code === 'number';
      const noGeo = err instanceof Error && err.message === 'no geolocation';
      if (geoErr || noGeo) {
        showToast('error', t('garbageReportLocationError'));
      } else {
        showToast('error', t('garbageReportErrorRpc'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-4 p-4 border-2 border-dashed border-cyan-400/80 rounded-xl bg-black/40">
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 max-w-md px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${
            toast.kind === 'success'
              ? 'bg-emerald-600/95 text-white border border-emerald-400/50'
              : 'bg-red-900/95 text-red-100 border border-red-500/50'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <h3 className="text-white font-bold text-center tracking-wide">{t('garbageReportTitle')}</h3>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <p className="text-[11px] text-slate-400 mb-2">{t('garbageReportAfterPhotosHelp')}</p>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={onAfterPhotosChange}
            disabled={loading}
            className="w-full text-sm text-cyan-100 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600 cursor-pointer disabled:opacity-50"
          />
          {afterPhotoFiles.length > 0 && (
            <p className="mt-2 text-xs text-emerald-300/90">
              {t('garbageReportPhotoCount', { count: afterPhotoFiles.length })}
            </p>
          )}
        </div>

        <div>
          <p className="text-[11px] text-slate-400 mb-2">{t('garbageReportVideoHelp')}</p>
          <input
            type="file"
            accept="video/*"
            capture="environment"
            onChange={onVideoChange}
            disabled={loading}
            className="w-full text-sm text-cyan-100 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-500 file:text-white hover:file:bg-violet-600 cursor-pointer disabled:opacity-50"
          />
          {videoFile && videoDurationSec != null && (
            <p className="mt-2 text-xs text-violet-200/90">
              {t('garbageReportVideoDuration', { seconds: videoDurationSec.toFixed(1) })}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-full px-6 py-3 text-sm font-black uppercase tracking-widest bg-gradient-to-r from-cyan-600 to-emerald-600 text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('garbageReportSubmitting') : t('garbageReportSubmit')}
        </button>
      </form>
    </div>
  );
};
