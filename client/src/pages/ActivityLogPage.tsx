import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Filter, RefreshCw, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { AUDIT_ACTIONS, AUDIT_TONE_CLASSES, getAuditActionMeta } from '../lib/auditActions';
import { formatDateTime, formatRelativeTime } from '../lib/format';
import { LoadingBlock, Spinner } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';
import type { AuditLogDto } from '../lib/types';

const LIMIT_OPTIONS = [50, 100, 200];

export function ActivityLogPage(): JSX.Element {
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string>('');
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listAuditLogs({ action: action || undefined, limit });
      setLogs(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [action, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of logs) counts.set(log.action, (counts.get(log.action) ?? 0) + 1);
    return counts;
  }, [logs]);

  function exportJson(): void {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ciphernote-audit-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Security event history</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Only your own events are visible here. Entries contain identifiers and counts - never note plaintext,
              passwords or keys.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={exportJson}
              disabled={logs.length === 0}
              title="Download the events currently shown as JSON"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Filter className="h-3.5 w-3.5" />
            Event
          </label>
          <select
            className="select max-w-xs"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">All events</option>
            {Object.entries(AUDIT_ACTIONS).map(([code, meta]) => (
              <option key={code} value={code}>
                {meta.label} ({code})
              </option>
            ))}
          </select>

          <label className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Show
          </label>
          <select
            className="select w-28"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {summary.size > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {[...summary.entries()].map(([code, count]) => {
              const meta = getAuditActionMeta(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setAction(action === code ? '' : code)}
                  className={`badge ${AUDIT_TONE_CLASSES[meta.tone]}`}
                >
                  <meta.icon className="h-3 w-3" />
                  {meta.label}: {count}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="card">
          <LoadingBlock label="Loading your audit trail…" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No events recorded"
          description={
            action
              ? 'Nothing matches that filter yet. Try selecting a different event type.'
              : 'Sign-in, note changes, sharing and revocations will appear here as they happen.'
          }
          action={
            action ? (
              <button type="button" className="btn btn-secondary" onClick={() => setAction('')}>
                Clear filter
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="table-head">Event</th>
                  <th className="table-head">When</th>
                  <th className="table-head">Target</th>
                  <th className="table-head">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {logs.map((log) => {
                  const meta = getAuditActionMeta(log.action);
                  return (
                    <tr key={log.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="table-cell">
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${AUDIT_TONE_CLASSES[meta.tone]}`}
                          >
                            <meta.icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 dark:text-slate-100">{meta.label}</p>
                            <p className="mt-0.5 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {meta.description}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell whitespace-nowrap">
                        <span title={formatDateTime(log.createdAt)}>{formatRelativeTime(log.createdAt)}</span>
                        <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                          {formatDateTime(log.createdAt)}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {log.targetType ?? '—'}
                        </span>
                        <span className="mono-value mt-1 block">{log.targetId ?? log.noteId ?? '—'}</span>
                      </td>
                      <td className="table-cell">
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <dl className="space-y-0.5 text-xs">
                            {Object.entries(log.metadata).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <dt className="shrink-0 font-medium text-slate-500 dark:text-slate-400">{key}:</dt>
                                <dd className="min-w-0 break-all text-slate-600 dark:text-slate-300">
                                  {value === null ? 'null' : String(value)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">No extra metadata</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
