import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const posts: Record<string, { title: string; description: string; date: string; readTime: string; content: string }> = {
  'what-is-agentic-ai': {
    title: 'What is Agentic AI? The Future of Autonomous Software Development',
    description:
      'Agentic AI represents a paradigm shift in software development. Learn how autonomous AI agents can write code, review pull requests, and ship features without human intervention.',
    date: '2026-03-28',
    readTime: '8 min read',
    content: `
## What is Agentic AI?

Agentic AI refers to artificial intelligence systems that can **autonomously plan, execute, and adapt** to achieve complex goals with minimal human supervision. Unlike traditional AI assistants that respond to individual prompts, agentic AI systems operate as independent agents capable of multi-step reasoning, tool usage, and self-correction.

In software development, agentic AI transforms how teams build and ship code. Instead of asking an AI to "write a function," an agentic AI platform like **AGENA** takes a task from your backlog and autonomously:

1. **Analyzes the requirements** — understanding context from your codebase, past tasks, and documentation
2. **Generates production code** — writing clean, tested, and reviewable code
3. **Reviews quality** — running its own code review with a dedicated reviewer agent
4. **Creates pull requests** — pushing branches and opening PRs on GitHub or Azure DevOps

## Why Agentic AI Matters for Development Teams

Traditional development workflows are bottlenecked by human bandwidth. A typical feature goes through planning, development, code review, and deployment — each step requiring human attention and context switching.

**Agentic AI eliminates these bottlenecks** by running an autonomous pipeline:

- **PM Agent** — Breaks down tasks and prioritizes requirements
- **Developer Agent** — Writes production-grade code using your codebase context
- **Reviewer Agent** — Reviews code quality, security, and best practices
- **Finalizer Agent** — Creates branches, commits, and pull requests

This is the core of what AGENA provides — a complete **agentic AI pipeline** that turns your backlog into pull requests in minutes, not sprints.

## Agentic AI vs Traditional AI Coding Assistants

| Feature | Traditional AI Assistant | Agentic AI (AGENA) |
|---------|------------------------|--------------------|
| Scope | Single prompt → single response | Full task → complete PR |
| Autonomy | Requires constant human guidance | Self-directed multi-step execution |
| Context | Limited to current conversation | Understands full codebase + history |
| Output | Code snippets | Production branches + pull requests |
| Quality | No self-review | Built-in review agent |

## How AGENA Implements Agentic AI

AGENA uses a combination of **CrewAI** for role-based agent orchestration and **LangGraph** for state machine workflow management. This dual approach provides:

- **Role specialization** — Each agent has a specific expertise area
- **Observable state transitions** — Every step is tracked and visible
- **Vector memory** — Previous task context improves future generations
- **Multi-tenant isolation** — Secure, organization-scoped execution

The result is a platform where you assign a task, and an autonomous team of AI agents delivers a ready-to-review pull request.

## Getting Started with Agentic AI

AGENA is open-source and free to start. Connect your GitHub repository, import tasks from Jira or Azure DevOps, and let the agentic AI pipeline handle the rest.

[Start Free →](/signup)

## Related Articles

- [Pixel Agent Technology: How AGENA Orchestrates AI Workflows Visually](/blog/pixel-agent-technology)
- [AI Code Generation Best Practices: From Backlog to Pull Request in Minutes](/blog/ai-code-generation-best-practices)
- [AGENA vs GitHub Copilot: The Agentic AI Alternative](/blog/github-copilot-alternative)
- [Use Cases — What Can You Build with Agentic AI?](/use-cases)
- [Documentation — Get Started with AGENA](/docs)
    `,
  },
  'pixel-agent-technology': {
    title: 'Pixel Agent Technology: How AGENA Orchestrates AI Workflows Visually',
    description:
      'Discover how pixel agent technology powers AGENA\'s visual orchestration layer, enabling teams to monitor and manage autonomous AI agents in real-time.',
    date: '2026-03-25',
    readTime: '6 min read',
    content: `
## What is Pixel Agent Technology?

Pixel agent technology is AGENA's visual orchestration layer that brings autonomous AI agents to life. Instead of abstract logs and status codes, pixel agents provide a **real-time visual representation** of your AI workforce — each agent rendered as an interactive pixel character with distinct roles and states.

## Why Visual Orchestration Matters

When you run multiple AI agents working on code generation, review, and deployment, visibility becomes critical. Teams need to know:

- **Which agents are active** and what they're working on
- **Where bottlenecks occur** in the pipeline
- **Real-time progress** of each task through the autonomous workflow
- **Historical patterns** in agent performance and task completion

Pixel agent technology solves this by providing an **office-like visual environment** where each AI agent is represented as a pixel character. You can see your PM agent analyzing requirements, your developer agent writing code, and your reviewer agent checking quality — all in real-time.

## How Pixel Agents Work in AGENA

### The Pixel Office

AGENA's dashboard features a pixel office view where agents are displayed as animated characters. Each character's state reflects the agent's current activity:

- **Seated at desk** — Agent is actively processing a task
- **Walking** — Agent is transitioning between pipeline stages
- **Idle** — Agent is available for new tasks

### Agent Roles as Visual Identities

Each pixel agent has a distinct visual identity matching their role:

- **PM Agent** — Analyzes tasks and breaks down requirements
- **Developer Agent** — Generates production code
- **Reviewer Agent** — Reviews code quality and security
- **Finalizer Agent** — Creates PRs and manages Git operations

### Real-Time State Synchronization

The pixel agent layer is synchronized with AGENA's LangGraph state machine. As the AI pipeline progresses through stages (fetch_context → analyze → generate_code → review_code → finalize), the pixel agents visually reflect each transition.

## Pixel Agent + Agentic AI = Observable Autonomy

The combination of agentic AI with pixel agent technology creates what we call **observable autonomy** — your AI agents work independently, but you always have full visibility into their progress and decision-making.

This is especially valuable for:

- **Engineering managers** monitoring AI-assisted sprint velocity
- **Team leads** tracking which tasks are being autonomously handled
- **Developers** reviewing AI-generated PRs with full context of the agent's process

[Try AGENA Free →](/signup)

## Related Articles

- [What is Agentic AI? The Future of Autonomous Software Development](/blog/what-is-agentic-ai)
- [AI Agent Nedir? Yapay Zeka Agentlarının Rolü](/blog/ai-agent-nedir)
- [Building Multi-Agent Pipelines with CrewAI and LangGraph](/blog/crewai-langgraph-orchestration)
- [Use Cases — Autonomous Code Generation](/use-cases#ai-code-generation)
    `,
  },
  'ai-code-generation-best-practices': {
    title: 'AI Code Generation Best Practices: From Backlog to Pull Request in Minutes',
    description:
      'How to leverage agentic AI for production-grade code generation. Best practices for autonomous PR creation, code review, and quality assurance with AI agents.',
    date: '2026-03-20',
    readTime: '10 min read',
    content: `
## The State of AI Code Generation

AI code generation has evolved from simple autocomplete to **full autonomous development workflows**. Modern agentic AI platforms like AGENA can take a task description and produce complete, reviewable pull requests — including branch creation, code generation, quality review, and PR documentation.

## Best Practices for AI-Powered Code Generation

### 1. Provide Rich Task Context

The quality of AI-generated code directly correlates with the context provided. Best practices:

- **Write clear task descriptions** with acceptance criteria
- **Link related tasks** so the AI understands the broader feature
- **Include technical constraints** (database schema, API contracts, etc.)
- **Reference existing patterns** in your codebase

AGENA's vector memory system automatically enriches context by retrieving similar past tasks and their solutions.

### 2. Use Multi-Agent Review Pipelines

Single-agent code generation is prone to errors. AGENA's multi-agent approach ensures quality:

- **Developer Agent** generates the initial code
- **Reviewer Agent** independently reviews for bugs, security issues, and best practices
- **Finalizer Agent** creates clean commits with descriptive messages

This mirrors human development workflows but executes in minutes instead of days.

### 3. Maintain Codebase Observability

When AI agents are generating code autonomously, you need full observability:

- **Task telemetry** — Token usage, model selection, execution time per stage
- **Diff visibility** — Clear diffs showing exactly what was changed and why
- **Pipeline state tracking** — Know exactly where each task is in the workflow
- **Cost monitoring** — Track AI spend per task, sprint, and organization

### 4. Start with Well-Scoped Tasks

AI agents perform best with well-scoped, atomic tasks:

- Bug fixes with clear reproduction steps
- Feature implementations with defined APIs
- Refactoring tasks with specific patterns to change
- Documentation updates with clear scope

Avoid vague tasks like "improve performance" — instead, break them into specific, actionable items.

### 5. Integrate with Your Existing Workflow

AGENA integrates with your existing tools:

- **GitHub & Azure DevOps** — PR creation and branch management
- **Jira** — Task import and status synchronization
- **Slack & Teams** — Real-time notifications and ChatOps

This means AI-generated PRs go through your normal review process — your team maintains full control over what gets merged.

## The ROI of Autonomous Code Generation

Teams using AGENA's agentic AI pipeline report:

- **10x faster** first-draft delivery for routine tasks
- **Consistent code quality** across all AI-generated PRs
- **Reduced context switching** — AI handles the implementation, humans review
- **Better sprint velocity** — more tasks completed per sprint

[Get Started Free →](/signup)

## Related Articles

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Yapay Zeka ile Kod Yazma Rehberi](/blog/yapay-zeka-ile-kod-yazma)
- [AGENA vs GitHub Copilot](/blog/github-copilot-alternative)
- [Documentation — API Reference](/docs#api)
    `,
  },
  'crewai-langgraph-orchestration': {
    title: 'Building Multi-Agent Pipelines with CrewAI and LangGraph',
    description:
      'A deep dive into how AGENA combines CrewAI role orchestration with LangGraph state machines to create reliable, observable AI agent pipelines for software delivery.',
    date: '2026-03-15',
    readTime: '12 min read',
    content: `
## Why Multi-Agent Orchestration?

Single-agent AI systems hit a ceiling when tasks require multiple specialized skills. Code generation, for example, benefits from **separate agents** handling planning, implementation, review, and deployment — just like human development teams.

AGENA solves this with a dual orchestration approach:

- **CrewAI** — Defines agent roles, goals, and expertise areas
- **LangGraph** — Manages the state machine workflow between agents

## CrewAI: Role-Based Agent Teams

CrewAI enables AGENA to define specialized AI agents with distinct roles:

### PM Agent
- **Role**: Task analysis and requirement breakdown
- **Goal**: Understand the task, gather context, and create a clear implementation plan
- **Model**: Optimized for reasoning and analysis

### Developer Agent
- **Role**: Code generation
- **Goal**: Write production-grade code following codebase conventions
- **Model**: Optimized for code generation with large context windows

### Reviewer Agent
- **Role**: Code quality assurance
- **Goal**: Review generated code for bugs, security, and best practices
- **Model**: Optimized for critical analysis

### Finalizer Agent
- **Role**: Git operations and PR creation
- **Goal**: Create clean branches, commits, and pull requests
- **Model**: Optimized for structured output

## LangGraph: Observable State Machines

While CrewAI defines **who** does what, LangGraph defines **how** the work flows:

\`\`\`
fetch_context → analyze → generate_code → review_code → finalize
\`\`\`

Each node in the LangGraph DAG represents a stage with:

- **Input validation** — Ensures required context is available
- **State tracking** — Every transition is logged and observable
- **Error handling** — Automatic retry with backoff for transient failures
- **Conditional routing** — Review failures can loop back to generation

## The Power of Combining Both

CrewAI alone gives you agents but no workflow structure. LangGraph alone gives you workflows but no role specialization. Together, they provide:

| Capability | CrewAI | LangGraph | Combined |
|-----------|--------|-----------|----------|
| Agent roles | Yes | No | Yes |
| State management | No | Yes | Yes |
| Observability | Limited | Full | Full |
| Error recovery | Basic | Advanced | Advanced |
| Role handoffs | Manual | Automatic | Automatic |

## Implementation in AGENA

AGENA's pipeline demonstrates this combination in production:

1. **fetch_context** — Retrieves codebase context, similar tasks from vector memory
2. **analyze** — PM agent breaks down the task into an implementation plan
3. **generate_code** — Developer agent writes code following the plan
4. **review_code** — Reviewer agent validates quality and correctness
5. **finalize** — Finalizer agent creates the PR with documentation

Each stage is a LangGraph node, and each node delegates to a CrewAI agent with the appropriate role and expertise.

[Explore AGENA's Pipeline →](/signup)

## Related Articles

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Pixel Agent Technology](/blog/pixel-agent-technology)
- [Designing a Multi-Tenant AI SaaS](/blog/multi-tenant-ai-saas-architecture)
- [Documentation — Architecture](/docs#architecture)
    `,
  },
  'multi-tenant-ai-saas-architecture': {
    title: 'Designing a Multi-Tenant AI SaaS: Lessons from Building AGENA',
    description:
      'Architecture decisions behind building a production-ready multi-tenant AI agent platform. Organization isolation, usage limits, billing, and security patterns.',
    date: '2026-03-10',
    readTime: '9 min read',
    content: `
## The Challenge of Multi-Tenant AI

Building a multi-tenant AI SaaS platform presents unique challenges. Unlike traditional SaaS where tenants share the same logic, an AI platform must isolate:

- **AI agent execution** — One tenant's agents shouldn't affect another's
- **Token budgets** — Usage limits per organization
- **Vector memory** — Tenant-scoped similarity search
- **Git credentials** — Secure per-org GitHub/Azure tokens

AGENA handles all of this with a clean, async-first architecture.

## Architecture Decisions

### Organization-Scoped Everything

Every database query in AGENA is scoped by \`organization_id\`. This isn't just a filter — it's a foundational design principle:

- All SQLAlchemy models include \`organization_id\`
- API routes extract org context from JWT tokens
- Vector memory queries filter by organization
- Worker tasks are isolated per organization

### Async-First with FastAPI

AGENA's backend is fully async:

- **FastAPI** with async route handlers
- **SQLAlchemy 2.0** with \`AsyncSession\`
- **Redis** async consumer for task queue
- **Async HTTP clients** for GitHub/Azure/Jira APIs

This ensures high concurrency — multiple organizations can run AI agents simultaneously without blocking.

### Redis Queue with Concurrency Control

The worker system uses Redis for task queuing with key safeguards:

- **MAX_WORKERS** — Configurable concurrent task limit
- **Queue lock guard** — Prevents same-repo concurrent execution
- **Stale job watchdog** — Auto-fails stuck tasks
- **Retry with backoff** — Handles transient LLM API failures

### Usage Enforcement and Billing

AGENA enforces per-organization limits:

- **Task quotas** — Free tier: 5 tasks/month, Pro: unlimited
- **Token tracking** — Per-task and per-org token usage counters
- **Cost allocation** — Track AI spend by task, sprint, and organization
- **Stripe + Iyzico** — Dual payment provider support

## Security Patterns

### JWT Authentication
Every API request is authenticated with JWT tokens containing:
- User ID and role
- Organization ID
- Token expiration

### Organization Isolation
Even if a user has valid credentials, they can only access data within their organization. This is enforced at the ORM level, not just the API level.

### Credential Encryption
GitHub tokens, Azure PATs, and Jira credentials are encrypted at rest and only decrypted during agent execution within the worker process.

## Lessons Learned

1. **Scope everything by org from day one** — Retrofitting multi-tenancy is painful
2. **Track AI costs per tenant** — Usage-based billing requires granular tracking
3. **Async is non-negotiable** — AI operations are I/O heavy and slow
4. **Isolate worker execution** — Queue locks prevent data corruption
5. **Observable by default** — Every AI stage should be logged and traceable

[Start Building with AGENA →](/signup)

## Related Articles

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Building Multi-Agent Pipelines with CrewAI and LangGraph](/blog/crewai-langgraph-orchestration)
- [AGENA vs GitHub Copilot](/blog/github-copilot-alternative)
- [Documentation — Configuration](/docs#configuration)
    `,
  },
  'yapay-zeka-ile-kod-yazma': {
    title: 'Yapay Zeka ile Kod Yazma: AGENA ile Otonom Geliştirme Rehberi',
    description:
      'Yapay zeka ile kod yazma artık hayal değil. AGENA\'nın agentic AI platformu ile otonom kod üretimi, PR oluşturma ve kalite kontrolünü öğrenin.',
    date: '2026-03-30',
    readTime: '9 dk okuma',
    content: `
## Yapay Zeka ile Kod Yazma Nedir?

Yapay zeka ile kod yazma, AI modellerinin yazılım geliştirme sürecinde aktif rol almasıdır. Geleneksel otomatik tamamlamadan çok daha ötesine geçen **agentic AI** yaklaşımıyla, yapay zeka artık sadece öneri yapmıyor — **otonom olarak planlıyor, kodluyor, gözden geçiriyor ve teslim ediyor.**

## AGENA ile Yapay Zeka Destekli Geliştirme

**AGENA**, yapay zeka ile kod yazmanın en gelişmiş formunu sunan açık kaynaklı bir agentic AI platformudur:

### Nasıl Çalışır?

1. **Görev backlog'unuzdan bir task seçersiniz** — Jira, Azure DevOps veya manuel olarak
2. **PM Agent görevi analiz eder** — Gereksinimleri anlar, codebase context'i toplar
3. **Developer Agent kod üretir** — Mevcut kalıplara uygun, production-ready kod yazar
4. **Reviewer Agent kaliteyi kontrol eder** — Bug, güvenlik açığı ve best practice kontrolü
5. **Finalizer Agent PR açar** — Branch oluşturur, commit atar, GitHub'da PR açar

### Neden AGENA?

- **Pixel Agent Teknolojisi** — AI agentlarınızı gerçek zamanlı görsel olarak takip edin
- **Multi-Tenant SaaS** — Ekibiniz için güvenli, izole ortam
- **Vector Memory** — Geçmiş görevlerden öğrenen, sürekli gelişen AI
- **Ücretsiz Başlangıç** — Ayda 5 görev ücretsiz

## Yapay Zeka ile Kod Yazmanın Avantajları

- **10x daha hızlı** rutin görev teslimi
- **Tutarlı kod kalitesi** — AI her seferinde aynı standartlarda üretir
- **Azaltılmış context switching** — AI implement eder, siz review edersiniz
- **7/24 çalışan geliştirici** — AI agentlar uyumaz

## Kimler İçin?

- **Startup ekipleri** — Sınırlı kaynaklarla daha fazla feature ship edin
- **Enterprise takımlar** — Rutin görevleri otomatize edin
- **Freelance geliştiriciler** — Verimliliğinizi katlayın

[AGENA'yı Ücretsiz Deneyin →](/signup)

## İlgili Yazılar

- [AI Agent Nedir? Yapay Zeka Agentlarının Rolü](/blog/ai-agent-nedir)
- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [AGENA vs GitHub Copilot](/blog/github-copilot-alternative)
- [Kullanım Senaryoları](/use-cases)
- [Dokümantasyon](/docs)
    `,
  },
  'ai-agent-nedir': {
    title: 'AI Agent Nedir? Yapay Zeka Agentlarının Yazılım Geliştirmedeki Rolü',
    description:
      'AI agent nedir, nasıl çalışır ve yazılım geliştirmede nasıl kullanılır? Agentic AI kavramını ve AGENA platformunun agent mimarisini keşfedin.',
    date: '2026-03-29',
    readTime: '7 dk okuma',
    content: `
## AI Agent Nedir?

**AI Agent** (yapay zeka agentı), belirli bir hedefe ulaşmak için otonom olarak karar alabilen, planlama yapabilen ve eylem gerçekleştirebilen yapay zeka sistemidir. Basit bir chatbot'tan farklı olarak, bir AI agent:

- **Bağımsız düşünür** — Problemi analiz edip çözüm planı oluşturur
- **Araç kullanır** — API'ler, veritabanları, dosya sistemleriyle etkileşime girer
- **Kendini düzeltir** — Hata yapınca geri adım atıp farklı yaklaşım dener
- **Çok adımlı iş akışları yürütür** — Tek bir komutla karmaşık görevleri tamamlar

## Agentic AI: Agent'ların Gücü

**Agentic AI**, birden fazla AI agentının birlikte çalışarak karmaşık görevleri otonom olarak tamamlamasıdır. AGENA'da bu şu şekilde çalışır:

### Agent Rolleri

| Agent | Görev | Uzmanlık |
|-------|-------|----------|
| **PM Agent** | Görev analizi | Gereksinim anlama, plan oluşturma |
| **Developer Agent** | Kod üretimi | Production-grade kod yazma |
| **Reviewer Agent** | Kalite kontrol | Bug, güvenlik, best practice |
| **Finalizer Agent** | PR oluşturma | Branch, commit, pull request |

### Pipeline Akışı

\`\`\`
fetch_context → analyze → generate_code → review_code → finalize
\`\`\`

Her adım bir **LangGraph** state machine düğümüdür ve her düğüm bir **CrewAI** agentına delege edilir.

## AI Agent vs AI Asistan

| Özellik | AI Asistan (ChatGPT) | AI Agent (AGENA) |
|---------|----------------------|------------------|
| Kapsam | Tek prompt → tek cevap | Tam görev → PR |
| Otonomi | İnsan yönlendirir | Bağımsız çalışır |
| Bağlam | Konuşma ile sınırlı | Tüm codebase + geçmiş |
| Çıktı | Kod parçacıkları | Production branch + PR |
| Kalite | Self-review yok | Dahili reviewer agent |

## Pixel Agent ile Görsel Takip

AGENA'nın **pixel agent teknolojisi**, her AI agentını animasyonlu bir piksel karakter olarak temsil eder. Bu sayede:

- Hangi agent çalışıyor, görebilirsiniz
- Pipeline'ın hangi aşamasında olduğunu takip edebilirsiniz
- Agentlar arası geçişleri gerçek zamanlı izleyebilirsiniz

## Başlangıç

AGENA açık kaynaklıdır ve ücretsiz kullanılabilir. GitHub reponuzu bağlayın, görev oluşturun ve AI agentlarının kodunuzu yazmasını izleyin.

[Ücretsiz Başla →](/signup)

## İlgili Yazılar

- [Yapay Zeka ile Kod Yazma Rehberi](/blog/yapay-zeka-ile-kod-yazma)
- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Pixel Agent Teknolojisi](/blog/pixel-agent-technology)
- [Kullanım Senaryoları](/use-cases)
    `,
  },
  'github-copilot-alternative': {
    title: 'AGENA vs GitHub Copilot: The Agentic AI Alternative for Full Autonomy',
    description:
      'Compare AGENA with GitHub Copilot. While Copilot suggests code line by line, AGENA\'s agentic AI agents autonomously generate complete PRs from task descriptions.',
    date: '2026-03-27',
    readTime: '8 min read',
    content: `
## AGENA vs GitHub Copilot: A Different Approach to AI Coding

GitHub Copilot and AGENA both use AI to help developers write code, but they represent fundamentally different paradigms:

- **Copilot** = AI-assisted coding (human drives, AI suggests)
- **AGENA** = Agentic AI coding (AI drives, human reviews)

## Feature Comparison

| Feature | GitHub Copilot | AGENA |
|---------|---------------|-------|
| **Approach** | Autocomplete suggestions | Full task-to-PR autonomy |
| **Scope** | Current file/line | Entire codebase |
| **Output** | Code snippets | Complete pull requests |
| **Review** | None (human reviews manually) | Built-in AI reviewer agent |
| **Context** | Open files in IDE | Full repo + vector memory + past tasks |
| **Multi-file** | Limited | Yes, cross-file changes |
| **Git operations** | None | Branch, commit, PR creation |
| **Pipeline** | None | PM → Developer → Reviewer → Finalizer |
| **Self-hosted** | No | Yes, open-source |
| **Multi-tenant** | No | Yes, organization isolation |
| **Integrations** | IDE only | GitHub, Azure DevOps, Jira, Slack, Teams |

## When to Use Copilot

Copilot excels at:
- **In-editor suggestions** while you type
- **Quick function completions** for routine patterns
- **Learning new APIs** through inline examples
- **Real-time pair programming** experience

## When to Use AGENA

AGENA excels at:
- **Batch task processing** — Queue 10 tasks, get 10 PRs
- **Autonomous delivery** — No manual coding needed for routine tasks
- **Team-wide automation** — Multiple developers benefit from shared AI agents
- **Full pipeline** — From task analysis to PR creation
- **Code review** — Built-in quality assurance before PR
- **Observability** — Pixel agent dashboard shows AI workflow progress
- **Self-hosting** — Complete control over your AI infrastructure

## Using Both Together

AGENA and Copilot are complementary:

1. **Use Copilot** for complex, creative coding where you want AI assistance while you think
2. **Use AGENA** for well-defined tasks that can be fully automated (bug fixes, feature implementations, refactoring)

This way, your team gets:
- **IDE-level AI** from Copilot for hands-on work
- **Pipeline-level AI** from AGENA for autonomous delivery

## The Agentic AI Advantage

The key difference is **autonomy**. Copilot waits for you to type. AGENA takes a task and delivers a PR. This is the shift from AI-assisted to **agentic AI** — and it represents the future of software development.

[Try AGENA Free →](/signup)

## Related Articles

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Yapay Zeka ile Kod Yazma](/blog/yapay-zeka-ile-kod-yazma)
- [AI Agent Nedir?](/blog/ai-agent-nedir)
- [Pixel Agent Technology](/blog/pixel-agent-technology)
- [Documentation — Quick Start](/docs#quickstart)
    `,
  },
};

