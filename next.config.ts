import type { NextConfig } from "next"

// Empty locally. On Matrix OS: NEXT_BASE_PATH=/apps/hallway-hunter npm run build (baked in at build time).
const base = process.env.NEXT_BASE_PATH || ""

const config: NextConfig = {
  basePath: base,
  // Matrix scopes the app session cookie to "/apps/<slug>/"; without the slash a link home loses it.
  trailingSlash: Boolean(base),
  env: { NEXT_PUBLIC_BASE_PATH: base }, // read by lib/base.ts
  devIndicators: false,
  turbopack: { root: import.meta.dirname },
}

export default config
