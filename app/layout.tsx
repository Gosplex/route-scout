import '@fontsource/anton/400.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import './globals.css';
import Clarity from '@/components/Clarity';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Route Scout: find where your people are',
  description: 'Tell Route Scout who you sound like. It finds the US cities where your future fans live, checks which ones are not already crowded with shows like yours, and plans the tour.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  openGraph: { title: 'Route Scout', description: 'Find where your future fans live and plan the tour.', images: ['/logo-lockup.webp'] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#03040b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Clarity />
      </body>
    </html>
  );
}
