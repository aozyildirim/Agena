/**
 * Shared OpenGraph image renderer for landing pages.
 *
 * Each landing's `opengraph-image.tsx` calls renderLandingOg(...) with
 * its eyebrow / title / accent colours. The output (1200×630 PNG) shows
 * up as the social preview on LinkedIn / Twitter / Slack / WhatsApp
 * when someone pastes the landing URL — replacing the generic
 * /og-image.png that all landings used to share.
 *
 * Why per-page instead of one image: real social sharing data shows a
 * 2-3× CTR lift when the preview card matches the page topic
 * (e.g. "AI Code Review" vs the generic AGENA logo). Cheap to do, big
 * downstream win on inbound traffic from shares.
 */
import { ImageResponse } from 'next/og';

export type LandingOgConfig = {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;   // primary gradient stop, used for eyebrow + headline highlight
  accent2: string;  // secondary gradient stop
  emoji?: string;   // optional badge emoji (top-left brand)
};

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = 'image/png';

export function renderLandingOg(cfg: LandingOgConfig) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          background: '#0b1220',
          backgroundImage: `radial-gradient(ellipse at top right, ${cfg.accent}38, transparent 60%), radial-gradient(ellipse at bottom left, ${cfg.accent2}28, transparent 60%)`,
          padding: 64,
          color: '#e8edf6',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: `linear-gradient(135deg, ${cfg.accent}, ${cfg.accent2})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 800,
          }}>
            {cfg.emoji || 'A'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>AGENA</span>
            <span style={{ fontSize: 12, color: '#7e8aa0', letterSpacing: 2, textTransform: 'uppercase' }}>agena.dev</span>
          </div>
        </div>

        {/* Eyebrow */}
        <div style={{
          display: 'flex',
          marginTop: 28,
          fontSize: 18, fontWeight: 700,
          color: cfg.accent, letterSpacing: 4, textTransform: 'uppercase',
        }}>
          {cfg.eyebrow}
        </div>

        {/* Title — gradient highlight on the second half if title contains \n */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 18, flex: 1 }}>
          <div style={{
            fontSize: 64, fontWeight: 800, lineHeight: 1.05,
            color: '#f5f8ff',
            maxWidth: 1000,
          }}>
            {cfg.title}
          </div>
          <div style={{
            fontSize: 38, fontWeight: 700, lineHeight: 1.15,
            marginTop: 14,
            background: `linear-gradient(90deg, ${cfg.accent}, ${cfg.accent2})`,
            backgroundClip: 'text',
            color: 'transparent',
            maxWidth: 1000,
            display: 'flex',
          }}>
            {cfg.subtitle}
          </div>
        </div>

        {/* Footer URL band */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: 18, color: '#9aa6bd' }}>Open-source agentic AI · Bring-your-own LLM</span>
          <span style={{
            fontSize: 18, fontWeight: 700, color: '#f5f8ff',
            padding: '10px 18px', borderRadius: 999,
            background: `linear-gradient(135deg, ${cfg.accent}, ${cfg.accent2})`,
          }}>
            Start free →
          </span>
        </div>
      </div>
    ),
    { ...ogSize },
  );
}
