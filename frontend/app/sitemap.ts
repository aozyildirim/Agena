import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://agena.dev';

  const blogPosts: { slug: string; date: string }[] = [
    { slug: 'what-is-agentic-ai', date: '2026-03-28' },
    { slug: 'pixel-agent-technology', date: '2026-03-26' },
    { slug: 'ai-code-generation-best-practices', date: '2026-03-24' },
    { slug: 'crewai-langgraph-orchestration', date: '2026-03-22' },
    { slug: 'multi-tenant-ai-saas-architecture', date: '2026-03-20' },
    { slug: 'yapay-zeka-ile-kod-yazma', date: '2026-03-18' },
    { slug: 'ai-agent-nedir', date: '2026-03-16' },
    { slug: 'github-copilot-alternative', date: '2026-03-14' },
    { slug: 'agentic-ai-nedir', date: '2026-03-12' },
    { slug: 'otonom-kodlama-rehberi', date: '2026-03-10' },
    { slug: 'ai-ile-pr-otomasyonu', date: '2026-03-08' },
  ];

  return [
    {
      url: baseUrl,
      lastModified: new Date('2026-04-01'),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/status`,
      lastModified: new Date('2026-04-04'),
      changeFrequency: 'daily',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(blogPosts[0].date),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/use-cases`,
      lastModified: new Date('2026-03-20'),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/docs`,
      lastModified: new Date('2026-03-25'),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: new Date('2026-03-01'),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: new Date('2026-04-04'),
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/roadmap`,
      lastModified: new Date('2026-04-04'),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/api-docs`,
      lastModified: new Date('2026-04-04'),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    ...blogPosts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
