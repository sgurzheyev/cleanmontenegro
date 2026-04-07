import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { runMissionAiAnalysis } from '../lib/openai';
import { ADMIN_FORCE_RELEASE_PAYMENT_BTN } from '../../constants';
import { formatEgp } from '../lib/formatMoney';
import ModeratedMissionPhoto from '../../components/ModeratedMissionPhoto';

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  wallet_balance?: number | null;
  contact_email?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  is_verified?: boolean | null;
  is_banned?: boolean | null;
  first_gps_track?: unknown;
}

interface MissionRow {
  id: string;
  status: string;
  title?: string | null;
  creator_id?: string | null;
  cleaner_id?: string | null;
  category?: string | null;
  amount_target?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  description?: string | null;
  created_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  ai_confidence_score?: number | null;
  ai_verdict?: string | null;
}

interface PendingApprovalRow {
  id: string;
  amount_target: number;
  cleaner_id: string | null;
  status?: string;
  after_photo_urls?: string[] | null;
}

interface TransactionRow {
  id: string;
  user_id: string;
  mission_id?: string | null;
  amount: number;
  type: string;
  created_at: string;
  gateway?: string | null;
  status?: string | null;
  payout_method?: string | null;
  payout_details?: string | null;
  withdrawal_gross_usd?: number | null;
  withdrawal_fee_usd?: number | null;
  withdrawal_net_usd?: number | null;
}

interface AdminDashboardProps {
  onBack: () => void;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

type ParsedGps = { lat: number; lng: number } | null;

function parseFirstGpsTrack(value: unknown): ParsedGps {
  if (!value) return null;
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return null;
  }
  if (Array.isArray(value) && value.length >= 2) {
    const lat = Number(value[0]);
    const lng = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }
  if (typeof value === 'object') {
    const v = value as any;
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAllowedAdmin, setIsAllowedAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forcePayLoadingId, setForcePayLoadingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [selectedUserTransactions, setSelectedUserTransactions] = useState<TransactionRow[]>([]);
  const [selectedUserTxLoading, setSelectedUserTxLoading] = useState(false);
  const [selectedUserTxError, setSelectedUserTxError] = useState<string | null>(null);
  const [verifyLoadingUserId, setVerifyLoadingUserId] = useState<string | null>(null);
  const [pendingPayouts, setPendingPayouts] = useState<TransactionRow[]>([]);
  const [pendingPayoutsLoading, setPendingPayoutsLoading] = useState(false);
  const [pendingPayoutsError, setPendingPayoutsError] = useState<string | null>(null);
  const [payoutActionLoadingId, setPayoutActionLoadingId] = useState<string | null>(null);

  type TabId = 'god' | 'missions' | 'finance' | 'disputes';
  const [activeTab, setActiveTab] = useState<TabId>('god');

  const [godSearch, setGodSearch] = useState('');
  const [godLoading, setGodLoading] = useState(false);
  const [godError, setGodError] = useState<string | null>(null);

  const [editBalanceUser, setEditBalanceUser] = useState<ProfileRow | null>(null);
  const [editBalanceValue, setEditBalanceValue] = useState<string>('');
  const [editBalanceSubmitting, setEditBalanceSubmitting] = useState(false);

  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState<string | null>(null);

  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    total_donated: number;
    pending_payouts: number;
    pending_withdrawals: number;
    supervisor_bounties_total: number;
  } | null>(null);

  const [disputes, setDisputes] = useState<MissionRow[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputesError, setDisputesError] = useState<string | null>(null);
  const [aiRunningMissionId, setAiRunningMissionId] = useState<string | null>(null);
  const [lastAiRunByMissionId, setLastAiRunByMissionId] = useState<Record<string, string>>({});

  const fetchPendingApprovals = async () => {
    const { data, error: err } = await supabase
      .from('missions')
      .select('id, amount_target, cleaner_id, status, after_photo_urls')
      .in('status', ['completed', 'in_progress', 'disputed'])
      .not('cleaner_id', 'is', null)
      .order('created_at', { ascending: false });
    if (err) {
      console.error('Pending approvals fetch error:', err);
      return;
    }
    const rows = (data || []) as PendingApprovalRow[];
    const stuck = rows.filter(
      (m) =>
        m.status === 'completed' ||
        (m.after_photo_urls && m.after_photo_urls.length > 0)
    );
    setPendingApprovals(stuck);
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profRes, missRes, txRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, telegram_username, contact_email, phone_number, wallet_balance, avatar_url, is_verified, is_banned, first_gps_track')
          .order('wallet_balance', { ascending: false })
          .limit(50),
        supabase.from('missions').select('id, status, creator_id').limit(50),
        supabase
          .from('transactions')
          .select('id, user_id, mission_id, amount, type, gateway, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (profRes.error) throw profRes.error;
      if (missRes.error) throw missRes.error;
      if (txRes.error) throw txRes.error;

      setProfiles((profRes.data || []) as ProfileRow[]);
      setMissions((missRes.data || []) as MissionRow[]);
      setTransactions((txRes.data || []) as TransactionRow[]);
      await fetchPendingApprovals();
      await fetchPendingPayouts();
    } catch (e: any) {
      console.error('Admin fetch error:', e);
      setError(e?.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;

        const { data: profile } = user?.id
          ? await supabase
              .from('profiles')
              .select('telegram_username')
              .eq('id', user.id)
              .maybeSingle()
          : { data: null };

        const isAdmin =
          user?.email === 'sgurzheyev@gmail.com' ||
          user?.email?.includes('tg_6618910143') ||
          ((profile as any)?.telegram_username ?? '')
            .toString()
            .toLowerCase() === 'sergiogurgini';

        setIsAllowedAdmin(!!isAdmin);
      } catch {
        setIsAllowedAdmin(false);
      } finally {
        setAdminChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (adminChecked && isAllowedAdmin) {
      fetchAll();
    }
  }, [adminChecked, isAllowedAdmin]);

  const fetchPendingPayouts = async () => {
    setPendingPayoutsLoading(true);
    setPendingPayoutsError(null);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('type', 'withdrawal')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const rows = (data || []) as TransactionRow[];
      const pendingOnly = rows.filter((r) => {
        const s = (r as any).status as string | undefined;
        if (s === 'completed' || s === 'failed') return false;
        return s === 'pending' || s == null || s === undefined;
      });
      setPendingPayouts(pendingOnly);
    } catch (e: any) {
      console.error('Pending payouts fetch error:', e);
      setPendingPayoutsError(e?.message || 'Failed to load pending payouts.');
      setPendingPayouts([]);
    } finally {
      setPendingPayoutsLoading(false);
    }
  };

