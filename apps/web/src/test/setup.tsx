// Test doubles for the Next.js runtime, used by every test file. Pages and
// components are rendered as plain React; navigation is recorded, not performed.
import type { AnchorHTMLAttributes, FormHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { navigation, NotFoundSignal, RedirectSignal } from "./navigation";

// "server-only" throws outside a React Server Components build; tests render server modules directly.
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, refresh: navigation.refresh, back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  notFound: () => {
    throw new NotFoundSignal();
  },
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; preload?: boolean; unoptimized?: boolean };
vi.mock("next/image", () => ({
  // Records the props the real component would turn into srcset/loading/fetchpriority.
  default: ({ src, alt, sizes, fill, preload, unoptimized, width, height, className }: ImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
    <img
      src={String(src)}
      alt={alt}
      className={className}
      width={width}
      height={height}
      data-sizes={sizes}
      data-fill={fill ? "true" : undefined}
      data-preload={preload ? "true" : "false"}
      data-unoptimized={unoptimized ? "true" : "false"}
    />
  ),
}));

vi.mock("next/form", () => ({
  default: ({ action, children, ...rest }: FormHTMLAttributes<HTMLFormElement> & { action: string; children: ReactNode }) => (
    <form action={action} method="get" {...rest}>{children}</form>
  ),
}));

afterEach(async () => {
  navigation.reset();
  vi.unstubAllGlobals();
  if (typeof window !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});
