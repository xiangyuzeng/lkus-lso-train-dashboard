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
      <body>{children}</body>
    </html>
  );
}
