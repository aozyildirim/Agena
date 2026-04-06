'use client';

import { useLocale } from '@/lib/i18n';
import ComparisonPage from '../ComparisonPage';

export default function VsDevinPage() {
  const { t } = useLocale();

  return (
    <ComparisonPage
      slug='devin'
      competitorName='Devin'
      rows={[
        { feature: 'approach', agena: t('vs.devin.approach.agena'), competitor: t('vs.devin.approach.competitor') },
        { feature: 'prCreation', agena: t('vs.devin.pr.agena'), competitor: t('vs.devin.pr.competitor') },
        { feature: 'codeReview', agena: t('vs.devin.review.agena'), competitor: t('vs.devin.review.competitor') },
        { feature: 'multiRepo', agena: t('vs.yes') + ' ' + t('vs.feature.multiRepo'), competitor: t('vs.devin.multiRepo.competitor') },
        { feature: 'dependencies', agena: t('vs.yes') + ' ' + t('vs.feature.dependencies'), competitor: t('vs.devin.dependencies.competitor') },
        { feature: 'sprint', agena: t('vs.yes') + ' Azure/Jira', competitor: t('vs.devin.sprint.competitor') },
        { feature: 'chatops', agena: t('vs.yes') + ' Slack/Teams/Telegram', competitor: t('vs.devin.chatops.competitor') },
        { feature: 'office', agena: t('vs.yes') + ' Pixel Agent', competitor: t('vs.devin.office.competitor') },
        { feature: 'selfHosted', agena: t('vs.yes') + ' Docker Compose', competitor: t('vs.devin.selfHosted.competitor') },
        { feature: 'pricing', agena: t('vs.devin.pricing.agena'), competitor: t('vs.devin.pricing.competitor') },
      ]}
    />
  );
}
