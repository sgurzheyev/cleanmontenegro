import React, { useState, useEffect } from 'react';
import { useLocation, Routes, Route } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Profile from './components/Profile';
import AuthOverlay from './components/AuthOverlay';
import VerificationPage from './components/VerificationPage';
import Terms from './components/Terms';
import Privacy from './components/Privacy';
import { supabase } from './services/supabase';
import i18n from './src/i18n';

const App: React.FC = () => {
  const location = useLocation();
  const [session, setSession] = useState<any>(null);
  const [showProfileOverlay, setShowProfileOverlay] = useState(false);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number } | null>(null);
  const [showAuthOverlay, setShowAuthOverlay] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSuccessType, setPaymentSuccessType] = useState<'job' | 'deposit'>('job');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = i18n.language;
    };
    apply();
    i18n.on('languageChanged', apply);
    return () => {
      i18n.off('languageChanged', apply);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const isSuccess =
      params.get('payment') === 'success' || params.get('success') === 'true';

    if (isSuccess) {
      const returnType = sessionStorage.getItem('paymentReturnType') || 'job_creation';
      setPaymentSuccessType(returnType === 'deposit' ? 'deposit' : 'job');
      sessionStorage.setItem('paymentSuccessNeedsVerify', returnType);
      sessionStorage.removeItem('paymentReturnType');
      setShowPaymentModal(true);
      window.history.replaceState({}, '', location.pathname || '/');
      window.dispatchEvent(new CustomEvent('paymentSuccess'));
    }
  }, [location.search, location.pathname]);

  const handleAvatarClick = () => {
    if (session) {
      setShowProfileOverlay(true);
    } else {
      setShowAuthOverlay(true);
    }
  };

  const handleCloseProfile = () => setShowProfileOverlay(false);
  const handleAuthSuccess = () => setShowAuthOverlay(false);

  return (
    <Routes>
      <Route path="/verify" element={<VerificationPage />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route
        path="/*"
        element={
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden">
      {/* Single map interface — never unmounts */}
      <div className="fixed inset-0 z-0 w-full h-full isolate">
        <MapPicker
          onLocationSelect={() => {}}
          selectedCoords={null}
          onAvatarClick={handleAvatarClick}
          onRequestAuth={() => setShowAuthOverlay(true)}
          flyToTarget={flyToTarget}
          onFlyToComplete={() => setFlyToTarget(null)}
        />
      </div>

      {/* Profile as sliding overlay */}
      <Profile
        isOpen={showProfileOverlay}
        onClose={handleCloseProfile}
        session={session}
        onNavigateToJob={(lat, lng) => {
          setFlyToTarget({ lat, lng });
          handleCloseProfile();
        }}
      />

      {/* Auth overlay */}
      <AuthOverlay
        isOpen={showAuthOverlay}
        onClose={() => setShowAuthOverlay(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* Payment success modal */}
      {showPaymentModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-orange-500/10 border border-orange-500/50 mb-4">
                <span className="text-2xl">✓</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Payment successful</h3>
              <p className="text-slate-400 text-sm mb-6">
                {paymentSuccessType === 'deposit'
                  ? 'Deposit paid successfully! Mission is yours.'
                  : 'Deposit paid successfully! Job is now live on the map.'}
              </p>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="w-full px-6 py-2 rounded-full border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] text-sm font-black uppercase tracking-[0.2em] transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
        }
      />
    </Routes>
  );
};

export default App;
