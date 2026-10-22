"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
    return <p className="rounded border bg-slate-50 p-3">This order is {statusLabel(order.status).toLowerCase()}; its status can no longer change.</p>;
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
      <p role="status" className={done ? "rounded border border-green-300 bg-green-50 p-3 text-green-900" : "sr-only"}>{done}</p>
      {change.isError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{change.error.message}</p>}
      <div>
        <label htmlFor="order-status" className="font-medium">New status</label>
        <select
          id="order-status"
          value={status}
          onChange={(event) => { setStatus(event.target.value as OrderStatus | ""); setErrors((current) => ({ ...current, status: undefined })); }}
          aria-invalid={errors.status ? true : undefined}
          aria-describedby={errors.status ? "order-status-error" : undefined}
          className="mt-1 block w-full rounded-md border border-slate-400 bg-white px-3 py-2 sm:w-64"
        >
          <option value="">Choose…</option>
          {options.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
        </select>
        {errors.status && <p id="order-status-error" className="mt-1 text-sm font-medium text-red-700">{errors.status}</p>}
      </div>
      <div>
        <label htmlFor="order-status-reason" className="font-medium">Reason</label>
        <p id="order-status-reason-hint" className="text-sm text-slate-600">Required. Saved with your name and the time; it cannot be edited later.</p>
        <textarea
          id="order-status-reason"
          value={reason}
          maxLength={MAX_REASON}
          rows={3}
          required
          onChange={(event) => { setReason(event.target.value); setErrors((current) => ({ ...current, reason: undefined })); }}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={`order-status-reason-hint${errors.reason ? " order-status-reason-error" : ""}`}
          className="mt-1 w-full rounded-md border border-slate-400 px-3 py-2"
        />
        <p className="text-right text-xs text-slate-600">{reason.length}/{MAX_REASON}</p>
        {errors.reason && <p id="order-status-reason-error" className="text-sm font-medium text-red-700">{errors.reason}</p>}
      </div>
      <button type="submit" disabled={change.isPending} className="justify-self-start rounded bg-[#198754] px-5 py-2 font-semibold text-white hover:bg-[#126c45] disabled:opacity-60">
        {change.isPending ? "Saving…" : "Change status"}
      </button>
    </form>
  );
}
