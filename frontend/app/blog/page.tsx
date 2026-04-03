import type { Metadata } from 'next';
import Link from 'next/link';
import NewsletterForm from '@/components/NewsletterForm';

export const metadata: Metadata = {
  title: 'Blog – AGENA Agentic AI Platform',
  description:
    'Agentic AI, pixel agent technology, autonomous code generation, and AI-powered software development insights from the AGENA team.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Blog – AGENA Agentic AI Platform',
    description: 'Insights on agentic AI, pixel agents, and autonomous software development.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'AGENA Blog' }],
  },
};

const posts = [
  {
    slug: 'what-is-agentic-ai',
    title: 'What is Agentic AI? The Future of Autonomous Software Development',
    description:
      'Agentic AI represents a paradigm shift in software development. Learn how autonomous AI agents can write code, review pull requests, and ship features without human intervention.',
    date: '2026-03-28',
    readTime: '8 min read',
    tags: ['Agentic AI', 'AI Agent', 'Autonomous Coding'],
  },
  {
    slug: 'pixel-agent-technology',
    title: 'Pixel Agent Technology: How AGENA Orchestrates AI Workflows Visually',
    description:
      'Discover how pixel agent technology powers AGENA\'s visual orchestration layer, enabling teams to monitor and manage autonomous AI agents in real-time.',
    date: '2026-03-25',
    readTime: '6 min read',
    tags: ['Pixel Agent', 'AI Orchestration', 'Visual Monitoring'],
  },
  {
    slug: 'ai-code-generation-best-practices',
    title: 'AI Code Generation Best Practices: From Backlog to Pull Request in Minutes',
    description:
      'How to leverage agentic AI for production-grade code generation. Best practices for autonomous PR creation, code review, and quality assurance with AI agents.',
    date: '2026-03-20',
    readTime: '10 min read',
    tags: ['Code Generation', 'Pull Request Automation', 'Best Practices'],
  },
  {
    slug: 'crewai-langgraph-orchestration',
    title: 'Building Multi-Agent Pipelines with CrewAI and LangGraph',
    description:
      'A deep dive into how AGENA combines CrewAI role orchestration with LangGraph state machines to create reliable, observable AI agent pipelines for software delivery.',
    date: '2026-03-15',
    readTime: '12 min read',
    tags: ['CrewAI', 'LangGraph', 'Multi-Agent', 'Pipeline'],
  },
  {
    slug: 'multi-tenant-ai-saas-architecture',
    title: 'Designing a Multi-Tenant AI SaaS: Lessons from Building AGENA',
    description:
      'Architecture decisions behind building a production-ready multi-tenant AI agent platform. Organization isolation, usage limits, billing, and security patterns.',
    date: '2026-03-10',
    readTime: '9 min read',
    tags: ['Architecture', 'Multi-Tenant', 'SaaS', 'Security'],
  },
  {
    slug: 'yapay-zeka-ile-kod-yazma',
    title: 'Yapay Zeka ile Kod Yazma: AGENA ile Otonom Geliştirme Rehberi',
    description:
      'Yapay zeka ile kod yazma artık hayal değil. AGENA\'nın agentic AI platformu ile otonom kod üretimi, PR oluşturma ve kalite kontrolünü öğrenin.',
    date: '2026-03-30',
    readTime: '9 dk okuma',
    tags: ['Yapay Zeka', 'Kod Yazma', 'Otonom Geliştirme'],
  },
  {
    slug: 'ai-agent-nedir',
    title: 'AI Agent Nedir? Yapay Zeka Agentlarının Yazılım Geliştirmedeki Rolü',
    description:
      'AI agent nedir, nasıl çalışır ve yazılım geliştirmede nasıl kullanılır? Agentic AI kavramını ve AGENA platformunun agent mimarisini keşfedin.',
    date: '2026-03-29',
    readTime: '7 dk okuma',
    tags: ['AI Agent', 'Yapay Zeka', 'Agentic AI'],
  },
  {
    slug: 'ai-ile-pr-otomasyonu',
    title: 'AI ile Pull Request Otomasyonu: Backlog\'dan PR\'a Dakikalar İçinde',
    description:
      'AI ile otomatik pull request oluşturma nasıl çalışır? AGENA\'nın agentic AI pipeline\'ı ile görev tanımından production-ready PR\'a kadar tüm süreci öğrenin.',
    date: '2026-04-03',
    readTime: '7 dk okuma',
    tags: ['PR Otomasyonu', 'AI', 'DevOps', 'Otomasyon'],
  },
  {
    slug: 'otonom-kodlama-rehberi',
    title: 'Otonom Kodlama: AI Agentlar ile Yazılım Geliştirmenin Yeni Çağı',
    description:
      'Otonom kodlama nedir ve nasıl çalışır? AI agentların bağımsız olarak kod yazması, review etmesi ve PR açması hakkında kapsamlı rehber.',
    date: '2026-04-02',
    readTime: '10 dk okuma',
    tags: ['Otonom Kodlama', 'AI Agent', 'Yazılım Geliştirme'],
  },
  {
    slug: 'agentic-ai-nedir',
    title: 'Agentic AI Nedir? Otonom Yapay Zeka Sistemlerinin Geleceği',
    description:
      'Agentic AI nedir, geleneksel yapay zekadan farkı ne? Otonom AI agentların yazılım geliştirme, kod üretimi ve PR otomasyonundaki devrimci rolünü keşfedin.',
    date: '2026-04-01',
    readTime: '8 dk okuma',
    tags: ['Agentic AI', 'Yapay Zeka', 'Otonom Sistemler'],
  },
  {
    slug: 'github-copilot-alternative',
    title: 'AGENA vs GitHub Copilot: The Agentic AI Alternative for Full Autonomy',
    description:
      'Compare AGENA with GitHub Copilot. While Copilot suggests code line by line, AGENA\'s agentic AI agents autonomously generate complete PRs from task descriptions.',
    date: '2026-03-27',
    readTime: '8 min read',
    tags: ['GitHub Copilot', 'Alternative', 'Comparison', 'Agentic AI'],
  },
];

