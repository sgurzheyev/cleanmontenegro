// src/components/OrderForm.tsx — Montenegro: direct Stripe EUR payments.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { floorEgp } from '../src/lib/integerEgpInput';
import {
  HOME_MIN_PRICE,
  MISSION_STAKE_FEE_EUR,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  HOME_MAX_PRICE,
  DISPLAY_CURRENCY_SUFFIX,
  EDGE_FN_STRIPE_MISSION_CHECKOUT,
} from '../constants';
import {
  descriptionLooksLikeContactOrPhone,
  validateMissionDescription,
} from '../src/lib/missionContentPolicy';
import { formatEur } from '../src/lib/formatMoney';
import { parseIntegerEgpFromInput, sanitizeIntegerEgpDigits } from '../src/lib/integerEgpInput';

interface Props {
  selectedLocation: { lat: number; lng: number } | null;
  onOrderStarted?: () => void;
}

const CONTACT_WARNING =
  'Numbers and external contacts are blocked for security';

const OrderForm: React.FC<Props> = ({ selectedLocation, onOrderStarted }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  /** User-entered mission price / goal in EGP only */
  const [amountEgp, setAmountEgp] = useState('');
  const [walletPaySuccess, setWalletPaySuccess] = useState(false);

  const contactWarning = useMemo(
    () => descriptionLooksLikeContactOrPhone(shortDescription),
    [shortDescription]
  );

  const policyCheck = useMemo(() => validateMissionDescription(shortDescription), [shortDescription]);

  const parseEgp = (): number => parseIntegerEgpFromInput(amountEgp);

  // Wallet/balance removed: direct Stripe Checkout only.

  /** Direct Stripe (Montenegro): create pending_payment mission, then redirect to Stripe Checkout. */
  const startStripeMission = async (category: 'public' | 'home', egp: number) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      alert(t('signIn'));
      return;
    }
    if (!selectedLocation) return;

    setLoading(true);
    setWalletPaySuccess(false);
    if (onOrderStarted) onOrderStarted();

    try {
      const missionId = globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}`;
      const { error: missionErr } = await supabase.from('missions').insert(
        {
          id: missionId,
          creator_id: userId,
          category,
          amount_target: Math.floor(Math.max(0, egp)),
          location_lat: selectedLocation.lat,
          location_lng: selectedLocation.lng,
          status: 'pending_payment',
          description: shortDescription.trim() || null,
          photo_urls: [],
        } as any,
        ({ returning: 'minimal' } as any),
      );
      if (missionErr) throw missionErr;

      const { data: checkoutPayload, error: checkoutFnErr } = await supabase.functions.invoke(
        EDGE_FN_STRIPE_MISSION_CHECKOUT,
        { body: { missionId } },
      );
      if (checkoutFnErr) throw checkoutFnErr;
      const checkoutUrl =
        checkoutPayload &&
        typeof checkoutPayload === 'object' &&
        checkoutPayload !== null &&
        'url' in checkoutPayload &&
        typeof (checkoutPayload as { url?: unknown }).url === 'string'
          ? (checkoutPayload as { url: string }).url
          : null;
      if (!checkoutUrl) throw new Error(t('stripeMissionCheckoutFailed'));

      window.location.assign(checkoutUrl);
      setWalletPaySuccess(true);
      return;
    } catch (error: unknown) {
      console.error(error);
      alert(error instanceof Error ? error.message : t('retryPaymentFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Legacy Paymob flow removed (Stripe-only).
  const startPaymobMission = async (category: 'public' | 'home', egp: number) => {
    await startStripeMission(category, egp);
  };

  const onCityPin = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < CITY_MIN_PRICE || egp > CITY_MAX_PRICE) {
      alert(t('cityPriceRangeEgp', { min: CITY_MIN_PRICE, max: CITY_MAX_PRICE }));
      return;
    }

    const ok = window.confirm(
      t('cityPinScoutStakeConfirm', { amount: formatEur(MISSION_STAKE_FEE_EUR) })
    );
    if (!ok) return;

    await startPaymobMission('public', egp);
  };

  const onHomeMission = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < HOME_MIN_PRICE || egp > HOME_MAX_PRICE) {
      alert(t('homePriceRangeEgp', { min: HOME_MIN_PRICE, max: HOME_MAX_PRICE }));
      return;
    }

    await startPaymobMission('home', egp);
  };

  const onCityPinWallet = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < CITY_MIN_PRICE || egp > CITY_MAX_PRICE) {
      alert(t('cityPriceRangeEgp', { min: CITY_MIN_PRICE, max: CITY_MAX_PRICE }));
      return;
    }
    const ok = window.confirm(
      t('cityPinScoutStakeConfirm', { amount: formatEur(MISSION_STAKE_FEE_EUR) })
    );
    if (!ok) return;

    await startStripeMission('public', egp);
  };

  const onHomeMissionWallet = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < HOME_MIN_PRICE || egp > HOME_MAX_PRICE) {
      alert(t('homePriceRangeEgp', { min: HOME_MIN_PRICE, max: HOME_MAX_PRICE }));
      return;
    }
    await startStripeMission('home', egp);
  };

  const egpPreview = parseEgp();
  const canWalletCity = false;
  const canWalletHome = false;

  const descriptionInvalid = shortDescription.trim().length > 0 && !policyCheck.ok;
  const policyRejectText = policyCheck.ok === false ? policyCheck.error : null;

  return (
    <div className="space-y-4 p-4 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10">
      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">Your Intelligence Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@cleanmontenegro.co"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:border-[#00f2ff] outline-none transition-all"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">{t('amountEgp')}</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d*"
          value={amountEgp}
          onChange={(e) => setAmountEgp(sanitizeIntegerEgpDigits(e.target.value))}
          placeholder={t('anyAmount')}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:border-[#00f2ff] outline-none transition-all tabular-nums"
        />
        <p className="text-[10px] text-gray-500">
          {t('orderFormAmountHintEgp')}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">Short description</label>
        <textarea
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          placeholder="Describe the mission (no phone numbers or external contacts)"
          rows={3}
          className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none transition-all resize-y min-h-[80px] ${
            contactWarning || descriptionInvalid
              ? 'border-red-500/70 focus:border-red-400'
              : 'border-white/10 focus:border-[#00f2ff]'
          }`}
        />
        {contactWarning && (
          <p className="text-[11px] font-semibold text-red-400" role="alert">
            {CONTACT_WARNING}
          </p>
        )}
        {descriptionInvalid && !contactWarning && policyRejectText && (
          <p className="text-[11px] font-semibold text-red-400" role="alert">
            {policyRejectText}
          </p>
        )}
      </div>

      <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] text-center">
        {selectedLocation
          ? `TARGET: ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
          : 'SELECT TARGET ON MAP'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={loading || contactWarning || descriptionInvalid}
          onClick={() => void onCityPin()}
          className="py-4 bg-[#39FF14]/10 border border-[#39FF14]/40 text-[#39FF14] rounded-xl font-black italic hover:bg-[#39FF14] hover:text-black transition-all text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          CITY PIN ({MISSION_STAKE_FEE_EUR} {DISPLAY_CURRENCY_SUFFIX})
        </button>

        <button
          type="button"
          disabled={loading || contactWarning || descriptionInvalid}
          onClick={() => void onHomeMission()}
          className="py-4 bg-[#f8ff14]/10 border border-[#f8ff14]/40 text-[#f8ff14] rounded-xl font-black italic hover:bg-[#f8ff14] hover:text-black transition-all text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          HOME ({HOME_MIN_PRICE}+ {DISPLAY_CURRENCY_SUFFIX})
        </button>
      </div>

      {(canWalletCity || canWalletHome) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {canWalletCity && (
            <button
              type="button"
              disabled={loading || contactWarning || descriptionInvalid}
              onClick={() => void onCityPinWallet()}
              className="py-3 rounded-xl font-black text-[11px] uppercase tracking-wide bg-gradient-to-r from-cyan-500/30 to-emerald-500/30 border border-cyan-400/50 text-cyan-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('payInstantWithWallet')} — City
            </button>
          )}
          {canWalletHome && (
            <button
              type="button"
              disabled={loading || contactWarning || descriptionInvalid}
              onClick={() => void onHomeMissionWallet()}
              className="py-3 rounded-xl font-black text-[11px] uppercase tracking-wide bg-gradient-to-r from-amber-500/25 to-yellow-500/20 border border-amber-400/50 text-amber-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('payInstantWithWallet')} — Home
            </button>
          )}
        </div>
      )}

      {walletPaySuccess && (
        <p className="text-xs text-center font-semibold text-emerald-400">{t('paymentWalletSuccess')}</p>
      )}

      <p className="mt-2 text-[10px] text-gray-500 text-center">{t('paymentsEgpOnlyNote')}</p>
    </div>
  );
};

export default OrderForm;
