import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { formatEgp } from '../src/lib/formatMoney';

export interface LiveMarketMission {
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
  created_at?: string | null;
}

interface LiveMarketFeedProps {
  open: boolean;
  onClose: () => void;
  onSelectMission: (mission: LiveMarketMission) => void;
}

const statusClass = (status: string) =>
  status === 'in_progress'
    ? 'border-cyan-400/55 bg-cyan-500/15 text-cyan-200'
    : 'border-emerald-400/55 bg-emerald-500/15 text-emerald-200';

const LiveMarketFeed: React.FC<LiveMarketFeedProps> = ({ open, onClose, onSelectMission }) => {
  const { t } = useTranslation();
  const [missions, setMissions] = useState<LiveMarketMission[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
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
          created_at
        `)
        .eq('category', 'public')
        .in('status', ['available', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(5);

      if (cancelled) return;
      if (error) {
        setLoadError(error.message || 'Failed to load live market');
        setMissions([]);
      } else {
        setMissions(
          ((data || []) as LiveMarketMission[]).filter(
            (mission) =>
              Number.isFinite(mission.location_lat) &&
              Number.isFinite(mission.location_lng) &&
              (mission.status === 'available' || mission.status === 'in_progress')
          )
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-3 bottom-0 mx-auto max-w-xl rounded-t-3xl border border-cyan-500/25 bg-slate-950/85 p-4 shadow-[0_0_30px_rgba(8,145,178,0.2)]"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="mx-auto h-1.5 w-14 rounded-full bg-white/20" />
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-3 h-7 w-7 rounded-full border border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
              {loading && <p className="px-1 py-3 text-xs text-slate-400">Loading live feed...</p>}
              {!loading && loadError && <p className="px-1 py-3 text-xs text-red-300">{loadError}</p>}
              {!loading && !loadError && missions.length === 0 && (
                <p className="px-1 py-3 text-xs text-slate-400">No live missions now.</p>
              )}
              {!loading &&
                !loadError &&
                missions.map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    onClick={() => onSelectMission(mission)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 p-2 text-left transition-all hover:border-cyan-400/50 hover:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-900">
                        {mission.photo_urls?.[0] ? (
                          <img
                            src={mission.photo_urls[0]}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                            IMG
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-cyan-300">
                          {t('orderNumber')} {mission.id.slice(0, 8)}
                        </p>
                        <p className="truncate text-xs text-slate-300">
                          {t('address')}: {mission.location_lat.toFixed(4)}, {mission.location_lng.toFixed(4)}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] ${statusClass(
                              mission.status
                            )}`}
                          >
                            {t('status')}: {mission.status === 'in_progress' ? t('accepted') : mission.status}
                          </span>
                        </div>
                      </div>
                      <p className="shrink-0 text-sm font-black text-orange-300 drop-shadow-[0_0_10px_rgba(251,146,60,0.35)]">
                        {formatEgp(Number(mission.amount_target ?? 0))}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LiveMarketFeed;
