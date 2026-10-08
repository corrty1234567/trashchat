"use client";

/* eslint-disable @next/next/no-img-element */

import { AtSign, ImagePlus, Send, X } from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getMentionToken } from "@/lib/mentions";
import { getReplyPreview } from "@/lib/messages";
import { type Member, type Message, type Sender } from "@/lib/types";

export type ComposerPayload = {
  text: string;
  files: File[];
};

type ChatComposerProps = {
  currentSender: Sender;
  members: readonly Member[];
  isSending: boolean;
  replyTo: Message | null;
  editing: Message | null;
  editingLabel: string | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onTypingActivity: (isTyping: boolean) => void;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
};

const MAX_SELECTED_IMAGES = 10;

export function ChatComposer({
  currentSender,
  members,
  isSending,
  replyTo,
  editing,
  editingLabel,
  onCancelReply,
  onCancelEdit,
  onTypingActivity,
  onSubmit
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewItems, setPreviewItems] = useState<Array<{ file: File; url: string }>>([]);
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionTargets = useMemo(
    () => members.filter((member) => member.id !== currentSender),
    [currentSender, members]
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(144, Math.max(44, textarea.scrollHeight))}px`;
  }, [text]);

  useEffect(() => {
    if (editing) {
      setText(editing.text ?? "");
      setFiles([]);
      setIsMentionMenuOpen(false);
    }
  }, [editing]);

  useEffect(() => {
    if (!isMentionMenuOpen) return;
    const pointerdown = (event: PointerEvent) => {
      if (!mentionMenuRef.current?.contains(event.target as Node)) setIsMentionMenuOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsMentionMenuOpen(false);
      textareaRef.current?.focus();
    };
    document.addEventListener("pointerdown", pointerdown);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", pointerdown); document.removeEventListener("keydown", keydown); };
  }, [isMentionMenuOpen]);

  useEffect(() => {
    return () => onTypingActivity(false);
  }, [onTypingActivity]);

  useEffect(() => {
    const nextPreviewItems = files.map((selectedFile) => ({
      file: selectedFile,
      url: URL.createObjectURL(selectedFile)
    }));

    setPreviewItems(nextPreviewItems);

    return () => {
      nextPreviewItems.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [files]);

  const canSubmit = useMemo(
    () => Boolean(text.trim() || files.length > 0) && !(editing && isSending),
    [editing, files.length, isSending, text]
  );

  function addFiles(nextFiles: File[]) {
    if (editing || nextFiles.length === 0) {
      return;
    }

    setFiles((currentFiles) => {
      const imageFiles = nextFiles.filter((nextFile) => nextFile.type.startsWith("image/"));
      return [...currentFiles, ...imageFiles].slice(0, MAX_SELECTED_IMAGES);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const submittedText = text.trim();
    const submittedFiles = files;

    setText("");
    setFiles([]);
    onTypingActivity(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    await onSubmit({
      text: submittedText,
      files: submittedFiles
    });
  }

  function insertMention(sender: Sender) {
    setIsMentionMenuOpen(false);
    if (editing) {
      return;
    }

    const token = getMentionToken(sender, members);
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? text.length;
    const selectionEnd = textarea?.selectionEnd ?? text.length;
    const before = text.slice(0, selectionStart);
    const after = text.slice(selectionEnd);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    const suffix = after && !/^\s/.test(after) ? " " : " ";
    const nextText = `${before}${prefix}${token}${suffix}${after}`;
    const cursorPosition = before.length + prefix.length + token.length + 1;

    setText(nextText);
    onTypingActivity(true);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  return (
    <footer className="shrink-0 border-t border-line bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 xl:px-20 2xl:px-24">
      <div className="w-full">
        {replyTo ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-800">正在回覆</p>
              <p className="truncate text-slate-500">{getReplyPreview(replyTo)}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900"
              aria-label="取消回覆"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {editing ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-amber-900">正在編輯訊息</p>
              <p className="truncate text-amber-700">{editingLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setText("");
                onCancelEdit();
              }}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-white hover:text-amber-950"
              aria-label="取消編輯"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {previewItems.length > 0 ? (
          <div className="mb-2 rounded-lg border border-line bg-slate-50 p-2">
            <div className="mb-2 flex items-center justify-between gap-3 text-sm text-slate-600">
              <p>
                已選擇 {previewItems.length} 張圖片
                {text.trim() ? "，文字會放在第一張" : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFiles([]);

                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-white hover:text-slate-900"
              >
                全部移除
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previewItems.map((item, index) => (
                <div key={`${item.file.name}-${item.file.lastModified}-${index}`} className="relative h-20 w-20 shrink-0">
                  <img src={item.url} alt="待傳送圖片預覽" className="h-20 w-20 rounded-md bg-white object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index));

                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/75"
                    aria-label="移除圖片"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex items-end gap-2 sm:gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={Boolean(editing)}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />

          <button
            type="button"
            disabled={Boolean(editing)}
            onClick={() => fileInputRef.current?.click()}
            className="icon-button !h-12 !w-9 sm:!h-14 sm:!w-11"
            title="上傳圖片"
            aria-label="上傳圖片"
          >
            <ImagePlus size={22} strokeWidth={1.8} />
          </button>

          <div className="flex min-w-0 flex-1 items-end rounded-lg bg-[#f2f5f9] transition focus-within:bg-[#f5f8fc] focus-within:shadow-[0_0_0_2px_rgba(23,105,255,0.12)]">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onTypingActivity(!editing && Boolean(event.target.value.trim()));
            }}
            onPaste={(event) => {
              if (editing) {
                return;
              }

              const pastedImages = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((item): item is File => Boolean(item));

              if (pastedImages.length > 0) {
                addFiles(pastedImages);
              }
            }}
            rows={1}
            placeholder={editing ? "修改訊息內容" : "輸入訊息"}
            aria-label="訊息內容"
            className="max-h-36 min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent px-4 py-3 text-base leading-6 outline-none placeholder:text-slate-400 sm:min-h-14 sm:px-5 sm:py-4"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {!editing && mentionTargets.length > 0 ? <div ref={mentionMenuRef} className="relative shrink-0 pb-2 pr-1 sm:pb-3 sm:pr-2">
            <button type="button" onClick={() => setIsMentionMenuOpen(current => !current)} className={`icon-button !h-8 !w-8 ${isMentionMenuOpen ? "!text-brand" : "!text-slate-400"}`} title="提及成員" aria-label="提及成員" aria-expanded={isMentionMenuOpen}><AtSign size={17} /></button>
            {isMentionMenuOpen ? <div role="dialog" aria-label="提及成員" className="absolute bottom-[calc(100%+0.75rem)] right-0 z-20 max-h-56 w-52 max-w-[calc(100vw-6rem)] overflow-y-auto rounded-lg border border-line bg-white p-1.5 shadow-soft">
              {mentionTargets.map(target => <button key={target.id} type="button" onClick={() => insertMention(target.id)} className="block w-full truncate rounded-md px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-blue-50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30" title={target.name}>@{target.name}</button>)}
            </div> : null}
          </div> : null}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:bg-[#f2f5f9] disabled:text-slate-400 sm:h-14 sm:w-14"
            title={editing ? "儲存編輯" : "送出訊息"}
            aria-label={editing ? "儲存編輯" : "送出訊息"}
          >
            {editing && isSending ? "..." : <Send size={21} strokeWidth={1.8} />}
          </button>
        </form>
      </div>
    </footer>
  );
}
