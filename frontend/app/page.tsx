'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import PricingCard from '@/components/PricingCard';
import { useLocale } from '@/lib/i18n';

/* ── Spotlight that follows mouse ── */
function SpotlightCursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!ref.current) return;
      ref.current.style.left = `${e.clientX}px`;
      ref.current.style.top = `${e.clientY}px`;
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(13,148,136,0.12) 0%, rgba(139,92,246,0.06) 40%, transparent 70%)',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 1,
        transition: 'left 0.1s ease, top 0.1s ease',
        filter: 'blur(1px)',
      }}
    />
  );
}

/* ── Floating particles ── */
function Particles() {
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 8,
    duration: Math.random() * 10 + 8,
  }));

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: p.id % 3 === 0 ? '#0d9488' : p.id % 3 === 1 ? '#8b5cf6' : '#22c55e',
            opacity: 0.4,
            animation: `particle-float ${p.duration}s ${p.delay}s ease-in-out infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes particle-float {
          0%, 100% { transform: translateY(0px) translateX(0px); opacity: 0.4; }
          25% { transform: translateY(-20px) translateX(10px); opacity: 0.7; }
          50% { transform: translateY(-10px) translateX(-8px); opacity: 0.3; }
          75% { transform: translateY(-25px) translateX(5px); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

/* ── Animated counter ── */
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let start = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { start = target; clearInterval(timer); }
      if (ref.current) ref.current.textContent = Math.floor(start) + suffix;
    }, 25);
    return () => clearInterval(timer);
  }, [target, suffix]);

  return <span ref={ref}>0{suffix}</span>;
}

export default function HomePage() {
  const { t } = useLocale();
  const flowWords = t('landing.flowShowcaseWords').split(' ');

  return (
    <>
      <SpotlightCursor />
      <Particles />
      <div className='grid-lines' />

      <div className='landing-grid container'>

        {/* ── HERO ── */}
        <section className='hero-layout' style={{ position: 'relative' }}>
          {/* Orbs */}
          <div className='spotlight-container'>
            <div className='orb orb-1' />
            <div className='orb orb-2' />
            <div className='orb orb-3' />
          </div>

          <div className='hero-shell'>
            <div style={{ marginBottom: 24 }}>
              <span className='chip'>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse-brand 2s infinite' }} />
                {t('landing.heroChip')}
              </span>
            </div>

            <h1 style={{ fontSize: 'clamp(38px, 5vw, 68px)', lineHeight: 1.05, fontWeight: 800, marginBottom: 24 }}>
              <span className='gradient-text'>{t('landing.heroTitleMain')}</span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.9)' }}>{t('landing.heroTitleLine2')}</span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 300 }}>{t('landing.heroTitleLine3')}</span>
            </h1>

            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 520, lineHeight: 1.7, marginBottom: 36 }}>
              {t('landing.heroDesc')}
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
              <Link href='/signup' className='button button-primary' style={{ fontSize: 15, padding: '13px 28px' }}>
                {t('landing.heroStartFree')} →
              </Link>
              <Link href='/tasks' className='button button-outline' style={{ fontSize: 15, padding: '13px 28px' }}>
                {t('landing.heroExploreDashboard')}
              </Link>
            </div>

            {/* Trust badges */}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {['Jira', 'Azure DevOps', 'GitHub', 'OpenAI'].map((b) => (
                <span key={b} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* AI Terminal Panel */}
          <div className='mock-panel' style={{ position: 'relative', zIndex: 2 }}>
            <div className='terminal-dots'>
              <span /><span /><span />
            </div>

            <div style={{ marginBottom: 16 }}>
              <span className='chip' style={{ fontSize: 11 }}>● {t('landing.live')}</span>
              <span style={{ marginLeft: 10, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{t('landing.pulse')}</span>
            </div>

            {/* Fake chart with bars */}
            <div className='mock-chart' style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '12px 12px 0' }}>
              {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((h, i) => (
                <div
                  key={i}
                  className='mock-chart-bar'
                  style={{
                    flex: 1,
                    height: `${h}%`,
                    borderRadius: '4px 4px 0 0',
                    background: i === 11
                      ? 'linear-gradient(180deg, #22c55e, #0d9488)'
                      : `rgba(13, 148, 136, ${0.2 + (i / 11) * 0.4})`,
                    transition: 'height 0.3s',
                    animationDelay: `${(i * 0.14).toFixed(2)}s`,
                    animationDuration: `${(2.4 + (i % 4) * 0.2).toFixed(2)}s`,
                  }}
                />
              ))}
            </div>

            <div className='timeline-mini'>
              <span>{t('landing.timeline1')}</span>
              <span>{t('landing.timeline2')}</span>
              <span>{t('landing.timeline3')}</span>
            </div>

            {/* Glow line at bottom */}
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.6), rgba(139,92,246,0.4), transparent)',
            }} />
          </div>
        </section>

        {/* ── FLOW SHOWCASE ── */}
        <section style={{ padding: '26px 0 52px' }}>
          <div className='flow-showcase'>
            <div className='flow-showcase-image-wrap'>
              <img src='/media/flow.png' alt='Flow Diagram' className='flow-showcase-image' loading='lazy' />
            </div>
            <div className='flow-showcase-content'>
              <div className='section-label'>{t('landing.flowShowcaseLabel')}</div>
              <h2 className='flow-showcase-title'>
                {flowWords.map((w, i) => (
                  <span key={`${w}-${i}`} className='flow-word' style={{ animationDelay: `${i * 0.08}s` }}>
                    {w}
                  </span>
                ))}
              </h2>
              <p className='flow-showcase-subtitle'>{t('landing.flowShowcaseDesc')}</p>
              <div className='flow-showcase-points'>
                {[t('landing.flowShowcasePoint1'), t('landing.flowShowcasePoint2'), t('landing.flowShowcasePoint3')].map((item, i) => (
                  <div key={item} className='flow-showcase-point' style={{ animationDelay: `${0.2 + i * 0.1}s` }}>
                    <span className='flow-showcase-dot' />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── STATS ── */}
        <section style={{ padding: '60px 0' }}>
          <div className='stats-bar'>
            {[
              { n: 98, s: '%', label: t('landing.stats1') },
              { n: 12, s: 'x', label: t('landing.stats2') },
              { n: 500, s: '+', label: t('landing.stats3') },
              { n: 2, s: 'M+', label: t('landing.stats4') },
            ].map((stat) => (
              <div key={stat.label} className='stat-item'>
                <div className='stat-number'>
                  <Counter target={stat.n} suffix={stat.s} />
                </div>
                <div className='stat-label'>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section className='section-wrapper' style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48 }}>
            <div className='section-label'>{t('landing.featuresLabel')}</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)', maxWidth: 500 }}>
              {t('landing.featuresTitle')}
            </h2>
          </div>

          <div className='feature-grid'>
            {[
              { icon: '🔐', title: t('landing.feature1Title'), desc: t('landing.feature1Desc') },
              { icon: '🤖', title: t('landing.feature2Title'), desc: t('landing.feature2Desc') },
              { icon: '⚡', title: t('landing.feature3Title'), desc: t('landing.feature3Desc') },
              { icon: '💰', title: t('landing.feature4Title'), desc: t('landing.feature4Desc') },
            ].map((f) => (
              <div key={f.title} className='feature-box'>
                <div className='feature-icon'>{f.icon}</div>
                <strong>{f.title}</strong>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>{t('landing.howLabel')}</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              {t('landing.howTitle')}
            </h2>
          </div>

          <div className='steps-grid'>
            {[
              { n: '01', title: t('landing.step1Title'), desc: t('landing.step1Desc') },
              { n: '02', title: t('landing.step2Title'), desc: t('landing.step2Desc') },
              { n: '03', title: t('landing.step3Title'), desc: t('landing.step3Desc') },
            ].map((s) => (
              <div key={s.n} className='step-card'>
                <div className='step-number'>{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── DEMO PREVIEW ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 32 }}>
            <div className='section-label'>{t('landing.demoPreview')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              {t('landing.seeInAction')}
            </h2>
          </div>
          <div className='grid-2'>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
              <h3 style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 8, fontSize: 18 }}>{t('landing.liveTaskBoardTitle')}</h3>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.liveTaskBoardDesc')}
              </p>
            </div>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🎯</div>
              <h3 style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 8, fontSize: 18 }}>{t('landing.aiAssignmentTitle')}</h3>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.aiAssignmentDesc')}
              </p>
            </div>
          </div>
        </section>

        {/* ── FLOW + AGENT WIDGETS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 32 }}>
            <div className='section-label'>{t('landing.widgetsLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)', marginBottom: 10 }}>
              {t('landing.widgetsTitle')}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, maxWidth: 680 }}>
              {t('landing.widgetsSubtitle')}
            </p>
          </div>

          <div className='widget-grid'>
            <div className='widget-card'>
              <div className='widget-top'>
                <div className='widget-kicker'>⟳ {t('landing.widgetFlowKicker')}</div>
                <div className='chip' style={{ fontSize: 10 }}>{t('landing.widgetLive')}</div>
              </div>
              <h3 className='widget-title'>{t('landing.flowWidgetTitle')}</h3>
              <p className='widget-desc'>{t('landing.flowWidgetDesc')}</p>

              <div className='widget-metrics'>
                {[
                  { label: t('landing.flowMetric1Label'), value: t('landing.flowMetric1Value') },
                  { label: t('landing.flowMetric2Label'), value: t('landing.flowMetric2Value') },
                  { label: t('landing.flowMetric3Label'), value: t('landing.flowMetric3Value') },
                ].map((m) => (
                  <div key={m.label} className='metric-pill'>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                  </div>
                ))}
              </div>

              <div className='flow-rail'>
                {[t('landing.flowStep1'), t('landing.flowStep2'), t('landing.flowStep3'), t('landing.flowStep4')].map((s, i) => (
                  <div key={s} className='flow-step' style={{ animationDelay: `${i * 0.15}s` }}>
                    <span className='flow-dot' />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className='widget-card'>
              <div className='widget-top'>
                <div className='widget-kicker'>🤖 {t('landing.widgetAgentsKicker')}</div>
                <div className='widget-pulse'>{t('landing.agentPulse')}</div>
              </div>
              <h3 className='widget-title'>{t('landing.agentWidgetTitle')}</h3>
              <p className='widget-desc'>{t('landing.agentWidgetDesc')}</p>

              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { role: t('landing.agentRolePm'), model: t('landing.agentRolePmModel'), pct: 22, color: '#a78bfa' },
                  { role: t('landing.agentRoleDev'), model: t('landing.agentRoleDevModel'), pct: 53, color: '#22c55e' },
                  { role: t('landing.agentRoleQa'), model: t('landing.agentRoleQaModel'), pct: 25, color: '#38bdf8' },
                ].map((a) => (
                  <div key={a.role} className='agent-row'>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: 600 }}>{a.role}</span>
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{a.model}</span>
                    </div>
                    <div className='agent-bar'>
                      <div className='agent-fill' style={{ width: `${a.pct}%`, background: `linear-gradient(90deg, ${a.color}, #5eead4)` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                {t('landing.agentShareLabel')}
              </div>
            </div>
          </div>
        </section>

        {/* ── ADVANCED CAPABILITIES SHOWCASE ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 32 }}>
            <div className='section-label'>{t('landing.capabilitiesLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 38px)', fontWeight: 800, color: 'rgba(255,255,255,0.92)', marginBottom: 10 }}>
              {t('landing.capabilitiesTitle')}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, maxWidth: 760 }}>
              {t('landing.capabilitiesSubtitle')}
            </p>
          </div>

          <div className='capability-grid'>
            {[
              {
                kind: 'dependency',
                icon: '🧩',
                title: t('landing.capDependencyTitle'),
                desc: t('landing.capDependencyDesc'),
                badges: [t('landing.capDependencyBadge1'), t('landing.capDependencyBadge2'), t('landing.capDependencyBadge3')],
                photo: 'https://images.unsplash.com/photo-1516383740770-fbcc5ccbece0?auto=format&fit=crop&w=900&q=80',
              },
              {
                kind: 'risk',
                icon: '🛡️',
                title: t('landing.capRiskTitle'),
                desc: t('landing.capRiskDesc'),
                badges: [t('landing.capRiskBadge1'), t('landing.capRiskBadge2'), t('landing.capRiskBadge3')],
                photo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=900&q=80',
              },
              {
                kind: 'playbook',
                icon: '📘',
                title: t('landing.capPlaybookTitle'),
                desc: t('landing.capPlaybookDesc'),
                badges: [t('landing.capPlaybookBadge1'), t('landing.capPlaybookBadge2'), t('landing.capPlaybookBadge3')],
                photo: 'https://images.unsplash.com/photo-1523475472560-d2df97ec485c?auto=format&fit=crop&w=900&q=80',
              },
              {
                kind: 'story',
                icon: '📝',
                title: t('landing.capStoryTitle'),
                desc: t('landing.capStoryDesc'),
                badges: [t('landing.capStoryBadge1'), t('landing.capStoryBadge2'), t('landing.capStoryBadge3')],
                photo: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=900&q=80',
              },
              {
                kind: 'guardrail',
                icon: '💸',
                title: t('landing.capGuardrailTitle'),
                desc: t('landing.capGuardrailDesc'),
                badges: [t('landing.capGuardrailBadge1'), t('landing.capGuardrailBadge2'), t('landing.capGuardrailBadge3')],
                photo: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=80',
              },
            ].map((item, idx) => (
              <article key={item.title} className={`capability-card capability-${item.kind}`} style={{ animationDelay: `${idx * 0.12}s` }}>
                <div className='capability-photo-wrap'>
                  <img src={item.photo} alt={item.title} className='capability-photo' loading='lazy' />
                  <div className='capability-overlay'>
                    <span className='chip' style={{ fontSize: 10 }}>{item.icon} {t('landing.widgetLive')}</span>
                  </div>
                </div>
                <div className='capability-content'>
                  <h3 className='capability-title'>{item.title}</h3>
                  <p className='capability-desc'>{item.desc}</p>

                  {item.kind === 'dependency' ? (
                    <div className='cap-dep-graph'>
                      <div className='cap-node active'>#18</div>
                      <div className='cap-link' />
                      <div className='cap-node active'>#22</div>
                      <div className='cap-link' />
                      <div className='cap-node blocked'>#31</div>
                    </div>
                  ) : null}

                  {item.kind === 'risk' ? (
                    <div className='cap-risk-wrap'>
                      <div className='cap-risk-gauge'>
                        <span>72</span>
                      </div>
                      <div className='cap-risk-meta'>HIGH RISK</div>
                    </div>
                  ) : null}

                  {item.kind === 'playbook' ? (
                    <div className='cap-rules'>
                      {item.badges.map((badge) => (
                        <div key={badge} className='cap-rule-line'>• {badge}</div>
                      ))}
                    </div>
                  ) : null}

                  {item.kind === 'story' ? (
                    <div className='cap-story-lines'>
                      <div className='cap-story-pill'>{item.badges[0]}</div>
                      <div className='cap-story-pill'>{item.badges[1]}</div>
                      <div className='cap-story-pill'>{item.badges[2]}</div>
                    </div>
                  ) : null}

                  {item.kind === 'guardrail' ? (
                    <div className='cap-guardrail-bars'>
                      <div className='cap-guardrail-row'>
                        <span>{item.badges[0]}</span>
                        <div className='cap-meter'><i style={{ width: '66%' }} /></div>
                      </div>
                      <div className='cap-guardrail-row'>
                        <span>{item.badges[1]}</span>
                        <div className='cap-meter'><i style={{ width: '48%' }} /></div>
                      </div>
                      <div className='cap-guardrail-row'>
                        <span>{item.badges[2]}</span>
                        <div className='cap-meter'><i style={{ width: '84%' }} /></div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── WHAT'S NEW ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 28 }}>
            <div className='section-label'>{t('landing.newLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'rgba(255,255,255,0.92)', marginBottom: 10 }}>
              {t('landing.newTitle')}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, maxWidth: 760 }}>
              {t('landing.newSubtitle')}
            </p>
          </div>

          <div className='release-grid'>
            {[
              { icon: '🟢', title: t('landing.newItem1Title'), desc: t('landing.newItem1Desc'), tone: 'teal' },
              { icon: '🧠', title: t('landing.newItem2Title'), desc: t('landing.newItem2Desc'), tone: 'blue' },
              { icon: '🧭', title: t('landing.newItem3Title'), desc: t('landing.newItem3Desc'), tone: 'amber' },
              { icon: '📊', title: t('landing.newItem4Title'), desc: t('landing.newItem4Desc'), tone: 'green' },
            ].map((item, i) => (
              <article key={item.title} className={`release-card release-${item.tone}`} style={{ animationDelay: `${i * 0.12}s` }}>
                <div className='release-head'>
                  <span className='release-icon'>{item.icon}</span>
                  <span className='chip' style={{ fontSize: 10 }}>{t('landing.widgetLive')}</span>
                </div>
                <h3 className='release-title'>{item.title}</h3>
                <p className='release-desc'>{item.desc}</p>
                <div className='release-track'>
                  <i />
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── PRICING ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>{t('landing.pricingLabel')}</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              {t('landing.pricingTitle')}
            </h2>
          </div>
          <div className='pricing-grid'>
            <PricingCard name={t('landing.pricingFree')} price='$0' items={[t('landing.pricingFreeItem1'), t('landing.pricingFreeItem2'), t('landing.pricingFreeItem3')]} />
            <PricingCard
              name={t('landing.pricingPro')}
              price='$49/mo'
              items={[t('landing.pricingProItem1'), t('landing.pricingProItem2'), t('landing.pricingProItem3')]}
              highlight
            />
          </div>
        </section>

        {/* ── CTA ── */}
        <section className='cta-section'>
          <div className='cta-glow' />
          <div className='chip' style={{ marginBottom: 24, justifyContent: 'center' }}>{t('landing.ctaChip')}</div>
          <h2 style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: 800, marginBottom: 20, lineHeight: 1.1 }}>
            <span className='gradient-text'>{t('landing.ctaTitle1')}</span>
            <br />
            <span style={{ color: 'rgba(255,255,255,0.9)' }}>{t('landing.ctaTitle2')}</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
            {t('landing.ctaDesc')}
          </p>
          <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '16px 40px' }}>
            {t('landing.ctaButton')} →
          </Link>
        </section>

      </div>
    </>
  );
}
