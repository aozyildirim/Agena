'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { apiFetch, cachedApiFetch, loadPrefs, loadPromptCatalog } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Provider = 'azure' | 'jira';
type AgentProvider = 'openai' | 'gemini' | 'hal' | 'codex_cli' | 'claude_cli';

type Opt = {
  id: string;
  name: string;
  path?: string;
  state?: string;
  timeframe?: string | null;
  is_current?: boolean;
};

type ModelOption = { id: string; label: string };

type ExternalTask = {
  id: string;
  title: string;
  description?: string;
  source: string;
  web_url?: string | null;
  state?: string | null;
  assigned_to?: string | null;
  story_points?: number | null;
  effort?: number | null;
  work_item_type?: string | null;
  refined_before?: boolean;
  refinement_count?: number;
  last_refined_at?: string | null;
};

type RefinementItemsResponse = {
  provider: Provider;
  sprint_name: string;
  sprint_ref: string;
  items: ExternalTask[];
  unestimated_count: number;
  pointed_count: number;
};

type SimilarPastItem = {
  external_id: string;
  title: string;
  story_points: number;
  assigned_to: string;
  url: string;
  source: string;
  score: number;
  tier?: 'strong' | 'related' | 'weak';
  branches?: string[];
  pr_titles?: string[];
  pr_count?: number;
  commit_count?: number;
};

type RefinementSuggestion = {
  item_id: string;
  title: string;
  item_url?: string | null;
  current_story_points?: number | null;
  suggested_story_points: number;
  estimation_rationale: string;
  confidence: number;
  summary: string;
  comment: string;
  ambiguities: string[];
  questions: string[];
  ready_for_planning: boolean;
  fallback_applied?: boolean;
  fallback_note?: string;
  error?: string | null;
  similar_items?: SimilarPastItem[];
  touched_files?: { file: string; action?: string; reason?: string; repo_mapping_id?: number | null; repo_mapping_name?: string }[];
  recommended_authors?: {
    name: string;
    email?: string;
    commit_count?: number;
    files_touched?: number;
    reason?: string;
    member_id?: string;
    member_display_name?: string;
    member_unique_name?: string;
    member_source?: string;
  }[];
};

type RefinementAnalyzeResponse = {
  provider: Provider;
  sprint_name: string;
  sprint_ref: string;
  language: string;
  agent_provider: string;
  agent_model: string;
  analyzed_count: number;
  skipped_count: number;
  total_items: number;
  total_tokens: number;
  estimated_cost_usd: number;
  results: RefinementSuggestion[];
};

type RefinementWritebackResponse = {
  provider: Provider;
  total: number;
  success_count: number;
  failure_count: number;
  results: Array<{ item_id: string; success: boolean; message: string }>;
};

type RunMessage = {
  kind: 'success' | 'warning' | 'error';
  text: string;
};

type Copy = {
  section: string;
  title: string;
  subtitle: string;
  source: string;
  project: string;
  team: string;
  board: string;
  sprint: string;
  language: string;
  agentProvider: string;
  agentModel: string;
  repoMapping: string;
  repoMappingNone: string;
  limit: string;
  loadItems: string;
  analyze: string;
  loadingItems: string;
  analyzing: string;
  noItems: string;
  noResults: string;
  resultOverview: string;
  total: string;
  unestimated: string;
  pointed: string;
  selected: string;
  estimate: string;
  suggestedEstimate: string;
  currentEstimate: string;
  state: string;
  type: string;
  select: string;
  summary: string;
  rationale: string;
  comment: string;
  ambiguities: string;
  questions: string;
  confidence: string;
  ready: string;
  notReady: string;
  tokens: string;
  cost: string;
  skipped: string;
  chooseProject: string;
  chooseTeam: string;
  chooseBoard: string;
  chooseSprint: string;
  selectionHint: string;
  successRun: string;
  partialRun: string;
  failedRun: string;
  openResults: string;
  close: string;
  resultsTitle: string;
  writeback: string;
  writebackRunning: string;
  writebackSelected: string;
  signature: string;
  openSource: string;
  result: string;
  openResult: string;
  writeShort: string;
  confirmAzure: string;
  confirmJira: string;
  promptConfig: string;
  useCustomPrompt: string;
  promptPreview: string;
  editInStudio: string;
  writtenBack: string;
  writtenBackAzure: string;
  writtenBackJira: string;
  writeToProvider: string;
  copyComment: string;
  copied: string;
  lowConfidence: string;
  collapse: string;
  expand: string;
  pts: string;
  writeConfirm: string;
  alreadyWritten: string;
  bulkSkipped: string;
  analyzingProgress: string;
  overlayWait: string;
};

const COPY: Record<'tr' | 'en', Copy> = {
  tr: {
    section: 'Refinement',
    title: 'Sprint Refinement',
    subtitle: 'Gelecek sprintteki puansiz backlog maddelerini sec, istedigin dilde yorumlat ve story point onerisi uret.',
    source: 'Kaynak',
    project: 'Proje',
    team: 'Takim',
    board: 'Board',
    sprint: 'Sprint',
    language: 'Cikti dili',
    agentProvider: 'Agent provider',
    agentModel: 'Agent model',
    repoMapping: 'Repo (kod analizi icin, opsiyonel)',
    repoMappingNone: '— Kod analizi yok —',
    limit: 'Maks item',
    loadItems: 'Itemlari Yukle',
    analyze: 'Refinement Calistir',
    loadingItems: 'Itemlar yukleniyor...',
    analyzing: 'Refinement calisiyor...',
    noItems: 'Secili sprint icin item bulunamadi.',
    noResults: 'Henuz refinement sonucu yok.',
    resultOverview: 'Sonuc Ozeti',
    total: 'Toplam',
    unestimated: 'Puansiz',
    pointed: 'Puanli',
    selected: 'Secili',
    estimate: 'Tahmin',
    suggestedEstimate: 'Onerilen Puan',
    currentEstimate: 'Mevcut Puan',
    state: 'Durum',
    type: 'Tip',
    select: 'Sec',
    summary: 'Is Yorumu',
    rationale: 'Puan Gerekcesi',
    comment: 'Hazir Yorum',
    ambiguities: 'Belirsizlikler',
    questions: 'Sorular',
    confidence: 'Guven',
    ready: 'Planlamaya hazir',
    notReady: 'Netlestirme gerekli',
    tokens: 'Token',
    cost: 'Tahmini maliyet',
    skipped: 'Atlanan',
    chooseProject: 'Proje sec',
    chooseTeam: 'Takim sec',
    chooseBoard: 'Board sec',
    chooseSprint: 'Sprint sec',
    selectionHint: 'Sadece puansiz itemlar secilebilir. Varsayilan olarak ilk puansiz itemlar secilir.',
    successRun: 'Refinement basarili tamamlandi.',
    partialRun: 'Refinement kismi tamamlandi. Bazi itemlarda hata var.',
    failedRun: 'Refinement basarisiz oldu.',
    openResults: 'Sonuclari Ac',
    close: 'Kapat',
    resultsTitle: 'Refinement Sonuclari',
    writeback: 'Yaz (Azure/Jira)',
    writebackRunning: 'Yaziliyor...',
    writebackSelected: 'Secilenleri Yaz',
    signature: 'Yorum imzasi',
    openSource: 'Kaynagi Ac',
    result: 'Sonuc',
    openResult: 'Sonucu Ac',
    writeShort: 'Yaz',
    confirmAzure: 'Azure itemina yorum/puan yazilsin mi?',
    confirmJira: 'Jira issueya yorum/puan yazilsin mi?',
    promptConfig: 'Prompt Yapilandirmasi',
    useCustomPrompt: 'Ozel prompt kullan',
    promptPreview: 'Sistem prompt onizlemesi',
    editInStudio: 'Prompt Studio\'da Duzenle →',
    writtenBack: 'Yazildi',
    writtenBackAzure: 'Azure\'a yazildi',
    writtenBackJira: 'Jira\'ya yazildi',
    writeToProvider: 'Yaz',
    copyComment: 'Kopyala',
    copied: 'Kopyalandi',
    lowConfidence: 'Dusuk Guven',
    collapse: 'Kapat',
    expand: 'Detay',
    pts: 'puan',
    writeConfirm: 'Yorum ve puani yaz',
    alreadyWritten: 'Zaten yazildi',
    bulkSkipped: 'Atlanan (zaten yazilmis)',
    analyzingProgress: '{done} / {total} analiz ediliyor...',
    overlayWait: 'Lutfen bekleyin',
  },
  en: {
    section: 'Refinement',
    title: 'Sprint Refinement',
    subtitle: 'Pick unestimated backlog items from a sprint, generate comments in your target language, and get a story point recommendation.',
    source: 'Source',
    project: 'Project',
    team: 'Team',
    board: 'Board',
    sprint: 'Sprint',
    language: 'Output language',
    agentProvider: 'Agent provider',
    agentModel: 'Agent model',
    repoMapping: 'Repo (for code analysis, optional)',
    repoMappingNone: '— No code analysis —',
    limit: 'Max items',
    loadItems: 'Load Items',
    analyze: 'Run Refinement',
    loadingItems: 'Loading items...',
    analyzing: 'Running refinement...',
    noItems: 'No items found for the selected sprint.',
    noResults: 'No refinement results yet.',
    resultOverview: 'Result Overview',
    total: 'Total',
    unestimated: 'Unestimated',
    pointed: 'Pointed',
    selected: 'Selected',
    estimate: 'Estimate',
    suggestedEstimate: 'Suggested Points',
    currentEstimate: 'Current Points',
    state: 'State',
    type: 'Type',
    select: 'Select',
    summary: 'Item Interpretation',
    rationale: 'Estimate Rationale',
    comment: 'Ready Comment',
    ambiguities: 'Ambiguities',
    questions: 'Questions',
    confidence: 'Confidence',
    ready: 'Ready for planning',
    notReady: 'Needs clarification',
    tokens: 'Tokens',
    cost: 'Estimated cost',
    skipped: 'Skipped',
    chooseProject: 'Select project',
    chooseTeam: 'Select team',
    chooseBoard: 'Select board',
    chooseSprint: 'Select sprint',
    selectionHint: 'Only unestimated items can be selected. The first unestimated items are selected by default.',
    successRun: 'Refinement completed successfully.',
    partialRun: 'Refinement completed partially. Some items failed.',
    failedRun: 'Refinement failed.',
    openResults: 'Open Results',
    close: 'Close',
    resultsTitle: 'Refinement Results',
    writeback: 'Write Back',
    writebackRunning: 'Writing...',
    writebackSelected: 'Write Selected',
    signature: 'Comment signature',
    openSource: 'Open Source',
    result: 'Result',
    openResult: 'Open Result',
    writeShort: 'Write',
    confirmAzure: 'Write comment/points to Azure item?',
    confirmJira: 'Write comment/points to Jira issue?',
    promptConfig: 'Prompt Configuration',
    useCustomPrompt: 'Use custom prompt',
    promptPreview: 'System prompt preview',
    editInStudio: 'Edit in Prompt Studio →',
    writtenBack: 'Written',
    writtenBackAzure: 'Written to Azure',
    writtenBackJira: 'Written to Jira',
    writeToProvider: 'Write',
    copyComment: 'Copy',
    copied: 'Copied',
    lowConfidence: 'Low Confidence',
    collapse: 'Collapse',
    expand: 'Details',
    pts: 'pts',
    writeConfirm: 'Write comment & points',
    alreadyWritten: 'Already written',
    bulkSkipped: 'Skipped (already written)',
    analyzingProgress: 'Analyzing {done} / {total}...',
    overlayWait: 'Please wait',
  },
};

const OPENAI_MODELS: ModelOption[] = [
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4-mini' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
];

const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

const CODEX_CLI_MODELS: ModelOption[] = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'o4-mini', label: 'o4-mini' },
  { id: 'o3', label: 'o3' },
];

const CLAUDE_CLI_MODELS: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
];

function modelsForProvider(provider: AgentProvider): ModelOption[] {
  if (provider === 'gemini') return GEMINI_MODELS;
  if (provider === 'codex_cli') return CODEX_CLI_MODELS;
  if (provider === 'claude_cli') return CLAUDE_CLI_MODELS;
  if (provider === 'hal') return [];
  return OPENAI_MODELS;
}

function hasEstimate(item: ExternalTask): boolean {
  return (item.story_points ?? 0) > 0 || (item.effort ?? 0) > 0;
}

function displayEstimate(item: ExternalTask): string {
  const value = (item.story_points ?? 0) > 0 ? item.story_points : item.effort;
  if (value === null || value === undefined || value <= 0) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function displaySuggestionEstimate(value: number | null | undefined, options?: { allowZero?: boolean }): string {
  if (value === null || value === undefined) return '-';
  if (value < 0) return '-';
  if (value === 0 && !options?.allowZero) return '-';
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1);
}

function defaultSprint(list: Opt[], provider: Provider): string {
  if (!list.length) return '';
  if (provider === 'jira') {
    return (
      list.find((item) => (item.state || '').toLowerCase() === 'active')?.id
      || list.find((item) => (item.state || '').toLowerCase() === 'future')?.id
      || list[0].id
    );
  }
  return (
    list.find((item) => item.is_current || (item.timeframe || '').toLowerCase() === 'current')?.path
    || list.find((item) => (item.timeframe || '').toLowerCase() === 'future')?.path
    || list[0].path
    || list[0].name
  );
}

