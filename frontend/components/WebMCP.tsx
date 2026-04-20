'use client';

import { useEffect } from 'react';

declare global {
  interface Navigator {
    modelContext?: {
      provideContext: (ctx: unknown) => void | Promise<void>;
    };
  }
}

export default function WebMCP() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const mc = (navigator as Navigator).modelContext;
    if (!mc || typeof mc.provideContext !== 'function') return;

    const tools = [
      {
        name: 'agena_signup',
        description: 'Open the AGENA signup page so the user can create a free account.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          window.location.assign('/signup');
          return { ok: true, navigated_to: '/signup' };
        },
      },
      {
        name: 'agena_search_blog',
        description: 'Search AGENA blog posts by query string.',
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string', description: 'Search query' } },
          required: ['q'],
          additionalProperties: false,
        },
        execute: async ({ q }: { q: string }) => {
          const url = `/blog?q=${encodeURIComponent(q)}`;
          window.location.assign(url);
          return { ok: true, navigated_to: url };
        },
      },
      {
        name: 'agena_open_docs',
        description: 'Open the AGENA documentation, optionally to a specific section anchor.',
        inputSchema: {
          type: 'object',
          properties: { section: { type: 'string', description: 'Anchor like "integrations", "tasks", "pipeline"' } },
          additionalProperties: false,
        },
        execute: async ({ section }: { section?: string }) => {
          const url = section ? `/docs#${section}` : '/docs';
          window.location.assign(url);
          return { ok: true, navigated_to: url };
        },
      },
      {
        name: 'agena_contact',
        description: 'Open the AGENA contact form so the user can reach the team.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          window.location.assign('/contact');
          return { ok: true, navigated_to: '/contact' };
        },
      },
      {
        name: 'agena_view_pricing',
        description: 'Open the AGENA pricing page (Free vs Pro plans).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          window.location.assign('/pricing');
          return { ok: true, navigated_to: '/pricing' };
        },
      },
      {
        name: 'agena_book_demo',
        description: 'Open the AGENA demo / contact page to schedule a product demo.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          window.location.assign('/contact?intent=demo');
          return { ok: true, navigated_to: '/contact?intent=demo' };
        },
      },
    ];

    try {
      mc.provideContext({
        tools,
        resources: [
          {
            uri: 'https://agena.dev/.well-known/api-catalog',
            name: 'AGENA API Catalog',
            mimeType: 'application/linkset+json',
          },
          {
            uri: 'https://agena.dev/.well-known/mcp/server-card.json',
            name: 'AGENA MCP Server Card',
            mimeType: 'application/json',
          },
        ],
      });
    } catch (e) {
      // navigator.modelContext is experimental; fail silently if browser rejects.
    }
  }, []);

  return null;
}
