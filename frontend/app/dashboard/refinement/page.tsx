'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { apiFetch, cachedApiFetch, loadPrefs, loadPromptCatalog } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Provider = 'azure' | 'jira';
type AgentProvider = 'openai' | 'gemini';

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

function modelsForProvider(provider: AgentProvider): ModelOption[] {
  return provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS;
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

export default function RefinementPage() {
  const { lang } = useLocale();
  const copy = lang === 'tr' ? COPY.tr : COPY.en;

  const [provider, setProvider] = useState<Provider>('azure');
  const [agentProvider, setAgentProvider] = useState<AgentProvider>('openai');
  const [agentModel, setAgentModel] = useState('gpt-5.1-codex-mini');
  const [language, setLanguage] = useState(lang === 'tr' ? 'Turkish' : 'English');
  const [maxItems, setMaxItems] = useState(8);

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
        setAgentProvider(preferredProvider === 'gemini' ? 'gemini' : 'openai');
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

  const runRefinement = useCallback(async () => {
    if (!selectedIds.length) return;
    setRunning(true);
    setError('');
    setRunMessage(null);
    try {
      const customSystemPrompt = useCustomPrompt && customPromptText.trim() ? customPromptText.trim() : undefined;
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
          item_ids: selectedIds,
          max_items: maxItems,
          ...(customSystemPrompt ? { custom_system_prompt: customSystemPrompt } : {}),
        }
        : {
          provider,
          board_id: jiraBoard,
          sprint_id: jiraSprint,
          sprint_name: selectedJiraSprint?.name || jiraSprint,
          language,
          agent_provider: agentProvider,
          agent_model: agentModel,
          item_ids: selectedIds,
          max_items: maxItems,
          ...(customSystemPrompt ? { custom_system_prompt: customSystemPrompt } : {}),
        };
      const response = await apiFetch<RefinementAnalyzeResponse>('/refinement/analyze', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const normalized = normalizeAnalyzeResponse(response);
      setResults(normalized);
      setAutoFocusResults(true);
      setResultsModalOpen(normalized.results.length > 0);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      setError(message);
      setRunMessage({ kind: 'error', text: message });
    } finally {
      setRunning(false);
    }
  }, [provider, azureProject, azureTeam, azureSprint, selectedAzureSprint, jiraBoard, jiraSprint, selectedJiraSprint, language, agentProvider, agentModel, selectedIds, maxItems, useCustomPrompt, customPromptText, normalizeAnalyzeResponse, copy.failedRun, copy.successRun, copy.partialRun]);

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
            comment: row.comment,
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
            comment: row.comment,
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

  const sortedItems = useMemo(() => {
    const items = itemsData?.items || [];
    return [...items].sort((a, b) => Number(hasEstimate(a)) - Number(hasEstimate(b)) || a.title.localeCompare(b.title));
  }, [itemsData]);

  const resultByItemId = useMemo(() => {
    const map = new Map<string, RefinementSuggestion>();
    for (const row of results?.results || []) map.set(row.item_id, row);
    return map;
  }, [results]);

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
    <div className="refinement-page" style={{ display: 'grid', gap: 18, maxWidth: 1200 }}>
      <div>
        <div className='section-label'>{copy.section}</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>{copy.title}</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-30)', margin: 0 }}>{copy.subtitle}</p>
      </div>

      <div className="refinement-top-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div style={{ borderRadius: 18, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'grid', gap: 14 }}>
          <div className="refinement-fields-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Field label={copy.source}>
              <select value={provider} onChange={(e) => { setProvider(e.target.value as Provider); setItemsData(null); setResults(null); setWrittenBackIds(new Set()); setExpandedItemId(''); }} style={inputStyle}>
                <option value='azure'>Azure DevOps</option>
                <option value='jira'>Jira</option>
              </select>
            </Field>
            <Field label={copy.language}>
              <input value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {provider === 'azure' ? (
            <div className="refinement-fields-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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
            <div className="refinement-fields-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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

          <div className="refinement-fields-row" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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
              </select>
            </Field>
            <Field label={copy.agentModel}>
              <select value={agentModel} onChange={(e) => setAgentModel(e.target.value)} style={inputStyle}>
                {availableModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </Field>
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

          <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 14 }}>
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

          <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 0, overflow: 'hidden' }}>
            <button
              type='button'
              onClick={() => setPromptExpanded((p) => !p)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-75)',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {copy.promptConfig}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-42)', transform: promptExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                ▼
              </span>
            </button>
            {promptExpanded && (
              <div style={{ padding: '0 14px 14px', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <button
                    onClick={() => {
                      setUseCustomPrompt(!useCustomPrompt);
                      if (!useCustomPrompt && !customPromptText) setCustomPromptText(defaultPromptText);
                    }}
                    style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: useCustomPrompt ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                      background: useCustomPrompt ? 'rgba(13,148,136,0.12)' : 'transparent',
                      color: useCustomPrompt ? '#5eead4' : 'var(--ink-50)',
                    }}
                  >
                    {useCustomPrompt ? '✓ ' : ''}{copy.useCustomPrompt}
                  </button>
                  <a
                    href='/dashboard/prompt-studio'
                    style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    {copy.editInStudio}
                  </a>
                </div>
                {useCustomPrompt && (
                  <textarea
                    value={customPromptText}
                    onChange={(e) => setCustomPromptText(e.target.value)}
                    rows={6}
                    style={{
                      ...inputStyle,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 11,
                      lineHeight: 1.5,
                      resize: 'vertical',
                      minHeight: 100,
                      borderColor: 'rgba(13,148,136,0.3)',
                    }}
                  />
                )}
                {!useCustomPrompt && defaultPromptText && (
                  <div style={{
                    fontSize: 11, color: 'var(--ink-35)', lineHeight: 1.5,
                    padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(0,0,0,0.15)', border: '1px solid var(--panel-border)',
                    maxHeight: 80, overflow: 'hidden',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>
                    {defaultPromptText.slice(0, 200)}{defaultPromptText.length > 200 ? '...' : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="refinement-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => void refreshItems()} style={primaryButton} disabled={loadingItems}>
              {loadingItems ? copy.loadingItems : copy.loadItems}
            </button>
            <button onClick={() => void runRefinement()} style={secondaryButton} disabled={running || !selectedIds.length}>
              {running ? copy.analyzing : copy.analyze}
            </button>
            {results && results.results.filter(r => !r.error).length > 0 && (
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
            )}
            <span style={{ fontSize: 12, color: 'var(--ink-35)' }}>{copy.selectionHint}</span>
          </div>

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

        <div className="refinement-stats" style={{ borderRadius: 18, border: '1px solid var(--panel-border-2)', background: 'linear-gradient(180deg, rgba(15,23,42,0.94), rgba(13,18,30,0.98))', padding: 18, display: 'grid', gap: 12 }}>
          <Stat label={copy.total} value={String(itemsData?.items.length || 0)} />
          <Stat label={copy.unestimated} value={String(itemsData?.unestimated_count || 0)} accent='#fbbf24' />
          <Stat label={copy.pointed} value={String(itemsData?.pointed_count || 0)} accent='#34d399' />
          <Stat label={copy.selected} value={String(selectedIds.length)} accent='#93c5fd' />
          <Stat label='Provider' value={agentProvider} accent='#f9a8d4' />
          <Stat label='Model' value={agentModel} accent='#cbd5e1' />
          {results && (
            <>
              <Stat label={copy.tokens} value={results.total_tokens.toLocaleString()} accent='#fca5a5' />
              <Stat label={copy.cost} value={`$${results.estimated_cost_usd.toFixed(4)}`} accent='#c4b5fd' />
              <Stat label={copy.skipped} value={String(results.skipped_count)} accent='#fcd34d' />
            </>
          )}
        </div>
      </div>

      <div className="refinement-table-wrap" style={{ borderRadius: 18, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', overflow: 'hidden' }}>
        <div style={panelHeader}>Sprint Items</div>
        {!sortedItems.length ? (
          <div style={emptyStyle}>{loadingItems ? copy.loadingItems : copy.noItems}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>{copy.select}</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>{copy.type}</th>
                  <th style={thStyle}>{copy.state}</th>
                  <th style={thStyle}>{copy.estimate}</th>
                  <th style={thStyle}>{copy.result}</th>
                  <th style={thStyle}>Title</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => {
                  const estimated = hasEstimate(item);
                  const checked = selectedIds.includes(item.id);
                  const itemSourceUrl = resultByItemId.get(item.id)?.item_url || item.web_url || '';
                  const suggestion = resultByItemId.get(item.id);
                  const isWrittenBack = writtenBackIds.has(item.id);
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        style={{
                          background: isWrittenBack
                            ? 'rgba(34,197,94,0.06)'
                            : checked ? 'rgba(59,130,246,0.08)' : 'transparent',
                          borderLeft: isWrittenBack ? '3px solid #22c55e' : '3px solid transparent',
                          cursor: suggestion ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (suggestion) setExpandedItemId(isExpanded ? '' : item.id);
                        }}
                      >
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          <input type='checkbox' checked={checked} disabled={estimated} onChange={() => toggleItem(item)} />
                        </td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{item.id}</td>
                        <td style={tdStyle}>{item.work_item_type || 'Task'}</td>
                        <td style={tdStyle}>{item.state || '-'}</td>
                        <td style={tdStyle}>
                          <span style={estimated ? estimatedPill : unestimatedPill}>{displayEstimate(item)}</span>
                        </td>
                        <td style={tdStyle}>
                          {suggestion ? (
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={suggestedPointsPill(suggestion.suggested_story_points)}>
                                {displaySuggestionEstimate(suggestion.suggested_story_points, { allowZero: true })} {copy.pts}
                              </span>
                              <span style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: suggestion.confidence >= 70 ? '#86efac' : suggestion.confidence >= 40 ? '#fde68a' : '#fca5a5',
                              }}>
                                {suggestion.confidence}%
                              </span>
                              {isWrittenBack && (
                                <span style={writtenBadge}>
                                  {provider === 'azure' ? copy.writtenBackAzure : copy.writtenBackJira}
                                </span>
                              )}
                            </div>
                          ) : '-'}
                        </td>
                        <td style={{ ...tdStyle, minWidth: 360 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              {itemSourceUrl ? (
                                <a href={itemSourceUrl} target='_blank' rel='noreferrer' style={{ fontWeight: 600, color: '#93c5fd', textDecoration: 'none' }}
                                  onClick={(e) => e.stopPropagation()}>
                                  {item.title}
                                </a>
                              ) : (
                                <div style={{ fontWeight: 600, color: 'var(--ink-90)' }}>{item.title}</div>
                              )}
                              {item.refined_before && (
                                <div style={{ fontSize: 12, color: '#fde68a', marginTop: 4 }}>
                                  Daha once yorumlandi ({item.refinement_count || 1})
                                </div>
                              )}
                              {item.assigned_to && <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 4 }}>{item.assigned_to}</div>}
                            </div>
                            {suggestion && (
                              <span style={{ fontSize: 11, color: 'var(--ink-42)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                                ▼
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && suggestion && (
                        <tr>
                          <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
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
                                  <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
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
                                  <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
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
                                      background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
                                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                      marginTop: 6,
                                    }}>
                                      {suggestion.comment || '-'}
                                    </div>
                                  </div>

                                  {/* Ambiguities & Questions side by side */}
                                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                                    <div style={expandedSection}>
                                      <div style={expandedSectionLabel}>{copy.ambiguities}</div>
                                      {suggestion.ambiguities.length ? (
                                        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--ink-75)', lineHeight: 1.6, fontSize: 13 }}>
                                          {suggestion.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
                                        </ul>
                                      ) : (
                                        <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>-</div>
                                      )}
                                    </div>
                                    <div style={expandedSection}>
                                      <div style={expandedSectionLabel}>{copy.questions}</div>
                                      {suggestion.questions.length ? (
                                        <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--ink-75)', lineHeight: 1.6, fontSize: 13 }}>
                                          {suggestion.questions.map((q, i) => <li key={i}>{q}</li>)}
                                        </ul>
                                      ) : (
                                        <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>-</div>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                      <a href={item.item_url} target='_blank' rel='noreferrer' style={{ fontSize: 15, fontWeight: 700, color: '#93c5fd', lineHeight: 1.4, textDecoration: 'none' }}
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
                      <a href={item.item_url} target='_blank' rel='noreferrer' style={{ margin: '4px 0 0', fontSize: 18, color: '#93c5fd', textDecoration: 'none', fontWeight: 700, display: 'inline-block' }}>
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
                        background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
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

      {resultsModalOpen && (
        <div style={modalOverlay} onClick={() => { setResultsModalOpen(false); setFocusedResultId(''); }}>
          <div className="refinement-modal" style={{ ...modalCard, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-90)' }}>{copy.resultsTitle}</div>
              <button type='button' style={ghostButton} onClick={() => { setResultsModalOpen(false); setFocusedResultId(''); }}>{copy.close}</button>
            </div>
            <div style={{ display: 'grid', gap: 16, maxHeight: '78vh', overflowY: 'auto', paddingRight: 4 }}>
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
                        <a href={item.item_url} target='_blank' rel='noreferrer' style={{ fontSize: 18, fontWeight: 700, color: '#93c5fd', textDecoration: 'none', display: 'block', marginTop: 4, lineHeight: 1.4 }}>
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
                    <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
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
                    <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
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
                          background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
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
      )}

      {confirmBulkWriteback && results && (
        <div style={modalOverlay} onClick={() => setConfirmBulkWriteback(false)}>
          <div style={{ ...modalCard, width: 'min(560px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}

      {confirmWritebackItemId && (() => {
        const confirmRow = resultByItemId.get(confirmWritebackItemId);
        return (
          <div style={modalOverlay} onClick={() => setConfirmWritebackItemId('')}>
            <div style={{ ...modalCard, width: 'min(520px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>
                {copy.writeConfirm}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-35)', fontFamily: 'monospace' }}>{confirmWritebackItemId}</div>
                  {confirmRow && <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-80)', marginTop: 4 }}>{confirmRow.title}</div>}
                </div>
                {confirmRow && (
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#5eead4' }}>
                      {displaySuggestionEstimate(confirmRow.suggested_story_points, { allowZero: true })}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-42)', textTransform: 'uppercase' }}>{copy.pts}</div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-50)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: provider === 'azure' ? '#38bdf8' : '#a78bfa' }} />
                {providerLabel}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type='button' style={ghostButton} onClick={() => setConfirmWritebackItemId('')}>
                  {copy.close}
                </button>
                <button
                  type='button'
                  style={writeProviderButton}
                  onClick={() => {
                    const itemId = confirmWritebackItemId;
                    setConfirmWritebackItemId('');
                    void runWritebackForItem(itemId);
                  }}
                >
                  {copy.writeToProvider} → {providerLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, accent = '#38bdf8' }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent, marginTop: 4, lineHeight: 1.2, wordBreak: 'break-word' }}>{value}</div>
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
  borderRadius: 12,
  border: '1px solid var(--panel-border-2)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--ink-90)',
  padding: '11px 12px',
  fontSize: 14,
  outline: 'none',
};

const primaryButton: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(37,99,235,0.5)',
  background: 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(14,165,233,0.9))',
  color: '#fff',
  padding: '11px 14px',
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(251,191,36,0.4)',
  background: 'rgba(251,191,36,0.08)',
  color: '#fde68a',
  padding: '11px 14px',
  fontWeight: 700,
  cursor: 'pointer',
};

const ghostButton: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'rgba(148,163,184,0.08)',
  color: '#cbd5e1',
  padding: '11px 14px',
  fontWeight: 700,
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
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--ink-35)',
  padding: '12px 14px',
  borderBottom: '1px solid var(--panel-border-2)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  fontSize: 14,
  color: 'var(--ink-70)',
  verticalAlign: 'top',
};

const unestimatedPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid rgba(251,191,36,0.35)',
  background: 'rgba(251,191,36,0.08)',
  color: '#fde68a',
  fontSize: 12,
  fontWeight: 700,
};

const estimatedPill: React.CSSProperties = {
  ...unestimatedPill,
  border: '1px solid rgba(34,197,94,0.35)',
  background: 'rgba(34,197,94,0.08)',
  color: '#86efac',
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
  inset: 0,
  background: 'rgba(2,6,23,0.74)',
  backdropFilter: 'blur(2px)',
  zIndex: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modalCard: React.CSSProperties = {
  width: 'min(980px, 96vw)',
  borderRadius: 18,
  border: '1px solid var(--panel-border-2)',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(12,18,30,0.99))',
  padding: 16,
  display: 'grid',
  gap: 12,
  maxHeight: '90vh',
};

const modelChip: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(148,163,184,0.22)',
  background: 'rgba(148,163,184,0.06)',
  color: '#cbd5e1',
  padding: '6px 10px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const activeModelChip: React.CSSProperties = {
  ...modelChip,
  border: '1px solid rgba(56,189,248,0.35)',
  background: 'rgba(56,189,248,0.15)',
  color: '#bae6fd',
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
