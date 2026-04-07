import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatEur } from '../src/lib/formatMoney';

interface PaymentOverlayProps {
  onClose: (pyramidId?: string) => void;
  onSuccess?: () => void;
  lat: number;
  lng: number;
  amount: number;
  type: 'home' | 'city';
}

const PaymentOverlay: React.FC<PaymentOverlayProps> = ({ onClose, onSuccess, lat, lng, amount, type }) => {
  const navigate = useNavigate();

  useEffect(() => {
    // Paymob has been removed for the Montenegro launch.
    // Mission creation should be funded via wallet (top up with Stripe in Profile) and paid from wallet.
    const timer = window.setTimeout(() => {
      onClose();
      onSuccess?.();
      navigate('/profile');
    }, 400);
    return () => window.clearTimeout(timer);
  }, [navigate, onClose, onSuccess]);

  const stopProp = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center p-4 overscroll-contain"
      onTouchStart={stopProp}
      onTouchMove={stopProp}
      onTouchEnd={stopProp}
      onMouseDown={stopProp}
      onWheel={stopProp}
    >
      <div
        className="absolute top-0 right-0 bottom-0 left-0 bg-black/70"
        onClick={() => onClose(pyramidId ?? undefined)}
      />
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
          <div className="flex-none relative flex justify-between items-center p-3 border-b border-gray-200 bg-zinc-950">
            <button
              type="button"
              onClick={() => onClose()}
              className="absolute top-3 left-3 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-xs uppercase tracking-wider shadow-lg z-10"
            >
              Close
            </button>
            <div className="flex-1 text-center pr-24">
              <h2 className="text-white text-lg font-black tracking-tighter uppercase italic">
                Clean<span className="text-cyan-400">Montenegro</span>
              </h2>
              <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                {formatEur(amount)}
              </p>
            </div>
          </div>

          <div className="p-8 flex flex-col items-center justify-center text-center">
            <h3 className="text-xl font-black text-gray-800 mb-2">Payment updated</h3>
            <p className="text-gray-600 mb-6">
              Paymob has been removed. Please top up your wallet with Stripe in your Profile and pay from wallet.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate('/profile');
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 px-6 rounded-xl text-sm uppercase tracking-wider transition-colors"
            >
              Go to Profile
            </button>
          </div>

          <button
            type="button"
            onClick={() => onClose()}
            className="flex-none w-full py-3 text-zinc-500 hover:text-zinc-800 text-[11px] uppercase tracking-widest font-bold border-t border-zinc-200"
          >
            [ Cancel ]
          </button>
        </div>
    </div>
  );
};

export default PaymentOverlay;
