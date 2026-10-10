import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, FolderOpen, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import type { EstimateResult } from '../../types/estimate';
import { CustomerProfileSummary, getCustomerProfile, listCustomerProfiles } from '../../services/gappsApi';

interface HomeSectionProps {
  currentEstimate: EstimateResult | null;
  hasUnsavedChanges: boolean;
  isBusy: boolean;
  refreshVersion: number;
  onNewJob: () => void;
  onNavigateSection: (id: string) => void;
  onOpenProfile: (estimate: EstimateResult, profile: CustomerProfileSummary) => void;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const updatedTime = (job: CustomerProfileSummary) => Date.parse(job.updated_at || job.created_at || '') || 0;
const dateLabel = (job: CustomerProfileSummary) => updatedTime(job)
  ? new Date(updatedTime(job)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable';

export function HomeSection({ currentEstimate, hasUnsavedChanges, isBusy, refreshVersion, onNewJob, onNavigateSection, onOpenProfile }: HomeSectionProps) {
  const [jobs, setJobs] = useState<CustomerProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [refresh, setRefresh] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const opening = useRef(false);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCustomerProfiles().then((data) => { if (!cancelled) setJobs(data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load saved jobs.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh, refreshVersion]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => [job.client_name, job.claim_number, job.property_address, job.carrier].join(' ').toLowerCase().includes(query))
      .sort((a, b) => sort === 'name' ? a.client_name.localeCompare(b.client_name) : updatedTime(b) - updatedTime(a));
  }, [jobs, search, sort]);
  const total = jobs.reduce((sum, job) => sum + (Number(job.total_rcv) || 0), 0);
  const recent = jobs.filter((job) => updatedTime(job) >= Date.now() - 7 * 86400000).length;

  async function openJob(job: CustomerProfileSummary) {
    if (opening.current || isBusy) return;
    opening.current = true;
    setOpeningId(job.customer_id);
    setOpenError(null);
    try {
      const loaded = await getCustomerProfile(job.customer_id);
      if (mounted.current) onOpenProfile(loaded.estimate, loaded.profile);
    } catch (err) {
      if (mounted.current) setOpenError(err instanceof Error ? err.message : 'Could not open this job.');
    } finally {
      opening.current = false;
      if (mounted.current) setOpeningId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Project manager workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Job overview</h1>
          <p className="mt-2 text-sm text-slate-500">Pick up a saved job or bring a new estimate into the workspace.</p>
        </div>
        <button onClick={onNewJob} disabled={isBusy || !!openingId} className="hidden min-h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 sm:inline-flex"><Plus className="h-4 w-4" /> New job</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Saved jobs', value: jobs.length.toLocaleString(), detail: 'Available in your workspace', icon: FolderOpen },
          { label: 'Total estimate value', value: money.format(total), detail: 'RCV across saved estimates', icon: Building2 },
          { label: 'Updated this week', value: recent.toLocaleString(), detail: 'Jobs saved in the last 7 days', icon: CalendarDays },
        ].map(({ label, value, detail, icon: Icon }) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border border-slate-200 bg-white p-4 sm:block sm:p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-500">{label}</p><Icon className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden /></div>
            <p className="col-start-2 row-span-2 row-start-1 self-center text-2xl font-semibold tracking-tight tabular-nums text-slate-900 sm:mt-3 sm:text-3xl">{loading ? '…' : error ? '—' : value}</p>
            <p className="mt-1 text-xs text-slate-500 sm:mt-2">{detail}</p>
          </div>
        ))}
      </div>