  const handleApprovePayout = async (tx: TransactionRow) => {
    const hasExitTax = typeof tx.withdrawal_gross_usd === 'number' && tx.withdrawal_gross_usd > 0;
    if (
      !window.confirm(
        hasExitTax
          ? 'Mark this payout as paid? (User wallet was already debited when they requested withdrawal.)'
          : 'Mark this payout as paid? This will deduct the balance.'
      )
    )
      return;
    setPayoutActionLoadingId(tx.id);
    try {
      const { error } = await supabase.rpc('approve_manual_payout', { p_transaction_id: tx.id });
      if (error) throw error;
      alert(hasExitTax ? 'Payout marked complete.' : 'Payout completed & balance deducted');
      setPendingPayouts((prev) => prev.filter((p) => p.id !== tx.id));
    } catch (e: any) {
      console.error('Approve payout error:', e);
      alert(e?.message || 'Failed to approve payout.');
    } finally {
      setPayoutActionLoadingId(null);
    }
  };

  const handleRejectPayout = async (tx: TransactionRow) => {
    if (!window.confirm('Reject this payout request?')) return;
    setPayoutActionLoadingId(tx.id);
    try {
      const { error } = await supabase.rpc('reject_withdrawal_request', {
        p_transaction_id: tx.id,
      });
      if (error) throw error;
      setPendingPayouts((prev) => prev.filter((p) => p.id !== tx.id));
    } catch (e: any) {
      console.error('Reject payout error:', e);
      alert(e?.message || 'Failed to reject payout.');
    } finally {
      setPayoutActionLoadingId(null);
    }
  };

