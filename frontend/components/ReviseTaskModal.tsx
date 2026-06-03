'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';

type RepoAssignment = {
  id: number;
  repo_display_name: string;
  status: string;
  pr_url?: string | null;
  pr_merged?: boolean;
  revision_count?: number;
};

type RevisionItem = {
  id: number;
  assignment_id: number | null;
  repo_display_name: string;
  status: string;
};

type Props = {
  open: boolean;
  taskId: number;
  taskTitle: string;
  assignments: RepoAssignment[];
  onClose: () => void;
  onSubmitted: (items: RevisionItem[], instruction: string) => void;
};

/** "Revize iste" follow-up modal — collects a short instruction the
 *  agent should apply on top of the existing branch + PR. For
 *  multi-repo tasks the user can scope the revision to specific
 *  assignments (default = all completed, non-merged). For single-repo
 *  tasks the picker is hidden — the modal is just an instruction box.
 *  See `RevisionService.request_revision` on the backend for the
 *  validation rules this modal mirrors client-side. */
export default function ReviseTaskModal({
  open, taskId, taskTitle, assignments, onClose, onSubmitted,
}: Props) {
  const { t } = useLocale();
  const [instruction, setInstruction] = useState('');
  // Default selection = every assignment whose PR is not merged
  // (revising a merged PR is a no-op — we hide those rows entirely).
  const eligibleAssignments = useMemo(
    () => assignments.filter((a) => !a.pr_merged),
    [assignments],
  );
  const [selected, setSelected] = useState<Set<number>>(() => new Set(eligibleAssignments.map((a) => a.id)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset textarea + selection ONLY on the open false→true edge.
  // The parent passes a freshly-mapped `assignments` array every
  // render, so depending on `eligibleAssignments` here would wipe
  // the user's text on every keystroke (parent re-renders → new
  // array reference → effect re-fires).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setInstruction('');
      setError('');
      setSelected(new Set(eligibleAssignments.map((a) => a.id)));
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const showPicker = eligibleAssignments.length > 1;
  const allMerged = assignments.length > 0 && eligibleAssignments.length === 0;
  const submitDisabled =
    submitting
    || instruction.trim().length < 3
    || (showPicker ? selected.size === 0 : false)
    || allMerged;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (submitDisabled) return;
    setSubmitting(true);
    setError('');
    try {
      const body: { instruction: string; repo_assignment_ids?: number[] } = {
        instruction: instruction.trim(),
      };
      // Single-repo task → omit ids (backend defaults to "all eligible").
      if (showPicker) {
        body.repo_assignment_ids = Array.from(selected);
      }
      const res = await apiFetch<{ queued: boolean; revisions: RevisionItem[] }>(
        '/tasks/' + taskId + '/revise',
        { method: 'POST', body: JSON.stringify(body) },
      );
      onSubmitted(res.revisions || [], instruction.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit revision');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '90vh',
          background: 'var(--surface)', color: 'var(--ink-90)',
          border: '1px solid var(--panel-border-3)', borderRadius: 14,
          padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#a78bfa', marginBottom: 4 }}>
            {t('taskDetail.revise.label' as TranslationKey) || 'Revize iste'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.35 }}>
            {`#${taskId} ${taskTitle}`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-55)', marginTop: 4, lineHeight: 1.5 }}>
            {t('taskDetail.revise.hint' as TranslationKey)
              || 'Aynı branch üzerinde ek bir commit atılır, açık PR otomatik güncellenir. Yeni PR açılmaz.'}
          </div>
        </div>

        {allMerged && (
          <div style={{
            padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
            background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
            border: '1px solid rgba(245,158,11,0.35)',
          }}>
            {t('taskDetail.revise.allMerged' as TranslationKey)
              || 'Tüm PR\'lar merge olmuş — küçük düzeltme için yeni bir task açmak daha temiz.'}
          </div>
        )}

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={
            (t('taskDetail.revise.placeholder' as TranslationKey)
              || 'Sadece migration dosyasını dokunmadan üzerine ek yap.') as string
          }
          rows={5}
          disabled={allMerged}
          style={{
            width: '100%', padding: 12, borderRadius: 10,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--panel-alt)', color: 'var(--ink-90)',
            fontSize: 13, lineHeight: 1.5, resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />

        {showPicker && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', letterSpacing: 0.6, textTransform: 'uppercase' }}>
              {t('taskDetail.revise.repoPick' as TranslationKey) || 'Hangi repolar'}
            </div>
            <div style={{ display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {eligibleAssignments.map((a) => {
                const on = selected.has(a.id);
                return (
                  <label key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    border: '1px solid ' + (on ? 'rgba(167,139,250,0.55)' : 'var(--panel-border-2)'),
                    background: on ? 'rgba(167,139,250,0.1)' : 'var(--panel-alt)',
                    cursor: 'pointer', fontSize: 12, color: 'var(--ink-78)',
                  }}>
                    <input
                      type='checkbox'
                      checked={on}
                      onChange={() => toggle(a.id)}
                      style={{ accentColor: '#a78bfa', width: 14, height: 14 }}
                    />
                    <span style={{ fontWeight: 700, color: 'var(--ink-90)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.repo_display_name}
                    </span>
                    {(a.revision_count ?? 0) > 0 && (
                      <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
                        ↺ {a.revision_count}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, fontSize: 12,
            background: 'rgba(248,113,113,0.12)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.35)',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type='button'
            onClick={onClose}
            disabled={submitting}
            style={{
              fontSize: 12, padding: '8px 16px', borderRadius: 10,
              border: '1px solid var(--panel-border-2)', background: 'transparent',
              color: 'var(--ink-65)', cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            {t('tasks.cancel') || 'Vazgeç'}
          </button>
          <button
            type='button'
            disabled={submitDisabled}
            onClick={submit}
            style={{
              fontSize: 12, padding: '8px 18px', borderRadius: 10,
              border: '1px solid rgba(167,139,250,0.6)',
              background: submitDisabled ? 'var(--panel)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
              color: submitDisabled ? 'var(--ink-35)' : '#fff',
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              fontWeight: 800,
            }}
          >
            {submitting
              ? (t('taskDetail.revise.submitting' as TranslationKey) || 'Gönderiliyor…')
              : (t('taskDetail.revise.submit' as TranslationKey) || '↺ Revizyon iste')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
