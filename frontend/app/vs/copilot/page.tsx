'use client';

import { useLocale } from '@/lib/i18n';
import ComparisonPage from '../ComparisonPage';

export default function VsCopilotPage() {
  const { t } = useLocale();

  return (
    <ComparisonPage
      slug='copilot'
      competitorName='GitHub Copilot'
      rows={[
        { feature: 'approach', agena: t('vs.copilot.approach.agena'), competitor: t('vs.copilot.approach.competitor') },
        { feature: 'prCreation', agena: t('vs.copilot.pr.agena'), competitor: t('vs.copilot.pr.competitor') },
        { feature: 'codeReview', agena: t('vs.copilot.review.agena'), competitor: t('vs.copilot.review.competitor') },
        { feature: 'multiRepo', agena: t('vs.yes') + ' ' + t('vs.feature.multiRepo'), competitor: t('vs.copilot.multiRepo.competitor') },
        { feature: 'dependencies', agena: t('vs.yes') + ' ' + t('vs.feature.dependencies'), competitor: t('vs.copilot.dependencies.competitor') },
        { feature: 'sprint', agena: t('vs.yes') + ' Azure/Jira', competitor: t('vs.copilot.sprint.competitor') },
        { feature: 'chatops', agena: t('vs.yes') + ' Slack/Teams/Telegram', competitor: t('vs.copilot.chatops.competitor') },
        { feature: 'office', agena: t('vs.yes') + ' Pixel Agent', competitor: t('vs.copilot.office.competitor') },
        { feature: 'selfHosted', agena: t('vs.yes') + ' Docker Compose', competitor: t('vs.copilot.selfHosted.competitor') },
        { feature: 'pricing', agena: t('vs.copilot.pricing.agena'), competitor: t('vs.copilot.pricing.competitor') },
      ]}
    />
  );
}
