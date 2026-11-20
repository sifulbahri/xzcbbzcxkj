import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck2,
  MinusCircle,
  Send,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type { ApplicationStatus, MatchClassification } from '../types';

const STATUS_META: Record<
  ApplicationStatus,
  { label: string; colorClass: string; Icon: typeof Clock }
> = {
  DISCOVERED: { label: 'Discovered', colorClass: 'text-slate-300', Icon: Clock },
  ANALYZED: { label: 'Analyzed', colorClass: 'text-sky-400', Icon: Sparkles },
  PREPARED: { label: 'Prepared', colorClass: 'text-indigo-300', Icon: FileCheck2 },
  PENDING_APPROVAL: { label: 'Pending Approval', colorClass: 'text-amber-400', Icon: AlertTriangle },
  APPROVED: { label: 'Approved', colorClass: 'text-emerald-400', Icon: CheckCircle2 },
  SUBMITTED: { label: 'Submitted', colorClass: 'text-sky-300', Icon: Send },
  INTERVIEW: { label: 'Interview', colorClass: 'text-emerald-300', Icon: UserCheck },
  REJECTED: { label: 'Rejected', colorClass: 'text-rose-400', Icon: XCircle },
  WITHDRAWN: { label: 'Withdrawn', colorClass: 'text-slate-500', Icon: MinusCircle },
};

export function StatusText({ status }: { status: ApplicationStatus }) {
  const meta = STATUS_META[status] || STATUS_META.DISCOVERED;
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${meta.colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

export function ScoreDisplay({
  score,
  classification,
}: {
  score: number | null | undefined;
  classification?: MatchClassification | null;
}) {
  if (score === null || score === undefined) {
    return <span className="font-mono text-xs text-slate-500 tabular-nums">Not analyzed</span>;
  }

  let color = 'text-slate-300';
  if (score >= 85) color = 'text-emerald-400';
  else if (score >= 70) color = 'text-sky-400';
  else if (score >= 50) color = 'text-amber-400';
  else color = 'text-rose-400';

  return (
    <span className={`inline-flex items-baseline gap-2 font-mono tabular-nums ${color}`}>
      <span className="text-sm font-semibold">{score}%</span>
      {classification && <span className="font-sans text-xs text-slate-400">{classification}</span>}
    </span>
  );
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatIdr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Undisclosed';
  return `IDR ${amount.toLocaleString('en-US')}`;
}
