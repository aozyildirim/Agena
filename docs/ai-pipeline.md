# Tiqr AI Pipeline — Calisma Mantigi

## Genel Bakis

Tiqr'de bir task'a AI atandiginda 2 farkli mod var:

### 1. AI Mode (Direkt Developer)
Kullanici "AI Ata" butonuna tiklar → Agent secer → Secilen agent'in model/provider'i kullanilir.

**Akis:**
```
Step 1: Fetch Context
  → Memory'den benzer task'lari ara (Qdrant kapali ise atla)
  → Repo context olustur (agents.md veya full scan)

Step 2: AI Plan
  → System: AI_PLAN_SYSTEM_PROMPT
  → Input: agents.md + task baslik/aciklama
  → Output: JSON {plan, files[], changes[]}
  → Model sadece agents.md'yi okur, hangi dosyalari degistirmesi gerektigini soyler

Step 3: Developer Code
  → System: AI_CODE_SYSTEM_PROMPT
  → Input: plan + sadece gerekli dosyalarin tam icerigi (diskten okunur)
  → Output: **File: path** bloklari ile kod
  → Model sadece 3-5 dosyaya odaklanir, tum repo'yu gormez
```

**Token kullanimi:** ~100K (plan) + ~60K (code) = ~160K token

### 2. Flow Mode (PM + Developer)
Kullanici "Flow Ata" butonuna tiklar → Flow secer → PM analiz + Developer kod yazar.

**Akis:**
```
Step 1: Fetch Context
  → Ayni (memory + repo context)

Step 2: PM Analyze
  → System: PM_SYSTEM_PROMPT
  → Input: task + context_summary (agents.md + source files dahil)
  → Output: JSON {status, score, storyPoint, file_changes[], summary, ...}
  → PM kodu analiz edip detayli degisiklik plani cikarir

Step 3: Developer Code
  → System: DEV_SYSTEM_PROMPT
  → Input: PM spec + context_summary (source files dahil)
  → Output: **File: path** bloklari ile kod
```

**Token kullanimi:** ~130K (PM) + ~130K (developer) = ~260K token

---

## agents.md Sistemi

