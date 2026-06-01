import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LSO Training Progress · Luckin Coffee North America',
  description:
    'In-training rosters and cumulative clocked-in training time across LSO100–LSO400 (tenant LKUS).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* IBM Plex via runtime link — keeps the offline/seed build network-free
            (no next/font build-time fetch); the browser loads the font at runtime. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
