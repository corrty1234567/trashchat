import { DEFAULT_MEMBERS, getSenderLabel, type Member, type Sender } from "@/lib/types";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLabelToSender(members: readonly Member[]) {
  return members.reduce(
    (labels, member) => {
      labels[member.name] = member.id;
      return labels;
    },
    {} as Record<string, Sender>
  );
}

function createMentionPattern(members: readonly Member[]) {
  const labels = members
    .map((member) => member.name)
    .filter(Boolean)
    .sort((first, second) => second.length - first.length)
    .map(escapeRegExp);

  if (labels.length === 0) {
    return null;
  }

  return new RegExp(`(^|[^\\p{L}\\p{N}_])@(${labels.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
}

export function getMentionToken(sender: Sender, members: readonly Member[] = DEFAULT_MEMBERS) {
  return `@${getSenderLabel(sender, members)}`;
}

export function getMentionedSenders(text?: string | null, members: readonly Member[] = DEFAULT_MEMBERS) {
  if (!text) {
    return [];
  }

  const mentionedSenders = new Set<Sender>();
  const mentionPattern = createMentionPattern(members);
  const labelToSender = getLabelToSender(members);

  if (!mentionPattern) {
    return [];
  }

  for (const match of text.matchAll(mentionPattern)) {
    const sender = labelToSender[match[2]];

    if (sender) {
      mentionedSenders.add(sender);
    }
  }

  return [...mentionedSenders];
}

export function mentionsSender(
  text: string | null | undefined,
  sender: Sender,
  members: readonly Member[] = DEFAULT_MEMBERS
) {
  return getMentionedSenders(text, members).includes(sender);
}

export function splitMentionText(text: string, members: readonly Member[] = DEFAULT_MEMBERS) {
  const parts: Array<{ type: "text" | "mention"; value: string; sender?: Sender }> = [];
  let lastIndex = 0;
  const mentionPattern = createMentionPattern(members);
  const labelToSender = getLabelToSender(members);

  if (!mentionPattern) {
    return [{ type: "text", value: text }];
  }

  for (const match of text.matchAll(mentionPattern)) {
    const prefix = match[1] ?? "";
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + prefix.length;
    const mentionValue = match[0].slice(prefix.length);
    const sender = labelToSender[match[2]];

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