### Nedir?
Repo tarandiginda otomatik olusan dosya. Icerigi:
- Dosya agaci (tum repo)
- Struct/class/interface tanimlari (field'lari ile)
- Fonksiyon/method imzalari (parametre ve donus tipleri)
- Dependency listesi (go.mod, package.json vs)
- Istatistikler (dosya sayisi, satir sayisi, dil dagilimi)

### Nerede aranir? (oncelik sirasi)
1. **Repo'nun kendi agents.md'si** — `{repo_root}/agents.md` veya `AGENTS.md`
2. **Tiqr'in olusturdugu** — DB profilinde kayitli path (`profile_settings.repo_profiles[id].agents_md_path`)
3. **`.tiqr/agents/` dizini** — eski format md dosyalari
4. **Fallback** — agents.md yoksa tum repo dosyalarini tarar (cok token harcar)

### Nasil olusturulur?
- Mappings sayfasinda "agents.md olustur" butonu
- Veya repo scan yapildiginda otomatik olusturulur
- API: `POST /preferences/repo-profile/agents-md`

### Neden onemli?
- 2MB repo yerine 400KB agents.md gondermek = 5x token tasarrufu
- Model dosya yapisi + tum tanimlari gorur, kaybolmaz
- AI Plan adiminda agents.md'den hangi dosyalari degistirmesi gerektigini anlar

---

## Agent Secimi ve Model Kullanimi

### Kullanici agent sectginde ne olur?
1. Frontend popup'tan agent secilir (role, model, provider)
2. API'ye `agent_role`, `agent_model`, `agent_provider` gonderilir
3. Worker queue'dan bu bilgileri okur
4. Orchestration service `routing.preferred_agent_model` ve `routing.preferred_agent_provider`'i override eder
5. LLM provider bu model/provider ile cagrilir

### Model oncelik sirasi:
1. Atama sirasinda secilen agent'in modeli (en yuksek oncelik)
2. Task description'daki `Preferred Agent Model:` metadatasi
3. Kullanicinin agent config'indeki developer role modeli
4. Default: `gpt-4o-mini`

---

## Kod Cikti Formati

Model su formatta kod doner:
```
**File: relative/path/to/file.go**
\`\`\`go
package main
// ... kod ...
\`\`\`
```

### Buyuk dosyalar icin:
Model 200+ satirlik dosyalarda sadece degisen kismi doner:
```go
// ... existing code unchanged ...

func (p *ProductProcessor) addMerchantData(product *Product) error {
    // degisen kod
}

// ... existing code unchanged ...
```

Sistem `_merge_partial_output` ile bu partial ciktiyi orijinal dosya ile birlestirip sadece degisen fonksiyonlari replace eder.

---

## LLM Cache

- **PM sonuclari:** Cache'lenir (24 saat TTL). Ayni task tekrar calistiginda PM 0 token harcar.
- **Developer sonuclari:** Cache'lenmez (`skip_cache=True`). Her seferinde fresh cikti uretir.
- **Refusal'lar:** "I'm sorry" ile baslayan yanitlar cache'lenmez.
- Redis key: `llm_cache:{sha256(model + system_prompt + user_prompt)}`

---

## Prompt Dosyalari

| Prompt | Dosya | Kullanim |
|--------|-------|----------|
| `PM_SYSTEM_PROMPT` | `agents/prompts.py` | Flow mode: PM analiz |
| `DEV_SYSTEM_PROMPT` | `agents/prompts.py` | Flow mode: Developer kod yazma |
| `AI_PLAN_SYSTEM_PROMPT` | `agents/prompts.py` | AI mode step 1: Plan |
| `AI_CODE_SYSTEM_PROMPT` | `agents/prompts.py` | AI mode step 2: Kod yazma |
| `FETCH_CONTEXT_SYSTEM_PROMPT` | `agents/prompts.py` | Memory context ozet |

---

## Dosya Yapisi

```
services/
  orchestration_service.py  — Ana pipeline (run_task_record)
  repo_scanner.py           — agents.md olusturucu
  llm/
    provider.py             — LLM cagrilari (OpenAI/Gemini)
    cache.py                — Redis LLM cache

agents/
  orchestrator.py           — LangGraph flow node'lari
  crewai_agents.py          — PM/Developer/Planner agent metodlari
  prompts.py                — System prompt'lari
  langgraph_flow.py         — Flow graph tanimi

workers/
  redis_worker.py           — Queue consumer, task calistirici

api/routes/
  saas_tasks.py             — Task CRUD + assign endpoint
  preferences.py            — Repo scan + agents.md generation
```

---

## Token Output Limitleri (AGENT_TOKEN_LIMITS)

Tum agent output token limitleri tek bir yerden kontrol edilir:
`agents/crewai_agents.py` → `AGENT_TOKEN_LIMITS` dict

Bu dict'i degistirince tum pipeline etkilenir. Baska dosyada hardcoded limit yoktur.

```python
AGENT_TOKEN_LIMITS = {
    # --- Core pipeline (orchestration_service / crewai_agents) ---
    'context': 2_000,        # fetch_context: memory & context summary
    'pm': 16_000,            # product manager: spec/analysis JSON
    'planner': 8_000,        # AI planner: plan + file list JSON
    'developer': 128_000,    # developer: code patches (ai & flow mode)
    'reviewer': 128_000,     # reviewer: reviewed patches
    'finalizer': 128_000,    # finalizer: cleaned final output
    # --- Flow executor & misc ---
    'flow_node': 8_000,      # generic flow LLM nodes
    'agent_node': 2_000,     # generic agent nodes in flows
    'pr_review': 4_000,      # PR review comments
    'agent_test': 2_000,     # agent test/preview from settings
}
```

### Nerede kullanilir?

| Key | Dosya | Metot |
|-----|-------|-------|
| `context` | `crewai_agents.py` | `fetch_context()` |
| `pm` | `crewai_agents.py` | `run_product_manager()` |
| `planner` | `crewai_agents.py` | `run_ai_plan()` |
| `developer` | `crewai_agents.py` | `run_ai_code()` + `run_developer()` |
| `reviewer` | `crewai_agents.py` | `run_reviewer()` |
| `finalizer` | `crewai_agents.py` | `finalize()` |
| `flow_node` | `flow_executor.py` | Flow LLM node calistirma |
| `agent_node` | `flow_executor.py` | Generic agent node |
| `pr_review` | `flow_executor.py` | PR review comment olusturma |
| `agent_test` | `preferences.py` | Agent test/preview endpoint |

### Degistirirken dikkat:
- `developer`, `reviewer`, `finalizer` yuksek tutulmali (128K+) — buyuk repo'larda cok dosya degisebilir
- `planner` ve `pm` orta (8-16K) — JSON cikti, cok buyumez
- `context`, `agent_node`, `agent_test` dusuk (2K) — kisa ozet ciktilari
- Model'in kendi limiti bu degerden dusukse, model limiti gecerlidir
