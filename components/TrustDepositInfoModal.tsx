import React from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Explains the minimum wallet security (trust) deposit required to place bids.
 */
const TrustDepositInfoModal: React.FC<Props> = ({ open, onClose }) => {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] isolate bg-black/80 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trust-deposit-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0a0f1a] p-5 shadow-2xl shadow-amber-900/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="trust-deposit-modal-title"
          className="text-sm font-black uppercase tracking-[0.2em] text-amber-200 mb-3"
        >
          {t('trustDepositModalTitle')}
        </h3>
        <p className="text-[13px] text-slate-300 leading-relaxed mb-5">{t('trustDepositBidExplanation')}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full py-2.5 text-sm font-bold uppercase tracking-wider bg-amber-500/20 text-amber-100 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
};

export default TrustDepositInfoModal;
