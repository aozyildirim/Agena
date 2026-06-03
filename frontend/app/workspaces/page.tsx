import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { pickLang, LANGS, type Lang } from '@/lib/landingI18n';

const URL = 'https://agena.dev/workspaces';

const KEYWORDS = [
  'AI workspace big team',
  'multi-tenant workspace SaaS',
  'team workspace AI agent',
  'invite-code workspace',
  'role-based AI workspace',
  'developer team workspace',
  'workspace permissions per title',
];

type Copy = {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1A: string;
  h1B: string;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
  visualLabel: string;
  visualSubtitle: string;
  flowTitle: string;
  flowSteps: { title: string; desc: string }[];
  featuresTitle: string;
  features: { icon: string; title: string; body: string }[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  footerH2: string;
  footerCta: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    metaTitle: 'Workspaces for Big Teams — Multi-Squad AI Agent Platform | AGENA',
    metaDescription: 'AGENA Workspaces split a single AI-agent platform into per-squad scopes — invite collaborators with a 6-character code, give each role a custom title, and keep tasks / repos / AI runs cleanly separated. Ideal for engineering orgs running 5+ teams off one platform.',
    eyebrow: 'Workspaces',
    h1A: 'One platform.',
    h1B: 'A workspace per squad.',
    subtitle: 'Big engineering orgs don’t run on a single shared task pool. AGENA Workspaces split your org into per-squad scopes — Backend, Frontend, Mobile, Payments — each with its own tasks, repos, members, AI agents and run history. Invite-code joins, role-based titles, audit trail.',
    ctaPrimary: 'Start free',
    ctaSecondary: 'See pricing →',
    visualLabel: 'Workspace switcher · live in /dashboard',
    visualSubtitle: 'Click the switcher in the sidebar to swap context. Settings page lets workspace owners manage members, titles and the 6-character invite code.',
    flowTitle: 'How it works',
    flowSteps: [
      { title: 'Sign up — your default workspace is auto-created', desc: 'New orgs land on a guided onboarding step that lets you pick: continue with the default, create another (Backend, Mobile, Payments), or join an existing workspace via an invite code from a teammate.' },
      { title: 'Invite teammates with a 6-character code', desc: 'Every workspace owns a unique short code (no ambiguous chars like 0/O/1/I). Share it in Slack or email — recipients paste it during signup or in /dashboard/workspaces and join instantly.' },
      { title: 'Assign per-workspace titles', desc: 'Same person, different title per squad: "Senior Developer" in Backend, "Reviewer" in Payments. Titles surface on tasks and reviews; they’re free-text so non-engineering teams can use whatever your HR system uses.' },
      { title: 'Tasks + repos scope down automatically', desc: 'When you import a Jira sprint, Sentry error, or Azure DevOps work item into Workspace X, that task lives there. Members of Workspace Y don’t see it; org owners still get the cross-workspace dashboard.' },
      { title: 'Audit + rotate codes when people leave', desc: 'Codes are persistent until rotated. One click on /dashboard/workspaces regenerates the code; old code stops working immediately. Member removals and joins are tracked.' },
    ],
    featuresTitle: 'Why workspaces beat one big shared org',
    features: [
      { icon: '🗄', title: 'Per-squad isolation', body: 'Backend can’t accidentally pick up Mobile’s tasks. Each workspace has its own task pool, repos, AI agents, prompts.' },
      { icon: '🎫', title: '6-char invite codes', body: 'No magic links to manage; no Okta SCIM provisioning required. Just a short code that drops a new joiner straight into the right scope.' },
      { icon: '🏷', title: 'Per-workspace titles', body: 'Same human, different role per squad. Show real titles ("Tech Lead" / "QA") on tasks and reviews — no synthetic Jira-only labels.' },
      { icon: '🛂', title: 'Org-owner overview', body: 'Founders / VPs of Eng keep the cross-workspace dashboard view. Squad members only see their squad. Single billing seat.' },
      { icon: '⚡', title: 'Migration-safe', body: 'Existing customers got a default workspace auto-seeded; their entire history backfilled. Zero data movement, zero downtime.' },
      { icon: '🌐', title: 'Localized (7 languages)', body: 'Onboarding and switcher render in tr / en / es / de / zh / it / ja from the same URL — non-English squads aren’t second-class.' },
    ],
    faqTitle: 'FAQ',
    faq: [
      { q: 'Do existing organizations need to do anything?', a: 'No. The migration auto-creates one default workspace per existing org and backfills every task, repo and member to it. Existing users see no change in behavior — they just get the new switcher in the sidebar with a single workspace inside.' },
      { q: 'Can I be in multiple workspaces?', a: 'Yes — and even in workspaces from different organizations if you’ve been invited. The switcher lets you flip between them; tasks, repos and AI run history follow your active workspace.' },
      { q: 'How does the 6-character invite code work?', a: 'Each workspace owns one. Share it (Slack, email, in person) and the recipient pastes it during signup or in /dashboard/workspaces. We avoid ambiguous characters (0/O/1/I) so no one mistypes it.' },
      { q: 'What happens if a teammate leaves?', a: 'Workspace owners can remove them with one click; the underlying user account stays. If you’re worried about the invite code being public, click "Regenerate code" — the old one stops working immediately.' },
      { q: 'How do permissions per title work?', a: 'Org-level permissions (owner / admin / member / viewer) still apply. The "title" field is a per-workspace free-text label that surfaces on tasks, reviews and the team page — useful for HR labels ("Senior Backend Developer", "QA Lead") that the existing role enum doesn’t carry.' },
    ],
    footerH2: 'Big team, one platform — start free',
    footerCta: 'Sign up',
  },
  tr: {
    metaTitle: 'Büyük Takımlar için Workspace’ler — Çoklu Squad AI Ajan Platformu | AGENA',
    metaDescription: 'AGENA Workspace’leri tek bir AI-ajan platformunu squad bazlı kapsamlara böler — 6 haneli kod ile davet et, her role özel ünvan ver, görev / repo / AI run’larını temiz ayrı tut. 5+ ekibi tek platformdan yöneten engineering organizasyonları için.',
    eyebrow: 'Workspace’ler',
    h1A: 'Tek platform.',
    h1B: 'Her squad için bir workspace.',
    subtitle: 'Büyük engineering organizasyonları tek bir paylaşılan görev havuzu üzerinden çalışmaz. AGENA Workspace’leri organizasyonunu squad bazlı kapsamlara böler — Backend, Frontend, Mobile, Payments — her birinin kendi görevleri, repo’ları, üyeleri, AI ajanları ve run geçmişi olur. Davet kodlu katılım, role-bazlı ünvanlar, denetim günlüğü.',
    ctaPrimary: 'Ücretsiz başla',
    ctaSecondary: 'Fiyatlandırmaya bak →',
    visualLabel: 'Workspace switcher · /dashboard içinde canlı',
    visualSubtitle: 'Sol bardaki switcher ile bağlamı değiştir. Workspace owner üyeleri, ünvanları ve 6 haneli daveti kodunu yönetir.',
    flowTitle: 'Nasıl çalışır',
    flowSteps: [
      { title: 'Üye ol — default workspace’in otomatik oluşur', desc: 'Yeni orglar onboarding’in ilk adımında üç seçenek görür: default ile devam et, yenisini oluştur (Backend, Mobile, Payments), ya da takım arkadaşının davet koduyla mevcut bir workspace’e katıl.' },
      { title: '6 haneli kod ile davet et', desc: 'Her workspace tekil bir kısa koda sahip (0/O/1/I gibi karışık karakterler yok). Slack veya mailde paylaş — alıcı signup’ta veya /dashboard/workspaces’de yapıştırıp anında katılır.' },
      { title: 'Workspace bazında ünvan ata', desc: 'Aynı kişi farklı squad’larda farklı ünvana sahip olabilir: Backend’de “Senior Developer”, Payments’ta “Reviewer”. Ünvanlar görevlerde ve review’larda görünür; serbest metin — engineering dışı ekipler kendi HR ünvanlarını kullanabilir.' },
      { title: 'Görev + repo otomatik kapsamlanır', desc: 'Bir Jira sprint, Sentry hatası ya da Azure DevOps work item Workspace X’e import edildiğinde, o görev orada yaşar. Workspace Y üyeleri görmez; org owner cross-workspace dashboard’u görür.' },
      { title: 'Üye ayrılırsa kodu rotate et', desc: 'Kodlar siz değiştirene kadar geçerli. /dashboard/workspaces’de tek tıkla yeniden üretilir; eski kod anında geçersiz olur. Üye eklemeleri ve çıkarmaları izlenir.' },
    ],
    featuresTitle: 'Workspace’ler tek büyük org\'dan neden iyi',
    features: [
      { icon: '🗄', title: 'Squad bazlı izolasyon', body: 'Backend yanlışlıkla Mobile’ın görevini almaz. Her workspace’in kendi görev havuzu, repo’ları, AI ajanları, prompt’ları var.' },
      { icon: '🎫', title: '6 haneli davet kodu', body: 'Yönetilmesi gereken magic link yok; Okta SCIM provisioning gerekmiyor. Yeni katılan kişiyi doğru kapsama düşüren kısa bir kod.' },
      { icon: '🏷', title: 'Workspace başına ünvan', body: 'Aynı kişi her squad’da farklı role sahip. Görevlerde ve review’larda gerçek ünvanları göster — sentetik Jira label’ları değil.' },
      { icon: '🛂', title: 'Org owner görünürlüğü', body: 'Founder / VP of Eng cross-workspace dashboard’unu görür. Squad üyeleri sadece kendi squad’ını görür. Tek faturalama koltuğu.' },
      { icon: '⚡', title: 'Migration güvenli', body: 'Mevcut müşterilere otomatik default workspace seed edildi; tüm geçmiş backfill oldu. Sıfır veri taşıma, sıfır kesinti.' },
      { icon: '🌐', title: '7 dil yerelleştirilmiş', body: 'Onboarding ve switcher tr / en / es / de / zh / it / ja’da aynı URL’den render edilir — İngilizce olmayan squad’lar ikinci sınıf değil.' },
    ],
    faqTitle: 'SSS',
    faq: [
      { q: 'Mevcut organizasyonların bir şey yapması gerekir mi?', a: 'Hayır. Migration her mevcut org için 1 default workspace yaratır ve tüm görevleri / repo’ları / üyeleri ona backfill eder. Mevcut kullanıcılar davranış değişikliği görmez — sadece sidebar’a yeni switcher eklenir.' },
      { q: 'Birden fazla workspace’de olabilir miyim?', a: 'Evet — davet edilmişsen farklı organizasyonlardaki workspace’lerde bile. Switcher arasında geçiş yapmana izin verir; görevler, repo’lar ve AI run geçmişi aktif workspace’i takip eder.' },
      { q: '6 haneli davet kodu nasıl çalışır?', a: 'Her workspace’in birer tane var. Paylaş (Slack, mail, yüz yüze) — alıcı signup veya /dashboard/workspaces’de yapıştırır. Karışık karakterler (0/O/1/I) elenmiş, kimse yanlış yazmaz.' },
      { q: 'Bir takım arkadaşı ayrılırsa ne olur?', a: 'Workspace owner tek tıkla çıkarır; user account kalır. Davet kodunun sızdığını düşünüyorsan “Kodu yenile” butonuyla yenisini üret — eski kod anında geçersiz olur.' },
      { q: 'Ünvana göre yetki nasıl çalışıyor?', a: 'Org seviyesi yetki (owner / admin / member / viewer) hâlâ geçerli. “Title” alanı görevlerde, review’larda ve team sayfasında görünen workspace bazlı serbest metin — mevcut role enum’unun taşımadığı HR etiketleri için (“Senior Backend Developer”, “QA Lead”).' },
    ],
    footerH2: 'Büyük ekip, tek platform — ücretsiz başla',
    footerCta: 'Üye ol',
  },
  es: {
    metaTitle: 'Áreas de trabajo para equipos grandes | AGENA',
    metaDescription: 'Las áreas de trabajo de AGENA dividen una sola plataforma de agentes IA en ámbitos por escuadrón — invita con un código de 6 caracteres, asigna títulos por rol y mantén tareas / repos / runs separados.',
    eyebrow: 'Áreas de trabajo',
    h1A: 'Una plataforma.',
    h1B: 'Un área por escuadrón.',
    subtitle: 'Las orgs de ingeniería grandes no funcionan con un único pool compartido de tareas. Las áreas de AGENA dividen tu org en ámbitos por escuadrón — Backend, Frontend, Mobile, Payments — cada uno con sus tareas, repos, miembros, agentes IA e historial.',
    ctaPrimary: 'Empieza gratis',
    ctaSecondary: 'Ver precios →',
    visualLabel: 'Selector de área · en /dashboard',
    visualSubtitle: 'Cambia de contexto desde la barra lateral. La página de configuración permite gestionar miembros, títulos y el código de 6 caracteres.',
    flowTitle: 'Cómo funciona',
    flowSteps: [
      { title: 'Regístrate — tu área por defecto se crea automáticamente', desc: 'El primer paso del onboarding ofrece: continuar con la predeterminada, crear otra (Backend, Mobile, Payments), o unirte a una existente con código de invitación.' },
      { title: 'Invita con un código de 6 caracteres', desc: 'Cada área tiene un código corto único (sin caracteres ambiguos como 0/O/1/I). Compártelo en Slack o email; el destinatario lo pega al registrarse o en /dashboard/workspaces.' },
      { title: 'Asigna títulos por área', desc: 'La misma persona puede tener distinto título por escuadrón: "Senior Developer" en Backend, "Reviewer" en Payments.' },
      { title: 'Tareas y repos se acotan solos', desc: 'Importas un sprint de Jira, error de Sentry o work item de Azure a un área X y la tarea vive ahí. Los miembros del área Y no la ven.' },
      { title: 'Audita y rota códigos cuando alguien se va', desc: 'Un clic en /dashboard/workspaces regenera el código; el viejo deja de funcionar al instante.' },
    ],
    featuresTitle: 'Por qué funciona',
    features: [
      { icon: '🗄', title: 'Aislamiento por escuadrón', body: 'Backend no toca tareas de Mobile. Cada área tiene su pool, repos, agentes y prompts.' },
      { icon: '🎫', title: 'Códigos de 6 caracteres', body: 'Sin magic links que mantener; sin Okta SCIM. Solo un código corto.' },
      { icon: '🏷', title: 'Títulos por área', body: 'Misma persona, distinto rol por escuadrón.' },
      { icon: '🛂', title: 'Visión de owner', body: 'Founders / VPs ven el dashboard cross-area. Una sola facturación.' },
      { icon: '⚡', title: 'Migración segura', body: 'Clientes existentes recibieron un área predeterminada; toda su historia se rellenó. Cero downtime.' },
      { icon: '🌐', title: '7 idiomas', body: 'Onboarding y selector renderizan en tr / en / es / de / zh / it / ja desde la misma URL.' },
    ],
    faqTitle: 'Preguntas frecuentes',
    faq: [
      { q: '¿Las orgs existentes deben hacer algo?', a: 'No. Cada org existente recibió un área predeterminada y todo se rellenó automáticamente.' },
      { q: '¿Puedo estar en varias áreas?', a: 'Sí — incluso de organizaciones distintas. El selector permite cambiar.' },
      { q: '¿Cómo funciona el código de invitación?', a: 'Cada área tiene uno. Lo compartes y el destinatario lo pega en signup o /dashboard/workspaces.' },
      { q: '¿Y si alguien se va?', a: 'El owner lo elimina con un clic; o regenera el código si se ha filtrado.' },
      { q: '¿Cómo funcionan los permisos por título?', a: 'Los permisos org-level siguen vigentes. El "título" es texto libre por área que aparece en tareas y reviews.' },
    ],
    footerH2: 'Equipo grande, una plataforma — gratis',
    footerCta: 'Regístrate',
  },
  de: {
    metaTitle: 'Arbeitsbereiche für große Teams | AGENA',
    metaDescription: 'AGENA Arbeitsbereiche teilen eine einzige KI-Agent-Plattform in squad-spezifische Scopes — Einladung per 6-stelligem Code, rollenbasierte Titel, saubere Trennung von Tasks / Repos / KI-Runs.',
    eyebrow: 'Arbeitsbereiche',
    h1A: 'Eine Plattform.',
    h1B: 'Pro Squad ein Bereich.',
    subtitle: 'Große Engineering-Orgs arbeiten nicht aus einem geteilten Aufgabenpool. AGENA Bereiche teilen deine Org in Squad-Scopes — Backend, Frontend, Mobile, Payments — mit eigenen Tasks, Repos, Mitgliedern, KI-Agenten und Run-Verlauf.',
    ctaPrimary: 'Kostenlos starten',
    ctaSecondary: 'Preise →',
    visualLabel: 'Bereichsauswahl · live in /dashboard',
    visualSubtitle: 'Wechsle den Kontext über die Seitenleiste. Die Settings-Seite verwaltet Mitglieder, Titel und den 6-stelligen Einladungscode.',
    flowTitle: 'So funktioniert\'s',
    flowSteps: [
      { title: 'Registrieren — Standardbereich wird automatisch erstellt', desc: 'Das erste Onboarding-Step bietet: Standard nutzen, weiteren erstellen (Backend, Mobile, Payments), oder per Einladungscode beitreten.' },
      { title: 'Einladung per 6-stelligem Code', desc: 'Jeder Bereich hat einen eindeutigen Kurzcode (keine ambivalenten Zeichen wie 0/O/1/I). Slack/E-Mail teilen; der Empfänger fügt ihn beim Signup ein.' },
      { title: 'Bereichsspezifische Titel', desc: 'Selbe Person, unterschiedlicher Titel pro Squad: "Senior Developer" in Backend, "Reviewer" in Payments.' },
      { title: 'Tasks + Repos werden automatisch eingegrenzt', desc: 'Ein in Bereich X importierter Jira-Sprint lebt nur dort. Mitglieder von Bereich Y sehen ihn nicht.' },
      { title: 'Codes rotieren beim Weggang', desc: 'Klick auf /dashboard/workspaces erzeugt einen neuen Code; der alte ist sofort ungültig.' },
    ],
    featuresTitle: 'Warum das funktioniert',
    features: [
      { icon: '🗄', title: 'Squad-Isolation', body: 'Backend stolpert nicht über Mobile-Tasks.' },
      { icon: '🎫', title: '6-stellige Codes', body: 'Keine Magic Links zu verwalten; kein SCIM nötig.' },
      { icon: '🏷', title: 'Titel pro Bereich', body: 'Gleicher Mensch, andere Rolle pro Squad.' },
      { icon: '🛂', title: 'Owner-Übersicht', body: 'Founders / VPs of Eng sehen alle Bereiche.' },
      { icon: '⚡', title: 'Migrationssicher', body: 'Bestandskunden bekamen automatisch einen Standardbereich.' },
      { icon: '🌐', title: '7 Sprachen', body: 'Onboarding + Switcher in tr / en / es / de / zh / it / ja.' },
    ],
    faqTitle: 'FAQ',
    faq: [
      { q: 'Müssen bestehende Orgs etwas tun?', a: 'Nein. Jede Org bekommt automatisch einen Standardbereich.' },
      { q: 'Kann ich in mehreren Bereichen sein?', a: 'Ja — auch in Bereichen verschiedener Organisationen.' },
      { q: 'Wie funktioniert der Einladungscode?', a: 'Jeder Bereich hat einen. Teilen, einfügen, beitreten.' },
      { q: 'Was passiert, wenn jemand geht?', a: 'Der Owner entfernt mit einem Klick; oder rotiert den Code.' },
      { q: 'Wie funktionieren Rechte pro Titel?', a: 'Org-Rechte gelten weiterhin. "Titel" ist Freitext pro Bereich.' },
    ],
    footerH2: 'Großes Team, eine Plattform — kostenlos starten',
    footerCta: 'Registrieren',
  },
  zh: {
    metaTitle: '大型团队的工作区 | AGENA',
    metaDescription: 'AGENA 工作区将单一 AI 代理平台划分为按小组隔离的范围 — 6 位邀请码加入、按角色自定义职位、任务/仓库/AI 运行记录干净分离。',
    eyebrow: '工作区',
    h1A: '一个平台。',
    h1B: '每个小组一个工作区。',
    subtitle: '大型工程组织不依赖单一共享任务池。AGENA 工作区将组织划分为按小组的范围——后端、前端、移动端、支付——各自拥有任务、仓库、成员、AI 代理和运行历史。',
    ctaPrimary: '免费开始',
    ctaSecondary: '查看定价 →',
    visualLabel: '工作区切换器 · /dashboard 中实时显示',
    visualSubtitle: '通过侧边栏切换上下文。设置页面允许工作区所有者管理成员、职位和 6 位邀请码。',
    flowTitle: '工作原理',
    flowSteps: [
      { title: '注册 — 默认工作区自动创建', desc: '入门第一步可以：继续使用默认、创建另一个（后端、移动、支付）或用邀请码加入。' },
      { title: '用 6 位邀请码邀请', desc: '每个工作区拥有唯一短码（无 0/O/1/I 等模糊字符）。在 Slack 或邮件中分享；接收方在注册或 /dashboard/workspaces 中粘贴。' },
      { title: '按工作区分配职位', desc: '同一人不同职位：后端的"Senior Developer"，支付的"Reviewer"。' },
      { title: '任务和仓库自动隔离', desc: '导入到工作区 X 的 Jira sprint 仅在该工作区可见。' },
      { title: '人员离开时轮换码', desc: '在 /dashboard/workspaces 一键重新生成；旧码立即失效。' },
    ],
    featuresTitle: '为什么有效',
    features: [
      { icon: '🗄', title: '小组隔离', body: '后端不会误取移动端任务。每个工作区有独立池。' },
      { icon: '🎫', title: '6 位邀请码', body: '无需管理 magic link；无需 SCIM。' },
      { icon: '🏷', title: '工作区职位', body: '同人不同小组不同角色。' },
      { icon: '🛂', title: '所有者总览', body: '创始人/VP 查看跨工作区。' },
      { icon: '⚡', title: '迁移安全', body: '存量客户自动获得默认工作区。' },
      { icon: '🌐', title: '7 种语言', body: '入门和切换器支持 tr / en / es / de / zh / it / ja。' },
    ],
    faqTitle: '常见问题',
    faq: [
      { q: '现有组织需要做什么吗？', a: '不。每个现有组织自动获得默认工作区。' },
      { q: '我可以在多个工作区吗？', a: '可以 — 甚至跨组织。' },
      { q: '邀请码如何工作？', a: '每个工作区有一个。共享并粘贴。' },
      { q: '人员离开怎么办？', a: '所有者一键移除；或轮换码。' },
      { q: '按职位的权限如何？', a: '组级权限仍有效。"职位"是工作区级自由文本。' },
    ],
    footerH2: '大团队、一个平台 — 免费开始',
    footerCta: '注册',
  },
  it: {
    metaTitle: 'Aree di lavoro per team grandi | AGENA',
    metaDescription: 'Le aree di lavoro AGENA dividono un\'unica piattaforma di agenti AI in ambiti per squad — invita con codice di 6 caratteri, titoli per ruolo, task/repo/AI run separati.',
    eyebrow: 'Aree di lavoro',
    h1A: 'Una piattaforma.',
    h1B: 'Un\'area per squad.',
    subtitle: 'Le grandi org di engineering non funzionano con un unico pool condiviso. Le aree AGENA dividono la tua org in ambiti per squad — Backend, Frontend, Mobile, Payments — ciascuno con propri task, repo, membri, agenti AI e cronologia.',
    ctaPrimary: 'Inizia gratis',
    ctaSecondary: 'Prezzi →',
    visualLabel: 'Selettore area · live in /dashboard',
    visualSubtitle: 'Cambia contesto dalla sidebar. La pagina settings gestisce membri, titoli e codice invito.',
    flowTitle: 'Come funziona',
    flowSteps: [
      { title: 'Registrati — l\'area predefinita è creata automaticamente', desc: 'Primo step onboarding: usa la predefinita, creane un\'altra, o unisciti con codice.' },
      { title: 'Invita con codice di 6 caratteri', desc: 'Ogni area ha un codice unico (no caratteri ambigui).' },
      { title: 'Titoli per area', desc: 'Stessa persona, titolo diverso per squad.' },
      { title: 'Task + repo automaticamente isolati', desc: 'Un task importato in area X vive lì.' },
      { title: 'Ruota i codici al cambio personale', desc: 'Click su rigenera; vecchio codice disattivato.' },
    ],
    featuresTitle: 'Perché funziona',
    features: [
      { icon: '🗄', title: 'Isolamento per squad', body: 'Pool, repo, agenti, prompt indipendenti.' },
      { icon: '🎫', title: 'Codici 6 caratteri', body: 'Nessun magic link da gestire.' },
      { icon: '🏷', title: 'Titoli per area', body: 'Ruolo diverso per squad.' },
      { icon: '🛂', title: 'Vista owner', body: 'Founder / VP vedono tutte le aree.' },
      { icon: '⚡', title: 'Migrazione sicura', body: 'Clienti esistenti hanno area predefinita.' },
      { icon: '🌐', title: '7 lingue', body: 'Onboarding + switcher in 7 lingue.' },
    ],
    faqTitle: 'FAQ',
    faq: [
      { q: 'Le org esistenti devono fare qualcosa?', a: 'No. Ognuna ha ricevuto un\'area predefinita auto-popolata.' },
      { q: 'Posso essere in più aree?', a: 'Sì — anche tra organizzazioni diverse.' },
      { q: 'Come funziona il codice invito?', a: 'Ogni area ne ha uno. Condividi e incolla.' },
      { q: 'Se qualcuno se ne va?', a: 'L\'owner rimuove con un click; o ruota il codice.' },
      { q: 'Permessi per titolo?', a: 'Permessi org rimangono. "Titolo" è testo libero per area.' },
    ],
    footerH2: 'Team grande, una piattaforma — gratis',
    footerCta: 'Registrati',
  },
  ja: {
    metaTitle: '大規模チーム向けワークスペース | AGENA',
    metaDescription: 'AGENAのワークスペースは単一のAIエージェントプラットフォームをスクワッド単位のスコープに分割 — 6文字のコードで招待、役割ごとのタイトル、タスク/リポジトリ/AI実行を清潔に分離。',
    eyebrow: 'ワークスペース',
    h1A: '1つのプラットフォーム。',
    h1B: 'スクワッドごとに1つのワークスペース。',
    subtitle: '大規模エンジニアリング組織は単一の共有タスクプールでは動きません。AGENAワークスペースは組織をスクワッド単位のスコープに分割します — Backend、Frontend、Mobile、Payments — それぞれ独自のタスク、リポジトリ、メンバー、AIエージェント、実行履歴を持ちます。',
    ctaPrimary: '無料で始める',
    ctaSecondary: '料金を見る →',
    visualLabel: 'ワークスペース切替 · /dashboardでライブ',
    visualSubtitle: 'サイドバーから切替。設定ページでメンバー、タイトル、6文字招待コードを管理。',
    flowTitle: '仕組み',
    flowSteps: [
      { title: '登録 — デフォルトワークスペースが自動作成', desc: '最初のオンボーディングステップ: デフォルトを使う、新規作成、または招待コードで参加。' },
      { title: '6文字のコードで招待', desc: '各ワークスペースに固有の短いコード（曖昧な0/O/1/Iなし）。' },
      { title: 'ワークスペースごとのタイトル', desc: '同じ人でもスクワッドごとに異なる役職。' },
      { title: 'タスク+リポジトリは自動的にスコープ化', desc: 'ワークスペースXに取り込んだタスクはそこに存在。' },
      { title: '人事異動時にコード再生成', desc: 'クリックで再生成; 古いコードは即時無効。' },
    ],
    featuresTitle: 'なぜ機能するのか',
    features: [
      { icon: '🗄', title: 'スクワッド分離', body: 'プール、リポジトリ、エージェントが独立。' },
      { icon: '🎫', title: '6文字コード', body: 'マジックリンク管理不要。' },
      { icon: '🏷', title: 'ワークスペースごとのタイトル', body: '同じ人でも役職が違う。' },
      { icon: '🛂', title: 'オーナービュー', body: 'Founder / VPが全ワークスペースを閲覧。' },
      { icon: '⚡', title: '移行安全', body: '既存顧客は自動でデフォルト取得。' },
      { icon: '🌐', title: '7言語', body: 'オンボーディング+スイッチャーが7言語対応。' },
    ],
    faqTitle: 'よくある質問',
    faq: [
      { q: '既存組織は何かする必要ある？', a: 'いいえ。各組織にデフォルトが自動作成。' },
      { q: '複数のワークスペースに所属可能？', a: 'はい — 異なる組織のものでも。' },
      { q: '招待コードの仕組みは？', a: '各ワークスペースに1つ。共有して貼付。' },
      { q: '人が辞めたら？', a: 'オーナーがクリックで削除; またはコード再生成。' },
      { q: 'タイトルごとの権限は？', a: '組織レベル権限は有効。"タイトル"はワークスペースごとの自由テキスト。' },
    ],
    footerH2: '大規模チーム、1つのプラットフォーム — 無料で',
    footerCta: '登録',
  },
};

