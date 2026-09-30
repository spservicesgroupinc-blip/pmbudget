import React from 'react';
import {
  FileText,
  Boxes,
  DollarSign,
  GanttChartSquare,
  Share2,
  Code2,
  ClipboardList,
  Palette,
  Plus,
  Users,
  UploadCloud,
} from 'lucide-react';
import { EstimateResult } from '../types/estimate';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: string | number;
}

interface SideMenuProps {
  activeSection: string;
  onSelectSection: (id: string) => void;
  onAddTrade: () => void;
  currentEstimate: EstimateResult | null;
  isProcessing: boolean;
  hasUnsavedChanges?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const SideMenu: React.FC<SideMenuProps> = ({
  activeSection,
  onSelectSection,
  onAddTrade,
  currentEstimate,
  isProcessing,
  hasUnsavedChanges,
}) => {
  const meta = currentEstimate?.project_meta;
  const tradeCount = currentEstimate?.trade_sections.length || 0;
  const selectionCount = currentEstimate?.customer_selections?.length || 0;

  const groups: NavGroup[] = [
    {
      label: 'Build Workflow',
      items: [
        {
          id: 'intake',
          label: 'Intake & Metadata',
          icon: FileText,
          badge: meta ? '✓' : undefined,
        },
        {
          id: 'packages',
          label: 'Trade Packages',
          icon: Boxes,
          badge: tradeCount > 0 ? tradeCount : undefined,
        },
        {
          id: 'buyout',
          label: 'Buyout Budget',
          icon: DollarSign,
          badge: meta ? '$' : undefined,
        },
        {
          id: 'gantt',
          label: 'Gantt Schedule',
          icon: GanttChartSquare,
          badge: tradeCount > 0 ? `${tradeCount}T` : undefined,
        },
      ],
    },
    {
      label: 'Records',
      items: [
        {
          id: 'customers',
          label: 'Customer Profiles',
          icon: Users,
        },
      ],
    },
    {
      label: 'Deliver',
      items: [
        {
          id: 'workorders',
          label: 'Field Work Orders',
          icon: ClipboardList,
          badge: tradeCount > 0 ? 'WO' : undefined,
        },
        {
          id: 'selections',
          label: 'Customer Selections',
          icon: Palette,
          badge: selectionCount > 0 ? selectionCount : undefined,
        },
        {
          id: 'workspace',
          label: 'Workspace Sync',
          icon: Share2,
          badge: 'G-Suite',
        },
        {
          id: 'json',
          label: 'JSON & Schema',
          icon: Code2,
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Horizontal Pill Strip (<1024px) */}
      <div className="lg:hidden w-full overflow-x-auto no-scrollbar pb-2 border-b border-slate-200 sticky top-16 z-20 bg-slate-50/95 backdrop-blur">
        <div className="flex items-center gap-1.5 min-w-max py-1">
          {groups.flatMap((g) => g.items).map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectSection(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-2 px-3 h-9 rounded-lg text-[13px] font-medium border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-600/25'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`}
                />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`ml-1 px-1.5 h-[18px] rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop Side Menu (>= 1024px) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-4 self-start sticky top-[4.5rem]">
        {/* Navigation */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {groups.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? 'pt-1' : ''}>
              <div className="px-4 pt-4 pb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {group.label}
                </span>
              </div>
              <nav className="p-2 space-y-0.5" aria-label={group.label}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectSection(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative flex w-full items-center gap-2.5 px-2.5 h-10 rounded-xl text-[13px] font-medium transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-red-600 to-rose-500 text-white shadow-md shadow-red-500/25'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] shrink-0 ${
                          isActive ? 'text-white' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={`ml-auto min-w-[20px] h-[20px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
          <div className="p-2 border-t border-slate-100">
            <button
              onClick={onAddTrade}
              disabled={!meta}
              className={`flex w-full items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold transition-all ${
                meta
                  ? 'bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.99] shadow-sm'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>New Trade Package</span>
            </button>
            <button
              onClick={() => onSelectSection('intake')}
              className="mt-1 flex w-full items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <UploadCloud className="w-4 h-4 text-slate-400" />
              <span>Upload Estimate</span>
            </button>
          </div>
        </div>

        {/* Current Record Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Current Record
            </span>
            {hasUnsavedChanges && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-0.5">
                Modified
              </span>
            )}
          </div>

          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`relative flex w-2 h-2 shrink-0 ${
                  isProcessing
                    ? 'text-amber-500'
                    : meta
                    ? 'text-emerald-500'
                    : 'text-slate-300'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                {isProcessing && (
                  <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-75" />
                )}
              </span>
              <span className="text-[13px] font-semibold text-slate-900 truncate">
                {isProcessing
                  ? 'Analyzing Estimate…'
                  : meta
                  ? meta.client_name
                  : 'Empty Session'}
              </span>
            </div>

            {meta ? (
              <>
                <p className="text-[11px] text-slate-500 font-mono tabular-nums truncate pl-4">
                  {meta.carrier} · #{meta.claim_number}
                </p>
                <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between text-[12px] pl-4">
                  <span className="text-slate-500">Total RCV:</span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    ${meta.total_rcv.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] pl-4 text-slate-500">
                  <span>Packages:</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {tradeCount} Trade Packages
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-slate-400 pl-4 leading-relaxed">
                No active Xactimate claim. Upload a PDF or load sample data.
              </p>
            )}
          </div>
        </div>

        {/* Quick Help Tip */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 text-[11px] text-slate-500 space-y-1">
          <p className="font-semibold text-slate-700">Project Manager Guide</p>
          <p className="leading-relaxed">
            Grand total RCV is reconciled against rolled-up trade buyout packages.
            Sequencing is computed using Finish-to-Start (FS) logic.
          </p>
        </div>
      </aside>
    </>
  );
};
