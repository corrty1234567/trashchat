"use client";

/* eslint-disable @next/next/no-img-element */

import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";
import { canEditMessage, formatMessageTime } from "@/lib/time";
import { getReplyPreview } from "@/lib/messages";
import { SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type MessageBubbleProps = {
  message: Message;
  currentSender: Sender;
  isHighlighted: boolean;
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

  return (
    <article
      id={`message-${message.id}`}
      className={clsx(
        "group flex w-full scroll-mt-20 gap-2 transition",
        isOwn ? "justify-end" : "justify-start",
        isHighlighted && "rounded-lg bg-yellow-100/70 py-2"
      )}
    >
      <div className={clsx("flex max-w-[86%] flex-col gap-1 sm:max-w-[72%]", isOwn ? "items-end" : "items-start")}>
        <div className={clsx("flex items-center gap-2 text-xs text-slate-500", isOwn && "flex-row-reverse")}>
          <span>{isOwn ? "你" : SENDER_LABEL[message.sender]}</span>
          <span>{formatMessageTime(message.createdAt)}</span>
          {message.editedAt && !isRecalled ? <span>已編輯</span> : null}
          {message.clientStatus === "sending" ? <span>傳送中</span> : null}
          {message.clientStatus === "failed" ? <span className="text-red-600">傳送失敗</span> : null}
        </div>

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

          {message.text && !isRecalled ? <p className="whitespace-pre-wrap break-words text-[15px] leading-6">{message.text}</p> : null}

          {!hasVisibleContent && !isRecalled ? <p className="text-sm text-slate-400">空訊息</p> : null}
        </div>

        {!isClientOnly ? (
          <details className={clsx("relative", isOwn ? "text-right" : "text-left")}>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-white hover:text-slate-800">
              <MoreHorizontal size={15} />
              操作
            </summary>
            <div
              className={clsx(
                "absolute z-10 mt-1 min-w-28 rounded-lg border border-line bg-white p-1 text-sm shadow-soft",
                isOwn ? "right-0" : "left-0"
              )}
            >
              <button type="button" onClick={onReply} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50">
                回覆
              </button>
              {editable ? (
                <button type="button" onClick={onEdit} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50">
                  編輯
                </button>
              ) : null}
              {isOwn && !isRecalled ? (
                <button type="button" onClick={onRecall} className="block w-full rounded-md px-3 py-2 text-left text-red-600 hover:bg-red-50">
                  收回
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}
