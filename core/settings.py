from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', case_sensitive=False)

    app_name: str = 'Tiqr AI Agent SaaS'
    app_env: str = Field(default='development', alias='APP_ENV')
    app_host: str = Field(default='0.0.0.0', alias='APP_HOST')
    app_port: int = Field(default=8010, alias='APP_PORT')
    host_repo_root: str = Field(default='/Users', alias='HOST_REPO_ROOT')

    openai_api_key: str = Field(default='', alias='OPENAI_API_KEY')
    openai_base_url: str = Field(default='https://api.openai.com/v1', alias='OPENAI_BASE_URL')
    llm_model: str = Field(default='gpt-4o', alias='LLM_MODEL')
    llm_small_model: str = Field(default='gpt-4o-mini', alias='LLM_SMALL_MODEL')
    llm_large_model: str = Field(default='gpt-4o', alias='LLM_LARGE_MODEL')

    jwt_secret_key: str = Field(default='change_me', alias='JWT_SECRET_KEY')
    jwt_algorithm: str = Field(default='HS256', alias='JWT_ALGORITHM')
    jwt_access_token_exp_minutes: int = Field(default=60 * 24, alias='JWT_ACCESS_TOKEN_EXP_MINUTES')

    jira_base_url: str = Field(default='', alias='JIRA_BASE_URL')
    jira_email: str = Field(default='', alias='JIRA_EMAIL')
    jira_api_token: str = Field(default='', alias='JIRA_API_TOKEN')
    jira_project_key: str = Field(default='', alias='JIRA_PROJECT_KEY')

    azure_org_url: str = Field(default='', alias='AZURE_ORG_URL')
    azure_project: str = Field(default='', alias='AZURE_PROJECT')
    azure_pat: str = Field(default='', alias='AZURE_PAT')

    github_token: str = Field(default='', alias='GITHUB_TOKEN')
    github_owner: str = Field(default='', alias='GITHUB_OWNER')
    github_repo: str = Field(default='', alias='GITHUB_REPO')
    github_default_base_branch: str = Field(default='main', alias='GITHUB_DEFAULT_BASE_BRANCH')

    stripe_secret_key: str = Field(default='', alias='STRIPE_SECRET_KEY')
    stripe_webhook_secret: str = Field(default='', alias='STRIPE_WEBHOOK_SECRET')
    stripe_price_pro: str = Field(default='', alias='STRIPE_PRICE_PRO')

    iyzico_api_key: str = Field(default='', alias='IYZICO_API_KEY')
    iyzico_secret_key: str = Field(default='', alias='IYZICO_SECRET_KEY')
    iyzico_base_url: str = Field(default='https://sandbox-api.iyzipay.com', alias='IYZICO_BASE_URL')
    iyzico_webhook_secret: str = Field(default='', alias='IYZICO_WEBHOOK_SECRET')

    mysql_host: str = Field(default='mysql', alias='MYSQL_HOST')
    mysql_port: int = Field(default=3306, alias='MYSQL_PORT')
    mysql_user: str = Field(default='app_user', alias='MYSQL_USER')
    mysql_password: str = Field(default='app_password', alias='MYSQL_PASSWORD')
    mysql_database: str = Field(default='ai_agent_db', alias='MYSQL_DATABASE')

    redis_host: str = Field(default='redis', alias='REDIS_HOST')
    redis_port: int = Field(default=6379, alias='REDIS_PORT')
    redis_db: int = Field(default=0, alias='REDIS_DB')
    redis_password: Optional[str] = Field(default=None, alias='REDIS_PASSWORD')
    redis_queue_name: str = Field(default='agent_tasks', alias='REDIS_QUEUE_NAME')
    max_workers: int = Field(default=8, alias='MAX_WORKERS')
    queue_lock_max_retries: int = Field(default=20, alias='QUEUE_LOCK_MAX_RETRIES')
    task_running_timeout_minutes: int = Field(default=180, alias='TASK_RUNNING_TIMEOUT_MINUTES')

    qdrant_enabled: bool = Field(default=False, alias='QDRANT_ENABLED')
    qdrant_url: str = Field(default='http://qdrant:6333', alias='QDRANT_URL')
    qdrant_api_key: Optional[str] = Field(default=None, alias='QDRANT_API_KEY')
    qdrant_collection: str = Field(default='task_memory', alias='QDRANT_COLLECTION')
    qdrant_embedding_provider: str = Field(default='openai', alias='QDRANT_EMBEDDING_PROVIDER')
    qdrant_openai_embedding_model: str = Field(default='text-embedding-3-small', alias='QDRANT_OPENAI_EMBEDDING_MODEL')
    qdrant_gemini_embedding_model: str = Field(default='text-embedding-004', alias='QDRANT_GEMINI_EMBEDDING_MODEL')
    qdrant_gemini_api_key: Optional[str] = Field(default=None, alias='QDRANT_GEMINI_API_KEY')
    qdrant_embedding_timeout_sec: int = Field(default=25, alias='QDRANT_EMBEDDING_TIMEOUT_SEC')

    max_agent_retries: int = Field(default=3, alias='MAX_AGENT_RETRIES')
    max_context_chars: int = Field(default=500000, alias='MAX_CONTEXT_CHARS')
    max_code_context_chars: int = Field(default=500000, alias='MAX_CODE_CONTEXT_CHARS')

    smtp_host: str = Field(default='', alias='SMTP_HOST')
    smtp_port: int = Field(default=587, alias='SMTP_PORT')
    smtp_user: str = Field(default='', alias='SMTP_USER')
    smtp_password: str = Field(default='', alias='SMTP_PASSWORD')
    smtp_from_email: str = Field(default='noreply@tiqr.local', alias='SMTP_FROM_EMAIL')
    smtp_from_name: str = Field(default='Tiqr AI', alias='SMTP_FROM_NAME')
    smtp_use_tls: bool = Field(default=True, alias='SMTP_USE_TLS')
    smtp_use_ssl: bool = Field(default=False, alias='SMTP_USE_SSL')
    pr_webhook_secret: str = Field(default='', alias='PR_WEBHOOK_SECRET')

    @property
    def sqlalchemy_database_uri(self) -> str:
        return (
            f'mysql+aiomysql://{self.mysql_user}:{self.mysql_password}'
            f'@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}'
        )

    @property
    def redis_url(self) -> str:
        auth = f':{self.redis_password}@' if self.redis_password else ''
        return f'redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}'


@lru_cache
def get_settings() -> Settings:
    return Settings()
