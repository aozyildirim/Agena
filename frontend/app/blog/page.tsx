import type { Metadata } from 'next';
import Link from 'next/link';
import NewsletterForm from '@/components/NewsletterForm';
import BlogList from '@/components/BlogList';

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
    lang: 'en',
    title: 'What is Agentic AI? The Future of Autonomous Software Development',
    description:
      'Agentic AI represents a paradigm shift in software development. Learn how autonomous AI agents can write code, review pull requests, and ship features without human intervention.',
    date: '2026-03-28',
    readTime: '8 min read',
    tags: ['Agentic AI', 'AI Agent', 'Autonomous Coding'],
  },
  {
    slug: 'pixel-agent-technology',
    lang: 'en',
    title: 'Pixel Agent Technology: How AGENA Orchestrates AI Workflows Visually',
    description:
      'Discover how pixel agent technology powers AGENA\'s visual orchestration layer, enabling teams to monitor and manage autonomous AI agents in real-time.',
    date: '2026-03-25',
    readTime: '6 min read',
    tags: ['Pixel Agent', 'AI Orchestration', 'Visual Monitoring'],
  },
  {
    slug: 'ai-code-generation-best-practices',
    lang: 'en',
    title: 'AI Code Generation Best Practices: From Backlog to Pull Request in Minutes',
    description:
      'How to leverage agentic AI for production-grade code generation. Best practices for autonomous PR creation, code review, and quality assurance with AI agents.',
    date: '2026-03-20',
    readTime: '10 min read',
    tags: ['Code Generation', 'Pull Request Automation', 'Best Practices'],
  },
  {
    slug: 'crewai-langgraph-orchestration',
    lang: 'en',
    title: 'Building Multi-Agent Pipelines with CrewAI and LangGraph',
    description:
      'A deep dive into how AGENA combines CrewAI role orchestration with LangGraph state machines to create reliable, observable AI agent pipelines for software delivery.',
    date: '2026-03-15',
    readTime: '12 min read',
    tags: ['CrewAI', 'LangGraph', 'Multi-Agent', 'Pipeline'],
  },
  {
    slug: 'multi-tenant-ai-saas-architecture',
    lang: 'en',
    title: 'Designing a Multi-Tenant AI SaaS: Lessons from Building AGENA',
    description:
      'Architecture decisions behind building a production-ready multi-tenant AI agent platform. Organization isolation, usage limits, billing, and security patterns.',
    date: '2026-03-10',
    readTime: '9 min read',
    tags: ['Architecture', 'Multi-Tenant', 'SaaS', 'Security'],
  },
  {
    slug: 'yapay-zeka-ile-kod-yazma',
    lang: 'tr',
    title: 'Yapay Zeka ile Kod Yazma: AGENA ile Otonom Geliştirme Rehberi',
    description:
      'Yapay zeka ile kod yazma artık hayal değil. AGENA\'nın agentic AI platformu ile otonom kod üretimi, PR oluşturma ve kalite kontrolünü öğrenin.',
    date: '2026-03-30',
    readTime: '9 dk okuma',
    tags: ['Yapay Zeka', 'Kod Yazma', 'Otonom Geliştirme'],
  },
  {
    slug: 'ai-agent-nedir',
    lang: 'tr',
    title: 'AI Agent Nedir? Yapay Zeka Agentlarının Yazılım Geliştirmedeki Rolü',
    description:
      'AI agent nedir, nasıl çalışır ve yazılım geliştirmede nasıl kullanılır? Agentic AI kavramını ve AGENA platformunun agent mimarisini keşfedin.',
    date: '2026-03-29',
    readTime: '7 dk okuma',
    tags: ['AI Agent', 'Yapay Zeka', 'Agentic AI'],
  },
  {
    slug: 'ai-ile-pr-otomasyonu',
    lang: 'tr',
    title: 'AI ile Pull Request Otomasyonu: Backlog\'dan PR\'a Dakikalar İçinde',
    description:
      'AI ile otomatik pull request oluşturma nasıl çalışır? AGENA\'nın agentic AI pipeline\'ı ile görev tanımından production-ready PR\'a kadar tüm süreci öğrenin.',
    date: '2026-04-03',
    readTime: '7 dk okuma',
    tags: ['PR Otomasyonu', 'AI', 'DevOps', 'Otomasyon'],
  },
  {
    slug: 'otonom-kodlama-rehberi',
    lang: 'tr',
    title: 'Otonom Kodlama: AI Agentlar ile Yazılım Geliştirmenin Yeni Çağı',
    description:
      'Otonom kodlama nedir ve nasıl çalışır? AI agentların bağımsız olarak kod yazması, review etmesi ve PR açması hakkında kapsamlı rehber.',
    date: '2026-04-02',
    readTime: '10 dk okuma',
    tags: ['Otonom Kodlama', 'AI Agent', 'Yazılım Geliştirme'],
  },
  {
    slug: 'agentic-ai-nedir',
    lang: 'tr',
    title: 'Agentic AI Nedir? Otonom Yapay Zeka Sistemlerinin Geleceği',
    description:
      'Agentic AI nedir, geleneksel yapay zekadan farkı ne? Otonom AI agentların yazılım geliştirme, kod üretimi ve PR otomasyonundaki devrimci rolünü keşfedin.',
    date: '2026-04-01',
    readTime: '8 dk okuma',
    tags: ['Agentic AI', 'Yapay Zeka', 'Otonom Sistemler'],
  },
  {
    slug: 'github-copilot-alternative',
    lang: 'en',
    title: 'AGENA vs GitHub Copilot: The Agentic AI Alternative for Full Autonomy',
    description:
      'Compare AGENA with GitHub Copilot. While Copilot suggests code line by line, AGENA\'s agentic AI agents autonomously generate complete PRs from task descriptions.',
    date: '2026-03-27',
    readTime: '8 min read',
    tags: ['GitHub Copilot', 'Alternative', 'Comparison', 'Agentic AI'],
  },
  {
    slug: 'ia-agentes-autonomos',
    lang: 'es',
    title: 'Agentes IA Autónomos: Cómo Revolucionan el Desarrollo de Software',
    description:
      'Los agentes IA autónomos están transformando la forma en que los equipos desarrollan software. Descubre cómo AGENA automatiza desde el análisis hasta la creación de pull requests.',
    date: '2026-04-03',
    readTime: '8 min lectura',
    tags: ['IA Agéntica', 'Agentes Autónomos', 'Desarrollo de Software'],
  },
  {
    slug: 'automatizacion-pull-requests-ia',
    lang: 'es',
    title: 'Automatización de Pull Requests con IA: De la Idea al Código en Minutos',
    description:
      'Aprende cómo la IA agéntica automatiza la creación de pull requests. AGENA genera código, revisa calidad y abre PRs automáticamente desde descripciones de tareas.',
    date: '2026-04-02',
    readTime: '7 min lectura',
    tags: ['PR Automation', 'IA', 'DevOps', 'Automatización'],
  },
  {
    slug: 'ki-agenten-softwareentwicklung',
    lang: 'de',
    title: 'KI-Agenten in der Softwareentwicklung: Autonome Code-Generierung mit AGENA',
    description:
      'Erfahren Sie, wie KI-Agenten die Softwareentwicklung revolutionieren. AGENA automatisiert den gesamten Prozess von der Aufgabe bis zum Pull Request.',
    date: '2026-04-03',
    readTime: '8 Min. Lesezeit',
    tags: ['KI-Agenten', 'Softwareentwicklung', 'Autonome Codierung'],
  },
  {
    slug: 'automatische-pull-requests-ki',
    lang: 'de',
    title: 'Automatische Pull Requests mit KI: Vom Backlog zum Code in Minuten',
    description:
      'Wie agentische KI die Erstellung von Pull Requests automatisiert. AGENA generiert Code, überprüft Qualität und öffnet PRs automatisch.',
    date: '2026-04-02',
    readTime: '7 Min. Lesezeit',
    tags: ['PR-Automatisierung', 'KI', 'DevOps'],
  },
  {
    slug: 'zhineng-daili-ai-ruanjian-kaifa',
    lang: 'zh',
    title: '智能代理AI：自主软件开发的未来',
    description:
      '了解智能代理AI如何革命性地改变软件开发。AGENA的自主AI代理可以自动编写代码、审查质量并创建拉取请求。',
    date: '2026-04-03',
    readTime: '8 分钟阅读',
    tags: ['智能代理AI', '自主编码', '软件开发'],
  },
  {
    slug: 'ai-zidong-pull-request',
    lang: 'zh',
    title: 'AI自动化Pull Request：从需求到代码只需几分钟',
    description:
      '了解智能代理AI如何自动化拉取请求的创建。AGENA从任务描述自动生成代码、审查质量并创建PR。',
    date: '2026-04-02',
    readTime: '7 分钟阅读',
    tags: ['PR自动化', 'AI', 'DevOps'],
  },
  {
    slug: 'ai-agent-jisedai-kaihatsu',
    lang: 'ja',
    title: 'AIエージェントによる次世代ソフトウェア開発',
    description:
      'AIエージェントがソフトウェア開発をどのように革新するか。AGENAの自律型AIエージェントはコード生成からプルリクエスト作成まで自動化します。',
    date: '2026-04-03',
    readTime: '8 分で読める',
    tags: ['AIエージェント', '自律型開発', 'ソフトウェア開発'],
  },
  {
    slug: 'jidou-pull-request-ai',
    lang: 'ja',
    title: 'AIによるPull Request自動化：バックログからコードまで数分で',
    description:
      'エージェンティックAIがプルリクエストの作成をどのように自動化するか。AGENAはタスク説明からコード生成、品質レビュー、PR作成まで自動で行います。',
    date: '2026-04-02',
    readTime: '7 分で読める',
    tags: ['PR自動化', 'AI', 'DevOps'],
  },
  {
    slug: 'agenti-ia-sviluppo-software',
    lang: 'it',
    title: 'Agenti IA nello Sviluppo Software: Generazione Autonoma di Codice con AGENA',
    description:
      'Scopri come gli agenti IA stanno rivoluzionando lo sviluppo software. AGENA automatizza l\'intero processo dall\'analisi alla creazione di pull request.',
    date: '2026-04-03',
    readTime: '8 min di lettura',
    tags: ['IA Agentica', 'Sviluppo Software', 'Codifica Autonoma'],
  },
  {
    slug: 'automazione-pull-request-ia',
    lang: 'it',
    title: 'Automazione Pull Request con IA: Dall\'Idea al Codice in Minuti',
    description:
      'Come l\'IA agentica automatizza la creazione di pull request. AGENA genera codice, rivede la qualità e apre PR automaticamente.',
    date: '2026-04-02',
    readTime: '7 min di lettura',
    tags: ['Automazione PR', 'IA', 'DevOps'],
  },
  {
    slug: 'agentic-ai-nedir-rehber',
    lang: 'tr',
    title: 'Agentic AI Nedir? Otonom Yazılım Geliştirmenin Geleceği',
    description: 'Agentic AI, yazılım geliştirmede paradigma değişimi yaratıyor. Otonom AI agentlarının nasıl kod yazıp, PR oluşturup, özellikleri teslim ettiğini öğrenin.',
    date: '2026-04-04',
    readTime: '8 dk okuma',
    tags: ["Agentic AI", "AI Agent", "Otonom Kodlama"],
  },
  {
    slug: 'que-es-ia-agente',
    lang: 'es',
    title: '¿Qué es la IA Agéntica? El Futuro del Desarrollo Autónomo',
    description: 'La IA agéntica representa un cambio de paradigma. Aprende cómo los agentes IA autónomos escriben código y crean PRs.',
    date: '2026-04-04',
    readTime: '8 min lectura',
    tags: ["IA Agéntica", "Agente IA", "Codificación Autónoma"],
  },
  {
    slug: 'was-ist-agentische-ki',
    lang: 'de',
    title: 'Was ist Agentische KI? Die Zukunft der autonomen Softwareentwicklung',
    description: 'Agentische KI stellt einen Paradigmenwechsel dar. Erfahren Sie, wie autonome KI-Agenten Code schreiben und PRs erstellen.',
    date: '2026-04-04',
    readTime: '8 Min. Lesezeit',
    tags: ["Agentische KI", "KI-Agent", "Autonome Codierung"],
  },
  {
    slug: 'shenme-shi-zhineng-daili-ai',
    lang: 'zh',
    title: '什么是智能代理AI？自主软件开发的未来',
    description: '智能代理AI正在改变软件开发的范式。了解自主AI代理如何编写代码并创建拉取请求。',
    date: '2026-04-04',
    readTime: '8 分钟阅读',
    tags: ["智能代理AI", "AI代理", "自主编码"],
  },
  {
    slug: 'cosa-e-ia-agentica',
    lang: 'it',
    title: 'Cos\'è l\'IA Agentica? Il Futuro dello Sviluppo Software Autonomo',
    description: 'L\'IA agentica rappresenta un cambio di paradigma. Scopri come gli agenti IA autonomi scrivono codice e creano PR.',
    date: '2026-04-04',
    readTime: '8 min di lettura',
    tags: ["IA Agentica", "Agente IA", "Codifica Autonoma"],
  },
  {
    slug: 'ejentikku-ai-toha',
    lang: 'ja',
    title: 'エージェンティックAIとは？自律型ソフトウェア開発の未来',
    description: 'エージェンティックAIはソフトウェア開発のパラダイムシフトです。自律型AIエージェントの仕組みを学びましょう。',
    date: '2026-04-04',
    readTime: '8 分で読める',
    tags: ["エージェンティックAI", "AIエージェント", "自律型コーディング"],
  },
  {
    slug: 'pixel-agent-teknolojisi',
    lang: 'tr',
    title: 'Pixel Agent Teknolojisi: AGENA AI İş Akışlarını Nasıl Görselleştiriyor',
    description: 'Pixel agent teknolojisinin AGENA\'nın görsel orkestrasyon katmanını nasıl güçlendirdiğini keşfedin.',
    date: '2026-04-04',
    readTime: '6 dk okuma',
    tags: ["Pixel Agent", "AI Orkestrasyon", "Görsel İzleme"],
  },
  {
    slug: 'tecnologia-pixel-agent',
    lang: 'es',
    title: 'Tecnología Pixel Agent: Cómo AGENA Orquesta Flujos de IA Visualmente',
    description: 'Descubre cómo la tecnología pixel agent impulsa la orquestación visual de AGENA.',
    date: '2026-04-04',
    readTime: '6 min lectura',
    tags: ["Pixel Agent", "Orquestación IA", "Monitoreo Visual"],
  },
  {
    slug: 'pixel-agent-technologie',
    lang: 'de',
    title: 'Pixel-Agent-Technologie: Wie AGENA KI-Workflows visuell orchestriert',
    description: 'Entdecken Sie die Pixel-Agent-Technologie für visuelle KI-Orchestrierung.',
    date: '2026-04-04',
    readTime: '6 Min. Lesezeit',
    tags: ["Pixel Agent", "KI-Orchestrierung", "Visuelles Monitoring"],
  },
  {
    slug: 'xiangsu-daili-jishu',
    lang: 'zh',
    title: '像素代理技术：AGENA如何可视化编排AI工作流',
    description: '了解像素代理技术如何为AGENA的可视化编排层提供动力。',
    date: '2026-04-04',
    readTime: '6 分钟阅读',
    tags: ["像素代理", "AI编排", "可视化监控"],
  },
  {
    slug: 'tecnologia-pixel-agent-it',
    lang: 'it',
    title: 'Tecnologia Pixel Agent: Come AGENA Orchestra i Flussi IA Visivamente',
    description: 'Scopri come la tecnologia pixel agent alimenta l\'orchestrazione visiva di AGENA.',
    date: '2026-04-04',
    readTime: '6 min di lettura',
    tags: ["Pixel Agent", "Orchestrazione IA", "Monitoraggio Visivo"],
  },
  {
    slug: 'pikueru-ejento-gijutsu',
    lang: 'ja',
    title: 'ピクセルエージェント技術：AGENAがAIワークフローを視覚的に管理する方法',
    description: 'ピクセルエージェント技術がAGENAの視覚的オーケストレーション層をどう強化するかを学びましょう。',
    date: '2026-04-04',
    readTime: '6 分で読める',
    tags: ["ピクセルエージェント", "AIオーケストレーション", "ビジュアルモニタリング"],
  },
  {
    slug: 'ai-kod-uretimi-en-iyi-pratikler',
    lang: 'tr',
    title: 'AI Kod Üretimi En İyi Pratikler: Backlog\'dan PR\'a Dakikalar İçinde',
    description: 'Agentic AI ile üretim kalitesinde kod üretimi için en iyi pratikler.',
    date: '2026-04-04',
    readTime: '10 dk okuma',
    tags: ["Kod Üretimi", "PR Otomasyonu", "En İyi Pratikler"],
  },
  {
    slug: 'mejores-practicas-generacion-codigo-ia',
    lang: 'es',
    title: 'Mejores Prácticas de Generación de Código con IA',
    description: 'Cómo aprovechar la IA agéntica para generación de código de producción.',
    date: '2026-04-04',
    readTime: '10 min lectura',
    tags: ["Generación de Código", "Automatización PR", "Mejores Prácticas"],
  },
  {
    slug: 'ki-codegenerierung-best-practices',
    lang: 'de',
    title: 'KI-Codegenerierung Best Practices: Vom Backlog zum PR in Minuten',
    description: 'Best Practices für produktionsreife Codegenerierung mit AGENA.',
    date: '2026-04-04',
    readTime: '10 Min. Lesezeit',
    tags: ["Codegenerierung", "PR-Automatisierung", "Best Practices"],
  },
  {
    slug: 'ai-daima-shengcheng-zuijia-shijian',
    lang: 'zh',
    title: 'AI代码生成最佳实践：从待办事项到PR只需几分钟',
    description: '利用智能代理AI进行生产级代码生成的最佳实践。',
    date: '2026-04-04',
    readTime: '10 分钟阅读',
    tags: ["代码生成", "PR自动化", "最佳实践"],
  },
  {
    slug: 'generazione-codice-ia-best-practice',
    lang: 'it',
    title: 'Generazione Codice IA Best Practice: Dal Backlog alla PR in Minuti',
    description: 'Come sfruttare l\'IA agentica per la generazione di codice di produzione.',
    date: '2026-04-04',
    readTime: '10 min di lettura',
    tags: ["Generazione Codice", "Automazione PR", "Best Practice"],
  },
  {
    slug: 'ai-koodo-seisei-besuto-purakutisu',
    lang: 'ja',
    title: 'AIコード生成ベストプラクティス：バックログからPRまで数分で',
    description: 'エージェンティックAIを活用した本番グレードのコード生成のベストプラクティス。',
    date: '2026-04-04',
    readTime: '10 分で読める',
    tags: ["コード生成", "PR自動化", "ベストプラクティス"],
  },
  {
    slug: 'crewai-langgraph-orkestrasyon',
    lang: 'tr',
    title: 'CrewAI ve LangGraph ile Çoklu Agent Pipeline\'ları Oluşturma',
    description: 'AGENA\'nın CrewAI ve LangGraph\'ı birleştirerek güvenilir AI pipeline\'ları oluşturmasına bakış.',
    date: '2026-04-04',
    readTime: '12 dk okuma',
    tags: ["CrewAI", "LangGraph", "Çoklu Agent", "Pipeline"],
  },
  {
    slug: 'crewai-langgraph-orquestacion',
    lang: 'es',
    title: 'Construyendo Pipelines Multi-Agente con CrewAI y LangGraph',
    description: 'Cómo AGENA combina CrewAI con LangGraph para pipelines de agentes confiables.',
    date: '2026-04-04',
    readTime: '12 min lectura',
    tags: ["CrewAI", "LangGraph", "Multi-Agente", "Pipeline"],
  },
  {
    slug: 'crewai-langgraph-orchestrierung',
    lang: 'de',
    title: 'Multi-Agent-Pipelines mit CrewAI und LangGraph erstellen',
    description: 'Wie AGENA CrewAI und LangGraph für zuverlässige KI-Pipelines kombiniert.',
    date: '2026-04-04',
    readTime: '12 Min. Lesezeit',
    tags: ["CrewAI", "LangGraph", "Multi-Agent", "Pipeline"],
  },
  {
    slug: 'crewai-langgraph-bianpai',
    lang: 'zh',
    title: '使用CrewAI和LangGraph构建多代理管道',
    description: 'AGENA如何将CrewAI与LangGraph结合创建可靠的AI管道。',
    date: '2026-04-04',
    readTime: '12 分钟阅读',
    tags: ["CrewAI", "LangGraph", "多代理", "管道"],
  },
  {
    slug: 'crewai-langgraph-orchestrazione',
    lang: 'it',
    title: 'Costruire Pipeline Multi-Agente con CrewAI e LangGraph',
    description: 'Come AGENA combina CrewAI con LangGraph per pipeline affidabili.',
    date: '2026-04-04',
    readTime: '12 min di lettura',
    tags: ["CrewAI", "LangGraph", "Multi-Agente", "Pipeline"],
  },
  {
    slug: 'crewai-langgraph-okesutoreeshon',
    lang: 'ja',
    title: 'CrewAIとLangGraphでマルチエージェントパイプラインを構築',
    description: 'AGENAがCrewAIとLangGraphを組み合わせて信頼性の高いAIパイプラインを構築する方法。',
    date: '2026-04-04',
    readTime: '12 分で読める',
    tags: ["CrewAI", "LangGraph", "マルチエージェント", "パイプライン"],
  },
  {
    slug: 'coklu-kiracili-ai-saas-mimarisi',
    lang: 'tr',
    title: 'Çoklu Kiracılı AI SaaS Tasarımı: AGENA\'yı İnşa Etmekten Dersler',
    description: 'Üretim hazır çoklu kiracılı AI agent platformu oluşturmanın mimari kararları.',
    date: '2026-04-04',
    readTime: '9 dk okuma',
    tags: ["Mimari", "Çoklu Kiracı", "SaaS", "Güvenlik"],
  },
  {
    slug: 'arquitectura-saas-ia-multiinquilino',
    lang: 'es',
    title: 'Diseñando un SaaS IA Multi-Tenant: Lecciones de AGENA',
    description: 'Decisiones arquitectónicas para una plataforma multi-tenant de agentes IA.',
    date: '2026-04-04',
    readTime: '9 min lectura',
    tags: ["Arquitectura", "Multi-Tenant", "SaaS", "Seguridad"],
  },
  {
    slug: 'multi-tenant-ki-saas-architektur',
    lang: 'de',
    title: 'Multi-Tenant KI-SaaS entwerfen: Lehren aus AGENA',
    description: 'Architekturentscheidungen für eine Multi-Tenant KI-Agent-Plattform.',
    date: '2026-04-04',
    readTime: '9 Min. Lesezeit',
    tags: ["Architektur", "Multi-Tenant", "SaaS", "Sicherheit"],
  },
  {
    slug: 'duozuhu-ai-saas-jiagou',
    lang: 'zh',
    title: '设计多租户AI SaaS：构建AGENA的经验教训',
    description: '构建多租户AI代理平台的架构决策。',
    date: '2026-04-04',
    readTime: '9 分钟阅读',
    tags: ["架构", "多租户", "SaaS", "安全"],
  },
  {
    slug: 'architettura-saas-ia-multi-tenant',
    lang: 'it',
    title: 'Progettare un SaaS IA Multi-Tenant: Lezioni da AGENA',
    description: 'Decisioni architetturali per una piattaforma multi-tenant di agenti IA.',
    date: '2026-04-04',
    readTime: '9 min di lettura',
    tags: ["Architettura", "Multi-Tenant", "SaaS", "Sicurezza"],
  },
  {
    slug: 'maruchi-tenanto-ai-saas-aakitekucha',
    lang: 'ja',
    title: 'マルチテナントAI SaaSの設計：AGENAの構築から学んだ教訓',
    description: 'マルチテナントAIエージェントプラットフォーム構築のアーキテクチャ決定。',
    date: '2026-04-04',
    readTime: '9 分で読める',
    tags: ["アーキテクチャ", "マルチテナント", "SaaS", "セキュリティ"],
  },
  {
    slug: 'github-copilot-alternatifi',
    lang: 'tr',
    title: 'AGENA vs GitHub Copilot: Tam Otonomi için Agentic AI Alternatifi',
    description: 'AGENA ile GitHub Copilot karşılaştırması. Copilot satır satır önerirken AGENA tam PR üretir.',
    date: '2026-04-04',
    readTime: '8 dk okuma',
    tags: ["GitHub Copilot", "Alternatif", "Karşılaştırma"],
  },
  {
    slug: 'alternativa-github-copilot',
    lang: 'es',
    title: 'AGENA vs GitHub Copilot: La Alternativa de IA Agéntica',
    description: 'Compara AGENA con GitHub Copilot. AGENA genera PRs completas autónomamente.',
    date: '2026-04-04',
    readTime: '8 min lectura',
    tags: ["GitHub Copilot", "Alternativa", "Comparación"],
  },
  {
    slug: 'github-copilot-alternative-de',
    lang: 'de',
    title: 'AGENA vs GitHub Copilot: Die agentische KI-Alternative',
    description: 'AGENA vs Copilot. AGENA generiert autonom vollständige PRs.',
    date: '2026-04-04',
    readTime: '8 Min. Lesezeit',
    tags: ["GitHub Copilot", "Alternative", "Vergleich"],
  },
  {
    slug: 'github-copilot-tidai',
    lang: 'zh',
    title: 'AGENA vs GitHub Copilot：智能代理AI替代方案',
    description: 'AGENA与Copilot对比。AGENA自主生成完整PR。',
    date: '2026-04-04',
    readTime: '8 分钟阅读',
    tags: ["GitHub Copilot", "替代方案", "对比"],
  },
  {
    slug: 'alternativa-github-copilot-it',
    lang: 'it',
    title: 'AGENA vs GitHub Copilot: L\'Alternativa IA Agentica',
    description: 'Confronta AGENA con Copilot. AGENA genera PR complete autonomamente.',
    date: '2026-04-04',
    readTime: '8 min di lettura',
    tags: ["GitHub Copilot", "Alternativa", "Confronto"],
  },
  {
    slug: 'github-copilot-daitai',
    lang: 'ja',
    title: 'AGENA vs GitHub Copilot：エージェンティックAI代替',
    description: 'AGENAとCopilotを比較。AGENAは完全なPRを自律生成します。',
    date: '2026-04-04',
    readTime: '8 分で読める',
    tags: ["GitHub Copilot", "代替", "比較"],
  },];

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

        <BlogList posts={posts} />

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
