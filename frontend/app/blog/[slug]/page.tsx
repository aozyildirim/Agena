import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReadingProgress from '@/components/ReadingProgress';
import BlogTableOfContents from '@/components/BlogTableOfContents';
import ShareButtons from '@/components/ShareButtons';

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
  'agentic-ai-nedir': {
    title: 'Agentic AI Nedir? Otonom Yapay Zeka Sistemlerinin Geleceği',
    description:
      'Agentic AI nedir, geleneksel yapay zekadan farkı ne? Otonom AI agentların yazılım geliştirme, kod üretimi ve PR otomasyonundaki devrimci rolünü keşfedin.',
    date: '2026-04-01',
    readTime: '8 dk okuma',
    content: `
## Agentic AI Nedir?

**Agentic AI** (otonom yapay zeka), karmaşık görevleri **bağımsız olarak planlayabilen, yürütebilen ve sonuçlandırabilen** yapay zeka sistemlerini ifade eder. Geleneksel AI chatbot'larından farklı olarak, agentic AI sistemleri tek bir komutla çok adımlı iş akışlarını tamamlar.

### Geleneksel AI vs Agentic AI

| Özellik | Geleneksel AI | Agentic AI |
|---------|---------------|------------|
| **Çalışma şekli** | Soru-cevap | Otonom görev tamamlama |
| **Kapsam** | Tek prompt → tek cevap | Görev → plan → uygulama → teslim |
| **Bağlam** | Konuşma geçmişi | Tüm codebase + vektör bellek |
| **İnsan müdahalesi** | Her adımda gerekli | Sadece review aşamasında |
| **Çıktı** | Metin/kod parçacığı | Branch + commit + pull request |

## Agentic AI Yazılım Geliştirmede Nasıl Çalışır?

AGENA platformunda agentic AI şu pipeline ile çalışır:

### 1. Görev Analizi (PM Agent)
PM agentı, backlog'dan gelen görevi analiz eder. Gereksinimleri anlar, codebase context'i toplar ve bir uygulama planı oluşturur.

### 2. Planlama (Planner Agent)
Planner agentı, dosya seviyesinde hangi değişikliklerin yapılacağını belirler. Her dosya için ne eklenmeli, ne değiştirilmeli detaylı bir plan çıkarır.

### 3. Kod Üretimi (Developer Agent)
Developer agentı, plana uygun olarak production-ready kod yazar. Mevcut codebase kalıplarına uyum sağlar, test yazabilir ve edge case'leri düşünür.

### 4. Kalite Kontrolü (Reviewer Agent)
Reviewer agentı, üretilen kodu bağımsız olarak inceler:
- Bug ve hata kontrolü
- Güvenlik açıkları taraması
- Best practice uyumu
- Performance değerlendirmesi

### 5. Teslim (Finalizer Agent)
Finalizer agentı, GitHub veya Azure DevOps'ta branch oluşturur, temiz commit'ler atar ve pull request açar.

## Neden Agentic AI?

### Geliştirici Verimliliği
Rutin görevler (bug fix, refactoring, feature implementation) için geliştirici saatlerinden tasarruf sağlar. AI agentlar 7/24 çalışır.

### Tutarlı Kalite
Her PR aynı standartlarda üretilir. Reviewer agentı her seferinde aynı titizlikle kontrol eder.

### Ölçeklenebilirlik
Tek bir geliştirici yerine birden fazla AI agentı paralel çalışarak sprint velocity'yi artırır.

## AGENA ile Agentic AI'ı Deneyimleyin

AGENA, açık kaynaklı bir agentic AI platformudur. Pixel agent teknolojisi ile AI agentlarınızı görsel olarak takip edebilir, CrewAI + LangGraph orkestrasyon altyapısı ile güvenilir sonuçlar alabilirsiniz.

- **Ücretsiz tier** — Ayda 5 görev
- **Open source** — Self-host veya managed platform
- **7 dil desteği** — Türkçe dahil

[Agentic AI'ı Ücretsiz Deneyin →](/signup)

## İlgili Yazılar

- [AI Agent Nedir?](/blog/ai-agent-nedir)
- [Yapay Zeka ile Kod Yazma Rehberi](/blog/yapay-zeka-ile-kod-yazma)
- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Pixel Agent Teknolojisi](/blog/pixel-agent-technology)
    `,
  },
  'otonom-kodlama-rehberi': {
    title: 'Otonom Kodlama: AI Agentlar ile Yazılım Geliştirmenin Yeni Çağı',
    description:
      'Otonom kodlama nedir ve nasıl çalışır? AI agentların bağımsız olarak kod yazması, review etmesi ve PR açması hakkında kapsamlı rehber.',
    date: '2026-04-02',
    readTime: '10 dk okuma',
    content: `
## Otonom Kodlama Nedir?

**Otonom kodlama**, yapay zeka agentlarının insan müdahalesi olmadan kod yazma, test etme, review etme ve teslim etme sürecidir. Geleneksel "autocomplete" tarzı AI yardımından temelden farklıdır — burada AI sadece öneri yapmaz, **baştan sona görevi tamamlar**.

## Otonom Kodlama vs Kod Önerileri

### GitHub Copilot Yaklaşımı
- Siz yazarsınız, AI tamamlar
- Dosya bazında çalışır
- Her satırda insan kararı gerekir
- Çıktı: kod parçacıkları

### AGENA Otonom Kodlama Yaklaşımı
- Görev tanımlarsınız, AI tamamlar
- Tüm codebase'i anlar
- İnsan sadece PR review eder
- Çıktı: branch + commit + pull request

## Otonom Kodlama Pipeline'ı

AGENA'nın otonom kodlama pipeline'ı 5 aşamadan oluşur:

\`\`\`
fetch_context → analyze → generate_code → review_code → finalize
\`\`\`

### Aşama 1: Context Toplama
Vektör bellek (Qdrant) kullanarak benzer geçmiş görevleri bulur. Codebase'den ilgili dosyaları, kalıpları ve convention'ları çıkarır.

### Aşama 2: Analiz
PM agentı görevi derinlemesine analiz eder:
- Story point tahmini
- Etkilenen dosyaların listesi
- Teknik kısıtlamalar
- Kabul kriterleri

### Aşama 3: Kod Üretimi
Developer agentı, analize dayalı olarak kod yazar:
- Mevcut kalıplara uygun kod
- Import ve dependency yönetimi
- Hata yönetimi ve edge case'ler

### Aşama 4: Otomatik Review
Reviewer agentı kodu bağımsız olarak değerlendirir:
- Fonksiyonel doğruluk
- Güvenlik taraması
- Performance analizi
- Code style uyumu

### Aşama 5: Teslim
Finalizer agentı Git işlemlerini halleder:
- Feature branch oluşturma
- Temiz commit mesajları
- PR açma ve açıklama yazma

## Otonom Kodlama İçin En İyi Pratikler

### 1. Görevleri İyi Tanımlayın
AI agentlar, net tanımlanmış görevlerde en iyi sonucu verir:
- Bug fix'lerde reproduction step'leri ekleyin
- Feature'larda acceptance criteria belirleyin
- Refactoring'de hedef pattern'i açıklayın

### 2. Codebase Convention'larını Koruyun
AGENA otomatik olarak mevcut kalıpları öğrenir, ama:
- Lint kurallarınızı güncel tutun
- README ve dökümanları zenginleştirin
- Tutarlı klasör yapısı kullanın

### 3. Review Sürecini Optimize Edin
AI ürettiği kodu başka bir AI agentı review eder, ama insan review'u da önemlidir:
- PR açıklamalarını okuyun
- Diff'leri kontrol edin
- Edge case'leri doğrulayın

## Kimler Otonom Kodlamayı Kullanmalı?

| Ekip Tipi | Kullanım Senaryosu |
|-----------|-------------------|
| **Startup** | Sınırlı kaynakla daha fazla feature ship etme |
| **Enterprise** | Rutin görevleri otomatize etme |
| **Freelancer** | Verimlilik artırma, paralel proje yönetimi |
| **Open Source** | Issue'ları otomatik çözme |

## Başlayın

AGENA ile otonom kodlamayı bugün deneyin. Ücretsiz tier ile başlayın, GitHub veya Azure DevOps reponuzu bağlayın.

[Otonom Kodlamayı Deneyin →](/signup)

## İlgili Yazılar

- [Agentic AI Nedir?](/blog/agentic-ai-nedir)
- [AI Agent Nedir?](/blog/ai-agent-nedir)
- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [AGENA vs GitHub Copilot](/blog/github-copilot-alternative)
    `,
  },
  'ai-ile-pr-otomasyonu': {
    title: 'AI ile Pull Request Otomasyonu: Backlog\'dan PR\'a Dakikalar İçinde',
    description:
      'AI ile otomatik pull request oluşturma nasıl çalışır? AGENA\'nın agentic AI pipeline\'ı ile görev tanımından production-ready PR\'a kadar tüm süreci öğrenin.',
    date: '2026-04-03',
    readTime: '7 dk okuma',
    content: `
## AI ile Pull Request Otomasyonu

Yazılım geliştirmede en çok zaman alan süreçlerden biri **görevden PR'a giden yol**dur: görevi anlama, kodu yazma, test etme, review etme, branch açma, commit atma, PR oluşturma. **AI ile PR otomasyonu** bu sürecin tamamını dakikalara indirger.

## Geleneksel PR Süreci vs AI Otomasyonu

### Geleneksel Süreç (Saatler/Günler)
1. Görevi anlama ve planlama (~30 dk)
2. Kod yazma (~2-8 saat)
3. Self-review (~30 dk)
4. Branch oluşturma, commit (~10 dk)
5. PR açma, açıklama yazma (~15 dk)
6. Code review bekleme (~24 saat)
7. Revision'lar (~1-4 saat)

**Toplam: 1-3 gün**

### AGENA AI Otomasyonu (Dakikalar)
1. Görev seçimi (1 dk — backlog'dan seç)
2. AI analiz + planlama (~2 dk)
3. AI kod üretimi (~3-5 dk)
4. AI code review (~2 dk)
5. Otomatik branch + commit + PR (~1 dk)

**Toplam: ~10 dakika**

## AGENA ile PR Otomasyonu Nasıl Çalışır?

### Adım 1: Görev İmport
Görevlerinizi üç kaynaktan alabilirsiniz:
- **Azure DevOps** — Sprint'ten iş öğelerini seçin
- **Jira** — Board'dan task'ları import edin
- **Manuel** — Doğrudan AGENA'da görev oluşturun

### Adım 2: AI Pipeline Başlatma
Görevi seçip "Assign to AI" dediğinizde pipeline başlar:

\`\`\`
PM Agent → Planner Agent → Developer Agent → Reviewer Agent → Finalizer
\`\`\`

Her aşamayı pixel agent dashboard'undan gerçek zamanlı izleyebilirsiniz.

### Adım 3: Otomatik PR Oluşturma
Pipeline tamamlandığında AGENA otomatik olarak:
- **Feature branch** oluşturur (ör. \`feature/TASK-123-user-auth\`)
- **Clean commit'ler** atar (anlamlı mesajlarla)
- **PR açar** (başlık, açıklama, dosya listesi ile)
- **Reviewer atar** (ayarlıysa)

### Adım 4: İnsan Review
Siz sadece PR'ı review edersiniz:
- AI'ın ürettiği kodu inceleyin
- Gerekirse yorum bırakın
- Merge edin

## Desteklenen Platformlar

| Platform | Özellikler |
|----------|-----------|
| **GitHub** | Branch, commit, PR, reviewer atama, label |
| **Azure DevOps** | Branch, PR, work item güncelleme, reviewer |

## PR Otomasyonunun Faydaları

### Sprint Velocity Artışı
Rutin görevler (bug fix, küçük feature, refactoring) AI tarafından dakikalar içinde PR'a dönüşür. Ekip büyük, yaratıcı görevlere odaklanır.

### Tutarlı PR Kalitesi
Her PR aynı standartta:
- Açıklayıcı başlık ve description
- Clean diff, gereksiz değişiklik yok
- AI reviewer tarafından önceden kontrol edilmiş

### 7/24 Çalışma
AI agentlar uyumaz. Gece oluşturulan görevler sabaha PR olarak hazırdır.

### DORA Metrikleri İyileşmesi
- **Lead Time** azalır — görevden PR'a süre dakikalara iner
- **Deployment Frequency** artar — daha fazla PR, daha sık deploy
- **Change Failure Rate** düşer — AI review kaliteyi artırır

## Flow Builder ile Gelişmiş Otomasyon

AGENA'nın visual flow builder'ı ile daha karmaşık senaryolar oluşturabilirsiniz:

- **Sprint başında**: Tüm "New" durumundaki görevleri otomatik import et
- **PR açıldığında**: Slack'e bildirim gönder
- **Review tamamlandığında**: Azure DevOps work item'ı "Done"a çek
- **Koşullu akışlar**: Story point'e göre farklı model kullan

## Başlayın

AGENA ile ilk otomatik PR'ınızı dakikalar içinde oluşturun:

1. [Ücretsiz kaydolun](/signup)
2. GitHub veya Azure DevOps reponuzu bağlayın
3. Bir görev oluşturun veya import edin
4. "Assign to AI" deyin ve izleyin

[İlk Otomatik PR'ınızı Oluşturun →](/signup)

## İlgili Yazılar

- [Otonom Kodlama Rehberi](/blog/otonom-kodlama-rehberi)
- [Agentic AI Nedir?](/blog/agentic-ai-nedir)
- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Yapay Zeka ile Kod Yazma](/blog/yapay-zeka-ile-kod-yazma)
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
  'ia-agentes-autonomos': {
    title: 'Agentes IA Autónomos: Cómo Revolucionan el Desarrollo de Software',
    description:
      'Los agentes IA autónomos están transformando la forma en que los equipos desarrollan software. Descubre cómo AGENA automatiza desde el análisis hasta la creación de pull requests.',
    date: '2026-04-03',
    readTime: '8 min lectura',
    content: `
## ¿Qué son los Agentes IA Autónomos?

Los agentes IA autónomos son sistemas de inteligencia artificial capaces de **planificar, ejecutar y adaptarse** de forma independiente para lograr objetivos complejos. A diferencia de los asistentes IA tradicionales, estos agentes operan con mínima supervisión humana.

### El Pipeline de AGENA

AGENA implementa un pipeline de agentes especializados:

- **Agente PM** — Analiza requisitos y prioriza tareas
- **Agente Desarrollador** — Genera código de producción usando el contexto del repositorio
- **Agente Revisor** — Revisa calidad, seguridad y mejores prácticas
- **Agente Finalizador** — Crea branches, commits y pull requests

### Beneficios para Equipos de Desarrollo

| Aspecto | Sin IA | Con AGENA |
|---------|--------|-----------|
| Tiempo por PR | 2-5 días | 10-30 minutos |
| Revisión de código | Manual | Automática + Manual |
| Contexto | Limitado | Memoria vectorial completa |
| Escalabilidad | Lineal con equipo | Ilimitada |

### Cómo Empezar

1. Crea una cuenta gratuita en AGENA
2. Conecta tu repositorio de GitHub o Azure DevOps
3. Importa tareas desde Jira o créalas manualmente
4. Los agentes IA se encargan del resto

AGENA es completamente **open source** bajo licencia MIT. Puedes auto-hospedarlo o usar la plataforma gestionada.

### Lecturas Relacionadas

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [AGENA vs GitHub Copilot](/blog/github-copilot-alternative)
- [Documentación — Quick Start](/docs#quickstart)
    `,
  },
  'automatizacion-pull-requests-ia': {
    title: 'Automatización de Pull Requests con IA: De la Idea al Código en Minutos',
    description:
      'Aprende cómo la IA agéntica automatiza la creación de pull requests. AGENA genera código, revisa calidad y abre PRs automáticamente desde descripciones de tareas.',
    date: '2026-04-02',
    readTime: '7 min lectura',
    content: `
## Automatización de Pull Requests con IA

La creación manual de pull requests consume tiempo valioso del equipo de desarrollo. Con **AGENA**, este proceso se automatiza completamente mediante agentes IA especializados.

### El Flujo Automatizado

1. **Entrada**: Descripción de tarea (desde Jira, Azure DevOps, o manual)
2. **Análisis**: El agente PM analiza requisitos y contexto del código
3. **Generación**: El agente Desarrollador escribe código siguiendo patrones del repositorio
4. **Revisión**: El agente Revisor verifica calidad y seguridad
5. **Entrega**: Branch, commit y PR creados automáticamente

### Integraciones Soportadas

AGENA se integra con las herramientas que ya usas:

- **GitHub** — Creación de branches, PRs con reviewers y labels
- **Azure DevOps** — PRs, work items y pipelines
- **Jira** — Importación de tareas con sincronización bidireccional
- **Slack / Teams** — Notificaciones en tiempo real

### Flow Builder Visual

El Flow Builder de AGENA permite crear pipelines personalizados conectando agentes, condiciones y acciones. Similar a n8n, pero diseñado específicamente para automatización de desarrollo.

### Seguridad

- AGENA **nunca almacena** tu código fuente
- Acceso al repositorio mediante OAuth tokens con alcance limitado
- Procesamiento en sesiones aisladas
- Auto-hospedaje disponible para control total

### Lecturas Relacionadas

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Building Multi-Agent Pipelines](/blog/crewai-langgraph-orchestration)
    `,
  },
  'ki-agenten-softwareentwicklung': {
    title: 'KI-Agenten in der Softwareentwicklung: Autonome Code-Generierung mit AGENA',
    description:
      'Erfahren Sie, wie KI-Agenten die Softwareentwicklung revolutionieren. AGENA automatisiert den gesamten Prozess von der Aufgabe bis zum Pull Request.',
    date: '2026-04-03',
    readTime: '8 Min. Lesezeit',
    content: `
## KI-Agenten in der Softwareentwicklung

KI-Agenten sind autonome Systeme, die **selbstständig planen, ausführen und sich anpassen** können, um komplexe Aufgaben zu erledigen. In der Softwareentwicklung bedeutet dies: von der Aufgabenbeschreibung bis zum fertigen Pull Request — vollautomatisch.

### Die AGENA-Pipeline

AGENA nutzt spezialisierte KI-Agenten in einer Pipeline:

- **PM-Agent** — Analysiert Anforderungen und priorisiert Aufgaben
- **Entwickler-Agent** — Generiert produktionsreifen Code basierend auf dem Repository-Kontext
- **Reviewer-Agent** — Überprüft Codequalität, Sicherheit und Best Practices
- **Finalisierer-Agent** — Erstellt Branches, Commits und Pull Requests

### Vorteile für Entwicklungsteams

| Aspekt | Ohne KI | Mit AGENA |
|--------|---------|-----------|
| Zeit pro PR | 2-5 Tage | 10-30 Minuten |
| Code-Review | Manuell | Automatisch + Manuell |
| Kontext | Begrenzt | Vollständiges Vektorspeicher |
| Skalierbarkeit | Linear mit Team | Unbegrenzt |

### Erste Schritte

1. Erstellen Sie ein kostenloses AGENA-Konto
2. Verbinden Sie Ihr GitHub- oder Azure DevOps-Repository
3. Importieren Sie Aufgaben aus Jira oder erstellen Sie diese manuell
4. Die KI-Agenten erledigen den Rest

### Weiterführende Artikel

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Multi-Agent Pipelines with CrewAI](/blog/crewai-langgraph-orchestration)
- [Dokumentation — Quick Start](/docs#quickstart)
    `,
  },
  'automatische-pull-requests-ki': {
    title: 'Automatische Pull Requests mit KI: Vom Backlog zum Code in Minuten',
    description:
      'Wie agentische KI die Erstellung von Pull Requests automatisiert. AGENA generiert Code, überprüft Qualität und öffnet PRs automatisch.',
    date: '2026-04-02',
    readTime: '7 Min. Lesezeit',
    content: `
## Automatische Pull Requests mit KI

Die manuelle Erstellung von Pull Requests kostet wertvolle Entwicklerzeit. Mit **AGENA** wird dieser Prozess vollständig durch spezialisierte KI-Agenten automatisiert.

### Der automatisierte Ablauf

1. **Eingabe**: Aufgabenbeschreibung (aus Jira, Azure DevOps oder manuell)
2. **Analyse**: Der PM-Agent analysiert Anforderungen und Code-Kontext
3. **Generierung**: Der Entwickler-Agent schreibt Code nach Repository-Mustern
4. **Überprüfung**: Der Reviewer-Agent verifiziert Qualität und Sicherheit
5. **Lieferung**: Branch, Commit und PR werden automatisch erstellt

### Unterstützte Integrationen

- **GitHub** — Branch-Erstellung, PRs mit Reviewern und Labels
- **Azure DevOps** — PRs, Work Items und Pipelines
- **Jira** — Aufgabenimport mit bidirektionaler Synchronisation
- **Slack / Teams** — Echtzeit-Benachrichtigungen

### Sicherheit

- AGENA speichert **niemals** Ihren Quellcode
- Repository-Zugriff über OAuth-Tokens mit begrenztem Umfang
- Verarbeitung in isolierten Sitzungen
- Self-Hosting für volle Kontrolle verfügbar

### Weiterführende Artikel

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Pixel Agent Technology](/blog/pixel-agent-technology)
    `,
  },
  'ai-agent-jisedai-kaihatsu': {
    title: 'AIエージェントによる次世代ソフトウェア開発',
    description:
      'AIエージェントがソフトウェア開発をどのように革新するか。AGENAの自律型AIエージェントはコード生成からプルリクエスト作成まで自動化します。',
    date: '2026-04-03',
    readTime: '8 分で読める',
    content: `
