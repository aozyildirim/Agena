from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant, require_permission
from agena_core.database import get_db_session
from agena_models.schemas.billing import (
    BillingStatusResponse,
    IyzicoCheckoutRequest,
    IyzicoCheckoutResponse,
    PlanChangeRequest,
    QuotaResponse,
    StripeCheckoutRequest,
    StripeCheckoutResponse,
)
from agena_services.services.billing_service import BillingService
from agena_services.services.quota_service import QuotaService
from agena_services.services.usage_service import UsageService

router = APIRouter(prefix='/billing', tags=['billing'])


@router.get('/status', response_model=BillingStatusResponse)
async def billing_status(
    tenant: CurrentTenant = Depends(require_permission('billing:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> BillingStatusResponse:
    billing = BillingService(db)
    usage_service = UsageService(db)
    sub = await billing.get_subscription(tenant.organization_id)
    usage = await usage_service.get_or_create_usage(tenant.organization_id)
    return BillingStatusResponse(
        plan_name=sub.plan_name,
        status=sub.status,
        tasks_used=usage.tasks_used,
        tokens_used=usage.tokens_used,
    )


@router.post('/plan', response_model=BillingStatusResponse)
async def change_plan(
    request: PlanChangeRequest,
    tenant: CurrentTenant = Depends(require_permission('billing:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> BillingStatusResponse:
    billing = BillingService(db)
    usage_service = UsageService(db)
    sub = await billing.set_plan(tenant.organization_id, request.plan_name, status='active')
    usage = await usage_service.get_or_create_usage(tenant.organization_id)
    return BillingStatusResponse(
        plan_name=sub.plan_name,
        status=sub.status,
        tasks_used=usage.tasks_used,
        tokens_used=usage.tokens_used,
    )


@router.post('/stripe/checkout', response_model=StripeCheckoutResponse)
async def stripe_checkout(
    request: StripeCheckoutRequest,
    tenant: CurrentTenant = Depends(require_permission('billing:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> StripeCheckoutResponse:
    service = BillingService(db)
    url = await service.create_stripe_checkout(
        organization_id=tenant.organization_id,
        success_url=request.success_url,
        cancel_url=request.cancel_url,
    )
    return StripeCheckoutResponse(checkout_url=url)


@router.post('/stripe/webhook')
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    stripe_signature: str | None = Header(default=None, alias='Stripe-Signature'),
) -> dict:
    payload = await request.body()
    service = BillingService(db)
    return await service.handle_stripe_webhook(payload, stripe_signature)


@router.post('/iyzico/checkout', response_model=IyzicoCheckoutResponse)
async def iyzico_checkout(
    request: IyzicoCheckoutRequest,
    tenant: CurrentTenant = Depends(require_permission('billing:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> IyzicoCheckoutResponse:
    service = BillingService(db)
    form = await service.create_iyzico_checkout(
        organization_id=tenant.organization_id,
        callback_url=request.callback_url,
        plan_name=request.plan_name,
    )
    return IyzicoCheckoutResponse(checkout_form_content=form)


@router.post('/iyzico/webhook')
async def iyzico_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    x_iyzico_signature: str | None = Header(default=None, alias='X-IYZICO-Signature'),
) -> dict:
    payload = await request.json()
    service = BillingService(db)
    return await service.handle_iyzico_webhook(payload=payload, signature=x_iyzico_signature)


@router.get('/quota', response_model=QuotaResponse)
async def billing_quota(
    tenant: CurrentTenant = Depends(require_permission('billing:manage')),
    db: AsyncSession = Depends(get_db_session),
) -> QuotaResponse:
    quota = QuotaService(db)
    summary = await quota.get_usage_summary(tenant.organization_id)
    return QuotaResponse(**summary)
