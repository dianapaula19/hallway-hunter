import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Hallway Hunter",
  description: "Velho draft tools, by Velho's AI analysts",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