## AIエージェントによる次世代開発

AIエージェントは、複雑な目標を達成するために**自律的に計画、実行、適応**できる人工知能システムです。従来のAIアシスタントとは異なり、最小限の人間の監視で多段階推論を行います。

### AGENAのAIエージェントパイプライン

AGENAは専門化されたAIエージェントのパイプラインを実装しています：

- **PMエージェント** — 要件を分析し、タスクを優先順位付け
- **開発者エージェント** — リポジトリのコンテキストに基づいて本番グレードのコードを生成
- **レビュアーエージェント** — コード品質、セキュリティ、ベストプラクティスを検証
- **ファイナライザーエージェント** — ブランチ、コミット、プルリクエストを作成

### チームへのメリット

| 項目 | AI無し | AGENA使用 |
|------|--------|-----------|
| PR作成時間 | 2-5日 | 10-30分 |
| コードレビュー | 手動 | 自動＋手動 |
| コンテキスト | 限定的 | 完全なベクトルメモリ |
| スケーラビリティ | チームに比例 | 無制限 |

### 始め方

1. AGENAで無料アカウントを作成
2. GitHubまたはAzure DevOpsリポジトリを接続
3. Jiraからタスクをインポートまたは手動作成
4. AIエージェントが残りを処理

AGENAはMITライセンスの完全**オープンソース**です。

