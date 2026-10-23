"use client";

import type { ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle (spec P7). The toggle is a real
 * button with aria-pressed and a fixed name ("Show password"), so its state is
 * announced without the name changing. Showing the password only switches the
 * input type in this browser tab: the value is never logged, stored or sent
 * anywhere else. The caller passes `visible` back as false on submit, so the
 * browser never keeps the value as plain-text form history.
 */
export function PasswordInput({ id, visible, onVisibleChange, toggleName = "password", className, ...props }: Omit<ComponentProps<"input">, "type"> & {
  id: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  /** Completes the toggle's name, "Show {toggleName}": distinct when a form has two password fields. */
  toggleName?: string;
}) {
  return (
    <div className="relative">
      <Input id={id} type={visible ? "text" : "password"} spellCheck={false} autoCapitalize="none" className={cn("pr-24", className)} {...props} />
      <button
        type="button"
        aria-pressed={visible}
        aria-controls={id}
        onClick={() => onVisibleChange(!visible)}
        className="focus-ring absolute inset-y-1 right-1 inline-flex items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-primary hover:bg-accent aria-pressed:bg-accent"
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        Show{" "}<span className="sr-only">{toggleName}</span>
      </button>
    </div>
  );
}
