import { hasKey } from "@/lib/claude.ts"
import { didYouMean, exactLive, parentLive, searchCompanies, type Candidate } from "@/lib/live/prh.ts"
import { extractCard, SUPPORTED, type CardExtract, type ImageType } from "@/lib/live/vision.ts"

export const dynamic = "force-dynamic"
const err = (status: number, error: string) => Response.json({ error }, { status })

// POST multipart {image?, q?} or JSON {q} -> PRH candidates (+ "did you mean" when nothing matched).
export async function POST(req: Request) {
  const t0 = Date.now()
  let q = ""
  let image: File | null = null
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const f = await req.formData()
    q = String(f.get("q") ?? "")
    const img = f.get("image")
    if (img instanceof File && img.size) image = img
  } else {
    q = String(((await req.json().catch(() => ({}))) as { q?: unknown }).q ?? "")
  }

  let extracted: CardExtract | null = null
  if (image) {
    if (!hasKey()) return err(503, "No API key on the server, so photos can't be read. Type the company name instead.")
    if (!(SUPPORTED as readonly string[]).includes(image.type)) return err(415, `Unsupported image type ${image.type || "?"}`)
    if (image.size > 4_500_000) return err(413, "Image too large (max ~4.5 MB)")
    try {
      extracted = await extractCard(Buffer.from(await image.arrayBuffer()).toString("base64"), image.type as ImageType)
    } catch (e) {
      return err(502, `Couldn't read the card (${e instanceof Error ? e.message : e}). Type the company name instead.`)
    }
    q = extracted.business_id ?? extracted.company_name
    if (!q) return Response.json({ extracted, candidates: [], suggestions: [], auto: null, ms: Date.now() - t0 })
  }
  q = q.trim().slice(0, 120)
  if (!q) return err(400, "Send a photo or a company name")

  let candidates: Candidate[] = []
  let suggestions: Candidate[] = []
  try {
    candidates = await searchCompanies(q)
    // A Y-tunnus read off a card might be wrong; fall back to the printed name.
    if (!candidates.length && extracted?.business_id && extracted.company_name) candidates = await searchCompanies(extracted.company_name)
    // Typo, missing ä/ö ("Wartsila") or only ceased namesakes: offer "did you mean" (not for a Y-tunnus).
    if (!candidates.some((c) => !c.ceased) && !/^\d{7}-\d$/.test(q)) {
      const seen = new Set(candidates.map((c) => c.business_id))
      suggestions = (await didYouMean(extracted?.company_name || q)).filter((c) => !seen.has(c.business_id))
    }
  } catch (e) {
    return err(502, `Finnish trade register (PRH) unavailable: ${e instanceof Error ? e.message : e}`)
  }
  const live = candidates.filter((c) => !c.ceased)
  const auto = (extracted?.business_id && candidates[0]?.business_id === extracted.business_id) || (candidates.length === 1 && live.length === 1)
    ? candidates[0].business_id : (exactLive(extracted?.company_name || q, candidates) ?? parentLive(extracted?.company_name || q, candidates))?.business_id ?? null
  return Response.json({ q, extracted, candidates, suggestions, auto, ms: Date.now() - t0 })
}
