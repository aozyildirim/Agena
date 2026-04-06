'use client';

import { useLocale } from '@/lib/i18n';
import ComparisonPage from '../ComparisonPage';

export default function VsCursorPage() {
  const { t } = useLocale();

  return (
    <ComparisonPage
      slug='cursor'
      competitorName='Cursor'
      rows={[
        { feature: 'approach', agena: t('vs.cursor.approach.agena'), competitor: t('vs.cursor.approach.competitor') },
        { feature: 'prCreation', agena: t('vs.cursor.pr.agena'), competitor: t('vs.cursor.pr.competitor') },
        { feature: 'codeReview', agena: t('vs.cursor.review.agena'), competitor: t('vs.cursor.review.competitor') },
        { feature: 'multiRepo', agena: t('vs.yes') + ' ' + t('vs.feature.multiRepo'), competitor: t('vs.cursor.multiRepo.competitor') },
        { feature: 'dependencies', agena: t('vs.yes') + ' ' + t('vs.feature.dependencies'), competitor: t('vs.cursor.dependencies.competitor') },
        { feature: 'sprint', agena: t('vs.yes') + ' Azure/Jira', competitor: t('vs.cursor.sprint.competitor') },
        { feature: 'chatops', agena: t('vs.yes') + ' Slack/Teams/Telegram', competitor: t('vs.cursor.chatops.competitor') },
        { feature: 'office', agena: t('vs.yes') + ' Pixel Agent', competitor: t('vs.cursor.office.competitor') },
        { feature: 'selfHosted', agena: t('vs.yes') + ' Docker Compose', competitor: t('vs.cursor.selfHosted.competitor') },
        { feature: 'pricing', agena: t('vs.cursor.pricing.agena'), competitor: t('vs.cursor.pricing.competitor') },
      ]}
    />
  );
}