function buildSnapshotKey(provider: Provider, sprintRef: string): string {
  const clean = (sprintRef || 'unknown').replace(/\s+/g, '_');
  return `agena_refinement_snapshot_${provider}_${clean}`;
}

// Survives page reloads: lets us re-attach polling to a refinement job
// the user kicked off on a previous mount of this page.
const ACTIVE_JOB_KEY = 'agena_refinement_active_job';
type StoredActiveJob = { jobId: number; isSingle: boolean; savedAt: number };

type RefinementJobStatus = {
  job_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  provider: string | null;
  sprint_ref: string | null;
  item_count: number;
  item_ids: string[];
  result: RefinementAnalyzeResponse | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export default function RefinementPage() {
  const { lang, t } = useLocale();
  const copy = lang === 'tr' ? COPY.tr : COPY.en;

  const [provider, setProvider] = useState<Provider>('azure');
  const [agentProvider, setAgentProvider] = useState<AgentProvider>('openai');
  const [agentModel, setAgentModel] = useState('gpt-5.1-codex-mini');
  const [language, setLanguage] = useState('Turkish');
  const [maxItems, setMaxItems] = useState(8);
  // Optional: when set, refinement asks the LLM for `file_changes` and
  // resolves git authorship against this repo's checkout. Empty string
  // = code-aware analysis off.
  const [repoMappings, setRepoMappings] = useState<{ id: number; display_name: string; provider: string; owner: string; repo_name: string }[]>([]);
  const [repoMappingId, setRepoMappingId] = useState<string>('');
  const [runModalAdvanced, setRunModalAdvanced] = useState(false);

  const [azureProjects, setAzureProjects] = useState<Opt[]>([]);
  const [azureTeams, setAzureTeams] = useState<Opt[]>([]);
  const [azureSprints, setAzureSprints] = useState<Opt[]>([]);
  const [azureProject, setAzureProject] = useState('');
  const [azureTeam, setAzureTeam] = useState('');
  const [azureSprint, setAzureSprint] = useState('');

  const [jiraProjects, setJiraProjects] = useState<Opt[]>([]);
  const [jiraBoards, setJiraBoards] = useState<Opt[]>([]);
  const [jiraSprints, setJiraSprints] = useState<Opt[]>([]);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraBoard, setJiraBoard] = useState('');
  const [jiraSprint, setJiraSprint] = useState('');

  const [itemsData, setItemsData] = useState<RefinementItemsResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<RefinementAnalyzeResponse | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  // Inline file-history pane: keyed by `${item_id}::${file}`. Stores
  // either the loaded commit list, an error message, or a 'loading'
  // marker. Click toggles the pane open and lazy-loads on first open.
  type BlameCommit = { sha: string; date: string; author_name: string; author_email: string; subject: string };
  type BlameState = { commits?: BlameCommit[]; error?: string; loading?: boolean };
  const [blameByKey, setBlameByKey] = useState<Record<string, BlameState>>({});
  async function toggleBlame(key: string, repo_mapping_id: number, path: string) {
    setBlameByKey((prev) => {
      const cur = prev[key];
      if (cur && (cur.commits || cur.error)) {
        // Already loaded — close it.
        const copy = { ...prev }; delete copy[key]; return copy;
      }
      return { ...prev, [key]: { loading: true } };
    });
    try {
      const data = await apiFetch<{ commits: BlameCommit[] }>(
        `/refinement/file-history?repo_mapping_id=${repo_mapping_id}&path=${encodeURIComponent(path)}&limit=8`,
      );
      setBlameByKey((prev) => ({ ...prev, [key]: { commits: data.commits || [] } }));
    } catch (err) {
      setBlameByKey((prev) => ({ ...prev, [key]: { error: err instanceof Error ? err.message : 'load failed' } }));
    }
  }
  const [runMessage, setRunMessage] = useState<RunMessage | null>(null);
  const [autoFocusResults, setAutoFocusResults] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [writebackItemId, setWritebackItemId] = useState('');
  const [confirmWritebackItemId, setConfirmWritebackItemId] = useState('');
  const [confirmBulkWriteback, setConfirmBulkWriteback] = useState(false);
  const [writtenBackIds, setWrittenBackIds] = useState<Set<string>>(new Set());
  const [expandedItemId, setExpandedItemId] = useState('');
  const [copiedCommentId, setCopiedCommentId] = useState('');
  const [bulkWritebackRunning, setBulkWritebackRunning] = useState(false);
  const [commentSignature, setCommentSignature] = useState('AGENA AI');
  const [focusedResultId, setFocusedResultId] = useState('');
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [overlayTotal, setOverlayTotal] = useState(0);
  const [backfillJob, setBackfillJob] = useState<{
    status: 'idle' | 'queued' | 'fetching' | 'indexing' | 'completed' | 'failed';
    message?: string;
    indexed?: number;
    skipped_no_sp?: number;
    total?: number;
    processed?: number;
    capped?: boolean;
    error?: string;
  } | null>(null);
  type IndexPreview = {
    enabled: boolean;
    total: number;
    sp_distribution: { sp: number; count: number }[];
    top_assignees: { name: string; count: number }[];
    work_item_types: { type: string; count: number }[];
    samples: { external_id: string; title: string; story_points: number; assigned_to: string; url: string; work_item_type: string }[];
  };
  const [indexPreview, setIndexPreview] = useState<IndexPreview | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  const [defaultPromptText, setDefaultPromptText] = useState('');
  const availableModels = useMemo(() => modelsForProvider(agentProvider), [agentProvider]);

  const selectedAzureSprint = useMemo(
    () => azureSprints.find((item) => (item.path || item.name) === azureSprint),
    [azureSprints, azureSprint],
  );
  const selectedJiraSprint = useMemo(
    () => jiraSprints.find((item) => item.id === jiraSprint),
    [jiraSprints, jiraSprint],
  );

  // Restore last backfill job state on mount so the user sees it after refresh,
  // and load the current index preview so they see what's already indexed.
  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ status: string; indexed?: number; total?: number; processed?: number; skipped_no_sp?: number; message?: string; error?: string }>('/refinement/history/backfill-status');
        if (data.status && data.status !== 'idle') {
          setBackfillJob(data as typeof backfillJob);
        }
      } catch {
        // ignore
      }
      try {
        const preview = await apiFetch<IndexPreview>('/refinement/history/preview');
        if (preview.total > 0) setIndexPreview(preview);
      } catch {
        // ignore
      }
      try {
        const rows = await apiFetch<{ id: number; display_name: string; provider: string; owner: string; repo_name: string }[]>('/repo-mappings');
        if (Array.isArray(rows)) setRepoMappings(rows);
      } catch {
        // ignore — code-aware refinement just stays off
      }
    })();
  }, []);

  // Re-attach to a refinement that was started in a previous mount of
  // this page. Source of truth = the backend's active jobs list; we use
  // localStorage only as a hint for the single/bulk distinction so the
  // overlay matches the original UI.
  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<{ jobs: RefinementJobStatus[] }>('/refinement/jobs/active');
        if (!data.jobs?.length) {
          if (typeof window !== 'undefined') localStorage.removeItem(ACTIVE_JOB_KEY);
          return;
        }
        const job = data.jobs[0];
        let isSingle = job.item_count === 1;
        if (typeof window !== 'undefined') {
          const raw = localStorage.getItem(ACTIVE_JOB_KEY);
          if (raw) {
            try {
              const stored = JSON.parse(raw) as StoredActiveJob;
              if (stored?.jobId === job.job_id) isSingle = !!stored.isSingle;
            } catch {
              // ignore corrupt entry
            }
          }
        }
        await attachToJob(job.job_id, isSingle, job.item_count || 0, job.item_ids || []);
      } catch {
        // The page must still load even if the resume probe fails.
      }
    })();
    // attachToJob is stable enough — running this only on mount is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const [azureProjectRows, prefs, integrations, promptCatalog] = await Promise.all([
          cachedApiFetch<Opt[]>('/tasks/azure/projects').catch(() => [] as Opt[]),
          loadPrefs().catch(() => null),
          cachedApiFetch<Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>>('/integrations')
            .catch(() => [] as Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>),
          loadPromptCatalog().catch(() => null),
        ]);
        if (promptCatalog) {
          const key = 'REFINEMENT_SYSTEM_PROMPT';
          const defaultVal = (promptCatalog.defaults?.[key] || '').trim();
          const overrideVal = (promptCatalog.overrides?.[key] || '').trim();
          setDefaultPromptText(defaultVal);
          if (overrideVal && overrideVal !== defaultVal) {
            setUseCustomPrompt(true);
            setCustomPromptText(overrideVal);
          }
        }
        let jiraProjectRows: Opt[] = [];
        const jiraCfg = integrations.find((cfg) => cfg.provider === 'jira');
        const jiraConnected = Boolean(jiraCfg && (jiraCfg.has_secret || (jiraCfg.base_url || '').trim() || (jiraCfg.username || '').trim()));
        if (jiraConnected) {
          jiraProjectRows = await cachedApiFetch<Opt[]>('/tasks/jira/projects').catch(() => [] as Opt[]);
        }
        if (!active) return;
        setAzureProjects(azureProjectRows);
        setJiraProjects(jiraProjectRows);

        const settings = ((prefs?.profile_settings || {}) as Record<string, unknown>);
        const preferredProvider = typeof settings.preferred_provider === 'string' ? settings.preferred_provider : 'openai';
        const preferredModel = typeof settings.preferred_model === 'string' ? settings.preferred_model : 'gpt-5.1-codex-mini';
        setAgentProvider((['gemini', 'hal', 'codex_cli', 'claude_cli'] as const).includes(preferredProvider as AgentProvider) ? preferredProvider as AgentProvider : 'openai');
        setAgentModel(preferredModel || 'gpt-5.1-codex-mini');

        const prefAzureProject = prefs?.azure_project || '';
        const prefAzureTeam = prefs?.azure_team || '';
        const prefAzureSprint = prefs?.azure_sprint_path || '';
        if (prefAzureProject) {
          setAzureProject(prefAzureProject);
          const teams = await cachedApiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(prefAzureProject)).catch(() => [] as Opt[]);
          if (!active) return;
          setAzureTeams(teams);
          if (prefAzureTeam) {
            setAzureTeam(prefAzureTeam);
            const sprints = await cachedApiFetch<Opt[]>(
              '/tasks/azure/sprints?project=' + encodeURIComponent(prefAzureProject) + '&team=' + encodeURIComponent(prefAzureTeam),
            ).catch(() => [] as Opt[]);
            if (!active) return;
            setAzureSprints(sprints);
            const selected = defaultSprint(sprints, 'azure') || prefAzureSprint;
            setAzureSprint(selected);
          }
        }

        const prefJiraProject = typeof settings.jira_project === 'string' ? settings.jira_project : '';
        const prefJiraBoard = typeof settings.jira_board === 'string' ? settings.jira_board : '';
        const prefJiraSprint = typeof settings.jira_sprint_id === 'string' ? settings.jira_sprint_id : '';
        if (prefJiraProject) {
          setJiraProject(prefJiraProject);
          const boards = await cachedApiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(prefJiraProject)).catch(() => [] as Opt[]);
          if (!active) return;
          setJiraBoards(boards);
          if (prefJiraBoard) {
            setJiraBoard(prefJiraBoard);
            const sprints = await cachedApiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(prefJiraBoard)).catch(() => [] as Opt[]);
            if (!active) return;
            setJiraSprints(sprints);
            const selected = defaultSprint(sprints, 'jira') || prefJiraSprint;
            setJiraSprint(selected);
          }
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load refinement defaults');
      }
    }

    void boot();
    return () => {
      active = false;
    };
  }, []);

  const loadAzureTeams = useCallback(async (nextProject: string) => {
    setAzureProject(nextProject);
    setAzureTeam('');
    setAzureSprint('');
    setAzureTeams([]);
    setAzureSprints([]);
    setItemsData(null);
    setResults(null);
    if (!nextProject) return;
    const rows = await cachedApiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(nextProject));
    setAzureTeams(rows);
  }, []);

  const loadAzureSprints = useCallback(async (nextTeam: string) => {
    setAzureTeam(nextTeam);
    setAzureSprint('');
    setAzureSprints([]);
    setItemsData(null);
    setResults(null);
    if (!azureProject || !nextTeam) return;
    const rows = await cachedApiFetch<Opt[]>(
      '/tasks/azure/sprints?project=' + encodeURIComponent(azureProject) + '&team=' + encodeURIComponent(nextTeam),
    );
    setAzureSprints(rows);
    setAzureSprint(defaultSprint(rows, 'azure'));
  }, [azureProject]);

  const loadJiraBoards = useCallback(async (nextProject: string) => {
    setJiraProject(nextProject);
    setJiraBoard('');
    setJiraSprint('');
    setJiraBoards([]);
    setJiraSprints([]);
    setItemsData(null);
    setResults(null);
    if (!nextProject) return;
    const rows = await cachedApiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(nextProject));
    setJiraBoards(rows);
  }, []);

  const loadJiraSprints = useCallback(async (nextBoard: string) => {
    setJiraBoard(nextBoard);
    setJiraSprint('');
    setJiraSprints([]);
    setItemsData(null);
    setResults(null);
    if (!nextBoard) return;
    const rows = await cachedApiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(nextBoard));
    setJiraSprints(rows);
    setJiraSprint(defaultSprint(rows, 'jira'));
  }, []);

  const refreshItems = useCallback(async () => {
    setError('');
    setLoadingItems(true);
    setResults(null);
    setWrittenBackIds(new Set());
    setExpandedItemId('');
    try {
      let data: RefinementItemsResponse;
      if (provider === 'azure') {
        const sprintName = selectedAzureSprint?.name || azureSprint.split('\\').pop() || azureSprint;
        data = await apiFetch<RefinementItemsResponse>(
          '/refinement/items?provider=azure'
          + '&project=' + encodeURIComponent(azureProject)
          + '&team=' + encodeURIComponent(azureTeam)
          + '&sprint_path=' + encodeURIComponent(azureSprint)
          + '&sprint_name=' + encodeURIComponent(sprintName),
        );
      } else {
        const sprintName = selectedJiraSprint?.name || jiraSprint;
        data = await apiFetch<RefinementItemsResponse>(
          '/refinement/items?provider=jira'
          + '&board_id=' + encodeURIComponent(jiraBoard)
          + '&sprint_id=' + encodeURIComponent(jiraSprint)
          + '&sprint_name=' + encodeURIComponent(sprintName),
        );
      }
      setItemsData(data);
      setSelectedIds(data.items.filter((item) => !hasEstimate(item)).slice(0, maxItems).map((item) => item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refinement items');
    } finally {
      setLoadingItems(false);
    }
  }, [provider, azureProject, azureTeam, azureSprint, selectedAzureSprint, jiraBoard, jiraSprint, selectedJiraSprint, maxItems]);

  useEffect(() => {
    if (provider === 'azure') {
      if (azureProject && azureTeam && azureSprint) void refreshItems();
      return;
    }
    if (jiraBoard && jiraSprint) void refreshItems();
  }, [provider, azureProject, azureTeam, azureSprint, jiraBoard, jiraSprint, refreshItems]);

  const toggleItem = useCallback((item: ExternalTask) => {
    if (hasEstimate(item)) return;
    setSelectedIds((prev) => prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]);
  }, []);

  const normalizeAnalyzeResponse = useCallback((response: RefinementAnalyzeResponse): RefinementAnalyzeResponse => ({
    ...response,
    results: (response.results || []).map((item) => ({
      ...item,
      item_url: item.item_url || null,
      estimation_rationale: item.estimation_rationale || '',
      summary: item.summary || '',
      comment: item.comment || '',
      ambiguities: item.ambiguities || [],
      questions: item.questions || [],
      fallback_applied: Boolean(item.fallback_applied),
      fallback_note: item.fallback_note || '',
    })),
  }), []);

  const runBackfill = useCallback(async () => {
    setError('');
    const tt = (k: string) => t(k as Parameters<typeof t>[0]);
    if (provider === 'azure') {
      if (!azureProject) {
        setBackfillJob({ status: 'failed', error: tt('refinement.backfill.needAzureProject') });
        return;
      }
      if (!azureTeam) {
        setBackfillJob({ status: 'failed', error: tt('refinement.backfill.needAzureTeam') });
        return;
      }
    } else if (provider === 'jira') {
      if (!jiraProject) {
        setBackfillJob({ status: 'failed', error: tt('refinement.backfill.needJiraProject') });
        return;
      }
    }
    setBackfillJob({ status: 'queued', message: tt('refinement.backfill.starting') });
    try {
      const body: Record<string, unknown> =
        provider === 'azure'
          ? { source: 'azure', project: azureProject, team: azureTeam, since_days: 730, max_items: 5000 }
          : { source: 'jira', project: jiraProject, board_id: jiraBoard || undefined, since_days: 730, max_items: 5000 };
      await apiFetch<{ status: string }>(
        '/refinement/history/backfill',
        { method: 'POST', body: JSON.stringify(body) },
      );
    } catch (err) {
      setBackfillJob({ status: 'failed', error: err instanceof Error ? err.message : tt('refinement.backfill.startFailed') });
    }
  }, [provider, azureProject, azureTeam, jiraProject, jiraBoard, t]);

  const loadIndexPreview = useCallback(async () => {
    try {
      const data = await apiFetch<IndexPreview>('/refinement/history/preview');
      setIndexPreview(data);
    } catch {
      setIndexPreview(null);
    }
  }, []);

  // Refresh the little summary card when a backfill completes
  useEffect(() => {
    if (backfillJob?.status === 'completed') void loadIndexPreview();
  }, [backfillJob?.status, loadIndexPreview]);

  // Poll backfill status while a job is active
  useEffect(() => {
    if (!backfillJob) return;
    if (backfillJob.status === 'completed' || backfillJob.status === 'failed' || backfillJob.status === 'idle') return;
    const iv = setInterval(async () => {
      try {
        const data = await apiFetch<typeof backfillJob & { status: string }>('/refinement/history/backfill-status');
        setBackfillJob(data as typeof backfillJob);
      } catch {
        // ignore transient polling errors
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [backfillJob]);

  const [runningItemId, setRunningItemId] = useState('');
  const [runModal, setRunModal] = useState<{ itemIds: string[]; single: boolean } | null>(null);

  const finalizeJobOutcome = useCallback((status: RefinementJobStatus, isSingle: boolean) => {
    if (status.status === 'failed') {
      const message = status.error_message || 'Refinement failed';
      setError(message);
      setRunMessage({ kind: 'error', text: message });
      return;
    }
    if (!status.result) {
      setRunMessage({ kind: 'error', text: copy.failedRun });
      return;
    }
    const normalized = normalizeAnalyzeResponse(status.result);
    if (isSingle) {
      setResults((prev) => {
        const next = normalized;
        if (!prev) return next;
        const byId = new Map(prev.results.map((r) => [r.item_id, r]));
        for (const r of next.results) byId.set(r.item_id, r);
        return { ...prev, ...next, results: Array.from(byId.values()) };
      });
      if (normalized.results.length > 0) {
        setExpandedItemId(normalized.results[0].item_id);
      }
    } else {
      setResults(normalized);
      setAutoFocusResults(true);
      if (normalized.results.length > 0) {
        setFocusedResultId(normalized.results[0].item_id);
        setResultsModalOpen(true);
      }
    }
    const failures = normalized.results.filter((item) => Boolean(item.error)).length;
    if (!normalized.results.length) {
      setRunMessage({ kind: 'error', text: copy.failedRun });
    } else if (failures === 0) {
      setRunMessage({ kind: 'success', text: copy.successRun });
    } else if (failures === normalized.results.length) {
      setRunMessage({ kind: 'error', text: copy.failedRun });
    } else {
      setRunMessage({ kind: 'warning', text: copy.partialRun });
    }
  }, [copy.failedRun, copy.successRun, copy.partialRun, normalizeAnalyzeResponse]);

  // Drive the running UI from a server-side job. Polls until the job
  // reaches a terminal status, then hands the result to finalizeJobOutcome.
  // Decoupled from the start path so we can also re-attach to a job that
  // was kicked off in a previous mount of the page.
  //
  // `resumeItemIds` is supplied when the user comes back to a job that
  // was started in a previous mount — backend echoes the original
  // item_ids so we can spinner the right row instead of bringing up the
  // big overlay.
  const attachToJob = useCallback(async (jobId: number, isSingle: boolean, totalCount: number, resumeItemIds?: string[]) => {
    if (typeof window !== 'undefined') {
      const stored: StoredActiveJob = { jobId, isSingle, savedAt: Date.now() };
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(stored));
    }
    setError('');
    setRunMessage(null);
    if (isSingle) {
      const resumeId = resumeItemIds && resumeItemIds.length === 1 ? resumeItemIds[0] : '';
      setRunningItemId((prev) => prev || resumeId);
    } else {
      setRunning(true);
      setAnalyzedCount(0);
      setOverlayTotal(totalCount);
    }
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    if (!isSingle && totalCount > 0) {
      progressInterval = setInterval(() => {
        setAnalyzedCount((prev) => (prev < totalCount - 1 ? prev + 1 : prev));
      }, Math.max(3000, 8000 / totalCount));
    }
    try {
      while (true) {
        const status = await apiFetch<RefinementJobStatus>(`/refinement/jobs/${jobId}`);
        if (status.status === 'completed' || status.status === 'failed') {
          if (progressInterval) clearInterval(progressInterval);
          if (totalCount > 0) setAnalyzedCount(totalCount);
          finalizeJobOutcome(status, isSingle);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      const message = err instanceof Error ? err.message : 'Refinement failed';
      setError(message);
      setRunMessage({ kind: 'error', text: message });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ACTIVE_JOB_KEY);
      }
      if (isSingle) {
        setRunningItemId('');
      } else {
        setRunning(false);
      }
    }
  }, [finalizeJobOutcome]);

  const runRefinement = useCallback(async (overrideItemIds?: string[]) => {
    const ids = overrideItemIds && overrideItemIds.length ? overrideItemIds : selectedIds;
    if (!ids.length) return;
    const isSingle = overrideItemIds?.length === 1;
    if (isSingle) {
      setRunningItemId(overrideItemIds![0]);
    }
    const customSystemPrompt = useCustomPrompt && customPromptText.trim() ? customPromptText.trim() : undefined;
    const repoMappingIdNum = repoMappingId.trim() ? Number(repoMappingId) : undefined;
    const codeAwareExtras = repoMappingIdNum && Number.isFinite(repoMappingIdNum) ? { repo_mapping_id: repoMappingIdNum } : {};
    const payload = provider === 'azure'
      ? {
        provider,
        project: azureProject,
        team: azureTeam,
        sprint_path: azureSprint,
        sprint_name: selectedAzureSprint?.name || azureSprint,
        language,
        agent_provider: agentProvider,
        agent_model: agentModel,
        item_ids: ids,
        max_items: isSingle ? 1 : maxItems,
        ...(customSystemPrompt ? { custom_system_prompt: customSystemPrompt } : {}),
        ...codeAwareExtras,
      }
      : {
        provider,
        board_id: jiraBoard,
        sprint_id: jiraSprint,
        sprint_name: selectedJiraSprint?.name || jiraSprint,
        language,
        agent_provider: agentProvider,
        agent_model: agentModel,
        item_ids: ids,
        max_items: isSingle ? 1 : maxItems,
        ...(customSystemPrompt ? { custom_system_prompt: customSystemPrompt } : {}),
        ...codeAwareExtras,
      };
    let job: { job_id: number };
    try {
      job = await apiFetch<{ job_id: number; status: string }>('/refinement/analyze/start', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      setError(message);
      setRunMessage({ kind: 'error', text: message });
      if (isSingle) setRunningItemId('');
      return;
    }
    await attachToJob(job.job_id, !!isSingle, ids.length);
  }, [provider, azureProject, azureTeam, azureSprint, selectedAzureSprint, jiraBoard, jiraSprint, selectedJiraSprint, language, agentProvider, agentModel, selectedIds, maxItems, useCustomPrompt, customPromptText, repoMappingId, attachToJob]);

  useEffect(() => {
    if (!autoFocusResults || !results?.results.length) return;
    const el = document.getElementById('refinement-results');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setAutoFocusResults(false);
  }, [autoFocusResults, results]);

  const runWritebackForItem = useCallback(async (itemId: string) => {
    const row = (results?.results || []).find((item) => item.item_id === itemId && !item.error);
    if (!row) return;
    setWritebackItemId(itemId);
    setError('');
    setRunMessage(null);

    // Build rich comment: comment + rationale + questions
    let richComment = (row.comment || '').trim();
    if (row.estimation_rationale) {
      richComment += `\n\n📊 Puan Gerekçesi: ${row.estimation_rationale}`;
    }
    if (row.suggested_story_points) {
      richComment += `\n🎯 Önerilen Puan: ${row.suggested_story_points}`;
    }
    if (row.questions && row.questions.length > 0) {
      richComment += '\n\n❓ Sorular:\n' + row.questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n');
    }
    if (row.ambiguities && row.ambiguities.length > 0) {
      richComment += '\n\n⚠️ Belirsizlikler:\n' + row.ambiguities.map((a: string) => `• ${a}`).join('\n');
    }

    try {
      const payload = provider === 'azure'
        ? {
          provider,
          project: azureProject,
          team: azureTeam,
          sprint_path: azureSprint,
          sprint_name: selectedAzureSprint?.name || azureSprint,
          comment_signature: commentSignature,
          items: [{
            item_id: row.item_id,
            suggested_story_points: row.suggested_story_points,
            comment: richComment,
          }],
        }
        : {
          provider,
          board_id: jiraBoard,
          sprint_id: jiraSprint,
          sprint_name: selectedJiraSprint?.name || jiraSprint,
          comment_signature: commentSignature,
          items: [{
            item_id: row.item_id,
            suggested_story_points: row.suggested_story_points,
            comment: richComment,
          }],
        };
      const response = await apiFetch<RefinementWritebackResponse>('/refinement/writeback', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (response.success_count > 0 && response.failure_count === 0) {
        setWrittenBackIds((prev) => new Set(prev).add(row.item_id));
        setRunMessage({ kind: 'success', text: `${row.item_id} writeback basarili.` });
      } else if (response.success_count === 0) {
        setRunMessage({ kind: 'error', text: `${row.item_id} writeback basarisiz.` });
      } else {
        setWrittenBackIds((prev) => new Set(prev).add(row.item_id));
        setRunMessage({ kind: 'warning', text: `${row.item_id} writeback kismi.` });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Writeback failed';
      setError(message);
      setRunMessage({ kind: 'error', text: message });
    } finally {
      setWritebackItemId('');
    }
  }, [results, provider, azureProject, azureTeam, azureSprint, selectedAzureSprint, commentSignature, jiraBoard, jiraSprint, selectedJiraSprint]);

  const requestWritebackForItem = useCallback((itemId: string) => {
    const row = (results?.results || []).find((item) => item.item_id === itemId && !item.error);
    if (!row) return;
    setConfirmWritebackItemId(itemId);
  }, [results]);

  const copyToClipboard = useCallback((text: string, itemId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCommentId(itemId);
      setTimeout(() => setCopiedCommentId(''), 2000);
    }).catch(() => {});
  }, []);

  const providerLabel = provider === 'azure' ? 'Azure DevOps' : 'Jira';

  const resultByItemId = useMemo(() => {
    const map = new Map<string, RefinementSuggestion>();
    for (const row of results?.results || []) map.set(row.item_id, row);
    return map;
  }, [results]);

  const sortedItems = useMemo(() => {
    const items = itemsData?.items || [];
    // Refined items first (most recent runs surface a suggestion in
    // resultByItemId), then unestimated, then everything else.
    return [...items].sort((a, b) => {
      const refinedDiff = Number(!resultByItemId.has(a.id)) - Number(!resultByItemId.has(b.id));
      if (refinedDiff !== 0) return refinedDiff;
      const estimateDiff = Number(hasEstimate(a)) - Number(hasEstimate(b));
      if (estimateDiff !== 0) return estimateDiff;
      return a.title.localeCompare(b.title);
    });
  }, [itemsData, resultByItemId]);

  useEffect(() => {
    if (!itemsData || !results) return;
    const key = buildSnapshotKey(itemsData.provider, itemsData.sprint_ref);
    const payload = {
      saved_at: Date.now(),
      itemsData,
      results,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  }, [itemsData, results]);

  useEffect(() => {
    const sprintRef = provider === 'azure' ? azureSprint : jiraSprint;
    if (!sprintRef) return;
    const key = buildSnapshotKey(provider, sprintRef);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { itemsData?: RefinementItemsResponse; results?: RefinementAnalyzeResponse };
      if (parsed.itemsData?.items?.length) setItemsData(parsed.itemsData);
      if (parsed.results?.results?.length) setResults(normalizeAnalyzeResponse(parsed.results));
    } catch {
      // ignore corrupted snapshot
    }
  }, [provider, azureSprint, jiraSprint, normalizeAnalyzeResponse]);

  return (
    <div className="refinement-page" style={{ display: 'grid', gap: 14, maxWidth: 1200, paddingBottom: 40 }}>
      {/* ── LOADING OVERLAY (portal to body) ── */}
      {running && typeof document !== 'undefined' && createPortal(
        <div className="refinement-overlay" style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          zIndex: 99999, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
          background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            border: '3px solid rgba(94,234,212,0.15)',
            borderTopColor: '#5eead4',
            animation: 'refinement-spin 0.8s linear infinite',
          }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#5eead4', marginBottom: 6 }}>
              {copy.analyzingProgress
                .replace('{done}', String(analyzedCount))
                .replace('{total}', String(overlayTotal || selectedIds.length))}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{copy.overlayWait}</div>
          </div>
          <div style={{
            width: 200, height: 4, borderRadius: 2,
            background: 'var(--panel-border)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg, #0d9488, #5eead4)',
              width: (overlayTotal || selectedIds.length) > 0
                ? `${Math.max(5, (analyzedCount / (overlayTotal || selectedIds.length)) * 100)}%`
                : '5%',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>,
        document.body,
      )}
      {/* Run Refinement config modal */}
      {runModal && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 20,
          }}
          onClick={() => setRunModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, 100%)',
              borderRadius: 16,
              background: 'var(--surface)',
              border: '1px solid var(--panel-border)',
              padding: 22,
              display: 'grid',
              gap: 14,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {copy.analyze}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)', marginTop: 4 }}>
                {runModal.single
                  ? (t('refinement.runModal.titleSingle' as Parameters<typeof t>[0])).replace('{id}', runModal.itemIds[0] || '')
                  : (t('refinement.runModal.titleBulk' as Parameters<typeof t>[0])).replace('{count}', String(runModal.itemIds.length))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4 }}>
                {t('refinement.runModal.subtitle' as Parameters<typeof t>[0])}
              </div>
            </div>

            <div style={{
              display: 'flex', gap: 8, alignItems: 'center',
              padding: '8px 10px', borderRadius: 10,
              background: 'rgba(94,234,212,0.06)',
              border: '1px solid rgba(94,234,212,0.25)',
              fontSize: 11, color: 'var(--ink-65)',
            }}>
              💡 {t('refinement.runModal.hint' as Parameters<typeof t>[0])}
            </div>

            <button
              type='button'
              onClick={() => setRunModalAdvanced((v) => !v)}
              style={{
                alignSelf: 'flex-start',
                background: 'transparent', border: 'none', padding: 0,
                fontSize: 11, color: 'var(--ink-55)',
                cursor: 'pointer',
                textDecoration: 'underline', textDecorationStyle: 'dotted',
              }}
            >
              {runModalAdvanced ? '▾' : '▸'} {lang === 'tr' ? 'Gelişmiş' : 'Advanced'} · {agentProvider}{agentProvider !== 'hal' ? ` / ${agentModel}` : ''} · {language}{repoMappingId ? ` · ${repoMappings.find(r => String(r.id) === repoMappingId)?.display_name || ''}` : ''}
            </button>

            {runModalAdvanced && (
              <>
                <Field label={copy.agentProvider}>
                  <select
                    value={agentProvider}
                    onChange={(e) => {
                      const next = e.target.value as AgentProvider;
                      setAgentProvider(next);
                      setAgentModel(modelsForProvider(next)[0]?.id || '');
                    }}
                    style={inputStyle}
                  >
                    <option value='openai'>OpenAI</option>
                    <option value='gemini'>Gemini</option>
                    <option value='claude_cli'>Claude CLI</option>
                    <option value='codex_cli'>Codex CLI</option>
                    <option value='hal'>HAL</option>
                  </select>
                </Field>

                {agentProvider !== 'hal' && (
                  <Field label={copy.agentModel}>
                    <select value={agentModel} onChange={(e) => setAgentModel(e.target.value)} style={inputStyle}>
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </Field>
                )}

                <Field label={copy.repoMapping}>
                  <select value={repoMappingId} onChange={(e) => setRepoMappingId(e.target.value)} style={inputStyle}>
                    <option value=''>{copy.repoMappingNone}</option>
                    {repoMappings.map((r) => (
                      <option key={r.id} value={String(r.id)}>{r.display_name || `${r.provider}:${r.owner}/${r.repo_name}`}</option>
                    ))}
                  </select>
                </Field>

                <Field label={copy.language}>
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle}>
                    <option value='Turkish'>Turkish</option>
                    <option value='English'>English</option>
                    <option value='German'>German</option>
                    <option value='Spanish'>Spanish</option>
                    <option value='Chinese'>Chinese</option>
                    <option value='Italian'>Italian</option>
                    <option value='Japanese'>Japanese</option>
                  </select>
                </Field>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setRunModal(null)}
                style={{
                  padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  border: '1px solid var(--panel-border-2)', background: 'transparent',
                  color: 'var(--ink-65)', cursor: 'pointer',
                }}
              >
                {t('refinement.runModal.cancel' as Parameters<typeof t>[0])}
              </button>
              <button
                onClick={() => {
                  const ids = runModal.itemIds;
                  setRunModal(null);
                  void runRefinement(ids);
                }}
                style={{
                  padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800,
                  border: '1px solid rgba(13,148,136,0.6)',
                  background: 'linear-gradient(135deg, #0d9488, #5eead4)',
                  color: '#0a1815', cursor: 'pointer',
                }}
              >
                ▶ {t('refinement.runModal.start' as Parameters<typeof t>[0])}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <div>
        <div className='section-label'>{copy.section}</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2 }}>{copy.title}</h1>
        <p style={{ fontSize: 12, color: 'var(--ink-30)', margin: 0 }}>{copy.subtitle}</p>
      </div>

      <div className="refinement-top-grid" style={{ display: 'grid', gap: 16 }}>
        <div style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', padding: 14, display: 'grid', gap: 10 }}>
          <div className="ref-row-2" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <Field label={copy.source}>
              <select value={provider} onChange={(e) => { setProvider(e.target.value as Provider); setItemsData(null); setResults(null); setWrittenBackIds(new Set()); setExpandedItemId(''); }} style={inputStyle}>
                <option value='azure'>Azure DevOps</option>
                <option value='jira'>Jira</option>
              </select>
            </Field>
            <Field label={copy.language}>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle}>
                <option value='Turkish'>Turkish</option>
                <option value='English'>English</option>
                <option value='German'>German</option>
                <option value='Spanish'>Spanish</option>
                <option value='Chinese'>Chinese</option>
                <option value='Italian'>Italian</option>
                <option value='Japanese'>Japanese</option>
              </select>
            </Field>
          </div>

          {provider === 'azure' ? (
            <div className="ref-row-3" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <Field label={copy.project}>
                <select value={azureProject} onChange={(e) => void loadAzureTeams(e.target.value)} style={inputStyle}>
                  <option value=''>{copy.chooseProject}</option>
                  {azureProjects.map((item) => <option key={item.id || item.name} value={item.name}>{item.name}</option>)}
                </select>
              </Field>
              <Field label={copy.team}>
                <select value={azureTeam} onChange={(e) => void loadAzureSprints(e.target.value)} style={inputStyle} disabled={!azureProject}>
                  <option value=''>{copy.chooseTeam}</option>
                  {azureTeams.map((item) => <option key={item.id || item.name} value={item.name}>{item.name}</option>)}
                </select>
              </Field>
              <Field label={copy.sprint}>
                <select value={azureSprint} onChange={(e) => { setAzureSprint(e.target.value); setResults(null); }} style={inputStyle} disabled={!azureTeam}>
                  <option value=''>{copy.chooseSprint}</option>
                  {azureSprints.map((item) => <option key={item.id || item.name} value={item.path || item.name}>{item.name}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <div className="ref-row-3" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr' }}>
              <Field label={copy.project}>
                <select value={jiraProject} onChange={(e) => void loadJiraBoards(e.target.value)} style={inputStyle}>
                  <option value=''>{copy.chooseProject}</option>
                  {jiraProjects.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name}</option>)}
                </select>
              </Field>
              <Field label={copy.board}>
                <select value={jiraBoard} onChange={(e) => void loadJiraSprints(e.target.value)} style={inputStyle} disabled={!jiraProject}>
                  <option value=''>{copy.chooseBoard}</option>
                  {jiraBoards.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name}</option>)}
                </select>
              </Field>
              <Field label={copy.sprint}>
                <select value={jiraSprint} onChange={(e) => { setJiraSprint(e.target.value); setResults(null); }} style={inputStyle} disabled={!jiraBoard}>
                  <option value=''>{copy.chooseSprint}</option>
                  {jiraSprints.map((item) => <option key={item.id || item.name} value={item.id || item.name}>{item.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          <div className="ref-row-4" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
            <Field label={copy.agentProvider}>
              <select
                value={agentProvider}
                onChange={(e) => {
                  const next = e.target.value as AgentProvider;
                  setAgentProvider(next);
                  setAgentModel(modelsForProvider(next)[0]?.id || '');
                }}
                style={inputStyle}
              >
                <option value='openai'>OpenAI</option>
                <option value='gemini'>Gemini</option>
                <option value='claude_cli'>Claude CLI</option>
                <option value='codex_cli'>Codex CLI</option>
                <option value='hal'>HAL</option>
              </select>
            </Field>
            {agentProvider !== 'hal' && (
              <Field label={copy.agentModel}>
                <select value={agentModel} onChange={(e) => setAgentModel(e.target.value)} style={inputStyle}>
                  {availableModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
            )}
            <Field label={copy.limit}>
              <input
                type='number'
                min={1}
                max={20}
                value={maxItems}
                onChange={(e) => setMaxItems(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={inputStyle}
              />
            </Field>
            <Field label={copy.signature}>
              <input value={commentSignature} onChange={(e) => setCommentSignature(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {agentProvider !== 'hal' && (
            <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Available Models
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {availableModels.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    onClick={() => setAgentModel(item.id)}
                    style={item.id === agentModel ? activeModelChip : modelChip}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}


          <div className="refinement-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void refreshItems()} style={primaryButton} disabled={loadingItems}>
              {loadingItems ? copy.loadingItems : copy.loadItems}
            </button>
            <button onClick={() => setRunModal({ itemIds: [...selectedIds], single: false })} style={secondaryButton} disabled={running || !selectedIds.length}>
              {running ? copy.analyzing : copy.analyze}
            </button>
            {results && results.results.filter(r => !r.error).length > 0 && (
              <>
              <button
                onClick={() => {
                  const validResults = results.results.filter(r => !r.error && selectedIds.includes(r.item_id) && !writtenBackIds.has(r.item_id));
                  if (validResults.length === 0) return;
                  setConfirmBulkWriteback(true);
                }}
                style={{ ...secondaryButton, background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                disabled={writebackItemId !== '' || !selectedIds.some(id => results.results.some(r => r.item_id === id && !r.error) && !writtenBackIds.has(id))}
              >
                {copy.writebackSelected || 'Write Selected'} ({selectedIds.filter(id => results.results.some(r => r.item_id === id && !r.error) && !writtenBackIds.has(id)).length})
              </button>
              <button
                onClick={async () => {
                  const validItems = results.results.filter(r => !r.error && selectedIds.includes(r.item_id));
                  if (!validItems.length) return;
                  setRunMessage({ kind: 'success', text: `MCP Agent: ${validItems.length} task kuyruga aliniyor...` });
                  let ok = 0;
                  for (const r of validItems) {
                    try {
                      const desc = r.description || r.summary || r.item_id;
                      const ctxParts = [
                        `External Source: ${provider === 'jira' ? `Jira #${r.item_id}` : `Azure #${r.item_id}`}`,
                        provider === 'azure' && azureProject ? `Project: ${azureProject}` : '',
                      ].filter(Boolean);
                      const created = await apiFetch<{ id: number }>('/tasks', {
                        method: 'POST',
                        body: JSON.stringify({
                          title: `[${provider === 'jira' ? 'Jira' : 'Azure'} #${r.item_id}] ${r.title || r.item_id}`,
                          description: `${desc}\n\n---\n${ctxParts.join('\n')}`,
                        }),
                      });
                      await apiFetch('/tasks/' + created.id + '/assign', {
                        method: 'POST',
                        body: JSON.stringify({ mode: 'mcp_agent', create_pr: true }),
                      });
                      ok++;
                    } catch { /* skip */ }
                  }
                  setRunMessage({ kind: ok > 0 ? 'success' : 'error', text: `MCP Agent: ${ok}/${validItems.length} task atandi` });
                }}
                style={{ ...secondaryButton, background: 'rgba(8,145,178,0.1)', borderColor: 'rgba(6,182,212,0.3)', color: '#22d3ee' }}
                disabled={running || !selectedIds.some(id => results.results.some(r => r.item_id === id && !r.error))}
              >
                ⚡ MCP Agent ({selectedIds.filter(id => results.results.some(r => r.item_id === id && !r.error)).length})
              </button>
              </>
            )}
            <span style={{ fontSize: 12, color: 'var(--ink-35)' }}>{copy.selectionHint}</span>
            <a
              href='/dashboard/prompt-studio'
              style={{ fontSize: 11, color: 'var(--ink-55)', textDecoration: 'underline', textDecorationStyle: 'dotted', marginLeft: 'auto' }}
            >
              {copy.editInStudio}
            </a>
          </div>

          {/* Backfill — small link, used rarely (Qdrant index bootstrap) */}
          {(() => {
            const jobActive = backfillJob && (backfillJob.status === 'queued' || backfillJob.status === 'fetching' || backfillJob.status === 'indexing');
            const disabled = !!jobActive
              || (provider === 'azure' && (!azureProject || !azureTeam))
              || (provider === 'jira' && !jiraProject);
            const label = jobActive
              ? `${t('refinement.backfill.buttonActive' as Parameters<typeof t>[0])}${backfillJob?.total ? ` (${backfillJob.processed || 0}/${backfillJob.total})` : '...'}`
              : t('refinement.backfill.buttonIdle' as Parameters<typeof t>[0]);
            return (
              <button
                type='button'
                onClick={() => void runBackfill()}
                disabled={disabled}
                style={{
                  alignSelf: 'flex-start',
                  background: 'transparent', border: 'none', padding: 0,
                  fontSize: 11, color: disabled ? 'var(--ink-35)' : 'var(--ink-55)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  textDecoration: 'underline', textDecorationStyle: 'dotted',
                }}
                title={
                  provider === 'azure'
                    ? (!azureProject ? t('refinement.backfill.needAzureProjectShort' as Parameters<typeof t>[0])
                      : !azureTeam ? t('refinement.backfill.needAzureTeamShort' as Parameters<typeof t>[0])
                      : t('refinement.backfill.tooltipAzure' as Parameters<typeof t>[0]))
                    : (!jiraProject ? t('refinement.backfill.needJiraProjectShort' as Parameters<typeof t>[0])
                      : t('refinement.backfill.tooltipJira' as Parameters<typeof t>[0]))
                }
              >
                ↻ {label}
              </button>
            );
          })()}

          {backfillJob && backfillJob.status !== 'idle' && backfillJob.status !== 'completed' && (
            <div style={{
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              border: `1px solid ${backfillJob.status === 'failed' ? 'rgba(239,68,68,0.35)' : 'rgba(14,165,233,0.35)'}`,
              background: backfillJob.status === 'failed' ? 'rgba(239,68,68,0.06)' : 'rgba(14,165,233,0.06)',
              color: 'var(--ink-80)',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: 999,
                background: backfillJob.status === 'failed' ? '#f87171' : '#38bdf8',
                flexShrink: 0,
                animation: backfillJob.status !== 'failed' ? 'pulse-brand 1.4s ease-in-out infinite' : 'none',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  {backfillJob.status === 'queued' && t('refinement.backfill.statusQueued' as Parameters<typeof t>[0])}
                  {backfillJob.status === 'fetching' && t('refinement.backfill.statusFetching' as Parameters<typeof t>[0])}
                  {backfillJob.status === 'indexing' && `${t('refinement.backfill.statusIndexing' as Parameters<typeof t>[0])}${backfillJob.total ? ` — ${backfillJob.processed || 0}/${backfillJob.total}` : ''}`}
                  {backfillJob.status === 'failed' && `${t('refinement.backfill.statusFailedPrefix' as Parameters<typeof t>[0])}: ${backfillJob.error || t('refinement.backfill.statusUnknownError' as Parameters<typeof t>[0])}`}
                </div>
                {backfillJob.message && backfillJob.status !== 'failed' && (
                  <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>{backfillJob.message}</div>
                )}
              </div>
              {backfillJob.status !== 'failed' && (
                <button
                  onClick={() => setBackfillJob(null)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
                  title={t('refinement.backfill.dismissTitle' as Parameters<typeof t>[0])}
                >×</button>
              )}
            </div>
          )}

          {/* Index özeti — detay ayrı sayfada */}
          {indexPreview && indexPreview.total > 0 && (
            <a
              href='/dashboard/refinement/history'
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 12,
                border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
                color: 'var(--ink-85)', textDecoration: 'none',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ fontSize: 16 }}>📚</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {t('refinement.indexLink.title' as Parameters<typeof t>[0]).replace('{count}', indexPreview.total.toLocaleString())}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>
                  {t('refinement.indexLink.subtitle' as Parameters<typeof t>[0])}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-45)' }}>→</span>
            </a>
          )}

          {error && (
            <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#fecaca', padding: '10px 12px', fontSize: 13 }}>
              {error}
            </div>
          )}
          {runMessage && (
            <div
              style={{
                borderRadius: 12,
                border: runMessage.kind === 'success'
                  ? '1px solid rgba(34,197,94,0.35)'
                  : runMessage.kind === 'warning'
                    ? '1px solid rgba(251,191,36,0.35)'
                    : '1px solid rgba(239,68,68,0.35)',
                background: runMessage.kind === 'success'
                  ? 'rgba(34,197,94,0.08)'
                  : runMessage.kind === 'warning'
                    ? 'rgba(251,191,36,0.08)'
                    : 'rgba(239,68,68,0.08)',
                color: runMessage.kind === 'success' ? '#86efac' : runMessage.kind === 'warning' ? '#fde68a' : '#fecaca',
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {runMessage.text}
            </div>
          )}
        </div>

        <div className="refinement-stats" style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', padding: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Stat label={copy.total} value={String(itemsData?.items.length || 0)} />
          <Stat label={copy.unestimated} value={String(itemsData?.unestimated_count || 0)} accent='#fbbf24' />
          <Stat label={copy.pointed} value={String(itemsData?.pointed_count || 0)} accent='#34d399' />
          {results && (
            <>
              <Stat label={copy.tokens} value={results.total_tokens.toLocaleString()} accent='#fca5a5' />
              <Stat label={copy.cost} value={`$${results.estimated_cost_usd.toFixed(4)}`} accent='#c4b5fd' />
              <Stat label={copy.skipped} value={String(results.skipped_count)} accent='#fcd34d' />
            </>
          )}
        </div>
      </div>

      <div className="refinement-table-wrap" style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', overflow: 'hidden' }}>
        <div style={{ ...panelHeader, padding: '10px 14px', borderBottom: '1px solid var(--panel-border)' }}>Sprint Items</div>
        {!sortedItems.length ? (
          <div style={emptyStyle}>{loadingItems ? copy.loadingItems : copy.noItems}</div>
        ) : (
          <>
          {/* Unified item list — works on both mobile and desktop */}
          <div style={{ padding: '0' }}>
                {sortedItems.map((item) => {
                  const estimated = hasEstimate(item);
                  const checked = selectedIds.includes(item.id);
                  const itemSourceUrl = resultByItemId.get(item.id)?.item_url || item.web_url || '';
                  const suggestion = resultByItemId.get(item.id);
                  const isWrittenBack = writtenBackIds.has(item.id);
                  const isExpanded = expandedItemId === item.id;
                  const isRefining = runningItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <div
                        className={isRefining ? 'refinement-row-active' : undefined}
                        style={{
                          padding: '12px 14px',
                          borderBottom: '1px solid var(--panel-border)',
                          background: isWrittenBack
                            ? 'rgba(34,197,94,0.06)'
                            : checked ? 'rgba(59,130,246,0.06)' : 'transparent',
                          borderLeft: isWrittenBack ? '3px solid #22c55e' : '3px solid transparent',
                          cursor: suggestion ? 'pointer' : 'default',
                        }}
                        onClick={() => { if (suggestion) setExpandedItemId(isExpanded ? '' : item.id); }}
                      >
                        {/* Row 1: checkbox + ID + badges + arrow */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <input type='checkbox' checked={checked} disabled={estimated}
                            onChange={() => toggleItem(item)} onClick={(e) => e.stopPropagation()}
                            style={{ flexShrink: 0, width: 18, height: 18 }} />
                          <span style={{ fontSize: 12, color: 'var(--ink-50)', fontFamily: 'monospace', fontWeight: 700 }}>{item.id}</span>
                          <span style={{ fontSize: 10, color: 'var(--ink-42)', background: 'var(--panel)', padding: '2px 6px', borderRadius: 4 }}>
                            {item.work_item_type || 'Task'}
                          </span>
                          <span style={{ ...(estimated ? estimatedPill : unestimatedPill), fontSize: 10, padding: '2px 6px' }}>
                            {displayEstimate(item)}
                          </span>
                          {suggestion && (
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ ...suggestedPointsPill(suggestion.suggested_story_points), fontSize: 11, padding: '2px 8px' }}>
                                {displaySuggestionEstimate(suggestion.suggested_story_points, { allowZero: true })} pts
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: suggestion.confidence >= 70 ? '#86efac' : suggestion.confidence >= 40 ? '#fde68a' : '#fca5a5' }}>
                                {suggestion.confidence}%
                              </span>
                            </div>
                          )}
                          {isWrittenBack && <span style={{ ...writtenBadge, fontSize: 9, padding: '1px 6px' }}>{copy.writtenBack}</span>}
                          {!estimated && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setRunModal({ itemIds: [item.id], single: true }); }}
                              disabled={running || runningItemId === item.id || !!isWrittenBack}
                              style={{
                                marginLeft: suggestion ? 0 : 'auto',
                                fontSize: 11, fontWeight: 700,
                                padding: '4px 10px', borderRadius: 8,
                                border: '1px solid rgba(94,234,212,0.35)',
                                background: runningItemId === item.id ? 'rgba(94,234,212,0.15)' : 'rgba(94,234,212,0.08)',
                                color: '#5eead4',
                                cursor: (running || runningItemId === item.id) ? 'wait' : 'pointer',
                                opacity: (running && runningItemId !== item.id) ? 0.5 : 1,
                                whiteSpace: 'nowrap',
                              }}
                              title={suggestion ? copy.analyze : copy.analyze}
                            >
                              {runningItemId === item.id
                                ? `⏳ ${copy.analyzing}`
                                : suggestion ? `↻ ${copy.analyze}` : `▶ ${copy.analyze}`}
                            </button>
                          )}
                          {suggestion && (
                            <span style={{ fontSize: 11, color: 'var(--ink-42)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
                          )}
                        </div>
                        {/* Row 2: Title */}
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {itemSourceUrl ? (
                            <a href={itemSourceUrl} target='_blank' rel='noreferrer'
                              style={{ color: 'var(--ink-78)', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                              {item.title}
                            </a>
                          ) : item.title}
                        </div>
                        {/* Row 3: Meta */}
                        {(item.state || item.assigned_to || item.refined_before) && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                            {item.state && <span style={{ fontSize: 11, color: 'var(--ink-42)' }}>{item.state}</span>}
                            {item.assigned_to && <span style={{ fontSize: 11, color: 'var(--ink-42)' }}>{item.assigned_to}</span>}
                            {item.refined_before && <span style={{ fontSize: 11, color: '#fde68a' }}>Refined ({item.refinement_count || 1}x)</span>}
                          </div>
                        )}
                      </div>
                      {isExpanded && suggestion && (
                        <div style={{ padding: '0 14px 14px', borderBottom: '1px solid rgba(13,148,136,0.15)' }}>
                            <div style={expandedCard}>
                              {/* Header row: big points + confidence + write button */}
                              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 36, fontWeight: 800, color: '#5eead4', lineHeight: 1 }}>
                                      {displaySuggestionEstimate(suggestion.suggested_story_points, { allowZero: true })}
                                    </div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 4 }}>
                                      {copy.suggestedEstimate}
                                    </div>
                                  </div>
                                  <div style={{ width: 1, height: 40, background: 'var(--panel-border)' }} />
                                  <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                      fontSize: 24,
                                      fontWeight: 800,
                                      lineHeight: 1,
                                      color: suggestion.confidence >= 70 ? '#86efac' : suggestion.confidence >= 40 ? '#fde68a' : '#fca5a5',
                                    }}>
                                      {suggestion.confidence}%
                                    </div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 4 }}>
                                      {copy.confidence}
                                    </div>
                                    {suggestion.confidence < 40 && (
                                      <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600, marginTop: 2 }}>{copy.lowConfidence}</div>
                                    )}
                                  </div>
                                  <div style={{ width: 1, height: 40, background: 'var(--panel-border)' }} />
                                  <span style={suggestion.ready_for_planning ? readyPill : pendingPill}>
                                    {suggestion.ready_for_planning ? copy.ready : copy.notReady}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                  {isWrittenBack ? (
                                    <span style={writtenButtonDone}>
                                      {copy.writtenBack}
                                    </span>
                                  ) : (
                                    <button
                                      type='button'
                                      style={writeProviderButton}
                                      disabled={writebackItemId === item.id || !!suggestion.error}
                                      onClick={() => requestWritebackForItem(item.id)}
                                    >
                                      {writebackItemId === item.id
                                        ? copy.writebackRunning
                                        : `${copy.writeToProvider} → ${providerLabel}`}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {suggestion.error ? (
                                <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#fecaca', padding: '10px 12px', fontSize: 13 }}>
                                  {suggestion.error}
                                </div>
                              ) : (
                                <>
                                  {suggestion.fallback_applied && suggestion.fallback_note && (
                                    <div style={{ borderRadius: 10, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fde68a', padding: '8px 10px', fontSize: 12 }}>
                                      {suggestion.fallback_note}
                                    </div>
                                  )}

                                  {/* Summary */}
                                  <div style={expandedSection}>
                                    <div style={expandedSectionLabel}>{copy.summary}</div>
                                    <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-80)', whiteSpace: 'pre-wrap' }}>{suggestion.summary || '-'}</div>
                                  </div>

                                  {/* Rationale */}
                                  <div style={expandedSection}>
                                    <div style={expandedSectionLabel}>{copy.rationale}</div>
                                    <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-80)', whiteSpace: 'pre-wrap' }}>{suggestion.estimation_rationale || '-'}</div>
                                  </div>

                                  {/* Comment with Copy button */}
                                  <div style={expandedSection}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={expandedSectionLabel}>{copy.comment}</div>
                                      <button
                                        type='button'
                                        style={{
                                          ...ghostButton,
                                          padding: '4px 10px',
                                          fontSize: 11,
                                          border: copiedCommentId === item.id ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.25)',
                                          color: copiedCommentId === item.id ? '#86efac' : '#cbd5e1',
                                        }}
                                        onClick={(e) => { e.stopPropagation(); copyToClipboard(suggestion.comment, item.id); }}
                                      >
                                        {copiedCommentId === item.id ? copy.copied : copy.copyComment}
                                      </button>
                                    </div>
                                    <div style={{
                                      fontSize: 13, lineHeight: 1.6, color: 'var(--ink-75)', whiteSpace: 'pre-wrap',
                                      padding: '10px 12px', borderRadius: 10,
                                      background: 'var(--panel)', border: '1px solid var(--panel-border)',
                                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                      marginTop: 6,
                                    }}>
                                      {suggestion.comment || '-'}
                                    </div>
                                  </div>

                                  {/* Touched files — what the analysis thinks needs editing */}
                                  {suggestion.touched_files && suggestion.touched_files.length > 0 && (
                                    <div style={expandedSection}>
                                      <div style={expandedSectionLabel}>Etkilenen Dosyalar</div>
                                      <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                                        {suggestion.touched_files.map((tf, i) => {
                                          const blameKey = `${suggestion.item_id}::${tf.file}`;
                                          const blame = blameByKey[blameKey];
                                          const canBlame = !!tf.repo_mapping_id;
                                          return (
                                          <div key={`${tf.file}-${i}`} style={{
                                            padding: '6px 10px', borderRadius: 8,
                                            border: '1px solid var(--panel-border)',
                                            background: 'var(--panel)',
                                            display: 'flex', flexDirection: 'column', gap: 4,
                                          }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                              <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: tf.action === 'create' ? 'rgba(34,197,94,0.15)' : tf.action === 'delete' ? 'rgba(248,113,113,0.15)' : 'rgba(56,189,248,0.15)', color: tf.action === 'create' ? '#22c55e' : tf.action === 'delete' ? '#f87171' : '#38bdf8', textTransform: 'uppercase' }}>{tf.action || 'modify'}</span>
                                              <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-85)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tf.file}</span>
                                              {tf.repo_mapping_name && (
                                                <span style={{ fontSize: 10, color: 'var(--ink-50)' }}>· {tf.repo_mapping_name}</span>
                                              )}
                                              {canBlame && (
                                                <button
                                                  type='button'
                                                  onClick={(e) => { e.stopPropagation(); void toggleBlame(blameKey, tf.repo_mapping_id as number, tf.file); }}
                                                  title='Son commit geçmişi'
                                                  style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-65)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}
                                                >
                                                  {blame ? '−' : 'blame'}
                                                </button>
                                              )}
                                            </div>
                                            {tf.reason && (
                                              <div style={{ fontSize: 11, color: 'var(--ink-65)', lineHeight: 1.4 }}>{tf.reason}</div>
                                            )}
                                            {blame && (
                                              <div style={{ borderTop: '1px solid var(--panel-border-2)', paddingTop: 6, marginTop: 2, display: 'grid', gap: 4 }}>
                                                {blame.loading && (
                                                  <div style={{ fontSize: 11, color: 'var(--ink-50)' }}>Yükleniyor...</div>
                                                )}
                                                {blame.error && (
                                                  <div style={{ fontSize: 11, color: '#fca5a5' }}>{blame.error}</div>
                                                )}
                                                {blame.commits && blame.commits.length === 0 && (
                                                  <div style={{ fontSize: 11, color: 'var(--ink-50)' }}>Bu dosya için commit bulunamadı.</div>
                                                )}
                                                {blame.commits && blame.commits.map((c) => (
                                                  <div key={c.sha} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, color: 'var(--ink-72)' }}>
                                                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--ink-50)', minWidth: 56 }}>{c.sha}</span>
                                                    <span style={{ minWidth: 90, color: 'var(--ink-58)' }}>{(c.date || '').slice(0, 10)}</span>
                                                    <span style={{ minWidth: 110, fontWeight: 600, color: 'var(--ink-85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.author_email}>{c.author_name}</span>
                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Recommended assignee from git authorship */}
                                  {suggestion.recommended_authors && suggestion.recommended_authors.length > 0 && (
                                    <div style={expandedSection}>
                                      <div style={expandedSectionLabel}>Önerilen Kişi (kodu son 6 ayda yazan)</div>
                                      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                                        {suggestion.recommended_authors.map((a, i) => {
                                          const matched = !!a.member_unique_name;
                                          return (
                                          <div key={`${a.email || a.name}-${i}`} style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '8px 10px', borderRadius: 10,
                                            border: matched ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(168,85,247,0.25)',
                                            background: matched ? 'rgba(34,197,94,0.06)' : 'rgba(168,85,247,0.06)',
                                          }}>
                                            <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 8px', borderRadius: 8, background: matched ? 'rgba(34,197,94,0.18)' : 'rgba(168,85,247,0.18)', color: matched ? '#22c55e' : '#c084fc', minWidth: 40, textAlign: 'center' }}>
                                              {matched ? '✓' : `#${i + 1}`}
                                            </span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div style={{ fontSize: 13, color: 'var(--ink-85)', fontWeight: 600 }}>
                                                {matched ? a.member_display_name : a.name}
                                                {(matched ? a.member_unique_name : a.email) ? ` <${matched ? a.member_unique_name : a.email}>` : ''}
                                              </div>
                                              <div style={{ fontSize: 11, color: 'var(--ink-58)' }}>{a.reason || `${a.commit_count || 0} commit · ${a.files_touched || 0} dosya`}</div>
                                            </div>
                                            {matched && (
                                              <button
                                                type='button'
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  if (!window.confirm(`${a.member_display_name} kişisine ata?`)) return;
                                                  try {
                                                    await apiFetch('/refinement/assign-author', {
                                                      method: 'POST',
                                                      body: JSON.stringify({
                                                        work_item_id: suggestion.item_id,
                                                        source: a.member_source || 'azure',
                                                        member_unique_name: a.member_unique_name,
                                                        project: azureProject || undefined,
                                                      }),
                                                    });
                                                    setError(`✓ Atandı: ${a.member_display_name}`);
                                                  } catch (err) {
                                                    setError(err instanceof Error ? err.message : 'Atama başarısız');
                                                  }
                                                }}
                                                style={{
                                                  padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                                                  border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.15)',
                                                  color: '#22c55e', cursor: 'pointer', whiteSpace: 'nowrap',
                                                }}
                                              >
                                                Ata
                                              </button>
                                            )}
                                          </div>
                                        );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Similar past items (grounding) */}
                                  {suggestion.similar_items && suggestion.similar_items.length > 0 && (
                                    <div style={expandedSection}>
                                      <div style={expandedSectionLabel}>Benzer Tamamlanmış İşler</div>
                                      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                                        {suggestion.similar_items.map((si) => (
                                          <div key={si.external_id} style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '8px 10px', borderRadius: 10,
                                            border: '1px solid var(--panel-border)',
                                            background: 'var(--panel)',
                                          }}>
                                            <span style={{
                                              fontSize: 12, fontWeight: 800, color: '#5eead4',
                                              minWidth: 48, textAlign: 'center',
                                              padding: '4px 8px', borderRadius: 8,
                                              background: 'rgba(94,234,212,0.1)',
                                            }}>
                                              {si.story_points} SP
                                            </span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div style={{ fontSize: 13, color: 'var(--ink-85)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {si.url ? (
                                                  <a href={si.url} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()}
                                                    style={{ color: 'var(--ink-85)', textDecoration: 'none' }}>
                                                    #{si.external_id} {si.title}
                                                  </a>
                                                ) : (
                                                  <span>#{si.external_id} {si.title}</span>
                                                )}
                                              </div>
                                              <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', fontSize: 11 }}>
                                                {si.assigned_to && (
                                                  <span style={{ color: 'var(--ink-42)' }}>👤 {si.assigned_to}</span>
                                                )}
                                                {(si.pr_count ?? 0) > 0 && (
                                                  <span style={{ color: '#7dd3fc' }} title={(si.pr_titles || []).join('\n')}>
                                                    🔀 {si.pr_count} PR
                                                  </span>
                                                )}
                                                {(si.commit_count ?? 0) > 0 && (
                                                  <span style={{ color: 'var(--ink-42)' }}>⎘ {si.commit_count} commit</span>
                                                )}
                                                {(si.branches || []).slice(0, 2).map((b) => (
                                                  <span key={b} style={{ color: '#a5b4fc', fontFamily: 'monospace', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b}>
                                                    🌿 {b}
                                                  </span>
                                                ))}
                                              </div>
                                              {(si.pr_titles || []).length > 0 && (
                                                <div style={{ fontSize: 11, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.35 }}>
                                                  {(si.pr_titles || []).slice(0, 2).map((t, i) => (
                                                    <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                      ↳ {t}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                            {(() => {
                                              const tier = si.tier || 'related';
                                              const pct = Math.round((si.score || 0) * 100);
                                              const meta = tier === 'strong'
                                                ? { label: 'ÇOK YAKIN', color: '#86efac' }
                                                : tier === 'related'
                                                  ? { label: 'yakın', color: '#fde68a' }
                                                  : { label: 'uzak', color: '#fca5a5' };
                                              return (
                                                <span style={{
                                                  fontSize: 10, fontWeight: 700,
                                                  color: meta.color, whiteSpace: 'nowrap',
                                                  padding: '2px 6px', borderRadius: 4,
                                                  background: `${meta.color}20`,
                                                  textTransform: 'uppercase', letterSpacing: 0.3,
                                                }} title={`Cosine similarity: ${(si.score || 0).toFixed(3)} (${pct}%)`}>
                                                  {meta.label}
                                                </span>
                                              );
                                            })()}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Ambiguities & Questions side by side. Each
                                      line gets a "Sor" button that posts the
                                      text to the originating Azure / Jira work
                                      item with an @mention of the matched
                                      recommended author. */}
                                  {(() => {
                                    const matched = (suggestion.recommended_authors || []).find((x) => x.member_unique_name);
                                    const askLine = async (text: string) => {
                                      try {
                                        await apiFetch('/refinement/ask-question', {
                                          method: 'POST',
                                          body: JSON.stringify({
                                            work_item_id: suggestion.item_id,
                                            source: matched?.member_source || 'azure',
                                            question: text,
                                            mention_unique_name: matched?.member_unique_name || undefined,
                                            mention_display_name: matched?.member_display_name || undefined,
                                            project: azureProject || undefined,
                                          }),
                                        });
                                        setError(`✓ ${matched?.member_display_name || 'Assignee'} kişisine soruldu`);
                                      } catch (err) {
                                        setError(err instanceof Error ? err.message : 'Soru gönderilemedi');
                                      }
                                    };
                                    return (
                                      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                                        <div style={expandedSection}>
                                          <div style={expandedSectionLabel}>{copy.ambiguities}</div>
                                          {suggestion.ambiguities.length ? (
                                            <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                                              {suggestion.ambiguities.map((a, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: 'var(--ink-75)', lineHeight: 1.5 }}>
                                                  <span style={{ flex: 1 }}>• {a}</span>
                                                  <button
                                                    type='button'
                                                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`"${a}" sorulsun mu?`)) void askLine(a); }}
                                                    title={'Work item’a comment olarak gönder'}
                                                    style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', cursor: 'pointer' }}
                                                  >Sor</button>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>-</div>
                                          )}
                                        </div>
                                        <div style={expandedSection}>
                                          <div style={expandedSectionLabel}>{copy.questions}</div>
                                          {suggestion.questions.length ? (
                                            <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                                              {suggestion.questions.map((q, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, color: 'var(--ink-75)', lineHeight: 1.5 }}>
                                                  <span style={{ flex: 1 }}>• {q}</span>
                                                  <button
                                                    type='button'
                                                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`"${q}" sorulsun mu?`)) void askLine(q); }}
                                                    title={'Work item’a comment olarak gönder'}
                                                    style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', cursor: 'pointer' }}
                                                  >Sor</button>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>-</div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
          </div>

          {/* Old mobile cards removed — unified list above handles both mobile and desktop */}
          </>
        )}
      </div>

      <div id='refinement-results' style={{ display: 'grid', gap: 14 }}>
        <div style={panelHeader}>Suggestions</div>
        {!results?.results.length ? (
          <div style={{ ...emptyStyle, borderRadius: 18, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
            {copy.noResults}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {copy.resultOverview}
              </div>
              <div className="refinement-results-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {results.results.map((item) => {
                  const isItemWritten = writtenBackIds.has(item.item_id);
                  return (
                  <div
                    key={`${item.item_id}-summary`}
                    style={{
                      borderRadius: 16, padding: 16, display: 'grid', gap: 10, cursor: 'pointer',
                      border: isItemWritten ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--panel-border-2)',
                      background: isItemWritten ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.03)',
                      transition: 'border-color 0.2s',
                    }}
                    onClick={() => setExpandedItemId(expandedItemId === item.item_id ? '' : item.item_id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-35)', fontFamily: 'monospace' }}>{item.item_id}</div>
                      {isItemWritten && (
                        <span style={writtenBadgeSmall}>
                          {copy.writtenBack}
                        </span>
                      )}
                    </div>
                    {item.item_url ? (
                      <a href={item.item_url} target='_blank' rel='noreferrer' style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-78)', lineHeight: 1.4, textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}>
                        {item.title}
                      </a>
                    ) : (
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.4 }}>{item.title}</div>
                    )}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 22, fontWeight: 800, color: '#5eead4', lineHeight: 1,
                      }}>
                        {displaySuggestionEstimate(item.suggested_story_points, { allowZero: true })}
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-42)', marginLeft: 4 }}>{copy.pts}</span>
                      </span>
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        color: item.confidence >= 70 ? '#86efac' : item.confidence >= 40 ? '#fde68a' : '#fca5a5',
                      }}>
                        {item.confidence}%
                      </span>
                      <span style={item.ready_for_planning ? { ...readyPill, fontSize: 10, padding: '3px 8px' } : { ...pendingPill, fontSize: 10, padding: '3px 8px' }}>
                        {item.ready_for_planning ? copy.ready : copy.notReady}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {results.results.map((item) => {
              const isItemWritten = writtenBackIds.has(item.item_id);
              return (
              <div key={item.item_id} style={{
                borderRadius: 18, padding: 20, display: 'grid', gap: 14,
                border: isItemWritten ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--panel-border-2)',
                background: isItemWritten ? 'linear-gradient(180deg, rgba(34,197,94,0.04), var(--panel))' : 'var(--panel)',
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-35)', fontFamily: 'monospace' }}>{item.item_id}</span>
                      {isItemWritten && (
                        <span style={writtenBadge}>
                          {provider === 'azure' ? copy.writtenBackAzure : copy.writtenBackJira}
                        </span>
                      )}
                    </div>
                    {item.item_url ? (
                      <a href={item.item_url} target='_blank' rel='noreferrer' style={{ margin: '4px 0 0', fontSize: 18, color: 'var(--ink-78)', textDecoration: 'none', fontWeight: 700, display: 'inline-block' }}>
                        {item.title}
                      </a>
                    ) : (
                      <h3 style={{ margin: '4px 0 0', fontSize: 18, color: 'var(--ink-90)' }}>{item.title}</h3>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'center', padding: '0 8px' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#5eead4', lineHeight: 1 }}>
                        {displaySuggestionEstimate(item.suggested_story_points, { allowZero: true })}
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 2 }}>{copy.pts}</div>
                    </div>
                    <span style={{
                      fontSize: 16, fontWeight: 700,
                      color: item.confidence >= 70 ? '#86efac' : item.confidence >= 40 ? '#fde68a' : '#fca5a5',
                    }}>
                      {item.confidence}%
                    </span>
                    <span style={item.ready_for_planning ? readyPill : pendingPill}>
                      {item.ready_for_planning ? copy.ready : copy.notReady}
                    </span>
                  </div>
                </div>

                {item.error ? (
                  <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#fecaca', padding: '10px 12px', fontSize: 13 }}>
                    {item.error}
                  </div>
                ) : (
                  <>
                    {item.fallback_applied && item.fallback_note && (
                      <div style={{ borderRadius: 10, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fde68a', padding: '8px 10px', fontSize: 12 }}>
                        {item.fallback_note}
                      </div>
                    )}
                    <Section title={copy.summary} body={item.summary} />
                    <Section title={copy.rationale} body={item.estimation_rationale} />
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{copy.comment}</div>
                        <button
                          type='button'
                          style={{
                            ...ghostButton,
                            padding: '4px 10px',
                            fontSize: 11,
                            border: copiedCommentId === `detail-${item.item_id}` ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.25)',
                            color: copiedCommentId === `detail-${item.item_id}` ? '#86efac' : '#cbd5e1',
                          }}
                          onClick={() => copyToClipboard(item.comment, `detail-${item.item_id}`)}
                        >
                          {copiedCommentId === `detail-${item.item_id}` ? copy.copied : copy.copyComment}
                        </button>
                      </div>
                      <div style={{
                        fontSize: 13, lineHeight: 1.6, color: 'var(--ink-75)', whiteSpace: 'pre-wrap',
                        padding: '10px 12px', borderRadius: 10,
                        background: 'var(--panel)', border: '1px solid var(--panel-border)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}>
                        {item.comment || '-'}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <ListSection title={copy.ambiguities} items={item.ambiguities} />
                      <ListSection title={copy.questions} items={item.questions} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                      {isItemWritten ? (
                        <span style={writtenButtonDone}>{copy.writtenBack}</span>
                      ) : (
                        <button
                          type='button'
                          style={writeProviderButton}
                          disabled={writebackItemId === item.item_id || !!item.error}
                          onClick={() => requestWritebackForItem(item.item_id)}
                        >
                          {writebackItemId === item.item_id ? copy.writebackRunning : `${copy.writeToProvider} → ${providerLabel}`}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              );
            })}
          </>
        )}
      </div>

      {resultsModalOpen && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
          zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
        }} onClick={() => { setResultsModalOpen(false); setFocusedResultId(''); }}>
          <div style={{
            width: 'min(560px, 96vw)', maxHeight: '90vh', borderRadius: 18,
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header with navigation */}
            {(() => {
              const allResults = results?.results || [];
              const currentIdx = focusedResultId ? allResults.findIndex(r => r.item_id === focusedResultId) : 0;
              const total = allResults.length;
              return (
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {total > 1 && (
                      <>
                        <button type='button' onClick={() => {
                          const prev = currentIdx > 0 ? currentIdx - 1 : total - 1;
                          setFocusedResultId(allResults[prev]?.item_id || '');
                        }} style={{ background: 'none', border: '1px solid var(--panel-border-2)', borderRadius: 8, color: 'var(--ink-50)', cursor: 'pointer', padding: '4px 10px', fontSize: 14 }}>←</button>
                        <span style={{ fontSize: 12, color: 'var(--ink-42)', fontWeight: 600 }}>{currentIdx + 1} / {total}</span>
                        <button type='button' onClick={() => {
                          const next = currentIdx < total - 1 ? currentIdx + 1 : 0;
                          setFocusedResultId(allResults[next]?.item_id || '');
                        }} style={{ background: 'none', border: '1px solid var(--panel-border-2)', borderRadius: 8, color: 'var(--ink-50)', cursor: 'pointer', padding: '4px 10px', fontSize: 14 }}>→</button>
                      </>
                    )}
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)' }}>{copy.resultsTitle}</span>
                  </div>
                  <button type='button' onClick={() => { setResultsModalOpen(false); setFocusedResultId(''); }}
                    style={{ background: 'none', border: '1px solid var(--panel-border-2)', borderRadius: 8, color: 'var(--ink-50)', cursor: 'pointer', padding: '6px 14px', fontSize: 12, fontWeight: 600 }}>
                    ✕
                  </button>
                </div>
              );
            })()}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <div style={{ display: 'grid', gap: 16 }}>
              {(results?.results || [])
                .filter((item) => !focusedResultId || item.item_id === focusedResultId)
                .map((item) => {
                  const isItemWritten = writtenBackIds.has(item.item_id);
                  return (
                <div key={`modal-${item.item_id}`} style={{
                  borderRadius: 16, padding: 20, display: 'grid', gap: 14,
                  border: isItemWritten ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--panel-border-2)',
                  background: isItemWritten ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--ink-35)', fontFamily: 'monospace' }}>{item.item_id}</div>
                      {item.item_url ? (
                        <a href={item.item_url} target='_blank' rel='noreferrer' style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-78)', textDecoration: 'none', display: 'block', marginTop: 4, lineHeight: 1.4 }}>
                          {item.title}
                        </a>
                      ) : (
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginTop: 4, lineHeight: 1.4 }}>{item.title}</div>
                      )}
                    </div>
                    {isItemWritten && (
                      <span style={writtenBadge}>
                        {provider === 'azure' ? copy.writtenBackAzure : copy.writtenBackJira}
                      </span>
                    )}
                  </div>

                  {/* Big points display */}
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 42, fontWeight: 800, color: '#5eead4', lineHeight: 1 }}>
                        {displaySuggestionEstimate(item.suggested_story_points, { allowZero: true })}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 4 }}>
                        {copy.suggestedEstimate}
                      </div>
                    </div>
                    <div style={{ width: 1, height: 40, background: 'var(--panel-border)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        fontSize: 28, fontWeight: 800, lineHeight: 1,
                        color: item.confidence >= 70 ? '#86efac' : item.confidence >= 40 ? '#fde68a' : '#fca5a5',
                      }}>
                        {item.confidence}%
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 4 }}>
                        {copy.confidence}
                      </div>
                    </div>
                    <div style={{ width: 1, height: 40, background: 'var(--panel-border)' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-60)', lineHeight: 1 }}>
                        {displaySuggestionEstimate(item.current_story_points)}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 4 }}>
                        {copy.currentEstimate}
                      </div>
                    </div>
                    <span style={item.ready_for_planning ? readyPill : pendingPill}>
                      {item.ready_for_planning ? copy.ready : copy.notReady}
                    </span>
                  </div>

                  {item.error ? (
                    <div style={{ borderRadius: 12, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#fecaca', padding: '10px 12px', fontSize: 13 }}>
                      {item.error}
                    </div>
                  ) : (
                    <>
                      {item.fallback_applied && item.fallback_note && (
                        <div style={{ borderRadius: 10, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fde68a', padding: '8px 10px', fontSize: 12 }}>
                          {item.fallback_note}
                        </div>
                      )}
                      <Section title={copy.summary} body={item.summary} />
                      <Section title={copy.rationale} body={item.estimation_rationale} />
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{copy.comment}</div>
                          <button
                            type='button'
                            style={{
                              ...ghostButton,
                              padding: '4px 10px',
                              fontSize: 11,
                              border: copiedCommentId === `modal-${item.item_id}` ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(148,163,184,0.25)',
                              color: copiedCommentId === `modal-${item.item_id}` ? '#86efac' : '#cbd5e1',
                            }}
                            onClick={() => copyToClipboard(item.comment, `modal-${item.item_id}`)}
                          >
                            {copiedCommentId === `modal-${item.item_id}` ? copy.copied : copy.copyComment}
                          </button>
                        </div>
                        <div style={{
                          fontSize: 13, lineHeight: 1.6, color: 'var(--ink-75)', whiteSpace: 'pre-wrap',
                          padding: '10px 12px', borderRadius: 10,
                          background: 'var(--panel)', border: '1px solid var(--panel-border)',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        }}>
                          {item.comment || '-'}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                        <ListSection title={copy.ambiguities} items={item.ambiguities} />
                        <ListSection title={copy.questions} items={item.questions} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                        {isItemWritten ? (
                          <span style={writtenButtonDone}>{copy.writtenBack}</span>
                        ) : (
                          <button
                            type='button'
                            style={writeProviderButton}
                            disabled={writebackItemId === item.item_id || !!item.error}
                            onClick={() => {
                              setResultsModalOpen(false);
                              setFocusedResultId('');
                              requestWritebackForItem(item.item_id);
                            }}
                          >
                            {writebackItemId === item.item_id ? copy.writebackRunning : `${copy.writeToProvider} → ${providerLabel}`}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmBulkWriteback && results && typeof document !== 'undefined' && createPortal(
        <div className="refinement-modal-overlay" style={modalOverlay} onClick={() => setConfirmBulkWriteback(false)}>
          <div className="refinement-modal refinement-modal-sm" style={{ ...modalCard, width: 'min(560px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>
              {copy.writebackSelected || 'Write Selected Items'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-50)', margin: '8px 0 16px' }}>
              {(() => {
                const valid = results.results.filter(r => !r.error && selectedIds.includes(r.item_id) && !writtenBackIds.has(r.item_id));
                const skipped = results.results.filter(r => !r.error && selectedIds.includes(r.item_id) && writtenBackIds.has(r.item_id));
                return `${valid.length} item → ${providerLabel} (story point + comment)${skipped.length ? ` — ${skipped.length} ${copy.bulkSkipped}` : ''}`;
              })()}
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 16 }}>
              {results.results.filter(r => !r.error && selectedIds.includes(r.item_id)).map(r => (
                <div key={r.item_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '6px 10px', borderRadius: 8,
                  background: writtenBackIds.has(r.item_id) ? 'rgba(34,197,94,0.08)' : 'rgba(0,0,0,0.2)',
                  fontSize: 12,
                  opacity: writtenBackIds.has(r.item_id) ? 0.5 : 1,
                }}>
                  <span style={{ color: 'var(--ink-65)' }}>
                    {writtenBackIds.has(r.item_id) && <span style={{ color: '#22c55e', marginRight: 6 }}>&#10003;</span>}
                    {r.item_id} — {r.title?.slice(0, 40)}
                  </span>
                  <span style={{ color: writtenBackIds.has(r.item_id) ? '#86efac' : '#5eead4', fontWeight: 700 }}>
                    {writtenBackIds.has(r.item_id) ? copy.writtenBack : `${r.suggested_story_points} ${copy.pts}`}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type='button' style={ghostButton} onClick={() => setConfirmBulkWriteback(false)}>
                {copy.close}
              </button>
              <button
                type='button'
                disabled={bulkWritebackRunning}
                style={{ ...secondaryButton, background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                onClick={async () => {
                  setBulkWritebackRunning(true);
                  const valid = results.results.filter(r => !r.error && selectedIds.includes(r.item_id) && !writtenBackIds.has(r.item_id));
                  let ok = 0, fail = 0;
                  for (const row of valid) {
                    try {
                      await runWritebackForItem(row.item_id);
                      ok++;
                    } catch { fail++; }
                  }
                  setBulkWritebackRunning(false);
                  setConfirmBulkWriteback(false);
                  setRunMessage({ kind: fail === 0 ? 'success' : 'warning', text: `Writeback: ${ok} ok, ${fail} fail` });
                }}
              >
                {bulkWritebackRunning ? copy.writebackRunning : (copy.writeShort || 'Write')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmWritebackItemId && typeof document !== 'undefined' && createPortal(
        (() => {
        const confirmRow = resultByItemId.get(confirmWritebackItemId);
        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }} onClick={() => setConfirmWritebackItemId('')}>
            <div style={{
              width: 'min(400px, 92vw)', borderRadius: 16, padding: '20px 22px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              display: 'grid', gap: 14,
            }} onClick={(e) => e.stopPropagation()}>
              {/* Header with title + points */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-42)', fontFamily: 'monospace' }}>#{confirmWritebackItemId}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginTop: 2, lineHeight: 1.3 }}>
                    {confirmRow?.title || ''}
                  </div>
                </div>
                {confirmRow && (
                  <div style={{ background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)', borderRadius: 10, padding: '8px 14px', textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#5eead4', lineHeight: 1 }}>
                      {displaySuggestionEstimate(confirmRow.suggested_story_points, { allowZero: true })}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--ink-42)', textTransform: 'uppercase', marginTop: 2 }}>puan</div>
                  </div>
                )}
              </div>
              {/* Comment preview */}
              {confirmRow?.comment && (
                <div style={{ fontSize: 12, color: 'var(--ink-50)', lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)', maxHeight: 120, overflowY: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {confirmRow.comment}
                </div>
              )}
              {/* Provider indicator */}
              <div style={{ fontSize: 12, color: 'var(--ink-42)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: provider === 'azure' ? '#38bdf8' : '#a78bfa' }} />
                {providerLabel}
              </div>
              {/* Buttons */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type='button' onClick={() => setConfirmWritebackItemId('')}
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {copy.close}
                </button>
                <button type='button'
                  style={{ flex: 2, padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(13,148,136,0.4)', background: 'rgba(13,148,136,0.15)', color: '#5eead4', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  onClick={() => { const id = confirmWritebackItemId; setConfirmWritebackItemId(''); void runWritebackForItem(id); }}>
                  {copy.writeToProvider} → {providerLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })(),
        document.body,
      )}

      {/* ── Refinement History ── */}
      <RefinementHistory />
    </div>
  );
}

function RefinementHistory() {
  const [items, setItems] = useState<Array<{
    id: number; provider: string; external_item_id: string; sprint_name?: string;
    item_title?: string; item_url?: string; phase: string; status: string;
    suggested_story_points?: number; confidence?: number; summary?: string;
    estimation_rationale?: string; comment?: string; error_message?: string; created_at: string;
  }>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: typeof items; total: number }>(`/refinement/history?page=${p}&page_size=10`);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(page); }, [page, load]);

  if (!items.length && !loading) return null;

  const totalPages = Math.max(1, Math.ceil(total / 10));

  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-90)' }}>Refinement History</div>
        <span style={{ fontSize: 11, color: 'var(--ink-35)' }}>{total} record{total !== 1 ? 's' : ''}</span>
      </div>
      {loading && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-35)' }}>Loading...</div>}
      {items.map((r) => (
        <div key={r.id} style={{ borderBottom: '1px solid var(--panel-border)' }}>
          <div
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
            style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-42)', fontWeight: 700, minWidth: 60 }}>#{r.external_item_id}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-78)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.item_title || r.external_item_id}
            </span>
            {r.suggested_story_points != null && (
              <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.3)' }}>
                {r.suggested_story_points} pts
              </span>
            )}
            {r.confidence != null && (
              <span style={{ fontSize: 11, fontWeight: 700, color: r.confidence >= 70 ? '#22c55e' : r.confidence >= 40 ? '#f59e0b' : '#ef4444' }}>
                {r.confidence}%
              </span>
            )}
            <span style={{
              padding: '2px 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
              background: r.phase === 'writeback' ? 'rgba(34,197,94,0.1)' : 'rgba(56,189,248,0.1)',
              color: r.phase === 'writeback' ? '#22c55e' : '#38bdf8',
              border: `1px solid ${r.phase === 'writeback' ? 'rgba(34,197,94,0.3)' : 'rgba(56,189,248,0.3)'}`,
            }}>{r.phase}</span>
            <span style={{ fontSize: 10, color: 'var(--ink-30)', flexShrink: 0 }}>
              {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-35)', transform: expanded === r.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
          </div>
          {expanded === r.id && (
            <div style={{ padding: '0 14px 12px', display: 'grid', gap: 8 }}>
              {r.summary && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 2 }}>Summary</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-72)', lineHeight: 1.5 }}>{r.summary}</div>
                </div>
              )}
              {r.estimation_rationale && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 2 }}>Rationale</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-72)', lineHeight: 1.5 }}>{r.estimation_rationale}</div>
                </div>
              )}
              {r.comment && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 2 }}>Comment</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5, fontFamily: 'monospace', padding: '6px 8px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--panel-border)', whiteSpace: 'pre-wrap' }}>{r.comment}</div>
                </div>
              )}
              {r.error_message && (
                <div style={{ fontSize: 12, color: '#ef4444', padding: '6px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{r.error_message}</div>
              )}
              {r.item_url && (
                <a href={r.item_url} target='_blank' rel='noreferrer' style={{ fontSize: 12, color: '#0d9488', textDecoration: 'none' }}>Open in {r.provider} ↗</a>
              )}
            </div>
          )}
        </div>
      ))}
      {totalPages > 1 && (
        <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', cursor: page <= 1 ? 'not-allowed' : 'pointer', fontSize: 12, opacity: page <= 1 ? 0.5 : 1 }}>←</button>
          <span style={{ fontSize: 12, color: 'var(--ink-42)' }}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontSize: 12, opacity: page >= totalPages ? 0.5 : 1 }}>→</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, accent = '#0d9488' }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: accent, marginTop: 2, lineHeight: 1.2, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}


function Section({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-80)', whiteSpace: 'pre-wrap' }}>{body || '-'}</div>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-80)', lineHeight: 1.6 }}>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      ) : (
        <div style={{ fontSize: 14, color: 'var(--ink-45)' }}>-</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--glass)',
  color: 'var(--ink-90)',
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
};

const primaryButton: React.CSSProperties = {
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
  color: '#fff',
  padding: '9px 14px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid rgba(245,158,11,0.35)',
  background: 'rgba(245,158,11,0.08)',
  color: '#f59e0b',
  padding: '9px 14px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const ghostButton: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  color: 'var(--ink-58)',
  padding: '9px 14px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
};

const panelHeader: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--ink-90)',
  marginBottom: 4,
};

const emptyStyle: React.CSSProperties = {
  padding: 18,
  color: 'var(--ink-35)',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--ink-35)',
  padding: '8px 10px',
  borderBottom: '1px solid var(--panel-border-2)',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--panel-border)',
  fontSize: 13,
  color: 'var(--ink-70)',
  verticalAlign: 'top',
};

const unestimatedPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 7px',
  borderRadius: 999,
  border: '1px solid rgba(245,158,11,0.35)',
  background: 'rgba(245,158,11,0.08)',
  color: '#f59e0b',
  fontSize: 11,
  fontWeight: 700,
};

const estimatedPill: React.CSSProperties = {
  ...unestimatedPill,
  border: '1px solid rgba(34,197,94,0.35)',
  background: 'rgba(34,197,94,0.08)',
  color: '#22c55e',
};

const resultPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'rgba(148,163,184,0.08)',
  color: 'var(--ink-80)',
  fontSize: 12,
  fontWeight: 700,
};

const readyPill: React.CSSProperties = {
  ...resultPill,
  border: '1px solid rgba(34,197,94,0.35)',
  background: 'rgba(34,197,94,0.08)',
  color: '#86efac',
};

const pendingPill: React.CSSProperties = {
  ...resultPill,
  border: '1px solid rgba(251,191,36,0.35)',
  background: 'rgba(251,191,36,0.08)',
  color: '#fde68a',
};

const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  overflowY: 'auto',
};

const modalCard: React.CSSProperties = {
  width: 'min(980px, 96vw)',
  borderRadius: 16,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: 16,
  display: 'grid',
  gap: 12,
  maxHeight: '90vh',
  overflowY: 'auto',
};

const modelChip: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  color: 'var(--ink-58)',
  padding: '5px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const activeModelChip: React.CSSProperties = {
  ...modelChip,
  border: '1px solid rgba(13,148,136,0.45)',
  background: 'rgba(13,148,136,0.12)',
  color: '#0d9488',
  fontWeight: 700,
};