### 関連記事

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [ドキュメント — Quick Start](/docs#quickstart)
    `,
  },
  'jidou-pull-request-ai': {
    title: 'AIによるPull Request自動化：バックログからコードまで数分で',
    description:
      'エージェンティックAIがプルリクエストの作成をどのように自動化するか。AGENAはタスク説明からコード生成、品質レビュー、PR作成まで自動で行います。',
    date: '2026-04-02',
    readTime: '7 分で読める',
    content: `
## AIによるPull Request自動化

プルリクエストの手動作成は、開発チームの貴重な時間を消費します。**AGENA**を使用すると、このプロセスは専門AIエージェントによって完全に自動化されます。

### 自動化フロー

1. **入力**：タスク説明（Jira、Azure DevOps、または手動入力）
2. **分析**：PMエージェントが要件とコードコンテキストを分析
3. **生成**：開発者エージェントがリポジトリパターンに従ってコードを作成
4. **レビュー**：レビュアーエージェントが品質とセキュリティを検証
5. **配信**：ブランチ、コミット、PRが自動作成

### サポートされている統合

- **GitHub** — ブランチ作成、レビュアーとラベル付きPR
- **Azure DevOps** — PR、ワークアイテム、パイプライン
- **Jira** — 双方向同期によるタスクインポート
- **Slack / Teams** — リアルタイム通知

### セキュリティ

- AGENAはソースコードを**保存しません**
- OAuthトークンによる限定スコープのリポジトリアクセス
- 隔離されたセッションでのコード処理
- セルフホスティングで完全なコントロール

### 関連記事

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Pixel Agent Technology](/blog/pixel-agent-technology)
    `,
  },
  'agenti-ia-sviluppo-software': {
    title: 'Agenti IA nello Sviluppo Software: Generazione Autonoma di Codice con AGENA',
    description:
      'Scopri come gli agenti IA stanno rivoluzionando lo sviluppo software. AGENA automatizza l\'intero processo dall\'analisi alla creazione di pull request.',
    date: '2026-04-03',
    readTime: '8 min di lettura',
    content: `
