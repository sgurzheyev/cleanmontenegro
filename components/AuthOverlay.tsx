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
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
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

        // If the user doesn't exist yet, Supabase typically returns "Invalid login credentials".
        // Only in that case do we attempt signUp for seamless TMA onboarding.
        if (/invalid login credentials/i.test(signInMessage)) {
          const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
            email: tgEmail,
            password: tgPassword,
          });

          if (cancelled) return;
          if (signUpErr) {
            const signUpMessage = signUpErr.message || '';
            if (/user already registered/i.test(signUpMessage)) {
              // Credentials mismatch for existing user (edge case).
              setError(signUpMessage);
              setMode('signin');
              return;
            }
            setError(signUpMessage || 'Telegram sign-up failed.');
            setMode('signin');
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

        // Any other sign-in error: surface it and show manual auth UI.
        setError(signInMessage || 'Telegram authentication failed. Please sign in normally.');
        setMode('signin');
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

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email?.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
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
      setError(err?.message || 'Sign in failed. Check your email and password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email?.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign up failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email?.trim()) return;
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (err) throw err;
      setError(null);
      setMode('signin');
      onClose();
      alert('Check your email for the magic link. Click it to sign in.');
    } catch (err: any) {
      setError(err?.message || 'Failed to send magic link.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (err) throw err;
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || tmaAuthenticating}
            className="mr-3 text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40"
          >
            ✕
          </button>
          <h2 className="text-xl font-black uppercase tracking-[0.18em] text-white">
            {t('signIn')}
          </h2>
        </div>

        {tmaAuthenticating ? (
          <div className="py-8 text-center">
            <div className="inline-block h-8 w-8 border-2 border-emerald-500/60 border-t-emerald-400 rounded-full animate-spin mb-4" />
            <p className="text-sm text-slate-400 uppercase tracking-wider">
              {t('authenticatingViaTelegram')}
            </p>
          </div>
        ) : mode === 'signin' ? (
          <form onSubmit={handlePasswordSignIn} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                {t('email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                {t('password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {error && (
              <p className="text-xs text-red-400 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-emerald-500 text-black shadow-[0_0_24px_rgba(52,211,153,0.6)] hover:brightness-110 disabled:opacity-60 disabled:cursor-wait transition-all"
            >
              {isLoading ? t('signingIn') : t('signInWithPassword')}
            </button>
          </form>
        ) : mode === 'signup' ? (
          <form onSubmit={handlePasswordSignUp} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                {t('email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                {t('password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {error && (
              <p className="text-xs text-red-400 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-emerald-500 text-black shadow-[0_0_24px_rgba(52,211,153,0.6)] hover:brightness-110 disabled:opacity-60 disabled:cursor-wait transition-all"
            >
              {isLoading ? t('signingUp') : t('signUp')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                {t('email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            {error && (
              <p className="text-xs text-red-400 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-slate-600 text-white hover:bg-slate-500 disabled:opacity-60 disabled:cursor-wait transition-all"
            >
              {isLoading ? t('sending') : t('sendMagicLink')}
            </button>
          </form>
        )}

        {!tmaAuthenticating && (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-bold uppercase tracking-[0.2em] bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-60 transition-all"
            >
              Sign in with Google
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'magic' : 'signin')}
              className="w-full text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider"
            >
              {mode === 'signin' ? t('noPasswordSendMagicLink') : t('backToPasswordSignIn')}
            </button>

            {mode === 'signin' ? (
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="w-full text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider"
              >
                {t('dontHaveAccountSignUp')}
              </button>
            ) : mode === 'signup' ? (
              <button
                type="button"
                onClick={() => setMode('signin')}
                className="w-full text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider"
              >
                {t('alreadyHaveAccountSignIn')}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthOverlay;
