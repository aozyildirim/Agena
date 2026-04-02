from enum import StrEnum


class PlanName(StrEnum):
    FREE = 'free'
    PRO = 'pro'


class TaskStatus(StrEnum):
    QUEUED = 'queued'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'


class PaymentProvider(StrEnum):
    STRIPE = 'stripe'
    IYZICO = 'iyzico'


class PaymentStatus(StrEnum):
    PENDING = 'pending'
    PAID = 'paid'
    FAILED = 'failed'