export default function BlogPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'AGENA Blog',
    description: 'Insights on agentic AI, pixel agents, and autonomous software development.',
    url: 'https://agena.dev/blog',
    publisher: {
      '@type': 'Organization',
      name: 'AGENA',
      url: 'https://agena.dev',
    },
    blogPost: posts.map((post) => ({
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      url: `https://agena.dev/blog/${post.slug}`,
      author: { '@type': 'Organization', name: 'AGENA' },
    })),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://agena.dev/blog' },
    ],
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <div className='container blog-container' style={{ maxWidth: 860, padding: '80px 24px' }}>
        <div style={{ marginBottom: 48 }}>
          <div className='section-label'>Blog</div>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
            Agentic AI &amp; Pixel Agent Insights
          </h1>
          <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 600 }}>
            Autonomous software development, AI code generation, and the future of agentic AI — from the AGENA team.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              style={{ textDecoration: 'none' }}
            >
              <article className='blog-card'>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <time style={{ color: 'var(--ink-35)', fontSize: 13 }}>{post.date}</time>
                  <span style={{ color: 'var(--ink-25)' }}>·</span>
                  <span style={{ color: 'var(--ink-35)', fontSize: 13 }}>{post.readTime}</span>
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10, lineHeight: 1.4 }}>
                  {post.title}
                </h2>
                <p style={{ color: 'var(--ink-50)', fontSize: 14, lineHeight: 1.7, marginBottom: 14 }}>
                  {post.description}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'rgba(13,148,136,0.1)',
                        color: 'var(--accent)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            </Link>
          ))}
        </div>

        {/* Newsletter signup */}
        <div
          style={{
            marginTop: 64,
            padding: '40px 32px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(13,148,136,0.08) 0%, rgba(139,92,246,0.06) 100%)',
            border: '1px solid rgba(13,148,136,0.15)',
            textAlign: 'center',
          }}
        >
          <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>
            Stay updated on Agentic AI
          </h3>
          <p style={{ color: 'var(--ink-45)', fontSize: 14, marginBottom: 24, maxWidth: 440, margin: '0 auto 24px' }}>
            Get the latest insights on autonomous code generation, AI agents, and pixel agent technology. No spam.
          </p>
          <NewsletterForm />
        </div>
      </div>
    </>
  );
}
