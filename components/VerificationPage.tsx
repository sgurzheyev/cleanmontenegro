import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';

const BUCKET_VERIFICATIONS = 'verifications';

const VerificationPage: React.FC = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [photoFront, setPhotoFront] = useState<File | null>(null);
  const [photoBack, setPhotoBack] = useState<File | null>(null);
  const [photoPreviewFront, setPhotoPreviewFront] = useState<string | null>(null);
  const [photoPreviewBack, setPhotoPreviewBack] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputFrontRef = useRef<HTMLInputElement>(null);
  const fileInputBackRef = useRef<HTMLInputElement>(null);
  const frontPreviewUrlRef = useRef<string | null>(null);
  const backPreviewUrlRef = useRef<string | null>(null);

  const handleFileFront = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFront(file);
      setSubmitError(null);
      if (frontPreviewUrlRef.current) URL.revokeObjectURL(frontPreviewUrlRef.current);
      const url = URL.createObjectURL(file);
      frontPreviewUrlRef.current = url;
      setPhotoPreviewFront(url);
    }
  };

  const handleFileBack = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoBack(file);
      setSubmitError(null);
      if (backPreviewUrlRef.current) URL.revokeObjectURL(backPreviewUrlRef.current);
      const url = URL.createObjectURL(file);
      backPreviewUrlRef.current = url;
      setPhotoPreviewBack(url);
    }
  };

  // Revoke preview URLs on unmount to prevent object URL leaks.
  useEffect(() => {
    return () => {
      if (frontPreviewUrlRef.current) URL.revokeObjectURL(frontPreviewUrlRef.current);
      if (backPreviewUrlRef.current) URL.revokeObjectURL(backPreviewUrlRef.current);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!fullName.trim()) return;
    if (!photoFront) {
      setSubmitError('Загрузите фото лицевой стороны документа.');
      return;
    }
    if (!photoBack) {
      setSubmitError('Загрузите фото оборотной стороны документа.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitError('Войдите в аккаунт, чтобы отправить заявку.');
      return;
    }

    setIsSubmitting(true);
    try {
      const ts = Date.now();
      const rawExtF = photoFront.name.split('.').pop() || 'jpg';
      const rawExtB = photoBack.name.split('.').pop() || 'jpg';
      const extF = rawExtF.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      const extB = rawExtB.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      const fileNameFront = `mission_${ts}_${Math.random().toString(36).substring(2)}_front.${extF}`;
      const fileNameBack = `mission_${ts}_${Math.random().toString(36).substring(2)}_back.${extB}`;

      const { error: uploadFrontError } = await supabase.storage
        .from(BUCKET_VERIFICATIONS)
        .upload(fileNameFront, photoFront, {
          contentType: photoFront.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadFrontError) {
        console.log('Storage upload (front) error:', uploadFrontError);
        setSubmitError('Не удалось загрузить фото лицевой стороны. Проверьте размер и формат.');
        return;
      }

      const { error: uploadBackError } = await supabase.storage
        .from(BUCKET_VERIFICATIONS)
        .upload(fileNameBack, photoBack, {
          contentType: photoBack.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadBackError) {
        console.log('Storage upload (back) error:', uploadBackError);
        setSubmitError('Не удалось загрузить фото оборотной стороны. Проверьте размер и формат.');
        return;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          verification_status: 'pending',
          verification_photo_front: fileNameFront,
          verification_photo_back: fileNameBack,
        })
        .eq('id', user.id);

      if (updateError) {
        console.log('Profile update error:', updateError);
        setSubmitError('Фото загружены, но не удалось обновить профиль. Обратитесь в поддержку.');
        return;
      }

      setSubmitted(true);
    } catch (err) {
      console.log('Verification submit error:', err);
      setSubmitError('Ошибка отправки. Попробуйте позже.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-md font-sans ltr">
      <div className="min-h-full py-8 px-4 flex flex-col items-center">
        <div className="w-full max-w-md">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="mb-6 text-slate-400 hover:text-white text-sm font-bold flex items-center gap-2 transition-colors"
          >
            ← Назад в профиль
          </button>

          <div className="bg-slate-800/90 backdrop-blur-sm border border-white/10 rounded-3xl p-6 shadow-2xl">
            <h1 className="text-2xl font-black text-white mb-1 tracking-tight">
              Верификация рабочего
            </h1>
            <p className="text-slate-400 text-sm mb-6">
              Нужна для доступа к домашним миссиям (CleanMyHome). Загрузите обе стороны документа.
            </p>

            {submitted ? (
              <div className="py-8 text-center">
                <p className="text-emerald-400 font-bold text-lg mb-2">
                  Заявка отправлена
                </p>
                <p className="text-slate-400 text-sm mb-6">
                  Мы проверим документ и обновим статус в профиле.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-900 font-black text-sm transition-colors"
                >
                  В профиль
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
                    ФИО
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Иван Иванов"
                    className="w-full bg-slate-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:border-teal-400/50 outline-none transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
                    Лицевая сторона (Front Side)
                  </label>
                  <input
                    ref={fileInputFrontRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileFront}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputFrontRef.current?.click()}
                    className="w-full py-4 rounded-xl border-2 border-dashed border-white/20 hover:border-teal-400/50 bg-slate-900/50 text-slate-400 hover:text-teal-400 transition-all flex flex-col items-center justify-center gap-2 min-h-[100px]"
                  >
                    {photoPreviewFront ? (
                      <>
                        <img
                          src={photoPreviewFront}
                          alt="Front"
                          className="max-h-24 rounded-lg object-cover"
                        />
                        <span className="text-xs font-bold">Изменить</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">📄</span>
                        <span className="text-sm font-bold">Загрузить лицевую сторону</span>
                      </>
                    )}
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
                    Оборотная сторона (Back Side)
                  </label>
                  <input
                    ref={fileInputBackRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileBack}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputBackRef.current?.click()}
                    className="w-full py-4 rounded-xl border-2 border-dashed border-white/20 hover:border-teal-400/50 bg-slate-900/50 text-slate-400 hover:text-teal-400 transition-all flex flex-col items-center justify-center gap-2 min-h-[100px]"
                  >
                    {photoPreviewBack ? (
                      <>
                        <img
                          src={photoPreviewBack}
                          alt="Back"
                          className="max-h-24 rounded-lg object-cover"
                        />
                        <span className="text-xs font-bold">Изменить</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">📄</span>
                        <span className="text-sm font-bold">Загрузить оборотную сторону</span>
                      </>
                    )}
                  </button>
                </div>

                {submitError && (
                  <p className="text-red-400 text-sm font-medium" role="alert">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-slate-900 font-black text-sm uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Отправка...' : 'Отправить на проверку'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationPage;
