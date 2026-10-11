'use client';

import {
  CheckCircle,
  XCircle,
} from 'lucide-react';


// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

export function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
  ) : (
    <XCircle className="w-5 h-5 text-red-400 shrink-0" />
  );
}


export function LogStatusBadge({ status }: { status?: string }) {
  if (!status) {
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">実行中</span>;
  }
  const map: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    aborted: 'bg-gray-100 text-gray-600',
  };
  const labelMap: Record<string, string> = {
    success: '成功',
    failed: '失敗',
    aborted: '中断',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labelMap[status] ?? status}
    </span>
  );
}


export function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
}