## Agenti IA nello Sviluppo Software

Gli agenti IA sono sistemi autonomi capaci di **pianificare, eseguire e adattarsi** indipendentemente per raggiungere obiettivi complessi. Nello sviluppo software, questo significa: dalla descrizione del task alla pull request completata — tutto automatico.

### La Pipeline di AGENA

AGENA utilizza agenti IA specializzati in una pipeline:

- **Agente PM** — Analizza requisiti e prioritizza le attività
- **Agente Sviluppatore** — Genera codice di produzione basato sul contesto del repository
- **Agente Revisore** — Verifica qualità del codice, sicurezza e best practice
- **Agente Finalizzatore** — Crea branch, commit e pull request

### Vantaggi per i Team di Sviluppo

| Aspetto | Senza IA | Con AGENA |
|---------|----------|-----------|
| Tempo per PR | 2-5 giorni | 10-30 minuti |
| Code Review | Manuale | Automatica + Manuale |
| Contesto | Limitato | Memoria vettoriale completa |
| Scalabilità | Lineare con il team | Illimitata |

### Come Iniziare

1. Crea un account gratuito su AGENA
2. Collega il tuo repository GitHub o Azure DevOps
3. Importa le attività da Jira o creale manualmente
4. Gli agenti IA si occupano del resto

