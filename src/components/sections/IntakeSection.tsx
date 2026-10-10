import React from 'react';
import {
  FileText,
  ShieldCheck,
  Hash,
  Building,
  DollarSign,
  TrendingUp,
  Percent,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { EstimateResult } from '../../types/estimate';

interface IntakeSectionProps {
  estimate: EstimateResult | null;
  onNavigateSection: (id: string) => void;
}

export const IntakeSection: React.FC<IntakeSectionProps> = ({
  estimate,
  onNavigateSection,
}) => {
  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          Ready for your estimate
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Add an estimate above, then review the extracted job details before setting your budget.
        </p>
      </div>
    );
  }

  const meta = estimate.project_meta;
  const trades = estimate.trade_sections;
  const rolledUpTotal = trades.reduce((acc, t) => acc + (t.billable_revenue || 0), 0);
  const variance = Math.abs(rolledUpTotal - meta.total_rcv);
  const isReconciled = trades.length > 0 && meta.total_rcv > 0 && variance < 1.0;

  // Extraction quality notice (purely presentational — no state or API calls).
  const extractionWarnings = estimate.processing?.warnings || [];
  const allTradesZeroRated =
    trades.length > 0 && trades.every((t) => !(t.billable_revenue > 0));

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: RCV */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Total Estimate RCV
            </span>
            <DollarSign className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-[24px] font-bold text-slate-900 tabular-nums">
            ${meta.total_rcv.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Replacement Cost Value</span>
          </div>
        </div>

        {/* Card 2: Net Claim */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Net Claim Amount
            </span>
            <TrendingUp className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-[24px] font-bold text-slate-900 tabular-nums">
            {meta.net_claim == null ? 'Not provided' : `$${meta.net_claim.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            As reported in the estimate
          </div>
        </div>

        {/* Card 3: Overhead & Profit */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Overhead &amp; Profit (O&amp;P)
            </span>
            <Percent className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-[24px] font-bold text-slate-900 tabular-nums">
            ${(meta.overhead_and_profit || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {meta.overhead_and_profit ? 'As reported in the estimate' : 'None itemized'}
          </div>
        </div>

        {/* Card 4: Reconciliation */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-none">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Reconciliation
            </span>
            <ShieldCheck className="w-4 h-4 text-slate-400" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isReconciled ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span className="text-[16px] font-bold text-slate-900">
              {isReconciled ? 'Balanced' : `Δ $${variance.toFixed(2)}`}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
            {trades.length} packages = ${rolledUpTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      </div>

      {/* Extraction Warnings & Budget Data Quality */}
      {(extractionWarnings.length > 0 || allTradesZeroRated) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-amber-900">
                Extraction Warnings &amp; Budget Data Quality
              </h3>
              {extractionWarnings.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[12px] text-amber-800">
                  {extractionWarnings.slice(0, 6).map((warning, index) => (
                    <li key={index} className="flex items-start gap-1.5">
                      <span className="text-amber-500 leading-[1.4]">·</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                  {extractionWarnings.length > 6 && (
                    <li className="font-medium text-amber-700">
                      + {extractionWarnings.length - 6} more (see JSON &amp; Schema export)
                    </li>
                  )}
                </ul>
              )}
              {allTradesZeroRated && (
                <p className="mt-1.5 text-[12px] text-amber-800">
                  Per-trade dollar amounts were not found in the source estimate - the buyout
                  budget cannot auto-populate from this file. Try re-processing with the full
                  line-item estimate or paste the estimate text instead.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Insured & Policy Claim Record Details */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-red-50 text-red-600">
              <Building className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Job &amp; claim details
              </h3>
              <p className="text-[12px] text-slate-500">
                Extracted directly from Xactimate estimate header and summary report
              </p>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
            Review required
          </span>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <span className="block text-[12px] font-medium text-slate-500 mb-1">
              Insured / Client Name
            </span>
            <p className="text-[14px] font-semibold text-slate-900">
              {meta.client_name}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Primary policyholder</p>
          </div>

          <div>
            <span className="block text-[12px] font-medium text-slate-500 mb-1">
              Claim Number
            </span>
            <p className="text-[14px] font-semibold font-mono text-slate-900">
              {meta.claim_number}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Assigned by carrier</p>
          </div>

          <div>
            <span className="block text-[12px] font-medium text-slate-500 mb-1">
              Insurance Carrier
            </span>
            <p className="text-[14px] font-semibold text-slate-900">
              {meta.carrier}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Underwriting company</p>
          </div>

          <div>
            <span className="block text-[12px] font-medium text-slate-500 mb-1">
              Policy Number
            </span>
            <p className="text-[14px] font-semibold font-mono text-slate-900">
              {meta.policy_number || 'Not provided'}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Property coverage</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-[12px]">
          <span className="text-slate-500">
            Source:{' '}
            <span className="font-mono text-slate-700">
              {estimate.source_filename || 'Uploaded Xactimate File'}
            </span>
          </span>
          <button
            onClick={() => onNavigateSection('packages')}
            className="text-[12px] font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1"
          >
            <span>Review Trade Packages</span>
            <span>&rarr;</span>
          </button>
        </div>
      </div>

      {/* Package Quick Summary Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
            Trade packages ({trades.length})
          </h3>
          <span className="text-[11px] text-slate-500">
            Grouped by Xactimate Category Codes
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4">Task ID</th>
                <th className="py-2.5 px-4">Trade Work Package</th>
                <th className="py-2.5 px-4">Xactimate Codes</th>
                <th className="py-2.5 px-4 text-right">Billable RCV</th>
                <th className="py-2.5 px-4 text-center">Duration</th>
                <th className="py-2.5 px-4">Predecessors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trades.map((t) => (
                <tr key={t.task_id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-red-700 text-[12px]">
                    {t.task_id}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {t.trade_name}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {t.category_codes_included.map((code) => (
                        <span
                          key={code}
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-slate-900">
                    ${t.billable_revenue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-3 px-4 text-center tabular-nums text-slate-700">
                    {t.suggested_duration_days} d
                  </td>
                  <td className="py-3 px-4 font-mono text-[12px] text-slate-600">
                    {t.predecessors ? (
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                        FS: {t.predecessors}
                      </span>
                    ) : (
                      <span className="text-slate-400">Initial Milestone</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
