FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client nodejs npm && rm -rf /var/lib/apt/lists/* && \
    npm install -g @openai/codex && \
    pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8010

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8010"]
