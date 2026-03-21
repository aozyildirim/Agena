'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import PricingCard from '@/components/PricingCard';

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
                AI-Powered Dev Automation
              </span>
            </div>

            <h1 style={{ fontSize: 'clamp(38px, 5vw, 68px)', lineHeight: 1.05, fontWeight: 800, marginBottom: 24 }}>
              <span className='gradient-text'>Backlog to PR</span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.9)' }}>in Minutes,</span>
              <br />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 300 }}>not Sprints.</span>
            </h1>

            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 520, lineHeight: 1.7, marginBottom: 36 }}>
              Tiqr runs an autonomous <span style={{ color: '#5eead4' }}>PM → Dev → Reviewer</span> pipeline that writes production code, reviews quality, and opens GitHub PRs with full task telemetry.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 48 }}>
              <Link href='/signup' className='button button-primary' style={{ fontSize: 15, padding: '13px 28px' }}>
                Start Free →
              </Link>
              <Link href='/tasks' className='button button-outline' style={{ fontSize: 15, padding: '13px 28px' }}>
                Explore Dashboard
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
              <span className='chip' style={{ fontSize: 11 }}>● LIVE</span>
              <span style={{ marginLeft: 10, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Autonomous Sprint Pulse</span>
            </div>

            {/* Fake chart with bars */}
            <div className='mock-chart' style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '12px 12px 0' }}>
              {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((h, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${h}%`,
                    borderRadius: '4px 4px 0 0',
                    background: i === 11
                      ? 'linear-gradient(180deg, #22c55e, #0d9488)'
                      : `rgba(13, 148, 136, ${0.2 + (i / 11) * 0.4})`,
                    transition: 'height 0.3s',
                  }}
                />
              ))}
            </div>

            <div className='timeline-mini'>
              <span>fetch_context completed in 2.1s</span>
              <span>generate_code pushed 6 files</span>
              <span>review_code opened PR #184</span>
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

        {/* ── STATS ── */}
        <section style={{ padding: '60px 0' }}>
          <div className='stats-bar'>
            {[
              { n: 98, s: '%', label: 'PR Success Rate' },
              { n: 12, s: 'x', label: 'Faster Delivery' },
              { n: 500, s: '+', label: 'Teams Onboarded' },
              { n: 2, s: 'M+', label: 'Tasks Automated' },
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
            <div className='section-label'>Features</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)', maxWidth: 500 }}>
              Everything your team needs to ship faster
            </h2>
          </div>

          <div className='feature-grid'>
            {[
              { icon: '🔐', title: 'Multi-Tenant Security', desc: 'JWT auth, org-level isolation, usage limits, and billing controls baked in from day one.' },
              { icon: '🤖', title: 'Agentic Delivery Flow', desc: 'LangGraph state machine with full observability across each AI stage of your pipeline.' },
              { icon: '⚡', title: 'GitHub Automation', desc: 'Branch, commit, and PR generation with traceable task links and review summaries.' },
              { icon: '💰', title: 'Cost Optimized LLM', desc: 'Prompt caching, model routing, and token/cost tracking per organization.' },
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
            <div className='section-label' style={{ justifyContent: 'center' }}>How It Works</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              Three steps to autonomous delivery
            </h2>
          </div>

          <div className='steps-grid'>
            {[
              { n: '01', title: 'Ingest', desc: 'Pull work from Jira/Azure or create directly in the dashboard. AI parses intent and context.' },
              { n: '02', title: 'Orchestrate', desc: 'PM, Dev, and Reviewer agents collaborate through LangGraph states with full telemetry.' },
              { n: '03', title: 'Ship', desc: 'Reviewed output becomes a GitHub PR with timeline, logs, and quality scores.' },
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
            <div className='section-label'>Demo Preview</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              See it in action
            </h2>
          </div>
          <div className='grid-2'>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
              <h3 style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 8, fontSize: 18 }}>Live Task Board</h3>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1.6 }}>
                Track queued, running, and completed tasks with per-task AI timeline and cost breakdown.
              </p>
            </div>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🎯</div>
              <h3 style={{ color: 'rgba(255,255,255,0.9)', marginBottom: 8, fontSize: 18 }}>AI Assignment</h3>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1.6 }}>
                One click "Assign to AI" with Azure/Jira import actions inside the dashboard.
              </p>
            </div>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>Pricing</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
              Simple, transparent pricing
            </h2>
          </div>
          <div className='pricing-grid'>
            <PricingCard name='Free' price='$0' items={['5 tasks/month', 'Basic orchestration', 'Single organization']} />
            <PricingCard
              name='Pro'
              price='$49/mo'
              items={['Unlimited tasks', 'Priority pipelines', 'Team invites + advanced billing']}
              highlight
            />
          </div>
        </section>

        {/* ── CTA ── */}
        <section className='cta-section'>
          <div className='cta-glow' />
          <div className='chip' style={{ marginBottom: 24, justifyContent: 'center' }}>Ready to ship?</div>
          <h2 style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: 800, marginBottom: 20, lineHeight: 1.1 }}>
            <span className='gradient-text'>Build Faster.</span>
            <br />
            <span style={{ color: 'rgba(255,255,255,0.9)' }}>Review Better. Ship Safer.</span>
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
            Create your workspace and run your first autonomous delivery cycle today.
          </p>
          <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '16px 40px' }}>
            Launch Tiqr — It's Free →
          </Link>
        </section>

      </div>
    </>
  );
}
