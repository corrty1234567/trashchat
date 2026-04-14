"use client";

/* eslint-disable @next/next/no-img-element */

import { X } from "lucide-react";
import { useEffect } from "react";

type ImageLightboxProps = {
  imageUrl: string | null;
  onClose: () => void;
};

export function ImageLightbox({ imageUrl, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    if (imageUrl) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageUrl, onClose]);

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
      <img
        src={imageUrl}
        alt="圖片放大預覽"
        className="max-h-[88dvh] max-w-[92vw] rounded-lg object-contain shadow-soft"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
