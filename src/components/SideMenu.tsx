import React, { useRef, useState } from 'react';
import {
  Boxes, ChevronDown, ClipboardList, Code2, DollarSign, FolderOpen,
  GanttChartSquare, Menu, Palette, Plus, Share2, UploadCloud, X,
} from 'lucide-react';
import type { EstimateResult } from '../types/estimate';

export interface NavItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

export const PROJECT_NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Project', items: [
    { id: 'customers', label: 'Saved jobs', description: 'Find a saved job and pick up where you left off.', icon: FolderOpen },
    { id: 'intake', label: 'Estimate intake', description: 'Upload an estimate and review the job information.', icon: UploadCloud },
  ] },
  { label: 'Plan & budget', items: [
    { id: 'buyout', label: 'Budget', description: 'Review trade allowances, compare bids, and plan your buyout.', icon: DollarSign },
    { id: 'packages', label: 'Trade packages', description: 'Organize the scope of work for each trade.', icon: Boxes },
    { id: 'gantt', label: 'Schedule', description: 'Sequence the work and adjust the project timeline.', icon: GanttChartSquare },
  ] },
  { label: 'Documents & sharing', items: [
    { id: 'workorders', label: 'Work orders', description: 'Prepare subcontractor agreements and field instructions.', icon: ClipboardList },
    { id: 'selections', label: 'Customer selections', description: 'Review finishes, material allowances, and customer choices.', icon: Palette },
    { id: 'workspace', label: 'Exports', description: 'Share budgets, scopes, schedules, and documents with the office.', icon: Share2 },
  ] },
  { label: 'Advanced', items: [
    { id: 'json', label: 'JSON data', description: 'Review and export the underlying estimate data.', icon: Code2 },
  ] },
];

export const PROJECT_NAV_ITEMS = PROJECT_NAV_GROUPS.flatMap((group) => group.items);

interface SideMenuProps {
  activeSection: string;
  onSelectSection: (id: string) => void;
  onAddTrade: () => void;
  currentEstimate: EstimateResult | null;
  isProcessing: boolean;
  hasUnsavedChanges?: boolean;
}

export const SideMenu: React.FC<SideMenuProps> = ({
  activeSection, onSelectSection, onAddTrade, currentEstimate, isProcessing, hasUnsavedChanges,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const meta = currentEstimate?.project_meta;
  const activeItem = PROJECT_NAV_ITEMS.find((item) => item.id === activeSection);

  const navigate = (id: string) => {
    setMobileOpen(false);
    onSelectSection(id);
    mobileToggle.current?.focus({ preventScroll: true });
  };

  const renderGroups = () => PROJECT_NAV_GROUPS.map((group) => (
    <section key={group.label} className="min-w-0">
      <h2 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {group.label}
      </h2>
      <div className="space-y-1">
        {group.items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeSection;
          const count = item.id === 'packages' ? currentEstimate?.trade_sections.length
            : item.id === 'selections' ? currentEstimate?.customer_selections?.length : undefined;
          return (
            <button
              key={item.id} type="button" onClick={() => navigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-inset ${
                active ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-red-600' : 'text-slate-400'}`} aria-hidden />
              <span className="min-w-0 flex-1 leading-5">{item.label}</span>
              {!!count && <span className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${active ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{count}</span>}
            </button>
          );
        })}
      </div>
    </section>
  ));

  const addTradeButton = (
    <button type="button" disabled={!meta} onClick={() => {
      setMobileOpen(false);
      onAddTrade();
      mobileToggle.current?.focus({ preventScroll: true });
    }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40">
      <Plus className="h-4 w-4" aria-hidden /> New trade package
    </button>
  );

  return (
    <>
      <div className="min-w-0 lg:hidden" onKeyDown={(event) => {
        if (event.key === 'Escape' && mobileOpen) {
          setMobileOpen(false);
          mobileToggle.current?.focus();
        }
      }}>
        <button ref={mobileToggle} type="button" onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen} aria-controls="pm-mobile-navigation" aria-label="Project menu"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
          {mobileOpen ? <X className="h-5 w-5 shrink-0 text-slate-500" aria-hidden /> : <Menu className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />}
          <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-slate-500">Project menu</span><span className="block text-sm font-semibold text-slate-900">{activeItem?.label || 'Choose a section'}</span></span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${mobileOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {mobileOpen && (
          <div id="pm-mobile-navigation" className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <nav aria-label="Mobile project navigation" className="grid gap-5 sm:grid-cols-2">{renderGroups()}</nav>
            <div className="mt-4 border-t border-slate-100 pt-3">{addTradeButton}</div>
          </div>
        )}
      </div>

      <aside className="hidden w-60 shrink-0 self-start lg:flex lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:flex-col" aria-label="Project sidebar">
        <div className="shrink-0 rounded-t-xl border border-b-0 border-slate-200 bg-white px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current job</p>
            {hasUnsavedChanges && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Modified</span>}
          </div>
          <p className="truncate text-sm font-semibold text-slate-900">{isProcessing ? 'Analyzing estimate…' : meta?.client_name || 'No job selected'}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{meta ? `Claim ${meta.claim_number}` : 'Open a saved job or upload an estimate'}</p>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-b-xl border border-slate-200 bg-white p-2.5">
          <nav aria-label="Project navigation" className="space-y-5 py-2">{renderGroups()}</nav>
          <div className="mt-3 border-t border-slate-100 pt-3">{addTradeButton}</div>
        </div>
      </aside>
    </>
  );
};
