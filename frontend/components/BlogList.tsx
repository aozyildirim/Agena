'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  readTime: string;
  tags: string[];
  lang?: string;
}

export default function BlogList({ posts }: { posts: Post[] }) {
  const { lang, t } = useLocale();
  const [query, setQuery] = useState('');

  // Filter by active language first
  const langPosts = posts.filter((p) => (p.lang || 'en') === lang);

  // Then filter by search query
  const filtered = query.trim()
    ? langPosts.filter((p) => {
        const q = query.toLowerCase();
        return (
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
    : langPosts;

  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <input
          type='search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('blog.searchPlaceholder')}
          style={{
            width: '100%',
            padding: '12px 18px 12px 44px',
            borderRadius: 12,
            border: '1px solid rgba(13,148,136,0.25)',
            background: 'rgba(7,15,26,0.3)',
            color: 'var(--ink-90)',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'inherit',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.35)' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '14px center',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--ink-35)', fontSize: 15, textAlign: 'center', padding: '40px 0' }}>
            {query.trim() ? <>{t('blog.noResults')} &ldquo;{query}&rdquo;</> : t('blog.noResults')}
          </p>
        )}
        {filtered.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} style={{ textDecoration: 'none' }}>
            <article className='blog-card'>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <time style={{ color: 'var(--ink-35)', fontSize: 13 }}>{post.date}</time>
                <span style={{ color: 'var(--ink-25)' }}>&middot;</span>
                <span style={{ color: 'var(--ink-35)', fontSize: 13 }}>{post.readTime}</span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10, lineHeight: 1.4 }}>
                {post.title}
              </h2>
              <p style={{ color: 'var(--ink-50)', fontSize: 14, lineHeight: 1.7, marginBottom: 14 }}>
                {post.description}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'rgba(13,148,136,0.1)',
                      color: 'var(--accent)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          </Link>
        ))}
      </div>
    </>
  );
}
