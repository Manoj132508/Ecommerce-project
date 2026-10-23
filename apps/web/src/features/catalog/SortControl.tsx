"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { catalogHref, parseSort, SORT_OPTIONS, type SortOrder } from "./product";

/**
 * Sort order for the listing (?sort=). A GET form with a native <select>, so
 * it works without JavaScript (a <noscript> Apply button submits it) and keeps the
 * platform picker on phones. Once hydrated, choosing an option navigates
 * straight away; each choice is a history entry, so Back restores the previous
 * order. The search and category travel along as hidden fields.
 */
export function SortControl({ basePath, query, category, sort }: {
  basePath: string;
  query: string;
  category: string;
  sort: SortOrder;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Shows the new choice at once; falls back to the URL's value when the navigation settles.
  const [shown, setShown] = useOptimistic(sort);

  // The listing is updated in place (not remounted), so keyboard focus stays on the select.
  const onChange = (value: string) => {
    const next = parseSort(value);
    startTransition(() => {
      setShown(next);
      router.push(catalogHref(basePath, { query, category, sort: next }), { scroll: false });
    });
  };

  return (
    <Form action={basePath} className="flex items-center gap-2" aria-busy={pending || undefined}>
      {query && <input type="hidden" name="q" value={query} />}
      {category && <input type="hidden" name="category" value={category} />}
      <label htmlFor={id} className="text-sm font-medium whitespace-nowrap">Sort by</label>
      <select
        id={id}
        name="sort"
        value={shown}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "focus-ring min-h-11 cursor-pointer rounded-sm border border-input bg-background px-3 text-sm text-foreground lg:min-h-10",
          pending && "opacity-70",
        )}
      >
        {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {/* Only without JavaScript (never hydrated, so nothing moves when the page becomes interactive). */}
      <noscript><Button type="submit" variant="outline" size="sm">Apply</Button></noscript>
    </Form>
  );
}
