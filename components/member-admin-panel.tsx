"use client";

import { Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Member } from "@/lib/types";

type MemberAdminPanelProps = {
  members: Member[];
  onMembersChange: (members: Member[]) => void;
  onClose: () => void;
};

type ApiError = {
  error?: unknown;
};

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

export function MemberAdminPanel({ members, onMembersChange, onClose }: MemberAdminPanelProps) {
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const canAdd = useMemo(() => Boolean(newName.trim()) && !busyId, [busyId, newName]);

  async function refreshMembers() {
    const response = await fetch("/api/members", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, "成員重新載入失敗"));
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

    if (!nextName || nextName === member.name || busyId) {
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
    if (member.isProtected || busyId) {
      return;
    }

    setBusyId(member.id);
    setError(null);

    try {
      const response = await fetch(`/api/members/${encodeURIComponent(member.id)}`, {
        method: "DELETE"
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

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-white/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.28)]">
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

        <div className="space-y-3 p-4">
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
              placeholder="名稱"
              maxLength={24}
              className="min-w-0 flex-1 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10"
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

          {error ? <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
            {members.map((member) => {
              const draftName = draftNames[member.id] ?? member.name;
              const isChanged = draftName.trim() !== member.name;

              return (
                <div key={member.id} className="flex items-center gap-2 rounded-lg border border-line bg-white p-2">
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
                    disabled={!isChanged || busyId === member.id}
                    onClick={() => void updateMember(member)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="儲存名稱"
                  >
                    <Save size={16} />
                  </button>
                  {!member.isProtected ? (
                    <button
                      type="button"
                      disabled={busyId === member.id}
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
      </section>
    </div>
  );
}
