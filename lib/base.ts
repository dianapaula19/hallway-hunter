// Path prefix for client-side URLs. Matrix OS serves Next apps under /apps/<slug>; next.config sets basePath from
// NEXT_BASE_PATH and inlines the same value here. <Link>, the router and redirect() add it themselves; raw fetch,
// <a href> and <img src> do not, so wrap them: fetch(withBase("/api/hq")). Empty locally.
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const withBase = (path: string) => BASE + path

// Inside Matrix OS an app only works in the shell's window: a new browser tab lands on Matrix's
// "Refreshing session…" page. So internal links open in a new tab only when there is no base path.
export const newTab = BASE ? {} : { target: "_blank", rel: "noreferrer" }
