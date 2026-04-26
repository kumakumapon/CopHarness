import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CopHarness',
  description: 'LLM harness with CLI and Discord bot support',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
