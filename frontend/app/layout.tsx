import './globals.css';
import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import GoogleAnalytics from '@/components/GoogleAnalytics';

const SITE_URL = 'https://agena.dev';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: 'AGENA – Agentic AI Platform | Pixel Agent & Autonomous Code Generation',
    template: '%s | AGENA',
  },
  description:
    'AGENA is an agentic AI platform that autonomously generates code, creates pull requests, and manages your software development workflow. Pixel agent powered, multi-tenant SaaS for teams.',
  keywords: [
    'agena',
    'agentic ai',
    'pixel agent',
    'ai agent',
    'autonomous coding',
    'ai code generation',
    'ai pull request',
    'ai developer tool',
    'agentic ai platform',
    'pixel agent ai',
    'ai software development',
    'multi-tenant ai saas',
    'crewai',
    'langgraph',
    'ai orchestration',
    'yapay zeka agent',
    'otonom kodlama',
    'yapay zeka yazılım geliştirme',
  ],
  authors: [{ name: 'AGENA', url: SITE_URL }],
  creator: 'AGENA',
  publisher: 'AGENA',
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: '/',
    languages: {
      'tr-TR': '/?lang=tr',
      'en-US': '/?lang=en',
      'de-DE': '/?lang=de',
      'es-ES': '/?lang=es',
      'ja-JP': '/?lang=ja',
      'zh-CN': '/?lang=zh',
      'it-IT': '/?lang=it',
    },
  },
  openGraph: {
    type: 'website',
    locale: 'tr_TR',
    alternateLocale: ['en_US', 'de_DE', 'es_ES', 'ja_JP', 'zh_CN', 'it_IT'],
    url: SITE_URL,
    siteName: 'AGENA',
    title: 'AGENA – Agentic AI Platform | Pixel Agent & Autonomous Code Generation',
    description:
      'Autonomous AI agents that write code, review PRs, and ship features. AGENA is the agentic AI platform for modern development teams.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AGENA – Agentic AI Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AGENA – Agentic AI Platform | Pixel Agent',
    description:
      'Autonomous AI agents that write code, review PRs, and ship features. The agentic AI platform for modern teams.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  category: 'technology',
};

/* ── JSON-LD Structured Data ── */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'AGENA',
      description: 'Agentic AI Platform for Autonomous Code Generation',
      inLanguage: ['tr-TR', 'en-US'],
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'AGENA',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/media/agena-logo.svg`,
      },
      sameAs: ['https://github.com/aozyildirim/Agena'],
    },
    {
      '@type': 'SoftwareApplication',
      name: 'AGENA',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      description:
        'Agentic AI platform that autonomously generates code, creates pull requests, and manages software development workflows with pixel agent technology.',
      url: SITE_URL,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free tier available',
      },
      featureList: [
        'Autonomous code generation',
        'AI-powered pull request creation',
        'Multi-tenant SaaS',
        'GitHub & Azure DevOps integration',
        'Agentic AI pipeline',
        'Pixel agent orchestration',
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is AGENA?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AGENA is an agentic AI platform that autonomously generates code, reviews quality, and creates pull requests. It runs a PM → Developer → Reviewer → Finalizer pipeline powered by pixel agent technology, turning your backlog into production-ready PRs in minutes.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is agentic AI?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Agentic AI refers to AI systems that can autonomously plan, execute, and adapt to achieve complex goals. Unlike simple AI assistants, agentic AI agents work independently through multi-step workflows — analyzing tasks, generating code, reviewing quality, and shipping features without constant human guidance.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is pixel agent technology?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Pixel agent technology is AGENA's visual orchestration layer that represents each AI agent as an interactive pixel character. It provides real-time visibility into your autonomous AI workforce — showing which agents are active, what they're working on, and the progress of each task through the pipeline.",
          },
        },
        {
          '@type': 'Question',
          name: 'Which platforms does AGENA integrate with?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AGENA integrates with GitHub and Azure DevOps for PR automation, Jira for task import, Slack and Microsoft Teams for ChatOps notifications, and supports OpenAI and Google Gemini as LLM providers.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is AGENA free to use?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes! AGENA offers a free tier with 5 tasks per month, token usage tracking, and community support. The Pro plan ($49/month) includes unlimited tasks, priority worker throughput, team invites, and billing via Stripe or Iyzico.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is AGENA open source?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes, AGENA is fully open source under the MIT license. You can self-host it or use the managed platform. The source code is available on GitHub at github.com/aozyildirim/Agena.',
          },
        },
      ],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <head>
        <link
          rel='preconnect'
          href='https://fonts.googleapis.com'
        />
        <link
          rel='preconnect'
          href='https://fonts.gstatic.com'
          crossOrigin='anonymous'
        />
        <link
          rel='dns-prefetch'
          href='https://fonts.googleapis.com'
        />
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <GoogleAnalytics />
        <Navbar />
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
