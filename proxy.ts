import { createHash, timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

// Optional HTTP basic auth, off unless HQ_PASSWORD is set (any username, that password). It guards every route
// (/hq, /capture, the landing page with its list of drafts, and every /api route) except what a client opening a
// /p link needs: the /p pages themselves render on the server and call no /api route. /api/health stays open for
// deploy health checks.
const OPEN = /^\/(p(\/|$)|api\/health$|icon\.svg$|favicon\.ico$)/
const sha = (s: string) => createHash("sha256").update(s).digest()

export function proxy(req: NextRequest) {
  const pw = process.env.HQ_PASSWORD
  if (!pw || OPEN.test(req.nextUrl.pathname)) return NextResponse.next()
  const [scheme, b64] = (req.headers.get("authorization") ?? "").split(" ")
  const given = scheme === "Basic" && b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : ""
  if (timingSafeEqual(sha(given), sha(pw))) return NextResponse.next()
  return new NextResponse("Velho HQ: password required.", { status: 401, headers: { "www-authenticate": 'Basic realm="Velho HQ", charset="UTF-8"' } })
}

export const config = { matcher: ["/((?!_next/).*)"] }
