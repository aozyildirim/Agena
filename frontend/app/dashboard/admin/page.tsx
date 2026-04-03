'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Stats {
  organizations: number;
  users: number;
  tasks: number;
  contact_submissions: number;
  unread_contacts: number;
  newsletter_subscribers: number;
}

interface Org {
  id: number;
  name: string;
  slug: string;
  created_at: string | null;
  member_count: number;
  task_count: number;
  plan: string;
  plan_status: string;
}

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  is_platform_admin: boolean;
  created_at: string | null;
  organizations: { id: number; name: string; role: string }[];
}

interface Contact {
  id: number;
  name: string;
  email: string;
  message: string;
  newsletter: boolean;
  is_read: boolean;
  created_at: string | null;
}

interface Subscriber {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string | null;
}

type Tab = 'overview' | 'orgs' | 'users' | 'contact' | 'newsletter';

export default function AdminPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(urlTab || 'overview');

  function switchTab(t: Tab) {
    setTab(t);
    router.push(t === 'overview' ? '/dashboard/admin' : `/dashboard/admin?tab=${t}`);
  }
  const [stats, setStats] = useState<Stats | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (urlTab && urlTab !== tab) setTab(urlTab);
  }, [urlTab]);

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (tab === 'orgs' && orgs.length === 0) loadOrgs();
    if (tab === 'users' && users.length === 0) loadUsers();
    if (tab === 'contact' && contacts.length === 0) loadContacts();
    if (tab === 'newsletter' && subscribers.length === 0) loadSubscribers();
  }, [tab]);

  async function loadStats() {
    try {
      setStats(await apiFetch<Stats>('/admin/stats'));
    } catch (e: any) {
      setError(e?.message || 'Access denied');
    }
  }
  async function loadOrgs() { setOrgs(await apiFetch<Org[]>('/admin/organizations')); }
  async function loadUsers() { setUsers(await apiFetch<UserRow[]>('/admin/users')); }
  async function loadContacts() { setContacts(await apiFetch<Contact[]>('/admin/contact')); }
  async function loadSubscribers() { setSubscribers(await apiFetch<Subscriber[]>('/admin/newsletter')); }

  async function toggleUserActive(id: number) {
    await apiFetch(`/admin/users/${id}/toggle-active`, { method: 'PUT' });
    setUsers(users.map(u => u.id === id ? { ...u, is_active: !u.is_active } : u));
  }

  async function toggleAdmin(id: number) {
    await apiFetch(`/admin/users/${id}/toggle-admin`, { method: 'PUT' });
    setUsers(users.map(u => u.id === id ? { ...u, is_platform_admin: !u.is_platform_admin } : u));
  }

  async function markRead(id: number) {
    await apiFetch(`/admin/contact/${id}/read`, { method: 'PUT' });
    setContacts(contacts.map(c => c.id === id ? { ...c, is_read: true } : c));
  }

  async function deleteContact(id: number) {
    await apiFetch(`/admin/contact/${id}`, { method: 'DELETE' });
    setContacts(contacts.filter(c => c.id !== id));
  }

  async function deleteSubscriber(id: number) {
    await apiFetch(`/admin/newsletter/${id}`, { method: 'DELETE' });
    setSubscribers(subscribers.filter(s => s.id !== id));
  }

  async function changePlan(orgId: number, plan: string) {
    await apiFetch(`/admin/organizations/${orgId}/plan?plan_name=${plan}`, { method: 'PUT' });
    setOrgs(orgs.map(o => o.id === orgId ? { ...o, plan } : o));
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ color: '#f87171', marginBottom: 12 }}>Access Denied</h2>
        <p style={{ color: 'var(--ink-45)' }}>{error}</p>
      </div>
    );
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: '10px 20px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: tab === t ? 'var(--accent)' : 'rgba(13,148,136,0.1)',
    color: tab === t ? '#fff' : 'var(--ink-72)',
  });

  const cardStyle: React.CSSProperties = {
    padding: '20px 24px',
    borderRadius: 12,
    background: 'rgba(13,148,136,0.06)',
    border: '1px solid rgba(13,148,136,0.12)',
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--ink-45)',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
  };

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--ink-72)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  };

  const btnSmall: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid rgba(13,148,136,0.2)',
    background: 'rgba(13,148,136,0.1)',
    color: 'var(--accent)',
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 24 }}>
        Platform Admin
      </h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
        <button onClick={() => switchTab('overview')} style={tabStyle('overview')}>Overview</button>
        <button onClick={() => switchTab('orgs')} style={tabStyle('orgs')}>Organizations</button>
        <button onClick={() => switchTab('users')} style={tabStyle('users')}>Users</button>
        <button onClick={() => switchTab('contact')} style={tabStyle('contact')}>
          Contact {stats && stats.unread_contacts > 0 && <span style={{ marginLeft: 6, background: '#f87171', color: '#fff', borderRadius: 10, padding: '2px 7px', fontSize: 10 }}>{stats.unread_contacts}</span>}
        </button>
        <button onClick={() => switchTab('newsletter')} style={tabStyle('newsletter')}>Newsletter</button>
      </div>

      {/* Overview */}
      {tab === 'overview' && stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {[
            { label: 'Organizations', value: stats.organizations },
            { label: 'Users', value: stats.users },
            { label: 'Tasks', value: stats.tasks },
            { label: 'Contact Messages', value: stats.contact_submissions },
            { label: 'Unread', value: stats.unread_contacts },
            { label: 'Newsletter Subs', value: stats.newsletter_subscribers },
          ].map((s) => (
            <div key={s.label} style={cardStyle}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)' }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Organizations */}
      {tab === 'orgs' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Slug</th>
                <th style={thStyle}>Members</th>
                <th style={thStyle}>Tasks</th>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td style={tdStyle}>{o.id}</td>
                  <td style={tdStyle}>{o.name}</td>
                  <td style={tdStyle}><code style={{ fontSize: 12 }}>{o.slug}</code></td>
                  <td style={tdStyle}>{o.member_count}</td>
                  <td style={tdStyle}>{o.task_count}</td>
                  <td style={tdStyle}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: o.plan === 'pro' ? 'rgba(13,148,136,0.15)' : 'rgba(255,255,255,0.05)', color: o.plan === 'pro' ? '#5EEAD4' : 'var(--ink-45)' }}>
                      {o.plan}
                    </span>
                  </td>
                  <td style={tdStyle}>{o.created_at?.split('T')[0]}</td>
                  <td style={tdStyle}>
                    <select
                      value={o.plan}
                      onChange={(e) => changePlan(o.id, e.target.value)}
                      style={{ ...btnSmall, background: 'rgba(7,15,26,0.5)', color: 'var(--ink-72)' }}
                    >
                      <option value='free'>Free</option>
                      <option value='pro'>Pro</option>
                      <option value='enterprise'>Enterprise</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Org(s)</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Admin</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={tdStyle}>{u.id}</td>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}>{u.full_name}</td>
                  <td style={tdStyle}>{u.organizations.map(o => o.name).join(', ')}</td>
                  <td style={tdStyle}>
                    <span style={{ color: u.is_active ? '#5EEAD4' : '#f87171' }}>{u.is_active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: u.is_platform_admin ? '#5EEAD4' : 'var(--ink-35)' }}>{u.is_platform_admin ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={tdStyle}>{u.created_at?.split('T')[0]}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => toggleUserActive(u.id)} style={btnSmall}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => toggleAdmin(u.id)} style={btnSmall}>
                        {u.is_platform_admin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Contact */}
      {tab === 'contact' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {contacts.length === 0 && <p style={{ color: 'var(--ink-45)' }}>No contact messages yet.</p>}
          {contacts.map((c) => (
            <div key={c.id} style={{ ...cardStyle, opacity: c.is_read ? 0.6 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <strong style={{ color: 'var(--ink-90)', fontSize: 14 }}>{c.name}</strong>
                  <span style={{ color: 'var(--ink-35)', fontSize: 12, marginLeft: 12 }}>{c.email}</span>
                  {c.newsletter && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(13,148,136,0.15)', color: '#5EEAD4', padding: '2px 6px', borderRadius: 4 }}>NL</span>}
                  {!c.is_read && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(248,113,113,0.2)', color: '#f87171', padding: '2px 6px', borderRadius: 4 }}>NEW</span>}
                </div>
                <span style={{ color: 'var(--ink-35)', fontSize: 11 }}>{c.created_at?.split('T')[0]}</span>
              </div>
              <p style={{ color: 'var(--ink-72)', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{c.message}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {!c.is_read && <button onClick={() => markRead(c.id)} style={btnSmall}>Mark Read</button>}
                <button onClick={() => deleteContact(c.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Newsletter */}
      {tab === 'newsletter' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}>Subscribed</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.id}</td>
                  <td style={tdStyle}>{s.email}</td>
                  <td style={tdStyle}><span style={{ color: s.is_active ? '#5EEAD4' : '#f87171' }}>{s.is_active ? 'Yes' : 'No'}</span></td>
                  <td style={tdStyle}>{s.created_at?.split('T')[0]}</td>
                  <td style={tdStyle}>
                    <button onClick={() => deleteSubscriber(s.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
