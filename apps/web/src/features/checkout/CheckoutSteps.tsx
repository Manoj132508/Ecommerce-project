import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
] as const;

export type CheckoutStep = (typeof STEPS)[number]["id"];

/**
 * Step indicator: the current step is marked aria-current="step" and named in
 * text ("Step 1 of 2"), never by colour alone; finished steps show a tick.
 */
export function CheckoutSteps({ current }: { current: CheckoutStep }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-muted-foreground">Step {index + 1} of {STEPS.length}</p>
      <ol aria-label="Checkout steps" className="flex items-center gap-2">
        {STEPS.map((step, position) => {
          const done = position < index;
          const active = position === index;
          return (
            <li key={step.id} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
              {position > 0 && <span aria-hidden="true" className={cn("h-0.5 w-8 rounded-full sm:w-16", done || active ? "bg-primary" : "bg-border")} />}
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && "border-primary bg-accent text-accent-foreground",
                  !active && !done && "border-input text-muted-foreground",
                )}
              >
                {done ? <CheckIcon className="size-4" /> : position + 1}
              </span>
              <span className={cn("text-sm", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {step.label}{done && <>{" "}<span className="sr-only">(completed)</span></>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
