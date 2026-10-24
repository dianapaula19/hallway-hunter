import type { NextConfig } from "next"

const config: NextConfig = { devIndicators: false, turbopack: { root: import.meta.dirname } }

export default config