  const openUser = async (p: ProfileRow) => {
    setSelectedUser(p);
    setSelectedUserTransactions([]);
    setSelectedUserTxError(null);
    setSelectedUserTxLoading(true);
    try {
      const { data, error: txErr } = await supabase
        .from('transactions')
        .select('id, user_id, mission_id, amount, type, gateway, created_at')
        .eq('user_id', p.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (txErr) throw txErr;
      setSelectedUserTransactions((data || []) as TransactionRow[]);
    } catch (e: any) {
      console.error('User tx fetch error:', e);
      setSelectedUserTxError(e?.message || 'Failed to load user transactions.');
    } finally {
      setSelectedUserTxLoading(false);
    }
  };

  const toggleVerify = async (userId: string, nextValue: boolean) => {
    setVerifyLoadingUserId(userId);
    try {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ is_verified: nextValue })
        .eq('id', userId);
      if (updErr) throw updErr;

      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, is_verified: nextValue } : p))
      );
      setSelectedUser((prev) => (prev?.id === userId ? { ...prev, is_verified: nextValue } : prev));
    } catch (e: any) {
      console.error('Verify toggle error:', e);
      alert(e?.message || 'Failed to update verification status.');
    } finally {
      setVerifyLoadingUserId(null);
    }
  };

  const toggleBan = async (userId: string, nextValue: boolean) => {
    try {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ is_banned: nextValue })
        .eq('id', userId);
      if (updErr) throw updErr;
      setProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, is_banned: nextValue } : p)));
      alert(nextValue ? 'User banned.' : 'User unbanned.');
    } catch (e: any) {
      console.error('Ban toggle error:', e);
      alert(e?.message || 'Failed to update ban status.');
    }
  };

  const submitBalanceEdit = async () => {
    if (!editBalanceUser) return;
    const next = Number(editBalanceValue);
    if (!Number.isFinite(next)) {
      alert('Invalid balance value.');
      return;
    }
    setEditBalanceSubmitting(true);
    try {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ wallet_balance: next })
        .eq('id', editBalanceUser.id);
      if (updErr) throw updErr;
      setProfiles((prev) => prev.map((p) => (p.id === editBalanceUser.id ? { ...p, wallet_balance: next } : p)));
      alert('Balance updated.');
      setEditBalanceUser(null);
    } catch (e: any) {
      console.error('Edit balance error:', e);
      alert(e?.message || 'Failed to update balance.');
    } finally {
      setEditBalanceSubmitting(false);
    }
  };

  const loadGodMode = async () => {
    setGodLoading(true);
    setGodError(null);
    try {
      const base = supabase
        .from('profiles')
        .select('id, full_name, telegram_username, contact_email, phone_number, wallet_balance, avatar_url, is_verified, is_banned', { count: 'exact' })
        .order('wallet_balance', { ascending: false })
        .limit(50);
      const { data, error } = await base;
      if (error) throw error;
      setProfiles((data || []) as ProfileRow[]);
    } catch (e: any) {
      console.error('God mode fetch error:', e);
      setGodError(e?.message || 'Failed to load users.');
    } finally {
      setGodLoading(false);
    }
  };

  const loadMissionControl = async () => {
    setMissionsLoading(true);
    setMissionsError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select('id, status, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, description, created_at, photo_urls, after_photo_urls')
        .in('status', ['pending_payment', 'pending', 'available', 'funding', 'in_progress', 'completed', 'disputed', 'pending_verification', 'review', 'dispute'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (err) throw err;
      setMissions((data || []) as MissionRow[]);
    } catch (e: any) {
      console.error('Mission control fetch error:', e);
      setMissionsError(e?.message || 'Failed to load missions.');
    } finally {
      setMissionsLoading(false);
    }
  };

  const cleanGhostPins = async () => {
    if (!window.confirm('Clean ghost pins older than 24h?')) return;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { error: delErr } = await supabase
        .from('missions')
        .delete()
        .eq('status', 'pending_payment')
        .lt('created_at', cutoff);
      if (delErr) throw delErr;
      alert('Ghost pins cleaned.');
      await loadMissionControl();
    } catch (e: any) {
      console.error('Clean ghost pins error:', e);
      alert(e?.message || 'Failed to clean ghost pins.');
    }
  };

  const forceCancelMission = async (missionId: string) => {
    if (!window.confirm('Force cancel this mission?')) return;
    try {
      const { error: rpcErr } = await supabase.rpc('force_cancel_mission', { p_mission_id: missionId });
      if (rpcErr) throw rpcErr;
      alert('Mission cancelled.');
      await loadMissionControl();
    } catch (e: any) {
      console.error('Force cancel error:', e);
      alert(e?.message || 'Failed to cancel mission.');
    }
  };

  const loadMetrics = async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_financial_metrics');
      if (err) throw err;
      const row = Array.isArray(data) ? data[0] : data;
      setMetrics({
        total_donated: Number(row?.total_donated ?? 0),
        pending_payouts: Number(row?.pending_payouts ?? 0),
        pending_withdrawals: Number(row?.pending_withdrawals ?? 0),
        supervisor_bounties_total: Number(row?.supervisor_bounties_total ?? 0),
      });
    } catch (e: any) {
      console.error('Metrics error:', e);
      setMetricsError(e?.message || 'Failed to load metrics.');
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  };

  const loadFinanceTab = async () => {
    await Promise.all([loadMetrics()]);
  };

  const loadDisputes = async () => {
    setDisputesLoading(true);
    setDisputesError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select('id, status, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, description, created_at, photo_urls, after_photo_urls, ai_confidence_score, ai_verdict')
        .in('status', ['disputed', 'pending_verification', 'review', 'dispute'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (err) throw err;
      setDisputes((data || []) as MissionRow[]);
    } catch (e: any) {
      console.error('Disputes fetch error:', e);
      setDisputesError(e?.message || 'Failed to load disputes.');
    } finally {
      setDisputesLoading(false);
    }
  };

  const resolveDispute = async (missionId: string, decision: 'approve' | 'reject') => {
    if (!window.confirm(decision === 'approve' ? 'Approve & payout?' : 'Reject dispute?')) return;
    try {
      const mission = disputes.find((d) => d.id === missionId) ?? null;
      const supervisorComment =
        decision === 'reject'
          ? (mission?.ai_verdict?.trim() || 'AI FRAUD DETECTED')
          : null;

      const { error: err } = await supabase.rpc('resolve_mission_dispute', {
        p_mission_id: missionId,
        p_decision: decision,
        p_supervisor_comment: supervisorComment,
        p_supervisor_verified: false,
        p_supervisor_user_id: null,
      });
      if (err) throw err;
      alert(decision === 'approve' ? 'Approved & paid out.' : 'Rejected.');
      await loadDisputes();
    } catch (e: any) {
      console.error('Resolve dispute error:', e);
      alert(e?.message || 'Failed to resolve dispute.');
    }
  };

  const runAiForMission = async (m: MissionRow) => {
    if (aiRunningMissionId) return;
    setAiRunningMissionId(m.id);
    try {
      const result = await runMissionAiAnalysis(m.id);

      const { error: updErr } = await supabase
        .from('missions')
        .update({
          ai_confidence_score: result.score,
          ai_verdict: result.verdict,
        })
        .eq('id', m.id);
      if (updErr) throw updErr;

      setLastAiRunByMissionId((prev) => ({
        ...prev,
        [m.id]: new Date().toISOString(),
      }));

      alert('AI analysis saved.');
      await loadDisputes();
    } catch (e: any) {
      console.error('AI analysis error:', e);
      alert(e?.message || 'AI analysis failed.');
    } finally {
      setAiRunningMissionId(null);
    }
  };

  const handleForcePay = async (mission: PendingApprovalRow) => {
    if (!mission.cleaner_id) {
      alert('No cleaner assigned to this mission.');
      return;
    }
    if (!window.confirm('Are you sure you want to force-release funds to the cleaner?')) return;
    setForcePayLoadingId(mission.id);
    try {
      const payoutEgp = Math.floor(Math.max(0, Number(mission.amount_target || 0)));

      const { data: workerProfile, error: workerErr } = await supabase
        .from('profiles')
        .select('id, wallet_balance')
        .eq('id', mission.cleaner_id)
        .maybeSingle();
      if (workerErr) throw workerErr;

      const currentBalance = (workerProfile?.wallet_balance ?? 0) as number;
      const { error: balanceErr } = await supabase
        .from('profiles')
        .update({ wallet_balance: currentBalance + payoutEgp })
        .eq('id', mission.cleaner_id);
      if (balanceErr) throw balanceErr;

      const { error: jobErr } = await supabase
        .from('missions')
        .update({ status: 'finished' })
        .eq('id', mission.id);
      if (jobErr) throw jobErr;

      await fetchPendingApprovals();
      alert('Payment force-released successfully.');
    } catch (err: any) {
      console.error('Force pay error:', err);
      alert(err?.message || 'Failed to force-release payment.');
    } finally {
      setForcePayLoadingId(null);
    }
  };

  const activeCount = missions.filter((m) =>
    ['available', 'in_progress'].includes(m.status)
  ).length;
  const completedCount = missions.filter((m) => m.status === 'completed').length;

  const missionsCreatedByUserId = (missions || []).reduce<Record<string, number>>((acc, m) => {
    const creatorId = m.creator_id || '';
    if (!creatorId) return acc;
    acc[creatorId] = (acc[creatorId] || 0) + 1;
    return acc;
  }, {});

  const filteredProfiles = (profiles || []).filter((p) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.full_name || '').toLowerCase();
    const handle = (p.telegram_username || '').toLowerCase();
    const email = (p.contact_email || '').toLowerCase();
    const phone = (p.phone_number || '').toLowerCase();
    return (
      name.includes(q) ||
      handle.includes(q) ||
      email.includes(q) ||
      phone.includes(q)
    );
  });

  const filteredGodProfiles = useMemo(() => {
    const q = godSearch.trim().toLowerCase();
    if (!q) return profiles;
    return (profiles || []).filter((p) => {
      const email = (p.contact_email || '').toLowerCase();
      const phone = (p.phone_number || '').toLowerCase();
      return email.includes(q) || phone.includes(q);
    });
  }, [godSearch, profiles]);

  if (!adminChecked) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 text-white">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-orange-500/60 border-t-orange-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAllowedAdmin) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 text-white">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-bold uppercase tracking-[0.18em]"
        >
          ← Back to Profile
        </button>
        <div className="mt-6 rounded-2xl bg-slate-950 border border-orange-500/20 p-6">
          <p className="text-sm text-slate-300">Access denied.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 text-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-bold uppercase tracking-[0.18em]"
      >
        ← Back to Profile
      </button>

      <h2 className="text-xl font-black uppercase tracking-[0.2em] text-orange-400/90">
        👑 Admin Panel Pro
      </h2>

      <div className="w-full -mx-1 px-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {([
          { id: 'god', label: 'God Mode' },
          { id: 'missions', label: 'Mission Control' },
          { id: 'finance', label: 'Financial Analytics' },
          { id: 'disputes', label: 'Dispute Center' },
        ] as { id: TabId; label: string }[]).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={async () => {
                setActiveTab(tab.id);
                if (tab.id === 'god') await loadGodMode();
                if (tab.id === 'missions') await loadMissionControl();
                if (tab.id === 'finance') await loadFinanceTab();
                if (tab.id === 'disputes') await loadDisputes();
              }}
              className={[
                'px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border transition-all active:scale-95',
                active
                  ? 'border-orange-500/50 text-orange-200 bg-orange-500/10 shadow-[0_0_14px_rgba(249,115,22,0.22)]'
                  : 'border-white/15 text-slate-300 bg-white/5 hover:bg-white/10',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 font-medium">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-amber-500/60 border-t-amber-400 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* System Stats */}
          <section className="rounded-2xl bg-black/40 border border-amber-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
              System Stats
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-emerald-400">{profiles.length}</p>
                <p className="text-[10px] text-slate-400 uppercase">Users</p>
              </div>
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-sky-400">{activeCount}</p>
                <p className="text-[10px] text-slate-400 uppercase">Active</p>
              </div>
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-amber-400">{completedCount}</p>
                <p className="text-[10px] text-slate-400 uppercase">Completed</p>
              </div>
            </div>
          </section>

          {/* Stuck Missions (Action Required) */}
          <section className="rounded-2xl bg-black/40 border border-red-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400/90 mb-3">
              ⚠️ Stuck Missions (Action Required)
            </h3>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {pendingApprovals.length === 0 ? (
                <p className="text-slate-500 text-xs italic py-2">No stuck missions.</p>
              ) : (
                pendingApprovals.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900/60 border border-white/5 px-3 py-2 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-slate-300">Mission: #{String(m.id).slice(0, 8)}</span>
                      <span className="text-slate-500">Cleaner: {String(m.cleaner_id || '').slice(0, 8)}</span>
                      <span className="text-slate-400">{formatEgp(Number(m.amount_target))}</span>
                    </div>
                    <button
                      type="button"
                      disabled={forcePayLoadingId === m.id}
                      onClick={() => handleForcePay(m)}
                      className={ADMIN_FORCE_RELEASE_PAYMENT_BTN}
                    >
                      {forcePayLoadingId === m.id && (
                        <span className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-red-200/40 border-t-red-100 animate-spin" aria-hidden />
                      )}
                      <span>{forcePayLoadingId === m.id ? 'Processing...' : 'Force Release Payment'}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Pending Payouts */}
          <section className="rounded-2xl bg-cyan-950/30 backdrop-blur-md border border-orange-500/20 shadow-[0_4px_30px_rgba(249,115,22,0.08)] p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                Pending Payouts
              </h3>
              <button
                type="button"
                onClick={fetchPendingPayouts}
                disabled={pendingPayoutsLoading}
                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-wait transition-all"
              >
                {pendingPayoutsLoading ? '...' : 'Refresh'}
              </button>
            </div>

            {pendingPayoutsError && (
              <p className="text-xs text-red-300 mb-2">{pendingPayoutsError}</p>
            )}

            <div className="max-h-64 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {pendingPayoutsLoading ? (
                <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Loading...</p>
              ) : pendingPayouts.length === 0 ? (
                <p className="text-slate-500 text-xs italic py-2">No pending payouts.</p>
              ) : (
                pendingPayouts.map((tx) => {
                  const user = profiles.find((p) => p.id === tx.user_id);
                  return (
                    <div
                      key={tx.id}
                      className="rounded-xl bg-cyan-950/30 backdrop-blur border border-orange-500/15 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-slate-200 truncate">
                            {user?.full_name || '—'}{' '}
                            <span className="text-slate-500">
                              {user?.telegram_username ? `(@${user.telegram_username})` : ''}
                            </span>
                          </p>
                          <p className="text-[10px] text-cyan-300 truncate">
                            WhatsApp: {user?.phone_number || '—'}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            Method: {tx.payout_method || '—'} • Details: {tx.payout_details || '—'}
                          </p>
                          <p className="text-[10px] text-slate-600">
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>

                        <div className="text-right max-w-[200px]">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pay user (net)</p>
                          <p className="text-orange-400 font-black">{formatEgp(Number(tx.amount))}</p>
                          {typeof tx.withdrawal_gross_usd === 'number' && tx.withdrawal_gross_usd > 0 && (
                            <p className="text-[9px] text-slate-500 mt-1 leading-snug">
                              Gross −wallet {formatEgp(Number(tx.withdrawal_gross_usd))} · Fee 12%{' '}
                              {formatEgp(Number(tx.withdrawal_fee_usd ?? 0))}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => handleApprovePayout(tx)}
                          disabled={payoutActionLoadingId === tx.id}
                          className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-orange-500/50 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_14px_rgba(249,115,22,0.22)] disabled:opacity-60 disabled:cursor-wait transition-all active:scale-95"
                        >
                          {payoutActionLoadingId === tx.id ? '...' : 'Mark as Paid'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectPayout(tx)}
                          disabled={payoutActionLoadingId === tx.id}
                          className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-red-500/50 text-red-200 bg-red-500/10 hover:bg-red-500/20 hover:shadow-[0_0_14px_rgba(239,68,68,0.22)] disabled:opacity-60 disabled:cursor-wait transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Tab content */}
          {activeTab === 'god' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  God Mode (User Management)
                </h3>
                <button
                  type="button"
                  onClick={loadGodMode}
                  disabled={godLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-wait transition-all"
                >
                  {godLoading ? '...' : 'Refresh'}
                </button>
              </div>

              <input
                type="text"
                value={godSearch}
                onChange={(e) => setGodSearch(e.target.value)}
                placeholder="Search by phone/email"
                className="mb-3 w-full rounded-2xl bg-black/40 border border-orange-500/30 px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
              {godError && <p className="text-xs text-red-300 mb-2">{godError}</p>}

              <div className="max-h-[420px] overflow-auto pr-1 rounded-xl border border-orange-500/15 bg-black/20 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-orange-500/15">
                    <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Wallet</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGodProfiles.map((p) => {
                      const name = p.full_name || '—';
                      const handle = p.telegram_username ? `@${p.telegram_username}` : '';
                      const verified = !!p.is_verified;
                      const banned = !!p.is_banned;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-orange-500/10 bg-cyan-950/20 backdrop-blur hover:bg-cyan-950/30 transition-colors"
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full overflow-hidden border border-orange-500/20 bg-slate-950 shrink-0">
                                {p.avatar_url ? (
                                  <img src={p.avatar_url} alt={name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-[11px] font-black text-orange-300">
                                    {(name || 'U').slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-200 truncate">
                                  {name}{' '}
                                  <span className="text-slate-500 font-normal">{handle ? `(${handle})` : ''}</span>
                                  {verified && <span className="ml-2 text-emerald-400">✅</span>}
                                  {banned && <span className="ml-2 text-red-400">⛔</span>}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">{p.id.slice(0, 8)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[10px] text-slate-300">{p.contact_email || '—'}</div>
                            <div className="text-[10px] text-cyan-300">{p.phone_number || '—'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-black text-orange-400">{formatEgp(Number(p.wallet_balance ?? 0))}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => toggleVerify(p.id, true)}
                                disabled={verifyLoadingUserId === p.id || verified}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 disabled:opacity-60 disabled:cursor-wait transition-all"
                              >
                                Verify Agent
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditBalanceUser(p);
                                  setEditBalanceValue(String(Number(p.wallet_balance ?? 0)));
                                }}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 transition-all"
                              >
                                Edit Balance
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleBan(p.id, true)}
                                disabled={banned}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-60 transition-all"
                              >
                                Ban User
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredGodProfiles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-500 italic">
                          No users.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'missions' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Mission Control
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    type="button"
                    onClick={cleanGhostPins}
                    className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-red-500/50 text-red-200 bg-red-500/10 hover:bg-red-500/20 hover:shadow-[0_0_16px_rgba(239,68,68,0.25)] transition-all active:scale-95"
                  >
                    Clean Ghost Pins
                  </button>
                  <button
                    type="button"
                    onClick={loadMissionControl}
                    disabled={missionsLoading}
                    className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all active:scale-95"
                  >
                    {missionsLoading ? '...' : 'Refresh'}
                  </button>
                </div>
              </div>
              {missionsError && <p className="text-xs text-red-300 mb-2">{missionsError}</p>}

              <div className="max-h-[520px] overflow-auto pr-1 rounded-xl border border-orange-500/15 bg-black/20 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-orange-500/15">
                    <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-2">Mission</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Creator</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(missions || []).map((m) => (
                      <tr key={m.id} className="border-b border-orange-500/10 bg-cyan-950/20">
                        <td className="px-3 py-2 font-mono text-slate-200">{m.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-slate-300">{m.status}</td>
                        <td className="px-3 py-2 text-orange-300">{formatEgp(Number(m.amount_target ?? 0))}</td>
                        <td className="px-3 py-2 text-slate-500 font-mono">{(m.creator_id || '').slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => forceCancelMission(m.id)}
                            className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 transition-all"
                          >
                            Force Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                    {missions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">
                          No missions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'finance' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Financial Analytics
                </h3>
                <button
                  type="button"
                  onClick={loadFinanceTab}
                  disabled={metricsLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all"
                >
                  {metricsLoading ? '...' : 'Refresh'}
                </button>
              </div>
              {metricsError && <p className="text-xs text-red-300 mb-2">{metricsError}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Total Donated', value: metrics?.total_donated ?? 0, color: 'text-emerald-400' },
                  { label: 'Pending Payouts', value: metrics?.pending_payouts ?? 0, color: 'text-amber-300' },
                  { label: 'Pending Withdrawals', value: metrics?.pending_withdrawals ?? 0, color: 'text-orange-400' },
                  {
                    label: 'Supervisor bounties (Ahmed-Pro)',
                    value: metrics?.supervisor_bounties_total ?? 0,
                    color: 'text-cyan-300',
                  },
                ].map((c) => (
                  <div key={c.label} className="rounded-2xl bg-cyan-950/20 backdrop-blur-md border border-orange-500/10 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{c.label}</p>
                    <p className={`mt-2 text-3xl font-black ${c.color}`}>{formatEgp(Number(c.value))}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'disputes' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Dispute Center
                </h3>
                <button
                  type="button"
                  onClick={loadDisputes}
                  disabled={disputesLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all"
                >
                  {disputesLoading ? '...' : 'Refresh'}
                </button>
              </div>
              {disputesError && <p className="text-xs text-red-300 mb-2">{disputesError}</p>}

              <div className="space-y-4">
                {disputes.map((m) => (
                  <div key={m.id} className="rounded-2xl bg-cyan-950/20 backdrop-blur-md border border-orange-500/10 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[11px] font-mono text-slate-200">#{m.id.slice(0, 8)}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-[0.18em]">{m.status}</p>
                        {m.description && <p className="mt-2 text-xs text-slate-300">{m.description}</p>}
                      </div>
                      {m.status === 'completed' ? (
                        <span className="shrink-0 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                          Completed & Paid
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Before</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {(m.photo_urls || []).slice(0, 4).map((url) => (
                            <div key={url} className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30">
                              <ModeratedMissionPhoto
                                url={url}
                                alt="Before"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                          {(m.photo_urls || []).length === 0 && (
                            <p className="text-xs text-slate-500 italic">No before photos.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">After</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {(m.after_photo_urls || []).slice(0, 4).map((url) => (
                            <div key={url} className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30">
                              <ModeratedMissionPhoto
                                url={url}
                                alt="After"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                          {(m.after_photo_urls || []).length === 0 && (
                            <p className="text-xs text-slate-500 italic">No after photos.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {m.status !== 'completed' && (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <button
                          type="button"
                          onClick={() => runAiForMission(m)}
                          disabled={aiRunningMissionId === m.id}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-cyan-500/30 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 hover:shadow-[0_0_14px_rgba(34,211,238,0.22)] disabled:opacity-60 disabled:cursor-wait transition-all active:scale-95"
                        >
                          {aiRunningMissionId === m.id ? '...' : '🤖 Run AI Analysis'}
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDispute(m.id, 'approve')}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 transition-all active:scale-95"
                        >
                          Approve & Payout
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDispute(m.id, 'reject')}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {(typeof m.ai_confidence_score === 'number' || m.ai_verdict) && (
                      <details className="mt-4 w-full rounded-xl border border-cyan-500/25 bg-slate-950/60 px-3 py-2 text-left max-h-[50vh] overflow-y-auto">
                        <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200/95 [&::-webkit-details-marker]:hidden">
                          🔍 AI Verification Details
                        </summary>
                        <div className="mt-2 space-y-2 text-[11px] text-slate-300">
                          {typeof m.ai_confidence_score === 'number' && (
                            <span
                              className={[
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] border',
                                m.ai_confidence_score > 85
                                  ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10'
                                  : m.ai_confidence_score > 50
                                    ? 'border-amber-500/40 text-amber-200 bg-amber-500/10'
                                    : 'border-red-500/40 text-red-200 bg-red-500/10',
                              ].join(' ')}
                            >
                              AI {m.ai_confidence_score}%
                            </span>
                          )}
                          {m.ai_verdict && (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm md:text-base leading-relaxed text-slate-200">
                              {m.ai_verdict}
                            </pre>
                          )}
                        </div>
                      </details>
                    )}

                    {isAllowedAdmin && (
                      <div className="mt-4 rounded text-xs font-mono text-cyan-500/70 bg-slate-950/50 p-2 border border-cyan-900/30">
                        <p>Before URLs: {(m.photo_urls || []).length}</p>
                        <p>After URLs: {(m.after_photo_urls || []).length}</p>
                        <p>
                          Last AI Run:{' '}
                          {lastAiRunByMissionId[m.id]
                            ? new Date(lastAiRunByMissionId[m.id]).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {!disputesLoading && disputes.length === 0 && (
                  <p className="text-sm text-slate-500 italic">No disputes.</p>
                )}
              </div>
            </section>
          )}

          {/* Existing 👥 User Directory (kept) */}
          <section className="rounded-2xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/90 mb-3">
              👥 User Directory
            </h3>

            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name, @username, email, or WhatsApp"
              className="mb-2 w-full rounded-2xl bg-slate-950 border border-cyan-500/40 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            />

            <div className="max-h-[420px] overflow-auto pr-1 rounded-xl border border-cyan-500/20 bg-cyan-950/10 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-cyan-500/20">
                  <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">WhatsApp</th>
                    <th className="px-3 py-2">Wallet</th>
                    <th className="px-3 py-2">Missions Created</th>
                    <th className="px-3 py-2">First GPS Track</th>
                    <th className="px-3 py-2 text-right">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">
                        No users match this search.
                      </td>
                    </tr>
                  ) : (
                    filteredProfiles.map((p) => {
                      const name = p.full_name || '—';
                      const handle = p.telegram_username ? `@${p.telegram_username}` : '—';
                      const email = p.contact_email || '—';
                      const phone = p.phone_number || '—';
                      const wallet = Number(p.wallet_balance ?? 0);
                      const createdCount = missionsCreatedByUserId[p.id] || 0;
                      const gps = parseFirstGpsTrack(p.first_gps_track);
                      const gpsLabel = gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : '—';
                      const verified = !!p.is_verified;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-cyan-500/10 bg-cyan-950/30 backdrop-blur hover:bg-cyan-950/40 transition-colors cursor-pointer"
                          onClick={() => openUser(p)}
                        >
                          <td className="px-3 py-2">
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full overflow-hidden border border-cyan-500/20 bg-slate-950 shrink-0">
                                {p.avatar_url ? (
                                  <img
                                    src={p.avatar_url}
                                    alt={name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-[11px] font-black text-cyan-300">
                                    {(name || 'U').slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="font-semibold text-slate-200 truncate">
                                {name}{' '}
                                <span className="text-slate-500 font-normal">({handle})</span>
                                {verified && (
                                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] border border-cyan-500/30 text-cyan-200 bg-cyan-500/10 shadow-[0_0_10px_rgba(34,211,238,0.25)]">
                                    Verified
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">{email}</div>
                              <div className="text-[10px] text-slate-600 font-mono truncate">
                                {p.id.slice(0, 8)}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-cyan-300 font-medium">{phone}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-orange-400">
                              {formatEgp(wallet)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-200">{createdCount}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{gpsLabel}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleVerify(p.id, !verified);
                              }}
                              disabled={verifyLoadingUserId === p.id}
                              className={[
                                'inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] transition-all',
                                'border',
                                verified
                                  ? 'border-orange-500/50 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_12px_rgba(249,115,22,0.25)]'
                                  : 'border-cyan-500/40 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 hover:shadow-[0_0_12px_rgba(34,211,238,0.22)]',
                                verifyLoadingUserId === p.id && 'opacity-60 cursor-wait',
                              ].join(' ')}
                            >
                              {verifyLoadingUserId === p.id ? '...' : verified ? 'Unverify' : 'Verify'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent Transactions */}
          <section className="rounded-2xl bg-black/40 border border-amber-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
              Recent Transactions
            </h3>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {(transactions || []).map((tx) => (
                <div
                  key={tx.id}
                  className="flex justify-between items-center rounded-xl bg-slate-900/60 border border-white/5 px-3 py-2 text-[11px]"
                >
                  <div>
                    <p className="font-mono text-slate-300">{tx.type}</p>
                    <p className="text-slate-500 text-[10px]">
                      {new Date(tx.created_at).toLocaleString()}
                    </p>
                  </div>
                  <p
                    className={`font-bold ${
                      ['deposit', 'mission_reward', 'donation'].includes(tx.type)
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {formatEgp(Number(tx.amount))}
                  </p>
                </div>
              ))}
              {transactions.length === 0 && (
                <p className="text-slate-500 text-xs italic py-4 text-center">
                  No transactions yet.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* Edit Balance modal */}
      {editBalanceUser && (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/70 backdrop-blur-sm"
          onClick={() => setEditBalanceUser(null)}
          aria-hidden="false"
        >
          <div
            className="w-[95vw] md:w-full max-w-4xl rounded-3xl bg-slate-950/95 backdrop-blur-xl border border-orange-500/20 p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={() => setEditBalanceUser(null)}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-orange-300/80">
                  Edit Balance
                </p>
                <p className="mt-1 text-sm font-bold text-white truncate">
                  {editBalanceUser.full_name || editBalanceUser.id.slice(0, 8)}
                </p>
              </div>
            </div>

            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              New wallet_balance (EUR)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={editBalanceValue}
              onChange={(e) => setEditBalanceValue(e.target.value)}
              className="w-full rounded-2xl bg-black/40 border border-orange-500/20 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setEditBalanceUser(null)}
                className="flex-1 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/10 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitBalanceEdit}
                disabled={editBalanceSubmitting}
                className="flex-1 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-orange-500/50 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-wait transition-all active:scale-95"
              >
                {editBalanceSubmitting ? '...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User deep-dive modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedUser(null)}
          aria-hidden="false"
        >
          <div
            className="w-[95vw] md:w-full max-w-4xl rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.12)] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300/80">
                  User Deep-Dive
                </p>
                <h3 className="mt-1 text-lg font-extrabold tracking-tight text-white truncate">
                  {selectedUser.full_name || '—'}{' '}
                  <span className="text-slate-400 font-normal">
                    {selectedUser.telegram_username ? `(@${selectedUser.telegram_username})` : ''}
                  </span>
                </h3>
                <p className="mt-1 text-[11px] text-slate-400 truncate">
                  {selectedUser.contact_email || '—'} •{' '}
                  <span className="text-cyan-300">{selectedUser.phone_number || '—'}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Wallet</p>
                <p className="text-orange-400 font-black">
                  {formatEgp(Number(selectedUser.wallet_balance ?? 0))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                  First GPS Track
                </p>
                {(() => {
                  const gps = parseFirstGpsTrack(selectedUser.first_gps_track);
                  if (!gps || !MAPBOX_TOKEN) {
                    return (
                      <p className="text-xs text-slate-500 italic">
                        {MAPBOX_TOKEN ? 'No GPS track available.' : 'Mapbox token missing.'}
                      </p>
                    );
                  }
                  return (
                    <div className="rounded-xl overflow-hidden border border-cyan-500/20">
                      <Map
                        mapboxAccessToken={MAPBOX_TOKEN}
                        initialViewState={{
                          latitude: gps.lat,
                          longitude: gps.lng,
                          zoom: 13,
                        }}
                        style={{ width: '100%', height: 220 }}
                        mapStyle="mapbox://styles/mapbox/dark-v11"
                      >
                        <Marker latitude={gps.lat} longitude={gps.lng} anchor="bottom">
                          <div className="w-4 h-4 rounded-full border-2 border-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.6)] bg-slate-950" />
                        </Marker>
                      </Map>
                    </div>
                  );
                })()}
              </div>

              <div className="rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                  IP / Device (if available)
                </p>
                <p className="text-xs text-slate-500 italic">
                  Not available in current schema.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Transaction History (this user)
                </p>
                {selectedUserTxLoading && (
                  <div className="h-4 w-4 border-2 border-cyan-500/60 border-t-cyan-300 rounded-full animate-spin" />
                )}
              </div>

              {selectedUserTxError && (
                <p className="text-xs text-red-400">{selectedUserTxError}</p>
              )}

              <div className="max-h-64 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                {selectedUserTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-cyan-950/30 backdrop-blur border border-cyan-500/10 px-3 py-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-slate-200 truncate">
                        {tx.type}
                        {tx.gateway ? <span className="text-slate-500">{` • ${tx.gateway}`}</span> : null}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(tx.created_at).toLocaleString()}
                      </p>
                      {tx.mission_id && (
                        <p className="text-[10px] text-slate-600 font-mono">
                          Mission: {String(tx.mission_id).slice(0, 8)}
                        </p>
                      )}
                    </div>
                    <p
                      className={`font-black ${
                        ['deposit', 'mission_reward', 'donation'].includes(tx.type)
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {formatEgp(Number(tx.amount))}
                    </p>
                  </div>
                ))}
                {!selectedUserTxLoading && selectedUserTransactions.length === 0 && (
                  <p className="text-slate-500 text-xs italic py-4 text-center">
                    No transactions found for this user.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
