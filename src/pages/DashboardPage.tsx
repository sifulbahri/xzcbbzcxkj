import { ArrowRight, CalendarClock, Plus, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { StatusText, formatDateShort } from '../components/StatusText';
import { api } from '../services/api';
import type { ApplicationStatus, DashboardData } from '../types';

interface DashboardPageProps {
  onNavigate: (tab: 'jobs' | 'approval' | 'applications' | 'cv' | 'settings') => void;
  onOpenImport: () => void;
  refreshSignal: number;
}

const PIPELINE_ORDER: Array<{ key: ApplicationStatus; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'INTERVIEW', label: 'Interview' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'WITHDRAWN', label: 'Withdrawn' },
];

export function DashboardPage({ onNavigate, onOpenImport, refreshSignal }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getDashboard()
      .then((res) => {
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshSignal]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-800 border border-slate-800 rounded-lg overflow-hidden">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="bg-[#111827] p-5 h-24 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-[#111827] border border-rose-900/60 rounded-lg text-sm text-rose-200 flex items-center gap-3">
        <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, matchDistribution, statusCounts, activitySeries, upcomingFollowUps, recentHistory } =
    data;

  const maxDistCount = Math.max(1, ...matchDistribution.map((m) => m.count));
  const maxPipelineCount = Math.max(
    1,
    ...PIPELINE_ORDER.map((item) => statusCounts[item.key] || 0)
  );
  const maxActivityCount = Math.max(
    1,
    ...activitySeries.map((item) => Math.max(item.jobs, item.actions))
  );

  const statItems = [
    {
      label: 'Total Discovered Jobs',
      value: kpis.totalDiscoveredJobs,
      sub: 'Saved vacancies',
      onClick: () => onNavigate('jobs'),
    },
    {
      label: 'Awaiting AI Analysis',
      value: kpis.awaitingAnalysis,
      sub: 'Pending evaluation',
      onClick: () => onNavigate('jobs'),
    },
    {
      label: 'Profile Matches',
      value: kpis.matchingProfile,
      sub: 'Above threshold',
      onClick: () => onNavigate('jobs'),
    },
    {
      label: 'Awaiting Approval',
      value: kpis.awaitingApproval,
      sub: 'Mandatory review queue',
      onClick: () => onNavigate('approval'),
    },
    {
      label: 'Applications Submitted',
      value: kpis.submitted,
      sub: 'Sent via Glints',
      onClick: () => onNavigate('applications'),
    },
    {
      label: 'Interviews',
      value: kpis.interviews,
      sub: 'Active interview stage',
      onClick: () => onNavigate('applications'),
    },
    {
      label: 'Rejections',
      value: kpis.rejections,
      sub: 'Closed or declined',
      onClick: () => onNavigate('applications'),
    },
    {
      label: 'Interview Conversion',
      value: `${kpis.successRate}%`,
      sub: 'Interviews / outcomes',
      onClick: () => onNavigate('applications'),
    },
  ];

  return (
    <div className="space-y-8">
      {/* 8-metric unified hairline KPI grid */}
      <section aria-label="Key Metrics">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-800 border border-slate-800 rounded-lg overflow-hidden">
          {statItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="bg-[#111827] hover:bg-[#151E30] text-left p-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              <div className="text-xs font-medium text-slate-400">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold text-slate-100 font-mono tabular-nums">
                {item.value}
              </div>
              <div className="mt-1 text-xs text-slate-500">{item.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {kpis.totalDiscoveredJobs === 0 ? (
        <section className="p-8 bg-[#111827] border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="space-y-1.5 max-w-xl">
            <h2 className="text-base font-semibold text-slate-100">
              Your job workspace is ready for your first Jakarta cybersecurity vacancy
            </h2>
            <p className="text-sm text-slate-400">
              Upload your latest CV in CV Manager and import a Glints vacancy URL with its job
              description. The AI analyzer will score all nine compatibility dimensions and queue
              prepared applications for your explicit approval.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('cv')}
              className="px-4 py-2 text-xs font-medium text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap"
            >
              Upload CV
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import First Vacancy</span>
            </button>
          </div>
        </section>
      ) : null}

      {/* Visual analytics: Match Distribution + Application Pipeline */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Job Match Distribution</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Suitability tiers across analyzed vacancies
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('jobs')}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap"
            >
              <span>View Jobs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            {matchDistribution.map((bucket, idx) => {
              const widthPct = Math.round((bucket.count / maxDistCount) * 100);
              const barColor =
                idx === 0
                  ? 'bg-emerald-500'
                  : idx === 1
                    ? 'bg-sky-500'
                    : idx === 2
                      ? 'bg-amber-500'
                      : 'bg-rose-500';
              return (
                <div key={bucket.range} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{bucket.label}</span>
                    <span className="font-mono tabular-nums text-slate-200 font-medium">
                      {bucket.count}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-[#0B1120] rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all duration-300`}
                      style={{ width: `${bucket.count === 0 ? 0 : Math.max(4, widthPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Application Pipeline Activity</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Current application count by stage
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('applications')}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap"
            >
              <span>Open Tracker</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {PIPELINE_ORDER.map((stage) => {
              const count = statusCounts[stage.key] || 0;
              const widthPct = Math.round((count / maxPipelineCount) * 100);
              return (
                <div key={stage.key} className="grid grid-cols-12 items-center gap-3 text-xs">
                  <div className="col-span-5 text-slate-300 truncate">{stage.label}</div>
                  <div className="col-span-6 h-2 bg-[#0B1120] rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-sky-500/80 transition-all duration-300"
                      style={{ width: `${count === 0 ? 0 : Math.max(4, widthPct)}%` }}
                    />
                  </div>
                  <div className="col-span-1 text-right font-mono tabular-nums text-slate-200 font-medium">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Activity Timeline + Follow-ups / Audit Log */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-100">14-Day Activity Volume</h2>
          <p className="text-xs text-slate-400 mt-0.5 mb-5">
            Vacancies imported vs. workflow transitions
          </p>

          {activitySeries.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No activity logged in the past 14 days.
            </p>
          ) : (
            <div className="space-y-3">
              {activitySeries.slice(-7).map((row) => (
                <div key={row.day} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-400">{row.day}</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {row.jobs} jobs · {row.actions} actions
                    </span>
                  </div>
                  <div className="flex gap-1 h-1.5">
                    <div
                      className="bg-sky-500 rounded-sm"
                      style={{
                        width: `${Math.round((row.jobs / maxActivityCount) * 50)}%`,
                      }}
                    />
                    <div
                      className="bg-emerald-500 rounded-sm"
                      style={{
                        width: `${Math.round((row.actions / maxActivityCount) * 50)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-100">Upcoming Follow-Ups</h2>
            <CalendarClock className="w-4 h-4 text-slate-400" aria-hidden="true" />
          </div>
          {upcomingFollowUps.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              No follow-up reminders scheduled. Set follow-up dates in Application Tracker.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {upcomingFollowUps.map((f) => (
                <div key={f.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate">{f.job_title}</div>
                    <div className="text-xs text-slate-400 truncate">{f.company}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs text-amber-300 tabular-nums">
                      {formatDateShort(f.follow_up_date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-100 mb-4">Recent Audit Trail</h2>
          {recentHistory.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Application decisions and status transitions will appear here.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {recentHistory.slice(0, 5).map((item) => (
                <div key={item.id} className="py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {item.job_title}
                    </span>
                    <StatusText status={item.to_status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate">{item.company}</span>
                    <span className="font-mono tabular-nums shrink-0">
                      {formatDateShort(item.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
