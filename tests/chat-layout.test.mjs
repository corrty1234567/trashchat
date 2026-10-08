import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-typescript.mjs";

const noop = () => {};
const { MessageBubble } = loadModule("components/message-bubble.tsx", {
  "@/components/linkified-text": { LinkifiedText: ({ text }) => React.createElement("p", null, text) },
  "@/components/link-preview-card": { LinkPreviewCard: () => null }
});
const { ChatComposer } = loadModule("components/chat-composer.tsx");
const { ChatRoom } = loadModule("components/chat-room.tsx", {
  "next/dynamic": { default: () => () => null, __esModule: true },
  "@/components/admin-snake-gate": { AdminSnakeGate: () => null },
  "@/components/browser-chat-status": { BrowserChatStatus: () => null },
  "@/components/chat-composer": { ChatComposer },
  "@/components/image-lightbox": { ImageLightbox: () => null },
  "@/components/member-admin-panel": { MemberAdminPanel: () => null },
  "@/components/message-bubble": { MessageBubble },
  "@/components/voice-call": { VoiceCall: () => React.createElement("button", { "aria-label": "語音通話" }) }
});

test("compact chat restores direct controls without added navigation or shortcuts", () => {
  const html = renderToStaticMarkup(React.createElement(ChatRoom, {
    sender: "CHEN", members: [{ id: "CHEN", name: "10" }, { id: "ZUO", name: "27" }],
    onMembersChange: noop, onSwitchIdentity: noop
  }));
  for (const label of ["搜尋訊息", "聊天圖片", "語音通話", "重新整理", "換身分", "開啟 trashchat"]) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
  for (const label of ["自動滑到底", "側邊導覽", "開啟導覽", "更多選項", "位成員", "最後訊息"]) {
    assert.ok(!html.includes(label), `must not restore unsolicited control: ${label}`);
  }
  assert.ok(html.includes("max-w-4xl"));
});

test("own, incoming, recalled, and failed bubbles have mutually exclusive readable colors", () => {
  const base = { id: "test-message", sender: "CHEN", text: "test", imageUrl: null, imageUrls: [], thumbnailUrls: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), recalledAt: null, editedAt: null, reads: [] };
  const render = patch => renderToStaticMarkup(React.createElement(MessageBubble, {
    message: { ...base, ...patch }, currentSender: "CHEN", members: [{ id: "CHEN", name: "10" }, { id: "ZUO", name: "27" }],
    isHighlighted: false, showTimestamp: true, readByLabels: null,
    onReply: noop, onEdit: noop, onRecall: noop, onOpenImages: noop, onQuoteClick: noop
  }));
  assert.ok(render({}).includes("border-brand bg-brand text-white"));
  assert.ok(render({}).includes("border px-3 py-2"));
  assert.ok(render({ sender: "ZUO" }).includes("bg-white text-ink"));
  const recalled = render({ text: null, recalledAt: new Date().toISOString() });
  assert.ok(recalled.includes("border-dashed border-slate-300 bg-transparent text-slate-500"));
  assert.ok(!recalled.includes("bg-brand text-white"));
  const failed = render({ clientStatus: "failed" });
  assert.ok(failed.includes("border-red-200 bg-red-50 text-red-700"));
  assert.ok(!failed.includes("bg-brand text-white"));
});

test("composer restores visible mention shortcuts and a compact input", () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    currentSender: "CHEN", members: [{ id: "CHEN", name: "10" }, { id: "ZUO", name: "27" }], isSending: false,
    replyTo: null, editing: null, editingLabel: null, onCancelReply: noop, onCancelEdit: noop,
    onTypingActivity: noop, onSubmit: async () => {}
  }));
  assert.ok(!html.includes('aria-label="提及成員"'));
  assert.ok(html.includes("@27"));
  assert.ok(!html.includes("@10"));
  assert.ok(html.includes("max-w-4xl"));
  assert.ok(html.includes("min-h-11"));
  assert.ok(html.includes('aria-label="訊息內容"'));
  assert.ok(html.includes('aria-label="上傳圖片"'));
});

test("editing still hides mention shortcuts and disables photo selection", () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    currentSender: "CHEN", members: [{ id: "CHEN", name: "10" }, { id: "ZUO", name: "27" }], isSending: false,
    replyTo: null, editing: { id: "editing-message", text: "original" }, editingLabel: "10",
    onCancelReply: noop, onCancelEdit: noop, onTypingActivity: noop, onSubmit: async () => {}
  }));
  assert.ok(!html.includes("@27"));
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.ok(html.includes('aria-label="儲存編輯"'));
});
