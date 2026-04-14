"use client";

import Pusher from "pusher-js";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer, type ComposerPayload } from "@/components/chat-composer";
import { ImageLightbox } from "@/components/image-lightbox";
import { MessageBubble } from "@/components/message-bubble";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED } from "@/lib/realtime";
import { OTHER_SENDER, SENDER_LABEL, type Message, type Sender } from "@/lib/types";

type ChatRoomProps = {
  sender: Sender;
  onSwitchIdentity: () => void;
};

export function ChatRoom({ sender, onSwitchIdentity }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const otherSender = OTHER_SENDER[sender];

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/messages", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("無法載入訊息");
    }

    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        await loadMessages();
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "無法載入訊息");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, [loadMessages]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (!key || !cluster) {
      const intervalId = window.setInterval(() => {
        void loadMessages().catch(() => undefined);
      }, 4000);

      return () => window.clearInterval(intervalId);
    }

    const pusher = new Pusher(key, { cluster });
    const channel = pusher.subscribe(PUSHER_CHANNEL);

    channel.bind(PUSHER_EVENT_MESSAGES_CHANGED, () => {
      void loadMessages().catch(() => undefined);
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? "auto" : "smooth" });
  }, [messages.length, isLoading]);

  const editingLabel = useMemo(() => {
    if (!editing) {
      return null;
    }

    return editing.text || (editing.imageUrl ? "圖片訊息" : "訊息");
  }, [editing]);

  function focusMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId((current) => (current === messageId ? null : current)), 1400);
  }

  async function uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error("圖片上傳失敗");
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  async function handleSubmit(payload: ComposerPayload) {
    setIsSending(true);
    setError(null);

    try {
      if (editing) {
        const response = await fetch(`/api/messages/${editing.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender,
            text: payload.text
          })
        });

        if (!response.ok) {
          throw new Error("編輯失敗，可能已超過 15 分鐘");
        }

        setEditing(null);
      } else {
        const imageUrl = payload.file ? await uploadImage(payload.file) : undefined;

        const response = await fetch("/api/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender,
            text: payload.text || undefined,
            imageUrl,
            replyToMessageId: replyTo?.id
          })
        });

        if (!response.ok) {
          throw new Error("訊息送出失敗");
        }

        setReplyTo(null);
      }

      await loadMessages();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失敗");
    } finally {
      setIsSending(false);
    }
  }

  async function handleRecall(message: Message) {
    setError(null);

    try {
      const response = await fetch(`/api/messages/${message.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sender })
      });

      if (!response.ok) {
        throw new Error("收回失敗");
      }

      if (editing?.id === message.id) {
        setEditing(null);
      }

      await loadMessages();
    } catch (recallError) {
      setError(recallError instanceof Error ? recallError.message : "收回失敗");
    }
  }

  function handleStartEdit(message: Message) {
    setReplyTo(null);
    setEditing(message);
  }

  return (
    <main className="flex h-dvh flex-col bg-paper text-ink">
      <header className="border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSwitchIdentity}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
          >
            <ArrowLeft size={17} />
            換身分
          </button>

          <div className="min-w-0 text-center">
            <h1 className="truncate text-lg font-semibold">chorchat</h1>
            <p className="truncate text-xs text-slate-500">
              你是 {SENDER_LABEL[sender]}，正在與 {SENDER_LABEL[otherSender]} 對話
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadMessages()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
            aria-label="重新整理"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <section className="chat-scrollbar mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-3 py-5 sm:px-5">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm leading-7 text-slate-500">
            還沒有訊息。傳送第一則文字或圖片開始對話。
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentSender={sender}
              isHighlighted={highlightedId === message.id}
              onReply={() => {
                setEditing(null);
                setReplyTo(message);
              }}
              onEdit={() => handleStartEdit(message)}
              onRecall={() => void handleRecall(message)}
              onOpenImage={setLightboxUrl}
              onQuoteClick={focusMessage}
            />
          ))
        )}
        <div ref={bottomRef} />
      </section>

      {error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-center text-sm text-red-700">{error}</div>
      ) : null}

      <ChatComposer
        isSending={isSending}
        replyTo={replyTo}
        editing={editing}
        editingLabel={editingLabel}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSubmit={handleSubmit}
      />

      <ImageLightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </main>
  );
}
