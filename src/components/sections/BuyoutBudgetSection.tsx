import React, { Fragment, useMemo, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  Percent,
  Calculator,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Sparkles,
  Lock,
  Unlock,
  ClipboardList,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileSignature,
} from 'lucide-react';
import { EstimateResult, TradeSection, WorkOrderContract } from '../../types/estimate';
import { applyBudgetEngine } from '../../utils/budgetEngine';
import { assignCrews, computeWorkOrderContract, formatMoney } from '../../utils/workOrders';
import { ConfirmModal } from '../ConfirmModal';

interface BuyoutBudgetSectionProps {
  estimate: EstimateResult | null;
  onUpdateTrade: (taskId: string, updated: Partial<TradeSection>) => void;
  onNavigateSection: (id: string) => void;
  /** Bulk-applies the target buyout % to every trade's Sub Bid; marks the budget adjusted (unlocks final work orders). */
  onApplyBuyoutToAll: (pct: number) => void;
  /** Generates the final contract-bearing work order packet. App stores the packet and navigates to it after success. */
  onGenerateFinalWorkOrders: () => Promise<void>;
}

export const BuyoutBudgetSection: React.FC<BuyoutBudgetSectionProps> = ({
  estimate,
  onUpdateTrade,
  onNavigateSection,
  onApplyBuyoutToAll,
  onGenerateFinalWorkOrders,
}) => {
  const [globalBuyoutPct, setGlobalBuyoutPct] = useState<number>(60);
  const [generatingOrders, setGeneratingOrders] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Deterministic budget engine output (AI-extracted when available, derived
  // defaults otherwise) so the master budget is always auditable.
  const engineEstimate = useMemo(
    () => (estimate ? applyBudgetEngine(estimate) : null),
    [estimate]
  );

  // Live per-crew contract preview for the expandable ledger rows: one crew
  // agreement links several budget lines (e.g. Demolition + Final Cleaning are
  // both Crew 1), exactly like the CONTRACT AMOUNT & BUDGET LINE LINKAGE block
  // on the generated work order. Uses the same assignCrews /
  // computeWorkOrderContract functions as the generation path, applied to the
  // engine-applied estimate, so buyout edits here update the preview live.
  const contractByTask = useMemo(() => {
    const map = new Map<string, { crewName: string; contract: WorkOrderContract }>();
    if (!engineEstimate) return map;
    for (const { crew, trades: crewTrades } of assignCrews(engineEstimate.trade_sections || [])) {
      const contract = computeWorkOrderContract(crewTrades);
      for (const crewTrade of crewTrades) {
        if (!map.has(crewTrade.task_id)) {
          map.set(crewTrade.task_id, { crewName: crew.name, contract });
        }
      }
    }
    return map;
  }, [engineEstimate]);

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <DollarSign className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No Estimate Available for Buyout
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Load or process an Xactimate estimate to generate subcontractor buyout allowances and track quotes.
        </p>
      </div>
    );
  }

  const trades = estimate.trade_sections;
  const totalRcv = trades.reduce((acc, t) => acc + (t.billable_revenue || 0), 0);
  const totalTargetBuyout = Math.round(totalRcv * (globalBuyoutPct / 100));

  const totalCommittedBids = trades.reduce((acc, t) => {
    const defaultBid = Math.round((t.billable_revenue || 0) * (globalBuyoutPct / 100));
    return acc + (t.subcontractor_bid ?? defaultBid);
  }, 0);

  const projectedGrossProfit = totalRcv - totalCommittedBids;
  const projectedGrossMarginPct = totalRcv > 0 ? (projectedGrossProfit / totalRcv) * 100 : 0;
  const buyoutSavings = totalTargetBuyout - totalCommittedBids;

  // Budget-gated final work orders: App stamps `budget_adjusted_at` on any buyout
  // edit made from this page; generation stays locked until then.
  const budgetAdjusted = Boolean(estimate.budget_adjusted_at);
  const agreementValue = trades.reduce(
    (sum, t) => sum + (t.subcontractor_bid ?? t.direct_labor ?? 0),
    0
  );
  const hasExistingOrders = Boolean(estimate.work_orders?.length);
  const budgetRevisedAfterGeneration = Boolean(
    budgetAdjusted &&
      estimate.budget_adjusted_at &&
      estimate.work_orders_generated_at &&
      Date.parse(estimate.budget_adjusted_at) > Date.parse(estimate.work_orders_generated_at)
  );

  const runGenerate = async () => {
    setGeneratingOrders(true);
    try {
      await onGenerateFinalWorkOrders();
    } finally {
      setGeneratingOrders(false);
      setConfirmRegen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Workflow banner: extract → adjust buyout budget → generate final work orders */}
      <div
        className={`rounded-xl border p-4 shadow-none ${
          estimate.budget_adjusted_at
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}
      >
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`shrink-0 p-2 rounded-lg ${
                estimate.budget_adjusted_at
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {estimate.budget_adjusted_at ? (
                <Unlock className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
            </span>
            <p className="text-[12px] leading-relaxed">
              {estimate.budget_adjusted_at ? (
                <>
                  Buyout budget adjusted{' '}
                  {new Date(estimate.budget_adjusted_at).toLocaleString()} — final work orders are
                  unlocked. Generate them in the Final Work Orders panel below.
                </>
              ) : (
                <>
                  Final work orders are locked until the buyout budget is adjusted. The Sub Bid and
                  Margin Adjust values below set the final dollar amount on every subcontractor
                  agreement — edit any line, or use 'Apply target % to all trades'.
                </>
              )}
            </p>
          </div>

          {/* Workflow step chips */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-white/80 text-[11px] font-semibold text-slate-600 whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              1 · Extract estimate
              <span className="font-normal text-slate-400">✓ done</span>
            </span>
            <span
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap ${
                budgetAdjusted
                  ? 'border-emerald-300 bg-white text-emerald-700'
                  : 'border-red-600 bg-red-600 text-white'
              }`}
            >
              {budgetAdjusted ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
              2 · Adjust buyout budget
            </span>
            <span
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap ${
                budgetAdjusted
                  ? 'border-emerald-300 bg-white text-emerald-700'
                  : 'border-slate-200 bg-white/80 text-slate-500'
              }`}
            >
              {budgetAdjusted ? (
                <Unlock className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              3 · Generate final work orders
            </span>
          </div>
        </div>
      </div>

      {/* Top Controller: Target Buyout Strategy */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-red-50 text-red-600">
                <Calculator className="w-4 h-4" />
              </span>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Subcontractor Buyout Strategy &amp; Gross Margin Modeling
              </h3>
            </div>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Set target subcontractor buyout allowance percentage against approved insurance RCV to secure project margins.
            </p>
          </div>

          {/* Quick preset pills */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-500 font-medium">Target Buyout:</span>
            {[50, 55, 60, 65].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setGlobalBuyoutPct(pct)}
                className={`h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors ${
                  globalBuyoutPct === pct
                    ? 'bg-red-600 text-white shadow-2xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {pct}% Sub ({100 - pct}% GM)
              </button>
            ))}
          </div>
        </div>

        {/* Slider bar */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-4">
          <input
            type="range"
            min="40"
            max="80"
            step="1"
            value={globalBuyoutPct}
            onChange={(e) => setGlobalBuyoutPct(Number(e.target.value))}
            className="flex-1 accent-red-600 cursor-pointer"
          />
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[13px] font-semibold tabular-nums text-slate-900">
            <span>{globalBuyoutPct}%</span>
            <span className="text-[11px] font-normal text-slate-500">
              (Target Sub Cost)
            </span>
          </div>
          <button
            type="button"
            onClick={() => onApplyBuyoutToAll(globalBuyoutPct)}
            className="shrink-0 h-8 px-3 rounded-lg bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 transition-colors whitespace-nowrap"
          >
            Apply {globalBuyoutPct}% to all trades
          </button>
        </div>
      </div>

      {/* KPI Metric Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 block mb-1">
            Total Approved RCV
          </span>
          <div className="text-[22px] font-bold text-slate-900 tabular-nums">
            ${totalRcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Reconciled claim revenue</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 block mb-1">
            Target Sub Budget ({globalBuyoutPct}%)
          </span>
          <div className="text-[22px] font-bold text-slate-900 tabular-nums">
            ${totalTargetBuyout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Max allowable buyout cap</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 block mb-1">
            Committed Sub Bids
          </span>
          <div className="text-[22px] font-bold text-slate-900 tabular-nums">
            ${totalCommittedBids.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {buyoutSavings >= 0 ? (
              <span className="text-emerald-700 font-medium">
                +${buyoutSavings.toLocaleString()} Buyout Savings
              </span>
            ) : (
              <span className="text-rose-700 font-medium">
                -${Math.abs(buyoutSavings).toLocaleString()} Over Target
              </span>
            )}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 block mb-1">
            Projected GC Gross Margin
          </span>
          <div className="text-[22px] font-bold text-emerald-700 tabular-nums">
            {projectedGrossMarginPct.toFixed(1)}%
          </div>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            ${projectedGrossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gross profit
          </p>
        </div>
      </div>

      {/* Trade Buyout Breakdown Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Subcontractor Bid Comparison &amp; Buyout Ledger
            </h3>
            <p className="text-[12px] text-slate-500">
              Enter real subcontractor proposals to verify trade margins against approved Xactimate revenue.
            </p>
          </div>
          <button
            onClick={() => onNavigateSection('workspace')}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-medium text-slate-700 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
            <span>Export to Google Sheets</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-3">Task</th>
                <th className="py-2.5 px-3">Trade Package</th>
                <th className="py-2.5 px-3 text-right">Approved RCV</th>
                <th className="py-2.5 px-3 text-right">Target Buyout</th>
                <th className="py-2.5 px-3 min-w-[160px]">Assigned Subcontractor</th>
                <th className="py-2.5 px-3 min-w-[120px] text-right">Sub Bid ($)</th>
                <th className="py-2.5 px-3 min-w-[190px]">Margin Adjust</th>
                <th className="py-2.5 px-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trades.map((trade) => {
                const targetBuyout = Math.round(
                  (trade.billable_revenue || 0) * (globalBuyoutPct / 100)
                );
                const actualBid =
                  trade.subcontractor_bid !== undefined
                    ? trade.subcontractor_bid
                    : targetBuyout;
                const variance = targetBuyout - actualBid;
                const marginAmount = (trade.billable_revenue || 0) - actualBid;
                const marginPct =
                  trade.billable_revenue > 0
                    ? (marginAmount / trade.billable_revenue) * 100
                    : 0;
                const isExpanded = expandedTaskId === trade.task_id;
                const linkage = contractByTask.get(trade.task_id);
                const engineTrade = engineEstimate?.trade_sections.find(
                  (t) => t.task_id === trade.task_id
                );
                const toggleExpanded = () =>
                  setExpandedTaskId(isExpanded ? null : trade.task_id);

                return (
                  <Fragment key={trade.task_id}>
                  <tr
                    className={`transition-colors cursor-pointer ${
                      isExpanded ? 'bg-slate-50/80' : 'hover:bg-slate-50/70'
                    }`}
                    title="Click to expand contract amount & budget line linkage"
                    onClick={(e) => {
                      if (
                        (e.target as HTMLElement).closest(
                          'input, button, a, select, textarea'
                        )
                      ) {
                        return;
                      }
                      toggleExpanded();
                    }}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-red-700 text-[12px] whitespace-nowrap">
                      <button
                        type="button"
                        onClick={toggleExpanded}
                        aria-label={
                          isExpanded
                            ? `Collapse ${trade.task_id} contract details`
                            : `Expand ${trade.task_id} contract details`
                        }
                        className="mr-1 -ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-red-700 hover:bg-slate-100 align-middle transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {trade.task_id}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">
                      <div>{trade.trade_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {trade.category_codes_included.join(', ')}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-medium tabular-nums text-slate-800">
                      ${trade.billable_revenue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 font-medium">
                      ${targetBuyout.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={trade.subcontractor_name || ''}
                        placeholder="Subcontractor company..."
                        onChange={(e) =>
                          onUpdateTrade(trade.task_id, {
                            subcontractor_name: e.target.value,
                          })
                        }
                        className="w-full h-8 px-2 rounded-md border border-slate-300 bg-white text-slate-900 text-[12px]"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="relative">
                        <span className="absolute left-2 top-2 text-[12px] text-slate-400">
                          $
                        </span>
                        <input
                          type="number"
                          value={trade.subcontractor_bid ?? targetBuyout}
                          onChange={(e) =>
                            onUpdateTrade(trade.task_id, {
                              subcontractor_bid: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full h-8 pl-5 pr-2 rounded-md border border-slate-300 bg-white text-slate-900 text-[12px] font-semibold tabular-nums text-right"
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="70"
                          step="0.5"
                          value={Math.round(Math.min(70, Math.max(0, marginPct)) * 10) / 10}
                          onChange={(e) => {
                            const newMargin = Number(e.target.value);
                            const newBid =
                              Math.round(
                                (trade.billable_revenue || 0) *
                                  (1 - newMargin / 100) *
                                  100
                              ) / 100;
                            onUpdateTrade(trade.task_id, {
                              subcontractor_bid: newBid,
                            });
                          }}
                          className="flex-1 accent-red-600 cursor-pointer"
                        />
                        <span
                          className={`shrink-0 w-[52px] text-right tabular-nums font-bold text-[12px] ${
                            marginPct >= 40
                              ? 'text-emerald-700'
                              : marginPct >= 30
                              ? 'text-slate-800'
                              : 'text-amber-700'
                          }`}
                        >
                          {marginPct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-[12px]">
                      {variance >= 0 ? (
                        <span className="text-emerald-700">
                          +${variance.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-rose-700">
                          -${Math.abs(variance).toLocaleString()}
                        </span>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={8} className="px-3 pt-1 pb-4">
                        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-none">
                          <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <FileSignature className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                CONTRACT AMOUNT &amp; BUDGET LINE LINKAGE
                              </span>
                            </div>
                            {linkage && (
                              <span className="text-[11px] text-slate-500">
                                {linkage.crewName} · {linkage.contract.budget_lines.length}{' '}
                                budget line(s)
                              </span>
                            )}
                          </div>

                          {linkage ? (
                            <>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-[12px]">
                                  <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                      <th className="py-2 px-4 w-[110px]">TASK</th>
                                      <th className="py-2 px-3">TRADE PACKAGE</th>
                                      <th className="py-2 px-4 text-right">AMOUNT</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {linkage.contract.budget_lines.map((line) => (
                                      <tr
                                        key={line.task_id}
                                        className={
                                          line.task_id === trade.task_id
                                            ? 'bg-red-50/50'
                                            : ''
                                        }
                                      >
                                        <td className="py-2 px-4 font-mono font-bold text-red-700 text-[11px] whitespace-nowrap align-top">
                                          {line.task_id}
                                          {line.task_id === trade.task_id && (
                                            <span className="ml-1.5 font-sans text-[9px] font-bold uppercase tracking-wide text-red-600">
                                              this line
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 align-top">
                                          <div className="font-medium text-slate-800">
                                            {line.trade_name}
                                          </div>
                                          {line.trade_division &&
                                            line.trade_division !== line.trade_name && (
                                              <div className="text-[10px] text-slate-400">
                                                {line.trade_division}
                                              </div>
                                            )}
                                          {line.basis === 'sub_bid' ? (
                                            <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                              Sub bid
                                            </span>
                                          ) : line.basis === 'budgeted_buyout' ? (
                                            <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                              Budgeted buyout
                                            </span>
                                          ) : (
                                            <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                                              Not set
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2 px-4 text-right font-semibold tabular-nums text-slate-900 align-top">
                                          {formatMoney(line.amount)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t border-slate-200 bg-slate-50">
                                      <td
                                        colSpan={2}
                                        className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                                      >
                                        TOTAL CONTRACT AMOUNT
                                      </td>
                                      <td className="py-2 px-4 text-right text-[13px] font-bold tabular-nums text-red-700">
                                        {formatMoney(linkage.contract.contract_amount)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>

                              <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5">
                                <LineDetail
                                  label="Assigned Subcontractor"
                                  value={trade.subcontractor_name || 'Unassigned'}
                                />
                                <LineDetail
                                  label="Execution Type"
                                  value={
                                    engineTrade?.execution_type ||
                                    trade.execution_type ||
                                    '—'
                                  }
                                />
                                <LineDetail
                                  label="Approved RCV"
                                  value={formatMoney(trade.billable_revenue || 0)}
                                />
                                <LineDetail
                                  label={`Target Buyout (${globalBuyoutPct}%)`}
                                  value={formatMoney(targetBuyout)}
                                />
                                <LineDetail
                                  label="Projected Margin"
                                  value={`${formatMoney(marginAmount)} (${marginPct.toFixed(1)}%)`}
                                />
                                <LineDetail
                                  label="Variance vs Target"
                                  value={
                                    variance >= 0
                                      ? `+${formatMoney(variance)}`
                                      : `-${formatMoney(Math.abs(variance))}`
                                  }
                                />
                                <LineDetail
                                  label="Schedule"
                                  value={`${Math.max(1, trade.suggested_duration_days || 1)} day(s) · FS ${
                                    trade.predecessors || '—'
                                  }`}
                                />
                                <LineDetail
                                  label="Category Codes"
                                  value={trade.category_codes_included.join(', ') || '—'}
                                />
                              </div>

                              {trade.scope_summary && (
                                <div className="px-4 py-3 border-t border-slate-100">
                                  <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">
                                    Scope Summary
                                  </span>
                                  <p className="text-[11px] text-slate-600 leading-relaxed">
                                    {trade.scope_summary}
                                  </p>
                                </div>
                              )}

                              <p className="px-4 pb-3 text-[10px] text-slate-400">
                                Live preview from the current buyout budget — each line uses the
                                entered Sub Bid, otherwise the engine's budgeted buyout (direct
                                labor). This is the contract amount stamped on the crew's work
                                order when generated.
                              </p>
                            </>
                          ) : (
                            <p className="px-4 py-3 text-[12px] text-slate-500">
                              No linked contract found for this line yet.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-bold text-[13px] text-slate-900">
                <td className="py-3 px-3" colSpan={2}>
                  TOTALS / AUDIT SUMMARY
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  ${totalRcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  ${totalTargetBuyout.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-slate-500 font-normal text-[11px]">
                  {trades.length} packages reconciled
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  ${totalCommittedBids.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-emerald-700 font-extrabold">
                  {projectedGrossMarginPct.toFixed(1)}%
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  {buyoutSavings >= 0 ? (
                    <span className="text-emerald-700">+${buyoutSavings.toLocaleString()}</span>
                  ) : (
                    <span className="text-rose-700">-${Math.abs(buyoutSavings).toLocaleString()}</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Final Work Orders — contract-bearing subcontractor agreements */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <span className="p-2 rounded-lg bg-red-50 text-red-600">
            <ClipboardList className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Final Work Orders — Subcontractor Agreements
            </h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Each crew's contract amount is computed from the adjusted buyout budget lines above
              (carrier margins excluded).
            </p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 py-4 bg-slate-50/60 border-b border-slate-100">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Agreement value at current budget
            </span>
            <span className="text-[16px] font-bold text-slate-900 tabular-nums">
              {formatMoney(agreementValue)}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Existing work orders
            </span>
            <span className="text-[16px] font-bold text-slate-900 tabular-nums">
              {estimate.work_orders?.length || 0}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {budgetAdjusted ? (
            <>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">
                <Unlock className="w-3.5 h-3.5" />
                Budget adjusted ✓ — you can generate the final packet.
              </div>

              {budgetRevisedAfterGeneration && hasExistingOrders ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  Budget revised after the last generation — regenerate to refresh contract
                  amounts.
                </div>
              ) : null}

              <div>
                <button
                  type="button"
                  onClick={hasExistingOrders ? () => setConfirmRegen(true) : runGenerate}
                  disabled={generatingOrders}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {generatingOrders ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating…</span>
                    </>
                  ) : hasExistingOrders ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Regenerate Final Work Orders</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Generate Final Work Orders</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="text-[12px] text-amber-800 leading-relaxed">
                  Work orders are locked. Adjust the budget above first — edit a Sub Bid, move a
                  Margin Adjust slider, or apply the target % to all trades.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onApplyBuyoutToAll(globalBuyoutPct)}
                  className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-medium text-slate-700 transition-colors"
                >
                  Apply {globalBuyoutPct}% &amp; unlock
                </button>
                <button
                  type="button"
                  disabled
                  title="Adjust the buyout budget above first — edit a Sub Bid, move a Margin Adjust slider, or apply the target % to all trades."
                  className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-red-600 text-white text-[12px] font-semibold opacity-60 cursor-not-allowed"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Generate Final Work Orders
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {hasExistingOrders ? (
        <ConfirmModal
          isOpen={confirmRegen}
          title="Regenerate final work orders?"
          message={`This replaces ${estimate.work_orders!.length} existing crew packet(s) with contracts computed from the current adjusted budget.`}
          confirmLabel="Regenerate"
          onConfirm={runGenerate}
          onCancel={() => setConfirmRegen(false)}
        />
      ) : null}

      <BudgetEngineCard engineEstimate={engineEstimate} />
    </div>
  );
};

/* ------------------------------------------------------------------------- */
/* AI Budget Engine panel — master budget + material allowance (Output 1/2)   */
/* ------------------------------------------------------------------------- */

const currency = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One label/value cell inside a buyout ledger row's expanded detail grid. */
const LineDetail: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-bold">
      {label}
    </span>
    <span className="text-[11px] text-slate-800 font-semibold tabular-nums">{value}</span>
  </div>
);

interface BudgetEngineCardProps {
  engineEstimate: EstimateResult | null;
}

const BudgetEngineCard: React.FC<BudgetEngineCardProps> = ({ engineEstimate }) => {
  const [showMaterials, setShowMaterials] = useState(false);

  if (!engineEstimate?.budget_audit) return null;
  const audit = engineEstimate.budget_audit;
  const trades = engineEstimate.trade_sections;
  const allowances = engineEstimate.material_allowances || [];
  const sumDirect = trades.reduce((acc, t) => acc + (t.total_direct_cost || 0), 0);
  const sumProfit = trades.reduce((acc, t) => acc + (t.gross_profit || 0), 0);
  const overallMargin = audit.carrier_total_rcv > 0 ? (sumProfit / audit.carrier_total_rcv) * 100 : 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2 rounded-lg bg-red-50 text-red-600">
            <Sparkles className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              AI Budget Engine — Master Budget &amp; Material Allowance
            </h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Deterministic post-processing: O&amp;P/tax apportionment, buyout benchmarks and
              material tax are recomputed in code — never trusted from the model.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold px-2 py-1 rounded border ${
              audit.basis === 'model_extraction'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {audit.basis === 'model_extraction' ? 'LINE-ITEM EXTRACTION' : 'DERIVED DEFAULTS'}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border ${
              audit.rcv_reconciled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {audit.rcv_reconciled ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
            RCV Δ {currency(audit.delta_rcv)}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border ${
              audit.material_reconciled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {audit.material_reconciled ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
            Material Δ {currency(audit.material_variance)}
          </span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4 bg-slate-50/60 border-b border-slate-100">
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            Carrier RCV
          </span>
          <span className="text-[16px] font-bold text-slate-900 tabular-nums">
            {currency(audit.carrier_total_rcv)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            Total Direct Cost
          </span>
          <span className="text-[16px] font-bold text-slate-900 tabular-nums">
            {currency(sumDirect)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            Gross Profit
          </span>
          <span className="text-[16px] font-bold text-emerald-700 tabular-nums">
            {currency(sumProfit)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            Overall Gross Margin
          </span>
          <span className="text-[16px] font-bold text-emerald-700 tabular-nums">
            {overallMargin.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Per-trade master budget */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-slate-200 bg-white text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="py-2.5 px-3">Task</th>
              <th className="py-2.5 px-3">Division / Execution Type</th>
              <th className="py-2.5 px-3 text-right">Direct Material</th>
              <th className="py-2.5 px-3 text-right">Direct Labor / Sub</th>
              <th className="py-2.5 px-3 text-right">Total Direct</th>
              <th className="py-2.5 px-3 text-right">Billed RCV</th>
              <th className="py-2.5 px-3 text-right">GM %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {trades.map((t) => (
              <tr key={t.task_id} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-2.5 px-3 font-mono font-bold text-red-700">{t.task_id}</td>
                <td className="py-2.5 px-3">
                  <div className="font-medium text-slate-900">{t.trade_division || t.trade_name}</div>
                  <div className="text-[10px] text-slate-400">{t.execution_type || '—'}</div>
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                  {currency(t.direct_material || 0)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                  {currency(t.direct_labor || 0)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-800 font-medium">
                  {currency(t.total_direct_cost || 0)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-900 font-semibold">
                  {currency(t.billable_revenue || 0)}
                </td>
                <td
                  className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                    (t.gross_margin_pct || 0) >= 30 ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {(t.gross_margin_pct || 0).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-bold text-[12px] text-slate-900">
              <td className="py-3 px-3" colSpan={2}>
                TOTALS — {trades.length} division(s)
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                {currency(trades.reduce((a, t) => a + (t.direct_material || 0), 0))}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">
                {currency(trades.reduce((a, t) => a + (t.direct_labor || 0), 0))}
              </td>
              <td className="py-3 px-3 text-right tabular-nums">{currency(sumDirect)}</td>
              <td className="py-3 px-3 text-right tabular-nums">{currency(audit.sum_trade_rcv)}</td>
              <td className="py-3 px-3 text-right tabular-nums text-emerald-700">
                {overallMargin.toFixed(1)}%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Material allowance (Output 2) */}
      <div className="border-t border-slate-100">
        <button
          onClick={() => setShowMaterials((v) => !v)}
          className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
        >
          <span className="text-[12px] font-semibold text-slate-800">
            Material Allowance — Itemized Procurement ({allowances.length} item
            {allowances.length === 1 ? '' : 's'})
          </span>
          <span className="text-[11px] text-slate-400">
            {showMaterials ? 'Hide' : 'Show'} • Tax {currency(audit.allowance_tax)} • Total{' '}
            {currency(audit.allowance_total)}
          </span>
        </button>
        {showMaterials && (
          <div className="overflow-x-auto border-t border-slate-100">
            {allowances.length === 0 ? (
              <p className="px-5 py-4 text-[12px] text-slate-500">
                No itemized materials yet — process a live estimate PDF with the AI engine to
                populate the procurement list.
              </p>
            ) : (
              <table className="w-full text-left border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-3">Trade</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3">UOM</th>
                    <th className="py-2 px-3 text-right">Unit Cost</th>
                    <th className="py-2 px-3 text-right">Extended</th>
                    <th className="py-2 px-3">Preferred Vendor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allowances.map((item, idx) => (
                    <tr key={`${item.description}-${idx}`} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 text-slate-800">{item.description}</td>
                      <td className="py-2 px-3 text-slate-500">{item.trade}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{item.qty}</td>
                      <td className="py-2 px-3 text-slate-500">{item.uom}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {currency(item.unit_cost)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">
                        {currency(item.extended_cost)}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{item.vendor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 text-[12px] font-semibold text-slate-900">
                    <td className="py-2.5 px-3" colSpan={5}>
                      Subtotal + 7.00% material tax
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {currency(audit.allowance_total)}
                    </td>
                    <td className="py-2.5 px-3" />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Assumptions */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
          Engine assumptions
        </span>
        <ul className="mt-1 space-y-0.5">
          {audit.assumptions.map((line, i) => (
            <li key={i} className="text-[11px] text-slate-500">
              • {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
