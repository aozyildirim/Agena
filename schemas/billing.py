from pydantic import BaseModel


class PlanChangeRequest(BaseModel):
    plan_name: str


class BillingStatusResponse(BaseModel):
    plan_name: str
    status: str
    tasks_used: int
    tokens_used: int


class StripeCheckoutRequest(BaseModel):
    success_url: str
    cancel_url: str


class StripeCheckoutResponse(BaseModel):
    checkout_url: str


class IyzicoCheckoutRequest(BaseModel):
    plan_name: str = 'pro'
    callback_url: str


class IyzicoCheckoutResponse(BaseModel):
    checkout_form_content: str
