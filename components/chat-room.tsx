"use client";

import Pusher from "pusher-js";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserChatStatus } from "@/components/browser-chat-status";
import { ChatComposer, type ComposerPayload } from "@/components/chat-composer";
import { ImageLightbox } from "@/components/image-lightbox";
import { MemberAdminPanel } from "@/components/member-admin-panel";
import { MessageBubble } from "@/components/message-bubble";
import { VoiceCall } from "@/components/voice-call";
import { mentionsSender } from "@/lib/mentions";
import { PUSHER_CHANNEL, PUSHER_EVENT_MESSAGES_CHANGED, PUSHER_EVENT_TYPING_CHANGED } from "@/lib/realtime";
import { getMessageMinuteKey } from "@/lib/time";
import { getSenderLabel, type Member, type Message, type Sender } from "@/lib/types";

type ChatRoomProps = {
  sender: Sender;
  members: Member[];
  onMembersChange: (members: Member[]) => void;
  onSwitchIdentity: () => void;
};

const ADMIN_SENDER_ID = "CHEN";
const ADMIN_TITLE_TEXT = "trashchat";
const ADMIN_TITLE_TRIGGER = "chashtrat";

const MESSAGE_FALLBACK_POLLING_INTERVAL_MS = 5000;
const MESSAGE_REALTIME_HEALTH_CHECK_MS = 60000;
const MESSAGE_BACKGROUND_POLLING_INTERVAL_MS = 60000;
const INITIAL_MESSAGE_LIMIT = 40;
const OLDER_MESSAGE_LIMIT = 60;
const MESSAGE_LOAD_TOP_OFFSET_PX = 220;
const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1800;
const JPEG_QUALITIES = [0.82, 0.74, 0.66, 0.58];
const TYPING_IDLE_MS = 1200;
const TYPING_EXPIRE_MS = 3200;

type TitleLetter = {
  id: string;
  value: string;
};

function createTitleLetters() {
  return [...ADMIN_TITLE_TEXT].map((value, index) => ({
    id: `${value}-${index}`,
    value
  }));
}

function getTitleText(letters: TitleLetter[]) {
  return letters.map((letter) => letter.value).join("");
}

