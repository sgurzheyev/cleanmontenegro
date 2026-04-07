import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { formatEgp } from '../src/lib/formatMoney';
import { workerCanSecureMissionDeposit } from '../src/lib/trustDeposit';
import TrustDepositInfoModal from './TrustDepositInfoModal';
import { useTranslation } from 'react-i18next';

interface BidsTerminalProps {
  onclose?: () => void;
  onShowTryFree?: () => void; // Новый пропс для перехода на сбор Email
}

const BidsTerminal: React.FC<BidsTerminalProps> = ({ onclose, onShowTryFree }) => {
  const { t } = useTranslation();
  const [task, setTask] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missions, setMissions] = useState<any[]>([]);
  const [walletSnap, setWalletSnap] = useState<{ w: number; f: number } | null>(null);
  const [trustDepositInfoOpen, setTrustDepositInfoOpen] = useState(false);

  useEffect(() => {
    fetchMissions();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) setWalletSnap(null);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) {
        setWalletSnap({
          w: Number(p?.wallet_balance ?? 0),
          f: Number(p?.frozen_balance ?? 0),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bidTrustBlocked = useMemo(() => {
    if (walletSnap === null) return false;
    const priceNum = Number(price);
    const target = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : 100;
    return !workerCanSecureMissionDeposit(walletSnap.w, walletSnap.f, 'public', target).ok;
  }, [walletSnap, price]);

  const fetchMissions = async () => {
    const { data, error } = await supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setMissions(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // 1. Пытаемся создать запись в базе
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase.from('missions').insert([{
        task_description: task,
        location: location,
        price: parseFloat(price),
        user_id: session?.user?.id,
        status: 'pending'
      }]);

      if (error) throw error;

      // 2. ИМИТАЦИЯ ПОДКЛЮЧЕНИЯ К PAYMOB
      setTimeout(() => {
        // Здесь мы имитируем "Decline" от сервера платежей для теста воронки
        const paymentFailed = true;

        if (paymentFailed) {
          setErrorMessage("ОШИБКА СЕРВЕРА ПЛАТЕЖЕЙ"); // Тот самый красный текст
          
          setTimeout(() => {
            setIsSubmitting(false);
            if (onShowTryFree) {
              onShowTryFree(); // УВОДИМ В ЛАПЫ К ПАРСЕРУ EMAIL
            }
          }, 2000);
        } else {
          // Если успех — в профиль (будущая логика)
          window.location.href = '/profile';
        }
      }, 2500);

    } catch (error: any) {
      setErrorMessage("CONNECTION LOST: " + error.message);
      setTimeout(() => setIsSubmitting(false), 3000);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto animated-border animated-border-rect relative overflow-hidden">
      <TrustDepositInfoModal open={trustDepositInfoOpen} onClose={() => setTrustDepositInfoOpen(false)} />
      <div className="animated-border-inner w-full bg-[#020617]/95 backdrop-blur-2xl text-white p-6 font-sans rounded-3xl relative overflow-hidden">
      
      {/* ЭКРАН ЗАГРУЗКИ / ОШИБКИ */}
      {isSubmitting && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0b0e]/95 backdrop-blur-lg p-6">
          {!errorMessage ? (
            <>
              <div className="w-20 h-20 border-4 border-[#00f2ff] border-t-transparent rounded-full animate-spin mb-6 shadow-[0_0_15px_#00f2ff]"></div>
              <p className="text-[#00f2ff] font-mono text-sm animate-pulse tracking-widest uppercase text-center">
                Установка защищенного соединения...
              </p>
            </>
          ) : (
            <div className="text-center animate-in fade-in zoom-in duration-300">
              <p className="text-red-500 font-black text-xl mb-2 uppercase tracking-tighter">
                {errorMessage}
              </p>
              <p className="text-zinc-500 text-[10px] uppercase">
                Возврат на карту через пару секунд...
              </p>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center justify-between mb-6 border-b border-[#39FF14]/20 pb-4">
          <h1 className="text-2xl font-black italic tracking-tighter uppercase bg-clip-text text-transparent bg-gradient-to-r from-[#39FF14] to-[#00f2ff]">
            Bids Terminal
          </h1>
          <button onClick={onclose} className="text-zinc-500 hover:text-white transition-colors">[ ESC ]</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mb-8">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-500 ml-2 uppercase">Target_Details</label>
            <input
              type="text"
              placeholder="ЧТО НУЖНО СДЕЛАТЬ?"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl focus:border-[#39FF14] outline-none transition-all placeholder:text-zinc-600 text-sm"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-mono text-zinc-500 ml-2 uppercase">Location</label>
              <input
                type="text"
                placeholder="ХУРГАДА..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-[#39FF14] text-sm"
                required
              />
            </div>
            <div className="w-28 space-y-1">
              <label className="text-[10px] font-mono text-zinc-500 ml-2 uppercase">Bid</label>
              <input
                type="number"
                placeholder="EGP"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-[#00f2ff] font-bold text-[#00f2ff]"
                required
              />
            </div>
          </div>

          {bidTrustBlocked && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] text-amber-300 text-center font-bold uppercase tracking-wider">
                {t('insufficientTrustDeposit')}
              </p>
              <button
                type="button"
                onClick={() => setTrustDepositInfoOpen(true)}
                className="w-full text-[10px] font-bold uppercase tracking-wider text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
              >
                {t('trustDepositLearnMore')}
              </button>
            </div>
          )}

          <div className="w-full mt-4 animated-border rounded-2xl">
            <button
              type="submit"
              className="animated-border-inner w-full py-5 text-white bg-[#020617] font-black uppercase rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all"
            >
              CLEAN MY WALLET 🚀
            </button>
          </div>
        </form>

        <div className="space-y-3 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
          <p className="text-[10px] font-mono text-[#39FF14]/50 mb-2 tracking-widest uppercase">Latest_Missions:</p>
          {missions.map((m) => (
            <div key={m.id} className="p-4 bg-zinc-900/20 border border-zinc-800/50 rounded-2xl flex justify-between items-center group hover:border-[#39FF14]/30">
              <div>
                <div className="text-zinc-200 font-bold text-xs uppercase">{m.task_description}</div>
                <div className="text-[9px] text-zinc-500 font-mono mt-1">{m.location}</div>
              </div>
              <div className="text-[#00f2ff] font-black text-sm">
                {formatEgp(Number(m.price))}
              </div>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
};

export default BidsTerminal;
