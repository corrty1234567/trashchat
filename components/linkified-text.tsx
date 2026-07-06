"use client";

import clsx from "clsx";
import { URL_PATTERN, normalizeUrlMatch } from "@/lib/links";
import { splitMentionText } from "@/lib/mentions";
import type { Member } from "@/lib/types";

type LinkifiedTextProps = {
  text: string;
  isOwn: boolean;
  members: readonly Member[];
};

export function LinkifiedText({ text, isOwn, members }: LinkifiedTextProps) {
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

  function renderTextPart(value: string, partIndex: number) {
    return splitMentionText(value, members).map((part, mentionIndex) =>
      part.type === "mention" ? (
        <span
          key={`${part.value}-${partIndex}-${mentionIndex}`}
          className={clsx(
            "inline-flex rounded px-1 font-semibold",
            isOwn ? "bg-white/20 text-white" : "bg-brand/10 text-brand"
          )}
        >
          {part.value}
        </span>
      ) : (
        <span key={`${part.value}-${partIndex}-${mentionIndex}`}>{part.value}</span>
      )
    );
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
          renderTextPart(part.value, index)
        )
      )}
    </p>
  );
}