export async function generateMetadata({ searchParams }: { searchParams: { lang?: string } }): Promise<Metadata> {
  const cookieLang = cookies().get('agena_lang')?.value;
  const lang = pickLang(searchParams?.lang, cookieLang);
  const c = COPY[lang];
  const altLang: Record<string, string> = {};
  for (const l of LANGS) altLang[l] = `${URL}?lang=${l}`;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    keywords: KEYWORDS,
    alternates: { canonical: URL, languages: altLang },
    openGraph: { type: 'article', url: URL, title: c.metaTitle, description: c.metaDescription },
  };
}

export default function WorkspacesLanding({ searchParams }: { searchParams: { lang?: string } }) {
  const cookieLang = cookies().get('agena_lang')?.value;
  const lang = pickLang(searchParams?.lang, cookieLang);
  const c = COPY[lang];
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — Workspaces',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    description: c.metaDescription,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' },
  };
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gap: 48 }}>
      <Script id="ld-app-workspaces" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <Script id="ld-faq-workspaces" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }} />

      <header style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>{c.eyebrow}</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          {c.h1A} <br />
          <span style={{ background: 'linear-gradient(90deg, #7c3aed, #06b6d4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{c.h1B}</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>{c.subtitle}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href="/signup" style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>{c.ctaPrimary}</Link>
          <Link href="/pricing" style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>{c.ctaSecondary}</Link>
        </div>
      </header>

      {/* Visual mockup — CSS rendering of the actual switcher + workspace settings card */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>{c.visualLabel}</div>
        <p style={{ fontSize: 13, color: 'var(--ink-58)', textAlign: 'center', marginBottom: 24, maxWidth: 640, marginInline: 'auto', lineHeight: 1.55 }}>{c.visualSubtitle}</p>

        <div className="ws-mockup-grid" style={{
          background: 'linear-gradient(180deg, rgba(124,58,237,0.04), rgba(6,182,212,0.04))',
          border: '1px solid var(--panel-border)',
          borderRadius: 20,
          padding: 24,
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 260px) 1fr',
          gap: 20,
          minHeight: 360,
        }}>
          {/* Sidebar mockup */}
          <div style={{ background: 'var(--panel)', borderRadius: 14, padding: 16, border: '1px solid var(--panel-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(124,58,237,0.30)', background: 'rgba(124,58,237,0.06)', marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>B</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-30)', fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Workspace</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>Backend Squad</div>
              </div>
              <span style={{ color: 'var(--ink-30)', fontSize: 10 }}>▾</span>
            </div>
            {[
              { icon: '🏠', label: 'Office' },
              { icon: '📋', label: 'Tasks', count: 42 },
              { icon: '🗂', label: 'Sprints' },
              { icon: '🔬', label: 'Refinement' },
              { icon: '🤖', label: 'Agents' },
              { icon: '🗄', label: 'Workspaces', active: true },
            ].map((item) => (
              <div key={item.label} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8, marginBottom: 2,
                background: item.active ? 'rgba(124,58,237,0.10)' : 'transparent',
                color: item.active ? '#7c3aed' : 'var(--ink-58)',
                fontSize: 13, fontWeight: item.active ? 700 : 500,
              }}>
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--panel-border-2)', color: 'var(--ink-30)' }}>{item.count}</span> : null}
              </div>
            ))}
          </div>

          {/* Right: workspace detail mockup */}
          <div style={{ background: 'var(--panel)', borderRadius: 14, padding: 20, border: '1px solid var(--panel-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 20 }}>B</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>Backend Squad</div>
                <div style={{ fontSize: 12, color: 'var(--ink-30)' }}>Server team — 4 services</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
              <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--glass)' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>Invite code</div>
                <code style={{ display: 'inline-block', marginTop: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.30)', color: 'var(--ink-90)', fontWeight: 800, fontSize: 13, letterSpacing: 2 }}>6VL265</code>
              </div>
              <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--glass)' }}>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>Members</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)', marginTop: 4 }}>5</div>
              </div>
            </div>

            {[
              { name: 'Erinc', email: 'erinc@agena.dev', role: 'owner', title: 'Senior Developer', color: '#0d9488' },
              { name: 'Ali Ozyildirim', email: 'ali@agena.dev', role: 'member', title: 'Tech Lead', color: '#7c3aed' },
              { name: 'Burak', email: 'burak@agena.dev', role: 'member', title: 'Backend Dev', color: '#0ea5e9' },
            ].map((m) => (
              <div key={m.email} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--glass)', marginBottom: 6 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: `linear-gradient(135deg, ${m.color}, #a78bfa)`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11 }}>{m.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-90)' }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-30)' }}>{m.email} · {m.role}</div>
                </div>
                <div style={{ fontSize: 10, padding: '3px 7px', borderRadius: 6, background: 'var(--panel-border-2)', color: 'var(--ink-78)', fontWeight: 600 }}>{m.title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.flowTitle}</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {c.flowSteps.map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>{step.title}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 4, lineHeight: 1.55 }}>{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.featuresTitle}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {c.features.map((f) => (
            <div key={f.title} style={{ padding: 16, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.faqTitle}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {c.faq.map((f) => (
            <details key={f.q} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.q}</summary>
              <p style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 8, lineHeight: 1.6 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <RelatedLandings current="/workspaces" />

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>{c.footerH2}</h2>
        <Link href="/signup" style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>{c.footerCta}</Link>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 720px) {
          .ws-mockup-grid { grid-template-columns: 1fr !important; }
        }
      ` }} />
    </main>
  );
}
