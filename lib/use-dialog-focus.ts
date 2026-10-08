"use client";

import { useEffect, useRef, type RefObject } from "react";

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const getFocusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0);
    (dialog.querySelector<HTMLElement>("[data-autofocus]") || getFocusable()[0] || dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const owner = (event.target as HTMLElement)?.closest?.('[role="dialog"]');
      const topmost = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
        .filter(element => element.getClientRects().length > 0).at(-1);
      // Disabled download buttons can move focus to the body while a modal is open.
      if (owner ? owner !== dialog : topmost !== dialog) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, [enabled, ref]);
}
