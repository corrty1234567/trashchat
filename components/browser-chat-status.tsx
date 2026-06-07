"use client";

import { useEffect } from "react";
import { SENDER_LABEL, type Sender } from "@/lib/types";

type BrowserChatStatusProps = {
  unreadCount: number;
  mentionSender: Sender | null;
};

function createTrashIcon(hasNotification: boolean) {
  const badge = hasNotification ? '<circle cx="48" cy="12" r="9" fill="#ef4444"/>' : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e2e8f0"/><path d="M24 18h16l2 5h8v6H14v-6h8l2-5Z" fill="#475569"/><path d="M19 31h26l-2 21H21l-2-21Z" fill="#64748b"/><path d="M27 36v11M37 36v11" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/>${badge}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getIconLink() {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }

  link.type = "image/svg+xml";
  return link;
}

export function BrowserChatStatus({ unreadCount, mentionSender }: BrowserChatStatusProps) {
  useEffect(() => {
    const hasNotification = unreadCount > 0 || Boolean(mentionSender);
    const title = mentionSender
      ? `(@${SENDER_LABEL[mentionSender]})提及了你`
      : unreadCount > 0
        ? `trashchat (${unreadCount} 則未讀的訊息)`
        : "trashchat";

    document.title = title;
    getIconLink().href = createTrashIcon(hasNotification);
  }, [mentionSender, unreadCount]);

  useEffect(() => {
    return () => {
      document.title = "trashchat";
      getIconLink().href = createTrashIcon(false);
    };
  }, []);

  return null;
}
