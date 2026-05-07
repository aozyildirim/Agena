import { MetadataRoute } from 'next';

const SITE = 'https://agena.dev';
const LANGS = ['tr', 'en', 'es', 'de', 'zh', 'it', 'ja'] as const;

function withAlternates(url: string) {
  const languages: Record<string, string> = {};
  for (const lang of LANGS) {
    languages[lang] = `${url}?lang=${lang}`;
  }
  return { languages };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: '', modified: '2026-04-04', freq: 'weekly' as const, priority: 1.0 },
    { path: '/blog', modified: '2026-04-04', freq: 'weekly' as const, priority: 0.9 },
    { path: '/use-cases', modified: '2026-04-04', freq: 'monthly' as const, priority: 0.8 },
    { path: '/docs', modified: '2026-04-04', freq: 'monthly' as const, priority: 0.8 },
    { path: '/contact', modified: '2026-04-04', freq: 'monthly' as const, priority: 0.7 },
    { path: '/changelog', modified: '2026-04-04', freq: 'weekly' as const, priority: 0.6 },
    { path: '/roadmap', modified: '2026-04-04', freq: 'weekly' as const, priority: 0.7 },
    { path: '/api-docs', modified: '2026-04-04', freq: 'monthly' as const, priority: 0.6 },
    { path: '/status', modified: '2026-04-04', freq: 'daily' as const, priority: 0.5 },
    { path: '/glossary', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.7 },
    { path: '/integrations', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/vs', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/vs/cursor', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/vs/copilot', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/vs/devin', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/vs/codex', modified: '2026-04-05', freq: 'monthly' as const, priority: 0.8 },
    { path: '/sentry-ai-auto-fix', modified: '2026-04-30', freq: 'monthly' as const, priority: 0.95 },
    { path: '/jira-ai-agent', modified: '2026-04-30', freq: 'monthly' as const, priority: 0.95 },
    { path: '/azure-devops-ai-bot', modified: '2026-04-30', freq: 'monthly' as const, priority: 0.95 },
    { path: '/ai-code-review', modified: '2026-04-30', freq: 'monthly' as const, priority: 0.95 },
    { path: '/newrelic-ai-agent', modified: '2026-05-01', freq: 'monthly' as const, priority: 0.9 },
    { path: '/ai-sprint-refinement', modified: '2026-05-01', freq: 'monthly' as const, priority: 0.9 },
    { path: '/vs/seer', modified: '2026-05-01', freq: 'monthly' as const, priority: 0.85 },
    { path: '/vs/coderabbit', modified: '2026-05-01', freq: 'monthly' as const, priority: 0.85 },
    { path: '/cross-source-insights', modified: '2026-05-02', freq: 'monthly' as const, priority: 0.9 },
    { path: '/stale-ticket-triage', modified: '2026-05-02', freq: 'monthly' as const, priority: 0.9 },
    { path: '/review-backlog-killer', modified: '2026-05-02', freq: 'monthly' as const, priority: 0.9 },
    { path: '/workspaces', modified: '2026-05-06', freq: 'monthly' as const, priority: 0.95 },
  ];

  // All blog slugs
  const blogSlugs = [
    'what-is-agentic-ai', 'pixel-agent-technology', 'ai-code-generation-best-practices',
    'crewai-langgraph-orchestration', 'multi-tenant-ai-saas-architecture', 'github-copilot-alternative',
    'yapay-zeka-ile-kod-yazma', 'ai-agent-nedir', 'ai-ile-pr-otomasyonu',
    'otonom-kodlama-rehberi', 'agentic-ai-nedir',
    'ia-agentes-autonomos', 'automatizacion-pull-requests-ia',
    'ki-agenten-softwareentwicklung', 'automatische-pull-requests-ki',
    'zhineng-daili-ai-ruanjian-kaifa', 'ai-zidong-pull-request',
    'ai-agent-jisedai-kaihatsu', 'jidou-pull-request-ai',
    'agenti-ia-sviluppo-software', 'automazione-pull-request-ia',
    'agentic-ai-nedir-rehber', 'que-es-ia-agente', 'was-ist-agentische-ki',
    'shenme-shi-zhineng-daili-ai', 'cosa-e-ia-agentica', 'ejentikku-ai-toha',
    'pixel-agent-teknolojisi', 'tecnologia-pixel-agent', 'pixel-agent-technologie',
    'xiangsu-daili-jishu', 'tecnologia-pixel-agent-it', 'pikueru-ejento-gijutsu',
    'ai-kod-uretimi-en-iyi-pratikler', 'mejores-practicas-generacion-codigo-ia',
    'ki-codegenerierung-best-practices', 'ai-daima-shengcheng-zuijia-shijian',
    'generazione-codice-ia-best-practice', 'ai-koodo-seisei-besuto-purakutisu',
    'crewai-langgraph-orkestrasyon', 'crewai-langgraph-orquestacion',
    'crewai-langgraph-orchestrierung', 'crewai-langgraph-bianpai',
    'crewai-langgraph-orchestrazione', 'crewai-langgraph-okesutoreeshon',
    'coklu-kiracili-ai-saas-mimarisi', 'arquitectura-saas-ia-multiinquilino',
    'multi-tenant-ki-saas-architektur', 'duozuhu-ai-saas-jiagou',
    'architettura-saas-ia-multi-tenant', 'maruchi-tenanto-ai-saas-aakitekucha',
    'github-copilot-alternatifi', 'alternativa-github-copilot',
    'github-copilot-alternative-de', 'github-copilot-tidai',
    'alternativa-github-copilot-it', 'github-copilot-daitai',
    'sentry-error-to-merged-pr-12-minutes',
    'jira-reporter-rules-tutorial',
    'owasp-ai-code-review',
    'custom-reviewer-agent-setup',
    'azure-devops-ai-bot-tutorial',
    'best-ai-code-review-tools-2026',
    'sentry-seer-vs-agena',
    'how-to-estimate-jira-story-points-with-ai',
  ];

  return [
    ...pages.map((p) => ({
      url: `${SITE}${p.path}`,
      lastModified: new Date(p.modified),
      changeFrequency: p.freq,
      priority: p.priority,
      alternates: withAlternates(`${SITE}${p.path}`),
    })),
    ...blogSlugs.map((slug) => ({
      url: `${SITE}/blog/${slug}`,
      lastModified: new Date('2026-04-04'),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
