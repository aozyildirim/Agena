'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveApiBase } from '@/lib/api';

export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const API_BASE = resolveApiBase();

  useEffect(() => {
    // Load Swagger UI CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(link);

    // Load Swagger UI JS
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js';
    script.onload = () => {
      try {
        // @ts-expect-error SwaggerUIBundle loaded via CDN
        window.SwaggerUIBundle({
          url: `${API_BASE}/openapi.json`,
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            // @ts-expect-error SwaggerUIBundle loaded via CDN
            window.SwaggerUIBundle.presets.apis,
          ],
          layout: 'BaseLayout',
          defaultModelsExpandDepth: -1,
          docExpansion: 'list',
          filter: true,
          tryItOutEnabled: true,
        });
        setLoaded(true);
      } catch (e) {
        setError(String(e));
      }
    };
    script.onerror = () => setError('Failed to load Swagger UI');
    document.body.appendChild(script);

    return () => {
      document.head.removeChild(link);
      document.body.removeChild(script);
    };
  }, [API_BASE]);

  return (
    <div style={{ minHeight: '100vh', paddingTop: 72 }}>
      {/* Header */}
      <div className='container' style={{ maxWidth: 1200, padding: '32px 24px 16px' }}>
        <div className='section-label'>API Reference</div>
        <h1 style={{ fontSize: 'clamp(28px, 3vw, 40px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 8px' }}>
          API Documentation
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 15, marginBottom: 8 }}>
          Interactive API documentation powered by OpenAPI. Base URL: <code style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--accent)', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>{API_BASE}</code>
        </p>
      </div>

      {/* Loading state */}
      {!loaded && !error && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-35)' }}>
          Loading API documentation...
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#f87171' }}>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <a href={`${API_BASE}/docs`} target='_blank' rel='noopener noreferrer' className='button button-primary' style={{ padding: '10px 24px', fontSize: 14 }}>
            Open Swagger UI directly →
          </a>
        </div>
      )}

      {/* Swagger UI container */}
      <div
        id='swagger-ui'
        ref={containerRef}
        style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}
      />

      {/* Custom styles to match AGENA theme */}
      <style>{`
        .swagger-ui { font-family: inherit !important; }
        .swagger-ui .topbar { display: none !important; }
        .swagger-ui .info { margin: 16px 0 !important; }
        .swagger-ui .info .title { color: var(--ink-90) !important; font-size: 0 !important; height: 0; overflow: hidden; }
        .swagger-ui .info .description { color: var(--ink-50) !important; }
        .swagger-ui .opblock-tag { color: var(--ink-78) !important; border-bottom-color: var(--panel-border) !important; }
        .swagger-ui .opblock { border-color: var(--panel-border) !important; background: var(--panel) !important; border-radius: 10px !important; margin-bottom: 8px !important; }
        .swagger-ui .opblock .opblock-summary { border-radius: 10px !important; }
        .swagger-ui .opblock.opblock-post { border-color: rgba(34,197,94,0.3) !important; }
        .swagger-ui .opblock.opblock-get { border-color: rgba(59,130,246,0.3) !important; }
        .swagger-ui .opblock.opblock-put { border-color: rgba(245,158,11,0.3) !important; }
        .swagger-ui .opblock.opblock-delete { border-color: rgba(239,68,68,0.3) !important; }
        .swagger-ui .opblock-summary-method { border-radius: 6px !important; font-size: 12px !important; }
        .swagger-ui .opblock-summary-path { color: var(--ink-65) !important; }
        .swagger-ui .opblock-summary-description { color: var(--ink-45) !important; }
        .swagger-ui .btn { border-radius: 8px !important; }
        .swagger-ui .btn.execute { background: #0d9488 !important; border-color: #0d9488 !important; }
        .swagger-ui select, .swagger-ui input[type=text], .swagger-ui textarea {
          background: var(--terminal-bg) !important; color: var(--ink-78) !important;
          border-color: var(--panel-border-2) !important; border-radius: 6px !important;
        }
        .swagger-ui .model-box, .swagger-ui .response { background: var(--terminal-bg) !important; }
        .swagger-ui .highlight-code { background: var(--terminal-bg) !important; }
        .swagger-ui .filter input { background: var(--panel) !important; color: var(--ink-78) !important; border-color: var(--panel-border-2) !important; }
        .swagger-ui .scheme-container { background: transparent !important; box-shadow: none !important; }
      `}</style>
    </div>
  );
}
