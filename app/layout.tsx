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
};

export const viewport: Viewport = {
  themeColor: '#F5EFE6',
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
