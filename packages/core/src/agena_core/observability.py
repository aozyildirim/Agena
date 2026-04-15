from __future__ import annotations

import logging

from agena_core.settings import get_settings

logger = logging.getLogger(__name__)


def init_sentry(service_name: str) -> bool:
    settings = get_settings()
    if not settings.sentry_enabled:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except Exception as exc:
        logger.warning('Sentry SDK could not be imported: %s', exc)
        return False

    sentry_logging = LoggingIntegration(
        level=logging.INFO,
        event_level=logging.ERROR,
    )

    integrations = [sentry_logging]
    if service_name == 'api':
        integrations.append(FastApiIntegration(transaction_style='endpoint'))

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.effective_sentry_environment,
        release=(settings.sentry_release or None),
        integrations=integrations,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=settings.sentry_profiles_sample_rate,
        send_default_pii=settings.sentry_send_default_pii,
        attach_stacktrace=True,
        max_breadcrumbs=100,
    )
    sentry_sdk.set_tag('service', service_name)
    logger.info(
        'Sentry initialized (service=%s, env=%s)',
        service_name,
        settings.effective_sentry_environment,
    )
    return True
