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
    const savedSender = window.localStorage.getItem(STORAGE_KEY);

    // Protected identities can open chat while the member list loads in parallel.
    if (!isSender(savedSender) || hasMember(DEFAULT_MEMBER_LIST, savedSender)) {
      setSender(isSender(savedSender) ? savedSender : null);
      setIsHydrated(true);
    }

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

      const activeSavedSender = window.localStorage.getItem(STORAGE_KEY);
      setMembers(loadedMembers);

      if (isSender(activeSavedSender) && hasMember(loadedMembers, activeSavedSender)) {
        setSender(activeSavedSender);
      } else {
        setSender(null);
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
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-paper px-6 py-8 text-ink">
      <section className="grid w-full max-w-[22rem] grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-3 sm:gap-5">
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => chooseSender(member.id)}
            className="flex aspect-[2.8/1] min-w-0 items-center justify-center rounded-lg border border-line bg-white px-4 text-5xl font-semibold text-ink shadow-[0_2px_8px_rgba(32,39,41,0.03)] transition duration-200 ease-out hover:-translate-y-1 hover:border-brand/40 hover:text-brand hover:shadow-[0_12px_30px_rgba(24,118,95,0.08)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 active:translate-y-0 sm:aspect-square sm:text-6xl"
            aria-label={`選擇 ${member.name}`}
          >
            <span className="max-w-full truncate">{member.name}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
