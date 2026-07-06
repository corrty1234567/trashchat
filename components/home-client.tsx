"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatRoom } from "@/components/chat-room";
import { DEFAULT_MEMBERS, type Member, type Sender, isSender } from "@/lib/types";

const STORAGE_KEY = "trashchat:sender";
const DEFAULT_MEMBER_LIST: Member[] = DEFAULT_MEMBERS.map((member) => ({ ...member }));

function hasMember(members: Member[], sender: Sender) {
  return members.some((member) => member.id === sender);
}

export function HomeClient() {
  const [sender, setSender] = useState<Sender | null>(null);
  const [members, setMembers] = useState<Member[]>(DEFAULT_MEMBER_LIST);
  const [isHydrated, setIsHydrated] = useState(false);

  const loadMembers = useCallback(async () => {
    const response = await fetch("/api/members", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Members failed to load.");
    }

    const data = (await response.json()) as { members: Member[] };
    return data.members.length > 0 ? data.members : DEFAULT_MEMBER_LIST;
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      let loadedMembers = DEFAULT_MEMBER_LIST;

      try {
        loadedMembers = await loadMembers();
      } catch {
        loadedMembers = DEFAULT_MEMBER_LIST;
      }

      if (!isMounted) {
        return;
      }

      const savedSender = window.localStorage.getItem(STORAGE_KEY);
      setMembers(loadedMembers);

      if (isSender(savedSender) && hasMember(loadedMembers, savedSender)) {
        setSender(savedSender);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }

      setIsHydrated(true);
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, [loadMembers]);

  function chooseSender(nextSender: Sender) {
    window.localStorage.setItem(STORAGE_KEY, nextSender);
    setSender(nextSender);
  }

  function clearSender() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSender(null);
  }

  function handleMembersChange(nextMembers: Member[]) {
    setMembers(nextMembers);

    if (sender && !hasMember(nextMembers, sender)) {
      clearSender();
    }
  }

  if (!isHydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-paper px-5">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
      </main>
    );
  }

  if (sender) {
    return (
      <ChatRoom
        sender={sender}
        members={members}
        onMembersChange={handleMembersChange}
        onSwitchIdentity={clearSender}
      />
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_25%,#ffffff_0%,#f1f5f9_42%,#dbeafe_100%)] px-5 py-8 text-ink">
      <section className="grid w-full max-w-[22rem] grid-cols-1 gap-3 sm:max-w-3xl sm:grid-cols-3 sm:gap-4">
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => chooseSender(member.id)}
            className="flex aspect-[2.8/1] min-w-0 items-center justify-center rounded-3xl border border-white/80 bg-white/70 px-4 text-5xl font-semibold text-slate-950 shadow-[0_28px_90px_rgba(15,23,42,0.16)] backdrop-blur-xl transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.025] hover:border-brand/40 hover:bg-white/95 focus:outline-none focus:ring-4 focus:ring-brand/20 active:scale-[0.98] sm:aspect-square sm:text-7xl"
            aria-label={`選擇 ${member.name}`}
          >
            <span className="max-w-full truncate">{member.name}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
