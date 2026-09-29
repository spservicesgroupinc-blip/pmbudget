import React, { useState } from 'react';
import {
  Boxes,
  Clock,
  ArrowRight,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { EstimateResult, TradeSection } from '../../types/estimate';

interface TradePackagesSectionProps {
  estimate: EstimateResult | null;
  onUpdateTrade: (taskId: string, updated: Partial<TradeSection>) => void;
  onAddTrade: () => void;
  onNavigateSection: (id: string) => void;
}

export const TradePackagesSection: React.FC<TradePackagesSectionProps> = ({
  estimate,
  onUpdateTrade,
  onAddTrade,
  onNavigateSection,
}) => {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <Boxes className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No Trade Packages Available
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Upload an Xactimate estimate to generate rolled-up subcontractor work packages.
        </p>
      </div>
    );
  }

  const trades = estimate.trade_sections;
  const totalRcv = trades.reduce((acc, t) => acc + (t.billable_revenue || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-none">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Consolidated Trade Work Packages ({trades.length})
            </h3>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
              Buyout Ready
            </span>
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Micro-line items rolled up into unified subcontractor scope packages with Finish-to-Start (FS) dependencies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
              Total Package RCV
            </span>
            <span className="text-[18px] font-bold text-slate-900 tabular-nums">
              ${totalRcv.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <button
            onClick={onAddTrade}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Package</span>
          </button>
          <button
            onClick={() => onNavigateSection('buyout')}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors"
          >
            <span>Proceed to Buyout</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Trade Work Package Cards */}
      <div className="space-y-3">
        {trades.map((trade, idx) => {
          const isExpanded = expandedTaskId === trade.task_id;
          const isEditing = editingTaskId === trade.task_id;

          return (
            <div
              key={trade.task_id}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none transition-all hover:border-slate-300"
            >
              <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Left: Task ID, Trade Name, Codes */}
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 text-red-700 font-mono font-bold text-[13px] flex items-center justify-center shrink-0">
                    {trade.task_id}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[15px] font-semibold text-slate-900 truncate">
                        {trade.trade_name}
                      </h4>
                      <div className="flex items-center gap-1">
                        {trade.category_codes_included.map((code) => (
                          <span
                            key={code}
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200"
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>

                    <p className="text-[12px] text-slate-600 mt-1 line-clamp-2">
                      {trade.scope_summary}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {trade.suggested_duration_days} business day(s)
                        </span>
                      </span>

                      <span>•</span>

                      <span>
                        Predecessors:{' '}
                        {trade.predecessors ? (
                          <span className="font-semibold font-mono text-slate-800">
                            {trade.predecessors}
                          </span>
                        ) : (
                          <span className="italic text-slate-400">None (Phase 1 Start)</span>
                        )}
                      </span>

                      {trade.subcontractor_name && (
                        <>
                          <span>•</span>
                          <span className="font-medium text-emerald-700">
                            Assigned: {trade.subcontractor_name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Billable RCV & Quick Actions */}
                <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100">
                  <div className="text-left md:text-right">
                    <span className="block text-[11px] text-slate-400 uppercase font-semibold">
                      Approved RCV
                    </span>
                    <span className="text-[16px] font-bold text-slate-900 tabular-nums">
                      ${trade.billable_revenue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        setEditingTaskId(isEditing ? null : trade.task_id)
                      }
                      className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-[12px] font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{isEditing ? 'Done' : 'Edit'}</span>
                    </button>

                    <button
                      onClick={() =>
                        setExpandedTaskId(isExpanded ? null : trade.task_id)
                      }
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      aria-label="Toggle details"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Inline Editor Form */}
              {isEditing && (
                <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 animate-in fade-in duration-100">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Trade Package Name
                      </label>
                      <input
                        type="text"
                        value={trade.trade_name}
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            trade_name: e.target.value,
                          })
                        }
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[12px]"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Billable Revenue ($ RCV)
                      </label>
                      <input
                        type="number"
                        value={trade.billable_revenue}
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            billable_revenue: Number(e.target.value) || 0,
                          })
                        }
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[12px] tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Workday Duration (Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={trade.suggested_duration_days}
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            suggested_duration_days:
                              parseInt(e.target.value, 10) || 1,
                          })
                        }
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[12px] tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-600 font-medium mb-1">
                        Predecessors (e.g. T-1, T-2)
                      </label>
                      <input
                        type="text"
                        value={trade.predecessors}
                        placeholder="e.g. T-1"
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            predecessors: e.target.value,
                          })
                        }
                        className="w-full h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[12px] font-mono"
                      />
                    </div>

                    <div className="sm:col-span-2 md:col-span-4">
                      <label className="block text-slate-600 font-medium mb-1">
                        Scope of Work Summary
                      </label>
                      <textarea
                        rows={2}
                        value={trade.scope_summary}
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            scope_summary: e.target.value,
                          })
                        }
                        className="w-full p-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[12px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Expanded Details / Subcontractor Information */}
              {isExpanded && !isEditing && (
                <div className="px-5 py-4 bg-slate-50/70 border-t border-slate-100 text-[12px] space-y-2">
                  <div>
                    <span className="font-semibold text-slate-700">Detailed Scope of Work:</span>
                    <p className="text-slate-600 mt-0.5">{trade.scope_summary}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-slate-600">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Xactimate Codes:</span>
                      <span className="font-mono font-medium">{trade.category_codes_included.join(', ')}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Subcontractor Assigned:</span>
                      <span>{trade.subcontractor_name || 'Not yet assigned'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">Subcontractor Bid:</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {trade.subcontractor_bid ? `$${trade.subcontractor_bid.toLocaleString()}` : 'Awaiting Quote'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
