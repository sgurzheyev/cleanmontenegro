import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useTelegram } from '../src/hooks/useTelegram';
import { useTranslation } from 'react-i18next';

interface AuthOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AuthOverlay: React.FC<AuthOverlayProps> = ({ isOpen, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const { tgUser, isTMA } = useTelegram();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [tmaAuthenticating, setTmaAuthenticating] = useState(false);

  // Magic Login: Auto-login/signup for Telegram Mini App users
  useEffect(() => {
    if (!isOpen || !isTMA || !tgUser?.id) return;

    let cancelled = false;
    const run = async () => {
      setTmaAuthenticating(true);
      setError(null);
      const tgEmail = `tg_${tgUser.id}@tma.cleanmontenegro.co`;
      const tgPassword = `TmaAuth!_${tgUser.id}_secret`;

      try {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: tgEmail,
          password: tgPassword,
        });

        if (cancelled) return;
        if (!signInErr) {
          onSuccess();
          onClose();
          setTmaAuthenticating(false);
          return;
        }

        const signInMessage = signInErr.message || '';

        if (/invalid login credentials/i.test(signInMessage)) {
          const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
            email: tgEmail,
            password: tgPassword,
          });

          if (cancelled) return;
          if (signUpErr) {
            const signUpMessage = signUpErr.message || '';
            if (/user already registered/i.test(signUpMessage)) {
              setError(signUpMessage);
              return;
            }
            setError(signUpMessage || 'Telegram sign-up failed.');
            return;
          }

          const session = signUpData?.session;
          if (session?.user?.id) {
            await supabase
              .from('profiles')
              .update({
                full_name: tgUser.first_name ?? null,
                telegram_username: tgUser.username ?? null,
              })
              .eq('id', session.user.id);
          }

          if (cancelled) return;
          onSuccess();
          onClose();
          return;
        }

        setError(signInMessage || 'Telegram authentication failed. Please sign in normally.');
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Telegram authentication failed.');
        }
      } finally {
        if (!cancelled) setTmaAuthenticating(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isTMA, tgUser?.id, tgUser?.first_name, tgUser?.username, onSuccess, onClose]);

  if (!isOpen) return null;

  const validateEmailPassword = () => {
    if (!email?.trim() || !password) {
      setError(t('authEmailPasswordRequired'));
      return false;
    }
    return true;
  };

  const handlePasswordSignIn = async () => {
    setError(null);
    setInfo(null);
    if (!validateEmailPassword()) return;
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || t('authSignFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSignUp = async () => {
    setError(null);
    setInfo(null);
    if (!validateEmailPassword()) return;
    setIsLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      if (data.session?.user) {
        onSuccess();
        onClose();
      } else {
        setInfo(t('authConfirmEmailCheck'));
      }
    } catch (err: any) {
      setError(err?.message || t('authSignUpFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setError(null);
    setInfo(null);
    if (!email?.trim()) {
      setError(t('authMagicEmailMissing'));
      return;
    }
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (err) throw err;
      setInfo(t('magicLinkSentNotice'));
      setShowMagicLink(false);
    } catch (err: any) {
      setError(err?.message || t('sendMagicLink'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`,
        },
      });
      if (err) throw err;
    } catch (err: any) {
      setError(err?.message || t('authGoogleSignInFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))] bg-black/75 backdrop-blur-md"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl bg-slate-950/90 backdrop-blur-md border border-cyan-500/20 shadow-[0_0_48px_rgba(6,182,212,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-50 flex items-start justify-between gap-3 border-b border-cyan-500/15 bg-slate-950/95 px-5 py-4 backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || tmaAuthenticating}
            className="shrink-0 rounded-full border border-white/15 bg-slate-950/90 px-3 py-1.5 text-sm font-bold text-slate-300 hover:border-cyan-400/40 hover:text-white disabled:opacity-40"
            aria-label={t('close')}
          >
            ✕
          </button>
          <div className="flex-1 text-right">
            <h2 className="text-lg font-black uppercase tracking-[0.16em] text-white">{t('signIn')}</h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-cyan-400/80">{t('authCyberpunkSubtitle')}</p>
          </div>
        </div>

        <div className="space-y-5 px-5 pb-6 pt-4">
          {tmaAuthenticating ? (
            <div className="py-8 text-center">
              <div className="inline-block h-8 w-8 border-2 border-orange-500/60 border-t-orange-400 rounded-full animate-spin mb-4" />
              <p className="text-xs text-slate-400 uppercase tracking-wider">{t('authenticatingViaTelegram')}</p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('email')}
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl bg-black/35 border border-cyan-500/20 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('password')}
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl bg-black/35 border border-cyan-500/20 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30"
                  />
                </div>

                {error && (
                  <p className="rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
                )}
                {info && (
                  <p className="rounded-xl border border-emerald-500/35 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">{info}</p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handlePasswordSignIn}
                    className="rounded-full border border-orange-500/50 bg-orange-500/10 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-orange-400 shadow-[0_0_20px_rgba(249,115,22,0.15)] hover:bg-orange-500/15 disabled:opacity-50 disabled:cursor-wait transition-all"
                  >
                    {isLoading ? t('signingIn') : t('signIn')}
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handlePasswordSignUp}
                    className="rounded-full border border-cyan-500/40 bg-cyan-950/35 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-950/50 disabled:opacity-50 disabled:cursor-wait transition-all"
                  >
                    {isLoading ? t('signingUp') : t('signUp')}
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleGoogleLogin}
                  className="w-full rounded-full border border-white/15 bg-white/5 px-6 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white hover:border-cyan-400/35 hover:bg-white/10 disabled:opacity-50 disabled:cursor-wait transition-all"
                >
                  {t('continueWithGoogle')}
                </button>

                <div className="border-t border-white/10 pt-4 space-y-3">
                  {!showMagicLink ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMagicLink(true);
                        setError(null);
                        setInfo(null);
                      }}
                      className="w-full text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-cyan-400/90 transition-colors"
                    >
                      {t('noPasswordSendMagicLink')}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">{t('sendMagicLink')}</p>
                      <button
                        type="button"
                        disabled={isLoading || !email.trim()}
                        onClick={handleMagicLink}
                        className="w-full rounded-full border border-slate-600/80 bg-slate-900/80 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-200 hover:border-cyan-500/40 disabled:opacity-45"
                      >
                        {isLoading ? t('sending') : t('sendMagicLink')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMagicLink(false)}
                        className="w-full text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider"
                      >
                        {t('backToPasswordSignIn')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthOverlay;
