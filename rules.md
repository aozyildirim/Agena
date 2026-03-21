# Project Rules

1. Assistant responses must be in English.
2. Any new user-facing UI text must be multilingual via `frontend/lib/i18n.ts`.
3. Do not hardcode locale-specific strings directly inside pages/components when `useLocale()` is available.
4. For every new translation key, add both `tr` and `en` entries to keep language switching consistent.
