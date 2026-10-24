import posthog from "posthog-js"

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (!posthogKey || !posthogHost) {
  // PostHog is optional: without its env vars the app runs and sends nothing.
} else {
  // Test traffic (clumsy-user agents) opens the app with ?synthetic=1; every event in this browser for the next
  // 12 h gets synthetic_tester=true so it can be filtered out. localStorage, not sessionStorage, so tabs opened
  // with target=_blank (the /p links on /hq) keep the tag.
  let synthetic = false
  try {
    if (new URLSearchParams(window.location.search).has("synthetic")) localStorage.setItem("synthetic_tester", String(Date.now()))
    synthetic = Date.now() - Number(localStorage.getItem("synthetic_tester") ?? 0) < 12 * 3600_000
  } catch { /* storage blocked */ }
  posthog.init(posthogKey, {
    before_send: (event) => {
      if (synthetic && event) event.properties = { ...event.properties, synthetic_tester: true }
      return event
    },
    api_host: posthogHost,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  })
}
