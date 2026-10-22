// A controllable stand-in for next/navigation in tests (see setup.tsx).
import { vi } from "vitest";

export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`NEXT_REDIRECT ${location}`);
  }
}

export const navigation = {
  pathname: "/",
  search: "",
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
  refresh: vi.fn<() => void>(),
  reset(pathname = "/", search = "") {
    this.pathname = pathname;
    this.search = search;
    this.push.mockReset();
    this.replace.mockReset();
    this.refresh.mockReset();
  },
};
