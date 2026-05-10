"use client";

/* eslint-disable @next/next/no-img-element */

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    setCurrentIndex(Math.min(Math.max(initialIndex, 0), Math.max(safeImageUrls.length - 1, 0)));
  }, [initialIndex, safeImageUrls.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

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
  }, [imageUrl, onClose, safeImageUrls.length]);

  if (!imageUrl) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-md bg-white/95 text-slate-900 shadow-soft transition hover:bg-white"
        aria-label="關閉圖片預覽"
      >
        <X size={22} />
      </button>

      {hasMultipleImages ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-white/95 px-3 py-2 text-sm font-medium text-slate-900">
          {currentIndex + 1} / {safeImageUrls.length}
        </div>
      ) : null}

      {hasMultipleImages && currentIndex > 0 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setCurrentIndex((index) => Math.max(0, index - 1));
          }}
          className="absolute left-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-white/95 text-slate-900 shadow-soft transition hover:bg-white"
          aria-label="上一張"
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}

      <img
        src={imageUrl}
        alt="圖片放大預覽"
        className="max-h-[88dvh] max-w-[92vw] rounded-lg object-contain shadow-soft"
        onClick={(event) => event.stopPropagation()}
      />

      {hasMultipleImages && currentIndex < safeImageUrls.length - 1 ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setCurrentIndex((index) => Math.min(safeImageUrls.length - 1, index + 1));
          }}
          className="absolute right-4 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-white/95 text-slate-900 shadow-soft transition hover:bg-white"
          aria-label="下一張"
        >
          <ChevronRight size={24} />
        </button>
      ) : null}
    </div>
  );
}
