import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'AGENA – Agentic AI Platform | Pixel Agent';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #070F1A 0%, #0A1625 50%, #0d2137 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Gradient orbs */}
        <div
          style={{
            position: 'absolute',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(13,148,136,0.3) 0%, transparent 70%)',
            top: -100,
            right: -50,
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)',
            bottom: -50,
            left: -30,
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              background: 'linear-gradient(135deg, #22D3EE, #14B8A6, #22c55e)',
              backgroundClip: 'text',
              color: 'transparent',
              letterSpacing: -2,
            }}
          >
            AGENA
          </div>
          <div
            style={{
              fontSize: 32,
              color: '#e2e8f0',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            Agentic AI Platform
          </div>
          <div
            style={{
              fontSize: 20,
              color: '#94a3b8',
              textAlign: 'center',
              maxWidth: 700,
              lineHeight: 1.5,
            }}
          >
            Autonomous code generation &amp; PR automation powered by pixel agent technology
          </div>

          {/* Tags */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            {['Agentic AI', 'Pixel Agent', 'Autonomous PRs'].map((tag) => (
              <div
                key={tag}
                style={{
                  padding: '8px 20px',
                  borderRadius: 20,
                  border: '1px solid rgba(20,184,166,0.4)',
                  background: 'rgba(13,148,136,0.15)',
                  color: '#5EEAD4',
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
