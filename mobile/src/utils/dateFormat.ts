export function timeAgo(dateStr: string, lang: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return lang === 'tr' ? 'az önce' : 'just now';
  if (diff < 3600) return lang === 'tr' ? `${Math.floor(diff / 60)}dk önce` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return lang === 'tr' ? `${Math.floor(diff / 3600)}sa önce` : `${Math.floor(diff / 3600)}h ago`;
  return lang === 'tr' ? `${Math.floor(diff / 86400)}g önce` : `${Math.floor(diff / 86400)}d ago`;
}
