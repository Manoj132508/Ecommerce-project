import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Sign-in and registration: a centred card (max 448 px) with the page heading, an intro and the form. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="grid gap-6 p-6 sm:p-8">
        <div className="grid gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </Card>
    </div>
  );
}
