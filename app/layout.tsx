import type { Metadata } from 'next';
import { Noto_Sans_SC } from 'next/font/google';
import './globals.css';

const notoSans = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-noto-sans-sc',
});

export const metadata: Metadata = {
  title: 'LSO100 在训训练时长看板 · 瑞幸咖啡 北美',
  description: 'LSO100 在训小伙伴的实际打卡训练时长追踪（目标 112 小时）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={notoSans.variable}>
      <body>{children}</body>
    </html>
  );
}
