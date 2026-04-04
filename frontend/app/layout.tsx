import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import MicrosoftClarity from '@/components/MicrosoftClarity';
import WebVitals from '@/components/WebVitals';
import CookieConsent from '@/components/CookieConsent';
import BackToTop from '@/components/BackToTop';
import PageTransition from '@/components/PageTransition';

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
      inLanguage: ['tr-TR', 'en-US', 'es-ES', 'de-DE', 'zh-CN', 'it-IT', 'ja-JP'],
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/blog?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
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
      sameAs: [
        'https://github.com/aozyildirim/Agena',
        'https://www.producthunt.com/products/agena',
      ],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        url: `${SITE_URL}/contact`,
        availableLanguage: ['Turkish', 'English', 'Spanish', 'German', 'Chinese', 'Italian', 'Japanese'],
      },
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Documentation',
      url: `${SITE_URL}/docs`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Blog',
      url: `${SITE_URL}/blog`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Use Cases',
      url: `${SITE_URL}/use-cases`,
    },
{
      '@type': 'SiteNavigationElement',
      name: 'Changelog',
      url: `${SITE_URL}/changelog`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Contact',
      url: `${SITE_URL}/contact`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Roadmap',
      url: `${SITE_URL}/roadmap`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'API Documentation',
      url: `${SITE_URL}/api-docs`,
    },
    {
      '@type': 'SiteNavigationElement',
      name: 'Status',
      url: `${SITE_URL}/status`,
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
        'Visual flow builder',
        'DORA metrics dashboard',
        'ChatOps (Slack, Teams, Telegram)',
        'Vector memory with Qdrant',
        '7-language interface',
      ],
      screenshot: `${SITE_URL}/og-image.png`,
      softwareVersion: '0.9.0',
      releaseNotes: `${SITE_URL}/changelog`,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.8',
        ratingCount: '24',
        bestRating: '5',
      },
    },
    {
      '@type': 'HowTo',
      name: 'How to use AGENA for autonomous code generation',
      description: 'Get started with AGENA in 4 simple steps to automate your development workflow.',
      step: [
        { '@type': 'HowToStep', position: 1, name: 'Sign Up', text: 'Create a free AGENA account at agena.dev/signup', url: `${SITE_URL}/signup` },
        { '@type': 'HowToStep', position: 2, name: 'Connect Repository', text: 'Link your GitHub or Azure DevOps repository via the integrations dashboard', url: `${SITE_URL}/docs#integrations` },
        { '@type': 'HowToStep', position: 3, name: 'Create a Task', text: 'Import tasks from Jira or create one manually with a description of what you need built', url: `${SITE_URL}/docs#tasks` },
        { '@type': 'HowToStep', position: 4, name: 'AI Generates PR', text: 'AGENA AI agents analyze, generate code, review quality, and open a pull request automatically', url: `${SITE_URL}/docs#pipeline` },
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
        {
          '@type': 'Question',
          name: 'How does AGENA compare to GitHub Copilot?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'While GitHub Copilot suggests code line by line within your IDE, AGENA is a full agentic AI platform that takes a complete task and autonomously generates production code, reviews it, and creates a pull request. AGENA handles the entire workflow from backlog to PR.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can AGENA work with my existing CI/CD pipeline?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. AGENA creates standard pull requests on GitHub or Azure DevOps. Your existing CI/CD pipeline, code review process, and branch protection rules all work as normal with AI-generated PRs.',
          },
        },
        {
          '@type': 'Question',
          name: 'What programming languages does AGENA support?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AGENA supports all programming languages that the underlying LLM models support, including Python, JavaScript, TypeScript, Java, Go, Rust, C#, PHP, Ruby, and more. The AI agents analyze your existing codebase to match patterns and conventions.',
          },
        },
        {
          '@type': 'Question',
          name: 'How secure is AGENA with my source code?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AGENA never stores your source code. Repository access is scoped via OAuth tokens, code is processed in isolated sessions, and you can self-host for complete control. All data is organization-scoped with full tenant isolation.',
          },
        },
      ],
    },
  ],
};

const LANG_MAP: Record<string, string> = {
  tr: 'tr', en: 'en', de: 'de', es: 'es', ja: 'ja', zh: 'zh', it: 'it',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = headers();
  const acceptLang = headerList.get('accept-language') || '';
  const preferred = acceptLang.split(',')[0]?.split('-')[0]?.toLowerCase() || 'en';
  const lang = LANG_MAP[preferred] || 'en';

  return (
    <html lang={lang}>
      <head>
        <link rel='alternate' type='application/rss+xml' title='AGENA Blog' href='/feed.xml' />
        <link rel='alternate' hrefLang='x-default' href={SITE_URL} />
        <link rel='alternate' hrefLang='tr' href={`${SITE_URL}/?lang=tr`} />
        <link rel='alternate' hrefLang='en' href={`${SITE_URL}/?lang=en`} />
        <link rel='alternate' hrefLang='es' href={`${SITE_URL}/?lang=es`} />
        <link rel='alternate' hrefLang='de' href={`${SITE_URL}/?lang=de`} />
        <link rel='alternate' hrefLang='zh' href={`${SITE_URL}/?lang=zh`} />
        <link rel='alternate' hrefLang='it' href={`${SITE_URL}/?lang=it`} />
        <link rel='alternate' hrefLang='ja' href={`${SITE_URL}/?lang=ja`} />
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
        <MicrosoftClarity />
        <WebVitals />
        <Navbar />
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
        <CookieConsent />
        <BackToTop />
      </body>
    </html>
  );
}
