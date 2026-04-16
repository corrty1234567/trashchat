"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";

type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

type LinkPreviewCardProps = {
  url: string | null;
};

export function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      setIsUnavailable(false);
      return;
    }

    const previewUrl = url;
    let isMounted = true;

    async function loadPreview() {
      setIsUnavailable(false);

      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(previewUrl)}`, {
          cache: "force-cache"
        });

        if (!response.ok) {
          throw new Error("Preview unavailable.");
        }

        const data = (await response.json()) as LinkPreview;

        if (isMounted) {
          setPreview(data);
        }
      } catch {
        if (isMounted) {
          setPreview(null);
          setIsUnavailable(true);
        }
      }
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [url]);

  if (!url || isUnavailable || !preview) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 block w-[min(70vw,420px)] overflow-hidden rounded-lg bg-white text-ink shadow-sm transition hover:brightness-95"
    >
      {preview.image ? (
        <img src={preview.image} alt="" className="h-40 w-full bg-black object-cover" referrerPolicy="no-referrer" />
      ) : null}
      <div className="space-y-1 p-3">
        {preview.title ? <p className="line-clamp-2 text-sm font-semibold leading-5">{preview.title}</p> : null}
        {preview.description ? <p className="line-clamp-2 text-xs leading-5 text-slate-600">{preview.description}</p> : null}
        {preview.siteName ? <p className="truncate text-xs uppercase tracking-wide text-slate-500">{preview.siteName}</p> : null}
      </div>
    </a>
  );
}
