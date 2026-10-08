import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-typescript.mjs";

const noop = () => {};
const { ChatSidebar } = loadModule("components/chat-sidebar.tsx");
const { MessageBubble } = loadModule("components/message-bubble.tsx", {
  "@/components/linkified-text": { LinkifiedText: ({ text }) => React.createElement("p", null, text) },
  "@/components/link-preview-card": { LinkPreviewCard: () => null }
});
const { ChatComposer } = loadModule("components/chat-composer.tsx");

test("sidebar exposes existing workflows and actual message metadata without inventing presence", () => {
  const html = renderToStaticMarkup(React.createElement(ChatSidebar, {
    identity: "10", memberCount: 3, lastMessageTime: "18:39", unreadCount: 4, isAtBottom: true, isOpen: false,
    onClose: noop, onShowChat: noop, onShowHistory: noop, onShowImages: noop, onSearch: noop,
    onLatest: noop, onSwitchIdentity: noop
  }));
  for (const label of ["通話紀錄", "聊天圖片", "搜尋訊息", "換身分", "最後訊息 18:39"]) assert.ok(html.includes(label));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(!html.includes("最後上線"));
  assert.ok(!html.includes('aria-modal="true"'), "closed mobile navigation must not mount a hidden modal");
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
  assert.ok(render({ sender: "ZUO" }).includes("bg-white text-ink"));
  const recalled = render({ text: null, recalledAt: new Date().toISOString() });
  assert.ok(recalled.includes("border-dashed border-slate-300 bg-transparent text-slate-500"));
  assert.ok(!recalled.includes("bg-brand text-white"));
  const failed = render({ clientStatus: "failed" });
  assert.ok(failed.includes("border-red-200 bg-red-50 text-red-700"));
  assert.ok(!failed.includes("bg-brand text-white"));
});

test("composer keeps mention controls available without a permanently expanded member list", () => {
  const html = renderToStaticMarkup(React.createElement(ChatComposer, {
    currentSender: "CHEN", members: [{ id: "CHEN", name: "10" }, { id: "ZUO", name: "27" }], isSending: false,
    replyTo: null, editing: null, editingLabel: null, onCancelReply: noop, onCancelEdit: noop,
    onTypingActivity: noop, onSubmit: async () => {}
  }));
  assert.ok(html.includes('aria-label="提及成員"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-label="訊息內容"'));
  assert.ok(html.includes('aria-label="上傳圖片"'));
  assert.ok(!html.includes("@27"));
});
