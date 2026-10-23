"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { Alert } from "./alert";
import { Button } from "./button";

/**
 * Confirmation for a destructive action, on the native <dialog> element:
 * showModal() makes the rest of the page inert, keeps focus inside and closes
 * on Escape — no dependency needed. Focus starts on the least destructive
 * button (a stray Enter keeps things as they are) and returns to the control
 * that opened it. While the action runs, the dialog cannot be dismissed.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, pendingLabel, cancelLabel = "Cancel", pending = false, error, onConfirm, onCancel, returnFocusTo }: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Where focus goes when the dialog closes; by default the element that had focus when it opened. */
  returnFocusTo?: RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      cancelButton.current?.focus();
    } else if (!open && element.open) {
      element.close();
      const target = (typeof returnFocusTo === "function" ? returnFocusTo() : returnFocusTo?.current) ?? opener.current;
      if (target?.isConnected) target.focus();
    }
  }, [open, returnFocusTo]);

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      // Escape: the browser fires "cancel"; React state decides whether it closes.
      onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-foreground/50"
    >
      {open && (
        <div className="grid gap-4 p-6">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <div id={textId} className="text-sm leading-6 text-muted-foreground">{children}</div>
          {error && <Alert role="alert" variant="destructive">{error}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button ref={cancelButton} variant="outline" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
            <Button variant="destructive" onClick={onConfirm} disabled={pending} aria-busy={pending || undefined}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
