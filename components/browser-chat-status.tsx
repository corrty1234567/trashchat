"use client";

import { useEffect, useRef } from "react";
import { SENDER_LABEL, type Sender } from "@/lib/types";

type BrowserChatStatusProps = {
  unreadCount: number;
  mentionSender: Sender | null;
};

function createTrashIcon(hasNotification: boolean) {
  const badge = hasNotification
    ? '<circle cx="15" cy="14" r="11" fill="#ef4444" stroke="#ffffff" stroke-width="4"/>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e2e8f0"/><path d="M24 18h16l2 5h8v6H14v-6h8l2-5Z" fill="#475569"/><path d="M19 31h26l-2 21H21l-2-21Z" fill="#64748b"/><path d="M27 36v11M37 36v11" stroke="#f8fafc" stroke-width="3" stroke-linecap="round"/>${badge}</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getIconLink() {
  let link = document.querySelector<HTMLLinkElement>('link[data-trashchat-icon="true"]');

  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.setAttribute("data-trashchat-icon", "true");
    document.head.appendChild(link);
  }

  link.type = "image/svg+xml";
  link.sizes = "any";
  return link;
}

function getNotificationAudioContext(audioContextRef: { current: AudioContext | null }) {
  const WebAudioContext =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!WebAudioContext) {
    return null;
  }

  audioContextRef.current ??= new WebAudioContext();
  return audioContextRef.current;
}

async function playNotificationSound(audioContextRef: { current: AudioContext | null }) {
  const audioContext = getNotificationAudioContext(audioContextRef);

  if (!audioContext) {
    return;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => undefined);
  }

  if (audioContext.state === "suspended") {
    return;
  }

  [
    { delay: 0, duration: 0.07, frequency: 880 },
    { delay: 0.09, duration: 0.08, frequency: 1175 }
  ].forEach((tone) => {
    const startAt = audioContext.currentTime + tone.delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.075, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.03);
  });
}

export function BrowserChatStatus({ unreadCount, mentionSender }: BrowserChatStatusProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasMountedRef = useRef(false);
  const lastUnreadCountRef = useRef(unreadCount);

  useEffect(() => {
    const hasNotification = unreadCount > 0 || Boolean(mentionSender);
    const title = mentionSender
      ? `${SENDER_LABEL[mentionSender]}提及了你`
      : unreadCount > 0
        ? `trashchat (${unreadCount})`
        : "trashchat";

    document.title = title;
    getIconLink().href = createTrashIcon(hasNotification);
  }, [mentionSender, unreadCount]);

  useEffect(() => {
    function unlockAudio() {
      const audioContext = getNotificationAudioContext(audioContextRef);

      if (audioContext?.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }
    }

    document.addEventListener("pointerdown", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      document.removeEventListener("pointerdown", unlockAudio);
      document.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    const previousUnreadCount = lastUnreadCountRef.current;
    lastUnreadCountRef.current = unreadCount;

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (unreadCount > previousUnreadCount) {
      void playNotificationSound(audioContextRef);
    }
  }, [unreadCount]);

  useEffect(() => {
    return () => {
      document.title = "trashchat";
      getIconLink().href = createTrashIcon(false);
    };
  }, []);

  return null;
}
