"use client";

/* eslint-disable @next/next/no-img-element */

import clsx from "clsx";
import { CheckCheck, MoreHorizontal, Pencil, Reply, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LinkifiedText } from "@/components/linkified-text";
import { LinkPreviewCard } from "@/components/link-preview-card";
import { getFirstUrl } from "@/lib/links";
import { getMessageImageUrls, getMessageThumbnailUrls, getReplyPreview } from "@/lib/messages";
import { canEditMessage, formatMessageTime } from "@/lib/time";
import { getSenderLabel, type Member, type Message, type Sender } from "@/lib/types";

type MessageBubbleProps = {
  message: Message;
  currentSender: Sender;
  isHighlighted: boolean;
  showTimestamp: boolean;
  members: readonly Member[];
  readByLabels: string[] | null;
  onReply: () => void;
  onEdit: () => void;
  onRecall: () => void;
  onOpenImages: (urls: string[], index?: number) => void;
  onQuoteClick: (messageId: string) => void;
};

type MessageImageStackProps = {
  imageUrls: string[];
  thumbnailUrls: string[];
  isOwn: boolean;
  senderLabel: string;
  onOpenImages: (urls: string[], index?: number) => void;
};

function MessageImageStack({ imageUrls, thumbnailUrls, isOwn, senderLabel, onOpenImages }: MessageImageStackProps) {
  if (imageUrls.length === 0) {
    return null;
  }

  const previewUrls = thumbnailUrls.length > 0 ? thumbnailUrls : imageUrls;

  if (imageUrls.length === 1) {
    return (
      <button
        type="button"
        onClick={() => onOpenImages(imageUrls, 0)}
        className="mb-2 block max-w-full overflow-hidden rounded-md bg-black/5 focus:outline-none focus:ring-4 focus:ring-brand/20"
        aria-label="開啟圖片預覽"
      >
        <img
          src={previewUrls[0] ?? imageUrls[0]}
          alt="聊天圖片"
          loading="lazy"
          decoding="async"
          className="h-[220px] w-[min(70vw,360px)] max-w-full rounded-md object-contain sm:h-[240px]"
        />
      </button>
    );
  }

  return (
    <div className="mb-2">
      <div className={clsx("grid h-[220px] w-[min(63vw,320px)] max-w-full grid-cols-2 gap-1.5 sm:h-[240px]", imageUrls.length >= 3 ? "grid-rows-2" : "grid-rows-1")}>
        {imageUrls.slice(0, 4).map((url, index) => <button key={`${url}-${index}`} type="button" onClick={() => onOpenImages(imageUrls, index)} aria-label={`開啟 ${senderLabel} 的第 ${index + 1} 張圖片`} className={clsx("relative min-h-0 overflow-hidden rounded-md bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand", imageUrls.length === 3 && index === 2 && "col-span-2")}>
          <img src={previewUrls[index] || url} alt="聊天圖片" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          {index === 3 && imageUrls.length > 4 ? <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xl font-medium text-white">+{imageUrls.length - 4}</span> : null}
        </button>)}
      </div>
      <p className={clsx("mt-1.5 text-[11px]", isOwn ? "text-white/65" : "text-slate-400")}>{imageUrls.length} 張圖片</p>
    </div>
  );
}

export function MessageBubble({
  message,
  currentSender,
  isHighlighted,
  showTimestamp,
  members,
  readByLabels,
  onReply,
  onEdit,
  onRecall,
  onOpenImages,
  onQuoteClick
}: MessageBubbleProps) {
  const isOwn = message.sender === currentSender;
  const isRecalled = Boolean(message.recalledAt);
  const isClientOnly = Boolean(message.clientStatus);
  const editable = isOwn && !isClientOnly && canEditMessage(message.createdAt, message.recalledAt);
  const imageUrls = isRecalled ? [] : getMessageImageUrls(message);
  const thumbnailUrls = isRecalled ? [] : getMessageThumbnailUrls(message);
  const hasVisibleContent = !isRecalled && (message.text || imageUrls.length > 0);
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
      <div className={clsx("flex max-w-[94%] items-end gap-1.5 sm:max-w-[80%] sm:gap-2 2xl:max-w-[70%]", isOwn && "flex-row-reverse")}>
        <div className={clsx("flex min-w-0 flex-col gap-1", isOwn ? "items-end" : "items-start")}>
          {showMeta ? (
            <div className={clsx("flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5 text-[13px] text-slate-500", isOwn && "flex-row-reverse")}>
              {showTimestamp ? <span className="max-w-full truncate font-semibold text-slate-600" title={getSenderLabel(message.sender, members)}>{isOwn ? "你" : getSenderLabel(message.sender, members)}</span> : null}
              {showTimestamp ? <span>{formatMessageTime(message.createdAt)}</span> : null}
              {message.editedAt && !isRecalled ? <span>已編輯</span> : null}
              {message.clientStatus === "sending" ? <span>傳送中</span> : null}
              {message.clientStatus === "failed" ? <span className="text-red-600">傳送失敗</span> : null}
            </div>
          ) : null}

          <div
            className={clsx(
              "max-w-full rounded-lg border px-4 py-3",
              isRecalled ? "border-dashed border-slate-300 bg-transparent text-slate-500" :
                message.clientStatus === "failed" ? "border-red-200 bg-red-50 text-red-700" :
                  isOwn ? "border-brand bg-brand text-white" : "border-line/70 bg-white text-ink",
              message.clientStatus === "sending" && "opacity-75"
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
                {getMessageThumbnailUrls(message.replyTo).length > 0 && !message.replyTo.recalledAt ? (
                  <img
                    src={getMessageThumbnailUrls(message.replyTo)[0]}
                    alt="回覆圖片縮圖"
                    loading="lazy"
                    decoding="async"
                    className="h-9 w-9 shrink-0 rounded-md object-contain"
                  />
                ) : null}
                <span className="min-w-0 truncate">{getReplyPreview(message.replyTo)}</span>
              </button>
            ) : null}

            {isRecalled ? (
              <p className="text-sm italic">{isOwn ? "你已收回一則訊息" : "對方已收回一則訊息"}</p>
            ) : null}

            <MessageImageStack
              imageUrls={imageUrls}
              thumbnailUrls={thumbnailUrls}
              isOwn={isOwn}
              senderLabel={isOwn ? "你" : getSenderLabel(message.sender, members)}
              onOpenImages={onOpenImages}
            />

            {message.text && !isRecalled ? <LinkifiedText text={message.text} isOwn={isOwn} members={members} /> : null}

            {previewUrl ? <LinkPreviewCard url={previewUrl} /> : null}

            {!hasVisibleContent && !isRecalled ? <p className="text-sm text-slate-400">空訊息</p> : null}
          </div>
          {readByLabels ? (
            <div className={clsx("flex max-w-full flex-wrap items-center gap-1 px-1 text-xs text-slate-500", isOwn ? "justify-end text-right" : "text-left")}>
              {readByLabels.length > 0 ? <CheckCheck size={12} className="shrink-0 text-brand/70" /> : null}
              <span className="min-w-0 break-words">{readByLabels.length > 0 ? `已讀 ${readByLabels.join("、")}` : "未讀"}</span>
            </div>
          ) : null}
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
              title="訊息操作"
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
                <button
                  type="button"
                  onClick={() => runAction(onReply)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-50"
                >
                  <Reply size={14} />回覆
                </button>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => runAction(onEdit)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <Pencil size={14} />編輯
                  </button>
                ) : null}
                {isOwn && !isRecalled ? (
                  <button
                    type="button"
                    onClick={() => runAction(onRecall)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-red-600 hover:bg-red-50"
                  >
                    <Undo2 size={14} />收回
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
