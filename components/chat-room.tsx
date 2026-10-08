"use client";

import { ArrowDown, Images, Menu, MessageCircle, RefreshCw, Search, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AdminSnakeGate } from "@/components/admin-snake-gate";
import { BrowserChatStatus } from "@/components/browser-chat-status";
import { ChatComposer, type ComposerPayload } from "@/components/chat-composer";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ImageLightbox } from "@/components/image-lightbox";
import { MemberAdminPanel } from "@/components/member-admin-panel";
import { MessageBubble } from "@/components/message-bubble";
import { VoiceCall, type VoiceCallOpenRequest } from "@/components/voice-call";
import { AUTO_FOLLOW_MESSAGE_LIMIT, buildMessageLayout, buildVirtualMetrics, getEstimatedMessageHeight, getMessagesBelowViewport, shouldFollowLatest, type MessageLayout, type VirtualViewport } from "@/lib/chat-scroll";
import { mentionsSender } from "@/lib/mentions";
import { applyReadReceipts, mergeLoadedMessages, sortMessagesByCreatedAt, toReplyMessage } from "@/lib/message-state";
import { PUSHER_EVENT_MESSAGES_CHANGED, PUSHER_EVENT_TYPING_CHANGED, type MessageChangedEvent } from "@/lib/realtime";
import { connectPrivateRealtime } from "@/lib/pusher-client";
import { formatMessageTime, getMessageMinuteKey } from "@/lib/time";
import { getSenderLabel, type Member, type Message, type Sender } from "@/lib/types";
import { findUnreadBoundary, type UnreadBoundary } from "@/lib/unread-boundary";

const ChatMediaGallery = dynamic(() => import("@/components/chat-media-gallery").then(module => module.ChatMediaGallery), { ssr: false });

type ChatRoomProps = {
  sender: Sender;
  members: Member[];
  onMembersChange: (members: Member[]) => void;
  onSwitchIdentity: () => void;
};

const ADMIN_SENDER_ID = "CHEN";

const MESSAGE_FALLBACK_POLLING_INTERVAL_MS = 1000;
const MESSAGE_REALTIME_HEALTH_CHECK_MS = 60000;
const MESSAGE_BACKGROUND_POLLING_INTERVAL_MS = 60000;
const INITIAL_MESSAGE_LIMIT = 40;
const OLDER_MESSAGE_LIMIT = 60;
const MESSAGE_LOAD_TOP_OFFSET_PX = 220;
const MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1800;
const THUMBNAIL_MAX_DIMENSION = 420;
const THUMBNAIL_QUALITY = 0.72;
const JPEG_QUALITIES = [0.82, 0.74, 0.66, 0.58];
const SEARCH_DEBOUNCE_MS = 250;
const TYPING_IDLE_MS = 1200;
const TYPING_EXPIRE_MS = 3200;

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

