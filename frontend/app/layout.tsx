import './globals.css';
import type { Metadata } from 'next';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'AGENA AI Agent SaaS',
  description: 'Multi-tenant AI agent orchestration with PR automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>
        <Navbar />
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