export function generateStaticParams() {
  return Object.keys(posts).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = posts[params.slug];
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      authors: ['AGENA'],
      url: `https://agena.dev/blog/${params.slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  };
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = posts[params.slug];
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    url: `https://agena.dev/blog/${params.slug}`,
    author: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' },
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' },
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://agena.dev/blog' },
      { '@type': 'ListItem', position: 3, name: post.title, item: `https://agena.dev/blog/${params.slug}` },
    ],
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <article className='container' style={{ maxWidth: 760, padding: '80px 24px' }}>
        {/* Breadcrumb */}
        <nav style={{ marginBottom: 32, fontSize: 13, color: 'var(--ink-35)' }}>
          <Link href='/' style={{ color: 'var(--ink-35)', textDecoration: 'none' }}>Home</Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <Link href='/blog' style={{ color: 'var(--ink-35)', textDecoration: 'none' }}>Blog</Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <span style={{ color: 'var(--ink-50)' }}>{post.title.slice(0, 40)}...</span>
        </nav>

        <header style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, color: 'var(--ink-90)', lineHeight: 1.2, marginBottom: 16 }}>
            {post.title}
          </h1>
          <div style={{ display: 'flex', gap: 16, color: 'var(--ink-35)', fontSize: 14 }}>
            <time>{post.date}</time>
            <span>{post.readTime}</span>
          </div>
        </header>

        <div
          className='blog-content'
          style={{ color: 'var(--ink-72)', fontSize: 16, lineHeight: 1.8 }}
          dangerouslySetInnerHTML={{ __html: markdownToHtml(post.content) }}
        />

        <div style={{ marginTop: 64, padding: '32px', borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--ink-90)', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
            Ready to try agentic AI?
          </h3>
          <p style={{ color: 'var(--ink-45)', marginBottom: 20, fontSize: 15 }}>
            Start free and let AGENA&apos;s pixel agents handle your development workflow.
          </p>
          <Link href='/signup' className='button button-primary' style={{ fontSize: 15, padding: '12px 28px' }}>
            Start Free →
          </Link>
        </div>
      </article>
    </>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="color:var(--ink-90);font-size:18px;font-weight:700;margin:32px 0 12px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:var(--ink-90);font-size:22px;font-weight:700;margin:40px 0 16px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink-90)">$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(13,148,136,0.1);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:14px">$1</code>')
    .replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/, '').replace(/```$/, '');
      return `<pre style="background:var(--terminal-bg);border:1px solid var(--panel-border-2);border-radius:10px;padding:16px;overflow-x:auto;font-size:13px;color:var(--ink-65);margin:20px 0"><code>${code}</code></pre>`;
    })
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      const tag = 'td';
      return `<tr>${cells.map(c => `<${tag} style="padding:8px 12px;border:1px solid var(--panel-border-2);font-size:14px">${c}</${tag}>`).join('')}</tr>`;
    })
    .replace(/((<tr>.*<\/tr>\s*)+)/g, '<table style="width:100%;border-collapse:collapse;margin:20px 0">$1</table>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>')
    .replace(/((<li.*<\/li>\s*)+)/g, '<ul style="margin:12px 0;padding-left:20px">$1</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0;padding-left:4px">$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);text-decoration:underline">$1</a>')
    .replace(/^(?!<[a-z])((?!\s*$).+)$/gm, '<p style="margin:12px 0">$1</p>')
    .replace(/<p style="margin:12px 0"><\/p>/g, '');
}