AGENA è completamente **open source** sotto licenza MIT.

### Letture Correlate

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Documentazione — Quick Start](/docs#quickstart)
    `,
  },
  'automazione-pull-request-ia': {
    title: 'Automazione Pull Request con IA: Dall\'Idea al Codice in Minuti',
    description:
      'Come l\'IA agentica automatizza la creazione di pull request. AGENA genera codice, rivede la qualità e apre PR automaticamente.',
    date: '2026-04-02',
    readTime: '7 min di lettura',
    content: `
## Automazione Pull Request con IA

La creazione manuale di pull request consuma tempo prezioso del team di sviluppo. Con **AGENA**, questo processo è completamente automatizzato da agenti IA specializzati.

### Il Flusso Automatizzato

1. **Input**: Descrizione dell'attività (da Jira, Azure DevOps o manuale)
2. **Analisi**: L'agente PM analizza requisiti e contesto del codice
3. **Generazione**: L'agente Sviluppatore scrive codice seguendo i pattern del repository
4. **Revisione**: L'agente Revisore verifica qualità e sicurezza
5. **Consegna**: Branch, commit e PR creati automaticamente

### Integrazioni Supportate

- **GitHub** — Creazione branch, PR con reviewer e label
- **Azure DevOps** — PR, work item e pipeline
- **Jira** — Importazione attività con sincronizzazione bidirezionale
- **Slack / Teams** — Notifiche in tempo reale

### Sicurezza

- AGENA **non memorizza mai** il tuo codice sorgente
- Accesso al repository tramite token OAuth con ambito limitato
- Elaborazione in sessioni isolate
- Self-hosting disponibile per il controllo completo

### Letture Correlate

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Multi-Agent Pipelines](/blog/crewai-langgraph-orchestration)
    `,
  },
  'zhineng-daili-ai-ruanjian-kaifa': {
    title: '智能代理AI：自主软件开发的未来',
    description:
      '了解智能代理AI如何革命性地改变软件开发。AGENA的自主AI代理可以自动编写代码、审查质量并创建拉取请求。',
    date: '2026-04-03',
    readTime: '8 分钟阅读',
    content: `
## 什么是智能代理AI？

智能代理AI是一种能够**自主规划、执行和适应**的人工智能系统，能够在最少人类监督下完成复杂目标。与传统AI助手不同，智能代理系统能够独立进行多步推理、工具使用和自我纠正。

### AGENA的AI代理管道

AGENA实现了专业化的AI代理管道：

- **PM代理** — 分析需求并优先排序任务
- **开发者代理** — 基于代码库上下文生成生产级代码
- **审查者代理** — 检查代码质量、安全性和最佳实践
- **完成者代理** — 创建分支、提交和拉取请求

### 团队收益

| 方面 | 无AI | 使用AGENA |
|------|------|-----------|
| 每个PR时间 | 2-5天 | 10-30分钟 |
| 代码审查 | 手动 | 自动+手动 |
| 上下文 | 有限 | 完整向量记忆 |
| 可扩展性 | 随团队线性增长 | 无限 |

### 如何开始

1. 在AGENA创建免费账户
2. 连接您的GitHub或Azure DevOps仓库
3. 从Jira导入任务或手动创建
4. AI代理会处理剩余工作

AGENA在MIT许可证下完全**开源**。您可以自行托管或使用托管平台。

### 相关阅读

