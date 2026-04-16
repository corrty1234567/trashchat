export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function canEditMessage(createdAt: string | Date, recalledAt?: string | Date | null) {
  if (recalledAt) {
    return false;
  }

  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created <= EDIT_WINDOW_MS;
}

export function formatMessageTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function getMessageMinuteKey(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ].join("-");
}

export function truncateText(text: string, maxLength = 20) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
