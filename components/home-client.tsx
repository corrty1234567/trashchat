"use client";

import { useEffect, useState } from "react";
import { ChatRoom } from "@/components/chat-room";
import { type Sender, isSender } from "@/lib/types";

const STORAGE_KEY = "trashchat:sender";
const IDENTITY_OPTIONS: Array<{ label: string; sender: Sender }> = [
  { label: "27", sender: "ZUO" },
  { label: "10", sender: "CHEN" }
];

export function HomeClient() {
  const [sender, setSender] = useState<Sender | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const savedSender = window.localStorage.getItem(STORAGE_KEY);

    if (isSender(savedSender)) {
      setSender(savedSender);
    }

    setIsHydrated(true);
  }, []);

  function chooseSender(nextSender: Sender) {
    window.localStorage.setItem(STORAGE_KEY, nextSender);
    setSender(nextSender);
  }

  function clearSender() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSender(null);
  }

  if (!isHydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
      </main>
    );
  }

  if (sender) {
    return <ChatRoom sender={sender} onSwitchIdentity={clearSender} />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#f8fafc_0%,#f3f4f6_48%,#eef2f7_100%)] px-5 py-8 text-ink">
      <section className="grid w-full max-w-md grid-cols-2 gap-3 sm:max-w-xl sm:gap-4">
        {IDENTITY_OPTIONS.map((option) => (
          <button
            key={option.sender}
            type="button"
            onClick={() => chooseSender(option.sender)}
            className="flex aspect-square items-center justify-center rounded-2xl border border-white/80 bg-white/75 text-5xl font-semibold text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:border-brand/40 hover:bg-white focus:outline-none focus:ring-4 focus:ring-brand/20 active:scale-[0.98] sm:text-7xl"
            aria-label={`選擇 ${option.label}`}
          >
            {option.label}
          </button>
        ))}
      </section>
    </main>
  );
}
