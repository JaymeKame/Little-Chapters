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
  // Correction sprint Section 24: permanent Little Chapters identity —
  // storybook portal, never a child profile image. See public/pwa/icon.svg
  // (source; renders to icon-192.png / icon-512.png via
  // scripts/generate-icons.mjs).
  icons: {
    icon: [
      { url: '/pwa/icon.svg', type: 'image/svg+xml' },
      { url: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/pwa/icon-192.png',
    shortcut: '/favicon.png',
  },
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
