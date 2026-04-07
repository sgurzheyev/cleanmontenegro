import React, { useEffect, useMemo, useState, useCallback } from 'react';
import CameraIcon from './icons/CameraIcon';
import TrashIcon from './icons/TrashIcon';
import { MAX_PHOTOS } from '../constants';
import { Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';

interface PhotoUploaderProps {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  language: Language;
}

const PhotoUploader: React.FC<PhotoUploaderProps> = ({ files, setFiles, language }) => {
  const { t } = useLocalization(language);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const handleFileChange = (newFiles: FileList | null) => {
    if (newFiles) {
      const filesToAdd = Array.from(newFiles).slice(0, MAX_PHOTOS - files.length);
      setFiles(prev => [...prev, ...filesToAdd]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);
  
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileChange(e.dataTransfer.files);
  }, [files.length]);

  // Create preview object URLs and revoke them to avoid memory leaks on mobile browsers.
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const previews = useMemo(() => files.map((file, index) => (
    <div key={index} className="relative w-24 h-24 rounded-lg overflow-hidden shadow-md">
      <img src={previewUrls[index] || ''} alt={file.name} className="w-full h-full object-cover" />
      <button
        onClick={() => removeFile(index)}
        className="absolute top-1 right-1 bg-red-500/80 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
      >
        <TrashIcon className="w-4 h-4" />
      </button>
    </div>
  )), [files]);

  return (
    <div className="w-full">
      <h3 className="text-lg font-bold text-gray-700">{t('photo_upload_title')}</h3>
      <p className="text-sm text-gray-500 mb-2">{t('photo_upload_subtitle')}</p>
      
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors duration-300 ${
          isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <input
          type="file"
          multiple
          accept="image/*"
          capture="environment" /* <-- ANTI-FRAUD: Блокирует галерею, заставляет использовать камеру */
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={(e) => {
            handleFileChange(e.target.files);
            e.target.value = ''; // FIX: Сброс инпута для возможности сделать следующее фото
          }}
          disabled={files.length >= MAX_PHOTOS}
        />
        <div className="flex flex-col items-center text-gray-500">
          <CameraIcon className="w-12 h-12 text-teal-400 mb-2" />
          <span className="font-semibold">{t('photo_upload_cta')}</span>
        </div>
      </div>
      
      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
          {previews}
        </div>
      )}
    </div>
  );
};

export default PhotoUploader;