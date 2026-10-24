// Synthetic demo data so both lanes can work before the other lands. Fictional company, no real people.
// Usage: npm run seed   (idempotent: skips if the demo company exists)
import { addSource, get, insert, now } from "../lib/db.ts"

const id = "co_demo"
if (get("SELECT id FROM companies WHERE id = ?", id)) {
  console.log("demo already seeded")
} else {
  insert("companies", { id, business_id: null, name: "Esimerkki Logistiikka Oy (synthetic)", website: null, prh: null, created_at: now() })
  insert("leads", {
    id: "lead_demo", company_id: id, role: "Head of Finance",
    quote: "We still re-key every carrier invoice by hand, three of us, every Monday.",
    pain: "manual invoice re-keying", next_step: "send a one-page draft", temperature: "warm", synthetic: 1, created_at: now(),
  })
  addSource({ company_id: id, kind: "hallway", title: "Hallway note, Head of Finance", excerpt: "We still re-key every carrier invoice by hand, three of us, every Monday.", lead_id: "lead_demo" })
  addSource({ company_id: id, kind: "note", title: "Synthetic registry profile", excerpt: "Freight forwarding, 120 employees, registered 2004 (synthetic test data)." })
  addSource({ company_id: id, kind: "note", title: "Synthetic tender notice", excerpt: "Won a 2026 municipal transport framework, 3-year term (synthetic test data)." })
  console.log("seeded co_demo")
}
