from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.settings import get_settings
from agena_models.models.payment_record import PaymentRecord
from agena_models.models.subscription import Subscription


class BillingService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.settings = get_settings()

    async def get_subscription(self, organization_id: int) -> Subscription:
        result = await self.db.execute(select(Subscription).where(Subscription.organization_id == organization_id))
        subscription = result.scalar_one_or_none()
        if subscription is None:
            subscription = Subscription(organization_id=organization_id, plan_name='free', status='active')
            self.db.add(subscription)
            await self.db.commit()
            await self.db.refresh(subscription)
        return subscription

    async def set_plan(self, organization_id: int, plan_name: str, status: str = 'active') -> Subscription:
        sub = await self.get_subscription(organization_id)
        sub.plan_name = plan_name
        sub.status = status
        await self.db.commit()
        await self.db.refresh(sub)
        return sub

    async def create_stripe_checkout(self, organization_id: int, success_url: str, cancel_url: str) -> str:
        if not self.settings.stripe_secret_key:
            return 'https://example.com/stripe-mock-checkout'

        url = 'https://api.stripe.com/v1/checkout/sessions'
        data = {
            'mode': 'subscription',
            'success_url': success_url,
            'cancel_url': cancel_url,
            'line_items[0][price]': self.settings.stripe_price_pro,
            'line_items[0][quantity]': '1',
            'metadata[organization_id]': str(organization_id),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, data=data, auth=(self.settings.stripe_secret_key, ''))
            response.raise_for_status()
            payload = response.json()
            return payload.get('url', '')

    async def handle_stripe_webhook(self, raw_body: bytes, signature: str | None) -> dict[str, Any]:
        _ = signature
        event = json.loads(raw_body.decode('utf-8'))
        event_type = event.get('type', '')
        obj = event.get('data', {}).get('object', {})

        organization_id = int(obj.get('metadata', {}).get('organization_id', 0) or 0)
        if not organization_id:
            return {'ok': False, 'reason': 'organization_id missing'}

        if event_type in {'checkout.session.completed', 'customer.subscription.updated'}:
            await self.set_plan(organization_id=organization_id, plan_name='pro', status='active')
            payment = PaymentRecord(
                organization_id=organization_id,
                provider='stripe',
                status='paid',
                amount=0,
                currency='USD',
                external_payment_id=str(obj.get('id', '')),
                payload=event,
            )
            self.db.add(payment)
            await self.db.commit()
        return {'ok': True}

    async def create_iyzico_checkout(self, organization_id: int, callback_url: str, plan_name: str) -> str:
        payload = {
            'locale': 'tr',
            'conversationId': str(uuid4()),
            'price': '999.00',
            'paidPrice': '999.00',
            'currency': 'TRY',
            'basketId': f'org-{organization_id}',
            'paymentGroup': 'SUBSCRIPTION',
            'callbackUrl': callback_url,
            'enabledInstallments': [1],
            'buyer': {
                'id': str(organization_id),
                'name': 'Org',
                'surname': 'Owner',
                'gsmNumber': '+905555555555',
                'email': 'billing@example.com',
                'identityNumber': '11111111111',
                'registrationAddress': 'Istanbul',
                'city': 'Istanbul',
                'country': 'Turkey',
                'zipCode': '34000',
            },
            'shippingAddress': {
                'contactName': 'Org Owner',
                'city': 'Istanbul',
                'country': 'Turkey',
                'address': 'Istanbul',
                'zipCode': '34000',
            },
            'billingAddress': {
                'contactName': 'Org Owner',
                'city': 'Istanbul',
                'country': 'Turkey',
                'address': 'Istanbul',
                'zipCode': '34000',
            },
            'basketItems': [
                {
                    'id': 'PRO_PLAN',
                    'name': 'Pro Plan',
                    'category1': 'SaaS',
                    'itemType': 'VIRTUAL',
                    'price': '999.00',
                }
            ],
            'metadata': {'organization_id': organization_id, 'plan_name': plan_name},
        }

        if not self.settings.iyzico_api_key:
            return '<div>iyzico mock checkout form</div>'

        async with httpx.AsyncClient(timeout=30) as client:
            headers = self._iyzico_headers('/payment/iyzipos/checkoutform/initialize/auth/ecom', payload)
            response = await client.post(
                f'{self.settings.iyzico_base_url}/payment/iyzipos/checkoutform/initialize/auth/ecom',
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get('checkoutFormContent', '<div>iyzico unavailable</div>')

    async def handle_iyzico_webhook(self, payload: dict[str, Any], signature: str | None) -> dict[str, Any]:
        if signature and self.settings.iyzico_webhook_secret:
            expected = hmac.new(
                self.settings.iyzico_webhook_secret.encode('utf-8'),
                json.dumps(payload, separators=(',', ':')).encode('utf-8'),
                hashlib.sha256,
            ).hexdigest()
            if signature != expected:
                return {'ok': False, 'reason': 'invalid signature'}

        organization_id = int(payload.get('organization_id', 0) or 0)
        if not organization_id:
            return {'ok': False, 'reason': 'organization_id missing'}

        await self.set_plan(organization_id=organization_id, plan_name='pro', status='active')
        payment = PaymentRecord(
            organization_id=organization_id,
            provider='iyzico',
            status='paid',
            amount=float(payload.get('paidPrice', 0) or 0),
            currency=payload.get('currency', 'TRY'),
            external_payment_id=str(payload.get('paymentId', '')),
            payload=payload,
        )
        self.db.add(payment)
        await self.db.commit()
        return {'ok': True}

    def _iyzico_headers(self, uri: str, payload: dict[str, Any]) -> dict[str, str]:
        body = json.dumps(payload, separators=(',', ':'))
        signature = hmac.new(
            self.settings.iyzico_secret_key.encode('utf-8'),
            (uri + body).encode('utf-8'),
            hashlib.sha256,
        ).hexdigest()
        return {
            'Authorization': f'IYZWS {self.settings.iyzico_api_key}:{signature}',
            'Content-Type': 'application/json',
        }