- [What is Agentic AI?](/blog/what-is-agentic-ai)
- [Documentation — Quick Start](/docs#quickstart)
    `,
  },
  'ai-zidong-pull-request': {
    title: 'AI自动化Pull Request：从需求到代码只需几分钟',
    description:
      '了解智能代理AI如何自动化拉取请求的创建。AGENA从任务描述自动生成代码、审查质量并创建PR。',
    date: '2026-04-02',
    readTime: '7 分钟阅读',
    content: `
## AI自动化Pull Request

手动创建拉取请求消耗开发团队的宝贵时间。通过**AGENA**，这个过程由专业AI代理完全自动化。

### 自动化流程

1. **输入**：任务描述（来自Jira、Azure DevOps或手动输入）
2. **分析**：PM代理分析需求和代码上下文
3. **生成**：开发者代理按照仓库模式编写代码
4. **审查**：审查者代理验证质量和安全性
5. **交付**：自动创建分支、提交和PR

### 支持的集成

- **GitHub** — 创建分支、带审查者和标签的PR
- **Azure DevOps** — PR、工作项和管道
- **Jira** — 双向同步的任务导入
- **Slack / Teams** — 实时通知

### 安全保障

- AGENA**从不存储**您的源代码
- 通过有限范围的OAuth令牌访问仓库
- 在隔离会话中处理代码
- 可自行托管以获得完全控制

### 相关阅读

- [AI Code Generation Best Practices](/blog/ai-code-generation-best-practices)
- [Pixel Agent Technology](/blog/pixel-agent-technology)
    `,
  },
  'agentic-ai-nedir-rehber': {
    title: 'Agentic AI Nedir? Otonom Yazılım Geliştirmenin Geleceği',
    description: 'Agentic AI, yazılım geliştirmede paradigma değişimi yaratıyor. Otonom AI agentlarının nasıl kod yazıp, PR oluşturup, özellikleri teslim ettiğini öğrenin.',
    date: '2026-04-04',
    readTime: '8 dk okuma',
    content: `
## Agentic AI Nedir? Otonom Yazılım Geliştirmenin Geleceği

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'que-es-ia-agente': {
    title: '¿Qué es la IA Agéntica? El Futuro del Desarrollo Autónomo',
    description: 'La IA agéntica representa un cambio de paradigma. Aprende cómo los agentes IA autónomos escriben código y crean PRs.',
    date: '2026-04-04',
    readTime: '8 min lectura',
    content: `
## ¿Qué es la IA Agéntica? El Futuro del Desarrollo Autónomo

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'was-ist-agentische-ki': {
    title: 'Was ist Agentische KI? Die Zukunft der autonomen Softwareentwicklung',
    description: 'Agentische KI stellt einen Paradigmenwechsel dar. Erfahren Sie, wie autonome KI-Agenten Code schreiben und PRs erstellen.',
    date: '2026-04-04',
    readTime: '8 Min. Lesezeit',
    content: `
## Was ist Agentische KI? Die Zukunft der autonomen Softwareentwicklung

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'shenme-shi-zhineng-daili-ai': {
    title: '什么是智能代理AI？自主软件开发的未来',
    description: '智能代理AI正在改变软件开发的范式。了解自主AI代理如何编写代码并创建拉取请求。',
    date: '2026-04-04',
    readTime: '8 分钟阅读',
    content: `
## 什么是智能代理AI？自主软件开发的未来

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'cosa-e-ia-agentica': {
    title: 'Cos\'è l\'IA Agentica? Il Futuro dello Sviluppo Software Autonomo',
    description: 'L\'IA agentica rappresenta un cambio di paradigma. Scopri come gli agenti IA autonomi scrivono codice e creano PR.',
    date: '2026-04-04',
    readTime: '8 min di lettura',
    content: `
## Cos'è l'IA Agentica? Il Futuro dello Sviluppo Software Autonomo

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'ejentikku-ai-toha': {
    title: 'エージェンティックAIとは？自律型ソフトウェア開発の未来',
    description: 'エージェンティックAIはソフトウェア開発のパラダイムシフトです。自律型AIエージェントの仕組みを学びましょう。',
    date: '2026-04-04',
    readTime: '8 分で読める',
    content: `
## エージェンティックAIとは？自律型ソフトウェア開発の未来

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'pixel-agent-teknolojisi': {
    title: 'Pixel Agent Teknolojisi: AGENA AI İş Akışlarını Nasıl Görselleştiriyor',
    description: 'Pixel agent teknolojisinin AGENA\'nın görsel orkestrasyon katmanını nasıl güçlendirdiğini keşfedin.',
    date: '2026-04-04',
    readTime: '6 dk okuma',
    content: `
## Pixel Agent Teknolojisi: AGENA AI İş Akışlarını Nasıl Görselleştiriyor

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'tecnologia-pixel-agent': {
    title: 'Tecnología Pixel Agent: Cómo AGENA Orquesta Flujos de IA Visualmente',
    description: 'Descubre cómo la tecnología pixel agent impulsa la orquestación visual de AGENA.',
    date: '2026-04-04',
    readTime: '6 min lectura',
    content: `
## Tecnología Pixel Agent: Cómo AGENA Orquesta Flujos de IA Visualmente

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'pixel-agent-technologie': {
    title: 'Pixel-Agent-Technologie: Wie AGENA KI-Workflows visuell orchestriert',
    description: 'Entdecken Sie die Pixel-Agent-Technologie für visuelle KI-Orchestrierung.',
    date: '2026-04-04',
    readTime: '6 Min. Lesezeit',
    content: `
## Pixel-Agent-Technologie: Wie AGENA KI-Workflows visuell orchestriert

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'xiangsu-daili-jishu': {
    title: '像素代理技术：AGENA如何可视化编排AI工作流',
    description: '了解像素代理技术如何为AGENA的可视化编排层提供动力。',
    date: '2026-04-04',
    readTime: '6 分钟阅读',
    content: `
## 像素代理技术：AGENA如何可视化编排AI工作流

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'tecnologia-pixel-agent-it': {
    title: 'Tecnologia Pixel Agent: Come AGENA Orchestra i Flussi IA Visivamente',
    description: 'Scopri come la tecnologia pixel agent alimenta l\'orchestrazione visiva di AGENA.',
    date: '2026-04-04',
    readTime: '6 min di lettura',
    content: `
## Tecnologia Pixel Agent: Come AGENA Orchestra i Flussi IA Visivamente

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'pikueru-ejento-gijutsu': {
    title: 'ピクセルエージェント技術：AGENAがAIワークフローを視覚的に管理する方法',
    description: 'ピクセルエージェント技術がAGENAの視覚的オーケストレーション層をどう強化するかを学びましょう。',
    date: '2026-04-04',
    readTime: '6 分で読める',
    content: `
## ピクセルエージェント技術：AGENAがAIワークフローを視覚的に管理する方法

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'ai-kod-uretimi-en-iyi-pratikler': {
    title: 'AI Kod Üretimi En İyi Pratikler: Backlog\'dan PR\'a Dakikalar İçinde',
    description: 'Agentic AI ile üretim kalitesinde kod üretimi için en iyi pratikler.',
    date: '2026-04-04',
    readTime: '10 dk okuma',
    content: `
## AI Kod Üretimi En İyi Pratikler: Backlog'dan PR'a Dakikalar İçinde

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'mejores-practicas-generacion-codigo-ia': {
    title: 'Mejores Prácticas de Generación de Código con IA',
    description: 'Cómo aprovechar la IA agéntica para generación de código de producción.',
    date: '2026-04-04',
    readTime: '10 min lectura',
    content: `
## Mejores Prácticas de Generación de Código con IA

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'ki-codegenerierung-best-practices': {
    title: 'KI-Codegenerierung Best Practices: Vom Backlog zum PR in Minuten',
    description: 'Best Practices für produktionsreife Codegenerierung mit AGENA.',
    date: '2026-04-04',
    readTime: '10 Min. Lesezeit',
    content: `
## KI-Codegenerierung Best Practices: Vom Backlog zum PR in Minuten

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'ai-daima-shengcheng-zuijia-shijian': {
    title: 'AI代码生成最佳实践：从待办事项到PR只需几分钟',
    description: '利用智能代理AI进行生产级代码生成的最佳实践。',
    date: '2026-04-04',
    readTime: '10 分钟阅读',
    content: `
## AI代码生成最佳实践：从待办事项到PR只需几分钟

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'generazione-codice-ia-best-practice': {
    title: 'Generazione Codice IA Best Practice: Dal Backlog alla PR in Minuti',
    description: 'Come sfruttare l\'IA agentica per la generazione di codice di produzione.',
    date: '2026-04-04',
    readTime: '10 min di lettura',
    content: `
## Generazione Codice IA Best Practice: Dal Backlog alla PR in Minuti

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'ai-koodo-seisei-besuto-purakutisu': {
    title: 'AIコード生成ベストプラクティス：バックログからPRまで数分で',
    description: 'エージェンティックAIを活用した本番グレードのコード生成のベストプラクティス。',
    date: '2026-04-04',
    readTime: '10 分で読める',
    content: `
## AIコード生成ベストプラクティス：バックログからPRまで数分で

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-orkestrasyon': {
    title: 'CrewAI ve LangGraph ile Çoklu Agent Pipeline\'ları Oluşturma',
    description: 'AGENA\'nın CrewAI ve LangGraph\'ı birleştirerek güvenilir AI pipeline\'ları oluşturmasına bakış.',
    date: '2026-04-04',
    readTime: '12 dk okuma',
    content: `
## CrewAI ve LangGraph ile Çoklu Agent Pipeline'ları Oluşturma

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-orquestacion': {
    title: 'Construyendo Pipelines Multi-Agente con CrewAI y LangGraph',
    description: 'Cómo AGENA combina CrewAI con LangGraph para pipelines de agentes confiables.',
    date: '2026-04-04',
    readTime: '12 min lectura',
    content: `
## Construyendo Pipelines Multi-Agente con CrewAI y LangGraph

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-orchestrierung': {
    title: 'Multi-Agent-Pipelines mit CrewAI und LangGraph erstellen',
    description: 'Wie AGENA CrewAI und LangGraph für zuverlässige KI-Pipelines kombiniert.',
    date: '2026-04-04',
    readTime: '12 Min. Lesezeit',
    content: `
## Multi-Agent-Pipelines mit CrewAI und LangGraph erstellen

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-bianpai': {
    title: '使用CrewAI和LangGraph构建多代理管道',
    description: 'AGENA如何将CrewAI与LangGraph结合创建可靠的AI管道。',
    date: '2026-04-04',
    readTime: '12 分钟阅读',
    content: `
## 使用CrewAI和LangGraph构建多代理管道

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-orchestrazione': {
    title: 'Costruire Pipeline Multi-Agente con CrewAI e LangGraph',
    description: 'Come AGENA combina CrewAI con LangGraph per pipeline affidabili.',
    date: '2026-04-04',
    readTime: '12 min di lettura',
    content: `
## Costruire Pipeline Multi-Agente con CrewAI e LangGraph

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'crewai-langgraph-okesutoreeshon': {
    title: 'CrewAIとLangGraphでマルチエージェントパイプラインを構築',
    description: 'AGENAがCrewAIとLangGraphを組み合わせて信頼性の高いAIパイプラインを構築する方法。',
    date: '2026-04-04',
    readTime: '12 分で読める',
    content: `
## CrewAIとLangGraphでマルチエージェントパイプラインを構築

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'coklu-kiracili-ai-saas-mimarisi': {
    title: 'Çoklu Kiracılı AI SaaS Tasarımı: AGENA\'yı İnşa Etmekten Dersler',
    description: 'Üretim hazır çoklu kiracılı AI agent platformu oluşturmanın mimari kararları.',
    date: '2026-04-04',
    readTime: '9 dk okuma',
    content: `
## Çoklu Kiracılı AI SaaS Tasarımı: AGENA'yı İnşa Etmekten Dersler

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'arquitectura-saas-ia-multiinquilino': {
    title: 'Diseñando un SaaS IA Multi-Tenant: Lecciones de AGENA',
    description: 'Decisiones arquitectónicas para una plataforma multi-tenant de agentes IA.',
    date: '2026-04-04',
    readTime: '9 min lectura',
    content: `
## Diseñando un SaaS IA Multi-Tenant: Lecciones de AGENA

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'multi-tenant-ki-saas-architektur': {
    title: 'Multi-Tenant KI-SaaS entwerfen: Lehren aus AGENA',
    description: 'Architekturentscheidungen für eine Multi-Tenant KI-Agent-Plattform.',
    date: '2026-04-04',
    readTime: '9 Min. Lesezeit',
    content: `
## Multi-Tenant KI-SaaS entwerfen: Lehren aus AGENA

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'duozuhu-ai-saas-jiagou': {
    title: '设计多租户AI SaaS：构建AGENA的经验教训',
    description: '构建多租户AI代理平台的架构决策。',
    date: '2026-04-04',
    readTime: '9 分钟阅读',
    content: `
## 设计多租户AI SaaS：构建AGENA的经验教训

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'architettura-saas-ia-multi-tenant': {
    title: 'Progettare un SaaS IA Multi-Tenant: Lezioni da AGENA',
    description: 'Decisioni architetturali per una piattaforma multi-tenant di agenti IA.',
    date: '2026-04-04',
    readTime: '9 min di lettura',
    content: `
## Progettare un SaaS IA Multi-Tenant: Lezioni da AGENA

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'maruchi-tenanto-ai-saas-aakitekucha': {
    title: 'マルチテナントAI SaaSの設計：AGENAの構築から学んだ教訓',
    description: 'マルチテナントAIエージェントプラットフォーム構築のアーキテクチャ決定。',
    date: '2026-04-04',
    readTime: '9 分で読める',
    content: `
## マルチテナントAI SaaSの設計：AGENAの構築から学んだ教訓

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'github-copilot-alternatifi': {
    title: 'AGENA vs GitHub Copilot: Tam Otonomi için Agentic AI Alternatifi',
    description: 'AGENA ile GitHub Copilot karşılaştırması. Copilot satır satır önerirken AGENA tam PR üretir.',
    date: '2026-04-04',
    readTime: '8 dk okuma',
    content: `
## AGENA vs GitHub Copilot: Tam Otonomi için Agentic AI Alternatifi

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'alternativa-github-copilot': {
    title: 'AGENA vs GitHub Copilot: La Alternativa de IA Agéntica',
    description: 'Compara AGENA con GitHub Copilot. AGENA genera PRs completas autónomamente.',
    date: '2026-04-04',
    readTime: '8 min lectura',
    content: `
## AGENA vs GitHub Copilot: La Alternativa de IA Agéntica

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'github-copilot-alternative-de': {
    title: 'AGENA vs GitHub Copilot: Die agentische KI-Alternative',
    description: 'AGENA vs Copilot. AGENA generiert autonom vollständige PRs.',
    date: '2026-04-04',
    readTime: '8 Min. Lesezeit',
    content: `
## AGENA vs GitHub Copilot: Die agentische KI-Alternative

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'github-copilot-tidai': {
    title: 'AGENA vs GitHub Copilot：智能代理AI替代方案',
    description: 'AGENA与Copilot对比。AGENA自主生成完整PR。',
    date: '2026-04-04',
    readTime: '8 分钟阅读',
    content: `
## AGENA vs GitHub Copilot：智能代理AI替代方案

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'alternativa-github-copilot-it': {
    title: 'AGENA vs GitHub Copilot: L\'Alternativa IA Agentica',
    description: 'Confronta AGENA con Copilot. AGENA genera PR complete autonomamente.',
    date: '2026-04-04',
    readTime: '8 min di lettura',
    content: `
## AGENA vs GitHub Copilot: L'Alternativa IA Agentica

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },
  'github-copilot-daitai': {
    title: 'AGENA vs GitHub Copilot：エージェンティックAI代替',
    description: 'AGENAとCopilotを比較。AGENAは完全なPRを自律生成します。',
    date: '2026-04-04',
    readTime: '8 分で読める',
    content: `
## AGENA vs GitHub Copilot：エージェンティックAI代替

This article covers the key concepts. Visit [Documentation](/docs) and [Use Cases](/use-cases) to learn more.
    `,
  },};

export function generateStaticParams() {
  return Object.keys(posts).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = posts[params.slug];
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${params.slug}` },
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
    image: 'https://agena.dev/og-image.png',
    author: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' },
    publisher: {
      '@type': 'Organization',
      name: 'AGENA',
      url: 'https://agena.dev',
      logo: { '@type': 'ImageObject', url: 'https://agena.dev/media/agena-logo.svg' },
    },
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

      <ReadingProgress />

      <div className='blog-post-layout' style={{ maxWidth: 1060, margin: '0 auto', padding: '80px 24px', display: 'flex', gap: 48 }}>
        <article style={{ flex: 1, minWidth: 0 }}>
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
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: 'var(--ink-35)', fontSize: 14, flexWrap: 'wrap' }}>
              <time>{post.date}</time>
              <span>{post.readTime}</span>
              <ShareButtons title={post.title} slug={params.slug} />
            </div>
          </header>

          <div
            className='blog-content'
            style={{ color: 'var(--ink-72)', fontSize: 16, lineHeight: 1.8 }}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(post.content) }}
          />

          {/* Share again at bottom */}
          <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--panel-border-2)' }}>
            <ShareButtons title={post.title} slug={params.slug} />
          </div>

          <div style={{ marginTop: 40, padding: '32px', borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', textAlign: 'center' }}>
            <h3 style={{ color: 'var(--ink-90)', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
              Ready to try agentic AI?
            </h3>
            <p style={{ color: 'var(--ink-45)', marginBottom: 20, fontSize: 15 }}>
              Start free and let AGENA&apos;s pixel agents handle your development workflow.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href='/signup' className='button button-primary' style={{ fontSize: 15, padding: '12px 28px' }}>
                Start Free →
              </Link>
              <Link href='/docs' className='button button-outline' style={{ fontSize: 14, padding: '12px 24px' }}>
                Docs
              </Link>
              <Link href='/use-cases' className='button button-outline' style={{ fontSize: 14, padding: '12px 24px' }}>
                Use Cases
              </Link>
            </div>
          </div>
        </article>

        {/* Table of Contents sidebar */}
        <aside className='blog-toc-sidebar' style={{ width: 200, flexShrink: 0 }}>
          <BlogTableOfContents />
        </aside>
      </div>
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
