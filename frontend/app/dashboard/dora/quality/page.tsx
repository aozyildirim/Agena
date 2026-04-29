'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchDoraQuality, type DoraQualityResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import RepoSelector from '@/components/RepoSelector';
import { useRepoIdParam } from '@/lib/useRepoIdParam';
import { useDoraPeriodDays } from '@/lib/useDoraPeriodDays';
import DoraPeriodTabs from '@/components/DoraPeriodTabs';

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 24,
};

const BENCHMARK_COLORS: Record<string, string> = {
  elite: '#22c55e',
  high: '#3b82f6',
  medium: '#eab308',
  low: '#ef4444',
};

export default function DoraQualityPage() {
  const { t } = useLocale();
  const [data, setData] = useState<DoraQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [repoId, setRepoId] = useRepoIdParam();
  const [periodDays, setPeriodDays] = useDoraPeriodDays();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetchDoraQuality(periodDays, repoId);
        if (active) setData(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [repoId, periodDays]);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div>
        <Link href="/dashboard/dora" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>
          DORA &rsaquo;
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: '8px 0 0' }}>
          {t('dora.quality.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>
          {t('dora.quality.subtitle')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <RepoSelector value={repoId} onSelect={setRepoId} />
          <DoraPeriodTabs value={periodDays} onChange={setPeriodDays} />
        </div>
      </div>

      {error && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 40 }}>
          Loading...
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <KpiCard
              label={t('dora.quality.successRate')}
              value={`${data.success_rate}%`}
              color={data.success_rate >= 85 ? '#22c55e' : data.success_rate >= 70 ? '#eab308' : '#ef4444'}
              sub={`${data.completed} ${t('dora.quality.completed')} / ${data.failed} ${t('dora.quality.failed')}`}
            />
            <KpiCard
              label={t('dora.quality.firstTimeRate')}
              value={`${data.first_time_rate}%`}
              color={data.first_time_rate >= 80 ? '#22c55e' : data.first_time_rate >= 60 ? '#eab308' : '#ef4444'}
            />
            <BenchmarkCard
              label={t('dora.quality.benchmark')}
              benchmark={data.benchmark}
              t={t}
            />
          </div>

          {/* Quality Trend */}
          <div style={box}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 4px' }}>
              {t('dora.quality.trend')}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 16px' }}>
              {t('dora.quality.trendDesc')}
            </p>
            {data.daily_trend.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.quality.noData')}</div>
            ) : (
              <LineChart
                data={data.daily_trend.map((d) => ({
                  label: d.date,
                  value: d.success_rate,
                }))}
                height={220}
                lineColor="#22c55e"
                fillColor="rgba(34,197,94,0.12)"
              />
            )}
          </div>

          {/* Failure Categories + Benchmark Legend */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            {/* Failure Categories Bar Chart */}
            <div style={box}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
                {t('dora.quality.failureCategories')}
              </h2>
              {data.failure_categories.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.quality.noData')}</div>
              ) : (
                <BarChart
                  data={data.failure_categories.map((fc) => ({
                    label: fc.reason,
                    value: fc.count,
                  }))}
                  height={220}
                  barColor="#ef4444"
                />
              )}
            </div>

            {/* Benchmark Thresholds Legend */}
            <div style={box}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
                {t('dora.quality.thresholds')}
              </h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {(['elite', 'high', 'medium', 'low'] as const).map((level) => {
                  const isActive = data.benchmark === level;
                  return (
                    <div
                      key={level}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        border: isActive
                          ? `2px solid ${BENCHMARK_COLORS[level]}`
                          : '1px solid var(--panel-border-2)',
                        background: isActive ? `${BENCHMARK_COLORS[level]}18` : 'transparent',
                      }}
                    >
                      <div style={{
                        width: 12, height: 12, borderRadius: '50%',
                        background: BENCHMARK_COLORS[level],
                        flexShrink: 0,
                      }} />
                      <div style={{
                        fontSize: 14,
                        fontWeight: isActive ? 700 : 400,
                        color: isActive ? BENCHMARK_COLORS[level] : 'var(--ink)',
                      }}>
                        {t(`dora.quality.${level}` as Parameters<typeof t>[0])}
                        {isActive && ' *'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      ...box,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function BenchmarkCard({
  label,
  benchmark,
  t,
}: {
  label: string;
  benchmark: string;
  t: (key: never) => string;
}) {
  const color = BENCHMARK_COLORS[benchmark] || '#6b7280';
  const displayKey = `dora.quality.${benchmark}`;
  return (
    <div style={{
      ...box,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      borderColor: `${color}44`,
      background: `${color}0a`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          background: color, flexShrink: 0,
        }} />
        <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>
          {t(displayKey as never)}
        </div>
      </div>
    </div>
  );
}
