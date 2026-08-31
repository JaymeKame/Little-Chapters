import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Lexend, Lora } from 'next/font/google';
import { AuthProvider } from '@/components/AuthProvider';
import './globals.css';

const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend' });
const lora = Lora({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-serif' });

export const metadata: Metadata = {
  title: 'Little Chapters — The better 20 minutes.',
  description:
    'AI writes a new chapter every day at exactly their level. They read. AI listens. The adventure continues tomorrow.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Little Chapters',
  appleWebApp: { capable: true, title: 'Little Chapters', statusBarStyle: 'black-translucent' },
  // Correction pass 2, Section 7: the invented book/portal icon has been
  // reverted; no approved permanent Little Chapters mark exists in the
  // repository or its git history (only the pre-sprint child-portrait PNGs
  // survive at these paths, and Section 24 of the prior sprint explicitly
  // forbade using a child portrait as the app identity). Manifest and this
  // metadata therefore reference the pre-sprint paths verbatim while the
  // approved asset is supplied — see the acceptance report's item 14.
  icons: { icon: [{ url: '/pwa/icon-192.png', sizes: '192x192' }, { url: '/pwa/icon-512.png', sizes: '512x512' }], apple: '/pwa/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#F5EFE6',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${lora.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
