"use client";

import { History, Images, MessageCircle, Search, Users, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type ChatSidebarProps = {
  identity: string;
  isOpen: boolean;
  onClose: () => void;
  onShowHistory: () => void;
  onShowImages: () => void;
  onSearch: () => void;
  onSwitchIdentity: () => void;
};

function SidebarContent(props: ChatSidebarProps) {
  return <>
    <div className="flex h-[72px] shrink-0 items-center justify-between gap-2 px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <MessageCircle size={24} strokeWidth={1.8} className="shrink-0 text-brand" />
        <span className="truncate text-lg font-semibold">trashchat</span>
      </div>
      <button type="button" onClick={props.onClose} className="icon-button lg:hidden" title="關閉導覽" aria-label="關閉導覽"><X size={19} /></button>
    </div>
    <nav aria-label="聊天導覽" className="min-h-0 flex-1 overflow-y-auto px-3 pt-5">
      <p className="mb-2 px-3 text-xs text-slate-400">對話</p>
      <div aria-current="page" className="flex min-h-16 items-center gap-2.5 rounded-lg bg-[#f3f7ff] px-3 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand"><Users size={19} strokeWidth={1.7} /></span>
        <span className="truncate text-sm font-semibold">trashchat</span>
      </div>
      <div className="mt-6 space-y-1">
        <button type="button" onClick={props.onShowHistory} className="sidebar-link"><History size={18} strokeWidth={1.7} /><span>通話紀錄</span></button>
        <button type="button" onClick={props.onShowImages} className="sidebar-link"><Images size={18} strokeWidth={1.7} /><span>聊天圖片</span></button>
        <button type="button" onClick={props.onSearch} className="sidebar-link"><Search size={18} strokeWidth={1.7} /><span>搜尋訊息</span></button>
      </div>
    </nav>
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <div className="flex min-h-16 items-center gap-2.5 border-t border-line px-2 pt-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf2fb] text-xs font-semibold text-[#526c94]" aria-hidden="true">{props.identity.slice(0, 2)}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={props.identity}>{props.identity}</span>
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
    <aside className="hidden h-full w-56 shrink-0 flex-col border-r border-line bg-white lg:flex" aria-label="側邊導覽"><SidebarContent {...props} /></aside>
    {props.isOpen ? <div className="fixed inset-0 z-50 bg-black/20 lg:hidden" onClick={onClose}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="聊天導覽" tabIndex={-1} onClick={event => event.stopPropagation()} className="flex h-full w-[min(260px,calc(100vw-2.5rem))] flex-col border-r border-line bg-white shadow-soft outline-none"><SidebarContent {...props} /></section>
    </div> : null}
  </>;
}
