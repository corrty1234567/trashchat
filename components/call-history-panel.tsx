"use client";

import { ArrowDownLeft, ArrowUpRight, Loader2, PhoneCall, PhoneMissed, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCallDuration, type CallHistoryEntry, type CallHistoryStatus } from "@/lib/call";
import { getSenderLabel, type Member, type Sender } from "@/lib/types";

type Cursor = { beforeStartedAt: string; beforeId: string } | null;
const labels: Record<CallHistoryStatus, string> = { ringing: "等待接聽", connecting: "連線中", active: "通話中",
  completed: "已結束", missed: "未接聽", declined: "已拒接", cancelled: "已取消", failed: "連線中斷", busy: "忙線中" };

export function CallHistoryPanel({ sender, members, onCall }: { sender: Sender; members: readonly Member[]; onCall: (peer: Sender) => void }) {
  const [calls, setCalls] = useState<CallHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const hasLoadedOlderRef = useRef(false);
  const load = useCallback(async (before: Cursor = null, quiet = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ sender, ...before });
      const response = await fetch(`/api/call/history?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "無法載入通話紀錄。");
      }
      const data = await response.json() as { calls: CallHistoryEntry[]; hasMore: boolean; nextCursor: Cursor };
      if (controller.signal.aborted) return;
      setError(null);
      setCalls(current => [...new Map([...current, ...data.calls].map(call => [call.id, call])).values()]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)));
      if (before) hasLoadedOlderRef.current = true;
      if (!quiet || !hasLoadedOlderRef.current) { setHasMore(data.hasMore); setCursor(data.nextCursor); }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "無法載入通話紀錄。");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [sender]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (!document.hidden && !hasLoadedOlderRef.current) void load(null, true); }, 10_000);
    return () => { controllerRef.current?.abort(); window.clearInterval(timer); };
  }, [load]);
  return (
    <section aria-label="通話紀錄">
      <div className="mb-2 flex items-center justify-between"><p className="text-xs text-slate-400">最近通話</p><button type="button" onClick={() => void load(null, true)} className="icon-button !h-8 !w-8" aria-label="重新整理通話紀錄" title="重新整理通話紀錄"><RefreshCw size={14} /></button></div>
      <div className="chat-scrollbar max-h-[min(55dvh,420px)] overflow-y-auto">
        {!calls.length && !loading && !error ? <div className="flex flex-col items-center gap-3 py-10 text-slate-400"><PhoneCall size={30} strokeWidth={1.3} /><p className="text-sm">還沒有通話紀錄</p></div> : null}
        {calls.map(call => {
          const outgoing = call.caller === sender;
          const peer = outgoing ? call.callee : call.caller;
          const unsuccessful = ["missed", "declined", "failed", "busy"].includes(call.status);
          return <div key={call.id} className="flex items-center gap-3 border-b border-line/60 py-3 last:border-0">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${unsuccessful ? "bg-red-50 text-red-500" : "bg-emerald-50 text-brand"}`}>{unsuccessful ? <PhoneMissed size={18} /> : outgoing ? <ArrowUpRight size={19} /> : <ArrowDownLeft size={19} />}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" title={getSenderLabel(peer, members)}>{getSenderLabel(peer, members)}</p><p className={`mt-0.5 text-xs ${unsuccessful ? "text-red-500" : "text-slate-500"}`}>{outgoing ? "撥出" : "來電"} · {labels[call.status]}{call.durationSeconds > 0 || call.status === "completed" ? ` · ${formatCallDuration(call.durationSeconds)}` : ""}</p><time dateTime={call.startedAt} className="mt-1 block text-[11px] text-slate-400">{new Date(call.startedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time></div>
            <button type="button" disabled={!members.some(member => member.id === peer)} onClick={() => onCall(peer)} className="icon-button shrink-0" title={`撥打 ${getSenderLabel(peer, members)}`} aria-label={`撥打 ${getSenderLabel(peer, members)}`}><PhoneCall size={17} /></button>
          </div>;
        })}
        {loading ? <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-brand" /></div> : null}
        {error ? <p role="alert" className="py-3 text-sm text-red-600">{error}<button type="button" onClick={() => void load(calls.length ? cursor : null)} className="ml-2 underline">重試</button></p> : null}
        {hasMore && !loading ? <button type="button" onClick={() => void load(cursor)} className="mt-2 w-full rounded-md border border-line py-2 text-sm text-slate-500 hover:bg-paper">更早的通話</button> : null}
      </div>
    </section>
  );
}
