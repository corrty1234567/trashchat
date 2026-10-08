"use client";

/* eslint-disable @next/next/no-img-element */

import { ChevronLeft, ChevronRight, Download, FolderDown, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImageDownload } from "@/lib/use-image-download";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type ImageLightboxProps = {
  imageUrls: string[];
  initialIndex?: number;
  onClose: () => void;
};

export function ImageLightbox({ imageUrls, initialIndex = 0, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const safeImageUrls = useMemo(() => imageUrls.filter(Boolean), [imageUrls]);
  const hasMultipleImages = safeImageUrls.length > 1;
  const imageUrl = safeImageUrls[currentIndex] ?? null;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [imageError, setImageError] = useState(false);
  const download = useImageDownload();
  useDialogFocus(dialogRef, onClose, Boolean(imageUrl));

  useEffect(() => {
    setCurrentIndex(Math.min(Math.max(initialIndex, 0), Math.max(safeImageUrls.length - 1, 0)));
  }, [initialIndex, safeImageUrls.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        setCurrentIndex((index) => Math.max(0, index - 1));
      }

      if (event.key === "ArrowRight") {
        setCurrentIndex((index) => Math.min(safeImageUrls.length - 1, index + 1));
      }
    }

    if (imageUrl) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageUrl, safeImageUrls.length]);

  useEffect(() => setImageError(false), [imageUrl]);

  if (!imageUrl) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[1100] bg-[#111416]/95 text-white backdrop-blur-sm"
      onClick={onClose}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="圖片預覽" tabIndex={-1} className="h-full outline-none" onClick={event => event.stopPropagation()}>
        <header className="absolute inset-x-0 top-0 flex h-20 items-center justify-between gap-3 border-b border-white/10 px-4 sm:px-6">
          <p className="shrink-0 text-sm tabular-nums text-white/70">{currentIndex + 1} / {safeImageUrls.length}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void download.start([{ url: imageUrl }])} disabled={download.isDownloading} className="lightbox-button" title="下載原圖" aria-label="下載原圖">{download.isDownloading ? <Loader2 size={19} className="animate-spin" /> : <Download size={19} />}</button>
            {hasMultipleImages ? <button type="button" onClick={() => void download.start(safeImageUrls.map(url => ({ url })), true)} disabled={download.isDownloading} className="lightbox-button" title="下載這組圖片 ZIP" aria-label="下載這組圖片 ZIP"><FolderDown size={19} /></button> : null}
            <button type="button" data-autofocus onClick={onClose} className="lightbox-button" title="關閉圖片預覽" aria-label="關閉圖片預覽"><X size={21} /></button>
          </div>
        </header>
        {download.error || download.isDownloading ? <div className="absolute inset-x-4 top-[5.5rem] z-10 flex flex-wrap items-center justify-center gap-3 text-center text-sm" role={download.error ? "alert" : "status"}><span className={download.error ? "text-red-300" : "text-white/80"}>{download.error || (download.progress?.phase === "packing" ? "正在打包…" : download.progress ? `正在下載 ${download.progress.completed} / ${download.progress.total}` : "正在下載…")}</span>{download.isDownloading ? <button type="button" onClick={download.cancel} className="underline">取消</button> : null}</div> : null}
        <div className="absolute inset-x-0 bottom-20 top-24 flex items-center justify-center px-12 py-6 sm:px-20" onClick={onClose}>
          {imageError ? <p className="text-sm text-white/60">圖片已失效或無法載入</p> : <img key={imageUrl} src={imageUrl} alt="圖片放大預覽" onError={() => setImageError(true)} className="max-h-full max-w-full rounded-md object-contain" onClick={event => event.stopPropagation()} />}
        </div>
        {hasMultipleImages ? <>
          <button type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex(index => Math.max(0, index - 1))} className="lightbox-button absolute left-2 top-1/2 -translate-y-1/2 sm:left-5" title="上一張" aria-label="上一張"><ChevronLeft size={24} /></button>
          <button type="button" disabled={currentIndex === safeImageUrls.length - 1} onClick={() => setCurrentIndex(index => Math.min(safeImageUrls.length - 1, index + 1))} className="lightbox-button absolute right-2 top-1/2 -translate-y-1/2 sm:right-5" title="下一張" aria-label="下一張"><ChevronRight size={24} /></button>
          <nav aria-label="圖片縮圖" className="absolute inset-x-4 bottom-4 overflow-x-auto pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex w-max gap-2">
              {safeImageUrls.map((url, index) => <button type="button" key={`${url}-${index}`} onClick={() => setCurrentIndex(index)} aria-label={`第 ${index + 1} 張圖片`} aria-current={index === currentIndex ? "true" : undefined} className={`h-12 w-12 shrink-0 overflow-hidden rounded border-2 ${index === currentIndex ? "border-white" : "border-transparent opacity-50 hover:opacity-100"}`}><img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /></button>)}
            </div>
          </nav>
        </> : null}
      </div>
    </div>
  );
}
