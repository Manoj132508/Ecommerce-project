"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, FieldHint } from "@/features/auth/fields";
import { requireCsrfToken } from "@/features/auth/hooks";
import type { Order } from "@/features/orders/api";
import { changeOrderStatus, nextStatuses, statusLabel, type OrderStatus } from "./api";

const MAX_REASON = 500;

/**
 * Moves an order to one of the statuses allowed from its current one, with a
 * required reason. Express checks the role, the transition and the reason
 * again, and PostgreSQL records the change in the append-only audit trail.
 */
export function OrderStatusForm({ order }: { order: Order }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = nextStatuses(order.status);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ status?: string; reason?: string }>({});
  const [done, setDone] = useState("");

  const change = useMutation({
    mutationKey: ["admin", "order-status"],
    mutationFn: async (values: { status: OrderStatus; reason: string }) => (
      changeOrderStatus(order.id, values.status, values.reason, await requireCsrfToken(queryClient))
    ),
    onSuccess: (updated) => {
      setDone(`Status changed to ${statusLabel(updated.status)}. The change is recorded in the history below.`);
      setStatus("");
      setReason("");
      router.refresh();
    },
  });

  if (options.length === 0) {
    return <Alert>This order is {statusLabel(order.status).toLowerCase()}; its status can no longer change.</Alert>;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDone("");
    const found = {
      status: status ? undefined : "Choose the new status.",
      reason: reason.trim() ? undefined : "Give a reason. It is saved in the order history.",
    };
    setErrors(found);
    if (found.status) document.getElementById("order-status")?.focus();
    else if (found.reason) document.getElementById("order-status-reason")?.focus();
    if (found.status || found.reason || !status) return;
    change.mutate({ status, reason: reason.trim() });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {done ? <Alert role="status" variant="success">{done}</Alert> : <p role="status" className="sr-only" />}
      {change.isError && <Alert role="alert" variant="destructive">{change.error.message}</Alert>}
      <div className="grid gap-1.5">
        <Label htmlFor="order-status">New status</Label>
        <select
          id="order-status"
          value={status}
          onChange={(event) => { setStatus(event.target.value as OrderStatus | ""); setErrors((current) => ({ ...current, status: undefined })); }}
          aria-invalid={errors.status ? true : undefined}
          aria-describedby={errors.status ? "order-status-error" : undefined}
          className="focus-ring min-h-11 w-full cursor-pointer rounded-sm border border-input bg-background px-3 text-base text-foreground aria-invalid:border-destructive lg:min-h-10"
        >
          <option value="">Choose…</option>
          {options.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
        </select>
        <FieldError id="order-status-error" message={errors.status} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="order-status-reason">Reason</Label>
        <FieldHint id="order-status-reason-hint">Required. Saved with your name and the time; it cannot be edited later.</FieldHint>
        <Textarea
          id="order-status-reason"
          value={reason}
          maxLength={MAX_REASON}
          rows={3}
          required
          onChange={(event) => { setReason(event.target.value); setErrors((current) => ({ ...current, reason: undefined })); }}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={`order-status-reason-hint${errors.reason ? " order-status-reason-error" : ""}`}
        />
        <p className="text-right text-xs tabular-nums text-muted-foreground">{reason.length}/{MAX_REASON}</p>
        <FieldError id="order-status-reason-error" message={errors.reason} />
      </div>
      <Button type="submit" disabled={change.isPending} aria-busy={change.isPending || undefined} className="justify-self-start">
        {change.isPending ? "Saving…" : "Change status"}
      </Button>
    </form>
  );
}
