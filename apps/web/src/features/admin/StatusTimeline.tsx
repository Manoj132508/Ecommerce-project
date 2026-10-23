import { OrderStatusBadge } from "@/features/orders/OrderStatus";
import { formatOrderTime } from "@/lib/format";
import { statusLabel, type StatusEvent } from "./api";

/**
 * The append-only audit trail of an order's status (PostgreSQL), oldest first
 * as the API returns it: each change with its time, who made it and the
 * reason they gave. Nothing here can be edited.
 */
export function StatusTimeline({ events }: { events: StatusEvent[] }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">Oldest first. Recorded automatically; entries cannot be edited or removed.</p>
      <ol className="relative grid gap-4 border-l-2 border-border pl-6">
        {events.map((event, index) => (
          <li key={index} className="relative">
            <span aria-hidden="true" className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background bg-primary ring-2 ring-primary/30" />
            <div className="grid gap-1.5 rounded-md border border-border bg-card p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                {event.fromStatus && (
                  <>
                    <OrderStatusBadge status={event.fromStatus} label={statusLabel(event.fromStatus)} />{" "}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">to</span>{" "}
                  </>
                )}
                <OrderStatusBadge status={event.toStatus} label={statusLabel(event.toStatus)} />
              </p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={event.changedAt}>{formatOrderTime(Date.parse(event.changedAt))}</time> by {event.changedBy.name}
              </p>
              <blockquote className="text-sm leading-6 [overflow-wrap:anywhere]">“{event.reason}”</blockquote>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
