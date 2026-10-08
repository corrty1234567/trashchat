"use client";

import { ArrowDownToLine, ChevronRight, History, Images, MessageCircle, Search, Users, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type ChatSidebarProps = {
  identity: string;
  memberCount: number;
  lastMessageTime: string | null;
  unreadCount: number;
  isAtBottom: boolean;
  isOpen: boolean;
  onClose: () => void;
  onShowChat: () => void;
  onShowHistory: () => void;
  onShowImages: () => void;
  onSearch: () => void;
  onLatest: () => void;
  onSwitchIdentity: () => void;
};

function SidebarContent(props: ChatSidebarProps) {
  return <>
    <div className="flex h-24 shrink-0 items-center justify-between gap-3 px-7">
      <div className="flex min-w-0 items-center gap-3"><MessageCircle size={27} strokeWidth={1.8} className="shrink-0 text-brand" /><span className="truncate text-xl font-semibold text-ink">trashchat</span></div>
      <button type="button" onClick={props.onClose} className="icon-button lg:hidden" title="關閉導覽" aria-label="關閉導覽"><X size={20} /></button>
    </div>
    <nav aria-label="聊天導覽" className="min-h-0 flex-1 overflow-y-auto px-5 pt-6">
      <p className="mb-3 px-4 text-xs text-slate-400">對話</p>
      <button type="button" onClick={props.onShowChat} aria-current="page" className="flex min-h-20 w-full items-center gap-3 rounded-lg bg-[#f3f7ff] px-4 py-4 text-left transition hover:bg-blue-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand"><Users size={21} strokeWidth={1.7} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-base font-semibold text-ink">trashchat</span><span className="mt-1 block truncate text-[13px] text-slate-500">{props.lastMessageTime ? `最後訊息 ${props.lastMessageTime}` : `${props.memberCount} 位成員`}</span></span>
        {props.unreadCount > 0 ? <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{props.unreadCount > 99 ? "99+" : props.unreadCount}</span> : <ChevronRight size={16} className="shrink-0 text-brand" />}
      </button>
      <div className="mt-10 space-y-3">
        <button type="button" onClick={props.onShowHistory} className="sidebar-link"><History size={20} strokeWidth={1.7} /><span>通話紀錄</span></button>
        <button type="button" onClick={props.onShowImages} className="sidebar-link"><Images size={20} strokeWidth={1.7} /><span>聊天圖片</span></button>
        <button type="button" onClick={props.onSearch} className="sidebar-link"><Search size={20} strokeWidth={1.7} /><span>搜尋訊息</span></button>
      </div>
    </nav>
    <div className="shrink-0 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
      <button type="button" onClick={props.onLatest} className="sidebar-link mb-5" aria-label="移至最新訊息" title="移至最新訊息"><ArrowDownToLine size={20} strokeWidth={1.7} /><span className="min-w-0 flex-1 text-left">自動滑到底</span><span className={`h-2 w-2 shrink-0 rounded-full ${props.isAtBottom ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" /></button>
      <div className="flex min-h-20 items-center gap-3 border-t border-line px-2 pt-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#edf2fb] text-sm font-semibold text-[#526c94]" aria-hidden="true">{props.identity.slice(0, 2)}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold text-ink" title={props.identity}>{props.identity}</p><p className="mt-0.5 text-[11px] text-slate-400">目前身分</p></div>
        <button type="button" onClick={props.onSwitchIdentity} className="shrink-0 rounded px-2 py-2 text-xs text-slate-500 transition hover:bg-paper hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">換身分</button>
      </div>
    </div>
  </>;
}

export function ChatSidebar(props: ChatSidebarProps) {
  const { onClose } = props;
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose, props.isOpen);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (media.matches) onClose(); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, [onClose]);

  return <>
    <aside className="hidden h-full w-[260px] shrink-0 flex-col border-r border-line bg-white lg:flex xl:w-[300px]" aria-label="側邊導覽"><SidebarContent {...props} /></aside>
    {props.isOpen ? <div className="fixed inset-0 z-50 bg-black/20 lg:hidden" onClick={props.onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="聊天導覽" tabIndex={-1} onClick={event => event.stopPropagation()} className="flex h-full w-[min(300px,calc(100vw-2.5rem))] flex-col border-r border-line bg-white shadow-soft outline-none"><SidebarContent {...props} /></section>
    </div> : null}
  </>;
}
