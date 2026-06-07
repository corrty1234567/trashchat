import { SENDER_LABEL, SENDER_VALUES, type Sender } from "@/lib/types";

const LABEL_TO_SENDER = SENDER_VALUES.reduce(
  (labels, sender) => {
    labels[SENDER_LABEL[sender]] = sender;
    return labels;
  },
  {} as Record<string, Sender>
);

function createMentionPattern() {
  return /(^|[^A-Za-z0-9_])[@＠](10|27|17)(?!\d)/g;
}

export function getMentionToken(sender: Sender) {
  return `@${SENDER_LABEL[sender]}`;
}

export function getMentionedSenders(text?: string | null) {
  if (!text) {
    return [];
  }

  const mentionedSenders = new Set<Sender>();

  for (const match of text.matchAll(createMentionPattern())) {
    const sender = LABEL_TO_SENDER[match[2]];

    if (sender) {
      mentionedSenders.add(sender);
    }
  }

  return [...mentionedSenders];
}

export function mentionsSender(text: string | null | undefined, sender: Sender) {
  return getMentionedSenders(text).includes(sender);
}

export function splitMentionText(text: string) {
  const parts: Array<{ type: "text" | "mention"; value: string; sender?: Sender }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(createMentionPattern())) {
    const prefix = match[1] ?? "";
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + prefix.length;
    const mentionValue = match[0].slice(prefix.length);
    const sender = LABEL_TO_SENDER[match[2]];

    if (mentionStart > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, mentionStart) });
    }

    if (sender) {
      parts.push({ type: "mention", value: mentionValue, sender });
    } else {
      parts.push({ type: "text", value: mentionValue });
    }

    lastIndex = mentionStart + mentionValue.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts;
}
