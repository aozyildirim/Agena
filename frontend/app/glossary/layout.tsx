import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI & DevOps Glossary — AGENA',
  description:
    'Technical glossary of agentic AI, LLM, RAG, DORA metrics, and DevOps terms. Learn key concepts in AI-powered software development.',
  alternates: { canonical: '/glossary' },
};

export default function GlossaryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
