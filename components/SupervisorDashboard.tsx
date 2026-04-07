import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { formatEur } from '../src/lib/formatMoney';
import { SMALL_CARDING_EGP_MAX } from '../constants';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';

interface MissionTransactionRow {
  id: string;
  user_id: string | null;
  mission_id?: string | null;
  amount: number;
  type: string;
  gateway?: string | null;
  created_at: string;
}

interface Mission {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  location_lat?: number | null;
  location_lng?: number | null;
  completion_lat?: number | null;
  completion_lng?: number | null;
  completion_distance_meters?: number | null;
  status: string;
  description?: string | null;
  created_at: string;
  started_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  is_disputed?: boolean | null;
}

interface ProfileRow {
  id: string;
  is_supervisor?: boolean | null;
}

const SupervisorDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [txByMissionId, setTxByMissionId] = useState<Record<string, MissionTransactionRow[]>>({});
  const [txLoadingMissionId, setTxLoadingMissionId] = useState<string | null>(null);
  const [txErrorByMissionId, setTxErrorByMissionId] = useState<Record<string, string | null>>({});

  const loadSupervisorFlag = useCallback(async () => {
    setAuthChecking(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setIsSupervisor(false);
        return;
      }
      const userId = session.user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, is_supervisor')
        .eq('id', userId)
        .maybeSingle();
      const row = profile as ProfileRow | null;
      setIsSupervisor(!!row?.is_supervisor);
    } catch (e) {
      console.error('Failed to load supervisor flag', e);
      setIsSupervisor(false);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: missionsError } = await supabase
        .from('missions')
        .select(
          'id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, completion_lat, completion_lng, completion_distance_meters, status, description, created_at, started_at, photo_urls, after_photo_urls, is_disputed'
        )
        .in('status', ['pending_verification', 'disputed'])
        .order('created_at', { ascending: false });

      if (missionsError) {
        throw missionsError;
      }

      setMissions((data || []) as Mission[]);
    } catch (e: any) {
      console.error('Failed to load missions for supervisor dashboard', e);
      setError(e?.message || 'Failed to load missions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupervisorFlag();
  }, [loadSupervisorFlag]);

  useEffect(() => {
    if (!authChecking && isSupervisor) {
      fetchMissions();
    }
  }, [authChecking, isSupervisor, fetchMissions]);

  const handleResolveMission = async (mission: Mission, decision: 'approve' | 'reject') => {
    if (actionLoadingId) return;
    let supervisorComment: string | undefined;

    if (decision === 'approve') {
      const confirmApprove = window.confirm('Approve this cleanup and release payment?');
      if (!confirmApprove) return;
    } else {
      supervisorComment = window.prompt(
        'Please provide a brief reason for rejection (e.g., "Trash just moved, not removed").'
      ) || undefined;
      if (!supervisorComment || !supervisorComment.trim()) {
        alert('Rejection requires a comment.');
        return;
      }
    }

    try {
      setActionLoadingId(mission.id);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const supervisorId = session?.user?.id ?? null;
      const { error } = await supabase.rpc('resolve_mission_dispute', {
        p_mission_id: mission.id,
        p_decision: decision,
        p_supervisor_comment: supervisorComment ?? null,
        p_supervisor_verified: decision === 'approve',
        p_supervisor_user_id: decision === 'approve' ? supervisorId : null,
      });
      if (error) {
        console.error('resolve_mission_dispute error:', error.message);
        alert(error.message || 'Failed to resolve mission.');
        return;
      }
      await fetchMissions();
    } catch (e: any) {
      console.error('resolve_mission_dispute exception:', e);
      alert(e?.message || 'Failed to resolve mission.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const loadMissionTransactions = useCallback(async (missionId: string) => {
    setTxLoadingMissionId(missionId);
    setTxErrorByMissionId((prev) => ({ ...prev, [missionId]: null }));
    try {
      const { data, error: txErr } = await supabase
        .from('transactions')
        .select('id, user_id, mission_id, amount, type, gateway, created_at')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (txErr) throw txErr;
      setTxByMissionId((prev) => ({ ...prev, [missionId]: (data || []) as MissionTransactionRow[] }));
    } catch (e: any) {
      console.error('Supervisor mission tx fetch error:', e);
      setTxErrorByMissionId((prev) => ({ ...prev, [missionId]: e?.message || 'Failed to load transactions.' }));
    } finally {
      setTxLoadingMissionId(null);
    }
  }, []);

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Checking permissions...</p>
      </div>
    );
  }

  if (!isSupervisor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          Supervisor access required to view this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Supervisor Dashboard</h1>
            <p className="text-[11px] text-slate-400 uppercase tracking-[0.18em] mt-1">
              Review missions flagged for verification or disputes
            </p>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Loading missions...</p>
        ) : missions.length === 0 ? (
          <p className="text-sm text-slate-400">No missions require supervisor attention right now.</p>
        ) : (
          <div className="space-y-4">
            {missions.map((mission) => {
              const beforePhotos = mission.photo_urls || [];
              const afterPhotos = mission.after_photo_urls || [];
              const photos = [...beforePhotos, ...afterPhotos];
              const isCity = mission.category === 'public';
              const tx = txByMissionId[mission.id] || [];
              const txError = txErrorByMissionId[mission.id] || null;
              const potentialCardingUserIds = (() => {
                const SMALL_EUR_MAX = SMALL_CARDING_EGP_MAX;
                const WINDOW_MS = 10 * 60 * 1000;
                const MIN_COUNT = 4;
                const now = Date.now();
                const recent = tx.filter((row) => {
                  const ts = new Date(row.created_at).getTime();
                  return Number.isFinite(ts) && now - ts <= WINDOW_MS;
                });
                const counts: Record<string, number> = {};
                for (const row of recent) {
                  const uid = row.user_id || '';
                  if (!uid) continue;
                  const amt = Number(row.amount);
                  if (!Number.isFinite(amt) || amt <= 0 || amt > SMALL_EUR_MAX) continue;
                  counts[uid] = (counts[uid] || 0) + 1;
                }
                return new Set(Object.entries(counts).filter(([, c]) => c >= MIN_COUNT).map(([uid]) => uid));
              })();

              return (
                <div
                  key={mission.id}
                  className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl p-4 space-y-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                        {isCity ? 'City Cleaning' : 'Home Cleaning'}
                      </p>
                      <p className="text-sm text-slate-300">
                        #{mission.id.slice(0, 8)} · {formatEur(Number(mission.amount_target))}
                      </p>
                      {mission.location_lat != null && mission.location_lng != null && (
                        <p className="text-[11px] text-slate-500 font-mono mt-1">
                          {mission.location_lat.toFixed(5)}, {mission.location_lng.toFixed(5)}
                        </p>
                      )}
                      {mission.description && (
                        <p className="text-xs text-slate-400 mt-2 max-w-xl">{mission.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ${
                          mission.status === 'disputed'
                            ? 'bg-red-500/10 text-red-300 border border-red-500/40'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {mission.status === 'disputed' ? 'Disputed' : 'Pending Verification'}
                      </span>
                      {typeof mission.completion_distance_meters === 'number' &&
                        mission.completion_distance_meters > 500 && (
                          <div className="mt-2 inline-flex items-center justify-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.18em] bg-red-500/10 border border-red-400/40 text-red-300 shadow-[0_0_14px_rgba(239,68,68,0.35)]">
                            ⚠ GPS &gt; 500m
                          </div>
                        )}
                    </div>
                  </div>

                  {photos.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          Before Photos
                        </p>
                        {beforePhotos.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No explicit before photos captured.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {beforePhotos.map((url, idx) => (
                              <div
                                key={`${mission.id}-before-${idx}`}
                                className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-slate-900"
                              >
                                <ModeratedMissionPhoto
                                  url={url}
                                  alt="Before"
                                  imgClassName="h-full w-full object-cover"
                                  showSafeBadge={false}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          After Photos
                        </p>
                        {afterPhotos.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No explicit after photos captured.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {afterPhotos.map((url, idx) => (
                              <div
                                key={`${mission.id}-after-${idx}`}
                                className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-slate-900"
                              >
                                <ModeratedMissionPhoto
                                  url={url}
                                  alt="After"
                                  imgClassName="h-full w-full object-cover"
                                  showSafeBadge={false}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Financial Trail */}
                  <div className="rounded-2xl bg-cyan-950/20 backdrop-blur-md border border-cyan-500/15 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        Financial Trail
                      </p>
                      <button
                        type="button"
                        onClick={() => loadMissionTransactions(mission.id)}
                        disabled={txLoadingMissionId === mission.id}
                        className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-cyan-500/30 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 disabled:opacity-60 disabled:cursor-wait transition-all"
                      >
                        {txLoadingMissionId === mission.id ? 'Loading...' : 'Load'}
                      </button>
                    </div>
                    {txError && <p className="mt-2 text-xs text-red-300">{txError}</p>}
                    <div className="mt-3 max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                      {tx.map((row) => {
                        const gw = (row.gateway || '').toLowerCase();
                        const badge =
                          gw.includes('stripe') ? 'Stripe' : row.gateway || null;
                        const isCarding = row.user_id ? potentialCardingUserIds.has(row.user_id) : false;
                        return (
                          <div
                            key={row.id}
                            className="flex items-center justify-between gap-3 rounded-xl bg-cyan-950/30 backdrop-blur border border-cyan-500/10 px-3 py-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="font-mono text-slate-200 truncate">
                                {row.type}
                                {badge ? (
                                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] border border-white/10 bg-black/40 text-slate-200">
                                    {badge}
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {new Date(row.created_at).toLocaleString()}
                              </p>
                            </div>
                            <p
                              className={[
                                'font-mono font-black tabular-nums',
                                isCarding
                                  ? 'text-red-300 drop-shadow-[0_0_10px_rgba(239,68,68,0.55)]'
                                  : 'text-emerald-300',
                              ].join(' ')}
                              title={isCarding ? 'Potential carding: repeated micro-payments by same user' : undefined}
                            >
                              {formatEgp(Number(row.amount))}
                            </p>
                          </div>
                        );
                      })}
                      {tx.length === 0 && (
                        <p className="text-[11px] text-slate-500 italic">No transactions linked to this mission.</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => handleResolveMission(mission, 'approve')}
                      disabled={actionLoadingId === mission.id}
                      className="inline-flex justify-center items-center px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait"
                    >
                      {actionLoadingId === mission.id ? 'Processing...' : 'Approve Cleanup'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveMission(mission, 'reject')}
                      disabled={actionLoadingId === mission.id}
                      className="inline-flex justify-center items-center px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] bg-red-500 text-white hover:bg-red-400 disabled:opacity-60 disabled:cursor-wait"
                    >
                      {actionLoadingId === mission.id ? 'Processing...' : 'Reject (Issue Penalty)'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupervisorDashboard;