function suggestedPointsPill(_points: number): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    borderRadius: 999,
    border: '1px solid rgba(13,148,136,0.35)',
    background: 'rgba(13,148,136,0.12)',
    color: '#5eead4',
    fontSize: 12,
    fontWeight: 800,
  };
}

const writtenBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid rgba(34,197,94,0.35)',
  background: 'rgba(34,197,94,0.12)',
  color: '#86efac',
  fontSize: 11,
  fontWeight: 700,
};

const writtenBadgeSmall: React.CSSProperties = {
  ...writtenBadge,
  padding: '2px 7px',
  fontSize: 10,
};

const writeProviderButton: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(13,148,136,0.4)',
  background: 'rgba(13,148,136,0.12)',
  color: '#5eead4',
  padding: '8px 16px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const writtenButtonDone: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(34,197,94,0.3)',
  background: 'rgba(34,197,94,0.1)',
  color: '#86efac',
  padding: '8px 16px',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'default',
  opacity: 0.8,
};

const expandedCard: React.CSSProperties = {
  padding: '20px 24px',
  background: 'linear-gradient(180deg, rgba(13,148,136,0.04), rgba(0,0,0,0.15))',
  borderTop: '1px solid rgba(13,148,136,0.15)',
  display: 'grid',
  gap: 14,
};

const expandedSection: React.CSSProperties = {
  display: 'grid',
  gap: 4,
};

const expandedSectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--ink-35)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
