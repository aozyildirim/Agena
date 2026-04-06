import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Use Cases — AI Code Generation, PR Automation, Sprint Refinement | AGENA',
  description:
    'Discover how AGENA automates code generation, pull request creation, sprint refinement, and ChatOps for development teams.',
  alternates: { canonical: '/use-cases' },
};

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