      {currentEstimate && (
        <section className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 border-l-4 border-l-red-600 bg-white p-5 sm:flex-row sm:items-center" aria-label="Current job">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current job</span>{hasUnsavedChanges && <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Unsaved changes</span>}</div>
            <h2 className="text-lg font-semibold text-slate-900">{currentEstimate.project_meta.client_name}</h2>
            <p className="mt-1 text-sm text-slate-500">Claim {currentEstimate.project_meta.claim_number} · {currentEstimate.trade_sections.length} trade packages</p>
          </div>
          <button onClick={() => onNavigateSection('buyout')} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Continue job <ArrowRight className="h-4 w-4" /></button>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="saved-jobs-title">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div><h2 id="saved-jobs-title" className="text-base font-semibold text-slate-900">Your jobs</h2><p className="mt-1 text-xs text-slate-500">Open a saved estimate to continue planning the work.</p></div>
          <button onClick={() => setRefresh((n) => n + 1)} disabled={loading || !!openingId} aria-label="Refresh jobs" title="Refresh jobs" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row">
          <label className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><span className="sr-only">Search jobs</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, claim, or address…" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" /></label>
          <label><span className="sr-only">Sort jobs</span><select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 sm:w-auto"><option value="recent">Recently updated</option><option value="name">Customer name</option></select></label>
        </div>
        {openError && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">{openError}</p>}
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…</div>
        ) : error ? (
          <div role="alert" className="px-5 py-12 text-center"><h3 className="font-semibold text-slate-900">Jobs could not be loaded</h3><p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{error}</p><button onClick={() => setRefresh((n) => n + 1)} className="mt-4 min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Try again</button></div>
        ) : !jobs.length ? (
          <div className="px-5 py-14 text-center"><FolderOpen className="mx-auto mb-4 h-8 w-8 text-slate-300" /><h3 className="text-lg font-semibold text-slate-900">Your next job starts here</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Upload an estimate to prepare the budget, organize trades, and plan the work. Saved jobs will appear here.</p><button onClick={onNewJob} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Start a new job <ArrowRight className="h-4 w-4" /></button></div>
        ) : !filtered.length ? (
          <div className="px-5 py-14 text-center"><h3 className="font-semibold">No matching jobs</h3><p className="mt-2 text-sm text-slate-500">Try a customer name, claim number, or property address.</p><button onClick={() => setSearch('')} className="mt-4 text-sm font-semibold text-red-600">Clear search</button></div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_7rem_5rem] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs font-medium text-slate-500 xl:grid"><span>Customer / property</span><span>Claim / carrier</span><span className="text-right">Estimate RCV</span><span>Last saved</span><span /></div>
            <ul className="divide-y divide-slate-100">
              {filtered.map((job) => (
                <li key={job.customer_id} className="grid items-center gap-3 px-5 py-5 hover:bg-slate-50/60 sm:grid-cols-[1fr_auto] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_7rem_5rem] xl:gap-4">
                  <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-900">{job.client_name}</p><p className="mt-1 break-words text-xs leading-5 text-slate-500">{job.property_address || 'Property address not provided'}</p></div>
                  <div className="min-w-0 sm:col-start-1 xl:col-auto"><p className="break-words text-xs font-medium text-slate-700">Claim {job.claim_number || '—'}</p><p className="mt-1 text-xs text-slate-500">{job.carrier || 'Carrier not provided'}</p></div>
                  <p className="text-sm font-semibold tabular-nums text-slate-700 xl:text-right">{job.total_rcv == null ? '—' : money.format(job.total_rcv)}<span className="ml-1 text-xs font-normal text-slate-500 xl:hidden">RCV</span></p>
                  <p className="text-xs leading-5 text-slate-500"><span className="xl:hidden">Saved </span>{dateLabel(job)}</p>
                  <button disabled={!!openingId || isBusy} onClick={() => void openJob(job)} aria-label={`Open job for ${job.client_name}`} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 sm:col-start-2 sm:row-start-1 xl:col-auto xl:row-auto">{openingId === job.customer_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Open <ArrowUpRight className="h-3.5 w-3.5" /></>}</button>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{filtered.length} of {jobs.length} saved {jobs.length === 1 ? 'job' : 'jobs'}</div>
          </>
        )}
      </section>
      <p className="text-xs leading-5 text-slate-400">Estimate values reflect saved RCV. Review each job’s budget before issuing work orders.</p>
    </div>
  );
}