function sortMessagesByCreatedAt(messages: Message[]) {
  return [...messages].sort((first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime());
}

function getIsPageActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function hasReadMessage(message: Message, sender: Sender) {
  return (message.reads ?? []).some((read) => read.sender === sender);
}

function getUnreadIncomingMessages(messages: Message[], sender: Sender) {
  return messages.filter(
    (message) =>
      message.sender !== sender &&
      !message.clientStatus &&
      !message.recalledAt &&
      !hasReadMessage(message, sender)
  );
}

function getReadByLabels(message: Message, currentSender: Sender, members: readonly Member[]) {
  const readSenders = new Set(
    (message.reads ?? []).map((read) => read.sender).filter((readSender) => readSender !== currentSender)
  );

  return [...readSenders].map((readSender) => getSenderLabel(readSender, members));
}

function mergeLoadedMessages(currentMessages: Message[], loadedMessages: Message[]) {
  const messagesById = new Map(currentMessages.map((message) => [message.id, message]));

  loadedMessages.forEach((message) => {
    messagesById.set(message.id, message);
  });

  return sortMessagesByCreatedAt([...messagesById.values()]);
}

function getMessagePageUrl(limit: number, beforeMessage?: Message) {
  const searchParams = new URLSearchParams({
    limit: String(limit)
  });

  if (beforeMessage) {
    searchParams.set("beforeCreatedAt", beforeMessage.createdAt);
    searchParams.set("beforeId", beforeMessage.id);
  }

  return `/api/messages?${searchParams.toString()}`;
}

function getOptimisticId() {
  if (globalThis.crypto?.randomUUID) {
    return `optimistic-${globalThis.crypto.randomUUID()}`;
  }

  return `optimistic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toReplyMessage(message: Message): Message["replyTo"] {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    imageUrl: message.imageUrl,
    imageUrls: message.imageUrls ?? [],
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    recalledAt: message.recalledAt
  };
}

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("無法讀取圖片。"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("圖片壓縮失敗。"));
        }
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressImage(file: File) {
  if (file.size <= MAX_SERVER_UPLOAD_BYTES) {
    return file;
  }

  if (file.type === "image/gif") {
    throw new Error(`GIF 圖片太大，目前請使用 ${formatFileSize(MAX_SERVER_UPLOAD_BYTES)} 以下的圖片。`);
  }

  const image = await readImage(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("瀏覽器無法壓縮圖片。");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);

    if (blob.size <= MAX_SERVER_UPLOAD_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
        type: "image/jpeg",
        lastModified: Date.now()
      });
    }
  }

  throw new Error(`圖片太大，壓縮後仍超過 ${formatFileSize(MAX_SERVER_UPLOAD_BYTES)}。`);
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

export function ChatRoom({ sender, members, onMembersChange, onSwitchIdentity }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [titleLetters, setTitleLetters] = useState<TitleLetter[]>(() => createTitleLetters());
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [lightboxImages, setLightboxImages] = useState<{ urls: string[]; index: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [typingSender, setTypingSender] = useState<Sender | null>(null);
  const [isPageActive, setIsPageActive] = useState(true);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const loadMessagesPromiseRef = useRef<Promise<{ messages: Message[]; hasMore: boolean }> | null>(null);
  const loadOlderMessagesPromiseRef = useRef<Promise<{ messages: Message[]; hasMore: boolean }> | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const draggedTitleIndexRef = useRef<number | null>(null);
  const hasMoreOlderMessagesRef = useRef(true);
  const optimisticImageUrlsRef = useRef<Map<string, string>>(new Map());
  const realtimeConnectedRef = useRef(false);
  const typingStopTimerRef = useRef<number | null>(null);
  const otherTypingTimerRef = useRef<number | null>(null);
  const readSyncRef = useRef(false);
  const hasSentTypingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const mergeMessagesIntoState = useCallback((loadedMessages: Message[]) => {
    setMessages((currentMessages) => {
      const mergedMessages = mergeLoadedMessages(currentMessages, loadedMessages);
      messagesRef.current = mergedMessages;
      return mergedMessages;
    });
  }, []);

  const loadMessages = useCallback(async () => {
    if (loadMessagesPromiseRef.current) {
      return loadMessagesPromiseRef.current;
    }

    const request = (async () => {
      const response = await fetch(getMessagePageUrl(INITIAL_MESSAGE_LIMIT), {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("無法載入訊息");
      }

      const data = (await response.json()) as { messages: Message[]; hasMore: boolean };
      hasMoreOlderMessagesRef.current = data.hasMore || hasMoreOlderMessagesRef.current;
      mergeMessagesIntoState(data.messages);
      return data;
    })();

    loadMessagesPromiseRef.current = request;

    try {
      return await request;
    } finally {
      if (loadMessagesPromiseRef.current === request) {
        loadMessagesPromiseRef.current = null;
      }
    }
  }, [mergeMessagesIntoState]);

  const loadOlderMessages = useCallback(
    async (beforeMessage?: Message) => {
      if (loadOlderMessagesPromiseRef.current) {
        return loadOlderMessagesPromiseRef.current;
      }

      const oldestMessage =
        beforeMessage ??
        messagesRef.current.find((message) => !message.clientStatus && !message.id.startsWith("optimistic-"));

      if (!oldestMessage || !hasMoreOlderMessagesRef.current) {
        return {
          messages: [],
          hasMore: false
        };
      }

      const request = (async () => {
        setIsLoadingOlder(true);

        const response = await fetch(getMessagePageUrl(OLDER_MESSAGE_LIMIT, oldestMessage), {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("無法載入舊訊息");
        }

        const data = (await response.json()) as { messages: Message[]; hasMore: boolean };
        hasMoreOlderMessagesRef.current = data.hasMore;
        mergeMessagesIntoState(data.messages);
        return data;
      })();

      loadOlderMessagesPromiseRef.current = request;

      try {
        return await request;
      } finally {
        setIsLoadingOlder(false);

        if (loadOlderMessagesPromiseRef.current === request) {
          loadOlderMessagesPromiseRef.current = null;
        }
      }
    },
    [mergeMessagesIntoState]
  );

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        await loadMessages();

        if (isMounted) {
          setIsLoading(false);
        }
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
  }, [loadMessages, sender]);

  const handleMessageScroll = useCallback(() => {
    const container = scrollContainerRef.current;

    if (
      !container ||
      container.scrollTop > MESSAGE_LOAD_TOP_OFFSET_PX ||
      !hasMoreOlderMessagesRef.current ||
      loadOlderMessagesPromiseRef.current
    ) {
      return;
    }

    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;

    void loadOlderMessages()
      .then((page) => {
        if (page.messages.length === 0) {
          return;
        }

        window.requestAnimationFrame(() => {
          const nextContainer = scrollContainerRef.current;

          if (!nextContainer) {
            return;
          }

          nextContainer.scrollTop = nextContainer.scrollHeight - previousScrollHeight + previousScrollTop;
        });
      })
      .catch(() => undefined);
  }, [loadOlderMessages]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    let timeoutId: number | null = null;
    let isStopped = false;

    function getPollingDelay() {
      if (document.hidden) {
        return MESSAGE_BACKGROUND_POLLING_INTERVAL_MS;
      }

      return realtimeConnectedRef.current ? MESSAGE_REALTIME_HEALTH_CHECK_MS : MESSAGE_FALLBACK_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        void loadMessages()
          .catch(() => undefined)
          .finally(() => {
            if (!isStopped) {
              schedulePoll();
            }
          });
      }, delay);
    }

    function handleVisibilityChange() {
      schedulePoll();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (!key || !cluster) {
      realtimeConnectedRef.current = false;
      schedulePoll();

      return () => {
        isStopped = true;
        document.removeEventListener("visibilitychange", handleVisibilityChange);

        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const pusher = new Pusher(key, { cluster });
    const channel = pusher.subscribe(PUSHER_CHANNEL);
    const handleStateChange = ({ current }: { current: string }) => {
      const isConnected = current === "connected";
      const wasConnected = realtimeConnectedRef.current;
      realtimeConnectedRef.current = isConnected;

      if (wasConnected !== isConnected) {
        schedulePoll(isConnected ? MESSAGE_REALTIME_HEALTH_CHECK_MS : 0);
      }
    };

    pusher.connection.bind("state_change", handleStateChange);

    channel.bind(PUSHER_EVENT_MESSAGES_CHANGED, (event: { type?: string; sender?: Sender } | undefined) => {
      if (event?.type === "read" && event.sender === sender) {
        return;
      }

      void loadMessages().catch(() => undefined);
    });
    channel.bind(PUSHER_EVENT_TYPING_CHANGED, (event: { sender: Sender; isTyping: boolean }) => {
      if (event.sender === sender) {
        return;
      }

      if (otherTypingTimerRef.current) {
        window.clearTimeout(otherTypingTimerRef.current);
        otherTypingTimerRef.current = null;
      }

      setTypingSender(event.isTyping ? event.sender : null);

      if (event.isTyping) {
        otherTypingTimerRef.current = window.setTimeout(() => setTypingSender(null), TYPING_EXPIRE_MS);
      }
    });
    schedulePoll();

    return () => {
      isStopped = true;
      realtimeConnectedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (otherTypingTimerRef.current) {
        window.clearTimeout(otherTypingTimerRef.current);
      }
      pusher.connection.unbind("state_change", handleStateChange);
      channel.unbind_all();
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
  }, [loadMessages, sender]);

  useEffect(() => {
    const optimisticImageUrls = optimisticImageUrlsRef.current;

    return () => {
      optimisticImageUrls.forEach((url) => URL.revokeObjectURL(url));
      optimisticImageUrls.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      const typingStopTimer = typingStopTimerRef.current;
      const otherTypingTimer = otherTypingTimerRef.current;

      if (typingStopTimer) {
        window.clearTimeout(typingStopTimer);
      }
      if (otherTypingTimer) {
        window.clearTimeout(otherTypingTimer);
      }
    };
  }, []);

  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? "auto" : "smooth" });
  }, [isLoading, latestMessageId]);

  useEffect(() => {
    function syncPageActiveState() {
      setIsPageActive(getIsPageActive());
    }

    syncPageActiveState();
    window.addEventListener("focus", syncPageActiveState);
    window.addEventListener("blur", syncPageActiveState);
    document.addEventListener("visibilitychange", syncPageActiveState);
    document.addEventListener("pointerdown", syncPageActiveState);

    return () => {
      window.removeEventListener("focus", syncPageActiveState);
      window.removeEventListener("blur", syncPageActiveState);
      document.removeEventListener("visibilitychange", syncPageActiveState);
      document.removeEventListener("pointerdown", syncPageActiveState);
    };
  }, []);

  const editingLabel = useMemo(() => {
    if (!editing) {
      return null;
    }

    return editing.text || ((editing.imageUrls?.length ?? 0) > 0 || editing.imageUrl ? "圖片訊息" : "訊息");
  }, [editing]);

  const unreadIncomingMessages = useMemo(() => getUnreadIncomingMessages(messages, sender), [messages, sender]);

  const unreadMentionSender = useMemo(() => {
    for (let index = unreadIncomingMessages.length - 1; index >= 0; index -= 1) {
      const message = unreadIncomingMessages[index];

      if (mentionsSender(message.text, sender, members)) {
        return message.sender;
      }
    }

    return null;
  }, [members, sender, unreadIncomingMessages]);

  useEffect(() => {
    if (!isPageActive || unreadIncomingMessages.length === 0) {
      return;
    }

    const readAt = new Date().toISOString();
    const unreadMessageIds = unreadIncomingMessages.map((message) => message.id);

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        unreadMessageIds.includes(message.id) && !hasReadMessage(message, sender)
          ? {
              ...message,
              readAt: message.readAt ?? readAt,
              reads: [
                ...(message.reads ?? []),
                {
                  id: `optimistic-read-${message.id}-${sender}`,
                  messageId: message.id,
                  sender,
                  readAt
                }
              ]
            }
          : message
      )
    );

    if (readSyncRef.current) {
      return;
    }

    readSyncRef.current = true;

    void fetch("/api/messages/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sender, messageIds: unreadMessageIds })
    })
      .finally(() => {
        readSyncRef.current = false;
      });
  }, [isPageActive, sender, unreadIncomingMessages]);

  function focusMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId((current) => (current === messageId ? null : current)), 1400);
  }

  async function uploadImage(file: File) {
    const uploadFile = await compressImage(file);
    const formData = new FormData();
    formData.append("file", uploadFile);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "圖片上傳失敗"));
    }

    const data = (await response.json()) as { url: string };
    return data.url;
  }

  const sendTypingState = useCallback(
    async (isTyping: boolean) => {
      await fetch("/api/typing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender,
          isTyping
        })
      }).catch(() => undefined);
    },
    [sender]
  );

  const handleTypingActivity = useCallback(
    (isTyping: boolean) => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }

      if (!isTyping) {
        if (hasSentTypingRef.current) {
          hasSentTypingRef.current = false;
          void sendTypingState(false);
        }
        return;
      }

      if (!hasSentTypingRef.current) {
        hasSentTypingRef.current = true;
        void sendTypingState(true);
      }

      typingStopTimerRef.current = window.setTimeout(() => {
        if (hasSentTypingRef.current) {
          hasSentTypingRef.current = false;
          void sendTypingState(false);
        }
      }, TYPING_IDLE_MS);
    },
    [sendTypingState]
  );

  async function handleSubmit(payload: ComposerPayload) {
    handleTypingActivity(false);
    setIsSending(true);
    setError(null);

    try {
      if (editing) {
        const editingMessage = editing;
        const editedAt = new Date().toISOString();

        setEditing(null);
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === editingMessage.id
              ? {
                  ...message,
                  text: payload.text,
                  updatedAt: editedAt,
                  editedAt
                }
              : message
          )
        );

        const response = await fetch(`/api/messages/${editingMessage.id}`, {
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
          setMessages((currentMessages) =>
            currentMessages.map((message) => (message.id === editingMessage.id ? editingMessage : message))
          );
          throw new Error("編輯失敗，可能已超過 15 分鐘");
        }

        const data = (await response.json()) as { message: Message };
        setMessages((currentMessages) =>
          currentMessages.map((message) => (message.id === editingMessage.id ? data.message : message))
        );
        void loadMessages().catch(() => undefined);
      } else {
        const imageFiles = payload.files;
        const now = new Date().toISOString();
        const replyTarget = replyTo;
        const tempId = getOptimisticId();
        const localImageUrls = imageFiles.map((file, index) => {
          const localImageUrl = URL.createObjectURL(file);
          optimisticImageUrlsRef.current.set(`${tempId}-${index}`, localImageUrl);
          return localImageUrl;
        });
        const optimisticMessage: Message = {
          id: tempId,
          sender,
          text: payload.text || null,
          imageUrl: localImageUrls[0] ?? null,
          imageUrls: localImageUrls,
          createdAt: now,
          updatedAt: now,
          editedAt: null,
          recalledAt: null,
          readAt: null,
          reads: [],
          replyToMessageId: replyTarget?.id ?? null,
          replyTo: replyTarget ? toReplyMessage(replyTarget) : null,
          clientStatus: "sending"
        };

        setMessages((currentMessages) => sortMessagesByCreatedAt([...currentMessages, optimisticMessage]));
        setReplyTo(null);

        try {
          const uploadedImageUrls = await Promise.all(imageFiles.map((file) => uploadImage(file)));

          const response = await fetch("/api/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sender,
              text: payload.text || undefined,
              imageUrl: uploadedImageUrls[0],
              imageUrls: uploadedImageUrls,
              replyToMessageId: replyTarget?.id
            })
          });

          if (!response.ok) {
            throw new Error("訊息送出失敗");
          }

          const data = (await response.json()) as { message: Message };

          localImageUrls.forEach((_, index) => {
            const optimisticImageUrl = optimisticImageUrlsRef.current.get(`${tempId}-${index}`);
            if (optimisticImageUrl) {
              URL.revokeObjectURL(optimisticImageUrl);
              optimisticImageUrlsRef.current.delete(`${tempId}-${index}`);
            }
          });

          setMessages((currentMessages) =>
            sortMessagesByCreatedAt([
              ...currentMessages.filter((message) => message.id !== tempId && message.id !== data.message.id),
              data.message
            ])
          );
          void loadMessages().catch(() => undefined);
        } catch (sendError) {
          setMessages((currentMessages) =>
            currentMessages.map((message) => (message.id === tempId ? { ...message, clientStatus: "failed" } : message))
          );
          throw sendError;
        }
      }
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

  function moveTitleLetter(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }

    setTitleLetters((currentLetters) => {
      const nextLetters = [...currentLetters];
      const [movedLetter] = nextLetters.splice(fromIndex, 1);

      if (!movedLetter) {
        return currentLetters;
      }

      nextLetters.splice(toIndex, 0, movedLetter);

      if (sender === ADMIN_SENDER_ID && getTitleText(nextLetters).toLowerCase() === ADMIN_TITLE_TRIGGER) {
        window.setTimeout(() => {
          setIsAdminOpen(true);
          setTitleLetters(createTitleLetters());
        }, 0);
      }

      return nextLetters;
    });
  }

  return (
    <main className="flex h-dvh flex-col bg-paper text-ink">
      <BrowserChatStatus unreadCount={unreadIncomingMessages.length} mentionSender={unreadMentionSender} members={members} />

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
            {sender === ADMIN_SENDER_ID ? (
              <div className="inline-flex justify-center text-lg font-semibold leading-7" aria-label="拖曳 trashchat 字母">
                {titleLetters.map((letter, index) => (
                  <span
                    key={letter.id}
                    draggable
                    onDragStart={() => {
                      draggedTitleIndexRef.current = index;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromIndex = draggedTitleIndexRef.current;
                      draggedTitleIndexRef.current = null;

                      if (fromIndex !== null) {
                        moveTitleLetter(fromIndex, index);
                      }
                    }}
                    onDragEnd={() => {
                      draggedTitleIndexRef.current = null;
                    }}
                    className="inline-block cursor-grab select-none text-slate-950 active:cursor-grabbing"
                  >
                    {letter.value}
                  </span>
                ))}
              </div>
            ) : (
              <h1 className="truncate text-lg font-semibold">trashchat</h1>
            )}
            <p className="truncate text-xs text-slate-500">你是 {getSenderLabel(sender, members)}</p>
          </div>

          <div className="flex items-center gap-2">
            <VoiceCall sender={sender} members={members} />
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/20"
              aria-label="重新整理"
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
      </header>

      <section
        ref={scrollContainerRef}
        onScroll={handleMessageScroll}
        className="chat-scrollbar mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-y-auto px-3 py-5 sm:px-5"
      >
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm leading-7 text-slate-500">
            還沒有訊息。傳送第一則文字或圖片開始對話。
          </div>
        ) : (
          <>
            {isLoadingOlder ? (
              <div className="flex justify-center py-1">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
              </div>
            ) : null}
            {messages.map((message, index) => {
              const previousMessage = messages[index - 1];
              const showTimestamp =
                !previousMessage || getMessageMinuteKey(previousMessage.createdAt) !== getMessageMinuteKey(message.createdAt);

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  currentSender={sender}
                  members={members}
                  isHighlighted={highlightedId === message.id}
                  showTimestamp={showTimestamp}
                  readByLabels={
                    message.sender === sender && !message.clientStatus && !message.recalledAt
                      ? getReadByLabels(message, sender, members)
                      : null
                  }
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(message);
                  }}
                  onEdit={() => handleStartEdit(message)}
                  onRecall={() => void handleRecall(message)}
                  onOpenImages={(urls, index = 0) => setLightboxImages({ urls, index })}
                  onQuoteClick={focusMessage}
                />
              );
            })}
          </>
        )}
        {typingSender ? (
          <div className="flex justify-start px-1 text-sm text-slate-500">
            {getSenderLabel(typingSender, members)} 正在輸入...
          </div>
        ) : null}
        <div ref={bottomRef} />
      </section>

      {error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-center text-sm text-red-700">{error}</div>
      ) : null}

      <ChatComposer
        currentSender={sender}
        members={members}
        isSending={isSending}
        replyTo={replyTo}
        editing={editing}
        editingLabel={editingLabel}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onTypingActivity={handleTypingActivity}
        onSubmit={handleSubmit}
      />

      {isAdminOpen ? (
        <MemberAdminPanel members={members} onMembersChange={onMembersChange} onClose={() => setIsAdminOpen(false)} />
      ) : null}

      <ImageLightbox
        imageUrls={lightboxImages?.urls ?? []}
        initialIndex={lightboxImages?.index ?? 0}
        onClose={() => setLightboxImages(null)}
      />
    </main>
  );
}