async function createThumbnail(file: File) {
  if (file.type === "image/gif") {
    return file;
  }

  const image = await readImage(file);
  const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("瀏覽器無法產生圖片縮圖。");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, THUMBNAIL_QUALITY);

  return new File([blob], file.name.replace(/\.[^.]+$/, "-thumb.jpg"), {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

function MeasuredMessage({
  messageId,
  children,
  onHeightChange
}: {
  messageId: string;
  children: ReactNode;
  onHeightChange: (messageId: string, height: number) => void;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;

    if (!element) {
      return;
    }

    const measure = () => {
      onHeightChange(messageId, Math.ceil(element.offsetHeight));
    };
    const resizeObserver = new ResizeObserver(measure);

    measure();
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [messageId, onHeightChange]);

  return (
    <div ref={elementRef} className="pb-4">
      {children}
    </div>
  );
}

export function ChatRoom({ sender, members, onMembersChange, onSwitchIdentity }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isSnakeGateOpen, setIsSnakeGateOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [callPanelRequest, setCallPanelRequest] = useState<VoiceCallOpenRequest | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [unreadBoundary, setUnreadBoundary] = useState<UnreadBoundary | null>(null);
  const capturedUnreadRef = useRef(false);
  const unreadBoundaryRef = useRef<UnreadBoundary | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [lightboxImages, setLightboxImages] = useState<{ urls: string[]; index: number } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [typingSender, setTypingSender] = useState<Sender | null>(null);
  const [isPageActive, setIsPageActive] = useState(true);
  const [hasPositionedInitialMessages, setHasPositionedInitialMessages] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [virtualViewport, setVirtualViewport] = useState<VirtualViewport>({ scrollTop: 0, height: 0 });
  const [messageHeights, setMessageHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const loadMessagesPromiseRef = useRef<Promise<{ messages: Message[]; hasMore: boolean }> | null>(null);
  const loadOlderMessagesPromiseRef = useRef<Promise<{ messages: Message[]; hasMore: boolean }> | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const messageHeightsRef = useRef<Map<string, number>>(new Map());
  const pendingMessageHeightsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | null>(null);
  const messageLayoutRef = useRef<MessageLayout>({ offsets: [], heights: [], totalHeight: 0 });
  const pendingScrollAdjustmentRef = useRef(0);
  const userScrollUntilRef = useRef(0);
  const hasMoreOlderMessagesRef = useRef(true);
  const shouldStickToBottomRef = useRef(true);
  const isPinnedToBottomRef = useRef(true);
  const previousLatestMessageIdRef = useRef<string | null>(null);
  const hasCompletedInitialBottomScrollRef = useRef(false);
  const pendingFocusMessageIdRef = useRef<string | null>(null);
  const optimisticImageUrlsRef = useRef<Map<string, string>>(new Map());
  const realtimeConnectedRef = useRef(false);
  const serverRealtimeAvailableRef = useRef(true);
  const typingStopTimerRef = useRef<number | null>(null);
  const otherTypingTimerRef = useRef<number | null>(null);
  const readSyncRef = useRef(false);
  const pendingReadMessageIdsRef = useRef(new Set<string>());
  const hasSentTypingRef = useRef(false);

  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);

  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => { unreadBoundaryRef.current = unreadBoundary; }, [unreadBoundary]);

  useEffect(() => {
    if (!capturedUnreadRef.current || unreadBoundaryRef.current || (isPageActive && isAtBottom)) return;
    const boundary = findUnreadBoundary(messages, sender);
    if (boundary) {
      unreadBoundaryRef.current = boundary;
      setUnreadBoundary(boundary);
    }
  }, [messages, sender, isPageActive, isAtBottom]);

  const syncVirtualViewport = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    setVirtualViewport((currentViewport) => {
      const nextViewport = {
        scrollTop: container.scrollTop - (messageListRef.current?.offsetTop ?? 0),
        height: container.clientHeight
      };

      if (
        Math.abs(currentViewport.scrollTop - nextViewport.scrollTop) < 1 &&
        Math.abs(currentViewport.height - nextViewport.height) < 1
      ) {
        return currentViewport;
      }

      return nextViewport;
    });
  }, []);

  const handleMessageHeightChange = useCallback((messageId: string, nextHeight: number) => {
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
      return;
    }

    if (messageHeightsRef.current.get(messageId) === nextHeight) {
      return;
    }

    pendingMessageHeightsRef.current.set(messageId, nextHeight);
    if (measurementFrameRef.current !== null) {
      return;
    }

    // Apply all row measurements together instead of rebuilding the list for each row.
    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = null;
      const currentMessages = messagesRef.current;
      const indexById = new Map(currentMessages.map((message, index) => [message.id, index]));
      const container = scrollContainerRef.current;
      const viewportTop = container ? container.scrollTop - (messageListRef.current?.offsetTop ?? 0) : 0;
      let hasChanges = false;

      pendingMessageHeightsRef.current.forEach((height, id) => {
        const index = indexById.get(id);
        if (index === undefined) return;
        const previousHeight = messageHeightsRef.current.get(id) ?? getEstimatedMessageHeight(currentMessages[index]);
        if (!isPinnedToBottomRef.current && (messageLayoutRef.current.offsets[index] ?? 0) < viewportTop) {
          pendingScrollAdjustmentRef.current += height - previousHeight;
        }
        messageHeightsRef.current.set(id, height);
        hasChanges = true;
      });
      pendingMessageHeightsRef.current.clear();
      if (hasChanges) setMessageHeights(new Map(messageHeightsRef.current));
    });
  }, []);

  const messageLayout = useMemo(() => buildMessageLayout(messages, messageHeights), [messages, messageHeights]);

  useLayoutEffect(() => {
    messageLayoutRef.current = messageLayout;
  }, [messageLayout]);

  const virtualMetrics = useMemo(
    () => buildVirtualMetrics(messages, messageLayout, virtualViewport, !hasPositionedInitialMessages || isAtBottom),
    [hasPositionedInitialMessages, isAtBottom, messageLayout, messages, virtualViewport]
  );

  const messageIndexById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index])),
    [messages]
  );

  const scrollToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    shouldStickToBottomRef.current = true;
    isPinnedToBottomRef.current = true;
    userScrollUntilRef.current = 0;
    container.scrollTop = container.scrollHeight;
    setIsAtBottom(true);
    syncVirtualViewport();
  }, [syncVirtualViewport]);

  const handleScrollIntent = useCallback(() => {
    userScrollUntilRef.current = performance.now() + 200;
  }, []);

  useLayoutEffect(() => {
    syncVirtualViewport();
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(syncVirtualViewport);
    resizeObserver.observe(container);
    window.addEventListener("resize", syncVirtualViewport);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncVirtualViewport);
    };
  }, [syncVirtualViewport]);

  const mergeMessagesIntoState = useCallback((loadedMessages: Message[], optimisticId?: string) => {
    setMessages((currentMessages) => {
      const mergedMessages = mergeLoadedMessages(currentMessages, loadedMessages, optimisticId);
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

      const data = (await response.json()) as { messages: Message[]; hasMore: boolean; realtimeAvailable?: boolean };
      if (!capturedUnreadRef.current) {
        capturedUnreadRef.current = true;
        const boundary = findUnreadBoundary(data.messages, sender);
        unreadBoundaryRef.current = boundary;
        setUnreadBoundary(boundary);
      }
      serverRealtimeAvailableRef.current = data.realtimeAvailable !== false;
      if (!hasCompletedInitialBottomScrollRef.current) hasMoreOlderMessagesRef.current = data.hasMore;
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
  }, [mergeMessagesIntoState, sender]);

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
        if (unreadBoundaryRef.current) {
          const boundary = findUnreadBoundary(data.messages, sender, unreadBoundaryRef.current);
          unreadBoundaryRef.current = boundary;
          setUnreadBoundary(boundary);
        }
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
    [mergeMessagesIntoState, sender]
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

    if (container && hasCompletedInitialBottomScrollRef.current && performance.now() < userScrollUntilRef.current) {
      userScrollUntilRef.current = performance.now() + 200;
      const viewportBottom = container.scrollTop + container.clientHeight - (messageListRef.current?.offsetTop ?? 0);
      shouldStickToBottomRef.current = shouldFollowLatest(messageLayoutRef.current, viewportBottom);
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 4;
      isPinnedToBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }
    syncVirtualViewport();

    if (
      !container ||
      !hasCompletedInitialBottomScrollRef.current ||
      isPinnedToBottomRef.current ||
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
          syncVirtualViewport();
        });
      })
      .catch(() => undefined);
  }, [loadOlderMessages, syncVirtualViewport]);

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    let timeoutId: number | null = null;
    let isStopped = false;

    function getPollingDelay() {
      if (document.hidden) {
        return MESSAGE_BACKGROUND_POLLING_INTERVAL_MS;
      }

      return realtimeConnectedRef.current && serverRealtimeAvailableRef.current
        ? MESSAGE_REALTIME_HEALTH_CHECK_MS
        : MESSAGE_FALLBACK_POLLING_INTERVAL_MS;
    }

    function schedulePoll(delay = getPollingDelay()) {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        // A reconnect must fetch a fresh snapshot even if an older request is still finishing.
        void Promise.resolve(loadMessagesPromiseRef.current)
          .catch(() => undefined)
          .then(() => {
            if (!isStopped) {
              return loadMessages();
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (!isStopped) {
              schedulePoll();
            }
          });
      }, delay);
    }

    function handleVisibilityChange() {
      schedulePoll(document.hidden ? MESSAGE_BACKGROUND_POLLING_INTERVAL_MS : 0);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleVisibilityChange);

    if (!key || !cluster) {
      realtimeConnectedRef.current = false;
      schedulePoll();

      return () => {
        isStopped = true;
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("online", handleVisibilityChange);

        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      };
    }

    const handleStateChange = ({ current }: { current: string }) => {
      if (current !== "connected") {
        realtimeConnectedRef.current = false;
        schedulePoll(0);
      }
    };
    const handleSubscriptionSucceeded = () => {
      realtimeConnectedRef.current = true;
      // Catch messages sent while connecting or reconnecting before slowing polling.
      schedulePoll(0);
    };
    const handleSubscriptionError = () => {
      realtimeConnectedRef.current = false;
      schedulePoll(0);
    };

    const disconnectRealtime = connectPrivateRealtime(key, cluster, (pusher, channel) => {
      pusher.connection.bind("state_change", handleStateChange);
      channel.bind("pusher:subscription_succeeded", handleSubscriptionSucceeded);
      channel.bind("pusher:subscription_error", handleSubscriptionError);

      channel.bind(PUSHER_EVENT_MESSAGES_CHANGED, (event: MessageChangedEvent | undefined) => {
        if (event?.type === "read") {
          if (event.sender === sender) {
            return;
          }

          if (event.sender && event.messageIds && event.readAt) {
            const { messageIds, sender: readSender, readAt } = event;
            setMessages((currentMessages) => {
              const nextMessages = applyReadReceipts(currentMessages, messageIds, readSender, readAt);
              messagesRef.current = nextMessages;
              return nextMessages;
            });
            return;
          }
        }

        if (event?.message) {
          const optimisticId = event.message.sender === sender ? event.clientRequestId : undefined;
          mergeMessagesIntoState([event.message], optimisticId);
          return;
        }

        if (event?.id) {
          void fetch(`/api/messages/${encodeURIComponent(event.id)}`, { cache: "no-store" })
            .then(async (response) => {
              if (!response.ok) {
                throw new Error("Message synchronization failed.");
              }

              const data = (await response.json()) as { message: Message };
              mergeMessagesIntoState([data.message], data.message.sender === sender ? event.clientRequestId : undefined);
            })
            .catch(() => void loadMessages().catch(() => undefined));
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
      return () => {
        pusher.connection.unbind("state_change", handleStateChange);
        channel.unbind_all();
      };
    }, handleSubscriptionError);
    schedulePoll();

    return () => {
      isStopped = true;
      realtimeConnectedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleVisibilityChange);

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      if (otherTypingTimerRef.current) {
        window.clearTimeout(otherTypingTimerRef.current);
      }
      disconnectRealtime();
    };
  }, [loadMessages, mergeMessagesIntoState, sender]);

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
      const measurementFrame = measurementFrameRef.current;

      if (typingStopTimer) {
        window.clearTimeout(typingStopTimer);
      }
      if (otherTypingTimer) {
        window.clearTimeout(otherTypingTimer);
      }
      if (measurementFrame !== null) window.cancelAnimationFrame(measurementFrame);
    };
  }, []);

  const latestMessageId = messages[messages.length - 1]?.id ?? null;

  useLayoutEffect(() => {
    if (isLoading || !latestMessageId) {
      return;
    }

    const isInitialPosition = !hasCompletedInitialBottomScrollRef.current;
    const hasNewLatestMessage = previousLatestMessageIdRef.current !== latestMessageId;
    previousLatestMessageIdRef.current = latestMessageId;
    hasCompletedInitialBottomScrollRef.current = true;

    if (isInitialPosition || isPinnedToBottomRef.current || (hasNewLatestMessage && shouldStickToBottomRef.current)) {
      scrollToLatest();
    } else if (pendingScrollAdjustmentRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop += pendingScrollAdjustmentRef.current;
      syncVirtualViewport();
    }
    pendingScrollAdjustmentRef.current = 0;
    if (isInitialPosition) setHasPositionedInitialMessages(true);
  }, [isLoading, latestMessageId, messageLayout, scrollToLatest, syncVirtualViewport, virtualMetrics, virtualViewport.height]);

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

  const readableUnreadMessages = useMemo(() => {
    if (!hasPositionedInitialMessages || virtualViewport.height <= 0) return [];
    const viewportBottom = virtualViewport.scrollTop + virtualViewport.height;
    return unreadIncomingMessages.filter((message) => {
      const index = messageIndexById.get(message.id);
      return index !== undefined && messageLayout.offsets[index] < viewportBottom;
    });
  }, [hasPositionedInitialMessages, messageIndexById, messageLayout, unreadIncomingMessages, virtualViewport]);

  const unreadBelowCount = unreadIncomingMessages.length - readableUnreadMessages.length;
  const messagesBelowCount = getMessagesBelowViewport(messageLayout, virtualViewport.scrollTop + virtualViewport.height);
  const showJumpToLatest = hasPositionedInitialMessages && !isAtBottom &&
    (unreadBelowCount > 0 || messagesBelowCount >= AUTO_FOLLOW_MESSAGE_LIMIT);

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
    if (!isPageActive || readableUnreadMessages.length === 0) {
      return;
    }

    const readAt = new Date().toISOString();
    const unreadMessageIds = readableUnreadMessages.map((message) => message.id);
    unreadMessageIds.forEach((id) => pendingReadMessageIdsRef.current.add(id));

    setMessages((currentMessages) => applyReadReceipts(currentMessages, unreadMessageIds, sender, readAt));

    if (readSyncRef.current) {
      return;
    }

    readSyncRef.current = true;

    void (async () => {
      // Keep receipts for messages that arrive while another batch is being saved.
      while (pendingReadMessageIdsRef.current.size > 0) {
        const messageIds = [...pendingReadMessageIdsRef.current].slice(0, 500);
        const response = await fetch("/api/messages/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender, messageIds })
        });

        if (!response.ok) {
          throw new Error("Read synchronization failed.");
        }

        messageIds.forEach((id) => pendingReadMessageIdsRef.current.delete(id));
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        readSyncRef.current = false;
      });
  }, [isPageActive, readableUnreadMessages, sender]);

  const focusMessage = useCallback(
    (messageId: string) => {
      shouldStickToBottomRef.current = false;
      isPinnedToBottomRef.current = false;
      setIsAtBottom(false);
      const messageElement = document.getElementById(`message-${messageId}`);

      if (messageElement) {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      } else {
        const container = scrollContainerRef.current;
        const messageIndex = messageIndexById.get(messageId);

        if (container && messageIndex !== undefined) {
          const estimatedOffset = (messageLayout.offsets[messageIndex] ?? 0) + (messageListRef.current?.offsetTop ?? 0);
          container.scrollTo({
            top: Math.max(0, estimatedOffset - container.clientHeight / 2),
            behavior: "smooth"
          });
          window.setTimeout(() => {
            document.getElementById(`message-${messageId}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center"
            });
          }, 120);
        }
      }

      setHighlightedId(messageId);
      window.setTimeout(() => setHighlightedId((current) => (current === messageId ? null : current)), 1400);
    },
    [messageIndexById, messageLayout.offsets]
  );

  useEffect(() => {
    const pendingMessageId = pendingFocusMessageIdRef.current;

    if (!pendingMessageId) {
      return;
    }

    pendingFocusMessageIdRef.current = null;
    window.requestAnimationFrame(() => focusMessage(pendingMessageId));
  }, [focusMessage, messages]);

  useEffect(() => {
    const query = searchQuery.trim();

    if (!isSearchOpen || !query) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const searchParams = new URLSearchParams({
        q: query,
        limit: "20"
      });

      setIsSearchLoading(true);
      setSearchError(null);

      void fetch(`/api/messages/search?${searchParams.toString()}`, {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await readApiError(response, "搜尋失敗"));
          }

          return (await response.json()) as { messages: Message[] };
        })
        .then((data) => {
          setSearchResults(data.messages);
        })
        .catch((searchLoadError) => {
          if (controller.signal.aborted) {
            return;
          }

          setSearchResults([]);
          setSearchError(searchLoadError instanceof Error ? searchLoadError.message : "搜尋失敗");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearchLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isSearchOpen, searchQuery]);

  function handleSearchResultClick(message: Message) {
    pendingFocusMessageIdRef.current = message.id;
    mergeMessagesIntoState([message]);
    setIsSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
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
    setError(null);
    const shouldLockComposer = Boolean(editing);

    if (shouldLockComposer) {
      setIsSending(true);
    }

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
          thumbnailUrls: localImageUrls,
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
          const [uploadedImageUrls, uploadedThumbnailUrls] = imageFiles.length > 0
            ? await Promise.all([
                Promise.all(imageFiles.map((file) => uploadImage(file))),
                Promise.all(imageFiles.map((file) => createThumbnail(file).then((thumbnail) => uploadImage(thumbnail))))
              ])
            : [[], []];

          const response = await fetch("/api/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sender,
              clientRequestId: tempId,
              text: payload.text || undefined,
              imageUrl: uploadedImageUrls[0],
              imageUrls: uploadedImageUrls,
              thumbnailUrls: uploadedThumbnailUrls,
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

          mergeMessagesIntoState([data.message], tempId);
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
      if (shouldLockComposer) {
        setIsSending(false);
      }
    }
  }

  async function handleRecall(message: Message) {
    const recalledAt = new Date().toISOString();
    const optimisticRecalledMessage: Message = {
      ...message,
      text: null,
      imageUrl: null,
      imageUrls: [],
      thumbnailUrls: [],
      updatedAt: recalledAt,
      recalledAt
    };

    setError(null);
    setMessages((currentMessages) => {
      const nextMessages = currentMessages.map((currentMessage) =>
        currentMessage.id === message.id ? optimisticRecalledMessage : currentMessage
      );
      messagesRef.current = nextMessages;
      return nextMessages;
    });

    if (editing?.id === message.id) {
      setEditing(null);
    }

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

      const data = (await response.json()) as { message?: Message };

      if (data.message) {
        setMessages((currentMessages) => {
          const nextMessages = currentMessages.map((currentMessage) =>
            currentMessage.id === message.id ? data.message ?? currentMessage : currentMessage
          );
          messagesRef.current = nextMessages;
          return nextMessages;
        });
      }
    } catch (recallError) {
      setMessages((currentMessages) => {
        const nextMessages = currentMessages.map((currentMessage) =>
          currentMessage.id === message.id ? message : currentMessage
        );
        messagesRef.current = nextMessages;
        return nextMessages;
      });
      setError(recallError instanceof Error ? recallError.message : "收回失敗");
    }
  }

  function handleStartEdit(message: Message) {
    setReplyTo(null);
    setEditing(message);
  }

  function openHistory() {
    closeSidebar();
    setCallPanelRequest(current => ({ id: (current?.id ?? 0) + 1, view: "history" }));
  }

  function openImages() {
    closeSidebar();
    setIsGalleryOpen(true);
  }

  function openSearch() {
    closeSidebar();
    setIsSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  return (
    <div className="chat-shell flex h-dvh overflow-hidden bg-paper text-ink">
      <BrowserChatStatus unreadCount={unreadIncomingMessages.length} mentionSender={unreadMentionSender} members={members} />
      <ChatSidebar identity={getSenderLabel(sender, members)} isOpen={isSidebarOpen} onClose={closeSidebar} onShowHistory={openHistory} onShowImages={openImages} onSearch={openSearch} onSwitchIdentity={onSwitchIdentity} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="relative z-30 shrink-0 border-b border-line bg-white px-3 sm:px-6">
        <div className="flex h-[72px] items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => setIsSidebarOpen(true)} className="icon-button lg:hidden" title="開啟導覽" aria-label="開啟導覽" aria-expanded={isSidebarOpen}><Menu size={20} /></button>
          <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 sm:flex" aria-hidden="true"><Users size={21} strokeWidth={1.7} /></span>
          <div className="min-w-0 flex-1">
            {sender === ADMIN_SENDER_ID ? (
              <button
                type="button"
                onClick={() => setIsSnakeGateOpen(true)}
                className="block max-w-full truncate rounded-sm text-left text-base font-semibold leading-6 outline-none focus-visible:ring-2 focus-visible:ring-brand/30 sm:text-lg"
                aria-label="開啟 trashchat"
              >trashchat</button>
            ) : (
              <h1 className="truncate text-base font-semibold leading-6 sm:text-lg">trashchat</h1>
            )}
            <p className="truncate text-[11px] text-slate-400">你是 <span className="font-medium text-slate-600">{getSenderLabel(sender, members)}</span></p>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <VoiceCall sender={sender} members={members} openRequest={callPanelRequest} />
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(!isSearchOpen);
                if (isSearchOpen) {
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchError(null);
                }
              }}
              className={`icon-button ${isSearchOpen ? "!bg-brand/10 !text-brand" : ""}`}
              title="搜尋訊息"
              aria-label="搜尋訊息"
              aria-expanded={isSearchOpen}
            >
              {isSearchOpen ? <X size={17} /> : <Search size={17} />}
            </button>
            <button type="button" onClick={openImages} className="icon-button lg:hidden" title="聊天圖片" aria-label="聊天圖片"><Images size={18} /></button>
            <button type="button" onClick={() => void loadMessages().catch(() => setError("無法載入訊息"))} className="icon-button hidden sm:inline-flex" title="重新整理" aria-label="重新整理"><RefreshCw size={17} /></button>
          </div>
        </div>
        {isSearchOpen ? (
          <div className="pb-3">
            <div className="relative">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                autoFocus
                placeholder="搜尋訊息"
                className="h-10 w-full rounded-md border border-line bg-slate-50 px-3 pr-10 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />

              {searchQuery.trim() ? (
                <div className="absolute left-0 right-0 top-12 z-30 max-h-72 overflow-y-auto rounded-md border border-line bg-white p-1 shadow-soft">
                  {isSearchLoading ? (
                    <div className="px-3 py-3 text-sm text-slate-500">搜尋中...</div>
                  ) : searchError ? (
                    <div className="px-3 py-3 text-sm text-red-600">{searchError}</div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-slate-500">沒有找到訊息</div>
                  ) : (
                    searchResults.map((message) => {
                      const preview = message.text?.trim() || (message.imageUrls.length > 0 ? "圖片訊息" : "訊息");

                      return (
                        <button
                          type="button"
                          key={message.id}
                          onClick={() => handleSearchResultClick(message)}
                          className="block w-full rounded-md px-3 py-2 text-left transition hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                            <span>{getSenderLabel(message.sender, members)}</span>
                            <span>{formatMessageTime(message.createdAt)}</span>
                          </div>
                          <div className="mt-1 truncate text-sm text-ink">{preview}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        <section
          ref={scrollContainerRef}
          onScroll={handleMessageScroll}
          onWheel={handleScrollIntent}
          onTouchMove={handleScrollIntent}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) handleScrollIntent();
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) handleScrollIntent();
          }}
          tabIndex={0}
          aria-label="聊天訊息"
          style={{ overflowAnchor: "none" }}
          className="chat-scrollbar relative mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col overflow-y-auto px-3 py-4 sm:px-5"
        >
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
              <MessageCircle size={34} strokeWidth={1.3} />
              還沒有訊息
            </div>
          ) : (
            <>
              {isLoadingOlder ? (
                <div className="flex justify-center py-1">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
                </div>
              ) : null}
              <div ref={messageListRef} className="shrink-0">
                {virtualMetrics.topSpacerHeight > 0 ? (
                  <div aria-hidden="true" className="shrink-0" style={{ height: virtualMetrics.topSpacerHeight }} />
                ) : null}
                {virtualMetrics.rows.map(({ message, index }) => {
                  const previousMessage = messages[index - 1];
                  const showTimestamp =
                    !previousMessage || previousMessage.sender !== message.sender ||
                    getMessageMinuteKey(previousMessage.createdAt) !== getMessageMinuteKey(message.createdAt);
                  const showDay = !previousMessage || new Date(previousMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString();

                  return (
                    <MeasuredMessage key={message.id} messageId={message.id} onHeightChange={handleMessageHeightChange}>
                      {showDay ? <div className="flex justify-center pb-4 pt-2"><time dateTime={message.createdAt} className="text-[11px] text-slate-400">{new Date(message.createdAt).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}</time></div> : null}
                      {unreadBoundary?.id === message.id ? <div role="separator" aria-label="未讀訊息" className="mb-5 mt-2 flex items-center gap-4"><span className="h-px flex-1 bg-brand/20" /><span className="shrink-0 text-[11px] font-semibold text-brand">以下為未讀訊息</span><span className="h-px flex-1 bg-brand/20" /></div> : null}
                      <MessageBubble
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
                    </MeasuredMessage>
                  );
                })}
                {virtualMetrics.bottomSpacerHeight > 0 ? (
                  <div aria-hidden="true" className="shrink-0" style={{ height: virtualMetrics.bottomSpacerHeight }} />
                ) : null}
              </div>
            </>
          )}
          {typingSender ? (
            <div className="flex justify-start px-1 text-sm text-slate-500">
              {getSenderLabel(typingSender, members)} 正在輸入...
            </div>
          ) : null}
        </section>
        {showJumpToLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20">
            <div className="mx-auto flex w-full max-w-4xl justify-end px-3 sm:px-5">
              <button
                type="button"
                onClick={scrollToLatest}
                title="移至最新訊息"
                className="pointer-events-auto inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink shadow-soft transition hover:border-brand/40 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-brand/15"
              >
                <ArrowDown size={16} aria-hidden="true" />
                {unreadBelowCount}則未讀訊息
              </button>
            </div>
          </div>
        ) : null}
      </div>

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
      </main>

      {isAdminOpen ? (
        <MemberAdminPanel members={members} onMembersChange={onMembersChange} onClose={() => setIsAdminOpen(false)} />
      ) : null}

      {isGalleryOpen ? <ChatMediaGallery members={members} onClose={() => setIsGalleryOpen(false)} /> : null}

      {isSnakeGateOpen ? (
        <AdminSnakeGate
          onClose={() => setIsSnakeGateOpen(false)}
          onUnlock={() => {
            setIsSnakeGateOpen(false);
            setIsAdminOpen(true);
          }}
        />
      ) : null}

      <ImageLightbox
        imageUrls={lightboxImages?.urls ?? []}
        initialIndex={lightboxImages?.index ?? 0}
        onClose={() => setLightboxImages(null)}
      />
    </div>
  );
}
