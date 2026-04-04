import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = 'image/png';

export function createOgImage({ title, subtitle, tags }: { title: string; subtitle: string; tags: string[] }) {
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            zIndex: 1,
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 800, background: 'linear-gradient(135deg, #22D3EE, #14B8A6, #22c55e)', backgroundClip: 'text', color: 'transparent', letterSpacing: -1 }}>
            AGENA
          </div>
          <div style={{ fontSize: 40, color: '#e2e8f0', fontWeight: 700, textAlign: 'center', maxWidth: 800 }}>
            {title}
          </div>
          <div style={{ fontSize: 22, color: '#94a3b8', textAlign: 'center', maxWidth: 700, lineHeight: 1.4 }}>
            {subtitle}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            {tags.map((tag) => (
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
    { ...ogSize }
  );
}
