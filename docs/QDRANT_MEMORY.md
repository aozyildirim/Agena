# Qdrant Memory Guide

This document explains how vector memory works in Tiqr, what is stored, and how to verify it via Swagger/API.

## Purpose

Vector memory helps orchestration reuse relevant historical context so tasks are handled with better consistency and less prompt drift.

## Runtime Flow

1. Task enters orchestration graph (`fetch_context` stage).
2. Current task text is vectorized.
3. Similar memories are searched in Qdrant (`task_memory` collection).
4. Matches are summarized and injected into prompt context.
5. Finalized output is upserted back into memory for future tasks.

## Stored Payload Fields

- `key`: task id
- `organization_id`: tenant scope key (used for retrieval filter)
- `input`: task title + effective description snapshot
- `output`: finalized generated code snapshot

## Security Scope

- Retrieval is filtered by `organization_id` to avoid cross-tenant recall.
- Memory API endpoints are auth-protected.

## Docker Setup

Qdrant is included in `docker-compose.yml`:

- service: `qdrant`
- url: `http://qdrant:6333` (inside network)
- host port: `6333`

Required environment settings:

```env
QDRANT_ENABLED=true
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=task_memory
```

## Swagger / API Endpoints

- `GET /memory/status`
  - backend enabled/disabled
  - collection and vector settings
  - points/vector counts
- `GET /memory/schema`
  - what fields are stored
  - retrieval flow
  - constraints and privacy scope

## Current Limitation

Current embedding mode is deterministic placeholder baseline.
For stronger semantic quality, replace it with real embedding provider calls in a future iteration.
