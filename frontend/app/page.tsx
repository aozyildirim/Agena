'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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

/* ── Floating particles (client-only to avoid hydration mismatch) ── */
function Particles() {
  const [particles, setParticles] = useState<
    { id: number; x: number; y: number; size: number; delay: number; duration: number }[]
  >([]);

  useEffect(() => {
    setParticles(
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        delay: Math.random() * 8,
        duration: Math.random() * 10 + 8,
      }))
    );
  }, []);

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

function RapidType({ lines }: { lines: string[] }) {
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    if (!lines.length) return;
    const current = lines[lineIndex] || '';
    if (charIndex < current.length) {
      const t = setTimeout(() => setCharIndex((c) => c + 1), 16);
      return () => clearTimeout(t);
    }
    const hold = setTimeout(() => {
      setLineIndex((i) => (i + 1) % lines.length);
      setCharIndex(0);
    }, 650);
    return () => clearTimeout(hold);
  }, [charIndex, lineIndex, lines]);

  const visible = (lines[lineIndex] || '').slice(0, charIndex);
  return (
    <div style={{
      marginTop: 10,
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid rgba(56,189,248,0.35)',
      background: 'rgba(2,132,199,0.08)',
      fontFamily: 'monospace',
      fontSize: 12,
      color: 'var(--ink-90)',
      minHeight: 42,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <span>{visible}</span>
      <span style={{ opacity: 0.85, animation: 'blink-caret 0.8s steps(1,end) infinite' }}>|</span>
      <style>{`
        @keyframes blink-caret {
          0%, 49% { opacity: 0.95; }
          50%, 100% { opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}

function SeatedPixel({ palette, facing = 'front' }: { palette: number; facing?: 'front' | 'side' | 'back' }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = `/pixel-office/assets/characters/char_${palette}.png`;

    const IDLE_FRAME = 1;
    const SRC_W = 16;
    const SRC_H = 32;
    const DST_W = 18;
    const DST_H = 36;

    img.onload = () => {
      const row = facing === 'front' ? 0 : facing === 'side' ? 1 : 2;
      const sx = IDLE_FRAME * SRC_W;
      const sy = row * SRC_H;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, sx, sy, SRC_W, SRC_H, 0, 0, DST_W, DST_H);
    };
  }, [palette, facing]);

  return (
    <canvas
      ref={canvasRef}
      width={18}
      height={36}
      style={{
        width: 18,
        height: 36,
        imageRendering: 'pixelated',
        display: 'block',
        flexShrink: 0,
        filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.55))',
      }}
    />
  );
}

function PatronWalker({ palette, idx }: { palette: number; idx: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = `/pixel-office/assets/characters/char_${palette}.png`;

    let raf = 0;
    let frame = 0;
    let lastTick = 0;
    const FRAMES = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
    const SRC_W = 16;
    const SRC_H = 32;
    const ROW_FRONT = 0;

    const draw = (ts: number) => {
      if (!lastTick || ts - lastTick > 110) {
        frame = (frame + 1) % FRAMES.length;
        lastTick = ts;
      }
      const sx = FRAMES[frame] * SRC_W;
      const sy = ROW_FRONT * SRC_H;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, sx, sy, SRC_W, SRC_H, 0, 0, 24, 48);
      raf = window.requestAnimationFrame(draw);
    };

    img.onload = () => {
      raf = window.requestAnimationFrame(draw);
    };
    return () => window.cancelAnimationFrame(raf);
  }, [palette]);

  return (
    <div
      style={{
        position: 'absolute',
        left: '-14%',
        top: `calc(52% + ${((idx % 4) - 1.5) * 14}px)`,
        width: 24,
        height: 48,
        opacity: 0.86,
        animation: `patron-walk-left ${19 + idx * 3.8}s linear infinite, patron-walk-bob 0.58s steps(2,end) infinite`,
        animationDelay: `-${idx * 2.8}s, -${idx * 0.22}s`,
        filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.55))',
        zIndex: 3,
      }}
    >
      <canvas ref={canvasRef} width={24} height={48} style={{ width: 24, height: 48, imageRendering: 'pixelated', display: 'block' }} />
    </div>
  );
}

export default function HomePage() {
  const { t } = useLocale();
  const flowWords = t('landing.flowShowcaseWords').split(' ');
  const patronLines = [t('landing.patronLine1'), t('landing.patronLine2'), t('landing.patronLine3')];
  const patronWalkers = [0, 1, 2, 3, 4, 5, 6];
  const timelineItems = [
    { text: t('landing.timeline1'), palette: 0, facing: 'back' as const },
    { text: t('landing.timeline2'), palette: 3, facing: 'front' as const },
    { text: t('landing.timeline3'), palette: 6, facing: 'front' as const },
  ];
  const integrations = [
    { key: 'azure', logo: '/media/azure-logo.svg', name: t('landing.integrationAzure') },
    { key: 'jira', logo: '/media/jira-logo.svg', name: t('landing.integrationJira') },
    { key: 'github', logo: '/media/github-logo.svg', name: t('landing.integrationGithub') },
    { key: 'openai', logo: '/media/openai-logo.svg', name: t('landing.integrationOpenai') },
    { key: 'gemini', logo: '/media/gemini-logo.svg', name: t('landing.integrationGemini') },
    { key: 'slack', logo: '/media/slack-logo.svg', name: t('landing.integrationSlack') },
    { key: 'teams', logo: '/media/teams-logo.svg', name: t('landing.integrationTeams') },
    { key: 'newrelic', logo: '/media/newrelic-logo.svg', name: t('landing.integrationNewrelic') },
    { key: 'sentry', logo: '/media/sentry-logo.svg', name: t('landing.integrationSentry') },
  ];

  return (
    <>
      <SpotlightCursor />
      <Particles />
      <div className='grid-lines' aria-hidden='true' />

      <div className='landing-grid container'>

        {/* ── HERO ── */}
        <section className='hero-layout' style={{ position: 'relative' }} aria-label='AGENA Agentic AI Platform Hero'>
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
              <span style={{ color: 'var(--ink-90)' }}>{t('landing.heroTitleLine2')}</span>
              <br />
              <span style={{ color: 'var(--ink-35)', fontWeight: 300 }}>{t('landing.heroTitleLine3')}</span>
            </h1>

            <p style={{ fontSize: 18, color: 'var(--ink-50)', maxWidth: 520, lineHeight: 1.7, marginBottom: 36 }}>
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
                <span key={b} style={{ fontSize: 12, color: 'var(--ink-30)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-25)', display: 'inline-block' }} />
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
              <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--ink-50)' }}>{t('landing.pulse')}</span>
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
              {timelineItems.map((item) => (
                <span key={item.text}>
                  <SeatedPixel palette={item.palette} facing={item.facing} />
                  <em style={{ fontStyle: 'normal' }}>{item.text}</em>
                </span>
              ))}
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

        {/* ── CLI INSTALL BANNER ── */}
        <section style={{ padding: '20px 0 28px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
            padding: '18px 22px', borderRadius: 16,
            border: '1px solid rgba(94,234,212,0.35)',
            background: 'linear-gradient(135deg, rgba(13,148,136,0.08), rgba(125,211,252,0.06))',
          }}>
            <span style={{ fontSize: 26 }}>⚡</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#5eead4', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {t('landing.cliLabel')}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginTop: 2 }}>
                {t('landing.cliTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-50)', marginTop: 4 }}>
                {t('landing.cliSubtitle')}
              </div>
            </div>
            <code style={{
              fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--panel)', border: '1px solid var(--panel-border-2)',
              color: 'var(--ink-85)', whiteSpace: 'nowrap',
            }}>
              npm install -g @agenaai/cli
            </code>
          </div>
        </section>

        {/* ── INTEGRATIONS MARQUEE ── */}
        <section style={{ padding: '0 0 6px' }}>
          <div style={{ marginBottom: 10 }}>
            <div className='section-label'>{t('landing.integrationsLabel')}</div>
            <p style={{ margin: '6px 0 0', color: 'var(--ink-45)', fontSize: 12, lineHeight: 1.6 }}>
              {t('landing.integrationsSubtitle')}
            </p>
          </div>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 9, border: '1px solid var(--panel-border)', background: 'var(--panel)', maxHeight: 64 }}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(90deg, var(--bg), transparent 10%, transparent 90%, var(--bg))', zIndex: 2 }} />
            <div style={{ display: 'flex', width: 'max-content', animation: 'integrationMarqueeSingle 34s linear infinite', padding: '7px 0' }}>
              {integrations.map((item) => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 7px', padding: '5px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', whiteSpace: 'nowrap' }}>
                  <img src={item.logo} alt={item.name} loading='lazy' style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain', flexShrink: 0 }} />
                  <span style={{ color: 'var(--ink-78)', fontSize: 11, fontWeight: 600, lineHeight: 1 }}>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FLOW SHOWCASE ── */}
        <section style={{ padding: '16px 0 52px' }}>
          <div style={{ marginBottom: 14 }}>
            <div className='section-label'>{t('landing.flowShowcaseLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', margin: '6px 0 0' }}>
              {t('landing.flowShowcaseWords')}
            </h2>
          </div>
          <div className='flow-showcase'>
            <div className='flow-showcase-image-wrap'>
              <img src='/media/flow.png' alt='AGENA Agentic AI Pipeline Flow - Autonomous Code Generation Workflow' className='flow-showcase-image' loading='lazy' />
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
              <p className='flow-showcase-subtitle flow-typing-line' style={{ animationDelay: '0.12s, 0.12s' }}>
                {t('landing.flowShowcaseDesc')}
              </p>
              <div className='flow-showcase-points'>
                {[t('landing.flowShowcasePoint1'), t('landing.flowShowcasePoint2'), t('landing.flowShowcasePoint3')].map((item, i) => (
                  <div key={item} className='flow-showcase-point' style={{ animationDelay: `${1.08 + i * 0.92}s` }}>
                    <span className='flow-showcase-dot' />
                    <span className='flow-typing-line' style={{ animationDelay: `${1.16 + i * 0.92}s, ${1.16 + i * 0.92}s` }}>
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── PATRON MODE ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 14 }}>
            <div className='section-label'>{t('landing.patronLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', margin: '6px 0 0' }}>
              {t('landing.patronTitle')}
            </h2>
          </div>
          <div className='patron-grid-mobile' style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.1fr)',
            gap: 16,
            alignItems: 'stretch',
          }}>
            <div style={{
              borderRadius: 16,
              border: '1px solid var(--panel-border)',
              background: 'var(--panel)',
              overflow: 'hidden',
              minHeight: 220,
              boxShadow: '0 18px 48px rgba(2,132,199,0.18)',
            }}>
              <img
                src='/media/patron.png'
                alt='Patron Modu'
                loading='lazy'
                style={{ width: '100%', height: '100%', minHeight: 220, objectFit: 'cover' }}
              />
            </div>
            <div style={{
              borderRadius: 16,
              border: '1px solid var(--panel-border)',
              background: 'linear-gradient(160deg, rgba(2,132,199,0.10), rgba(13,148,136,0.08))',
              padding: '18px 18px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <p style={{ color: 'var(--ink-45)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                {t('landing.patronDesc')}
              </p>
              <RapidType lines={patronLines} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, height: 1, background: 'rgba(56,189,248,0.32)' }} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {patronWalkers.map((p, i) => (
                  <PatronWalker key={`patron-${p}`} palette={p} idx={i} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── VECTOR MEMORY DETAILS ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.vectorLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.vectorTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.vectorSubtitle')}
            </p>
          </div>

          <div className='vector-grid'>
            <article className='vector-card'>
              <h3 className='vector-card-title'>{t('landing.vectorHowTitle')}</h3>
              <p className='vector-card-desc'>{t('landing.vectorHowDesc')}</p>
              <div className='vector-flow'>
                {[t('landing.vectorStep1'), t('landing.vectorStep2'), t('landing.vectorStep3'), t('landing.vectorStep4')].map((s, i) => (
                  <div key={s} className='vector-flow-row' style={{ animationDelay: `${i * 0.12}s` }}>
                    <span className='vector-flow-dot' />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className='vector-card'>
              <h3 className='vector-card-title'>{t('landing.vectorFieldsTitle')}</h3>
              <p className='vector-card-desc'>{t('landing.vectorFieldsDesc')}</p>
              <div className='vector-fields'>
                {[
                  { k: 'key', v: t('landing.vectorFieldKey') },
                  { k: 'organization_id', v: t('landing.vectorFieldOrg') },
                  { k: 'input', v: t('landing.vectorFieldInput') },
                  { k: 'output', v: t('landing.vectorFieldOutput') },
                ].map((f, i) => (
                  <div key={f.k} className='vector-field-row' style={{ animationDelay: `${0.1 + i * 0.1}s` }}>
                    <code>{f.k}</code>
                    <span>{f.v}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className='vector-card'>
              <h3 className='vector-card-title'>{t('landing.vectorEmbedTitle')}</h3>
              <p className='vector-card-desc'>{t('landing.vectorEmbedDesc')}</p>
              <div className='vector-embed-list'>
                {[t('landing.vectorEmbed1'), t('landing.vectorEmbed2'), t('landing.vectorEmbed3'), t('landing.vectorEmbed4')].map((x, i) => (
                  <div key={x} className='vector-embed-item' style={{ animationDelay: `${0.16 + i * 0.1}s` }}>
                    <span className='vector-badge'>{String(i + 1).padStart(2, '0')}</span>
                    <span>{x}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        {/* ── SPRINT REFINEMENT (history-grounded SP) ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.refinementLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.refinementTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.refinementSubtitle')}
            </p>
          </div>

          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {[
              { n: '01', t: 'landing.refinementStep1Title', d: 'landing.refinementStep1Desc' },
              { n: '02', t: 'landing.refinementStep2Title', d: 'landing.refinementStep2Desc' },
              { n: '03', t: 'landing.refinementStep3Title', d: 'landing.refinementStep3Desc' },
              { n: '04', t: 'landing.refinementStep4Title', d: 'landing.refinementStep4Desc' },
            ].map((s, i) => (
              <div key={s.n} style={{
                padding: 18, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'grid', gap: 8,
                animation: `fadeInUp 0.4s ease ${0.1 + i * 0.08}s backwards`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#5eead4', letterSpacing: 1 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
                  {t(s.t as Parameters<typeof t>[0])}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-50)', margin: 0, lineHeight: 1.6 }}>
                  {t(s.d as Parameters<typeof t>[0])}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 18, padding: '14px 18px', borderRadius: 14,
            border: '1px dashed rgba(94,234,212,0.3)',
            background: 'rgba(94,234,212,0.05)',
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <span style={{ fontSize: 13, color: 'var(--ink-78)', flex: 1 }}>
              {t('landing.refinementExampleQuote')}
            </span>
          </div>
        </section>

        {/* ── TEAM SKILL CATALOG ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.skillsLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.skillsTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.skillsSubtitle')}
            </p>
          </div>

          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {[
              { n: '01', t: 'landing.skillsStep1Title', d: 'landing.skillsStep1Desc' },
              { n: '02', t: 'landing.skillsStep2Title', d: 'landing.skillsStep2Desc' },
              { n: '03', t: 'landing.skillsStep3Title', d: 'landing.skillsStep3Desc' },
              { n: '04', t: 'landing.skillsStep4Title', d: 'landing.skillsStep4Desc' },
            ].map((s, i) => (
              <div key={s.n} style={{
                padding: 18, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'grid', gap: 8,
                animation: `fadeInUp 0.4s ease ${0.1 + i * 0.08}s backwards`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', letterSpacing: 1 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
                  {t(s.t as Parameters<typeof t>[0])}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-50)', margin: 0, lineHeight: 1.6 }}>
                  {t(s.d as Parameters<typeof t>[0])}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 18, padding: '14px 18px', borderRadius: 14,
            border: '1px dashed rgba(167,139,250,0.3)',
            background: 'rgba(167,139,250,0.05)',
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 20 }}>🧠</span>
            <span style={{ fontSize: 13, color: 'var(--ink-78)', flex: 1 }}>
              {t('landing.skillsExampleQuote')}
            </span>
          </div>
        </section>

        {/* ── RUNTIMES REGISTRY ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.runtimesLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.runtimesTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.runtimesSubtitle')}
            </p>
          </div>

          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {[
              { n: '01', t: 'landing.runtimesStep1Title', d: 'landing.runtimesStep1Desc' },
              { n: '02', t: 'landing.runtimesStep2Title', d: 'landing.runtimesStep2Desc' },
              { n: '03', t: 'landing.runtimesStep3Title', d: 'landing.runtimesStep3Desc' },
              { n: '04', t: 'landing.runtimesStep4Title', d: 'landing.runtimesStep4Desc' },
            ].map((s, i) => (
              <div key={s.n} style={{
                padding: 18, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'grid', gap: 8,
                animation: `fadeInUp 0.4s ease ${0.1 + i * 0.08}s backwards`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#7dd3fc', letterSpacing: 1 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
                  {t(s.t as Parameters<typeof t>[0])}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-50)', margin: 0, lineHeight: 1.6 }}>
                  {t(s.d as Parameters<typeof t>[0])}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 18, padding: '14px 18px', borderRadius: 14,
            border: '1px dashed rgba(125,211,252,0.3)',
            background: 'rgba(125,211,252,0.05)',
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 20 }}>💻</span>
            <span style={{ fontSize: 13, color: 'var(--ink-78)', flex: 1 }}>
              {t('landing.runtimesExampleQuote')}
            </span>
          </div>
        </section>

        {/* ── NUDGE ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.nudgeLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.nudgeTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.nudgeSubtitle')}
            </p>
          </div>

          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {[
              { n: '01', t: 'landing.nudgeStep1Title', d: 'landing.nudgeStep1Desc' },
              { n: '02', t: 'landing.nudgeStep2Title', d: 'landing.nudgeStep2Desc' },
              { n: '03', t: 'landing.nudgeStep3Title', d: 'landing.nudgeStep3Desc' },
              { n: '04', t: 'landing.nudgeStep4Title', d: 'landing.nudgeStep4Desc' },
            ].map((s, i) => (
              <div key={s.n} style={{
                padding: 18, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'grid', gap: 8,
                animation: `fadeInUp 0.4s ease ${0.1 + i * 0.08}s backwards`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', letterSpacing: 1 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
                  {t(s.t as Parameters<typeof t>[0])}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-50)', margin: 0, lineHeight: 1.6 }}>
                  {t(s.d as Parameters<typeof t>[0])}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 18, padding: '14px 18px', borderRadius: 14,
            border: '1px dashed rgba(251,191,36,0.3)',
            background: 'rgba(251,191,36,0.05)',
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <span style={{ fontSize: 13, color: 'var(--ink-78)', flex: 1 }}>
              {t('landing.nudgeExampleQuote')}
            </span>
          </div>
        </section>

        {/* ── CLI ── */}
        <section style={{ padding: '8px 0 56px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className='section-label'>{t('landing.cliSectionLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.cliSectionTitle')}
            </h2>
            <p style={{ color: 'var(--ink-50)', fontSize: 14, maxWidth: 820, lineHeight: 1.7 }}>
              {t('landing.cliSectionSubtitle')}
            </p>
          </div>

          <div style={{
            display: 'grid', gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {[
              { n: '01', t: 'landing.cliStep1Title', d: 'landing.cliStep1Desc' },
              { n: '02', t: 'landing.cliStep2Title', d: 'landing.cliStep2Desc' },
              { n: '03', t: 'landing.cliStep3Title', d: 'landing.cliStep3Desc' },
              { n: '04', t: 'landing.cliStep4Title', d: 'landing.cliStep4Desc' },
            ].map((s, i) => (
              <div key={s.n} style={{
                padding: 18, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'grid', gap: 8,
                animation: `fadeInUp 0.4s ease ${0.1 + i * 0.08}s backwards`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#5eead4', letterSpacing: 1 }}>{s.n}</div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
                  {t(s.t as Parameters<typeof t>[0])}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--ink-50)', margin: 0, lineHeight: 1.6 }}>
                  {t(s.d as Parameters<typeof t>[0])}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 18, padding: '16px 18px', borderRadius: 14,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--panel)',
            display: 'grid', gap: 10,
          }}>
            <code style={{
              fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: 'var(--ink-85)', whiteSpace: 'pre', overflowX: 'auto', display: 'block',
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(94,234,212,0.06)', border: '1px solid rgba(94,234,212,0.18)',
            }}>{`$ brew install aozyildirim/tap/agena
$ agena setup            # device-code OAuth + enrolls this machine
$ agena task list
$ agena skill search "nullable pointer panic"
$ agena refinement analyze -p MyProject -t MyTeam`}</code>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 20 }}>💻</span>
              <span style={{ fontSize: 13, color: 'var(--ink-78)', flex: 1 }}>
                {t('landing.cliExampleQuote')}
              </span>
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
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'var(--ink-90)', maxWidth: 500 }}>
              {t('landing.featuresTitle')}
            </h2>
          </div>

          <div className='feature-grid'>
            {[
              { icon: '🔐', title: t('landing.feature1Title'), desc: t('landing.feature1Desc') },
              { icon: '🤖', title: t('landing.feature2Title'), desc: t('landing.feature2Desc') },
              { icon: '⚡', title: t('landing.feature3Title'), desc: t('landing.feature3Desc') },
              { icon: '💰', title: t('landing.feature4Title'), desc: t('landing.feature4Desc') },
              { icon: '🔀', title: t('landing.feature5Title'), desc: t('landing.feature5Desc') },
            ].map((f) => (
              <div key={f.title} className='feature-box'>
                <div className='feature-icon'>{f.icon}</div>
                <strong>{f.title}</strong>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── MULTI-REPO SHOWCASE ── */}
        <section style={{ padding: '80px 0 60px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }} className='multi-repo-grid'>
            {/* Left: Text */}
            <div>
              <div className='section-label'>{t('multiRepo.label')}</div>
              <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 16 }}>
                {t('multiRepo.title')}
              </h2>
              <p style={{ color: 'var(--ink-50)', fontSize: 16, lineHeight: 1.8, marginBottom: 28 }}>
                {t('multiRepo.desc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { icon: '🎯', text: t('landing.mr1') },
                  { icon: '⚡', text: t('landing.mr2') },
                  { icon: '🔒', text: t('landing.mr3') },
                  { icon: '📊', text: t('landing.mr4') },
                ].map((item) => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ color: 'var(--ink-65)', fontSize: 14, lineHeight: 1.6 }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
                <Link href='/use-cases#multi-repo-orchestration' className='button button-outline' style={{ fontSize: 14, padding: '10px 24px', display: 'inline-block' }}>
                  {t('multiRepo.learnMore')} →
                </Link>
                <Link href='/blog/github-copilot-alternative' className='button button-outline' style={{ fontSize: 14, padding: '10px 24px', display: 'inline-block', opacity: 0.8 }}>
                  {t('footer.compare')} →
                </Link>
              </div>
            </div>
            {/* Right: Visual diagram */}
            <div style={{
              background: 'var(--panel)',
              border: '1px solid var(--panel-border-2)',
              borderRadius: 20,
              padding: 'clamp(24px, 3vw, 40px)',
              fontFamily: 'monospace',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #0d9488)', borderRadius: '20px 20px 0 0' }} />
              {/* Task */}
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 10, background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)' }}>
                  <span style={{ color: '#5eead4', fontSize: 13, fontWeight: 700 }}>Task #142</span>
                  <span style={{ color: 'var(--ink-45)', fontSize: 12, marginLeft: 8 }}>Fix auth flow</span>
                </div>
              </div>
              {/* Arrow down */}
              <div style={{ textAlign: 'center', color: 'var(--ink-25)', fontSize: 18, lineHeight: 1, marginBottom: 12 }}>↓ fan-out</div>
              {/* Repos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { repo: 'backend-api', status: '✓ PR #87', color: '#22c55e', branch: 'fix/auth-jwt' },
                  { repo: 'frontend-app', status: '✓ PR #214', color: '#22c55e', branch: 'fix/auth-ui' },
                  { repo: 'shared-types', status: '⟳ running', color: '#f59e0b', branch: 'fix/auth-types' },
                ].map((r) => (
                  <div key={r.repo} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: 10,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--panel-border)',
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-78)' }}>{r.repo}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-30)', marginTop: 2 }}>{r.branch}</div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.color }}>{r.status}</span>
                  </div>
                ))}
              </div>
              {/* Bottom status */}
              <div style={{ textAlign: 'center', marginTop: 16, padding: '8px 16px', borderRadius: 8, background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.15)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-45)' }}>2/3 {t('landing.mrCompleted')}</span>
                <span style={{ display: 'inline-block', width: 80, height: 4, borderRadius: 2, background: 'var(--panel-border)', marginLeft: 10, verticalAlign: 'middle', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '66%', borderRadius: 2, background: '#0d9488' }} />
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── TASK DEPENDENCIES SHOWCASE ── */}
        <section style={{ padding: '80px 0 60px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }} className='deps-chain-grid'>
            {/* Left: Visual diagram */}
            <div style={{
              background: 'var(--panel)',
              border: '1px solid var(--panel-border-2)',
              borderRadius: 20,
              padding: 'clamp(24px, 3vw, 40px)',
              fontFamily: 'monospace',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #0d9488, #f59e0b, #0d9488)', borderRadius: '20px 20px 0 0' }} />
              {/* Header */}
              <div style={{ marginBottom: 20, fontSize: 13, fontWeight: 700, color: 'var(--ink-58)', letterSpacing: '0.5px' }}>
                Task Dependency Pipeline
              </div>
              {/* Dependency chain */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { id: '#31', name: 'DB Migration', status: 'done', statusIcon: '\u2713', color: '#22c55e' },
                  { id: '#32', name: 'Backend API Update', status: 'done', statusIcon: '\u2713', color: '#22c55e' },
                  { id: '#33', name: 'Frontend Update', status: 'running', statusIcon: '\u27F3', color: '#f59e0b' },
                  { id: '#34', name: 'E2E Tests', status: 'waiting', statusIcon: '\u23F3', color: 'var(--ink-30)' },
                ].map((task, i, arr) => (
                  <div key={task.id}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderRadius: 10,
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid var(--panel-border)',
                    }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: task.color }}>{task.id}</span>
                        <span style={{ fontSize: 13, color: 'var(--ink-65)', marginLeft: 8 }}>{task.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: task.color }}>{task.statusIcon} {task.status}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ textAlign: 'center', color: 'var(--ink-25)', fontSize: 16, lineHeight: 1, padding: '6px 0' }}>&#8595;</div>
                    )}
                  </div>
                ))}
              </div>
              {/* Bottom auto-queue note */}
              <div style={{ textAlign: 'center', marginTop: 16, padding: '8px 16px', borderRadius: 8, background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.15)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-45)' }}>{'\u2713'} Auto-queue: #33 {t('landing.depsCompleted')}</span>
              </div>
            </div>
            {/* Right: Text */}
            <div>
              <div className='section-label'>{t('landing.depsLabel')}</div>
              <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 16 }}>
                {t('landing.depsTitle')}
              </h2>
              <p style={{ color: 'var(--ink-50)', fontSize: 16, lineHeight: 1.8, marginBottom: 28 }}>
                {t('landing.depsDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { icon: '🔗', text: t('landing.dep1') },
                  { icon: '⚡', text: t('landing.dep2') },
                  { icon: '🛡️', text: t('landing.dep3') },
                  { icon: '📈', text: t('landing.dep4') },
                ].map((item) => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ color: 'var(--ink-65)', fontSize: 14, lineHeight: 1.6 }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <Link href='/docs' className='button button-outline' style={{ marginTop: 28, fontSize: 14, padding: '10px 24px', display: 'inline-block' }}>
                {t('landing.depsLearnMore')} →
              </Link>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>{t('landing.howLabel')}</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'var(--ink-90)' }}>
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
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)' }}>
              {t('landing.seeInAction')}
            </h2>
          </div>
          <div className='grid-2'>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
              <h3 style={{ color: 'var(--ink-90)', marginBottom: 8, fontSize: 18 }}>{t('landing.liveTaskBoardTitle')}</h3>
              <p style={{ color: 'var(--ink-35)', fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.liveTaskBoardDesc')}
              </p>
            </div>
            <div className='ai-panel'>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🎯</div>
              <h3 style={{ color: 'var(--ink-90)', marginBottom: 8, fontSize: 18 }}>{t('landing.aiAssignmentTitle')}</h3>
              <p style={{ color: 'var(--ink-35)', fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.aiAssignmentDesc')}
              </p>
            </div>
          </div>
        </section>

        {/* ── FLOW + AGENT WIDGETS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 32 }}>
            <div className='section-label'>{t('landing.widgetsLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.widgetsTitle')}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, maxWidth: 680 }}>
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
                      <span style={{ color: 'var(--ink-90)', fontSize: 13, fontWeight: 600 }}>{a.role}</span>
                      <span style={{ color: 'var(--ink-35)', fontSize: 11 }}>{a.model}</span>
                    </div>
                    <div className='agent-bar'>
                      <div className='agent-fill' style={{ width: `${a.pct}%`, background: `linear-gradient(90deg, ${a.color}, #5eead4)` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, color: 'var(--ink-35)', fontSize: 12 }}>
                {t('landing.agentShareLabel')}
              </div>
            </div>
          </div>
        </section>

        {/* ── ADVANCED CAPABILITIES SHOWCASE ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 32 }}>
            <div className='section-label'>{t('landing.capabilitiesLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 38px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.capabilitiesTitle')}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, maxWidth: 760 }}>
              {t('landing.capabilitiesSubtitle')}
            </p>
          </div>

          <div className='capability-mosaic'>
            <article className='cap-hero'>
              <div className='cap-hero-head'>
                <span className='chip' style={{ fontSize: 10 }}>🧩 {t('landing.widgetLive')}</span>
                <span className='cap-hero-kpi'>{t('landing.capDependencyKpi')}</span>
              </div>
              <h3>{t('landing.capDependencyTitle')}</h3>
              <p>{t('landing.capDependencyDesc')}</p>
              <div className='cap-visual-dep'>
                <span className='dep-node'>{t('landing.capDependencyNodeIntake')}</span>
                <span className='dep-line' />
                <span className='dep-node active'>{t('landing.capDependencyNodeDev')}</span>
                <span className='dep-line' />
                <span className='dep-node blocked'>{t('landing.capDependencyNodeReview')}</span>
              </div>
              <div className='capability-badges'>
                <span className='capability-badge'>{t('landing.capDependencyBadge1')}</span>
                <span className='capability-badge'>{t('landing.capDependencyBadge2')}</span>
                <span className='capability-badge'>{t('landing.capDependencyBadge3')}</span>
              </div>
            </article>

            <article className='cap-side cap-risk-tile'>
              <div className='cap-visual-risk'>
                <div className='cap-risk-gauge'><span>72</span></div>
                <div className='cap-risk-meta'>{t('landing.capRiskLevelHigh')}</div>
              </div>
              <h4>{t('landing.capRiskTitle')}</h4>
              <p>{t('landing.capRiskDesc')}</p>
            </article>

            <article className='cap-side cap-playbook-tile cap-diagonal-tile'>
              <h4>{t('landing.capPlaybookTitle')}</h4>
              <div className='cap-visual-rules'>
                <div className='rule-row'>$ {t('landing.capPlaybookRule1')}</div>
                <div className='rule-row'>$ {t('landing.capPlaybookRule2')}</div>
                <div className='rule-row'>$ {t('landing.capPlaybookRule3')}</div>
              </div>
              <div className='capability-badges'>
                <span className='capability-badge'>{t('landing.capPlaybookBadge1')}</span>
                <span className='capability-badge'>{t('landing.capPlaybookBadge2')}</span>
              </div>
            </article>

            <article className='cap-wide cap-story-tile'>
              <div className='cap-story-content'>
                <h4>{t('landing.capStoryTitle')}</h4>
                <p>{t('landing.capStoryDesc')}</p>
              </div>
              <div className='cap-visual-story'>
                <div className='story-mini'>{t('landing.capStoryMiniContext')}</div>
                <div className='story-mini'>{t('landing.capStoryMiniAcceptance')}</div>
                <div className='story-mini'>{t('landing.capStoryMiniEdgeCases')}</div>
              </div>
            </article>

            <article className='cap-wide cap-guard-tile'>
              <div>
                <h4>{t('landing.capGuardrailTitle')}</h4>
                <p>{t('landing.capGuardrailDesc')}</p>
              </div>
              <div className='cap-timeline'>
                <div className='cap-timeline-item done'>
                  <span className='cap-timeline-dot' />
                  <div className='cap-timeline-content'>{t('landing.flowStep1')}</div>
                </div>
                <div className='cap-timeline-item done'>
                  <span className='cap-timeline-dot' />
                  <div className='cap-timeline-content'>{t('landing.flowStep2')}</div>
                </div>
                <div className='cap-timeline-item active'>
                  <span className='cap-timeline-dot' />
                  <div className='cap-timeline-content'>{t('landing.flowStep3')}</div>
                </div>
                <div className='cap-timeline-item pending'>
                  <span className='cap-timeline-dot' />
                  <div className='cap-timeline-content'>{t('landing.flowStep4')}</div>
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* ── NEW RELIC MONITORING ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 28 }}>
            <div className='section-label'>{t('landing.newrelicLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.newrelicTitle')}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, maxWidth: 780 }}>
              {t('landing.newrelicSubtitle')}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {[
              { icon: '📊', title: t('landing.newrelicF1Title'), desc: t('landing.newrelicF1Desc') },
              { icon: '🔍', title: t('landing.newrelicF2Title'), desc: t('landing.newrelicF2Desc') },
              { icon: '🔗', title: t('landing.newrelicF3Title'), desc: t('landing.newrelicF3Desc') },
              { icon: '🔄', title: t('landing.newrelicF4Title'), desc: t('landing.newrelicF4Desc') },
            ].map((f) => (
              <div key={f.title} style={{
                padding: 20, borderRadius: 14,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 24, lineHeight: 1 }}>{f.icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: 'var(--ink-50)', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 24, padding: '20px 24px', borderRadius: 14,
            border: '1px solid rgba(28,231,131,0.2)',
            background: 'rgba(28,231,131,0.04)',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 28 }}>📊</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1CE783' }}>{t('landing.newrelicFlowTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4 }}>{t('landing.newrelicFlowDesc')}</div>
            </div>
            <code style={{ fontSize: 11, color: 'var(--ink-50)', background: 'var(--glass)', padding: '6px 12px', borderRadius: 8 }}>
              Trigger → New Relic → Condition → Developer → PR
            </code>
          </div>

          <div style={{
            marginTop: 14, padding: '20px 24px', borderRadius: 14,
            border: '1px solid rgba(249,115,22,0.25)',
            background: 'rgba(249,115,22,0.06)',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 28 }}>🚨</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f97316' }}>{t('landing.sentryFlowTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4 }}>{t('landing.sentryFlowDesc')}</div>
            </div>
            <code style={{ fontSize: 11, color: 'var(--ink-50)', background: 'var(--glass)', padding: '6px 12px', borderRadius: 8 }}>
              Trigger → Sentry → Condition → Developer → PR
            </code>
          </div>
        </section>

        {/* ── CHATOPS INTEGRATIONS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 28 }}>
            <div className='section-label'>{t('landing.chatopsLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.chatopsTitle')}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, maxWidth: 780 }}>
              {t('landing.chatopsSubtitle')}
            </p>
          </div>

          <div className='grid-2' style={{ marginBottom: 14 }}>
            <article className='ai-panel' style={{ position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% -20%, rgba(74, 21, 75, 0.32), transparent 52%)' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <img src='/media/slack-logo.svg' alt='Slack' style={{ width: 48, height: 48 }} loading='lazy' />
                  <div>
                    <div style={{ color: 'var(--ink-90)', fontWeight: 700, fontSize: 17 }}>{t('landing.slackTitle')}</div>
                    <div style={{ color: 'var(--ink-35)', fontSize: 12 }}>{t('landing.chatopsSlackSub')}</div>
                  </div>
                </div>
                <p style={{ color: 'var(--ink-45)', fontSize: 14, lineHeight: 1.65 }}>
                  {t('landing.slackDesc')}
                </p>
                <div style={{ marginTop: 12, height: 4, borderRadius: 999, background: 'var(--panel-border-2)', overflow: 'hidden' }}>
                  <div style={{ width: '76%', height: '100%', background: 'linear-gradient(90deg, #e01e5a, #2eb67d, #36c5f0)', animation: 'progressPulse 2.8s ease-in-out infinite' }} />
                </div>
              </div>
            </article>

            <article className='ai-panel' style={{ position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 20% -20%, rgba(75, 137, 220, 0.3), transparent 55%)' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <img src='/media/teams-logo.svg' alt='Microsoft Teams' style={{ width: 48, height: 48 }} loading='lazy' />
                  <div>
                    <div style={{ color: 'var(--ink-90)', fontWeight: 700, fontSize: 17 }}>{t('landing.teamsTitle')}</div>
                    <div style={{ color: 'var(--ink-35)', fontSize: 12 }}>{t('landing.chatopsTeamsSub')}</div>
                  </div>
                </div>
                <p style={{ color: 'var(--ink-45)', fontSize: 14, lineHeight: 1.65 }}>
                  {t('landing.teamsDesc')}
                </p>
                <div style={{ marginTop: 12, height: 4, borderRadius: 999, background: 'var(--panel-border-2)', overflow: 'hidden' }}>
                  <div style={{ width: '84%', height: '100%', background: 'linear-gradient(90deg, #4f46e5, #22d3ee)', animation: 'progressPulse 3.2s ease-in-out infinite' }} />
                </div>
              </div>
            </article>
          </div>

          <div className='chatops-points-mobile' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {[t('landing.chatopsPoint1'), t('landing.chatopsPoint2'), t('landing.chatopsPoint3'), t('landing.chatopsPoint4')].map((point, i) => (
              <div key={point} style={{ borderRadius: 12, border: '1px solid var(--panel-border-2)', background: 'rgba(2,8,23,0.72)', padding: '10px 12px', color: 'var(--ink-65)', fontSize: 12, animation: 'fade-up 0.45s ease both', animationDelay: `${i * 0.09}s` }}>
                {point}
              </div>
            ))}
          </div>
        </section>

        {/* ── WHAT'S NEW ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 28 }}>
            <div className='section-label'>{t('landing.newLabel')}</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)', marginBottom: 10 }}>
              {t('landing.newTitle')}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, maxWidth: 760 }}>
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

        {/* ── TESTIMONIALS ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>{t('landing.testimonialsLabel')}</div>
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 42px)', fontWeight: 800, color: 'var(--ink-90)' }}>
              {t('landing.testimonialsTitle')}
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, maxWidth: 960, margin: '0 auto' }}>
            {[
              { name: 'Alex M.', role: 'Senior Developer', text: 'AGENA turned our 2-week sprint into a 2-day sprint. The AI agents generate production-ready PRs that actually pass code review.', avatar: 'AM' },
              { name: 'Sarah K.', role: 'Engineering Lead', text: 'The flow builder is incredible. We automated our entire PR pipeline — from Jira ticket to merged code — with zero manual intervention.', avatar: 'SK' },
              { name: 'Mehmet Y.', role: 'CTO, Startup', text: 'As a small team, AGENA is like having 3 extra senior developers. The code quality from the AI review pipeline surprised us.', avatar: 'MY' },
              { name: 'David R.', role: 'DevOps Engineer', text: 'GitHub and Azure DevOps integration works flawlessly. We process 50+ automated PRs per week with AGENA agents.', avatar: 'DR' },
              { name: 'Lina C.', role: 'Product Manager', text: 'I write task descriptions and AGENA delivers working code. It changed how our entire team thinks about product delivery.', avatar: 'LC' },
              { name: 'Kenji T.', role: 'Full Stack Developer', text: 'The pixel agent visualization makes AI workflows transparent. I can see exactly what each agent is doing in real-time.', avatar: 'KT' },
            ].map((t) => (
              <div
                key={t.name}
                className='testimonial-card'
                style={{
                  padding: '24px',
                  borderRadius: 16,
                  border: '1px solid var(--panel-border-2)',
                  background: 'var(--panel)',
                }}
              >
                <p style={{ color: 'var(--ink-60)', fontSize: 14, lineHeight: 1.7, marginBottom: 16, fontStyle: 'italic' }}>
                  &ldquo;{t.text}&rdquo;
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'linear-gradient(135deg, rgba(13,148,136,0.3), rgba(139,92,246,0.3))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'var(--ink-75)',
                  }}>
                    {t.avatar}
                  </div>
                  <div>
                    <div style={{ color: 'var(--ink-90)', fontSize: 13, fontWeight: 600 }}>{t.name}</div>
                    <div style={{ color: 'var(--ink-35)', fontSize: 12 }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section style={{ padding: '60px 0' }}>
          <div style={{ marginBottom: 28, textAlign: 'center' }}>
            <div className='section-label' style={{ justifyContent: 'center' }}>FAQ</div>
            <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 36px)', fontWeight: 800, color: 'var(--ink-90)' }}>
              {t('landing.faqTitle')}
            </h2>
          </div>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { q: t('landing.faq1Q'), a: t('landing.faq1A') },
              { q: t('landing.faq2Q'), a: t('landing.faq2A') },
              { q: t('landing.faq3Q'), a: t('landing.faq3A') },
              { q: t('landing.faq4Q'), a: t('landing.faq4A') },
              { q: t('landing.faq5Q'), a: t('landing.faq5A') },
              { q: t('landing.faq6Q'), a: t('landing.faq6A') },
            ].map((faq) => (
              <details
                key={faq.q}
                style={{
                  padding: '18px 24px',
                  borderRadius: 14,
                  border: '1px solid var(--panel-border-2)',
                  background: 'var(--panel)',
                  cursor: 'pointer',
                }}
              >
                <summary style={{ color: 'var(--ink-90)', fontWeight: 600, fontSize: 15, lineHeight: 1.5, listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {faq.q}
                  <span style={{ color: 'var(--ink-35)', fontSize: 18, marginLeft: 12, flexShrink: 0 }}>+</span>
                </summary>
                <p style={{ color: 'var(--ink-50)', fontSize: 14, lineHeight: 1.75, marginTop: 12 }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
          {/* Internal links after FAQ */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 28, flexWrap: 'wrap' }}>
            <Link href='/glossary' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>{t('footer.glossary')}</Link>
            <Link href='/integrations' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>{t('footer.integrations')}</Link>
            <Link href='/use-cases' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>{t('footer.useCases')}</Link>
            <Link href='/blog/github-copilot-alternative' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>{t('footer.compare')}</Link>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className='cta-section'>
          <div className='cta-glow' />
          <div className='chip' style={{ marginBottom: 24, justifyContent: 'center' }}>{t('landing.ctaChip')}</div>
          <h2 style={{ fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: 800, marginBottom: 20, lineHeight: 1.1 }}>
            <span className='gradient-text'>{t('landing.ctaTitle1')}</span>
            <br />
            <span style={{ color: 'var(--ink-90)' }}>{t('landing.ctaTitle2')}</span>
          </h2>
          <p style={{ color: 'var(--ink-35)', fontSize: 18, marginBottom: 40, maxWidth: 480, margin: '0 auto 40px' }}>
            {t('landing.ctaDesc')}
          </p>
          <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '16px 40px' }}>
            {t('landing.ctaButton')} →
          </Link>
        </section>

      </div>

      <style>{`
        @keyframes progressPulse {
          0%, 100% { transform: translateX(-2%); filter: saturate(1); }
          50% { transform: translateX(2%); filter: saturate(1.15); }
        }
        @keyframes integrationMarqueeSingle {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        @keyframes patron-walk-left {
          0% { left: -14%; }
          100% { left: 108%; }
        }
        @keyframes patron-walk-bob {
          0%, 100% { margin-bottom: 0; }
          50% { margin-bottom: 2px; }
        }
      `}</style>
    </>
  );
}
