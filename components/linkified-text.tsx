"use client";

import clsx from "clsx";
import { URL_PATTERN, normalizeUrlMatch } from "@/lib/links";

type LinkifiedTextProps = {
  text: string;
  isOwn: boolean;
};

export function LinkifiedText({ text, isOwn }: LinkifiedTextProps) {
  const parts: Array<{ type: "text" | "link"; value: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const url = normalizeUrlMatch(rawUrl);
    const trailingText = rawUrl.slice(url.length);
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, index) });
    }

    parts.push({ type: "link", value: url });
    if (trailingText) {
      parts.push({ type: "text", value: trailingText });
    }
    lastIndex = index + rawUrl.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
      {parts.map((part, index) =>
        part.type === "link" ? (
          <a
            key={`${part.value}-${index}`}
            href={part.value}
            target="_blank"
            rel="noreferrer"
            className={clsx("underline underline-offset-2", isOwn ? "text-white" : "text-brand")}
          >
            {part.value}
          </a>
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        )
      )}
    </p>
  );
}
