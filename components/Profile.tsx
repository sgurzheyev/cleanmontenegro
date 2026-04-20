import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { Pencil, Target, Globe, Building2, Clock, Info } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { useTranslation } from 'react-i18next';
import AdminDashboard from '../src/components/AdminDashboard';
import StripeTopUp from '../src/components/StripeTopUp';
import LivenessCheck from '../src/components/LivenessCheck';
import PhantomCapture from '../src/components/PhantomCapture';
import {
  CLIENT_APPROVE_RELEASE_BTN_LIST,
  CLIENT_APPROVE_RELEASE_BTN_MODAL,
  CLIENT_OPEN_DISPUTE_BTN_MODAL,
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  MISSION_STAKE_FEE_EUR,
  STORAGE_BUCKET_ORDER_PHOTOS,
  STORAGE_BUCKET_LIVENESS_VIDEOS,
  EDGE_FN_STRIPE_MISSION_CHECKOUT,
  DISPLAY_CURRENCY_SUFFIX,
} from '../constants';
import {
  MONTENEGRO_MARKETPLACE_CITIES,
  MARKETPLACE_REGION_MONTENEGRO,
  missionWithinCity,
} from '../src/lib/montenegroMarketplace';
import {
  workerCanSecureMissionDeposit,
  isSecurityDepositFailure,
  checkHomeMissionWorkerVerification,
} from '../src/lib/trustDeposit';
import { formatEgp, formatEgpDigits } from '../src/lib/formatMoney';
import { computeWithdrawalExitBreakdown } from '../src/lib/withdrawalTax';
import { floorEgp, parseIntegerEgpFromInput, sanitizeIntegerEgpDigits } from '../src/lib/integerEgpInput';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';

interface ProfileProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  onNavigateToJob?: (lat: number, lng: number) => void;
}

interface Job {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  current_funding?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  status: string;
  title?: string | null;
  description?: string | null;
  created_at: string;
  started_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  is_disputed?: boolean | null;
  retry_count?: number | null;
  rejection_reason?: string | null;
  rating?: number | null;
  ai_confidence_score?: number | null;
  ai_verdict?: string | null;
  cleaner?: {
    full_name?: string | null;
    telegram_username?: string | null;
  } | null;
}

type AfterBurstPackage = {
  files: File[];
  lat: number | null;
  lng: number | null;
  capturedAt: string;
};

type ToastState = {
  message: string;
  kind: 'success' | 'error';
} | null;

interface Bid {
  id: string;
  mission_id: string;
  cleaner_id: string;
  bid_amount: number;
  status: string;
  created_at?: string;
  /** Merged from profiles when loading bids (worker trust deposit). */
  worker_frozen_balance?: number | null;
  worker_wallet_balance?: number | null;
}

interface ProfileRow {
  id: string;
  wallet_balance: number | null;
  frozen_balance: number | null;
  contact_email?: string | null;
  is_verified?: boolean;
  verification_status?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
  telegram_username?: string | null;
  rating?: number | null;
  avatar_url?: string | null;
}

const SUPPORT_TELEGRAM = 'https://t.me/CleanMontenegro_Support';

/** Max EGP user may request to withdraw: wallet minus frozen security (cannot cash out frozen funds). */
function maxWithdrawableEgp(profile: ProfileRow | null): number {
  if (!profile) return 0;
  const w = Number(profile.wallet_balance ?? 0);
  const f = Number(profile.frozen_balance ?? 0);
  return Math.max(0, Math.round((w - f) * 100) / 100);
}

const shortId = (id: unknown): string => {
  if (id == null) return 'N/A';
  try {
    return String(id).slice(0, 8);
  } catch {
    return 'N/A';
  }
};

/** Whole EGP worker share (90%) — matches DB floor() in resolve_mission_dispute. */
function workerPayoutFromFundingEgp(f: number | null | undefined): number {
  return Math.floor(Math.max(0, Number(f ?? 0)) * 0.9);
}

