"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, CheckSquare2, Download, ImageIcon, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImageLightbox } from "@/components/image-lightbox";
import type { ChatImage, ImagePage } from "@/lib/chat-images";
import { MAX_DOWNLOAD_IMAGES } from "@/lib/image-download";
import { useImageDownload } from "@/lib/use-image-download";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { getSenderLabel, type Member } from "@/lib/types";

export function ChatMediaGallery({ members, onClose }: { members: readonly Member[]; onClose: () => void }) {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [cursor, setCursor] = useState<ImagePage["nextCursor"]>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ChatImage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const download = useImageDownload();
  useDialogFocus(dialogRef, onClose);
  const load = useCallback(async (before: ImagePage["nextCursor"] = null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(before || {});
      const response = await fetch(`/api/images?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("無法載入圖片，請再試一次。");
      const data: ImagePage = await response.json();
      if (controller.signal.aborted) return;
      setImages(current => before ? [...new Map([...current, ...data.images].map(image => [image.id, image])).values()] : data.images);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "無法載入圖片。");
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);
  useEffect(() => { void load(); return () => requestRef.current?.abort(); }, [load]);
  function toggle(image: ChatImage) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(image.id)) next.delete(image.id);
      else if (next.size < MAX_DOWNLOAD_IMAGES) next.add(image.id);
      return next;
    });
  }
  const selection = images.filter(image => selected.has(image.id));
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="聊天圖片" tabIndex={-1} className="flex h-dvh w-full max-w-xl flex-col bg-white shadow-soft outline-none" onClick={event => event.stopPropagation()}>
        <header className="flex min-h-20 items-center justify-between gap-3 border-b border-line px-5">
          <div className="flex items-center gap-3"><ImageIcon size={20} className="text-brand" /><div><h2 className="text-base font-semibold">聊天圖片</h2><p className="mt-0.5 text-xs text-slate-500">{images.length} 張{hasMore ? "+" : ""}</p></div></div>
          <button data-autofocus type="button" onClick={onClose} className="icon-button" title="關閉圖片" aria-label="關閉圖片"><X size={20} /></button>
        </header>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className="text-sm text-slate-500">已選 {selected.size} / {MAX_DOWNLOAD_IMAGES}</span>
          <button type="button" disabled={download.isDownloading || !images.length} onClick={() => setSelected(current => current.size ? new Set() : new Set(images.slice(0, MAX_DOWNLOAD_IMAGES).map(image => image.id)))} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-40"><CheckSquare2 size={16} />{selected.size ? "取消選取" : "選取圖片"}</button>
        </div>
        <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          {!isLoading && !images.length && !error ? <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400"><ImageIcon size={36} strokeWidth={1.3} /><p className="text-sm">還沒有圖片</p></div> : null}
          <div className="grid grid-cols-3 gap-3">
            {images.map(image => (
              <div key={image.id} className="group relative min-w-0">
                <button type="button" onClick={() => setPreview(image)} className="block aspect-square w-full overflow-hidden rounded-md border border-line bg-paper focus-visible:ring-2 focus-visible:ring-brand" aria-label={`預覽 ${getSenderLabel(image.sender, members)} 的圖片`}><img src={image.thumbnailUrl} alt="聊天圖片" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" /></button>
                <label className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-white/95 shadow-sm">
                  <input type="checkbox" checked={selected.has(image.id)} disabled={download.isDownloading || (!selected.has(image.id) && selected.size >= MAX_DOWNLOAD_IMAGES)} onChange={() => toggle(image)} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" aria-label={`選取圖片 ${image.id}`} />
                  <span className="pointer-events-none flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-transparent peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-disabled:opacity-40"><Check size={15} /></span>
                </label>
                <p className="mt-1.5 truncate text-xs text-slate-500">{getSenderLabel(image.sender, members)}<span className="ml-2 text-slate-400">{new Date(image.createdAt).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</span></p>
              </div>
            ))}
          </div>
          {isLoading ? <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-brand" /></div> : null}
          {error ? <div role="alert" className="py-4 text-center text-sm text-red-600">{error}<button type="button" onClick={() => void load(images.length ? cursor : null)} className="ml-2 underline">重試</button></div> : null}
          {hasMore && !isLoading && !error ? <button type="button" onClick={() => void load(cursor)} className="mt-5 w-full rounded-md border border-line py-2.5 text-sm text-slate-600 hover:bg-paper">載入更多</button> : null}
        </div>
        <footer className="border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {download.error ? <p role="alert" className="mb-3 text-sm text-red-600">{download.error}</p> : null}
          {download.isDownloading ? <div className="mb-3 flex items-center justify-between gap-3 text-sm text-slate-500"><span role="status">{download.progress?.phase === "packing" ? "正在打包…" : `正在下載 ${download.progress?.completed ?? 0} / ${download.progress?.total ?? 1}`}</span><button type="button" onClick={download.cancel} className="text-slate-700 underline">取消</button></div> : null}
          <button type="button" disabled={!selection.length || download.isDownloading} onClick={() => void download.start(selection, true)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-brand text-sm font-semibold text-white transition hover:brightness-110 disabled:bg-slate-200 disabled:text-slate-400">{download.isDownloading ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}下載 {selection.length} 張圖片</button>
        </footer>
      </section>
      {preview ? <ImageLightbox key={preview.id} imageUrls={[preview.url]} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
