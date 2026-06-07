import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'notarity — book in minutes',
  description: 'Document-first notary booking. Drop your document, confirm, done.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
