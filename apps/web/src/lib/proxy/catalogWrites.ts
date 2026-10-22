/** An admin create, edit or delete of a product that succeeded (Express has already checked the role). */
export const changesCatalog = (request: Request, status: number) => (
  request.method !== "GET" && request.method !== "HEAD" && status >= 200 && status < 300
  && /^\/api\/products(\/[^/]+)?$/.test(new URL(request.url).pathname)
);
