from fastapi import APIRouter, Depends

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, get_github_service
from agena_models.schemas.github import CreatePRRequest, CreatePRResponse
from agena_services.services.github_service import GitHubService

router = APIRouter(prefix='/github', tags=['github'])


@router.post('/pr', response_model=CreatePRResponse)
async def create_pr(
    request: CreatePRRequest,
    _: CurrentTenant = Depends(get_current_tenant),
    github_service: GitHubService = Depends(get_github_service),
) -> CreatePRResponse:
    pr_url = await github_service.create_pr(request)
    return CreatePRResponse(pr_url=pr_url, branch_name=request.branch_name)
