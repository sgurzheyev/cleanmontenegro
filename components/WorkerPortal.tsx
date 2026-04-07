import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { formatEgp } from '../src/lib/formatMoney';

const WorkerPortal = () => {
  const [worker, setWorker] = useState<any>(null);
  const [pyramid, setPyramid] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const queryParams = new URLSearchParams(window.location.search);
  const pyramidId = queryParams.get('pyramidId');
  const TEST_TELEGRAM_ID = 111222333; // Твой ID для тестов

  useEffect(() => {
    fetchData();
  }, [pyramidId]);

  const fetchData = async () => {
    try {
      // 1. Грузим баланс рабочего
      const { data: wData } = await supabase
        .from('profiles')
        .select('id, wallet_balance, frozen_balance')
        .eq('telegram_id', TEST_TELEGRAM_ID)
        .maybeSingle();
      setWorker(wData);

      // 2. Грузим детали пирамиды (задания)
      if (pyramidId) {
        const { data: pData } = await supabase
          .from('pyramids')
          .select('*')
          .eq('id', pyramidId)
          .single();
        setPyramid(pData);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartWork = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !pyramid || !worker) return;

    // Считаем депозит: 50% от цены (City или Home)
    const jobPrice = Number(
      pyramid.final_price_egp ?? pyramid.current_amount_egp ?? pyramid.amount_target_egp ?? 0
    );
    const deposit = jobPrice * 0.5;

    if (worker.wallet_balance < deposit) {
      alert(`🛑 LOW BALANCE! Need ${formatEgp(deposit)} deposit.`);
      return;
    }

    try {
      setUploading(true);
      // 1. Загружаем Photo 2 (Worker Start) в Storage
      const fileName = `${pyramidId}_start_${Date.now()}.jpg`;
      const { error: storageErr } = await supabase.storage.from('order-photos').upload(fileName, file);
      if (storageErr) throw storageErr;

      const { data: { publicUrl } } = supabase.storage.from('order-photos').getPublicUrl(fileName);

      // 2. Списываем депо и обновляем статус/время/фото в базе
      const { error: dbErr } = await supabase.from('pyramids').update({
        status: 'active',
        worker_id: worker.id,
        worker_photo_start_url: publicUrl,
        work_started_at: new Date().toISOString()
      }).eq('id', pyramidId);

      if (dbErr) throw dbErr;

      // 3. Обновляем баланс рабочего (lock deposit in frozen_balance)
      await supabase
        .from('profiles')
        .update({
          wallet_balance: worker.wallet_balance - deposit,
          frozen_balance: (worker.frozen_balance ?? 0) + deposit,
        })
        .eq('id', worker.id);

      alert(`🚀 WORK STARTED! ${deposit} EGP locked.`);
      fetchData();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFinishWork = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !pyramid) return;

    try {
      setUploading(true);
      // 1. Загружаем Photo 3 (Worker Finish)
      const fileName = `${pyramidId}_finish_${Date.now()}.jpg`;
      await supabase.storage.from('order-photos').upload(fileName, file);
      const { data: { publicUrl } } = supabase.storage.from('order-photos').getPublicUrl(fileName);

      // 2. Обновляем статус на проверку и пишем время финиша
      await supabase.from('pyramids').update({
        status: 'verifying',
        photo_after_url: publicUrl,
        work_finished_at: new Date().toISOString()
      }).eq('id', pyramidId);

      alert("✅ FINISHED! Waiting for Owner/Support to click DONE.");
      fetchData();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-teal-400 font-black tracking-widest">CLEANMONTENEGRO LOADING...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 font-sans ltr">
      <div className="max-w-md mx-auto">
        
        {/* Legacy worker portal — balances in EUR */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-700 mb-6">
          <p className="text-teal-400 font-bold uppercase text-[10px] tracking-[2px]">Your Wallet</p>
          <p className="text-4xl font-black">
            {worker?.wallet_balance != null ? formatEgp(Number(worker.wallet_balance)) : '—'}
          </p>
        </div>

        {/* КАРТОЧКА ЗАДАЧИ */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="p-5 border-b border-slate-700 bg-slate-800/50">
            <p className="text-teal-400 font-black text-xl">JOB #{pyramidId}</p>
            <p className="text-[10px] text-slate-500 uppercase">{pyramid?.job_type} MISSION</p>
          </div>

          <div className="p-6">
            {pyramid?.status === 'pending' || pyramid?.status === 'bidding' ? (
              <div className="space-y-4">
                <p className="text-center text-slate-400 text-sm">Take this job? You need 50% deposit.</p>
                <label className="block w-full bg-teal-500 hover:bg-teal-400 text-slate-900 py-4 rounded-xl font-black text-center cursor-pointer transition-all">
                  {uploading ? "STARTING..." : "📸 TAKE START PHOTO & START"}
                  <input type="file" accept="image/*" onChange={handleStartWork} className="hidden" disabled={uploading} />
                </label>
              </div>
            ) : pyramid?.status === 'active' ? (
              <div className="space-y-4 text-center">
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
                  <p className="text-emerald-400 text-sm font-bold animate-pulse">WORK IN PROGRESS...</p>
                  <p className="text-[10px] text-slate-500 mt-1">Started: {new Date(pyramid.work_started_at).toLocaleTimeString()}</p>
                </div>
                <label className="block w-full bg-white text-slate-900 py-4 rounded-xl font-black text-center cursor-pointer shadow-xl transition-all">
                  {uploading ? "FINISHING..." : "✅ TAKE FINISH PHOTO & COMPLETE"}
                  <input type="file" accept="image/*" onChange={handleFinishWork} className="hidden" disabled={uploading} />
                </label>
              </div>
            ) : (
              <div className="text-center p-8">
                <p className="text-teal-400 font-bold">STATUS: {pyramid?.status.toUpperCase()}</p>
                <p className="text-xs text-slate-500 mt-2">Waiting for Owner or Support confirmation.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkerPortal;