function ProfileAccordion({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${PROFILE_GLASS_PANEL} mb-4 overflow-hidden max-w-full`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left text-white transition-colors hover:bg-white/5"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold uppercase tracking-[0.16em]">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <span className="shrink-0 text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-white/10 px-4 pb-4 pt-3 max-w-full overflow-x-hidden">{children}</div>}
    </div>
  );
}

function JobTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const format = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return `${h}h ${m % 60}m`;
      if (m > 0) return `${m}m ${s % 60}s`;
      return `${s}s`;
    };
    const tick = () => {
      const start = new Date(startedAt).getTime();
      setElapsed(format(Date.now() - start));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums text-emerald-400 font-bold">{elapsed}</span>;
}

const Profile: React.FC<ProfileProps> = ({ isOpen, onClose, session: _session, onNavigateToJob }) => {
  const { t, i18n } = useTranslation();
  const isRu = (i18n.language || '').toLowerCase().startsWith('ru');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showRefunds, setShowRefunds] = useState(false);
  const [balance, setBalance] = useState(0);
  const [myHomeJobs, setMyHomeJobs] = useState<Job[]>([]);
  const [myCityJobs, setMyCityJobs] = useState<Job[]>([]);
  const [myActiveJobs, setMyActiveJobs] = useState<Job[]>([]);
  const [missionHistory, setMissionHistory] = useState<Job[]>([]);
  const [jobBidsById, setJobBidsById] = useState<Record<string, Bid[]>>({});
  const [marketplaceJobs, setMarketplaceJobs] = useState<Job[]>([]);
  const [marketRegion, setMarketRegion] = useState(MARKETPLACE_REGION_MONTENEGRO);
  const [marketCityId, setMarketCityId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const isAdmin =
    _session?.user?.email?.includes('tg_6618910143') ||
    userProfile?.telegram_username?.toLowerCase() === 'sergiogurgini';
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [paymentSyncing, setPaymentSyncing] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [releasePaySubmitting, setReleasePaySubmitting] = useState(false);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [toastState, setToastState] = useState<ToastState>(null);
  const [taskType, setTaskType] = useState<'city' | 'home'>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderLocation, setOrderLocation] = useState('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhoto, setOrderPhoto] = useState<File | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  /** Loading id for Retry/Cancel on `pending_payment` (Phantom Pin) cards. */
  const [phantomPaymentActionId, setPhantomPaymentActionId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [contactEditMode, setContactEditMode] = useState(true);
  const [passwordEditMode, setPasswordEditMode] = useState(true);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [showStripeTopUp, setShowStripeTopUp] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'InstaPay' | 'Vodafone Cash' | 'Card'>('InstaPay');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutStep, setPayoutStep] = useState<'form' | 'confirm'>('form');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpSubmitting, setTopUpSubmitting] = useState(false);
  const navigate = useNavigate();
  const lastMissionStatusActionAtRef = useRef<number>(0);
  const toastTimerRef = useRef<number | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const languageOptions = [
    { code: 'en', labelKey: 'english' as const, short: 'EN' },
    { code: 'ar', labelKey: 'arabic' as const, short: 'AR' },
    { code: 'ru', labelKey: 'russian' as const, short: 'RU' },
    { code: 'de', labelKey: 'german' as const, short: 'DE' },
    { code: 'it', labelKey: 'italian' as const, short: 'IT' },
    { code: 'es', labelKey: 'spanish' as const, short: 'ES' },
  ] as const;

  useEffect(() => {
    if (!langMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [langMenuOpen]);

  const toast = {
    success: (message: string) => {
      setToastState({ message, kind: 'success' });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastState(null), 2600);
    },
    error: (message: string) => {
      setToastState({ message, kind: 'error' });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastState(null), 3000);
    },
  };

  const enforceMissionStatusCooldown = () => {
    const now = Date.now();
    if (now - lastMissionStatusActionAtRef.current < 10_000) {
      alert('Anti-spam: Please wait 10 seconds before changing mission status.');
      return false;
    }
    lastMissionStatusActionAtRef.current = now;
    return true;
  };

  const selectedMarketCity = useMemo(
    () => MONTENEGRO_MARKETPLACE_CITIES.find((c) => c.id === marketCityId) ?? null,
    [marketCityId]
  );

  const filteredMarketplaceJobs = useMemo(() => {
    const base = (marketplaceJobs || []).filter(
      (job) =>
        ['pending', 'available', 'funding'].includes(job.status) &&
        job.cleaner_id == null
    );
    if (!selectedMarketCity) return [] as Job[];
    return base
      .filter((job) =>
        missionWithinCity(job.location_lat, job.location_lng, selectedMarketCity)
      )
      .sort((a, b) => {
        const aAvailable = a.status === 'available' ? 1 : 0;
        const bAvailable = b.status === 'available' ? 1 : 0;
        if (aAvailable !== bAvailable) return bAvailable - aAvailable;
        return Number(b.amount_target ?? 0) - Number(a.amount_target ?? 0);
      });
  }, [marketplaceJobs, selectedMarketCity]);

  // Real-time wallet balance subscription
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`profiles-balance-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${userId}`,
          },
          (payload: any) => {
            const newRow = payload.new as ProfileRow | undefined;
            if (newRow && typeof newRow.wallet_balance === 'number') {
              setBalance(newRow.wallet_balance);
            }
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Worker proof-of-work modal (before/after photos)
  const [proofJob, setProofJob] = useState<Job | null>(null);
  const [proofPhase, setProofPhase] = useState<'before' | 'after'>('before');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [proofPreviewUrls, setProofPreviewUrls] = useState<string[]>([]);
  const [afterBurstPackages, setAfterBurstPackages] = useState<AfterBurstPackage[]>([]);
  const [showPhantomCapture, setShowPhantomCapture] = useState(false);
  const [livenessBlob, setLivenessBlob] = useState<Blob | null>(null);
  const [livenessMimeType, setLivenessMimeType] = useState<string>('video/webm');
  const [livenessLat, setLivenessLat] = useState<number | null>(null);
  const [livenessLng, setLivenessLng] = useState<number | null>(null);
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofSuccess, setProofSuccess] = useState<string | null>(null);
  const [proofProcessingImage, setProofProcessingImage] = useState(false);
  const [plasticKg, setPlasticKg] = useState<string>('0');
  const [glassKg, setGlassKg] = useState<string>('0');
  const [constructionKg, setConstructionKg] = useState<string>('0');
  const [woodKg, setWoodKg] = useState<string>('0');

  // Create proof preview object URLs and revoke them when the set of files changes/unmounts.
  useEffect(() => {
    const urls = proofFiles.map((file) => URL.createObjectURL(file));
    setProofPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [proofFiles]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUploading(true);

      if (!file.type || !file.type.startsWith('image/')) {
        alert('Only images are allowed');
        return;
      }

      const compressedAvatar = (await imageCompression(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: 'image/jpeg',
      })) as File;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to upload an avatar.');
        return;
      }
      const userId = session.user.id;
      const fileExt = 'jpg';
      const filePath = `${userId}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedAvatar, { upsert: false, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(filePath);

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (profileErr) throw profileErr;

      setUserProfile((prev) =>
        prev ? { ...prev, avatar_url: publicUrl } : prev
      );
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      alert(err?.message || 'Failed to upload avatar. Please try again.');
    } finally {
      setAvatarUploading(false);
      // reset input value so the same file can be re-selected if needed
      e.target.value = '';
    }
  };

  const handlePayoutFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const amountNum = floorEgp(parseIntegerEgpFromInput(payoutAmount));
    if (amountNum <= 0) {
      alert('Please enter a positive payout amount.');
      return;
    }
    const maxWd = maxWithdrawableEgp(userProfile);
    if (amountNum > maxWd + 0.0001) {
      alert(t('withdrawalExceedsAvailable'));
      return;
    }
    if (!payoutDetails.trim()) {
      alert('Please provide payment details (wallet, card, etc.).');
      return;
    }
    setPayoutStep('confirm');
  };

  const handleConfirmWithdrawal = async () => {
    if (!userProfile) return;
    const amountNum = floorEgp(parseIntegerEgpFromInput(payoutAmount));
    if (amountNum <= 0) return;
    const maxWd = maxWithdrawableEgp(userProfile);
    if (amountNum > maxWd + 0.0001) {
      alert(t('withdrawalExceedsAvailable'));
      return;
    }
    try {
      setPayoutSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to request a payout.');
        return;
      }

      const { error } = await supabase.rpc('process_withdrawal_request', {
        p_requested_amount: amountNum,
        p_payout_method: payoutMethod,
        p_payout_details: payoutDetails.trim(),
      });
      if (error) {
        alert(error.message || 'Failed to request payout. Please try again.');
        return;
      }

      toast.success(t('withdrawalRequestQueued'));
      setShowPayoutModal(false);
      setPayoutStep('form');
      setPayoutAmount('');
      setPayoutDetails('');
      await fetchProfileData();
    } catch (err: any) {
      alert(err?.message || 'Failed to request payout. Please try again.');
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = floorEgp(parseIntegerEgpFromInput(topUpAmount));
    if (amountNum <= 0) {
      alert('Please enter a positive amount to top up.');
      return;
    }
    try {
      setTopUpSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to top up your wallet.');
        return;
      }
      const { error } = await supabase.rpc('admin_credit_wallet_egp', {
        p_amount: amountNum,
      });
      if (error) {
        alert(error.message || 'Failed to top up wallet. Please try again.');
        return;
      }
      alert('Funds added successfully!');
      setTopUpAmount('');
      await fetchProfileData();
    } catch (err: any) {
      alert(err?.message || 'Failed to top up wallet. Please try again.');
    } finally {
      setTopUpSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    setPasswordSaved(false);

    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }

    try {
      setPasswordSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setPasswordError('You must be logged in to change your password.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        setPasswordError(error.message || 'Failed to update password.');
        return;
      }

      setPasswordSuccess('Password updated successfully.');
      setPasswordSaved(true);
      setPasswordEditMode(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to update password.');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const verifyJobPaymentAndRefetch = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/verify-job-payment', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      await res.json().catch(() => ({}));
    } catch (e) {
      console.error('Verify job payment error:', e);
    } finally {
      sessionStorage.removeItem('paymentSuccessNeedsVerify');
    }
    await fetchProfileData();
    await fetchMarketplaceJobs();
  }, []);

  useEffect(() => {
    const runFallbackIfNeeded = async () => {
      const needsVerify = sessionStorage.getItem('paymentSuccessNeedsVerify');
      if (needsVerify !== 'job_creation') return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setPaymentSyncing(true);
      try {
        await verifyJobPaymentAndRefetch();
      } finally {
        setPaymentSyncing(false);
      }
    };
    runFallbackIfNeeded();
  }, [verifyJobPaymentAndRefetch]);

  useEffect(() => {
    const onPaymentSuccess = () => {
      const needsVerify = sessionStorage.getItem('paymentSuccessNeedsVerify');
      setPaymentSyncing(true);
      (needsVerify === 'job_creation' ? verifyJobPaymentAndRefetch() : Promise.all([fetchProfileData(), fetchMarketplaceJobs()]))
        .finally(() => setPaymentSyncing(false));
    };
    window.addEventListener('paymentSuccess', onPaymentSuccess);
    return () => window.removeEventListener('paymentSuccess', onPaymentSuccess);
  }, [verifyJobPaymentAndRefetch]);

  useEffect(() => {
    if (!isOpen) return;
    const loadOnce = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetchProfileData();
        await fetchMarketplaceJobs();
      } catch (e) {
        console.error('Profile init fetch error:', e);
      }
    };
    loadOnce();
  }, [isOpen]);

  const fetchProfileData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setMyHomeJobs([]);
        setMyCityJobs([]);
        setMyActiveJobs([]);
        setJobBidsById({});
        setLoading(false);
        return;
      }
      const userId = session.user.id;
      setUserEmail(session.user.email ?? null);

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, wallet_balance, frozen_balance, contact_email, is_verified, verification_status, full_name, phone_number, telegram_username, rating, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      setUserProfile(profileRow ?? null);
      if (profileRow) {
        setBalance(profileRow.wallet_balance ?? 0);
        setPhoneNumber(profileRow.phone_number ?? '');
        setTelegramUsername(profileRow.telegram_username ?? '');
        setContactEmail(profileRow.contact_email ?? session.user.email ?? '');
        setContactEditMode(!(profileRow.contact_email || profileRow.phone_number || profileRow.telegram_username));
      }

      const { data: homeJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason, ai_confidence_score, ai_verdict')
        .eq('creator_id', userId)
        .eq('category', 'home')
        .order('created_at', { ascending: false });
      setMyHomeJobs((homeJobsData || []) as unknown as Job[]);

      const { data: cityJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason, ai_confidence_score, ai_verdict')
        .eq('creator_id', userId)
        .eq('category', 'public')
        .order('created_at', { ascending: false });
      setMyCityJobs((cityJobsData || []) as unknown as Job[]);

      const { data: activeJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason')
        .eq('cleaner_id', userId)
        .in('status', ['in_progress', 'review', 'pending_approval', 'completed', 'finished'])
        .order('created_at', { ascending: false });
      setMyActiveJobs(
        ((activeJobsData || []) as unknown as Job[]).map((job) => ({
          ...job,
          photo_urls: Array.isArray(job.photo_urls) ? job.photo_urls.slice(0, 9) : job.photo_urls,
          after_photo_urls: Array.isArray(job.after_photo_urls) ? job.after_photo_urls.slice(0, 9) : job.after_photo_urls,
        }))
      );

      const { data: historyData } = await supabase
        .from('missions')
        .select(
          `
          id,
          creator_id,
          cleaner_id,
          category,
          amount_target,
          location_lat,
          location_lng,
          status,
          title,
          description,
          created_at,
          photo_urls,
          after_photo_urls,
          started_at,
          is_disputed,
          cleaner:profiles!missions_cleaner_id_fkey (
            full_name,
            telegram_username
          )
        `
        )
        .eq('status', 'completed')
        .or(`creator_id.eq.${userId},cleaner_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(100);
      setMissionHistory((historyData || []) as unknown as Job[]);

      const pendingJobIds = [
        ...(((homeJobsData || []) as unknown as Job[]).filter((j) => j.status === 'pending').map((j) => j.id)),
        ...(((cityJobsData || []) as unknown as Job[]).filter((j) => j.status === 'pending').map((j) => j.id)),
      ];
      if (pendingJobIds.length > 0) {
        const { data: bidsData } = await supabase
          .from('mission_bids')
          .select('id, mission_id, cleaner_id, bid_amount, status, created_at')
          .in('mission_id', pendingJobIds);
        const cleanerIds = [
          ...new Set(
            ((bidsData || []) as Bid[]).map((b) => b.cleaner_id).filter(Boolean) as string[]
          ),
        ];
        let frozenByCleaner: Record<string, number> = {};
        let walletByCleaner: Record<string, number> = {};
        if (cleanerIds.length > 0) {
          const { data: frozenRows } = await supabase
            .from('profiles')
            .select('id, frozen_balance, wallet_balance')
            .in('id', cleanerIds);
          frozenByCleaner = Object.fromEntries(
            (frozenRows || []).map((r: any) => [r.id, Number(r.frozen_balance ?? 0)])
          );
          walletByCleaner = Object.fromEntries(
            (frozenRows || []).map((r: any) => [r.id, Number(r.wallet_balance ?? 0)])
          );
        }
        const byJob: Record<string, Bid[]> = {};
        for (const bid of (bidsData || []) as Bid[]) {
          const enriched: Bid = {
            ...bid,
            worker_frozen_balance: frozenByCleaner[bid.cleaner_id] ?? 0,
            worker_wallet_balance: walletByCleaner[bid.cleaner_id] ?? 0,
          };
          if (!byJob[bid.mission_id]) byJob[bid.mission_id] = [];
          byJob[bid.mission_id].push(enriched);
        }
        setJobBidsById(byJob);
      } else {
        setJobBidsById({});
      }
    } catch (err) {
      console.error('Error fetching profile data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMarketplaceJobs = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      setMarketplaceLoading(true);
      setMarketplaceError(null);

      const { data, error } = await supabase
        .from('missions')
        .select('*')
        .in('status', ['available', 'funding', 'pending'])
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        throw error;
      }

      setMarketplaceJobs((data || []) as Job[]);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Failed to load marketplace. Please refresh.');
    } finally {
      setMarketplaceLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const amount = floorEgp(parseIntegerEgpFromInput(orderAmount));
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

    try {
      setOrderSubmitting(true);
      // OAuth (e.g. Google) on mobile: refresh session so the next request carries a valid JWT for RLS.
      try {
        await supabase.auth.refreshSession();
      } catch {
        /* non-fatal: continue to getUser */
      }
      // Use getUser() (not getSession) so the JWT is validated; RLS uses auth.uid() and
      // mobile WebViews often have a cached session that must be verified before insert.
      const {
        data: { user: authUser },
        error: authUserError,
      } = await supabase.auth.getUser();
      const creatorId = authUser?.id ?? null;
      if (authUserError || !creatorId) {
        setOrderError(t('createTaskSignIn'));
        return;
      }

      // Direct insert into public.missions only (not create_public_mission_with_fee — that RPC
      // uses different status/flow and is used from MapPicker / city pin wallet path).
      // Repo schema uses creator_id; migration 20260421_missions_user_id_mirror_creator.sql adds
      // user_id + BEFORE INSERT trigger so user_id matches creator_id for RLS policies that check user_id.
      // IMPORTANT: avoid `.select().single()` on insert.
      // If SELECT RLS is stricter than INSERT RLS, PostgREST can still throw an RLS error
      // when returning the inserted row representation — even though the row is inserted.
      // Fix: generate the mission UUID client-side and insert with return=minimal.
      const missionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      const { error: missionError } = await supabase.from('missions').insert(
        {
          id: missionId,
          creator_id: creatorId,
          category: taskType === 'city' ? 'public' : 'home',
          amount_target: floorEgp(amount),
          current_funding: 0,
          // TODO: wire actual map location; using fallback center for now (Podgorica).
          location_lat: 42.4411,
          location_lng: 19.2636,
          status: 'pending_payment',
          description: orderDescription || null,
          photo_urls: [],
        } as any,
        { returning: 'minimal' } as any,
      );

      if (missionError) throw missionError;

      // City pin: Stripe Checkout for Scout Stake (see EDGE_FN_STRIPE_MISSION_CHECKOUT — implement in Supabase Edge Functions).
      if (taskType === 'city') {
        const { data: checkoutPayload, error: checkoutFnErr } = await supabase.functions.invoke(
          EDGE_FN_STRIPE_MISSION_CHECKOUT,
          {
            body: {
              mission_id: missionId,
              amount_eur: MISSION_STAKE_FEE_EUR,
              success_url: `${window.location.origin}/?stripe_mission=success&mission_id=${encodeURIComponent(missionId)}`,
              cancel_url: `${window.location.origin}/?stripe_mission=cancel`,
            },
          },
        );

        if (checkoutFnErr) {
          console.error('stripe mission checkout:', checkoutFnErr);
          toast.error(t('stripeMissionCheckoutFailed'));
          setOrderError(t('stripeMissionCheckoutFailed'));
          await fetchProfileData();
          return;
        }

        const checkoutUrl =
          checkoutPayload &&
          typeof checkoutPayload === 'object' &&
          checkoutPayload !== null &&
          'url' in checkoutPayload &&
          typeof (checkoutPayload as { url?: unknown }).url === 'string'
            ? (checkoutPayload as { url: string }).url
            : null;

        if (checkoutUrl) {
          window.location.assign(checkoutUrl);
          return;
        }

        toast.error(t('stripeMissionCheckoutFailed'));
        setOrderError(t('stripeMissionCheckoutFailed'));
        await fetchProfileData();
        return;
      }

      // Redirect happens above on success.
    } catch (err) {
      console.error('Create task exception:', err);
      setOrderError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      );
    } finally {
      setOrderSubmitting(false);
    }
  };

  const retryPendingPaymentMission = async (job: Job) => {
    try {
      setPhantomPaymentActionId(job.id);
      const { data: checkoutPayload, error: checkoutFnErr } = await supabase.functions.invoke(
        'stripe-mission-checkout',
        {
          body: { missionId: job.id },
        }
      );
      if (checkoutFnErr) {
        console.error('Stripe Edge Function Error:', checkoutFnErr);
        toast.error(t('stripeMissionCheckoutFailed'));
        return;
      }
      const checkoutUrl =
        checkoutPayload &&
        typeof checkoutPayload === 'object' &&
        checkoutPayload !== null &&
        'url' in checkoutPayload &&
        typeof (checkoutPayload as { url?: unknown }).url === 'string'
          ? (checkoutPayload as { url: string }).url
          : null;
      if (!checkoutUrl) {
        console.error('Stripe Edge Function Error:', checkoutPayload);
        toast.error(t('stripeMissionCheckoutFailed'));
        return;
      }
      window.location.href = checkoutUrl;
    } catch (e) {
      console.error('Stripe Edge Function Error:', e);
      toast.error(t('retryPaymentFailed'));
    } finally {
      setPhantomPaymentActionId(null);
    }
  };

  const cancelPendingPaymentMission = async (job: Job, list: 'home' | 'city') => {
    try {
      setPhantomPaymentActionId(job.id);
      const { error } = await supabase.rpc('cancel_pending_payment_mission', {
        p_mission_id: job.id,
      });
      if (error) throw error;
      if (list === 'home') {
        setMyHomeJobs((prev) => prev.filter((j) => j.id !== job.id));
      } else {
        setMyCityJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
      toast.success(t('missionCancelled'));
    } catch (e) {
      console.error('cancelPendingPaymentMission:', e);
      toast.error(t('cancelMissionFailed'));
    } finally {
      setPhantomPaymentActionId(null);
    }
  };

  // payMissionFromWallet removed: direct Stripe Checkout only.

  const handleAcceptBid = async (job: Job, bid: Bid) => {
    if (!enforceMissionStatusCooldown()) return;
    const missionValue = Number(bid.bid_amount ?? 0);
    if (!Number.isFinite(missionValue) || missionValue <= 0) return;

    const { data: workerProf, error: workerProfErr } = await supabase
      .from('profiles')
      .select('frozen_balance, wallet_balance, is_verified')
      .eq('id', bid.cleaner_id)
      .maybeSingle();
    if (workerProfErr) {
      console.error(workerProfErr);
      toast.error(workerProfErr.message || 'Could not verify worker deposit.');
      return;
    }
    const homeOk = checkHomeMissionWorkerVerification(job.category, workerProf?.is_verified);
    if (!homeOk.ok) {
      alert(t('verificationPromptOnlyVerified'));
      return;
    }
    const walletEgp = Number(workerProf?.wallet_balance ?? 0);
    const frozenEgp = Number(workerProf?.frozen_balance ?? 0);
    const amtTarget = Number(job.amount_target ?? bid.bid_amount ?? 0);
    const sec = workerCanSecureMissionDeposit(walletEgp, frozenEgp, job.category, amtTarget);
    if (isSecurityDepositFailure(sec)) {
      if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
        alert(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
      } else {
        toast.error(
          sec.reason === 'frozen_exceeds_wallet'
            ? t('walletFrozenInvariantError')
            : t('insufficientSecurityDepositFunds')
        );
      }
      return;
    }

    if (!window.confirm(t('acceptBidConfirm', { amount: formatEgp(Number(bid.bid_amount)) }))) return;
    try {
      const { error: jobErr } = await supabase
        .from('missions')
        .update({
          cleaner_id: bid.cleaner_id,
          amount_target: bid.bid_amount,
          status: 'in_progress',
        })
        .eq('id', job.id);
      if (jobErr) throw jobErr;

      await supabase.from('mission_bids').update({ status: 'accepted' }).eq('id', bid.id);

      const { data: otherBids } = await supabase
        .from('mission_bids')
        .select('id')
        .eq('mission_id', job.id)
        .neq('id', bid.id)
        .eq('status', 'pending');
      if (otherBids && otherBids.length > 0) {
        await supabase
          .from('mission_bids')
          .update({ status: 'rejected' })
          .eq('mission_id', job.id)
          .neq('id', bid.id);
      }

      await fetchProfileData();
    } catch (err) {
      console.error(err);
      alert('Failed to accept bid. Please try again.');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm('Delete this request? This action cannot be undone.')) return;
    try {
      const { error } = await supabase.from('missions').delete().eq('id', jobId);
      if (error) throw error;
      setMyHomeJobs((prev) => prev.filter((j) => j.id !== jobId));
      setJobBidsById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    } catch (err) {
      console.error(err);
      alert('Failed to delete. Please try again.');
    }
  };

  const openNavigate = (job: Job) => {
    const lat = job.location_lat;
    const lng = job.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      alert('This job does not have coordinates yet.');
      return;
    }
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openProofModal = (job: Job, phase: 'before' | 'after') => {
    setProofJob({
      ...job,
      photo_urls: Array.isArray(job.photo_urls) ? job.photo_urls.slice(0, 9) : job.photo_urls,
      after_photo_urls: Array.isArray(job.after_photo_urls) ? job.after_photo_urls.slice(0, 9) : job.after_photo_urls,
    });
    setProofPhase(phase);
    setProofFiles([]);
    setLivenessBlob(null);
    setLivenessLat(null);
    setLivenessLng(null);
    setAfterBurstPackages([]);
    setShowPhantomCapture(false);
    setProofError(null);
    setProofSuccess(null);
    setPlasticKg('0');
    setGlassKg('0');
    setConstructionKg('0');
    setWoodKg('0');
  };

  const closeProofModal = () => {
    if (proofSubmitting) return;
    setProofJob(null);
    setProofFiles([]);
    setLivenessBlob(null);
    setLivenessLat(null);
    setLivenessLng(null);
    setAfterBurstPackages([]);
    setShowPhantomCapture(false);
    setProofError(null);
    setProofSuccess(null);
  };

  const submitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setProofError(null);
    setProofSuccess(null);
    if (!proofJob) return;
    if (proofPhase === 'after' && !enforceMissionStatusCooldown()) return;

    // Store the GPS used for the anti-fraud distance check so we can reuse it
    // (avoids null liveness coordinates from the recorder component timing).
    let antiFraudLat: number | null = null;
    let antiFraudLng: number | null = null;
  if (!proofFiles.length) {
    setProofError('Please upload photos before continuing.');
    return;
  }
  if (proofPhase === 'after' && !livenessBlob) {
    setProofError('Please complete the liveness check before submitting.');
    return;
  }
  if (proofFiles.length > 9) {
    setProofError('Please upload no more than 9 photos.');
    return;
  }

  const toRad = (val: number) => (val * Math.PI) / 180;
  const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  if (
    proofPhase === 'after' &&
    typeof proofJob.location_lat === 'number' &&
    typeof proofJob.location_lng === 'number'
  ) {
    if (!('geolocation' in navigator)) {
      setProofError(t('tooFarFromMission'));
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        }),
      );
      const { latitude, longitude } = position.coords;
        antiFraudLat = latitude;
        antiFraudLng = longitude;
      const d = distanceMeters(
        latitude,
        longitude,
        proofJob.location_lat,
        proofJob.location_lng,
      );
      if (d > 200) {
        setProofError(t('tooFarFromMission'));
        return;
      }
    } catch (err) {
      console.error('Geolocation error:', err);
      setProofError(t('tooFarFromMission'));
      return;
    }
  }

    try {
      setProofSubmitting(true);
      setProofProcessingImage(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('You must be signed in.');

      const uploadedUrls: string[] = [];
      const compressionOptions = {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: 'image/jpeg',
      };
      for (const file of proofFiles.slice(0, 9)) {
        if (!file.type || !file.type.startsWith('image/')) {
          setProofError('Only images are allowed');
          return;
        }
        let fileToUpload: File = file;
        try {
          const compressed = await imageCompression(file, compressionOptions);
          console.log('Proof photo compression:', {
            name: file.name,
            originalMB: (file.size / 1024 / 1024).toFixed(2),
            compressedMB: (compressed.size / 1024 / 1024).toFixed(2),
          });
          fileToUpload = compressed as File;
        } catch (compressErr) {
          console.warn('Compression failed for proof photo:', file.name, compressErr);
          fileToUpload = file;
        }

        const fileExt = 'jpg';
        const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET_ORDER_PHOTOS)
          .upload(safeFileName, fileToUpload, { upsert: false, contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const {
          data: { publicUrl },
        } = supabase.storage.from(STORAGE_BUCKET_ORDER_PHOTOS).getPublicUrl(safeFileName);
        uploadedUrls.push(publicUrl);
      }
      setProofProcessingImage(false);

      if (proofPhase === 'before') {
        const { error: updateErr } = await supabase
          .from('missions')
          .update({
            photo_urls: [...(proofJob.photo_urls || []), ...uploadedUrls].slice(0, 9),
            started_at: new Date().toISOString(),
          })
          .eq('id', proofJob.id);
        if (updateErr) throw updateErr;
        setProofSuccess('Before photos uploaded. Mission started.');
      } else {
        // Capture completion GPS at the exact moment of submission (permanent audit trail)
        let completionLat: number | null = null;
        let completionLng: number | null = null;
        let completionDistanceMeters: number | null = null;
        if (
          typeof proofJob.location_lat === 'number' &&
          typeof proofJob.location_lng === 'number' &&
          'geolocation' in navigator
        ) {
          try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
              }),
            );
            completionLat = position.coords.latitude;
            completionLng = position.coords.longitude;
            completionDistanceMeters = Math.round(
              distanceMeters(
                completionLat,
                completionLng,
                proofJob.location_lat,
                proofJob.location_lng,
              ),
            );
          } catch (e) {
            // Do not block completion if GPS is unavailable; audit trail will remain empty.
            console.warn('Completion GPS capture failed:', e);
          }
        }

        // Fallback to the GPS captured during the anti-fraud distance check.
        if (completionLat == null && antiFraudLat != null) completionLat = antiFraudLat;
        if (completionLng == null && antiFraudLng != null) completionLng = antiFraudLng;
        if (
          completionDistanceMeters == null &&
          completionLat != null &&
          completionLng != null &&
          typeof proofJob.location_lat === 'number' &&
          typeof proofJob.location_lng === 'number'
        ) {
          completionDistanceMeters = Math.round(
            distanceMeters(
              completionLat,
              completionLng,
              proofJob.location_lat,
              proofJob.location_lng
            )
          );
        }
        if ((completionLat == null || completionLng == null) && afterBurstPackages.length > 0) {
          const lastBurst = afterBurstPackages[afterBurstPackages.length - 1];
          if (lastBurst?.lat != null && lastBurst?.lng != null) {
            completionLat = lastBurst.lat;
            completionLng = lastBurst.lng;
            if (
              typeof proofJob.location_lat === 'number' &&
              typeof proofJob.location_lng === 'number'
            ) {
              completionDistanceMeters = Math.round(
                distanceMeters(
                  completionLat,
                  completionLng,
                  proofJob.location_lat,
                  proofJob.location_lng
                )
              );
            }
          }
        }

        // Report submission is non-financial:
        // only upload evidence + move mission to review. Payout is done later via resolve_mission_dispute(approve).
        let proofVideoUrl: string | null = null;
        if (livenessBlob) {
          const isWebm = (livenessMimeType || '').includes('webm');
          const ext = isWebm ? 'webm' : 'mp4';
          const safeVideoName = `liveness_${proofJob.id}_${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
          const { error: videoUploadErr } = await supabase.storage
            .from(STORAGE_BUCKET_LIVENESS_VIDEOS)
            .upload(safeVideoName, livenessBlob, {
              upsert: false,
              contentType: livenessMimeType || 'video/webm',
            });
          if (videoUploadErr) throw videoUploadErr;
          const {
            data: { publicUrl: videoPublicUrl },
          } = supabase.storage.from(STORAGE_BUCKET_LIVENESS_VIDEOS).getPublicUrl(safeVideoName);
          proofVideoUrl = videoPublicUrl;
        }

        const effectiveLivenessLat =
          livenessLat ??
          completionLat ??
          (typeof proofJob.location_lat === 'number' ? proofJob.location_lat : null);
        const effectiveLivenessLng =
          livenessLng ??
          completionLng ??
          (typeof proofJob.location_lng === 'number' ? proofJob.location_lng : null);

        if (effectiveLivenessLat == null || effectiveLivenessLng == null) {
          setProofError('Liveness GPS is required. Please enable location and try again.');
          return;
        }

        const { error: updateErr } = await supabase
          .from('missions')
          .update({
            after_photo_urls: [...(proofJob.after_photo_urls || []), ...uploadedUrls].slice(0, 9),
            status: 'review',
            completion_lat: completionLat,
            completion_lng: completionLng,
            completion_distance_meters: completionDistanceMeters,
            report_submitted_at: new Date().toISOString(),
            proof_video_url: proofVideoUrl,
            liveness_lat: effectiveLivenessLat,
            liveness_lng: effectiveLivenessLng,
          } as any)
          .eq('id', proofJob.id);
        if (updateErr) throw updateErr;

        const plastic = Number.parseFloat(plasticKg || '0') || 0;
        const glass = Number.parseFloat(glassKg || '0') || 0;
        const debris = Number.parseFloat(constructionKg || '0') || 0;
        const wood = Number.parseFloat(woodKg || '0') || 0;
        try {
          const origin =
            typeof window !== 'undefined' && window.location?.origin
              ? window.location.origin
              : '';
          const notifyUrl = origin ? `${origin}/api/notify-mission-submitted` : '/api/notify-mission-submitted';
          const notifyRes = await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              missionId: proofJob.id,
              category: proofJob.category,
              plastic,
              glass,
              debris,
              wood,
            }),
          });
          if (!notifyRes.ok) {
            const errText = await notifyRes.text().catch(() => '');
            console.warn('notify-mission-submitted HTTP', notifyRes.status, errText);
          }
        } catch (notifyErr) {
          console.warn('notify-mission-submitted failed:', notifyErr);
        }

        setProofSuccess('Proof submitted for review. Payment will be released only after approval.');
      }

      await fetchProfileData();
      await fetchMarketplaceJobs();

      setTimeout(() => closeProofModal(), 2500);
    } catch (err: any) {
      console.error('Proof upload error:', err);
      setProofError(err?.message || 'Failed to upload photos. Please try again.');
    } finally {
      setProofProcessingImage(false);
      setProofSubmitting(false);
    }
  };

  const handleConfirmReleasePay = async (job: Job): Promise<boolean> => {
    if (!job.cleaner_id) {
      toast.error('No worker assigned to this job yet.');
      return false;
    }
    if (!window.confirm('Confirm completion and release payment to the worker?')) return false;
    if (releasePaySubmitting) return false;
    try {
      setReleasePaySubmitting(true);
      const { error: rpcErr } = await supabase.rpc('resolve_mission_dispute', {
        p_mission_id: job.id,
        p_decision: 'approve',
        p_supervisor_comment: null,
      });
      if (rpcErr) throw rpcErr;

      await fetchProfileData();
      toast.success('Payment released successfully.');
      return true;
    } catch (err: any) {
      console.error('Release pay error:', err);
      toast.error(err?.message || 'Failed to release payment.');
      return false;
    } finally {
      setReleasePaySubmitting(false);
    }
  };

  if (!isOpen) return null;

  const LegalModal = ({
    title,
    body,
    onClose: close,
  }: {
    title: string;
    body: string;
    onClose: () => void;
  }) => {
    return (
      <div
        className="fixed inset-0 z-[9997] bg-black/70 backdrop-blur-sm"
        onClick={close}
        aria-hidden="false"
      >
        <div
          className="fixed inset-0 z-[9998] flex max-w-[100vw] flex-col overflow-x-hidden bg-slate-950/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-cyan-500/15">
            <button
              type="button"
              onClick={close}
              className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="flex-1 text-left text-sm font-black uppercase tracking-[0.2em] text-white">
              {title}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-10">
            <p className="mt-5 text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">
              {body}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex justify-end pt-[env(safe-area-inset-top)] isolate max-w-[100vw] overflow-x-hidden"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop — above Mapbox canvas; blur reads the map behind */}
      <div
        className="absolute inset-0 z-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sliding drawer — Gemini-style animated border on outer edge */}
      <div
        className="relative z-10 w-full min-w-0 max-w-[min(100vw,32rem)] h-[calc(100dvh-env(safe-area-inset-top))] max-h-[calc(100dvh-env(safe-area-inset-top))] flex flex-col animate-slide-in-right animated-border animated-border-drawer overflow-x-hidden min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animated-border-inner w-full min-h-0 flex-1 flex flex-col max-w-full overflow-x-hidden bg-gradient-to-b from-slate-950 via-[#020617] to-slate-950">
          {/* Header — sticky per .cursorrules; stays visible while content scrolls */}
          <div className="flex-shrink-0 sticky top-0 z-50 flex items-center justify-between px-5 pb-4 pt-[env(safe-area-inset-top)] bg-slate-950/90 backdrop-blur-xl border-b border-gray-800 shadow-lg shadow-black/40">
            <button
              type="button"
              onClick={onClose}
              className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Close"
            >
              ✕
            </button>
            <h1 className="text-lg font-bold text-white">{t('yourAccount')}</h1>
          </div>
          {/* Scrollable content — job cards and forms */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden p-4 flex flex-col gap-4 pb-[max(9rem,env(safe-area-inset-bottom))] max-w-full">
          <div className="w-full max-w-md mx-auto flex flex-col gap-6 min-w-0">
        {showAdmin ? (
          <AdminDashboard onBack={() => setShowAdmin(false)} />
        ) : (
          <>
        {/* HEADER: Avatar + Welcome + Wallet */}
        <header className="mb-8 text-white">
          <div className="flex items-center gap-4">
            <label className="relative inline-flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-emerald-500/40 to-cyan-500/20 border border-white/20 shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer overflow-hidden group">
              {avatarUploading ? (
                <div className="h-6 w-6 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
              ) : userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt={userProfile.full_name || userEmail || 'Avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-black uppercase text-emerald-300">
                  {(userProfile?.full_name || userEmail || 'C')[0]}
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] uppercase tracking-[0.18em] text-emerald-300 font-bold transition-opacity">
                Change
              </div>
            </label>
            <div className="flex-1">
              <p className="text-sm text-slate-400 uppercase tracking-[0.2em]">
                {t('welcome')} {userProfile?.full_name || userEmail || t('coworker')}!
              </p>
              {userEmail && (
                <p className="mt-1 text-[10px] text-slate-500 uppercase tracking-[0.18em]">
                  {userEmail}
                </p>
              )}
              {/* Rating badge */}
              {userProfile?.rating != null ? (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-400/40 px-2.5 py-0.5">
                  <span className="text-[11px] font-bold text-amber-300">
                    {userProfile.rating.toFixed(1)}
                  </span>
                  <span className="text-xs">⭐</span>
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-800/60 border border-slate-600/60 px-2.5 py-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                    New Hero
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Language — compact globe + dropdown */}
          <div className="mt-4 flex justify-end" ref={langMenuRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLangMenuOpen((o) => !o)}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-950/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-200 hover:border-cyan-400/50 hover:bg-cyan-950/60 transition-all"
                aria-expanded={langMenuOpen}
                aria-haspopup="listbox"
              >
                <Globe className="h-4 w-4 text-cyan-400/90" aria-hidden />
                <span>
                  {languageOptions.find((o) => (i18n.language || '').startsWith(o.code))?.short ?? 'EN'}
                </span>
              </button>
              {langMenuOpen && (
                <div
                  className="absolute right-0 top-full z-[100] mt-2 min-w-[11rem] rounded-2xl border border-white/10 bg-[#0a1628]/98 backdrop-blur-xl py-1.5 shadow-2xl shadow-black/50 ring-1 ring-cyan-500/20"
                  role="listbox"
                >
                  {languageOptions.map(({ code, labelKey, short }) => {
                    const active = (i18n.language || '').startsWith(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          void i18n.changeLanguage(code);
                          setLangMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          active
                            ? 'bg-emerald-500/15 text-emerald-200'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span>{t(labelKey)}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {short}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Wallet — glass panel */}
          <div className={`mt-6 p-5 shadow-[0_4px_30px_rgba(6,182,212,0.08)] ${PROFILE_GLASS_PANEL}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                {t('walletBalance')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setPayoutStep('form');
                  setShowPayoutModal(true);
                }}
                className="text-[10px] font-bold uppercase tracking-[0.18em] px-3 py-1 rounded-full border border-white/20 text-slate-200 hover:bg-white/10 transition-all"
              >
                {t('withdraw')}
              </button>
            </div>
            <p className="text-3xl font-black text-orange-400">
              Balance: {formatEgp(Number(balance ?? 0))}
            </p>
            <p className="text-sm text-slate-300 mt-2">
              {t('availableToWithdraw', {
                amount: formatEgpDigits(maxWithdrawableEgp(userProfile)),
              })}
            </p>
            {userProfile?.frozen_balance != null && Number(userProfile.frozen_balance) > 0 && (
              <div className="mt-1.5 space-y-1 max-w-md">
                <p className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200/90">
                  <span>
                    {t('frozenDepositTag', {
                      amount: formatEgpDigits(Number(userProfile.frozen_balance)),
                    })}
                  </span>
                  <span
                    className="inline-flex shrink-0"
                    title={t('frozenDepositInfoTitle')}
                    aria-label={t('frozenDepositInfoTitle')}
                  >
                    <Info className="w-3.5 h-3.5 text-amber-300/90" aria-hidden />
                  </span>
                </p>
                <p className="text-[10px] text-amber-200/75 leading-snug pl-0.5">{t('frozenDepositInfoBody')}</p>
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-500 italic">
              {t('payoutFeeNote')}
            </p>

          {/* Top Up — primary: Stripe card (everyone) */}
            <div className="mt-5 flex flex-col items-center">
              <button
                type="button"
                onClick={() => setShowStripeTopUp(true)}
              className="w-full max-w-sm px-6 py-2 rounded-full border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] text-sm font-black uppercase tracking-[0.2em] transition-all"
              >
              {t('payWithCardStripe')}
              </button>
              <p className="mt-2 text-xs text-center text-gray-400 max-w-sm">
                {t('stripeCommissionNote')}
              </p>
            </div>

            {/* Admin Force Pay — amount input + legacy Top Up (admin only) */}
            {isAdmin && (
              <div className="mt-4 rounded-2xl border-2 border-orange-500/50 bg-orange-500/5 p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400/90">
                  Admin Force Pay
                </p>
                <form onSubmit={handleTopUp}>
                  <div className="flex flex-row items-center gap-3 mt-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="\d*"
                      placeholder={t('amountInUsd')}
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(sanitizeIntegerEgpDigits(e.target.value))}
                      className={`flex-1 min-w-0 ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/60 tabular-nums`}
                    />
                    <button
                      type="submit"
                      disabled={topUpSubmitting}
                      className="shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] border border-cyan-500/40 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    >
                      {topUpSubmitting ? t('adding') : t('topUp')}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* LOGOUT — highly visible */}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full px-6 py-2 rounded-full font-black text-sm uppercase tracking-[0.2em] border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all"
          >
            {t('logout')}
          </button>

          {/* CONTACT INFORMATION */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (contactSubmitting) return;
              setContactSaved(false);
              console.log('Saving contact info...', { contactEmail, phoneNumber, telegramUsername });
              try {
                setContactSubmitting(true);
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user?.id) {
                  console.log('No session user found, aborting contact save.');
                  alert('You must be logged in to save contact info.');
                  return;
                }
                const updates = {
                  contact_email: contactEmail || null,
                  phone_number: phoneNumber || null,
                  telegram_username: telegramUsername || null,
                };
                const { error } = await supabase
                  .from('profiles')
                  .update(updates)
                  .eq('id', session.user.id);
                if (error) {
                  console.error('Contact info update error:', error);
                  alert(error.message || 'Failed to save contact information.');
                  return;
                }
                console.log('Contact info saved successfully.');
                setContactSaved(true);
                setContactEditMode(false);
              } catch (err: any) {
                console.error('Contact info update error (exception):', err);
                alert(err?.message || 'Failed to save contact information.');
              } finally {
                setContactSubmitting(false);
              }
            }}
            className={`mt-4 space-y-3 p-4 ${PROFILE_GLASS_PANEL} !rounded-3xl`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {t('contactInfo')}
            </p>
            <p className="text-[11px] text-slate-500">
              {t('contactInfoHint')}
            </p>
            {contactEditMode ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('email')}
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => {
                      setContactEmail(e.target.value);
                      setContactSaved(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('phoneWhatsApp')}
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setContactSaved(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder="+20 1X XXX XXXX"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('telegramUsername')}
                  </label>
                  <input
                    type="text"
                    value={telegramUsername}
                    onChange={(e) => {
                      setTelegramUsername(e.target.value);
                      setContactSaved(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder="@username"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 flex items-start justify-between gap-3">
                <div className="text-xs text-slate-300 space-y-1">
                  <p>{contactEmail || '—'}</p>
                  <p>{phoneNumber || '—'}</p>
                  <p>{telegramUsername || '—'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setContactEditMode(true)}
                  className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 inline-flex items-center justify-center transition-all active:scale-95"
                  aria-label="Edit contacts"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex justify-end">
              {contactEditMode ? (
                <button
                  type="submit"
                  disabled={contactSubmitting}
                  className={`inline-flex items-center justify-center rounded-full text-[11px] font-black uppercase tracking-[0.18em] transition-all duration-300 ${
                    contactSaved
                      ? 'px-3 py-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                      : 'px-5 py-2 bg-slate-800 text-slate-100 hover:bg-slate-700'
                  } disabled:opacity-60 disabled:cursor-wait active:scale-95`}
                >
                  {contactSubmitting ? 'Processing...' : contactSaved ? (isRu ? 'Контакты ✓' : 'Saved ✓') : t('saveContact')}
                </button>
              ) : (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-300 text-[11px] font-black uppercase tracking-[0.18em]">
                  {isRu ? 'Контакты ✓' : 'Saved ✓'}
                </span>
              )}
            </div>
          </form>

          {/* CHANGE PASSWORD (works for magic-link users who want a password) */}
          <form
            onSubmit={handleChangePassword}
            className={`mt-4 space-y-3 p-4 ${PROFILE_GLASS_PANEL} !rounded-3xl`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              {t('changePassword')}
            </p>
            <p className="text-[11px] text-slate-500">
              {t('changePasswordHint')}
            </p>
            {passwordEditMode ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('newPassword')}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordSaved(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('confirmPassword')}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordSaved(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder="Re-enter password"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-300">{isRu ? 'Пароль сохранен.' : 'Password saved.'}</p>
                <button
                  type="button"
                  onClick={() => setPasswordEditMode(true)}
                  className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 inline-flex items-center justify-center transition-all active:scale-95"
                  aria-label="Edit password"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            )}
            {passwordError && (
              <p className="text-[11px] text-red-400 font-medium">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-[11px] text-emerald-400 font-medium">{passwordSuccess}</p>
            )}
            <div className="flex justify-end">
              {passwordEditMode ? (
                <button
                  type="submit"
                  disabled={passwordSubmitting}
                  className={`inline-flex items-center justify-center rounded-full text-[11px] font-black uppercase tracking-[0.18em] transition-all duration-300 ${
                    passwordSaved
                      ? 'px-3 py-1.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                      : 'px-5 py-2 bg-emerald-500 text-black hover:bg-emerald-400'
                  } disabled:opacity-60 disabled:cursor-wait active:scale-95`}
                >
                  {passwordSubmitting ? 'Processing...' : passwordSaved ? (isRu ? 'Сохранено ✓' : 'Saved ✓') : t('savePassword')}
                </button>
              ) : (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-300 text-[11px] font-black uppercase tracking-[0.18em]">
                  {isRu ? 'Сохранено ✓' : 'Saved ✓'}
                </span>
              )}
            </div>
          </form>

          <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className={`inline-flex min-w-0 flex-wrap gap-2 p-1 ${PROFILE_GLASS_PANEL} !rounded-full`}>
              <button
                type="button"
                onClick={() => setTaskType('city')}
                className={`h-12 px-4 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all active:scale-95 ${
                  taskType === 'city'
                    ? 'bg-[#22c55e] text-black'
                    : 'bg-transparent text-slate-400 hover:text-[#22c55e]'
                }`}
              >
                City Cleaning
              </button>
              <button
                type="button"
                onClick={() => setTaskType('home')}
                className={`h-12 px-4 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all active:scale-95 ${
                  taskType === 'home'
                    ? 'bg-[#f59e0b] text-black'
                    : 'bg-transparent text-slate-400 hover:text-[#f59e0b]'
                }`}
              >
                Home Cleaning
              </button>
            </div>
          </div>

          <form
            onSubmit={handleCreateTask}
            className={`mb-10 p-5 space-y-4 shadow-[0_4px_30px_rgba(6,182,212,0.08)] ${PROFILE_GLASS_PANEL}`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Task type
                </label>
                <p className="text-sm text-slate-200 font-medium">
                  {taskType === 'city' ? 'City Cleaning Donation' : 'Home Cleaning Service'}
                </p>
              </div>
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
                  placeholder={taskType === 'city' ? (isRu ? 'Цель сбора (Предполагаемая стоимость)' : 'Collection Target (Goal)') : t('anyAmount')}
                  className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 tabular-nums`}
                />
                {taskType === 'city' && (
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {isRu
                      ? `Создание городской метки стоит ${formatEgp(MISSION_STAKE_FEE_EUR)}. Цель — ваш краудфандинговый сбор.`
                      : `Creating a public pin costs ${formatEgp(MISSION_STAKE_FEE_EUR)}. The target is just your crowdfunding goal.`}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Location
                </label>
                <div className={`flex items-center gap-2 ${PROFILE_GLASS_PANEL} px-3 py-2.5`}>
                  <span className="text-slate-400 text-sm">📍</span>
                  <input
                    type="text"
                    value={orderLocation}
                    onChange={(e) => setOrderLocation(e.target.value)}
                    placeholder="City / Area (map pin coming next)"
                    className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Upload photo
                </label>
                <label className="flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
                  {orderPhoto ? 'Photo selected' : 'Tap to add reference photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setOrderPhoto(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                Short description & area
              </label>
              <textarea
                value={orderDescription}
                onChange={(e) => setOrderDescription(e.target.value)}
                rows={3}
                placeholder={
                  taskType === 'city'
                    ? 'Describe the city spot you want to clean up...'
                    : 'Describe your home cleaning task and area size...'
                }
                className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none`}
              />
            </div>

            {orderError && (
              <p className="text-xs text-red-400 font-medium">{orderError}</p>
            )}
            {orderSuccess && (
              <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
            )}

            <div className={`w-full mt-1 rounded-full ${taskType === 'city' ? 'animated-border-city' : 'animated-border-home'} ${orderSubmitting ? 'opacity-60' : ''}`}>
              <button
                type="submit"
                disabled={orderSubmitting}
                className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all text-white bg-[#020617] hover:brightness-110 disabled:cursor-wait active:scale-[0.98]"
              >
                {orderSubmitting ? t('processing') : t('submitTaskAndPay')}
              </button>
            </div>
          </form>
        </header>

        {/* MY HOME REQUESTS (from jobs table, excluding finished) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
            🏠 My Home Requests
          </h2>
          <div className="space-y-4">
            {loading ? (
              <div className="space-y-4">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className={`${PROFILE_GLASS_PANEL} p-4 animate-pulse`}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="h-4 w-16 bg-slate-700 rounded-full" />
                      <div className="h-3 w-20 bg-slate-700 rounded-full" />
                    </div>
                    <div className="h-3 w-32 bg-slate-700 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (myHomeJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
              <p className="text-slate-500 text-sm italic">You haven't created any home requests yet.</p>
            ) : (
              (myHomeJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                const isPhantomPayment = job.status === 'pending_payment';
                if (isPhantomPayment) {
                  const busy = phantomPaymentActionId === job.id;
                  return (
                    <div
                      key={job.id}
                      className={`${PROFILE_GLASS_PANEL} p-4 opacity-70 border border-dashed border-red-500/40`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="mb-3">
                        <div className="inline-block bg-red-500/20 text-red-400 border border-red-500/50 rounded px-2 py-1 text-xs">
                          {t('paymentPendingBadge')}
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 mb-3">
                        <span className="text-amber-400 font-bold">{formatEgp(Number(job.amount_target))}</span>
                        {job.description && (
                          <span className="ml-2 text-slate-400">— {job.description}</span>
                        )}
                      </p>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <div className="flex flex-col gap-1 min-w-0">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => retryPendingPaymentMission(job)}
                              className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {t('retryPayment')}
                            </button>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => cancelPendingPaymentMission(job, 'home')}
                            className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed self-start"
                          >
                            {t('cancelMission')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={job.id} className={`${PROFILE_GLASS_PANEL} p-4`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                        job.status === 'in_progress' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                        (job.status === 'completed' || job.status === 'finished') ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                        job.status === 'disputed' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                        'bg-white/10 text-slate-400 border border-white/10'
                      }`}>
                        {job.status === 'completed' || job.status === 'finished' ? 'COMPLETED' : job.status}
                      </span>
                      <div className="flex items-center gap-2">
                        {job.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteJob(job.id)}
                            className="text-[10px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-300 mb-1">
                      <span className="text-amber-400 font-bold">{formatEgp(Number(job.amount_target))}</span>
                      {job.description && (
                        <span className="ml-2 text-slate-400">— {job.description}</span>
                      )}
                    </p>

                    {job.status === 'disputed' && (
                      <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
                        <p className="text-red-300 text-sm font-medium mb-2">{t('missionInDispute')}</p>
                        <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-emerald-400 font-bold underline hover:text-emerald-300">
                          @CleanMontenegro_Support
                        </a>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length > 0 && (
                      <div className={`mt-4 p-4 ${PROFILE_GLASS_PANEL}`}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                          {t('bids')}
                        </p>
                        <div className="space-y-2">
                          {bids.map((bid) => (
                            <div
                              key={bid.id}
                              className={`flex items-center justify-between gap-3 py-2 px-3 ${PROFILE_GLASS_PANEL} !rounded-xl`}
                            >
                              <span className="text-sm font-black text-amber-400">{formatEgp(Number(bid.bid_amount))}</span>
                              <div className="rounded-full animated-border-home">
                                <button
                                  type="button"
                                  onClick={() => handleAcceptBid(job, bid)}
                                  disabled={(() => {
                                    const target = Number(job.amount_target ?? bid.bid_amount ?? 0);
                                    const wallet = Number(bid.worker_wallet_balance ?? 0);
                                    const frozen = Number(bid.worker_frozen_balance ?? 0);
                                    return !workerCanSecureMissionDeposit(wallet, frozen, job.category, target).ok;
                                  })()}
                                  className="animated-border-inner w-full rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Accept bid
                                </button>
                                {(() => {
                                  const target = Number(job.amount_target ?? bid.bid_amount ?? 0);
                                  const wallet = Number(bid.worker_wallet_balance ?? 0);
                                  const frozen = Number(bid.worker_frozen_balance ?? 0);
                                  const sec = workerCanSecureMissionDeposit(wallet, frozen, job.category, target);
                                  if (!isSecurityDepositFailure(sec)) return null;
                                  return (
                                    <p className="mt-2 text-[10px] text-amber-300">
                                      {sec.reason === 'frozen_exceeds_wallet'
                                        ? t('walletFrozenInvariantError')
                                        : t('insufficientSecurityDepositFunds')}
                                    </p>
                                  );
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length === 0 && (
                      <p className="text-slate-500 text-xs italic mt-2">No bids yet. Workers can bid from the map.</p>
                    )}

                    {job.status !== 'completed' && job.status !== 'finished' && (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => openNavigate(job)}
                          className={`w-full ${PROFILE_GLASS_PANEL} !rounded-full border border-emerald-500/50 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-300 transition-all hover:border-emerald-400/70 hover:text-emerald-200 active:scale-95`}
                        >
                          Navigate
                        </button>
                        {!(job.status === 'review' && job.started_at) && (
                          <button
                            type="button"
                            onClick={() => openProofModal(job, job.started_at ? 'after' : 'before')}
                            disabled={job.status !== 'in_progress'}
                            className={`w-full py-3 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 ${
                              job.status === 'in_progress'
                                ? 'bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_24px_rgba(251,191,36,0.6)] hover:brightness-110'
                                : 'bg-white/5 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {job.started_at ? "Upload 'After' photos & Finish" : "Upload 'Before' photos & Start"}
                          </button>
                        )}
                      </div>
                    )}

                    {job.status === 'review' && (
                      <p className="mt-3 text-[10px] text-amber-300 uppercase tracking-wider text-center font-bold">
                        WAITING FOR ADMIN VERIFICATION
                      </p>
                    )}

                    {/* Client actions */}
                    {(job.status === 'review' || job.status === 'pending_approval') && job.cleaner_id && (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => setReviewJob(job)}
                          disabled={releasePaySubmitting}
                          className={CLIENT_APPROVE_RELEASE_BTN_LIST}
                        >
                          Review & Release Pay
                        </button>
                        <p className="mt-2 text-[10px] text-emerald-200/90 text-center font-bold">
                          {t('releaseWorkerReceives', {
                            amount: formatEgp(
                              workerPayoutFromFundingEgp(
                                Number(job.current_funding ?? job.amount_target ?? 0),
                              ),
                            ),
                          })}
                        </p>
                        <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                          Worker submitted completion photos. Review before confirming or disputing.
                        </p>
                      </div>
                    )}
                    {(job.status === 'completed' || job.status === 'finished') && job.cleaner_id && (
                      <div className="mt-4">
                        <p className="w-full py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs uppercase tracking-[0.2em] text-center">
                          MISSION ACCOMPLISHED & PAID
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* MY ACTIVE MISSIONS (from missions where cleaner_id = me, excluding finished) */}
        <ProfileAccordion
          title={t('myActiveMissions')}
          icon={<Target className="w-5 h-5 shrink-0 text-amber-400/90" aria-hidden />}
        >
          {(myActiveJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
            <p className="text-slate-500 text-sm italic">You haven't taken any missions yet. Pick one from the marketplace and pay the deposit.</p>
          ) : (
            <div className="space-y-4">
              {(myActiveJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                const isHome = job.category === 'home';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome ? 'bg-amber-400/10 text-amber-300 border-amber-500/30' : 'bg-emerald-400/10 text-emerald-300 border-emerald-500/30';
                const statusPill =
                  job.status === 'in_progress'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : job.status === 'review'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : (job.status === 'completed' || job.status === 'finished')
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-white/10 text-slate-400 border border-white/10';
                return (
                  <div
                    key={job.id}
                    className={`${PROFILE_GLASS_PANEL} p-4`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3 ${statusPill}`}>
                      {job.status === 'in_progress'
                        ? '🟢 In Progress'
                        : job.status === 'review'
                          ? 'UNDER REVIEW'
                          : (job.status === 'completed' || job.status === 'finished')
                            ? '🟢 Completed'
                            : job.status.toUpperCase()}
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                            {job.category.toUpperCase()} Mission
                          </p>
                          <p className={`text-xl font-black mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>{formatEgp(Number(job.amount_target))}</p>
                        </div>
                      </div>
                      {job.started_at && (
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">Time Elapsed</p>
                          <JobTimer startedAt={job.started_at} />
                        </div>
                      )}
                    </div>
                    {job.description && (
                      <p className="text-xs text-slate-400 mt-2">{job.description}</p>
                    )}

                    {job.status !== 'completed' && job.status !== 'finished' && (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => openNavigate(job)}
                          className={`w-full ${PROFILE_GLASS_PANEL} !rounded-full border border-emerald-500/50 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-emerald-300 transition-all hover:border-emerald-400/70 hover:text-emerald-200 active:scale-95`}
                        >
                          Navigate
                        </button>
                        {!(job.status === 'review' && job.started_at) && (
                          <button
                            type="button"
                            onClick={() => openProofModal(job, job.started_at ? 'after' : 'before')}
                            disabled={job.status !== 'in_progress'}
                            className={`w-full py-3 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 ${
                              job.status === 'in_progress'
                                ? 'bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_24px_rgba(251,191,36,0.6)] hover:brightness-110'
                                : 'bg-white/5 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {job.started_at ? "Upload 'After' photos & Finish" : "Upload 'Before' photos & Start"}
                          </button>
                        )}
                      </div>
                    )}

                    {job.status === 'review' && (
                      <p className="mt-3 text-[10px] text-amber-300 uppercase tracking-wider text-center font-bold">
                        WAITING FOR ADMIN VERIFICATION
                      </p>
                    )}
                    {(job.status === 'completed' || job.status === 'finished') && (
                      <div className="mt-4">
                        <p className="w-full py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs uppercase tracking-[0.2em] text-center">
                          MISSION ACCOMPLISHED & PAID
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ProfileAccordion>

        {/* MY CITY DONATIONS (from missions table, excluding finished) */}
        <ProfileAccordion
          title={t('cityDonations')}
          icon={<Building2 className="w-5 h-5 shrink-0 text-amber-400/90" aria-hidden />}
        >
          <div className="space-y-4">
            {loading ? (
              <p className="text-slate-500 text-sm italic">Loading city donations...</p>
            ) : (myCityJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
              <p className="text-slate-500 text-sm italic">You have no city donations yet.</p>
            ) : (
              (myCityJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                  const displayTitle = (job.title && job.title.trim().length > 0)
                    ? job.title
                    : 'City Donation';
                  const isPhantomPayment = job.status === 'pending_payment';
                  if (isPhantomPayment) {
                    const busy = phantomPaymentActionId === job.id;
                    return (
                      <div
                        key={job.id}
                        className={`${PROFILE_GLASS_PANEL} p-4 opacity-70 border border-dashed border-red-500/40`}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                          <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="mb-3">
                          <div className="inline-block bg-red-500/20 text-red-400 border border-red-500/50 rounded px-2 py-1 text-xs">
                            {t('paymentPendingBadge')}
                          </div>
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                          {displayTitle}
                        </p>
                        <p className="text-sm font-bold text-emerald-400 mb-3">
                          {formatEgp(Number(job.amount_target))}
                        </p>
                        {job.description && (
                          <p className="text-xs text-slate-400 mb-3">{job.description}</p>
                        )}
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            <div className="flex flex-col gap-1 min-w-0">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => retryPendingPaymentMission(job)}
                                className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {t('retryPayment')}
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => cancelPendingPaymentMission(job, 'city')}
                              className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed self-start"
                            >
                              {t('cancelMission')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const hasCoords =
                    typeof job.location_lat === 'number' && typeof job.location_lng === 'number';
                  return (
                    <div key={job.id} className={`${PROFILE_GLASS_PANEL} p-4`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex-1">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                            {displayTitle}
                          </p>
                          <p className="text-sm font-bold text-emerald-400 mb-1">
                            {formatEgp(Number(job.amount_target))}
                          </p>
                        </div>
                        {/* VIEW ON MAP */}
                        {hasCoords && onNavigateToJob && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400 hover:text-emerald-300"
                          >
                            <span>View on map</span>
                            <span>↗</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-400">
                        Your donation on the map. Workers can pick it up in the marketplace.
                      </p>

                  {(() => {
                    const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                    if (job.status !== 'pending') return null;
                    return (
                      <div className="mt-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          Active bids: <span className="text-emerald-400">{bids.length}</span>
                        </p>
                        {bids.length > 0 ? (
                          <div className="space-y-2">
                            {bids.map((bid) => (
                              <div
                                key={bid.id}
                                className={`flex items-center justify-between gap-3 py-2 px-3 ${PROFILE_GLASS_PANEL} !rounded-xl`}
                              >
                                <span className="text-sm font-black text-emerald-400">{formatEgp(Number(bid.bid_amount))}</span>
                                <div className="rounded-full animated-border-city">
                                  <button
                                    type="button"
                                    onClick={() => handleAcceptBid(job, bid)}
                                    disabled={(() => {
                                      const target = Number(job.amount_target ?? bid.bid_amount ?? 0);
                                      const wallet = Number(bid.worker_wallet_balance ?? 0);
                                      const frozen = Number(bid.worker_frozen_balance ?? 0);
                                      return !workerCanSecureMissionDeposit(wallet, frozen, job.category, target).ok;
                                    })()}
                                    className="animated-border-inner w-full rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    Accept bid
                                  </button>
                                  {(() => {
                                    const target = Number(job.amount_target ?? bid.bid_amount ?? 0);
                                    const wallet = Number(bid.worker_wallet_balance ?? 0);
                                    const frozen = Number(bid.worker_frozen_balance ?? 0);
                                    const sec = workerCanSecureMissionDeposit(wallet, frozen, job.category, target);
                                    if (!isSecurityDepositFailure(sec)) return null;
                                    return (
                                      <p className="mt-2 text-[10px] text-amber-300">
                                        {sec.reason === 'frozen_exceeds_wallet'
                                          ? t('walletFrozenInvariantError')
                                          : t('insufficientSecurityDepositFunds')}
                                      </p>
                                    );
                                  })()}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 text-xs italic">No bids yet.</p>
                        )}
                      </div>
                    );
                  })()}

                      {job.status === 'review' && job.cleaner_id && (
                        <div className="mt-4">
                          <p className="w-full py-3 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-black text-xs uppercase tracking-[0.2em] text-center">
                            PENDING REVIEW
                          </p>
                          <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            WAITING FOR ADMIN VERIFICATION
                          </p>
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            disabled={releasePaySubmitting}
                            className={`mt-3 ${CLIENT_APPROVE_RELEASE_BTN_LIST}`}
                          >
                            Review & Release Payment
                          </button>
                          <p className="mt-2 text-[10px] text-emerald-200/90 text-center font-bold">
                            {t('releaseWorkerReceives', {
                              amount: formatEgp(
                                workerPayoutFromFundingEgp(
                                  Number(job.current_funding ?? job.amount_target ?? 0),
                                ),
                              ),
                            })}
                          </p>
                        </div>
                      )}
                      {job.status === 'pending_approval' && job.cleaner_id && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            disabled={releasePaySubmitting}
                            className={CLIENT_APPROVE_RELEASE_BTN_LIST}
                          >
                            Review & Release Pay
                          </button>
                          <p className="mt-2 text-[10px] text-emerald-200/90 text-center font-bold">
                            {t('releaseWorkerReceives', {
                              amount: formatEgp(
                                workerPayoutFromFundingEgp(
                                  Number(job.current_funding ?? job.amount_target ?? 0),
                                ),
                              ),
                            })}
                          </p>
                          <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            Worker marked job completed. Review before confirming or disputing.
                          </p>
                        </div>
                      )}
                      {(job.status === 'completed' || job.status === 'finished') && job.cleaner_id && (
                        <div className="mt-4">
                          <p className="w-full py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs uppercase tracking-[0.2em] text-center">
                            MISSION ACCOMPLISHED & PAID
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </ProfileAccordion>

        {/* GLOBAL MARKETPLACE */}
        <ProfileAccordion
          title={t('globalMarketplace')}
          icon={<Globe className="w-5 h-5 shrink-0 text-emerald-400/90" aria-hidden />}
          defaultOpen
        >
          <div className="text-white pointer-events-auto relative z-10 min-w-0">
          {paymentSyncing && (
            <p className="text-[11px] font-bold text-emerald-400 mb-3 animate-pulse">
              🔄 Verifying your payment...
            </p>
          )}

          <div className="mb-4 flex flex-wrap gap-3">
            <label className="flex min-w-[140px] flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {t('selectRegion')}
              </span>
              <select
                value={marketRegion}
                onChange={(e) => setMarketRegion(e.target.value)}
                className={`w-full min-w-0 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 ${PROFILE_GLASS_PANEL} !rounded-xl`}
              >
                <option value={MARKETPLACE_REGION_MONTENEGRO}>{t('regionEgypt')}</option>
              </select>
            </label>
            <label className="flex min-w-[140px] flex-1 flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {t('selectCity')}
              </span>
              <select
                value={marketCityId}
                onChange={(e) => setMarketCityId(e.target.value)}
                className={`w-full min-w-0 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 ${PROFILE_GLASS_PANEL} !rounded-xl`}
              >
                <option value="">{t('selectCityPlaceholder')}</option>
                {MONTENEGRO_MARKETPLACE_CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {marketLoading && (
            <div className="grid grid-cols-1 gap-4 mb-2">
              {[1, 2, 3].map((skeleton) => (
                <div
                  key={skeleton}
                  className={`${PROFILE_GLASS_PANEL} p-4 animate-pulse`}
                >
                  <div className="h-3 w-24 bg-slate-700 rounded-full mb-3" />
                  <div className="h-6 w-32 bg-slate-600 rounded-full mb-4" />
                  <div className="h-3 w-20 bg-slate-700 rounded-full ml-auto" />
                </div>
              ))}
            </div>
          )}

          {marketError && !marketLoading && (
            <p className="text-sm text-red-400 mb-4">{marketError}</p>
          )}

          {!marketLoading && !marketError && !marketCityId && (
            <p className="text-sm text-slate-400 italic">{t('selectCityToExplore')}</p>
          )}

          {!marketLoading && !marketError && marketCityId && filteredMarketplaceJobs.length === 0 && (
            <p className="text-sm text-slate-500 italic">{t('noMissionsInCity')}</p>
          )}

          {!marketLoading && !marketError && marketCityId && filteredMarketplaceJobs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 pointer-events-auto">
              {filteredMarketplaceJobs.map((job) => {
                  const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const badgeColor = isHome
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

                  return (
                  <div
                    key={job.id}
                    className="group w-full text-left transition-all relative z-10"
                  >
                    <div className={`relative z-10 ${PROFILE_GLASS_PANEL} p-4 overflow-hidden transition-all duration-200 ${isHome ? 'group-hover:border-amber-500/50' : 'group-hover:border-emerald-500/50'}`}>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" aria-hidden>
                        <div className={`absolute -inset-32 ${isHome ? 'bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_60%)]' : 'bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.12),_transparent_60%)]'}`} />
                      </div>

                      <div className="relative z-10 flex justify-between items-center gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center ${PROFILE_GLASS_PANEL} text-xl transition-transform duration-200 group-hover:scale-105`}>
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {job.category.toUpperCase()} Mission
                            </p>
                            <p
                              className={`text-2xl font-black tracking-tight mt-1 ${
                                isHome ? 'text-amber-400' : 'text-emerald-400'
                              }`}
                            >
                              {isHome
                                ? formatEgp(Number(job.amount_target))
                                : formatEgp(Number(job.current_funding || 0))}
                            </p>
                            {!isHome && (
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {t('target')}: {formatEgp(Number(job.amount_target))}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (onNavigateToJob && typeof job.location_lat === 'number' && typeof job.location_lng === 'number') {
                              onNavigateToJob(job.location_lat, job.location_lng);
                            }
                            onClose();
                          }}
                          className="relative z-10 inline-flex items-center justify-center rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300 border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 hover:text-cyan-200 hover:shadow-[0_0_14px_rgba(34,211,238,0.35)] transition-all active:scale-95"
                        >
                          {t('locateOnMap')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </ProfileAccordion>

        {/* HISTORY: cleaning + mission */}
        {userProfile && (
          <ProfileAccordion
            title={t('history')}
            icon={<Clock className="w-5 h-5 shrink-0 text-slate-300/90" aria-hidden />}
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-400">
              📜 {t('myCleaningHistory')}
            </h3>
            <div className="space-y-4">
              {(() => {
                const uid = userProfile.id;
                const finishedJobs: Job[] = [
                  ...(myHomeJobs || []),
                  ...(myCityJobs || []),
                  ...(myActiveJobs || []),
                ].filter(
                  (job, idx, arr) =>
                    job.status === 'finished' &&
                    (job.creator_id === uid || job.cleaner_id === uid) &&
                    arr.findIndex((j) => j.id === job.id) === idx
                );

                if (finishedJobs.length === 0) {
                  return (
                    <p className="text-slate-500 text-sm italic">
                      {t('noFinishedJobsYet')}
                    </p>
                  );
                }

                return finishedJobs.map((job) => {
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? t('creator') : t('cleaner');
                const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const createdDate = new Date(job.created_at).toLocaleDateString();
                  return (
                    <div
                      key={job.id}
                      className={`${PROFILE_GLASS_PANEL} p-4 opacity-90`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-600 font-mono">
                          #{shortId(job.id)}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {createdDate}
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/40 text-slate-200 text-[10px] font-bold uppercase tracking-wider mb-3 border border-slate-500/60">
                        {t('finished')}
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl opacity-90">{icon}</span>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${isHome ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/30 text-emerald-400'}`}>
                              {job.category.toUpperCase()} Mission
                            </p>
                            <p className={`text-xl font-black mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {formatEgp(Number(job.amount_target))}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                            {t('role')}
                          </p>
                          <p className="text-xs font-bold text-slate-200">
                            {roleLabel}
                          </p>
                        </div>
                      </div>
                      {job.description && (
                        <p className="text-xs text-slate-400 mt-1">{job.description}</p>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            <h3 className="mb-3 mt-8 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-300">
              🏆 {t('missionHistory')}
            </h3>
            {loading ? (
              <p className="text-slate-500 text-sm italic">{t('loadingMissionHistory')}...</p>
            ) : (missionHistory || []).length === 0 ? (
              <p className="text-slate-500 text-sm italic">{t('noCompletedMissionsYet')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {(missionHistory || []).map((job) => {
                  const uid = userProfile.id;
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? t('creator') : t('cleaner');
                  const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const badgeColor = isHome
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                  const displayTitle =
                    job.title && job.title.trim().length > 0
                      ? job.title
                      : isHome
                        ? t('homeMission')
                        : t('cityMission');
                  const cleanerName = job.cleaner?.full_name || t('newHero');
                  const cleanerHandle = job.cleaner?.telegram_username
                    ? `(@${job.cleaner.telegram_username})`
                    : '';
                  return (
                    <div
                      key={job.id}
                      className={`${PROFILE_GLASS_PANEL} p-4 shadow-[0_0_20px_rgba(15,23,42,0.8)]`}
                    >
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center ${PROFILE_GLASS_PANEL} text-xl`}>
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {displayTitle}
                            </p>
                            <p className={`text-2xl font-black tracking-tight mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {formatEgp(Number(job.amount_target))}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">{t('role')}</p>
                          <p className="text-xs font-bold text-slate-200">{roleLabel}</p>
                        </div>
                      </div>

                      {typeof job.rating === 'number' && !Number.isNaN(job.rating) && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-800/70 border border-amber-400/30 px-2 py-0.5">
                          <span className="text-[10px] font-bold text-amber-300">
                            {job.rating.toFixed(1)}
                          </span>
                          <span className="text-xs">⭐</span>
                        </div>
                      )}

                      {job.description && (
                        <p className="text-xs text-slate-400 mt-3">{job.description}</p>
                      )}

                      {/* Cleaner info (no phone/WhatsApp for privacy) */}
                      {job.cleaner_id && (
                        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                          <p className="uppercase tracking-[0.18em] text-slate-500">
                            Cleaner
                          </p>
                          <p className="text-right">
                            <span className="font-semibold text-slate-200">{cleanerName}</span>{' '}
                            <span className="text-slate-400">{cleanerHandle}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ProfileAccordion>
        )}

        {/* Admin Panel button — only for admin */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdmin(true)}
            className="w-full px-6 py-2 rounded-full border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] font-black text-sm uppercase tracking-[0.2em] transition-all"
          >
            👑 Admin Panel
          </button>
        )}

        {/* Legal footer (Stripe compliance) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-cyan-500/50">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowTerms(true);
            }}
            className="hover:text-orange-400 transition-colors"
          >
            {t('termsOfService')}
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowRefunds(true);
            }}
            className="hover:text-orange-400 transition-colors"
          >
            {t('refundPolicy')}
          </a>
          <a
            href="mailto:support@cleanmontenegro.co"
            className="hover:text-orange-400 transition-colors"
          >
            {t('contactSupport')}
          </a>
        </div>

          </>
        )}
          </div>
        </div>
        </div>
        </div>

      {/* Portal — floating back to map; layered above map and form content */}
      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[400] flex h-[3.75rem] w-[3.75rem] -translate-x-1/2 items-center justify-center rounded-full border border-orange-400/45 bg-white/10 shadow-[0_0_28px_rgba(249,115,22,0.75),0_0_56px_rgba(234,88,12,0.35)] backdrop-blur-md transition-all hover:bg-white/15 active:scale-95"
        aria-label={t('closeBackToMap')}
        title={t('closeBackToMap')}
      >
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-orange-500/30 via-transparent to-amber-400/25 blur-md"
          aria-hidden
        />
        <Target className="relative h-7 w-7 text-orange-100/95 drop-shadow-[0_0_12px_rgba(251,146,60,0.85)]" aria-hidden />
      </button>

      {showTerms && (
        <LegalModal
          title="Terms of Service"
          body="CleanMontenegro operates strictly as a software-as-a-service (SaaS) digital marketplace. We provide a platform connecting end-users who wish to fund location cleanups with independent local contractors (Cleaners). We are not a charity or a donation fund. Users top-up their digital wallets to create task bounties. We charge a platform fee for facilitating these digital connections, providing GPS tracking, and verifying photo evidence. All Cleaners act as independent entities."
          onClose={() => setShowTerms(false)}
        />
      )}

      {showRefunds && (
        <LegalModal
          title="Refund Policy"
          body="User funds topped up via Stripe are credited to a digital wallet. Funds placed on active missions are held securely in escrow (frozen balance). If a user cancels a mission BEFORE a Cleaner accepts it, 100% of the bounty is returned to the user's wallet. Users can request a payout of their unused wallet balance at any time by contacting support. Once a Cleaner successfully completes a mission and provides verified photo evidence, the transaction is final and non-refundable. In case of disputes, our administration reviews GPS and photo data to arbitrate fairly."
          onClose={() => setShowRefunds(false)}
        />
      )}

      {/* Verification required modal */}
      {showVerificationPrompt && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => setShowVerificationPrompt(false)}
        >
          <div
            className="relative z-[9999] w-full max-w-md rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-bold text-lg mb-2">Verification Required</p>
            <p className="text-slate-400 text-sm mb-6">
              {userProfile?.verification_status === 'pending'
                ? t('verificationPromptReview')
                : t('verificationPromptOnlyVerified')}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowVerificationPrompt(false)}
                className="flex-1 py-3 rounded-full border border-white/20 text-slate-400 hover:text-white font-bold text-sm transition-colors"
              >
                {t('close')}
              </button>
              {userProfile?.verification_status !== 'pending' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowVerificationPrompt(false);
                    navigate('/verify');
                  }}
                  className="flex-1 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-colors"
                >
                  {t('verifyNow')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 py-3 rounded-full bg-white/10 text-slate-500 font-black text-sm cursor-not-allowed"
                >
                  {t('documentsPending')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payout request modal */}
      {showPayoutModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => {
            setPayoutStep('form');
            setShowPayoutModal(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#020617]/95 border border-white/10 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  {payoutStep === 'confirm' ? t('withdrawalConfirmTitle') : t('requestPayoutTitle')}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {payoutStep === 'confirm'
                    ? t('withdrawalConfirmSubtitle')
                    : t('requestPayoutSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPayoutStep('form');
                  setShowPayoutModal(false);
                }}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {payoutStep === 'form' ? (
              <form onSubmit={handlePayoutFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {t('amountInUsd')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="\d*"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(sanitizeIntegerEgpDigits(e.target.value))}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500 tabular-nums`}
                    placeholder="Enter amount to withdraw"
                  />
                  {userProfile && (
                    <div className="mt-1 space-y-1.5 text-[11px] text-slate-400">
                      <p>
                        {t('availableToWithdraw', {
                          amount: formatEgpDigits(maxWithdrawableEgp(userProfile)),
                        })}
                      </p>
                      {Number(userProfile.frozen_balance ?? 0) > 0 && (
                        <div className="space-y-1 text-amber-200/80">
                          <p className="inline-flex items-center gap-1.5 flex-wrap">
                            <span>
                              {t('frozenDepositTag', {
                                amount: formatEgpDigits(Number(userProfile.frozen_balance)),
                              })}
                            </span>
                            <span
                              className="inline-flex shrink-0"
                              title={t('frozenDepositInfoTitle')}
                              aria-label={t('frozenDepositInfoTitle')}
                            >
                              <Info className="w-3.5 h-3.5 text-amber-300/90" aria-hidden />
                            </span>
                          </p>
                          <p className="text-[10px] text-amber-200/70 leading-snug">{t('frozenDepositInfoBody')}</p>
                        </div>
                      )}
                      <p className="text-slate-500 italic">{t('payoutFeeNote')}</p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['InstaPay', 'Vodafone Cash', 'Card'] as const).map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPayoutMethod(method)}
                        className={`px-2 py-2 text-[11px] font-bold uppercase tracking-[0.16em] ${
                          payoutMethod === method
                            ? 'rounded-2xl bg-emerald-500 text-black'
                            : `${PROFILE_GLASS_PANEL} !rounded-2xl text-slate-300 hover:bg-white/10`
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                    Payment Details
                  </label>
                  <input
                    type="text"
                    value={payoutDetails}
                    onChange={(e) => setPayoutDetails(e.target.value)}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                    placeholder={
                      payoutMethod === 'InstaPay'
                        ? 'InstaPay ID or link'
                        : payoutMethod === 'Vodafone Cash'
                          ? 'Vodafone Cash number'
                          : 'Card / bank details'
                    }
                  />
                </div>

                <button
                  type="submit"
                  disabled={payoutSubmitting}
                  className="w-full mt-2 rounded-full bg-emerald-500 text-black text-[11px] font-black uppercase tracking-[0.2em] py-3 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait transition-all"
                >
                  {t('continueToConfirmWithdrawal')}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const b = computeWithdrawalExitBreakdown(floorEgp(parseIntegerEgpFromInput(payoutAmount)));
                  return (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-4 space-y-2">
                      <div className="text-sm text-slate-200 leading-relaxed space-y-1.5">
                        <p className="font-semibold">
                          {t('withdrawalLineGross', { amount: formatEgpDigits(b.gross) })}
                        </p>
                        <p className="text-amber-200/90">
                          {t('withdrawalLineFee', { fee: formatEgpDigits(b.fee) })}
                        </p>
                        <p className="text-emerald-300 font-bold">
                          {t('withdrawalLineNet', { net: formatEgpDigits(b.net) })}
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {payoutMethod} • {payoutDetails.trim()}
                      </p>
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutStep('form')}
                    disabled={payoutSubmitting}
                    className="flex-1 rounded-full border border-white/20 text-slate-300 py-3 text-[11px] font-black uppercase tracking-[0.2em] hover:bg-white/5 disabled:opacity-60"
                  >
                    {t('withdrawalBackToEdit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmWithdrawal()}
                    disabled={payoutSubmitting}
                    className="flex-1 rounded-full bg-emerald-500 text-black py-3 text-[11px] font-black uppercase tracking-[0.2em] hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait"
                  >
                    {payoutSubmitting ? t('processing') : t('confirmWithdrawal')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stripe Top Up modal */}
      {showStripeTopUp && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setShowStripeTopUp(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <StripeTopUp
              onClose={() => setShowStripeTopUp(false)}
              userId={_session?.user?.id ?? null}
            />
          </div>
        </div>
      )}

      {toastState && (
        <div className="fixed top-5 right-5 z-[10001]">
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-bold shadow-xl border ${
              toastState.kind === 'success'
                ? 'bg-emerald-500/95 text-black border-emerald-300/60'
                : 'bg-red-500/95 text-white border-red-300/60'
            }`}
          >
            {toastState.message}
          </div>
        </div>
      )}

      {/* Client review modal: compare before/after & confirm or dispute */}
      {reviewJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setReviewJob(null)}
        >
          <div
            className="w-[95vw] md:w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — fixed at top */}
            <div className="flex-shrink-0 flex justify-between items-start p-6 pb-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-1">
                  Review proof of work
                </p>
                <h3 className="text-xl font-black text-white">
                  {reviewJob.category.toUpperCase()} • {formatEgp(Number(reviewJob.amount_target))}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewJob(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Scrollable photo grid + disclaimer */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className={`${PROFILE_GLASS_PANEL} p-4`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                    Before photos
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(((reviewJob.photo_urls || (reviewJob as any).before_photo_urls) || []) as string[]).length === 0 && (
                      <p className="text-xs text-slate-500 italic">
                        Worker did not upload before photos.
                      </p>
                    )}
                    {(((reviewJob.photo_urls || (reviewJob as any).before_photo_urls) || []) as string[]).map(
                      (url, idx) => (
                        <div
                          key={`before-${idx}-${url.slice(0, 32)}`}
                          className={`relative overflow-hidden ${PROFILE_GLASS_PANEL} !rounded-xl`}
                        >
                          <ModeratedMissionPhoto
                            url={url}
                            alt="Before"
                            imgClassName="w-full h-28 object-cover"
                            showSafeBadge
                          />
                        </div>
                      )
                    )}
                  </div>
                </div>
                <div className={`${PROFILE_GLASS_PANEL} p-4`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                    After photos
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(!reviewJob.after_photo_urls || reviewJob.after_photo_urls.length === 0) && (
                      <p className="text-xs text-slate-500 italic">
                        Worker did not upload after photos.
                      </p>
                    )}
                    {(reviewJob.after_photo_urls || []).map((url, idx) => (
                      <div
                        key={`after-${idx}-${url.slice(0, 32)}`}
                        className={`relative overflow-hidden ${PROFILE_GLASS_PANEL} !rounded-xl`}
                      >
                        <ModeratedMissionPhoto
                          url={url}
                          alt="After"
                          imgClassName="w-full h-28 object-cover"
                          showSafeBadge
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                80% Proof is based on photos. For 100% Proof & dispute resolution, our Telegram Team Checker may request video proof.
              </p>
            </div>

            {/* Sticky action buttons — always visible at bottom */}
            <div className="flex-shrink-0 sticky bottom-0 bg-cyan-950/80 backdrop-blur-md pt-4 pb-6 px-6 z-[60] border-t border-cyan-500/30">
              {(reviewJob?.status === 'completed' || reviewJob?.status === 'finished') ? (
                <div className="w-full">
                  <p className="w-full py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-sm uppercase tracking-[0.2em] text-center">
                    MISSION ACCOMPLISHED & PAID
                  </p>
                </div>
              ) : (
                <div className="w-full flex flex-col gap-3">
                  <p className="text-[11px] text-slate-300 text-center px-2">
                    {isRu
                      ? 'Пожалуйста, проверьте фото. Если работа выполнена, подтвердите выплату уборщику.'
                      : 'Please review the photos. If the job is done, release the funds to the cleaner.'}
                  </p>
                  <p className="text-[11px] text-emerald-200/95 text-center font-bold px-2">
                    {t('releaseWorkerReceives', {
                      amount: formatEgp(
                        workerPayoutFromFundingEgp(
                          Number(reviewJob.current_funding ?? reviewJob.amount_target ?? 0),
                        ),
                      ),
                    })}
                  </p>
                  <div className="flex flex-col gap-3 w-full min-w-0 sm:flex-row sm:items-stretch">
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await handleConfirmReleasePay(reviewJob);
                        if (ok) setReviewJob(null);
                      }}
                      disabled={releasePaySubmitting}
                      className={CLIENT_APPROVE_RELEASE_BTN_MODAL}
                    >
                      {releasePaySubmitting && (
                        <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-black/30 border-t-black animate-spin" aria-hidden />
                      )}
                      <span>
                        {releasePaySubmitting
                          ? t('waitingForAdminRelease')
                          : 'Approve & Release Payment'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (disputeSubmitting) return;
                        try {
                          setDisputeSubmitting(true);
                          const { error } = await supabase
                            .from('missions')
                            .update({ is_disputed: true, status: 'disputed' })
                            .eq('id', reviewJob.id);
                          if (error) throw error;
                          await fetchProfileData();
                          try {
                            await fetch('/api/notify-dispute', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ jobId: reviewJob.id }),
                            });
                          } catch {
                            // ignore
                          }
                          alert('Dispute opened. Support (Muhamed) will review photos and Telegram video.');
                        } catch (err: any) {
                          console.error('Dispute error:', err);
                          alert(err?.message || 'Failed to open dispute.');
                        } finally {
                          setDisputeSubmitting(false);
                          setReviewJob(null);
                        }
                      }}
                      disabled={disputeSubmitting}
                      className={CLIENT_OPEN_DISPUTE_BTN_MODAL}
                    >
                      {disputeSubmitting && (
                        <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-red-200/40 border-t-red-100 animate-spin" aria-hidden />
                      )}
                      <span>{disputeSubmitting ? 'Processing...' : 'Open Dispute'}</span>
                    </button>
                  </div>
                  {(typeof reviewJob.ai_confidence_score === 'number' || reviewJob.ai_verdict) && (
                    <details className="mt-2 w-full rounded-xl border border-cyan-500/25 bg-slate-950/60 px-3 py-2 text-left max-h-[40vh] overflow-y-auto">
                      <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200/95 [&::-webkit-details-marker]:hidden">
                        🔍 AI Verification Details
                      </summary>
                      <div className="mt-2 space-y-2 text-[11px] text-slate-300">
                        {typeof reviewJob.ai_confidence_score === 'number' && (
                          <p className="font-semibold text-emerald-200/90">
                            Confidence: {reviewJob.ai_confidence_score}%
                          </p>
                        )}
                        {reviewJob.ai_verdict && (
                          <p className="whitespace-pre-wrap break-words font-sans text-slate-300 leading-relaxed">
                            {reviewJob.ai_verdict}
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Worker PoW modal: before/after photos */}
      {proofJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={closeProofModal}
          aria-hidden="false"
        >
          <div
            className="relative w-full max-w-md max-h-[90dvh] rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-6 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">
                {proofPhase === 'before' ? "Upload 'Before' photos & Start" : "Upload 'After' photos & Finish"}
              </h3>
              <button
                type="button"
                onClick={closeProofModal}
                disabled={proofSubmitting}
                className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className={`mb-4 px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                Mission
              </p>
              <p className="text-white font-bold">
                {proofJob.category.toUpperCase()} • {formatEgp(Number(proofJob.amount_target))}
              </p>
              {proofJob.description && (
                <p className="text-xs text-slate-400 mt-1">{proofJob.description}</p>
              )}
            </div>

            <form onSubmit={submitProof} className="relative flex flex-col min-h-0 flex-1">
              <div className="flex-grow min-h-0 overflow-y-auto pb-40 pr-2 space-y-4">
              {proofJob.status === 'in_progress' && !!proofJob.rejection_reason && (
                <div className="rounded-2xl border border-orange-500/60 bg-orange-500/10 shadow-[0_0_18px_rgba(249,115,22,0.18)] p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-200">
                    {t('aiRetryTitle')}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-200">
                    {t('aiRetryBody')}
                  </p>
                  <p className="mt-2 text-[11px] font-bold text-amber-200">
                    {t('aiRetryAttempt', {
                      attempt: Math.min(3, (Number(proofJob.retry_count ?? 0) + 1)),
                    })}
                  </p>
                  <div className={`mt-2 p-3 ${PROFILE_GLASS_PANEL} !rounded-xl`}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {t('aiRejectionReasonLabel')}
                    </p>
                    <p className="mt-1 text-xs text-slate-200 whitespace-pre-wrap break-words">
                      {proofJob.rejection_reason}
                    </p>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  {proofPhase === 'before'
                    ? "Upload 'Before' photos (required)"
                    : "Upload 'After' photos (required)"}
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2 max-h-[50vh] overflow-y-auto pr-1">
                  {proofFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className={`relative group h-20 w-full overflow-hidden ${PROFILE_GLASS_PANEL} !rounded-xl`}
                    >
                      <img
                        src={proofPreviewUrls[idx] || ''}
                        alt={`Proof ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setProofFiles((prev) => prev.filter((_, i) => i !== idx));
                        }}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-[10px] font-bold text-white flex items-center justify-center hover:bg-red-500 transition-colors"
                        aria-label="Remove photo"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {proofFiles.length < 9 &&
                    (proofPhase === 'after' ? (
                      <button
                        type="button"
                        onClick={() => setShowPhantomCapture(true)}
                        className="flex h-20 items-center justify-center rounded-xl border border-dashed border-orange-500/50 bg-orange-500/10 text-[11px] text-orange-200 cursor-pointer hover:border-orange-400 hover:bg-orange-500/15 transition-all"
                      >
                        + Take AFTER photo
                      </button>
                    ) : (
                      <label className="flex h-20 items-center justify-center rounded-xl border border-dashed border-amber-500/50 bg-amber-500/10 text-[11px] text-amber-200 cursor-pointer hover:border-amber-400 hover:bg-amber-500/15 transition-all">
                        + Take another photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length) {
                              const ts = Date.now();
                              for (const [idx, file] of files.entries()) {
                                try {
                                  const url = URL.createObjectURL(file);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `cleanegypt_proof_${ts}.jpg`;
                                  a.style.display = 'none';
                                  document.body.appendChild(a);
                                  a.click();
                                  setTimeout(() => {
                                    URL.revokeObjectURL(url);
                                    document.body.removeChild(a);
                                  }, 500);
                                } catch (err) {
                                  console.warn('Auto-save proof photo failed:', err);
                                }
                              }
                              setProofFiles((prev) =>
                                [...prev, ...files].slice(0, 9),
                              );
                              setProofError(null);
                              setProofSuccess(null);
                            }
                            if (e.target) {
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                    ))}
                </div>
              </div>

              {proofPhase === 'after' && (
                <LivenessCheck
                  disabled={proofSubmitting}
                  onRecorded={(res) => {
                    setLivenessBlob(res.blob);
                    setLivenessMimeType(res.mimeType);
                    setLivenessLat(res.lat);
                    setLivenessLng(res.lng);
                    setProofError(null);
                  }}
                />
              )}

              {/* Eco-Report for public missions on completion */}
              {proofPhase === 'after' && proofJob.category === 'public' && (
                <div className="grid grid-cols-1 gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Eco-Report (approx. kg collected)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="min-w-0">
                      <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 mb-1">
                        <span>🥤</span>
                        <span className="uppercase tracking-[0.16em]">Plastic</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={plasticKg}
                        onChange={(e) => setPlasticKg(e.target.value)}
                        className={`w-full border border-emerald-500/40 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${PROFILE_GLASS_PANEL}`}
                        placeholder="0"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 mb-1">
                        <span>🪟</span>
                        <span className="uppercase tracking-[0.16em]">Glass</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={glassKg}
                        onChange={(e) => setGlassKg(e.target.value)}
                        className={`w-full border border-cyan-500/40 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 ${PROFILE_GLASS_PANEL}`}
                        placeholder="0"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 mb-1">
                        <span>🧱</span>
                        <span className="uppercase tracking-[0.16em]">Debris</span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={constructionKg}
                        onChange={(e) => setConstructionKg(e.target.value)}
                        className={`w-full border border-amber-500/40 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500 ${PROFILE_GLASS_PANEL}`}
                        placeholder="0"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-300 mb-1">
                        <span className="flex items-center gap-1">
                          <span>🪵</span>
                          <span className="uppercase tracking-[0.16em]">Wood / Дерево</span>
                        </span>
                        <span className="text-[9px] font-normal text-slate-500 normal-case tracking-normal">
                          approx. kg
                        </span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={woodKg}
                        onChange={(e) => setWoodKg(e.target.value)}
                        className={`w-full border border-emerald-500/30 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400/80 ${PROFILE_GLASS_PANEL}`}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Not sure? Give your best estimate. This powers the Circular Economy leaderboard.
                  </p>
                </div>
              )}

              {proofError && (
                <p className="text-xs text-red-400 font-medium">{proofError}</p>
              )}
              {proofSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{proofSuccess}</p>
              )}
              </div>

              <div className="absolute bottom-4 left-4 right-4 z-50">
                <div className={`w-full rounded-full ${proofJob?.category === 'home' ? 'animated-border-home' : 'animated-border-city'} ${proofSubmitting ? 'opacity-60' : ''}`}>
                  <button
                    type="submit"
                    disabled={
                      proofSubmitting ||
                      (
                        proofPhase === 'after' &&
                        (
                          !proofFiles.length ||
                          !livenessBlob
                        )
                      )
                    }
                    className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all transition-transform text-white bg-[#020617] hover:brightness-110 disabled:cursor-wait active:scale-95 active:opacity-80"
                  >
                    <span className="inline-flex items-center gap-2">
                      {proofSubmitting && (
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      )}
                      {proofSubmitting
                        ? 'Processing...'
                        : proofPhase === 'before'
                          ? "Submit & start mission"
                          : "Submit & mark completed"}
                    </span>
                  </button>
                </div>

                <p className="mt-2 text-[10px] text-slate-500 text-center uppercase tracking-wider">
                  {proofPhase === 'before'
                    ? 'After you submit, the mission timer will start.'
                    : 'After you submit, the client must confirm to release payment.'}
                </p>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPhantomCapture && proofJob && proofPhase === 'after' && (
        <PhantomCapture
          currentIndex={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? Math.min(afterBurstPackages.length, proofJob.photo_urls.length - 1)
              : 0
          }
          totalScenes={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? proofJob.photo_urls.length
              : 1
          }
          referencePhotoUrl={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? proofJob.photo_urls[Math.min(afterBurstPackages.length, proofJob.photo_urls.length - 1)] || null
              : null
          }
          onClose={() => setShowPhantomCapture(false)}
          onCaptured={(result) => {
            setAfterBurstPackages((prev) => {
              // Reuse the initial GPS for subsequent captures to avoid repeated geolocation pings.
              const first = prev[0];
              const normalized =
                (result.lat == null || result.lng == null) && first?.lat != null && first?.lng != null
                  ? { ...result, lat: first.lat, lng: first.lng }
                  : result;
              return [...prev, normalized];
            });
            setProofFiles((prev) => [...prev, ...result.files].slice(0, 9));
            setShowPhantomCapture(false);
            setProofError(null);
            setProofSuccess(null);
          }}
        />
      )}
    </div>
  );
};

export default Profile;