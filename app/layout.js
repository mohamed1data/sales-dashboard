import './globals.css';

export const metadata = {
  title: 'لوحة المبيعات',
  description: 'متابعة المناديب والزيارات والتحصيل',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'المبيعات', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1216' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
