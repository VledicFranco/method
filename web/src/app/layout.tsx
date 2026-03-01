import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'method',
  description: 'Methodology visualizer and session tracker',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <nav className="app-nav">
          <Link href="/" className="brand">method</Link>
          <div className="nav-links">
            <Link href="/methodologies">Methodologies</Link>
            <Link href="/sessions">Sessions</Link>
            <Link href="/projects">Projects</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
