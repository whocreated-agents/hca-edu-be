import type { ReactNode } from 'react';

export const metadata = {
  title: 'HCA Portal',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
