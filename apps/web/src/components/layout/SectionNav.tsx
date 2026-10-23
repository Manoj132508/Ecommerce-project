"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SectionNavItem {
  href: string;
  label: string;
  /** Also current on deeper paths (for example /admin/products/123). */
  matchChildren?: boolean;
}

/**
 * Secondary navigation for an area (account, admin). The current page is
 * marked with aria-current="page" and a visible indicator that does not rely
 * on colour alone.
 */
export function SectionNav({ label, items, orientation = "horizontal" }: { label: string; items: SectionNavItem[]; orientation?: "horizontal" | "responsive" }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className={cn("flex flex-wrap gap-1", orientation === "responsive" ? "md:flex-col" : "border-b border-border pb-2")}>
        {items.map((item) => {
          const current = pathname === item.href || (item.matchChildren === true && pathname.startsWith(`${item.href}/`));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "focus-ring flex min-h-11 items-center rounded-sm px-3 text-sm font-medium hover:bg-secondary lg:min-h-10",
                  current ? "bg-accent font-semibold text-accent-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
