// Badge / business-card photo -> {company_name, business_id, role}. No person names leave this function.
import { runAgent } from "../claude.ts"

export interface CardExtract { company_name: string; business_id: string | null; role: string | null }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["company_name", "business_id", "role"],
  properties: {
    company_name: { type: "string", description: "Company/organisation name as printed, legal suffix included if shown (Oy, Oyj, Ab). Empty string if none." },
    business_id: { type: ["string", "null"], description: "Finnish Y-tunnus (1234567-8) only if printed on the card, else null." },
    role: { type: ["string", "null"], description: "Job title only, e.g. 'Head of Finance'. Never a person's name." },
  },
}

export const SUPPORTED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
export type ImageType = (typeof SUPPORTED)[number]

export async function extractCard(base64: string, mediaType: ImageType): Promise<CardExtract> {
  const r = await runAgent<CardExtract>({
    agent: "vision_extract",
    system: "You read conference badges and business cards. Return the employer company, its Finnish business ID if printed, and the job title. Never output a person's name in any field; if the only text is a name, leave role null.",
    prompt: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Extract the company, Y-tunnus and job title from this card." },
    ],
    effort: "low",
    maxTokens: 2000,
    schema: SCHEMA,
    timeoutMs: 12_000,
  })
  const j = r.json!
  const bid = j.business_id?.replace(/\s/g, "") ?? null
  return { company_name: j.company_name.trim(), business_id: bid && /^\d{7}-\d$/.test(bid) ? bid : null, role: j.role?.trim() || null }
}
