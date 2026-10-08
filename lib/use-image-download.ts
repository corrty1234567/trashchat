"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadImageArchive, downloadSingleImage, type DownloadImage, type DownloadProgress } from "@/lib/image-download";

export function useImageDownload() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { controllerRef.current?.abort(); controllerRef.current = null; }, []);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const start = useCallback(async (images: readonly DownloadImage[], archive = false) => {
    if (!images.length || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsDownloading(true);
    setError(null);
    setProgress(null);
    try {
      if (archive) await downloadImageArchive(images, controller.signal, value => {
        if (controllerRef.current === controller) setProgress(value);
      });
      else await downloadSingleImage(images[0], controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller) {
        setError(error instanceof Error ? error.message : "下載失敗，請再試一次。");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsDownloading(false);
        setProgress(null);
      }
    }
  }, []);
  return { start, cancel, isDownloading, progress, error };
}
