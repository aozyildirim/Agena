'use client';

import { useEffect } from 'react';

export default function WebVitals() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    import('web-vitals').then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
      const send = (metric: { name: string; value: number; id: string }) => {
        if (typeof window.gtag === 'function') {
          window.gtag('event', metric.name, {
            event_category: 'Web Vitals',
            event_label: metric.id,
            value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
            non_interaction: true,
          });
        }
      };
      onCLS(send);
      onINP(send);
      onLCP(send);
      onFCP(send);
      onTTFB(send);
    }).catch(() => {});
  }, []);

  return null;
}
