"use client";

/* eslint-disable @next/next/no-img-element */

import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LinkifiedText } from "@/components/linkified-text";
import { LinkPreviewCard } from "@/components/link-preview-card";
import { getFirstUrl } from "@/lib/links";
import { canEditMessage, formatMessageTime } from "@/lib/time";
import { getReplyPreview } from "@/lib/messages";
import { SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type MessageBubbleProps = {
  message: Message;
  currentSender: Sender;
  isHighlighted: boolean;
  showTimestamp: boolean;
  onReply: () => void;
  onEdit: () => void;
  onRecall: () => void;
  onOpenImage: (url: string) => void;
  onQuoteClick: (messageId: string) => void;
};

export function MessageBubble({
  message,
  currentSender,
  isHighlighted,
  showTimestamp,
  onReply,
  onEdit,
  onRecall,
  onOpenImage,
  onQuoteClick
}: MessageBubbleProps) {
  const isOwn = message.sender === currentSender;
  const isRecalled = Boolean(message.recalledAt);
  const isClientOnly = Boolean(message.clientStatus);
  const editable = isOwn && !isClientOnly && canEditMessage(message.createdAt, message.recalledAt);
  const hasVisibleContent = !isRecalled && (message.text || message.imageUrl);
  const hasStatus = Boolean(message.editedAt && !isRecalled) || Boolean(message.clientStatus);
  const showMeta = showTimestamp || hasStatus;
  const previewUrl = !isRecalled ? getFirstUrl(message.text) : null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  function runAction(action: () => void) {
    setIsMenuOpen(false);
    action();
  }

  return (
    <article
      id={`message-${message.id}`}
      className={clsx(
        "group flex w-full scroll-mt-20 gap-2 transition",
        isOwn ? "justify-end" : "justify-start",
        isHighlighted && "rounded-lg bg-yellow-100/70 py-2"
      )}
    >
      <div className={clsx("flex max-w-[90%] items-end gap-2 sm:max-w-[78%]", isOwn && "flex-row-reverse")}>
        <div className={clsx("flex min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
          {showMeta ? (
            <div className={clsx("flex items-center gap-2 text-xs text-slate-500", isOwn && "flex-row-reverse")}>
              {showTimestamp ? <span>{isOwn ? "你" : SENDER_LABEL[message.sender]}</span> : null}
              {showTimestamp ? <span>{formatMessageTime(message.createdAt)}</span> : null}
              {message.editedAt && !isRecalled ? <span>已編輯</span> : null}
              {message.clientStatus === "sending" ? <span>傳送中</span> : null}
              {message.clientStatus === "failed" ? <span className="text-red-600">傳送失敗</span> : null}
            </div>
          ) : null}

          <div
            className={clsx(
              "rounded-lg px-3 py-2 shadow-sm",
              isOwn ? "bg-brand text-white" : "bg-white text-ink",
              message.clientStatus === "sending" && "opacity-75",
              message.clientStatus === "failed" && "border border-red-200 bg-red-50 text-red-700",
              isRecalled && "border border-dashed border-slate-300 bg-transparent text-slate-500 shadow-none"
            )}
          >
            {message.replyTo && !isRecalled ? (
              <button
                type="button"
                onClick={() => onQuoteClick(message.replyTo?.id ?? "")}
                className={clsx(
                  "mb-2 flex w-full min-w-0 items-center gap-2 rounded-md border-l-4 px-2 py-2 text-left text-sm transition",
                  isOwn
                    ? "border-white/70 bg-white/15 text-white hover:bg-white/20"
                    : "border-brand bg-slate-50 text-slate-600 hover:bg-slate-100"
                )}
              >
                {message.replyTo.imageUrl && !message.replyTo.recalledAt ? (
                  <img
                    src={message.replyTo.imageUrl}
                    alt="回覆圖片縮圖"
                    className="h-9 w-9 shrink-0 rounded-md object-contain"
                  />
                ) : null}
                <span className="min-w-0 truncate">{getReplyPreview(message.replyTo)}</span>
              </button>
            ) : null}

            {isRecalled ? (
              <p className="text-sm italic">{isOwn ? "你已收回一則訊息" : "對方已收回一則訊息"}</p>
            ) : null}

            {message.imageUrl && !isRecalled ? (
              <button
                type="button"
                onClick={() => onOpenImage(message.imageUrl ?? "")}
                className="mb-2 block overflow-hidden rounded-md bg-black/5 focus:outline-none focus:ring-4 focus:ring-brand/20"
                aria-label="開啟圖片預覽"
              >
                <img
                  src={message.imageUrl}
                  alt="聊天圖片"
                  className="h-[220px] w-[min(70vw,360px)] rounded-md object-contain sm:h-[240px]"
                />
              </button>
            ) : null}

            {message.text && !isRecalled ? <LinkifiedText text={message.text} isOwn={isOwn} /> : null}

            {previewUrl ? <LinkPreviewCard url={previewUrl} /> : null}

            {!hasVisibleContent && !isRecalled ? <p className="text-sm text-slate-400">空訊息</p> : null}
          </div>
        </div>

        {!isClientOnly ? (
          <div
            ref={menuRef}
            className={clsx(
              "relative shrink-0 transition",
              isMenuOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-auto opacity-100 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
            )}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsMenuOpen((current) => !current);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-800"
              aria-label="訊息操作"
            >
              <MoreHorizontal size={15} />
            </button>
            {isMenuOpen ? (
              <div
                className={clsx(
                  "absolute bottom-10 z-10 min-w-28 rounded-lg border border-line bg-white p-1 text-sm shadow-soft",
                  isOwn ? "right-0" : "left-0"
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => runAction(onReply)} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50">
                  回覆
                </button>
                {editable ? (
                  <button type="button" onClick={() => runAction(onEdit)} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50">
                    編輯
                  </button>
                ) : null}
                {isOwn && !isRecalled ? (
                  <button
                    type="button"
                    onClick={() => runAction(onRecall)}
                    className="block w-full rounded-md px-3 py-2 text-left text-red-600 hover:bg-red-50"
                  >
                    收回
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
