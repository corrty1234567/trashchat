"use client";

import clsx from "clsx";
import { Eraser, HardDrive, MessagesSquare, Plus, RefreshCw, Save, Search, Trash2, Undo2, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMessageImageUrls } from "@/lib/messages";
import { formatMessageTime } from "@/lib/time";
import { getSenderLabel, type Member, type Message } from "@/lib/types";

type MemberAdminPanelProps = {
  members: Member[];
  onMembersChange: (members: Member[]) => void;
  onClose: () => void;
};

type ApiError = {
  error?: unknown;
};

type BlobUsage = {
  bytes: number;
  formatted: string;
  count: number;
};

type CleanupResult = {
  callSignalsDeleted: number;
};

type AdminTab = "members" | "messages";

const ADMIN_CODE = "chashtrat";

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

function getMessagePreview(message: Message) {
  if (message.recalledAt) {
    return "已收回";
  }

  if (message.text?.trim()) {
    return message.text.trim();
  }

  const imageCount = getMessageImageUrls(message).length;

  if (imageCount > 1) {
    return `${imageCount} 張圖片`;
  }

  if (imageCount === 1) {
    return "圖片訊息";
  }

  return "空訊息";
}

export function MemberAdminPanel({ members, onMembersChange, onClose }: MemberAdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("members");
  const [isAdminReady, setIsAdminReady] = useState(false);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blobUsage, setBlobUsage] = useState<BlobUsage | null>(null);
  const [blobUsageError, setBlobUsageError] = useState<string | null>(null);
  const [adminMessages, setAdminMessages] = useState<Message[]>([]);
  const [messageQuery, setMessageQuery] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraftNames(
      members.reduce(
        (drafts, member) => ({
          ...drafts,
          [member.id]: member.name
        }),
        {} as Record<string, string>
      )
    );
  }, [members]);

  const ensureAdminSession = useCallback(async () => {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ code: ADMIN_CODE })
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "無法開啟管理員模式"));
    }
  }, []);

  const loadBlobUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/blob-usage", {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "無法讀取 Blob 容量"));
      }

      const data = (await response.json()) as BlobUsage;
      setBlobUsage(data);
      setBlobUsageError(null);
    } catch (usageError) {
      setBlobUsage(null);
      setBlobUsageError(usageError instanceof Error ? usageError.message : "無法讀取 Blob 容量");
    }
  }, []);

  const loadAdminMessages = useCallback(async (query: string) => {
    setIsLoadingMessages(true);

    try {
      const searchParams = new URLSearchParams({
        limit: "60"
      });

      if (query.trim()) {
        searchParams.set("q", query.trim());
      }

      const response = await fetch(`/api/admin/messages?${searchParams.toString()}`, {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "無法讀取訊息"));
      }

      const data = (await response.json()) as { messages: Message[] };
      setAdminMessages(data.messages);
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "無法讀取訊息");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initAdmin() {
      try {
        await ensureAdminSession();

        if (!isMounted) {
          return;
        }

        setIsAdminReady(true);
        await Promise.all([loadBlobUsage(), loadAdminMessages("")]);
      } catch (adminError) {
        if (isMounted) {
          setError(adminError instanceof Error ? adminError.message : "無法開啟管理員模式");
        }
      }
    }

    void initAdmin();

    return () => {
      isMounted = false;
    };
  }, [ensureAdminSession, loadAdminMessages, loadBlobUsage]);

  useEffect(() => {
    if (!isAdminReady || activeTab !== "messages") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadAdminMessages(messageQuery);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, isAdminReady, loadAdminMessages, messageQuery]);

  const canAdd = useMemo(() => Boolean(newName.trim()) && !busyId && isAdminReady, [busyId, isAdminReady, newName]);

  async function refreshMembers() {
    const response = await fetch("/api/members", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "無法重新讀取成員"));
    }

    const data = (await response.json()) as { members: Member[] };
    onMembersChange(data.members);
  }

  async function addMember() {
    if (!canAdd) {
      return;
    }

    setBusyId("new");
    setError(null);

    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ name: newName })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "新增失敗"));
      }

      setNewName("");
      await refreshMembers();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "新增失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function updateMember(member: Member) {
    const nextName = draftNames[member.id]?.trim() ?? "";

    if (!nextName || nextName === member.name || busyId || !isAdminReady) {
      return;
    }

    setBusyId(member.id);
    setError(null);

    try {
      const response = await fetch(`/api/members/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({ name: nextName })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "儲存失敗"));
      }

      await refreshMembers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "儲存失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMember(member: Member) {
    if (member.isProtected || busyId || !isAdminReady) {
      return;
    }

    setBusyId(member.id);
    setError(null);

    try {
      const response = await fetch(`/api/members/${encodeURIComponent(member.id)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "刪除失敗"));
      }

      await refreshMembers();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "刪除失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function recallMessage(message: Message) {
    if (message.recalledAt || busyId || !isAdminReady) {
      return;
    }

    const recalledAt = new Date().toISOString();
    const optimisticMessage: Message = {
      ...message,
      text: null,
      imageUrl: null,
      imageUrls: [],
      thumbnailUrls: [],
      recalledAt,
      updatedAt: recalledAt
    };

    setBusyId(message.id);
    setError(null);
    setAdminMessages((currentMessages) =>
      currentMessages.map((currentMessage) => (currentMessage.id === message.id ? optimisticMessage : currentMessage))
    );

    try {
      const response = await fetch(`/api/admin/messages/${message.id}/recall`, {
        method: "POST",
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "收回失敗"));
      }

      const data = (await response.json()) as { message: Message };
      setAdminMessages((currentMessages) =>
        currentMessages.map((currentMessage) => (currentMessage.id === message.id ? data.message : currentMessage))
      );
      void loadBlobUsage();
    } catch (recallError) {
      setAdminMessages((currentMessages) =>
        currentMessages.map((currentMessage) => (currentMessage.id === message.id ? message : currentMessage))
      );
      setError(recallError instanceof Error ? recallError.message : "收回失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function cleanupOldData() {
    if (busyId || !isAdminReady) {
      return;
    }

    setBusyId("cleanup");
    setError(null);
    setCleanupStatus(null);

    try {
      const response = await fetch("/api/admin/cleanup", {
        method: "POST",
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "清理失敗"));
      }

      const data = (await response.json()) as CleanupResult;
      setCleanupStatus(`已清理 ${data.callSignalsDeleted} 筆舊通話資料`);
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : "清理失敗");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.28)]">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink">管理員</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-brand/15"
            aria-label="關閉"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-line bg-slate-50 px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex min-w-0 items-center gap-3 rounded-md border border-line bg-white px-3 py-2">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                <HardDrive size={17} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Blob 儲存容量</p>
                <p className="truncate text-sm font-semibold text-ink">
                  {blobUsage ? `${blobUsage.formatted} / ${blobUsage.count} 個檔案` : blobUsageError ?? "讀取中..."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void cleanupOldData()}
              disabled={busyId === "cleanup" || !isAdminReady}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Eraser size={16} />
              清理舊資料
            </button>
          </div>
          {cleanupStatus ? <div className="mt-2 text-xs text-slate-500">{cleanupStatus}</div> : null}
        </div>

        <div className="flex border-b border-line p-2">
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={clsx(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
              activeTab === "members" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Users size={16} />
            成員
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("messages")}
            className={clsx(
              "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
              activeTab === "messages" ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <MessagesSquare size={16} />
            訊息
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          {activeTab === "members" ? (
            <div className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addMember();
                }}
              >
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="新增成員"
                  maxLength={24}
                  className="min-w-0 flex-1 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
                />
                <button
                  type="submit"
                  disabled={!canAdd}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label="新增成員"
                >
                  <Plus size={18} />
                </button>
              </form>

              <div className="space-y-2">
                {members.map((member) => {
                  const draftName = draftNames[member.id] ?? member.name;
                  const isChanged = draftName.trim() !== member.name;

                  return (
                    <div key={member.id} className="flex items-center gap-2 rounded-md border border-line bg-white p-2">
                      <input
                        value={draftName}
                        onChange={(event) =>
                          setDraftNames((currentDrafts) => ({
                            ...currentDrafts,
                            [member.id]: event.target.value
                          }))
                        }
                        maxLength={24}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-slate-50 px-3 py-2 text-sm font-medium outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
                        aria-label={`${member.name} 名稱`}
                      />
                      <button
                        type="button"
                        disabled={!isChanged || busyId === member.id || !isAdminReady}
                        onClick={() => void updateMember(member)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label="儲存名稱"
                      >
                        <Save size={16} />
                      </button>
                      {!member.isProtected ? (
                        <button
                          type="button"
                          disabled={busyId === member.id || !isAdminReady}
                          onClick={() => void deleteMember(member)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                          aria-label="刪除成員"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    value={messageQuery}
                    onChange={(event) => setMessageQuery(event.target.value)}
                    placeholder="搜尋訊息"
                    className="h-10 w-full rounded-md border border-line bg-slate-50 px-3 pr-9 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
                  />
                  <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                </div>
                <button
                  type="button"
                  onClick={() => void loadAdminMessages(messageQuery)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                  aria-label="重新整理訊息"
                >
                  <RefreshCw size={16} />
                </button>
              </div>

              {isLoadingMessages ? <div className="text-sm text-slate-500">讀取中...</div> : null}

              <div className="space-y-2">
                {adminMessages.map((message) => {
                  const readLabels = (message.reads ?? []).map((read) => getSenderLabel(read.sender, members));

                  return (
                    <div key={message.id} className="rounded-md border border-line bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>{getSenderLabel(message.sender, members)}</span>
                            <span>{formatMessageTime(message.createdAt)}</span>
                            {message.recalledAt ? <span className="text-red-600">已收回</span> : null}
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-sm text-ink">{getMessagePreview(message)}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {readLabels.length > 0 ? `已讀：${readLabels.join("、")}` : "尚無已讀"}
                          </p>
                        </div>
                        {!message.recalledAt ? (
                          <button
                            type="button"
                            disabled={busyId === message.id || !isAdminReady}
                            onClick={() => void recallMessage(message)}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="收回訊息"
                          >
                            <Undo2 size={16} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
