from pydantic import BaseModel

from schemas.task import ExternalTask


class AgentRunRequest(BaseModel):
    task: ExternalTask
    create_pr: bool = True
    async_mode: bool = True


class UsageStats(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class AgentRunResult(BaseModel):
    task_id: str
    spec: dict
    generated_code: str
    reviewed_code: str
    usage: UsageStats
    pr_url: str | None = None


class AgentRunResponse(BaseModel):
    status: str
    queue_key: str | None = None
    result: AgentRunResult | None = None
