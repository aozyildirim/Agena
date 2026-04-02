from pydantic import BaseModel, Field


class GitHubFileChange(BaseModel):
    path: str
    content: str


class CreatePRRequest(BaseModel):
    branch_name: str
    title: str
    body: str
    base_branch: str = 'main'
    commit_message: str = 'feat: add generated code'
    files: list[GitHubFileChange] = Field(default_factory=list)


class CreatePRResponse(BaseModel):
    pr_url: str
    branch_name: str
