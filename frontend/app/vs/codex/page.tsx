'use client';

import { useLocale } from '@/lib/i18n';
import ComparisonPage from '../ComparisonPage';

export default function VsCodexPage() {
  const { t } = useLocale();

  return (
    <ComparisonPage
      slug='codex'
      competitorName='OpenAI Codex'
      rows={[
        { feature: 'approach', agena: t('vs.codex.approach.agena'), competitor: t('vs.codex.approach.competitor') },
        { feature: 'prCreation', agena: t('vs.codex.pr.agena'), competitor: t('vs.codex.pr.competitor') },
        { feature: 'codeReview', agena: t('vs.codex.review.agena'), competitor: t('vs.codex.review.competitor') },
        { feature: 'multiRepo', agena: t('vs.yes') + ' ' + t('vs.feature.multiRepo'), competitor: t('vs.codex.multiRepo.competitor') },
        { feature: 'dependencies', agena: t('vs.yes') + ' ' + t('vs.feature.dependencies'), competitor: t('vs.codex.dependencies.competitor') },
        { feature: 'sprint', agena: t('vs.yes') + ' Azure/Jira', competitor: t('vs.codex.sprint.competitor') },
        { feature: 'chatops', agena: t('vs.yes') + ' Slack/Teams/Telegram', competitor: t('vs.codex.chatops.competitor') },
        { feature: 'office', agena: t('vs.yes') + ' Pixel Agent', competitor: t('vs.codex.office.competitor') },
        { feature: 'selfHosted', agena: t('vs.yes') + ' Docker Compose', competitor: t('vs.codex.selfHosted.competitor') },
        { feature: 'pricing', agena: t('vs.codex.pricing.agena'), competitor: t('vs.codex.pricing.competitor') },
      ]}
    />
  );
}
