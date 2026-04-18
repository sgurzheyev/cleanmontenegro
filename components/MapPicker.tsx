import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Map, { NavigationControl, GeolocateControl, MapRef, Source, Layer, Popup } from 'react-map-gl';
import type { MapMouseEvent, PointLike } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import imageCompression from 'browser-image-compression';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { Recycle, Navigation, Camera, X, Clock } from 'lucide-react';
import TrustDepositInfoModal from './TrustDepositInfoModal';
import LiveMarketFeed, { type LiveMarketMission } from './LiveMarketFeed';
import {
  workerCanSecureMissionDeposit,
  isSecurityDepositFailure,
  checkHomeMissionWorkerVerification,
} from '../src/lib/trustDeposit';
import CreateMission from './CreateMission';
import type { PhotoVerificationState } from './CreateMission';
import {
  validateMissionDescription,
  filterMissionDescription,
} from '../src/lib/missionContentPolicy';
import {
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  SCOUT_STAKE_FEE_EGP,
} from '../constants';
import { formatEgp, formatEgpDigits } from '../src/lib/formatMoney';
import { profileWalletBalanceEgp } from '../src/lib/walletCredit';
import { floorEgp, parseIntegerEgpFromInput, sanitizeIntegerEgpDigits } from '../src/lib/integerEgpInput';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
// Montenegro bounding box (approx) to keep city pins in-market.
const EGYPT_MAX_BOUNDS: [[number, number], [number, number]] = [[18.4, 41.8], [20.4, 43.7]];
const PROOF_IMAGE_COMPRESSION = {
  maxWidthOrHeight: 1200,
  initialQuality: 0.7,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

const isInsideEgyptBounds = (lng: number, lat: number) =>
  lng >= EGYPT_MAX_BOUNDS[0][0] &&
  lng <= EGYPT_MAX_BOUNDS[1][0] &&
  lat >= EGYPT_MAX_BOUNDS[0][1] &&
  lat <= EGYPT_MAX_BOUNDS[1][1];

type TaskType = 'city' | 'home';

interface JobOnMap {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  current_funding?: number | null;
  location_lat: number;
  location_lng: number;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  created_at?: string | null;
  started_at?: string | null;
  completion_lat?: number | null;
  completion_lng?: number | null;
  completion_distance_meters?: number | null;
  creator?: {
    avatar_url?: string | null;
    phone_number?: string | null;
    is_verified?: boolean | null;
  } | null;
}

/** Same filter as mission markers — heatmap aligns with visible pins. */
function missionEligibleForMapPin(job: JobOnMap): boolean {
  // Phantom pins (unpaid mission drafts) must never appear on the map.
  if (job.status === 'pending_payment') return false;
  if (job.status === 'pending') return true;
  if (job.status === 'available') return true;
  if (job.status === 'funding') return true;
  if (job.status === 'in_progress') return true;
  if (job.status === 'completed') {
    const ts = job.created_at;
    if (!ts) return false;
    const completedAt = new Date(ts).getTime();
    if (!Number.isFinite(completedAt)) return false;
    return Date.now() - completedAt <= 24 * 60 * 60 * 1000;
  }
  return false;
}

interface MissionTransactionRow {
  id: string;
  user_id: string | null;
  mission_id?: string | null;
  amount: number;
  type: string;
  gateway?: string | null;
  created_at: string;
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Thin cylinder footprint: closed ring approximating a circle (meters radius). */
function footprintCylinderRing(
  lng: number,
  lat: number,
  radiusMeters = 2.5,
  segments = 28
): [number, number][] {
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (i / segments) * 2 * Math.PI;
    const eastM = radiusMeters * Math.cos(ang);
    const northM = radiusMeters * Math.sin(ang);
    const dLng = eastM / (111320 * cosLat);
    const dLat = northM / 111320;
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

function HallOfFameSlider({ mission }: { mission: JobOnMap }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(50);
  const beforePhotos = mission.photo_urls || [];
  const afterPhotos = mission.after_photo_urls || [];
  if (beforePhotos.length === 0 && afterPhotos.length === 0) {
    return (
      <p className="mt-4 text-xs text-slate-400">
        {t('noBeforeAfterPhotosYet')}
      </p>
    );
  }
  const before = beforePhotos[0] || afterPhotos[0];
  const after = afterPhotos[0] || beforePhotos[0];

  return (
    <div className="mt-5">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-cyan-500/20 bg-cyan-950/30 shadow-[0_4px_30px_rgba(6,182,212,0.1)]">
        <img src={before} alt={t('before')} className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute inset-0 overflow-hidden border-l border-amber-300/70 shadow-[0_0_30px_rgba(251,191,36,0.5)]"
          style={{ width: `${value}%` }}
        >
          <img src={after} alt={t('after')} className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-48 accent-amber-300"
          />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500 uppercase tracking-[0.18em]">
        <span>{t('before')}</span>
        <span>{t('after')}</span>
      </div>
    </div>
  );
}

function ActiveMissionWidget({
  mission,
  onNavigate,
  onUploadProof,
}: {
  mission: JobOnMap;
  onNavigate: () => void;
  onUploadProof: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = mission.started_at ? new Date(mission.started_at).getTime() : NaN;
  const endAt = Number.isFinite(started) ? started + 2 * 60 * 60 * 1000 : NaN;
  const msLeft = Number.isFinite(endAt) ? Math.max(0, endAt - now) : 0;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`pointer-events-auto w-full max-w-xl rounded-3xl p-4 ${PROFILE_GLASS_PANEL} border border-orange-500/35 shadow-[0_0_28px_rgba(249,115,22,0.2)]`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black text-orange-300 tabular-nums">
          {formatEgp(Number(mission.amount_target ?? 0))}
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300 tabular-nums">
          {`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
        </p>
        <button
          type="button"
          onClick={onNavigate}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/55 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all"
          aria-label="Navigate"
        >
          <Navigation className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={onUploadProof}
        className="mt-3 w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-orange-200 border border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] transition-all"
      >
        UPLOAD WORK PROOF
      </button>
    </motion.div>
  );
}

function CreatorMissionWidget({
  mission,
  onClose,
}: {
  mission: JobOnMap;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = mission.started_at ? new Date(mission.started_at).getTime() : NaN;
  const created = mission.created_at ? new Date(mission.created_at).getTime() : NaN;
  const anchor = Number.isFinite(started) ? started : created;
  const endAt = Number.isFinite(anchor) ? anchor + 2 * 60 * 60 * 1000 : NaN;
  const msLeft = Number.isFinite(endAt) ? Math.max(0, endAt - now) : 0;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`pointer-events-auto relative w-full max-w-xl rounded-3xl p-4 ${PROFILE_GLASS_PANEL} border border-orange-500/35 shadow-[0_0_28px_rgba(249,115,22,0.2)]`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/50 text-[10px] font-bold leading-none text-slate-400 shadow-sm hover:border-cyan-500/45 hover:text-cyan-200 hover:shadow-[0_0_10px_rgba(34,211,238,0.35)] transition-all"
        aria-label="Dismiss"
      >
        ✕
      </button>
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black text-orange-300 tabular-nums">
          {formatEgp(Number(mission.amount_target ?? 0))}
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300 tabular-nums">
          {`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
        </p>
        <div
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-500/55 bg-cyan-500/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.4)]"
          role="img"
          aria-label={t('waiting')}
        >
          <Clock className="h-4 w-4" strokeWidth={2.25} />
        </div>
      </div>
      <div className="mt-3 w-full rounded-full px-6 py-3 text-center text-sm font-black uppercase tracking-[0.2em] text-orange-200 border border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] transition-all">
        {t('orderNumber')} {mission.id.slice(0, 8)} - {t('status')}: {t('waiting')} / {t('accepted')}
      </div>
    </motion.div>
  );
}

function ProofUploadModal({
  open,
  mission,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  mission: JobOnMap | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  toast: { error: (msg: string) => void; success: (msg: string) => void };
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setFiles([]);
  }, [open]);

  const onFilesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files || []).filter((f) => f.type.startsWith('image/'));
    setFiles(next);
    event.target.value = '';
  }, []);

  const removeFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const previewUrls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const submitProof = useCallback(async () => {
    if (!mission) return;
    if (files.length === 0) {
      toast.error('Please add at least one after photo.');
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        toast.error('Please sign in first.');
        return;
      }

      const uploadedUrls: string[] = [];
      for (const file of files.slice(0, 9)) {
        let toUpload: File = file;
        try {
          const compressed = await imageCompression(file, PROOF_IMAGE_COMPRESSION);
          toUpload = compressed as File;
        } catch {
          // keep original when compression fails
        }

        const fileName = `proof_${mission.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        let uploadError: Error | null = null;

        const tryPrimary = await supabase.storage
          .from('mission-proofs')
          .upload(fileName, toUpload, { upsert: false, contentType: 'image/jpeg' });
        if (tryPrimary.error) {
          const tryFallback = await supabase.storage
            .from('order-photos')
            .upload(fileName, toUpload, { upsert: false, contentType: 'image/jpeg' });
          if (tryFallback.error) uploadError = tryFallback.error;
          else {
            const {
              data: { publicUrl },
            } = supabase.storage.from('order-photos').getPublicUrl(fileName);
            uploadedUrls.push(publicUrl);
          }
        } else {
          const {
            data: { publicUrl },
          } = supabase.storage.from('mission-proofs').getPublicUrl(fileName);
          uploadedUrls.push(publicUrl);
        }

        if (uploadError) throw uploadError;
      }

      const { error: updateError } = await supabase
        .from('missions')
        .update({
          after_photo_urls: uploadedUrls,
          status: 'review',
          report_submitted_at: new Date().toISOString(),
        })
        .eq('id', mission.id)
        .eq('cleaner_id', session.user.id)
        .eq('status', 'in_progress');
      if (updateError) throw updateError;

      toast.success('Proof uploaded! EGP will be credited after quick review.');
      await onSuccess();
      onClose();
      setFiles([]);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload proof. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [files, mission, onClose, onSuccess, toast]);

  return (
    <AnimatePresence>
      {open && mission && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-x-3 bottom-3 mx-auto max-w-2xl rounded-3xl p-5 ${PROFILE_GLASS_PANEL}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-[0.12em] text-orange-300">
                MISSION ACCOMPLISHED?
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full border border-white/20 text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>

            <label className="mt-4 block w-full cursor-pointer rounded-2xl border-2 border-dashed border-cyan-400/65 bg-cyan-500/5 p-8 text-center hover:bg-cyan-500/10 transition-all">
              <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/60 bg-black/50 text-cyan-300">
                <Camera className="h-6 w-6" />
              </div>
              <p className="text-sm font-bold text-cyan-200">Tap to capture/upload AFTER photos</p>
              <p className="mt-1 text-xs text-slate-400">Drag & drop supported, up to 9 photos</p>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={onFilesChange}
                disabled={submitting}
                className="hidden"
              />
            </label>

            {files.length > 0 && (
              <>
                <p className="mt-3 text-xs text-emerald-300 font-semibold">{files.length} photo(s) selected</p>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {previewUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative overflow-hidden rounded-xl border border-cyan-500/35 bg-black/50 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                    >
                      <img src={url} alt={`Proof ${idx + 1}`} className="h-28 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFileAt(idx)}
                        className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/70 bg-red-500/25 text-red-100 hover:bg-red-500/35 hover:shadow-[0_0_12px_rgba(248,113,113,0.55)] transition-all"
                        aria-label="Remove image"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={submitProof}
              disabled={submitting || files.length === 0}
              className="mt-5 w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-orange-100 border border-orange-500/70 bg-orange-500/20 hover:bg-orange-500/30 hover:shadow-[0_0_24px_rgba(249,115,22,0.45)] disabled:opacity-60"
            >
              {submitting ? 'SUBMITTING...' : 'SUBMIT PROOF & GET PAID'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
  selectedCoords?: { lat: number; lng: number } | null;
  onAvatarClick?: () => void;
  onRequestAuth?: () => void;
  flyToTarget?: { lat: number; lng: number } | null;
  onFlyToComplete?: () => void;
  orders?: any[]; // legacy, ignored
  currentAmount?: number; // legacy
  currentType?: 'home' | 'city'; // legacy
  hasFullAccess?: boolean; // legacy
  currentUserId?: string | null; // legacy
  onRequestPayment?: (params: {
    lat: number;
    lng: number;
    amount: number;
    type: 'home' | 'city';
  }) => void; // legacy, ignored
  showPayment?: boolean; // legacy
}

const customDarkStyle: any = {
  version: 8,
  sources: {
    composite: {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    },
  },
  sprite: 'mapbox://sprites/mapbox/dark-v10',
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#000000',
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'composite',
      'source-layer': 'water',
      paint: {
        'fill-color': '#808080',
      },
    },
    {
      id: 'road',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      paint: {
        'line-color': '#ffffff',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.4,
          16,
          2.5,
        ],
      },
    },
    {
      id: 'place_label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 3,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14, 14, 18],
        'text-anchor': 'center',
        'text-max-width': 10,
      },
      paint: {
        'text-color': '#e0e0e0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'road_label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'road_label',
      minzoom: 12,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
      },
      paint: {
        'text-color': '#c0c0c0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water_name_line',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'waterway_label',
      minzoom: 10,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
      },
      paint: {
        'text-color': '#a0a0a0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water_name_point',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'water_name',
      minzoom: 4,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14],
      },
      paint: {
        'text-color': '#a0a0a0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
  ],
};

const MapPicker: React.FC<MapPickerProps> = ({
  onLocationSelect,
  selectedCoords = null,
  onAvatarClick,
  onRequestAuth,
  flyToTarget,
  onFlyToComplete,
}) => {
  const { t, i18n } = useTranslation();
  const isRu = (i18n.language || '').toLowerCase().startsWith('ru');
  const mapRef = React.useRef<MapRef>(null);
  const hoveredBuildingIdRef = React.useRef<number | string | null>(null);
  const alertedBuildingIdsRef = React.useRef<Set<number | string>>(new Set());
  const [buildingPopup, setBuildingPopup] = useState<{ lng: number; lat: number } | null>(null);
  const orderFormRef = React.useRef<HTMLFormElement>(null);
  /** When true, next home submit uses wallet payment. */
  const orderFormWalletPayRef = React.useRef(false);
  /** Creator wallet (EUR) for "pay from wallet" on home missions. */
  const [creatorWalletEgp, setCreatorWalletEgp] = useState<number | null>(null);
  const [viewState, setViewState] = useState({
    latitude: 42.0932,
    longitude: 19.0981,
    zoom: 12.5,
    pitch: 45,
    bearing: 0,
  });

  const [jobs, setJobs] = useState<JobOnMap[]>([]);
  /** 3D tower hover (GeoJSON mission_id). */
  const [hoveredTowerMissionId, setHoveredTowerMissionId] = useState<string | null>(null);

  const [selectedLocation, setSelectedLocation] = useState<
    { lat: number; lng: number } | null
  >(selectedCoords || null);

  // Adaptive UI: task type selected = show form overlay
  const [taskTypeSelected, setTaskTypeSelected] = useState<TaskType | null>(null);
  const [dashboardExpanded, setDashboardExpanded] = useState(false);
  const [showLiveMarketFeed, setShowLiveMarketFeed] = useState(false);
  const [showCreatorStatusPanel, setShowCreatorStatusPanel] = useState(false);
  const [proofUploadMission, setProofUploadMission] = useState<JobOnMap | null>(null);
  const [taskType, setTaskType] = useState<TaskType>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhotos, setOrderPhotos] = useState<File[]>([]);
  const [descriptionPolicyError, setDescriptionPolicyError] = useState<string | null>(null);
  const [photoVerification, setPhotoVerification] = useState<PhotoVerificationState>({
    verifying: false,
    allApproved: true,
    hasRejected: false,
  });
  const [uploadingProof, setUploadingProof] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [mapToast, setMapToast] = useState<{
    message: string;
    variant: 'error' | 'success' | 'notice';
  } | null>(null);
  const [textWarning, setTextWarning] = useState<string | null>(null);

  const toast = useMemo(
    () => ({
      error: (message: string) => {
        setMapToast({ message, variant: 'error' });
        window.setTimeout(() => setMapToast(null), 3200);
      },
      success: (message: string) => {
        setMapToast({ message, variant: 'success' });
        window.setTimeout(() => setMapToast(null), 3200);
      },
      /** Non-blocking tip (e.g. add WhatsApp in Profile) */
      notice: (message: string) => {
        setMapToast({ message, variant: 'notice' });
        window.setTimeout(() => setMapToast(null), 4500);
      },
    }),
    []
  );

  const selectTaskType = useCallback((type: TaskType) => {
    setDashboardExpanded(false);
    setShowLiveMarketFeed(false);
    setShowCreatorStatusPanel(false);
    setProofUploadMission(null);
    setTaskType(type);
    setTaskTypeSelected(type);
    setOrderError(null);
    setOrderSuccess(null);
    setDescriptionPolicyError(null);
  }, []);

  const closeFormOverlay = useCallback(() => {
    if (!orderSubmitting) {
      setTaskTypeSelected(null);
      setOrderError(null);
      setOrderSuccess(null);
      setDescriptionPolicyError(null);
    }
  }, [orderSubmitting]);

  useEffect(() => {
    if (!taskTypeSelected) return;
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) setCreatorWalletEgp(null);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) setCreatorWalletEgp(profileWalletBalanceEgp(p?.wallet_balance));
    })();
    return () => {
      cancelled = true;
    };
  }, [taskTypeSelected]);

  // Bidding modal state
  const [bidJob, setBidJob] = useState<JobOnMap | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSuccess, setBidSuccess] = useState<string | null>(null);

  const [activeBidCounts, setActiveBidCounts] = useState<Record<string, number>>({});

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) =>
      setCurrentUserId(session?.user?.id ?? null)
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch pending and in_progress missions from Supabase
  const fetchMissions = useCallback(async () => {
    const { data, error } = await supabase
      .from('missions')
      .select(`
        id,
        category,
        amount_target,
        current_funding,
        location_lat,
        location_lng,
        status,
        cleaner_id,
        creator_id,
        description,
        photo_urls,
        after_photo_urls,
        created_at,
        started_at,
        completion_lat,
        completion_lng,
        completion_distance_meters,
        creator:profiles!creator_id (
          avatar_url,
          phone_number,
          is_verified
        )
      `)
      .in('status', ['pending', 'available', 'funding', 'in_progress', 'completed'])
      .not('status', 'eq', 'pending_payment')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error(
        'Ошибка загрузки jobs с Supabase:',
        error.message,
        (error as any)?.details || ''
      );
      setJobs([]);
      return;
    }

    const list: JobOnMap[] = (data || [])
      .filter((row: any) => row.status !== 'pending_payment')
      .filter(
        (row: any) =>
          typeof row.location_lat === 'number' &&
          typeof row.location_lng === 'number'
      ) as JobOnMap[];

    setJobs(list);

    // Fetch active bid counts (pending bids) for marker badges
    try {
      const jobIds = (list || []).map((j) => j.id);
      if (jobIds.length === 0) {
        setActiveBidCounts({});
        return;
      }
      const { data: bidsData } = await supabase
        .from('mission_bids')
        .select('mission_id')
        .in('mission_id', jobIds)
        .eq('status', 'pending');
      const counts: Record<string, number> = {};
      for (const row of (bidsData || []) as any[]) {
        const jid = row.mission_id as string;
        counts[jid] = (counts[jid] || 0) + 1;
      }
      setActiveBidCounts(counts);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  useEffect(() => {
    const handleFocus = () => fetchMissions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchMissions]);

  useEffect(() => {
    const onPaymentSuccess = () => {
      // Initial refresh
      fetchMissions();
      // Simple polling to wait for webhook to finish inserting the mission
      setTimeout(() => fetchMissions(), 1500);
      setTimeout(() => fetchMissions(), 4000);
    };
    window.addEventListener('paymentSuccess', onPaymentSuccess);
    return () => window.removeEventListener('paymentSuccess', onPaymentSuccess);
  }, [fetchMissions]);

  // Paymob-specific webhook reconciliation removed (Stripe-only + wallet-funded missions).

  // Fly to job location when requested from Profile "View on Map"
  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: 16,
      essential: true,
      duration: 2000,
    });
    onFlyToComplete?.();
  }, [flyToTarget, onFlyToComplete]);

  const PENDING_SUBMIT_KEY = 'cleanmontenegro_pending_submit';

  const executePaymentFlow = useCallback(
    async (payload: {
      amount: number;
      taskType: TaskType;
      location: { lat: number; lng: number };
      description: string;
      creatorPhotos?: string[];
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      // Stripe-only (Montenegro): missions are funded via wallet.
      // Create as pending_payment, then attempt pay-from-wallet (if funded).
      const { data: newMission, error: missionErr } = await supabase
        .from('missions')
        .insert({
          creator_id: session.user.id,
          category: payload.taskType === 'city' ? 'public' : 'home',
          amount_target: floorEgp(payload.amount),
          location_lat: payload.location.lat,
          location_lng: payload.location.lng,
          status: 'pending_payment',
          description: payload.description || null,
          photo_urls:
            payload.creatorPhotos && payload.creatorPhotos.length > 0 ? payload.creatorPhotos : [],
        })
        .select('id')
        .single();
      if (missionErr) throw missionErr;
      if (!newMission?.id) throw new Error('Mission creation failed');

      const { error: payErr } = await supabase.rpc('pay_mission_from_wallet', {
        p_mission_id: newMission.id,
      });
      if (payErr) {
        throw new Error(t('insufficientWalletBalance'));
      }
    },
    [t]
  );

  useEffect(() => {
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const raw = localStorage.getItem(PENDING_SUBMIT_KEY);
      if (!raw) return;

      try {
        const saved = JSON.parse(raw) as {
          taskType?: TaskType;
          amount?: string | number;
          location_lat?: number;
          location_lng?: number;
          description?: string;
        };
        const amount =
          typeof saved.amount === 'number'
            ? floorEgp(saved.amount)
            : parseIntegerEgpFromInput(String(saved.amount ?? ''));
        if (amount <= 0) {
          localStorage.removeItem(PENDING_SUBMIT_KEY);
          return;
        }
        if (typeof saved.location_lat !== 'number' || typeof saved.location_lng !== 'number') {
          localStorage.removeItem(PENDING_SUBMIT_KEY);
          return;
        }

        localStorage.removeItem(PENDING_SUBMIT_KEY);

        setTaskType(saved.taskType || 'city');
        setTaskTypeSelected(saved.taskType || 'city');
        setOrderAmount(String(amount));
        setSelectedLocation({ lat: saved.location_lat, lng: saved.location_lng });
        setOrderDescription(saved.description || '');
        setOrderError(null);
        setOrderSuccess(null);

        await executePaymentFlow({
          amount,
          taskType: (saved.taskType as TaskType) || 'city',
          location: { lat: saved.location_lat, lng: saved.location_lng },
          description: saved.description || '',
        });
      } catch (e) {
        console.error('Pending submit restore error:', e);
        localStorage.removeItem(PENDING_SUBMIT_KEY);
      }
    };
    run();
  }, [executePaymentFlow]);

  const handleMapClick = useCallback(
    (event: any) => {
      if (!event?.lngLat) return;
      const { lng, lat } = event.lngLat;
      if (!isInsideEgyptBounds(lng, lat)) {
        toast.error(t('geofenceEgyptShelf'));
        return;
      }

      setSelectedLocation({ lat, lng });
      onLocationSelect(lat, lng);
    },
    [onLocationSelect, t]
  );

  const [selectedMission, setSelectedMission] = useState<JobOnMap | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [showTranslateAction, setShowTranslateAction] = useState(false);
  const [hallOfFameMission, setHallOfFameMission] = useState<JobOnMap | null>(null);
  const [hallOfFameCleanerName, setHallOfFameCleanerName] = useState<string | null>(null);
  const [hallOfFameHeroes, setHallOfFameHeroes] = useState<string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  /** Worker wallet + frozen (EGP) for security deposit checks on the selected mission. */
  const [workerTrustSnapshot, setWorkerTrustSnapshot] = useState<{
    wallet: number;
    frozen: number;
    isVerified: boolean;
  } | null>(null);
  const [showBidInput, setShowBidInput] = useState(false);
  const [missionBidAmount, setMissionBidAmount] = useState<string>('');
  const [showCrowdfundConfirm, setShowCrowdfundConfirm] = useState(false);
  const [crowdfundBidAmount, setCrowdfundBidAmount] = useState<number | null>(null);
  /** User-entered EGP for "close deal" co-fund (any positive amount, not tied to gap) */
  const [crowdfundCoFundInput, setCrowdfundCoFundInput] = useState('');
  const [showDonate, setShowDonate] = useState(false);
  const [donateAmount, setDonateAmount] = useState<string>('');
  const [donating, setDonating] = useState(false);
  const [trustDepositInfoOpen, setTrustDepositInfoOpen] = useState(false);

  /** Keep WebGL map markers visually below modal stack (z-[9999]); dim when any overlay is open. */
  const mapMarkerLayerSuppressed = useMemo(
    () =>
      Boolean(
        bidJob ||
          selectedMission ||
          showCrowdfundConfirm ||
          hallOfFameMission ||
          taskTypeSelected ||
          trustDepositInfoOpen
      ),
    [
      bidJob,
      selectedMission,
      showCrowdfundConfirm,
      hallOfFameMission,
      taskTypeSelected,
      trustDepositInfoOpen,
    ]
  );

  const detectLikelyLanguage = (text: string): 'ar' | 'ru' | 'en' => {
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    return 'en';
  };

  const appLanguage = (i18n.language || 'en').split('-')[0];

  const translateMissionDescription = useCallback(async (text: string) => {
    try {
      setIsTranslationLoading(true);
      setTranslationError(null);
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage: appLanguage }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Translate failed');
      }
      const payload = (await res.json()) as { translation?: string };
      setTranslatedText(payload.translation || null);
    } catch (e) {
      console.error('Mission description translation error:', e);
      setTranslatedText(null);
      setTranslationError('Translation failed. Try again.');
    } finally {
      setIsTranslationLoading(false);
    }
  }, [appLanguage]);

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewedMissions, setReviewedMissions] = useState<Set<string>>(new Set());
  const [missionTransactions, setMissionTransactions] = useState<MissionTransactionRow[]>([]);
  const [missionTxLoading, setMissionTxLoading] = useState(false);
  const [missionTxError, setMissionTxError] = useState<string | null>(null);
  const [gpsDistanceMeters, setGpsDistanceMeters] = useState<number | null>(null);
  const [gpsDistanceError, setGpsDistanceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!selectedMission) {
      setWorkerTrustSnapshot(null);
      return;
    }
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) setWorkerTrustSnapshot(null);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, is_verified')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled)
        setWorkerTrustSnapshot({
          wallet: Number(p?.wallet_balance ?? 0),
          frozen: Number(p?.frozen_balance ?? 0),
          isVerified: !!p?.is_verified,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMission?.id]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setMissionTransactions([]);
      setMissionTxError(null);
      setGpsDistanceMeters(null);
      setGpsDistanceError(null);
      if (!selectedMission?.id) return;

      setMissionTxLoading(true);
      try {
        const { data, error } = await supabase
          .from('transactions')
          .select(`
            id, 
            user_id, 
            mission_id, 
            amount, 
            type, 
            gateway, 
            created_at,
            profile:profiles!user_id (
              full_name,
              avatar_url
            )
          `)
          .eq('mission_id', selectedMission.id)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        if (!cancelled) setMissionTransactions((data || []) as MissionTransactionRow[]);
      } catch (e: any) {
        console.error('Mission transactions fetch error:', e);
        if (!cancelled) setMissionTxError(e?.message || 'Failed to load mission transactions.');
      } finally {
        if (!cancelled) setMissionTxLoading(false);
      }

      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          if (selectedMission.location_lat == null || selectedMission.location_lng == null) return;
          const d = haversineMeters(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            { lat: selectedMission.location_lat, lng: selectedMission.location_lng }
          );
          setGpsDistanceMeters(d);
        },
        () => {
          if (!cancelled) setGpsDistanceError('GPS unavailable.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedMission?.id, selectedMission?.location_lat, selectedMission?.location_lng]);

  const potentialCardingUserIds = (() => {
    const SMALL_EGP_MAX = 100;
    const WINDOW_MS = 10 * 60 * 1000;
    const MIN_COUNT = 4;
    const now = Date.now();
    const recent = missionTransactions.filter((tx) => {
      const ts = new Date(tx.created_at).getTime();
      return Number.isFinite(ts) && now - ts <= WINDOW_MS;
    });
    const counts: Record<string, number> = {};
    for (const tx of recent) {
      const uid = tx.user_id || '';
      if (!uid) continue;
      const amt = Number(tx.amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > SMALL_EGP_MAX) continue;
      counts[uid] = (counts[uid] || 0) + 1;
    }
    return new Set(Object.entries(counts).filter(([, c]) => c >= MIN_COUNT).map(([uid]) => uid));
  })();

  const handleMarkerClick = useCallback((job: JobOnMap) => {
    setSelectedMission(job);
    setShowBidInput(false);
    setMissionBidAmount(String(Math.floor(Number(job.amount_target ?? 0))));
  }, []);

  const handleMapClickWithTowers = useCallback(
    (event: any) => {
      // Cluster click → zoom in and expand the cluster.
      const clusterFeature = event?.features?.find(
        (x: { layer?: { id?: string } }) => x.layer?.id === 'missions-clusters'
      );
      const clusterId = clusterFeature?.properties?.cluster_id;
      if (clusterId != null && mapRef.current) {
        const map = mapRef.current.getMap();
        const coords = clusterFeature?.geometry?.coordinates as [number, number] | undefined;
        const src = map.getSource('missions') as any;
        if (coords && src?.getClusterExpansionZoom) {
          src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
            if (err) return;
            map.easeTo({ center: coords, zoom, duration: 750, essential: true });
          });
          return;
        }
      }

      // Unclustered mission click → open existing mission panel logic.
      const f = event?.features?.find(
        (x: { layer?: { id?: string } }) => x.layer?.id === 'missions-unclustered'
      );
      const mid = f?.properties?.mission_id;
      if (mid != null) {
        const job = jobs.find((j) => j.id === String(mid));
        if (job) {
          handleMarkerClick(job);
          return;
        }
      }
      handleMapClick(event);
    },
    [jobs, handleMarkerClick, handleMapClick]
  );

  // Permanently highlight buildings that have an active mission inside/adjacent.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded?.()) return;
    if (!map.getLayer('3d-buildings')) return;

    const clearPrev = () => {
      const prev = alertedBuildingIdsRef.current;
      for (const id of prev) {
        try {
          map.setFeatureState({ source: 'composite', sourceLayer: 'building', id }, { alert: false });
        } catch {
          // ignore
        }
      }
      prev.clear();
    };

    const apply = () => {
      clearPrev();

      const next = new Set<number | string>();
      // Avoid referencing `missionsGeoJSON` here (it is declared later in the file).
      // We only need coordinates for screen-space building proximity queries.
      const points = (jobs || [])
        .filter(missionEligibleForMapPin)
        .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng));

      for (const j of points) {
        const p = map.project({ lng: j.location_lng, lat: j.location_lat });
        // Small screen-space buffer approximates "inside or immediately adjacent".
        const pad = 6;
        const bbox: [PointLike, PointLike] = [
          [p.x - pad, p.y - pad],
          [p.x + pad, p.y + pad],
        ];
        const hits = map.queryRenderedFeatures(bbox as any, { layers: ['3d-buildings'] });
        for (const h of hits) {
          const id = (h as any).id;
          if (id == null) continue;
          next.add(id);
        }
      }

      for (const id of next) {
        try {
          map.setFeatureState({ source: 'composite', sourceLayer: 'building', id }, { alert: true });
        } catch {
          // ignore
        }
      }
      alertedBuildingIdsRef.current = next;
    };

    // Ensure it runs once style has finished rendering buildings.
    if (map.isStyleLoaded?.()) {
      map.once?.('idle', apply);
    } else {
      map.once?.('styledata', () => map.once?.('idle', apply));
    }

    return () => {
      // keep states; they will be reset on next load anyway
    };
  }, [jobs]);

  const handleCloseMissionBriefing = useCallback(() => {
    setSelectedMission(null);
    setTranslatedText(null);
    setIsTranslationLoading(false);
    setTranslationError(null);
    setShowTranslateAction(false);
    setShowBidInput(false);
    setMissionBidAmount('');
    setShowDonate(false);
    setDonateAmount('');
    setSelectedRating(0);
  }, []);

  const closeCrowdfundConfirm = useCallback(() => {
    setShowCrowdfundConfirm(false);
    setCrowdfundBidAmount(null);
    setCrowdfundCoFundInput('');
  }, []);

  const handleCoFundMission = useCallback(
    async (missionId: string, bidAmount: number) => {
      const { error } = await supabase.rpc('co_fund_and_accept_mission', {
        p_mission_id: missionId,
        p_bid_amount: floorEgp(bidAmount),
      });
      if (error) throw error;
    },
    []
  );

  const handleDonate = useCallback(
    async (amount: number) => {
      if (!selectedMission) return;
      const value = Math.floor(Number(amount));
      if (!Number.isFinite(value) || value <= 0) {
        toast.error(t('enterPositiveEgpAmount'));
        return;
      }
      try {
        setDonating(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          onRequestAuth?.();
          return;
        }
        const { error } = await supabase.rpc('donate_to_mission', {
          p_mission_id: selectedMission.id,
          p_amount: value,
        });
        if (error) {
          toast.error(t('mapToastDonationFailed'));
          return;
        }
        // Optimistically update local mission funding so UI reflects change immediately
        setSelectedMission((prev) =>
          prev
            ? {
                ...prev,
                current_funding: Math.floor(Number(prev.current_funding || 0)) + value,
              }
            : prev
        );
        toast.success(t('mapToastDonationThanks'));
        setShowDonate(false);
        setDonateAmount('');
        await fetchMissions();
      } catch (e: any) {
        toast.error(t('mapToastDonationFailed'));
      } finally {
        setDonating(false);
      }
    },
    [fetchMissions, onRequestAuth, selectedMission]
  );

  const handleSubmitReview = useCallback(
    async (rating: number) => {
      if (!selectedMission || !selectedMission.cleaner_id) return;
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        toast.error(t('mapToastRatingRange'));
        return;
      }
      try {
        setIsSubmittingReview(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          onRequestAuth?.();
          return;
        }

        const { error } = await supabase.rpc('submit_review', {
          p_mission_id: selectedMission.id,
          p_cleaner_id: selectedMission.cleaner_id,
          p_rating: rating,
        });
        if (error) {
          toast.error(t('mapToastRatingSubmitFailed'));
          return;
        }

        toast.success(t('mapToastRatingThanks'));
        setReviewedMissions((prev) => {
          const next = new Set(prev);
          next.add(selectedMission.id);
          return next;
        });
        setSelectedRating(0);
      } catch (e: any) {
        toast.error(t('mapToastRatingSubmitFailed'));
      } finally {
        setIsSubmittingReview(false);
      }
    },
    [onRequestAuth, selectedMission]
  );

  const placePendingBid = useCallback(
    async (missionId: string, bidAmount: number) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.id) {
        onRequestAuth?.();
        return;
      }

      // Place pending bid in mission_bids
      const { error } = await supabase.from('mission_bids').insert({
        mission_id: missionId,
        cleaner_id: user.id,
        bid_amount: floorEgp(bidAmount),
        status: 'pending',
      });
      if (error) {
        throw error;
      }
    },
    [onRequestAuth]
  );

  /** Wallet debit + assign cleaner + in_progress when funding reaches goal (RPC). */
  const completeFundingAndAssign = useCallback(async (missionId: string, bidAmountEgp: number) => {
    const { error } = await supabase.rpc('complete_funding_and_assign', {
      p_mission_id: missionId,
      p_bid_amount: floorEgp(bidAmountEgp),
    });
    if (error) throw error;
  }, []);

  const handleCloseHallOfFame = useCallback(() => {
    setHallOfFameMission(null);
    setHallOfFameCleanerName(null);
    setHallOfFameHeroes([]);
  }, []);

  useEffect(() => {
    if (!selectedMission?.description) {
      setShowTranslateAction(false);
      setTranslatedText(null);
      setTranslationError(null);
      return;
    }
    const detected = detectLikelyLanguage(selectedMission.description);
    const shouldTranslate = detected !== appLanguage;
    setShowTranslateAction(shouldTranslate);
    setTranslatedText(null);
    setTranslationError(null);
    if (shouldTranslate) {
      translateMissionDescription(selectedMission.description);
    }
  }, [selectedMission?.id, selectedMission?.description, appLanguage, translateMissionDescription]);

  useEffect(() => {
    const loadHallOfFameMeta = async () => {
      if (!hallOfFameMission?.cleaner_id) {
        setHallOfFameCleanerName(null);
        setHallOfFameHeroes([]);
        return;
      }
      try {
        // Load cleaner name (joined via missions -> profiles)
        const { data: missionRow, error: missionErr } = await supabase
          .from('missions')
          .select('id, cleaner:profiles!cleaner_id(full_name, telegram_username)')
          .eq('id', hallOfFameMission.id)
          .maybeSingle();

        if (missionErr) {
          console.error('Failed to load cleaner profile via join', missionErr.message);
        }

        const cleaner = (missionRow as any)?.cleaner as
          | { full_name?: string | null; telegram_username?: string | null }
          | null
          | undefined;
        const cleanerName =
          cleaner?.full_name || cleaner?.telegram_username || 'an Eco-Hero';
        setHallOfFameCleanerName(cleanerName);

        // Load Eco-Hero donors from mission_donors_view
        const { data: donors, error: donorsError } = await supabase
          .from('mission_donors_view')
          .select('donor_name')
          .eq('mission_id', hallOfFameMission.id);

        if (donorsError) {
          console.error('Failed to load mission donors', donorsError.message);
          setHallOfFameHeroes([]);
        } else {
          const names = (donors || [])
            .map((row: any) => row.donor_name)
            .filter((n: any) => typeof n === 'string' && n.trim().length > 0);
          setHallOfFameHeroes(names);
        }
      } catch (e) {
        console.error('Failed to load Hall of Fame metadata', e);
        setHallOfFameCleanerName(null);
        setHallOfFameHeroes([]);
      }
    };
    if (hallOfFameMission) {
      loadHallOfFameMeta();
    }
  }, [hallOfFameMission]);

  const handleSubmitMissionBid = useCallback(async () => {
    if (!selectedMission) return;
    setIsAccepting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.id) {
        onRequestAuth?.();
        return;
      }
      if (selectedMission.creator_id && selectedMission.creator_id === user.id) {
        toast.error(t('mapToastCannotBidOwnMission'));
        return;
      }
      const amtEgp = parseIntegerEgpFromInput(String(missionBidAmount || ''));
      if (amtEgp <= 0) {
        toast.error(t('enterPositiveEgpAmount'));
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, phone_number, is_verified')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) {
        console.error('Profile check failed:', profileError.message);
      } else {
        const homeOk = checkHomeMissionWorkerVerification(
          selectedMission.category,
          profile?.is_verified
        );
        if (!homeOk.ok) {
          toast.error(t('verificationPromptOnlyVerified'));
          return;
        }
        const wb = Number(profile?.wallet_balance ?? 0);
        const fr = Number(profile?.frozen_balance ?? 0);
        const target = Number(selectedMission.amount_target ?? amtEgp);
        const sec = workerCanSecureMissionDeposit(wb, fr, selectedMission.category, target);
        if (isSecurityDepositFailure(sec)) {
          if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
            toast.error(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
          } else {
            toast.error(
              sec.reason === 'frozen_exceeds_wallet'
                ? t('walletFrozenInvariantError')
                : t('insufficientSecurityDepositFunds')
            );
          }
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          toast.notice(t('mapToastWhatsAppProfileTip'));
        }
      }

      const funded = Number(selectedMission.current_funding ?? 0);
      const goal = Number(selectedMission.amount_target ?? 0);
      const totalAfterBid = funded + amtEgp;
      const closesAtGoal = goal > 0 && totalAfterBid + 0.01 >= goal;

      if (closesAtGoal) {
        await completeFundingAndAssign(selectedMission.id, amtEgp);
      } else {
        await placePendingBid(selectedMission.id, amtEgp);
      }

      handleCloseMissionBriefing();
      void fetchMissions();
    } catch (err: any) {
      toast.error(t('mapToastBidUnexpectedError'));
    } finally {
      setIsAccepting(false);
    }
  }, [
    completeFundingAndAssign,
    fetchMissions,
    handleCloseMissionBriefing,
    missionBidAmount,
    onRequestAuth,
    placePendingBid,
    selectedMission,
    t,
    toast.error,
    toast.notice,
  ]);

  const handleCloseBidModal = useCallback(() => {
    if (!bidSubmitting) {
      setBidJob(null);
      setBidAmount('');
      setBidError(null);
      setBidSuccess(null);
    }
  }, [bidSubmitting]);

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidJob) return;
    setBidError(null);
    setBidSuccess(null);

    const bidEgp = parseIntegerEgpFromInput(bidAmount);
    if (bidEgp <= 0) {
      setBidError(t('enterPositiveEgpAmount'));
      return;
    }

    try {
      setBidSubmitting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        setBidError(t('signInToPlaceBid'));
        return;
      }
      const userId = session.user.id;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, phone_number, is_verified')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) {
        console.error('Profile check failed:', profileError.message);
      } else {
        const homeOk = checkHomeMissionWorkerVerification(bidJob.category, profile?.is_verified);
        if (!homeOk.ok) {
          setBidError(t('verificationPromptOnlyVerified'));
          return;
        }
        const wb = Number(profile?.wallet_balance ?? 0);
        const fr = Number(profile?.frozen_balance ?? 0);
        const target = Number(bidJob.amount_target ?? bidEgp);
        const sec = workerCanSecureMissionDeposit(wb, fr, bidJob.category, target);
        if (isSecurityDepositFailure(sec)) {
          if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
            setBidError(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
          } else {
            setBidError(
              sec.reason === 'frozen_exceeds_wallet'
                ? t('walletFrozenInvariantError')
                : t('insufficientSecurityDepositFunds')
            );
          }
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          setBidError(t('mapToastWhatsAppProfileTip'));
          return;
        }
      }

      const funded = Number(bidJob.current_funding ?? 0);
      const goal = Number(bidJob.amount_target ?? 0);
      const totalAfterBid = funded + bidEgp;
      const closesAtGoal = goal > 0 && totalAfterBid + 0.01 >= goal;

      if (closesAtGoal) {
        await completeFundingAndAssign(bidJob.id, bidEgp);
      } else {
        await placePendingBid(bidJob.id, bidEgp);
      }

      setBidAmount('');
      handleCloseBidModal();
      void fetchMissions();
    } catch (err) {
      console.error('Bid exception:', err);
      setBidError(t('mapToastBidUnexpectedError'));
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const amount = parseIntegerEgpFromInput(orderAmount);
    if (amount <= 0) {
      setOrderError(t('enterPositiveEgpAmount'));
      return;
    }
    if (taskType === 'home') {
      if (amount < HOME_MIN_PRICE || amount > HOME_MAX_PRICE) {
        setOrderError(t('homePriceRangeEgp', { min: HOME_MIN_PRICE, max: HOME_MAX_PRICE }));
        return;
      }
    } else {
      if (amount < CITY_MIN_PRICE || amount > CITY_MAX_PRICE) {
        setOrderError(t('cityPriceRangeEgp', { min: CITY_MIN_PRICE, max: CITY_MAX_PRICE }));
        return;
      }
    }
    if (!selectedLocation) {
      setOrderError('Tap on the map to choose a location.');
      return;
    }
    if ((orderDescription || '').trim().length < 20) {
      setOrderError('Please provide a detailed description so the worker and AI know exactly what to do.');
      return;
    }
    const policy = validateMissionDescription(orderDescription);
    if (!policy.ok) {
      setOrderError('error' in policy ? policy.error : 'Invalid description.');
      return;
    }
    const { filteredText } = filterMissionDescription(orderDescription);
    let descriptionToSave = filteredText.trim() || orderDescription.trim();
    const tags = photoVerification.aiTags;
    if (Array.isArray(tags) && tags.length > 0) {
      const tagStr = tags.filter(Boolean).join(', ');
      if (tagStr) descriptionToSave = descriptionToSave ? `${descriptionToSave} [${tagStr}]` : tagStr;
    }
    if (orderPhotos.length > 0 && photoVerification.verifying) {
      setOrderError(t('waitForAiVerification'));
      return;
    }

    try {
      setOrderSubmitting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        localStorage.setItem(
          PENDING_SUBMIT_KEY,
          JSON.stringify({
            taskType,
            amount,
            location_lat: selectedLocation.lat,
            location_lng: selectedLocation.lng,
            description: descriptionToSave || orderDescription || '',
          })
        );
        setOrderSubmitting(false);
        onRequestAuth?.();
        return;
      }

      // For City (public) missions, confirm Scout Stake before proceeding
      if (taskType === 'city') {
        const confirmed = window.confirm(
          t('cityPinScoutStakeConfirm', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) })
        );
        if (!confirmed) {
          setOrderSubmitting(false);
          return;
        }
      }

      // 1) Compress and upload creator proof photos (if any)
      let creatorPhotoUrls: string[] | undefined;
      if (orderPhotos.length > 0) {
        setUploadingProof(true);
        const uploaded: string[] = [];
        const compressionOptions = {
          maxSizeMB: 0.4,
          maxWidthOrHeight: 1280,
          useWebWorker: true,
          fileType: 'image/jpeg',
        };
        const compressedFiles: File[] = [];
        for (const file of orderPhotos) {
          if (!file.type || !file.type.startsWith('image/')) {
            setOrderError('Only images are allowed');
            setUploadingProof(false);
            return;
          }
          try {
            const compressed = await imageCompression(file, compressionOptions);
            compressedFiles.push(compressed);
          } catch (err) {
            console.warn('Compression failed for', file.name, err);
            compressedFiles.push(file);
          }
        }
        for (const file of compressedFiles) {
          const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('order-photos')
            .upload(safeFileName, file, { upsert: false, contentType: 'image/jpeg' });
          if (uploadError) {
            throw uploadError;
          }
          const { data: { publicUrl } } = supabase.storage
            .from('order-photos')
            .getPublicUrl(safeFileName);
          uploaded.push(publicUrl);
        }
        creatorPhotoUrls = uploaded;
      }

      // 2) For City (public) missions, create mission via RPC (Scout Stake fee in EGP in DB)
      if (taskType === 'city') {
        const { error } = await supabase.rpc('create_public_mission_with_fee', {
          p_title: descriptionToSave || 'City Mission',
          p_description: descriptionToSave || null,
          p_amount_target: floorEgp(amount),
          p_location_lat: Number(selectedLocation.lat),
          p_location_lng: Number(selectedLocation.lng),
          p_photo_urls: creatorPhotoUrls || [],
        });

        if (error) {
          console.error('Create public mission error:', error);
          setOrderError(
            error.message ||
              t('cityMissionWalletHint', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) })
          );
          return;
        }

        // Telegram notification (non-blocking)
        try {
          const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
          const chatId = import.meta.env.VITE_TELEGRAM_ADMIN_CHAT_ID as string | undefined;
          const photoUrls = creatorPhotoUrls || [];
          const firstHttpPhoto = photoUrls.find(
            (u) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'))
          );
          const hasPhoto = Boolean(firstHttpPhoto);
          const caption = `🚨 *NEW MISSION* 🚨\n💰 Reward: ${formatEgp(Number(amount))}\n📝 Task: ${descriptionToSave || t('cityCleaning')}`;

          if (botToken && chatId) {
            if (hasPhoto && firstHttpPhoto) {
              fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: firstHttpPhoto,
                  caption,
                  parse_mode: 'Markdown',
                }),
              }).catch((err) => console.error('Telegram sendPhoto failed:', err));
            } else {
              fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: caption,
                  parse_mode: 'Markdown',
                }),
              }).catch((err) => console.error('Telegram sendMessage failed:', err));
            }
          }
        } catch (err) {
          console.error('Telegram notification error:', err);
        }

        setOrderSuccess(t('cityMissionCreatedScout', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) }));
        setOrderAmount('');
        setOrderDescription('');
        setOrderPhotos([]);
        setDescriptionPolicyError(null);
        setPhotoVerification({ verifying: false, allApproved: true, hasRejected: false });
        setSelectedLocation(null);
        await fetchMissions();
        setTaskType(null);
        return;
      }

      // 3) For Home missions: wallet instant pay (Stripe-only top-ups)
      if (taskType === 'home') {
        const payFromWallet = orderFormWalletPayRef.current;
        orderFormWalletPayRef.current = false;

        if (payFromWallet) {
          const { data: newMission, error: missionErr } = await supabase
            .from('missions')
            .insert({
              creator_id: session.user.id,
              category: 'home',
              amount_target: floorEgp(amount),
              location_lat: selectedLocation.lat,
              location_lng: selectedLocation.lng,
              status: 'pending_payment',
              description: descriptionToSave || null,
              photo_urls: creatorPhotoUrls && creatorPhotoUrls.length > 0 ? creatorPhotoUrls : [],
            })
            .select('id')
            .single();
          if (missionErr) throw missionErr;
          if (!newMission?.id) throw new Error('No mission id returned');
          const { error: rpcErr } = await supabase.rpc('pay_mission_from_wallet', {
            p_mission_id: newMission.id,
          });
          if (rpcErr) throw rpcErr;

          toast.success(t('paymentWalletSuccess'));
          window.dispatchEvent(new CustomEvent('paymentSuccess'));
          setOrderSuccess(t('paymentWalletSuccess'));
          setOrderAmount('');
          setOrderDescription('');
          setOrderPhotos([]);
          setDescriptionPolicyError(null);
          setPhotoVerification({ verifying: false, allApproved: true, hasRejected: false });
          setSelectedLocation(null);
          setCreatorWalletEgp((w) =>
            w == null ? w : Math.max(0, w - floorEgp(amount))
          );
          await fetchMissions();
          return;
        }

        await executePaymentFlow({
          amount,
          taskType,
          location: selectedLocation,
          description: descriptionToSave || orderDescription || '',
          creatorPhotos: creatorPhotoUrls,
        });
      }
    } catch (err) {
      console.error('Job submit exception:', err);
      setOrderError(
        err instanceof Error ? err.message : 'Unexpected error. Please try again.'
      );
    } finally {
      setUploadingProof(false);
      setOrderSubmitting(false);
    }
  };

  const showHomeWalletPay = useMemo(() => {
    if (taskType !== 'home') return false;
    const amt = floorEgp(parseIntegerEgpFromInput(orderAmount));
    if (amt < HOME_MIN_PRICE || amt > HOME_MAX_PRICE) return false;
    if (creatorWalletEgp === null) return false;
    return creatorWalletEgp >= amt;
  }, [taskType, orderAmount, creatorWalletEgp]);

  const { missionTrustBlocked, missionTrustShortfallEgp } = useMemo(() => {
    if (!showBidInput || !selectedMission || workerTrustSnapshot === null) {
      return { missionTrustBlocked: false, missionTrustShortfallEgp: 0 };
    }
    const homeOk = checkHomeMissionWorkerVerification(
      selectedMission.category,
      workerTrustSnapshot.isVerified
    );
    if (!homeOk.ok) return { missionTrustBlocked: true, missionTrustShortfallEgp: 0 };
    const sec = workerCanSecureMissionDeposit(
      workerTrustSnapshot.wallet,
      workerTrustSnapshot.frozen,
      selectedMission.category,
      Number(selectedMission.amount_target ?? 0)
    );
    if (sec.ok) return { missionTrustBlocked: false, missionTrustShortfallEgp: 0 };
    const shortfall = isSecurityDepositFailure(sec) ? (sec.shortfallEgp ?? 0) : 0;
    return {
      missionTrustBlocked: true,
      missionTrustShortfallEgp: shortfall,
    };
  }, [showBidInput, selectedMission, workerTrustSnapshot]);

  /** Target − (current funding + bid input); button enable is NOT tied to this — preview only. */
  const missionBidFundingGapPreview = useMemo(() => {
    if (!selectedMission || !showBidInput) return null;
    const inputEgp = parseIntegerEgpFromInput(String(missionBidAmount || ''));
    if (inputEgp <= 0) return null;
    const target = Number(selectedMission.amount_target ?? 0);
    const current = Number(selectedMission.current_funding ?? 0);
    const remainder = target - (current + inputEgp);
    return { remainder, target, current, inputEgp };
  }, [selectedMission, showBidInput, missionBidAmount]);

  const bidModalFundingGapPreview = useMemo(() => {
    if (!bidJob) return null;
    const inputEgp = parseIntegerEgpFromInput(String(bidAmount || ''));
    if (inputEgp <= 0) return null;
    const target = Number(bidJob.amount_target ?? 0);
    const current = Number(bidJob.current_funding ?? 0);
    const remainder = target - (current + inputEgp);
    return { remainder, target, current, inputEgp };
  }, [bidJob, bidAmount]);

  /** Clusterable mission points (standard GeoJSON FeatureCollection). */
  const missionsGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng))
      .map((j) => {
        const fundingEgp = Math.floor(Math.max(0, Number(j.current_funding ?? j.amount_target ?? 0)));
        const isUserActive =
          !!currentUserId &&
          j.cleaner_id === currentUserId &&
          j.status === 'in_progress';
        /** Open on map for workers (Constitution v6.0 “available” for green/gold). */
        const isAvailable =
          j.status === 'pending' || j.status === 'available' || j.status === 'funding' ? 1 : 0;
        const hasCleaner = j.cleaner_id != null && String(j.cleaner_id).length > 0 ? 1 : 0;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [j.location_lng, j.location_lat],
          },
          properties: {
            mission_id: j.id,
            funding_egp: fundingEgp,
            has_cleaner: hasCleaner,
            mission_status: j.status,
            category: j.category,
            is_available: isAvailable,
            is_selected: selectedMission?.id === j.id ? 1 : 0,
            is_user_active: isUserActive ? 1 : 0,
          },
        };
      });
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, selectedMission?.id, currentUserId]);

  /** Purple pulse anchor for missions where the current user is the active cleaner. */
  const activeWorkerPulseGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter(
        (j) =>
          j.status === 'in_progress' &&
          !!currentUserId &&
          j.cleaner_id === currentUserId &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      )
      .map((j) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [j.location_lng, j.location_lat],
        },
        properties: { mission_id: j.id },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, currentUserId]);

  const activeWorkerMission = useMemo(
    () =>
      (jobs || []).find(
        (j) =>
          j.status === 'in_progress' &&
          !!currentUserId &&
          j.cleaner_id === currentUserId &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      ) ?? null,
    [jobs, currentUserId]
  );

  const activeCreatorMission = useMemo(
    () =>
      (jobs || []).find(
        (j) =>
          !!currentUserId &&
          j.creator_id === currentUserId &&
          (j.status === 'pending' ||
            j.status === 'available' ||
            j.status === 'funding' ||
            j.status === 'in_progress') &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      ) ?? null,
    [jobs, currentUserId]
  );

  const showWorkerDashboard = !taskTypeSelected && !!activeWorkerMission;
  const showCreatorDashboard =
    !taskTypeSelected && !activeWorkerMission && !!activeCreatorMission && showCreatorStatusPanel;
  const showDefaultDashboard = !taskTypeSelected && !activeWorkerMission && !showCreatorDashboard;

  /** Native Mapbox draft location (replaces HTML MissionMarker). */
  const draftPinGeoJSON = useMemo(() => {
    if (!selectedLocation) return { type: 'FeatureCollection' as const, features: [] };
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [selectedLocation.lng, selectedLocation.lat],
          },
          properties: { kind: 'draft' },
        },
      ],
    };
  }, [selectedLocation]);

  /** Funding-weighted heatmap on the clustered `missions` source (inserted below 3D buildings). */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const ensureHeatmapLayer = () => {
      if (!map.isStyleLoaded?.()) return;
      if (!map.getSource('missions')) return;
      if (!map.getLayer('3d-buildings')) return;
      if (map.getLayer('missions-heat')) return;

      map.addLayer(
        {
          id: 'missions-heat',
          type: 'heatmap',
          source: 'missions',
          paint: {
            'heatmap-weight': [
              'case',
              ['has', 'point_count'],
              [
                'interpolate',
                ['linear'],
                ['coalesce', ['to-number', ['get', 'funding_sum']], 0],
                0,
                0,
                250000,
                1,
              ],
              [
                'interpolate',
                ['linear'],
                ['coalesce', ['to-number', ['get', 'funding_egp']], 0],
                0,
                0,
                50000,
                1,
              ],
            ] as any,
            'heatmap-intensity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              9,
              1.1,
              14,
              0.65,
              16,
              0.2,
            ],
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              12,
              11,
              22,
              14,
              38,
            ],
            'heatmap-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10,
              1,
              13,
              0.82,
              14.5,
              0.35,
              16,
              0,
            ],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(0, 0, 0, 0)',
              0.12,
              'rgba(15, 23, 42, 0.22)',
              0.35,
              'rgba(30, 64, 175, 0.55)',
              0.62,
              'rgba(139, 92, 246, 0.82)',
              0.85,
              'rgba(249, 115, 22, 0.92)',
              1,
              'rgba(255, 69, 0, 1)',
            ] as any,
          },
        },
        '3d-buildings'
      );
    };

    ensureHeatmapLayer();
    map.on('styledata', ensureHeatmapLayer);
    map.on('idle', ensureHeatmapLayer);
    return () => {
      map.off('styledata', ensureHeatmapLayer);
      map.off('idle', ensureHeatmapLayer);
    };
  }, [missionsGeoJSON]);

  /** Hover cursor + highlight for unclustered missions. */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const onMove = (e: MapMouseEvent) => {
      if (mapMarkerLayerSuppressed) {
        map.getCanvas().style.cursor = '';
        setHoveredTowerMissionId(null);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point as PointLike, {
        layers: ['missions-unclustered', 'missions-clusters'],
      });
      if (feats.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        const id = feats[0].properties?.mission_id;
        if (id != null) setHoveredTowerMissionId(String(id));
      } else {
        map.getCanvas().style.cursor = '';
        setHoveredTowerMissionId(null);
      }
    };

    map.on('mousemove', onMove);
    return () => {
      map.off('mousemove', onMove);
      map.getCanvas().style.cursor = '';
    };
  }, [mapMarkerLayerSuppressed, missionsGeoJSON]);

  const navigateToActiveMission = useCallback(() => {
    if (!activeWorkerMission) return;
    mapRef.current?.flyTo({
      center: [activeWorkerMission.location_lng, activeWorkerMission.location_lat],
      zoom: 16,
      essential: true,
      duration: 1200,
    });
  }, [activeWorkerMission]);

  const openActiveMissionProof = useCallback(() => {
    if (activeWorkerMission) {
      setProofUploadMission(activeWorkerMission);
    }
  }, [activeWorkerMission]);

  const openLiveMarketMission = useCallback((mission: LiveMarketMission) => {
    setShowLiveMarketFeed(false);
    setSelectedMission(mission as JobOnMap);
    mapRef.current?.flyTo({
      center: [mission.location_lng, mission.location_lat],
      zoom: 16,
      essential: true,
      duration: 1300,
    });
  }, []);

  const handleDollarAction = useCallback(() => {
    setDashboardExpanded(false);
    if (activeWorkerMission) {
      navigateToActiveMission();
      return;
    }
    if (activeCreatorMission) {
      setShowCreatorStatusPanel(true);
      return;
    }
    setShowCreatorStatusPanel(false);
    setShowLiveMarketFeed(true);
  }, [activeWorkerMission, activeCreatorMission, navigateToActiveMission]);

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      {/* Full-screen 3D map — no blocking overlays */}
      <Map
        ref={mapRef}
        {...viewState}
        antialias
        onMove={(evt) => setViewState(evt.viewState)}
        interactiveLayerIds={['missions-clusters', 'missions-unclustered', '3d-buildings']}
        onClick={handleMapClickWithTowers}
        maxBounds={EGYPT_MAX_BOUNDS}
        onLoad={(e: any) => {
          const map = e?.target;
          if (!map) return;

          // Atmosphere: wait for style to fully load before applying fog/terrain.
          const applyAtmosphereAndTerrain = () => {
            try {
              if (!map.getSource('mapbox-dem')) {
                map.addSource('mapbox-dem', {
                  type: 'raster-dem',
                  url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                  tileSize: 512,
                  maxzoom: 14,
                });
              }
              map.setTerrain?.({ source: 'mapbox-dem', exaggeration: 1.5 });

              map.setFog?.({
                // Cyberpunk night haze: deep navy → violet horizon glow.
                range: [0.6, 10],
                color: '#070A12',
                'horizon-blend': 0.22,
                'high-color': '#0B1022',
                'space-color': '#02030A',
                'star-intensity': 0.25,
              });
            } catch {
              // Non-fatal: custom styles / older mapbox runtimes may not support terrain/fog.
            }
          };

          if (map.isStyleLoaded?.()) {
            applyAtmosphereAndTerrain();
          } else {
            // styledata can fire multiple times; we only need to apply once.
            map.once?.('styledata', applyAtmosphereAndTerrain);
          }

          const hour = new Date().getHours();
          const isNight = hour >= 18 || hour < 6;
          try {
            map.setConfigProperty?.('basemap', 'lightPreset', isNight ? 'night' : 'day');
          } catch {
            /* Custom vector style may not expose Standard basemap config */
          }

          const style = map.getStyle?.();
          const waterLikeLayers = (style?.layers || []).filter(
            (layer: any) => typeof layer?.id === 'string' && layer.id.includes('water')
          );
          for (const layer of waterLikeLayers) {
            if (layer.type === 'fill') {
              map.setPaintProperty(layer.id, 'fill-color', '#1a2b3c');
              map.setPaintProperty(layer.id, 'fill-opacity', 0.55);
            }
            if (layer.type === 'line') {
              map.setPaintProperty(layer.id, 'line-color', '#3ecfff');
              map.setPaintProperty(layer.id, 'line-opacity', 0.55);
            }
          }

          // Deep cyberpunk greenery wash (VERY low in hierarchy: above base, below heatmap/buildings/roads/markers).
          // Inserted below everything by anchoring it under `place_label` early in the stack.
          try {
            if (!map.getLayer('greenery-landcover')) {
              map.addLayer(
                {
                  id: 'greenery-landcover',
                  type: 'fill',
                  source: 'composite',
                  'source-layer': 'landcover',
                  filter: [
                    'in',
                    ['get', 'class'],
                    ['literal', ['wood', 'scrub', 'grass', 'park', 'cemetery', 'pitch']],
                  ] as any,
                  paint: {
                    'fill-color': '#27ae60',
                    'fill-opacity': 0.5,
                  },
                } as any,
                'place_label'
              );
            }
            if (!map.getLayer('greenery-landuse')) {
              map.addLayer(
                {
                  id: 'greenery-landuse',
                  type: 'fill',
                  source: 'composite',
                  'source-layer': 'landuse',
                  filter: [
                    'in',
                    ['get', 'class'],
                    ['literal', ['wood', 'scrub', 'grass', 'park', 'cemetery', 'pitch']],
                  ] as any,
                  paint: {
                    'fill-color': '#27ae60',
                    'fill-opacity': 0.5,
                  },
                } as any,
                'place_label'
              );
            }
          } catch {
            /* non-fatal */
          }

          try {
            console.log('Mapbox 3D models loading version 2.0...');
            map.addModel('mop-model', '/models/mop.glb');
            map.addModel('sponge-model', '/models/sponge.glb');
          } catch {
            /* non-fatal */
          }

          if (!map.getLayer('3d-buildings')) {
            map.addLayer(
              {
                id: '3d-buildings',
                source: 'composite',
                'source-layer': 'building',
                filter: ['==', 'extrude', 'true'],
                type: 'fill-extrusion',
                minzoom: 13,
                paint: {
                  // Feature-state driven interactivity:
                  // - alert: mission-adjacent buildings (red)
                  // - hover: cyan highlight
                  'fill-extrusion-color': [
                    'case',
                    ['boolean', ['feature-state', 'alert'], false],
                    '#ff2d2d',
                    ['boolean', ['feature-state', 'hover'], false],
                    '#00ffff',
                    '#222',
                  ] as any,
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'min_height'],
                  'fill-extrusion-opacity': 0.8,
                },
              },
              'place_label'
            );
            try {
              map.setPaintProperty('3d-buildings', 'fill-extrusion-color-transition', { duration: 220, delay: 0 });
              map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity-transition', { duration: 220, delay: 0 });
            } catch {
              // ignore
            }
          }

          // Hover interactivity for buildings (feature-state + popup).
          const clearHover = () => {
            const prev = hoveredBuildingIdRef.current;
            if (prev != null) {
              try {
                map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: prev }, { hover: false });
              } catch {
                // ignore
              }
            }
            hoveredBuildingIdRef.current = null;
            setBuildingPopup(null);
            map.getCanvas().style.cursor = '';
          };

          map.on('mousemove', '3d-buildings', (ev: any) => {
            if (!ev?.features?.length) return clearHover();
            const f = ev.features[0];
            const id = f?.id;
            if (id == null) return clearHover();

            if (hoveredBuildingIdRef.current !== id) {
              const prev = hoveredBuildingIdRef.current;
              if (prev != null) {
                try {
                  map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: prev }, { hover: false });
                } catch {
                  // ignore
                }
              }
              hoveredBuildingIdRef.current = id;
              try {
                map.setFeatureState({ source: 'composite', sourceLayer: 'building', id }, { hover: true });
              } catch {
                // ignore
              }
            }
            map.getCanvas().style.cursor = 'pointer';
            const lngLat = ev.lngLat;
            if (lngLat && Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
              setBuildingPopup({ lng: lngLat.lng, lat: lngLat.lat });
            }
          });

          map.on('mouseleave', '3d-buildings', clearHover);
        }}
        mapStyle={customDarkStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="mapbox-streets" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
          <Layer
            id="neon-roads-glow"
            type="line"
            source="mapbox-streets"
            source-layer="road"
            filter={['in', ['get', 'class'], ['literal', ['motorway', 'primary', 'secondary', 'trunk']]]}
            paint={{
              'line-color': '#00ffff',
              'line-width': 3.5,
              'line-opacity': 0.2,
              'line-blur': 1.5,
            }}
          />
          <Layer
            id="neon-roads"
            type="line"
            source="mapbox-streets"
            source-layer="road"
            filter={['in', ['get', 'class'], ['literal', ['motorway', 'primary', 'secondary', 'trunk']]]}
            paint={{
              'line-color': '#00ffff',
              'line-width': 1.5,
              'line-opacity': 0.6,
            }}
          />
        </Source>

        {buildingPopup && (
          <Popup
            longitude={buildingPopup.lng}
            latitude={buildingPopup.lat}
            anchor="top"
            closeButton={false}
            closeOnClick={false}
            maxWidth="220px"
            offset={12}
          >
            <div className="text-[11px] font-bold text-slate-100">
              Building Info
            </div>
          </Popup>
        )}
        <GeolocateControl
          position="bottom-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
        />
        <NavigationControl position="bottom-right" showCompass={false} />

        {/* Draft tap location — native circle only (no HTML markers). */}
        <Source id="draft-pin" type="geojson" data={draftPinGeoJSON}>
          <Layer
            id="draft-pin"
            type="circle"
            source="draft-pin"
            filter={['==', ['get', 'kind'], 'draft']}
            paint={{
              'circle-radius': 11,
              'circle-color': '#00ffff',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.92,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.95,
            }}
          />
        </Source>

        {/* Active worker (your in-progress mission): purple pulse — pillar height is 0 there */}
        <Source id="mission-worker-pulse" type="geojson" data={activeWorkerPulseGeoJSON}>
          <Layer
            id="mission-worker-pulse-outer"
            type="circle"
            source="mission-worker-pulse"
            minzoom={12}
            paint={{
              'circle-radius': 18,
              'circle-color': 'rgba(168, 85, 247, 0.22)',
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.85,
              'circle-blur': 0.8,
            }}
          />
          <Layer
            id="mission-worker-pulse-inner"
            type="circle"
            source="mission-worker-pulse"
            minzoom={12}
            paint={{
              'circle-radius': 7,
              'circle-color': '#a855f7',
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.92,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#e9d5ff',
            }}
          />
        </Source>

        {/* Missions (clustered) */}
        <Source
          id="missions"
          type="geojson"
          data={missionsGeoJSON}
          cluster
          clusterMaxZoom={14}
          clusterRadius={50}
          clusterProperties={{
            funding_sum: ['+', ['coalesce', ['to-number', ['get', 'funding_egp']], 0]],
          }}
        >
          {/* Clusters layer */}
          <Layer
            id="missions-clusters"
            type="circle"
            source="missions"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': 'rgba(0, 255, 255, 0.18)',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.05 : 0.9,
              'circle-stroke-color': 'rgba(0, 255, 255, 0.85)',
              'circle-stroke-width': 2,
              'circle-blur': 0.2,
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                20,
                10,
                30,
                50,
                40,
              ] as any,
            }}
          />

          {/* Cluster count layer */}
          <Layer
            id="missions-cluster-count"
            type="symbol"
            source="missions"
            filter={['has', 'point_count']}
            layout={{
              'text-field': '{point_count_abbreviated}',
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 13,
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.65)',
              'text-halo-width': 1.6,
            }}
          />

          {/* Unclustered missions — 3D GLB markers (heatmap + clusters stay above heatmap layer in stack) */}
          <Layer
            id="missions-unclustered"
            type="model"
            source="missions"
            filter={['!', ['has', 'point_count']]}
            layout={{
              'model-id': [
                'case',
                [
                  'any',
                  ['==', ['get', 'category'], 'office'],
                  ['==', ['get', 'category'], 'house'],
                  ['==', ['get', 'category'], 'home'],
                ],
                'sponge-model',
                'mop-model',
              ] as any,
            }}
            paint={{
              'model-scale': [44, 44, 44],
              'model-rotation': [0, 0, 38],
              'model-opacity': mapMarkerLayerSuppressed ? 0.06 : 0.94,
              'model-color': [
                'case',
                ['==', ['get', 'is_selected'], 1],
                '#22d3ee',
                [
                  'any',
                  ['==', ['get', 'has_cleaner'], 1],
                  ['==', ['get', 'mission_status'], 'in_progress'],
                  ['==', ['get', 'mission_status'], 'review'],
                  ['==', ['get', 'mission_status'], 'pending_approval'],
                ],
                '#6366f1',
                [
                  'all',
                  ['==', ['get', 'category'], 'public'],
                  ['==', ['get', 'is_available'], 1],
                ],
                '#34d399',
                [
                  'all',
                  [
                    'any',
                    ['==', ['get', 'category'], 'private'],
                    ['==', ['get', 'category'], 'home'],
                  ],
                  ['==', ['get', 'is_available'], 1],
                ],
                '#fb923c',
                '#94a3b8',
              ] as any,
              'model-color-mix-intensity': 0.72,
              'model-cast-shadows': false,
              'model-receive-shadows': false,
            }}
          />

          {/* Unclustered funding labels */}
          <Layer
            id="missions-unclustered-label"
            type="symbol"
            source="missions"
            filter={['!', ['has', 'point_count']]}
            layout={{
              'text-field': [
                'to-string',
                ['round', ['coalesce', ['to-number', ['get', 'funding_egp'], 0], 0]],
              ] as any,
              'text-size': 12,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-anchor': 'bottom',
              'text-offset': [0, -2.05],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.85)',
              'text-halo-width': 2,
              'text-halo-blur': 0.25,
              'text-opacity': mapMarkerLayerSuppressed ? 0.06 : 1,
            }}
          />
        </Source>
      </Map>

      {/* Minimalist overlays — wrapper is pointer-events-none so map stays interactive */}
      <div className="absolute inset-0 pointer-events-none z-[80] flex flex-col">
        {/* Header: CleanMontenegro (non-interactive) + profile avatar (clickable) */}
        <header className="flex items-center justify-between px-5 pt-5">
          <h1 className="text-sm font-medium tracking-wide text-white pointer-events-none">
            CleanMontenegro
          </h1>
          <button
            type="button"
            onClick={onAvatarClick}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:border-emerald-400/50 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] transition-all"
          >
            👤
          </button>
        </header>

        <div className="mt-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] flex justify-center">
          <AnimatePresence mode="wait">
            {showWorkerDashboard && activeWorkerMission ? (
              <ActiveMissionWidget
                key="worker-dashboard"
                mission={activeWorkerMission}
                onNavigate={navigateToActiveMission}
                onUploadProof={openActiveMissionProof}
              />
            ) : showCreatorDashboard && activeCreatorMission ? (
              <CreatorMissionWidget
                key="creator-dashboard"
                mission={activeCreatorMission}
                onClose={() => setShowCreatorStatusPanel(false)}
              />
            ) : showDefaultDashboard ? (
              <motion.div
                key="default-dashboard"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 18, opacity: 0 }}
                className="pointer-events-auto relative h-44 w-44"
              >
                <AnimatePresence>
                  {dashboardExpanded && (
                    <>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: -72, y: -34 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                        type="button"
                        onClick={() => selectTaskType('city')}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-emerald-400/70 bg-emerald-500/20 text-2xl shadow-[0_0_20px_rgba(34,197,94,0.5)]"
                        aria-label="City mission"
                      >
                        🧹
                      </motion.button>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: 72, y: -34 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.03 }}
                        type="button"
                        onClick={() => selectTaskType('home')}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-amber-400/80 bg-amber-500/20 text-2xl shadow-[0_0_20px_rgba(251,191,36,0.5)]"
                        aria-label="Home mission"
                      >
                        🧽
                      </motion.button>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: 0, y: -94 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.06 }}
                        type="button"
                        onClick={handleDollarAction}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-cyan-400/80 bg-cyan-500/20 text-2xl font-black text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.45)]"
                        aria-label="Just Now Earn"
                      >
                        $
                      </motion.button>
                    </>
                  )}
                </AnimatePresence>
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => setDashboardExpanded((s) => !s)}
                  className="absolute left-1/2 top-1/2 -ml-9 -mt-9 h-[4.5rem] w-[4.5rem] rounded-full border-2 border-cyan-400/70 bg-black/65 backdrop-blur-lg text-cyan-200 shadow-[0_0_34px_rgba(34,211,238,0.35)] flex items-center justify-center"
                  aria-label="Open action menu"
                >
                  <Recycle className="h-7 w-7" />
                </motion.button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Adaptive form — slides up from bottom only after City or Home selected */}
      {taskTypeSelected && (
        <div
          className="absolute inset-0 z-[9999] flex items-end justify-center p-4 pt-[env(safe-area-inset-top)] pointer-events-none isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-md pointer-events-none"
            aria-hidden
          />
          <div className={`pointer-events-auto relative z-[1] w-full max-w-xl flex flex-col h-full max-h-[85vh] animate-slide-up p-5 shadow-2xl ${PROFILE_GLASS_PANEL}`}>
            <form ref={orderFormRef} onSubmit={handleSubmit} className="flex flex-col h-full">
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-2 pb-8 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={closeFormOverlay}
                  disabled={orderSubmitting}
                  className="text-slate-500 hover:text-white text-lg font-bold disabled:opacity-40 mr-2"
                >
                  ✕
                </button>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  {taskType === 'city' ? t('cleanCityArea') : t('cleanYourHomeOffice')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {taskType === 'city'
                      ? isRu
                        ? 'Цель сбора (Предполагаемая стоимость)'
                        : 'Collection Target (Goal)'
                      : t('amountEgp')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="\d*"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(sanitizeIntegerEgpDigits(e.target.value))}
                    placeholder={
                      taskType === 'city'
                        ? isRu
                          ? 'Цель сбора (Предполагаемая стоимость)'
                          : 'Collection Target (Goal)'
                        : t('anyAmount')
                    }
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 tabular-nums`}
                  />
                  {taskType === 'city' && (
                    <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                      {t('cityPinScoutStakeFormHint', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) })}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('location')}
                  </label>
                  <div className={`relative flex items-center gap-2 ${PROFILE_GLASS_PANEL} px-3 py-2.5`}>
                    <input
                      type="text"
                      value={
                        selectedLocation
                          ? `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`
                          : ''
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        // allow manual editing; if looks like "lat, lng" try to parse
                        if (value.includes(',')) {
                          const [latStr, lngStr] = value.split(',').map((s) => s.trim());
                          const latNum = parseFloat(latStr);
                          const lngNum = parseFloat(lngStr);
                          if (
                            Number.isFinite(latNum) &&
                            Number.isFinite(lngNum) &&
                            latNum >= -90 &&
                            latNum <= 90 &&
                            lngNum >= -180 &&
                            lngNum <= 180
                          ) {
                            if (!isInsideEgyptBounds(lngNum, latNum)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latNum, lng: lngNum });
                            mapRef.current?.flyTo({
                              center: [lngNum, latNum],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                            return;
                          }
                        }
                      }}
                      onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                        const text = e.clipboardData.getData('text');
                        if (text && text.includes(',')) {
                          e.preventDefault();
                          const [latStr, lngStr] = text.split(',').map((s) => s.trim());
                          const latNum = parseFloat(latStr);
                          const lngNum = parseFloat(lngStr);
                          if (
                            Number.isFinite(latNum) &&
                            Number.isFinite(lngNum) &&
                            latNum >= -90 &&
                            latNum <= 90 &&
                            lngNum >= -180 &&
                            lngNum <= 180
                          ) {
                            if (!isInsideEgyptBounds(lngNum, latNum)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latNum, lng: lngNum });
                            mapRef.current?.flyTo({
                              center: [lngNum, latNum],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                          }
                        }
                      }}
                      placeholder="Tap map or paste '27.320282, 33.708599'"
                      className="flex-1 bg-transparent border-0 outline-none text-xs text-slate-300 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!navigator.geolocation) return;
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const { latitude, longitude } = pos.coords;
                            if (!isInsideEgyptBounds(longitude, latitude)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latitude, lng: longitude });
                            mapRef.current?.flyTo({
                              center: [longitude, latitude],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                          },
                          () => {
                            // silently ignore errors; user can still tap map manually
                          }
                        );
                      }}
                      className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-orange-500/60 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_8px_rgba(249,115,22,0.4)] text-[11px] transition-all"
                      aria-label="Use current location"
                    >
                      ◎
                    </button>
                  </div>
                  {!selectedLocation && (
                    <p className="mt-1 text-[10px] text-amber-300 uppercase tracking-[0.18em]">
                      {t('tapMapToSetLocation')}
                    </p>
                  )}
                </div>
              </div>

              <CreateMission
                taskType={taskType}
                orderDescription={orderDescription}
                setOrderDescription={setOrderDescription}
                orderPhotos={orderPhotos}
                setOrderPhotos={setOrderPhotos}
                onDescriptionPolicyError={setDescriptionPolicyError}
                onPhotoVerificationChange={setPhotoVerification}
                onTextWarning={(w) => {
                  setTextWarning(w ?? null);
                  if (w) toast.notice(w);
                }}
                hasTextWarning={!!textWarning}
              />

              {(orderError || descriptionPolicyError) && (
                <p className="text-xs text-red-400 font-medium">
                  {orderError || descriptionPolicyError}
                </p>
              )}
              {orderSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
              )}

              </div>

              <div className="mt-auto pb-[env(safe-area-inset-bottom)]">
              {showHomeWalletPay && (
                <div className="w-full mt-2 rounded-full animated-border-home">
                  <button
                    type="button"
                    disabled={
                      orderSubmitting ||
                      uploadingProof ||
                      !selectedLocation ||
                      !!descriptionPolicyError ||
                      (orderPhotos.length > 0 && photoVerification.verifying)
                    }
                    onClick={() => {
                      orderFormWalletPayRef.current = true;
                      orderFormRef.current?.requestSubmit();
                    }}
                    className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] transition-all text-black bg-gradient-to-r from-cyan-300 to-emerald-400 border border-cyan-400/60 hover:brightness-110 shadow-[0_0_22px_rgba(34,211,238,0.35)] disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                  >
                    {t('payInstantWithWallet')}
                  </button>
                </div>
              )}

              <div
                className={`w-full mt-1 rounded-full ${taskType === 'city' ? 'animated-border-city' : 'animated-border-home'} ${
                  orderSubmitting ||
                  uploadingProof ||
                  !selectedLocation ||
                  !!descriptionPolicyError ||
                  (orderPhotos.length > 0 &&
                    photoVerification.verifying)
                    ? 'opacity-60'
                    : ''
                }`}
              >
                <button
                  type="submit"
                  disabled={
                    orderSubmitting ||
                    uploadingProof ||
                    !selectedLocation ||
                    !!descriptionPolicyError ||
                    (orderPhotos.length > 0 &&
                      photoVerification.verifying)
                  }
                  className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] transition-all text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] disabled:cursor-not-allowed active:scale-95"
                >
                  {uploadingProof || orderSubmitting
                    ? t('processing')
                    : t('submitTaskAndPay')}
                </button>
              </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bidding modal — dark glassmorphism */}
      {bidJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] isolate bg-black/80 backdrop-blur-md"
          onClick={handleCloseBidModal}
          aria-hidden="false"
        >
          <div
            className="w-full max-w-md animated-border animated-border-rect rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="animated-border-inner w-full rounded-3xl bg-[#020617]/95 backdrop-blur-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <button
                  type="button"
                  onClick={handleCloseBidModal}
                  disabled={bidSubmitting}
                  className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 transition-colors mr-2"
                >
                  ✕
                </button>
                <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">
                  Place bid
                </h3>
              </div>

            <div className="space-y-4 mb-6">
              <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                  Target amount
                </p>
                <p className="text-xl font-black text-amber-400">
                  {formatEgp(Number(bidJob.amount_target))}
                </p>
              </div>
              {bidJob.description && (
                <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                    Description
                  </p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">
                    {bidJob.description}
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handlePlaceBid} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  {t('bidAmountLabelEgp')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="\d*"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(sanitizeIntegerEgpDigits(e.target.value))}
                  placeholder="Enter your bid amount"
                  className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 tabular-nums`}
                />
                {bidModalFundingGapPreview && (
                  <p className="mt-2 text-[11px] text-cyan-200/95 font-semibold tabular-nums">
                    {t('goalMinusFundedMinusBid')}: {formatEgp(bidModalFundingGapPreview.remainder)}
                    {bidModalFundingGapPreview.remainder <= 0
                      ? ` — ${t('goalMetOrExceededShort')}`
                      : ''}
                  </p>
                )}
              </div>

              {bidError && (
                <p className="text-xs text-red-400 font-medium">{bidError}</p>
              )}
              {bidSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{bidSuccess}</p>
              )}

              <div className={`rounded-full animated-border-home ${bidSubmitting ? 'opacity-60' : ''}`}>
                <button
                  type="submit"
                  disabled={
                    bidSubmitting ||
                    parseIntegerEgpFromInput(bidAmount) <= 0
                  }
                  className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
                >
                  {bidSubmitting
                    ? 'Placing bid...'
                    : (() => {
                        const egp = parseIntegerEgpFromInput(bidAmount);
                        return egp > 0
                          ? `Place bid ${formatEgp(egp)}`
                          : 'Place bid';
                      })()}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Mission Briefing — bottom sheet when active pyramid marker clicked */}
      {selectedMission && (
        <div
          className="absolute inset-0 z-[9999] flex items-end justify-center pt-[env(safe-area-inset-top)] isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={handleCloseMissionBriefing}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-xl max-h-[100dvh] overflow-y-auto rounded-t-3xl bg-cyan-950/30 backdrop-blur-md border-t border-x border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] px-6 pb-16 pt-10 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4 mt-2">
              <button
                type="button"
                onClick={handleCloseMissionBriefing}
                className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('missionBriefing')}
                </h2>
                {selectedMission.status === 'in_progress' && selectedMission.cleaner_id === currentUserId && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mt-1">{t('yourActiveMission')}</p>
                )}
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedMission.category === 'home' ? '🏠' : '🌆'}</span>
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${selectedMission.category === 'public' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {selectedMission.category === 'public' ? t('cityCleaning') : t('homeCleaning')}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    {selectedMission.location_lat.toFixed(6)}, {selectedMission.location_lng.toFixed(6)}
                  </p>
                </div>
              </div>

              <div className="py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                  {selectedMission.category === 'public' ? t('currentFunding') : t('reward')}
                </p>
                <p
                  className={`text-4xl sm:text-5xl font-black tracking-tight ${
                    selectedMission.category === 'public' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                  style={{
                    textShadow:
                      selectedMission.category === 'public'
                        ? '0 0 24px rgba(52, 211, 153, 0.6)'
                        : '0 0 24px rgba(251, 191, 36, 0.6)',
                  }}
                >
                  {selectedMission.category === 'public'
                    ? formatEgp(Number(selectedMission.current_funding || 0))
                    : formatEgp(Number(selectedMission.amount_target))}
                </p>
                {selectedMission.category === 'public' && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t('targetGoal')}: {formatEgp(Number(selectedMission.amount_target))}
                  </p>
                )}
                {(activeBidCounts[selectedMission.id] || 0) > 0 && (
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">
                    {t('lockedDeposit')}
                  </p>
                )}
              </div>

              {selectedMission.photo_urls && selectedMission.photo_urls.length > 0 && (
                <div className="mb-3">
                  <div className="flex overflow-x-auto snap-x snap-mandatory gap-2 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {selectedMission.photo_urls.map((url, index) => (
                      <div key={`${url}-${index}`} className="min-w-full snap-center shrink-0">
                        <ModeratedMissionPhoto
                          url={url}
                          alt={`Before (work scope) ${index + 1}`}
                          imgClassName="w-full h-48 object-cover rounded-xl shadow-md bg-slate-800"
                          showSafeBadge
                        />
                      </div>
                    ))}
                  </div>
                  {selectedMission.photo_urls.length > 1 && (
                    <p className="text-[10px] text-slate-400 text-center mt-2 uppercase tracking-wider">
                      {t('swipeForMorePhotos')} • {selectedMission.photo_urls.length} {t('photos')}
                    </p>
                  )}
                </div>
              )}

              {selectedMission.description && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400">{selectedMission.description}</p>
                  {(showTranslateAction || isTranslationLoading || !!translatedText || !!translationError) && (
                    <div className="space-y-2">
                      {showTranslateAction && (
                        <button
                          type="button"
                          onClick={() => translateMissionDescription(selectedMission.description!)}
                          disabled={isTranslationLoading}
                          className="inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.16em] border border-cyan-400/40 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all disabled:opacity-60 disabled:cursor-wait"
                        >
                          {isTranslationLoading ? t('translating') : t('translate')}
                        </button>
                      )}
                      {isTranslationLoading && (
                        <div className="h-10 w-full rounded-xl bg-cyan-500/10 border border-cyan-500/20 animate-pulse" />
                      )}
                      {translatedText && !isTranslationLoading && (
                        <p className="text-sm text-cyan-100 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-2">
                          {translatedText}
                        </p>
                      )}
                      {translationError && !isTranslationLoading && (
                        <p className="text-sm text-red-300 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2">
                          {translationError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

             {/* Financial Trail */}
             <div className={`border border-cyan-500/20 p-4 ${PROFILE_GLASS_PANEL}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Financial Trail
                  </p>
                  {missionTxLoading && (
                    <div className="h-4 w-4 border-2 border-cyan-500/60 border-t-cyan-300 rounded-full animate-spin" />
                  )}
                </div>
                {missionTxError && (
                  <p className="mt-2 text-xs text-red-400">{missionTxError}</p>
                )}
                <div className="mt-3 max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                  {missionTransactions.map((tx: any) => {
                    const gw = (tx.gateway || '').toLowerCase();
                    const badge =
                      gw.includes('stripe') ? 'Stripe' : tx.gateway || null;
                    
                    // @ts-ignore
                    const isCarding = tx.user_id ? potentialCardingUserIds.has(tx.user_id) : false;

                    // Достаем данные профиля из нашего нового запроса
                    const profile = tx.profile;
                    const displayName = profile?.full_name || 'Eco Hero';
                    const avatarUrl = profile?.avatar_url;

                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center justify-between gap-3 border border-cyan-500/10 px-3 py-2 text-[11px] ${PROFILE_GLASS_PANEL} !rounded-xl transition-all hover:bg-white/5`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* АВАТАРКА ГЕРОЯ */}
                          <div className="h-8 w-8 shrink-0 rounded-full border border-white/20 bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 overflow-hidden flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-300">{(displayName || 'E')[0]}</span>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {displayName}
                            </p>
                            <p className="text-[9px] text-slate-500 uppercase tracking-tight">
                              {tx.type}
                              {badge ? <span className="ml-1 opacity-70">• {badge}</span> : null}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p
                            className={[
                              'font-mono font-black tabular-nums text-xs',
                              isCarding
                                ? 'text-red-300 drop-shadow-[0_0_10px_rgba(239,68,68,0.55)]'
                                : 'text-emerald-300',
                            ].join(' ')}
                          >
                            +{formatEgp(Number(tx.amount))}
                          </p>
                          <p className="text-[8px] text-slate-600">
                             {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {!missionTxLoading && missionTransactions.length === 0 && (
                    <p className="text-xs text-slate-500 italic py-4 text-center">No transactions yet. Be the first hero!</p>
                  )}
                </div>
              </div>
              {/* GPS Integrity */}
              <div className={`border border-cyan-500/20 p-4 ${PROFILE_GLASS_PANEL}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  GPS Integrity
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  {typeof selectedMission.completion_distance_meters === 'number'
                    ? `Verification Distance at Completion: ${
                        selectedMission.completion_distance_meters < 1000
                          ? `${Math.round(selectedMission.completion_distance_meters)} m`
                          : `${(selectedMission.completion_distance_meters / 1000).toFixed(2)} km`
                      }`
                    : gpsDistanceMeters != null
                      ? `Current distance to mission: ${
                          gpsDistanceMeters < 1000
                            ? `${Math.round(gpsDistanceMeters)} m`
                            : `${(gpsDistanceMeters / 1000).toFixed(2)} km`
                        }`
                      : gpsDistanceError
                        ? gpsDistanceError
                        : 'Calculating distance...'}
                </p>
                {typeof selectedMission.completion_distance_meters === 'number' &&
                  selectedMission.completion_distance_meters > 500 && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 bg-red-500/10 border border-red-400/40 text-[10px] font-black uppercase tracking-[0.2em] text-red-300 shadow-[0_0_14px_rgba(239,68,68,0.35)]">
                      ⚠ Verification distance &gt; 500m
                    </div>
                  )}
              </div>
            </div>

            {selectedMission.status === 'completed' ? (
              <div className="space-y-5">
                <div className="space-y-3">
                  <p className="text-sm text-amber-200 font-semibold">
                    {t('missionAccomplished')}
                  </p>
                  <div className="w-full rounded-full animated-border-completed">
                    <button
                      type="button"
                      onClick={() => setHallOfFameMission(selectedMission)}
                      className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                    >
                      {t('viewPhotos')}
                    </button>
                  </div>
                </div>

                {selectedMission.creator_id === currentUserId &&
                  !reviewedMissions.has(selectedMission.id) && (
                    <div className={`space-y-3 border border-amber-500/40 p-4 ${PROFILE_GLASS_PANEL}`}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">
                        {t('rateTheCleaner')}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        {t('ratingHelpsReward')}
                      </p>
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const active = star <= selectedRating;
                          return (
                            <button
                              key={star}
                              type="button"
                              disabled={isSubmittingReview}
                              onClick={() => setSelectedRating(star)}
                              className={`text-2xl transition-transform ${
                                active ? 'text-amber-300' : 'text-slate-600'
                              } ${active ? 'scale-110' : 'scale-100'} hover:scale-110`}
                            >
                              ⭐
                            </button>
                          );
                        })}
                      </div>
                      {selectedRating > 0 && (
                        <button
                          type="button"
                          disabled={isSubmittingReview}
                          onClick={() => handleSubmitReview(selectedRating)}
                          className="mt-2 w-full rounded-full bg-amber-500 text-black text-[11px] font-black uppercase tracking-[0.18em] py-2.5 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-wait transition-all"
                        >
                          {isSubmittingReview ? t('submitting') : t('submitRating')}
                        </button>
                      )}
                    </div>
                  )}
              </div>
            ) : selectedMission.status === 'in_progress' && selectedMission.cleaner_id !== currentUserId ? (
              <div className="space-y-3">
                <p className="text-sm text-sky-200 font-semibold">
                  {t('workInProgress')}
                </p>
              </div>
            ) : selectedMission.status === 'in_progress' && selectedMission.cleaner_id === currentUserId ? (
              <div className="w-full rounded-full animated-border-city">
                <button
                  type="button"
                  onClick={() => {
                    toast.success(t('mapToastMissionAcceptedProfile'));
                    handleCloseMissionBriefing();
                    onAvatarClick?.();
                  }}
                  className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                >
                  {t('startWorkUploadProof')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {showBidInput && (
                  <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                      {t('bidAmountLabelEgp')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="\d*"
                      value={missionBidAmount}
                      onChange={(e) => setMissionBidAmount(sanitizeIntegerEgpDigits(e.target.value))}
                      className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none tabular-nums ${
                        selectedMission.category === 'public'
                          ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                          : 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                      }`}
                      placeholder={`Default: ${formatEgp(Number(selectedMission.amount_target))}`}
                    />
                    {missionBidFundingGapPreview && (
                      <p className="mt-2 text-[11px] text-cyan-200/95 font-semibold tabular-nums">
                        {t('goalMinusFundedMinusBid')}: {formatEgp(missionBidFundingGapPreview.remainder)}
                        {missionBidFundingGapPreview.remainder <= 0
                          ? ` — ${t('goalMetOrExceededShort')}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}

                <div
                  className={`w-full rounded-full ${
                    selectedMission.category === 'public' ? 'animated-border-city' : 'animated-border-home'
                  } ${isAccepting ? 'opacity-60' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!showBidInput) {
                        setShowBidInput(true);
                        if (!missionBidAmount)
                          setMissionBidAmount(
                            String(Math.floor(Number(selectedMission.amount_target ?? 0)))
                          );
                        return;
                      }
                      handleSubmitMissionBid();
                    }}
                    disabled={
                      isAccepting ||
                      (showBidInput &&
                        parseIntegerEgpFromInput(String(missionBidAmount || '0')) <= 0)
                    }
                    className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAccepting
                      ? t('placing')
                      : (() => {
                          const egp = parseIntegerEgpFromInput(String(missionBidAmount || '0'));
                          return showBidInput && egp > 0
                            ? `${t('placeBid')} ${formatEgp(egp)}`
                            : showBidInput
                              ? t('placeBid')
                              : t('makeABid');
                        })()}
                  </button>
                  {missionTrustBlocked && showBidInput && (
                    <div className="mt-2 flex flex-col items-center gap-2">
                      <p className="text-center text-[10px] text-amber-300">{t('insufficientTrustDeposit')}</p>
                      {missionTrustShortfallEgp > 0 && (
                        <button
                          type="button"
                          onClick={() => onAvatarClick?.()}
                          className="w-full rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] border border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all"
                        >
                          {t('addFunds') || 'Add Funds'} {formatEgp(missionTrustShortfallEgp)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTrustDepositInfoOpen(true)}
                        className="text-[10px] font-bold uppercase tracking-wider text-amber-200/95 underline underline-offset-2 hover:text-amber-50"
                      >
                        {t('trustDepositLearnMore')}
                      </button>
                    </div>
                  )}
                </div>

                {selectedMission.category === 'public' &&
                  (selectedMission.status === 'pending' ||
                    selectedMission.status === 'available' ||
                    selectedMission.status === 'funding') && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDonate((prev) => !prev);
                        }}
                        className="w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all"
                      >
                        {t('donateToCause')}
                      </button>
                      {showDonate && (
                        <div className={`space-y-2 border border-emerald-500/30 px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                          <p className="text-[11px] text-slate-300">
                            {t('boostMissionFunding')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {[50, 100, 500].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                disabled={donating}
                                onClick={() => handleDonate(preset)}
                                className="px-3 py-1.5 rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-60 disabled:cursor-wait"
                              >
                                {formatEgp(preset)}
                              </button>
                            ))}
                            <div className="flex-1 min-w-[120px] space-y-2">
                              <div className="flex items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-950/50 px-2 py-1 focus-within:border-emerald-400/60">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90 shrink-0">
                                  EGP
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  pattern="\d*"
                                  value={donateAmount}
                                  onChange={(e) => setDonateAmount(sanitizeIntegerEgpDigits(e.target.value))}
                                  className={`min-w-0 flex-1 bg-transparent border-0 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-0 tabular-nums`}
                                  placeholder={t('customAmountEgpPlaceholder')}
                                />
                              </div>
                              <button
                                type="button"
                                disabled={donating || parseIntegerEgpFromInput(donateAmount) <= 0}
                                onClick={() => handleDonate(parseIntegerEgpFromInput(donateAmount))}
                                className="w-full px-3 py-1.5 rounded-full bg-emerald-500 text-[11px] font-black uppercase tracking-[0.16em] text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed mt-1.5"
                              >
                                {donating
                                  ? t('sendingDonation')
                                  : parseIntegerEgpFromInput(donateAmount) > 0
                                    ? `${t('addFunds') || 'Add'} ${formatEgp(parseIntegerEgpFromInput(donateAmount))}`
                                    : t('donate')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Crowdfunding confirm modal (public missions) */}
      {showCrowdfundConfirm && selectedMission && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] isolate">
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={closeCrowdfundConfirm}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-lg rounded-3xl bg-[#020617]/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <button
                type="button"
                onClick={closeCrowdfundConfirm}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('confirmation')}
                </p>
                <h3 className="mt-2 text-lg font-extrabold text-white">
                  {t('thisIsCrowdfundingMission')}
                </h3>
              </div>
            </div>

            {(() => {
              const bid = Number(crowdfundBidAmount ?? 0);
              const funded = Math.max(0, Number(selectedMission.current_funding ?? 0));
              const targetEgp = Math.max(0, Number(selectedMission.amount_target ?? 0));
              const gapToCloseEgp = Math.max(0, Math.floor(targetEgp - funded));
              return (
                <>
                  <p className="text-sm text-slate-300">
                    {t('yourBidIs')}{' '}
                    <span className="font-black text-amber-300">{formatEgp(bid)}</span>. {t('currentFundingIs')}{' '}
                    <span className="font-black text-emerald-300">{formatEgp(funded)}</span>.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t('gapToGoalHint', {
                      goal: formatEgp(targetEgp),
                      gap: formatEgp(gapToCloseEgp),
                    })}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('chooseHowToProceed')}
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <div className={`space-y-2 border border-amber-500/20 rounded-xl px-3 py-3 ${PROFILE_GLASS_PANEL}`}>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        {t('bidAmountLabelEgp')} ({t('coFundCustomHint') || 'any amount'})
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="\d*"
                        value={crowdfundCoFundInput}
                        onChange={(e) => setCrowdfundCoFundInput(sanitizeIntegerEgpDigits(e.target.value))}
                        placeholder={gapToCloseEgp > 0 ? String(gapToCloseEgp) : '10'}
                        className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white tabular-nums`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isAccepting || parseIntegerEgpFromInput(crowdfundCoFundInput) <= 0}
                      onClick={async () => {
                        if (!selectedMission) return;
                        const coFundEgp = parseIntegerEgpFromInput(crowdfundCoFundInput);
                        if (coFundEgp <= 0) {
                          toast.error(t('enterPositiveEgpAmount'));
                          return;
                        }
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) {
                            onRequestAuth?.();
                            return;
                          }
                          const { data: p } = await supabase
                            .from('profiles')
                            .select('wallet_balance, frozen_balance')
                            .eq('id', session.user.id)
                            .maybeSingle();
                          const wb = profileWalletBalanceEgp(p?.wallet_balance);
                          const fr = profileWalletBalanceEgp(p?.frozen_balance);
                          const target = Number(selectedMission.amount_target ?? coFundEgp);
                          const sec = workerCanSecureMissionDeposit(
                            wb,
                            fr,
                            selectedMission.category,
                            target
                          );
                          if (isSecurityDepositFailure(sec)) {
                            toast.error(
                              sec.reason === 'frozen_exceeds_wallet'
                                ? t('walletFrozenInvariantError')
                                : t('insufficientSecurityDepositFunds')
                            );
                            return;
                          }
                          setIsAccepting(true);
                          await handleCoFundMission(selectedMission.id, floorEgp(coFundEgp));
                          toast.success(t('mapToastCoFundSuccess'));
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          toast.error(t('mapToastCoFundFailed'));
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-amber-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${PROFILE_GLASS_PANEL}`}
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">
                        {t('addFunds') || 'Add Funds'} / {t('closeDeal') || 'Close deal'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('differenceDeductedFromWallet')}
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={isAccepting || !(Number(crowdfundBidAmount ?? 0) > 0)}
                      onClick={async () => {
                        if (!selectedMission) return;
                        const amt = floorEgp(crowdfundBidAmount ?? 0);
                        if (!(amt > 0)) return;
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) {
                            onRequestAuth?.();
                            return;
                          }
                          const { data: p } = await supabase
                            .from('profiles')
                            .select('wallet_balance, frozen_balance')
                            .eq('id', session.user.id)
                            .maybeSingle();
                          const wb = profileWalletBalanceEgp(p?.wallet_balance);
                          const fr = profileWalletBalanceEgp(p?.frozen_balance);
                          const target = Number(selectedMission.amount_target ?? crowdfundBidAmount);
                          const sec = workerCanSecureMissionDeposit(
                            wb,
                            fr,
                            selectedMission.category,
                            target
                          );
                          if (isSecurityDepositFailure(sec)) {
                            toast.error(
                              sec.reason === 'frozen_exceeds_wallet'
                                ? t('walletFrozenInvariantError')
                                : t('insufficientSecurityDepositFunds')
                            );
                            return;
                          }
                          setIsAccepting(true);
                          await placePendingBid(selectedMission.id, amt);
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          toast.error(t('mapToastPendingBidFailed'));
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-sky-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${PROFILE_GLASS_PANEL}`}
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-300">
                        {t('waitUntilFillsUpDonation')}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('bidRemainsPending')}
                      </p>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Hall of Fame modal for completed missions */}
      {hallOfFameMission && (
        <div
          className="absolute inset-0 z-[9999] flex items-center justify-center pt-[env(safe-area-inset-top)] isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={handleCloseHallOfFame}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-2xl mx-4 rounded-3xl bg-[#020617]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <button
                type="button"
                onClick={handleCloseHallOfFame}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-300/80">
                  {t('hallOfFame')}
                </p>
                <h2 className="mt-2 text-lg sm:text-2xl font-extrabold tracking-tight text-white">
                  This place was cleaned by{' '}
                  <span className="text-amber-300">
                    {hallOfFameCleanerName || 'an Eco-Hero'}
                  </span>
                  !
                </h2>
              </div>
            </div>

            {/* Before / After slider */}
            <HallOfFameSlider mission={hallOfFameMission} />

            {/* Eco-Heroes list */}
            <div className="mt-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                Eco-Heroes
              </p>
              {hallOfFameHeroes.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Donations data for this mission will appear here once connected. For now,
                  consider everyone who supported this cleanup an Eco-Hero.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {hallOfFameHeroes.map((name) => (
                    <li
                      key={name}
                      className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/40 text-[11px] text-emerald-300 font-semibold"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <TrustDepositInfoModal open={trustDepositInfoOpen} onClose={() => setTrustDepositInfoOpen(false)} />

      {mapToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[10000] pointer-events-none max-w-[min(92vw,24rem)]">
          <div
            className={`rounded-xl border px-4 py-2 text-xs font-bold shadow-xl backdrop-blur-sm ${
              mapToast.variant === 'success'
                ? 'border-emerald-400/35 bg-emerald-600/90 text-white'
                : mapToast.variant === 'notice'
                  ? 'border-amber-400/40 bg-amber-950/90 text-amber-100'
                  : 'border-red-300/30 bg-red-500/85 text-white'
            }`}
          >
            {mapToast.message}
          </div>
        </div>
      )}

      <LiveMarketFeed
        open={showLiveMarketFeed}
        onClose={() => setShowLiveMarketFeed(false)}
        onSelectMission={openLiveMarketMission}
      />
      <ProofUploadModal
        open={!!proofUploadMission}
        mission={proofUploadMission}
        onClose={() => setProofUploadMission(null)}
        onSuccess={async () => {
          await fetchMissions();
          setProofUploadMission(null);
        }}
        toast={toast}
      />

    </div>
  );
};

export default MapPicker;