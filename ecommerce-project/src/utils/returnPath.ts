// Where to send the user after logging in. Only same-app paths are allowed:
// a leading "/" that is not "//" or "/\" (protocol-relative URLs would leave
// the site), no backslashes or control characters, and never the auth pages
// themselves (which would loop).
const AUTH_PAGES = ['/login', '/register'];

export function safeReturnPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  const pathname = value.split(/[?#]/, 1)[0] ?? '';
  if (AUTH_PAGES.includes(pathname)) return fallback;

  return value;
}
