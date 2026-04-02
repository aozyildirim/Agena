FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends --fix-missing \
    git openssh-client curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Corporate SSL certificate (FLO McAfee Web Gateway)
COPY docker/InternalProxy.crt /usr/local/share/ca-certificates/InternalProxy.crt
RUN update-ca-certificates
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

# Python deps (requirements.txt degismezse cache'den gelir)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy package definitions (cache layer)
COPY packages/core/pyproject.toml packages/core/pyproject.toml
COPY packages/models/pyproject.toml packages/models/pyproject.toml
COPY packages/services/pyproject.toml packages/services/pyproject.toml
COPY packages/agents/pyproject.toml packages/agents/pyproject.toml
COPY packages/api/pyproject.toml packages/api/pyproject.toml
COPY packages/worker/pyproject.toml packages/worker/pyproject.toml

# Copy package sources
COPY packages/ packages/

# Install all packages in dependency order
RUN pip install --no-cache-dir \
    -e packages/core \
    -e packages/models \
    -e packages/services \
    -e packages/agents \
    -e packages/api \
    -e packages/worker

# Copy root-level files (alembic, scripts, etc.)
COPY alembic/ alembic/
COPY alembic.ini alembic.ini
COPY cli_bridge.py cli_bridge.py

EXPOSE 8010

CMD ["uvicorn", "agena_api.api.main:app", "--host", "0.0.0.0", "--port", "8010"]
