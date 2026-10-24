// Path prefix for client-side URLs. Matrix OS serves Next apps under /apps/<slug>; next.config sets basePath from
// NEXT_BASE_PATH and inlines the same value here. <Link>, the router and redirect() add it themselves; raw fetch,
// <a href> and <img src> do not, so wrap them: fetch(withBase("/api/hq")). Empty locally.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const withBase = (path: string) => BASE + path
