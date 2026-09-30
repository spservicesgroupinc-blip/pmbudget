import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FileDown,
  FileSignature,
  HardDrive,
  HardHat,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import type {
  EstimateResult,
  WorkOrder,
  WorkOrderSiteLogistics,
} from '../../types/estimate';
import {
  attachWorkOrderContracts,
  buildSiteLogistics,
  crewWorkOrderPdfFilename,
  formatMoney,
  redactFinancials,
  redactWorkOrders,
} from '../../utils/workOrders';
import { generateFinalWorkOrders } from '../../services/workOrderGeneration';
import { buildAllCrewWorkOrderPdfs, buildCrewWorkOrderPdf } from '../../utils/workOrderPdf';
import { saveCustomerProfile, uploadCustomerPdf } from '../../services/gappsApi';
import { mapWithConcurrency } from '../../utils/concurrency';

interface WorkOrdersSectionProps {
  estimate: EstimateResult | null;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
  onNavigateSection: (id: string) => void;
  onApplyWorkOrders: (
    workOrders: WorkOrder[],
    siteLogistics?: WorkOrderSiteLogistics,
    generatedAt?: string
  ) => void;
}

/** Triggers a client-side download of generated PDF bytes. */
const downloadBytes = (bytes: Uint8Array, filename: string) => {
  // Copy into a fresh ArrayBuffer-backed view for TS 7 BlobPart compat.
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const WorkOrdersSection: React.FC<WorkOrdersSectionProps> = ({
  estimate,
  onShowToast,
  onNavigateSection,
  onApplyWorkOrders,
}) => {
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingCrewId, setExportingCrewId] = useState<string | null>(null);
  const [savingDrive, setSavingDrive] = useState(false);
  const [expandedCrewId, setExpandedCrewId] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Render-time redaction guard: free text never reaches the field UI unless
  // it has passed the carrier-pricing choke point, even if state was
  // written by another code path. Contract amounts (numeric, carrier-safe) are
  // attached afterwards so every crew links to its approved budget lines.
  const crews = useMemo<WorkOrder[]>(
    () =>
      estimate
        ? attachWorkOrderContracts(redactWorkOrders(estimate.work_orders || [], estimate), estimate)
        : [],
    [estimate]
  );
  const site = useMemo<WorkOrderSiteLogistics>(() => {
    const raw = estimate ? estimate.work_order_site || buildSiteLogistics(estimate) : null;
    if (!raw) {
      return {
        working_hours: '',
        parking_staging: '',
        waste_disposal: '',
        emergency_protocol: '',
      };
    }
    return {
      working_hours: redactFinancials(raw.working_hours),
      parking_staging: redactFinancials(raw.parking_staging),
      waste_disposal: redactFinancials(raw.waste_disposal),
      emergency_protocol: redactFinancials(raw.emergency_protocol),
      superintendent: raw.superintendent ? redactFinancials(raw.superintendent) : undefined,
    };
  }, [estimate]);

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <ClipboardList className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No Estimate Available for Field Work Orders
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Load or process an Xactimate estimate to generate crew-ready field work orders and the
          detailed PDF packet.
        </p>
      </div>
    );
  }

  const budgetAdjusted = Boolean(estimate.budget_adjusted_at);
  const budgetRevisedAfterGeneration = Boolean(
    budgetAdjusted &&
      estimate.budget_adjusted_at &&
      estimate.work_orders_generated_at &&
      Date.parse(estimate.budget_adjusted_at) > Date.parse(estimate.work_orders_generated_at)
  );

  const tradeIds = Array.from(new Set(crews.flatMap((c) => c.trade_task_ids)));
  const aiCrews = crews.filter((c) => c.source === 'ai').length;
  const contractValue = crews.reduce((sum, c) => sum + (c.contract?.contract_amount || 0), 0);
  const hasContracts = crews.some((c) => Boolean(c.contract));

  const generate = async () => {
    setGenerating(true);
    try {
      const result = await generateFinalWorkOrders(estimate);
      if (result.workOrders.length === 0) {
        throw new Error('No crews were generated for this estimate.');
      }
      onApplyWorkOrders(result.workOrders, result.siteLogistics, result.generatedAt);
      if (result.usedFallback) {
        onShowToast(
          'warning',
          `AI service unavailable${
            result.errorMessage ? ` (${result.errorMessage})` : ''
          }. Generated the packet from field templates — contracts follow the adjusted budget.`
        );
      } else {
        onShowToast('success', `Generated ${result.workOrders.length} crew work orders via ${result.sourceLabel}.`);
      }
    } catch (err: any) {
      onShowToast('error', err?.message || 'Work order generation failed');
    } finally {
      setGenerating(false);
      setConfirmRegen(false);
    }
  };

  const handleGenerateClick = () => {
    if (crews.length > 0) setConfirmRegen(true);
    else void generate();
  };

  // One standalone PDF per subcontractor — each document contains only that
  // crew's scope so it can be sent directly.
  const downloadCrewPdf = async (crew: WorkOrder) => {
    setExportingCrewId(crew.crew_id);
    try {
      const bytes = await buildCrewWorkOrderPdf(estimate, crew);
      downloadBytes(bytes, crewWorkOrderPdfFilename(estimate, crew));
      let workspaceSaved = false;
      try {
        const profile = await saveCustomerProfile(estimate);
        await uploadCustomerPdf(profile.customer_id, crewWorkOrderPdfFilename(estimate, crew), bytes);
        workspaceSaved = true;
      } catch (uploadErr: any) {
        console.error('Workspace auto-save failed', uploadErr);
      }
      onShowToast(
        workspaceSaved ? 'success' : 'warning',
        workspaceSaved
          ? `Downloaded ${crew.crew_name} work order · saved to workspace record`
          : `Downloaded ${crew.crew_name} work order — workspace auto-save failed`
      );
    } catch (err: any) {
      onShowToast('error', err?.message || 'Work order PDF generation failed');
    } finally {
      setExportingCrewId(null);
    }
  };

  const downloadAllCrewPdfs = async () => {
    if (crews.length === 0) return;
    setExporting(true);
    try {
      const artifacts = await buildAllCrewWorkOrderPdfs(estimate);
      for (const artifact of artifacts) {
        downloadBytes(artifact.bytes, artifact.filename);
        await delay(350);
      }
      let workspaceSaved = false;
      try {
        const profile = await saveCustomerProfile(estimate);
        await mapWithConcurrency(artifacts, 3, (artifact) =>
          uploadCustomerPdf(profile.customer_id, artifact.filename, artifact.bytes)
        );
        workspaceSaved = true;
      } catch (uploadErr: any) {
        console.error('Workspace auto-save failed', uploadErr);
      }
      onShowToast(
        workspaceSaved ? 'success' : 'warning',
        workspaceSaved
          ? `Downloaded ${artifacts.length} separate crew PDFs · saved to workspace record`
          : `Downloaded ${artifacts.length} separate crew PDFs — workspace auto-save failed`
      );
    } catch (err: any) {
      onShowToast('error', err?.message || 'Work order PDF generation failed');
    } finally {
      setExporting(false);
    }
  };

  const saveToDrive = async () => {
    if (crews.length === 0) return;
    setSavingDrive(true);
    try {
      const artifacts = await buildAllCrewWorkOrderPdfs(estimate);
      // Auto-save: the estimate becomes (or updates) the customer profile so
      // every generated PDF is stored under the customer's workspace record.
      const profile = await saveCustomerProfile(estimate);
      // Independent Drive uploads — up to 3 in flight; the first failed upload
      // still aborts the batch and surfaces through the same error toast.
      const uploads = await mapWithConcurrency(artifacts, 3, (artifact) =>
        uploadCustomerPdf(profile.customer_id, artifact.filename, artifact.bytes)
      );
      onShowToast(
        'success',
        `Saved ${uploads.length} crew PDF(s) to the ${profile.client_name} customer folder`
      );
    } catch (err: any) {
      onShowToast('error', err?.message || 'Google Drive upload failed');
    } finally {
      setSavingDrive(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-red-50 text-red-600 shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                  Subcontractor Field Work Orders
                </h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  <FileSignature className="w-3 h-3" />
                  CONTRACT AMOUNTS INCLUDED
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  7 + exterior crew taxonomy
                </span>
              </div>
              <p className="text-[12px] text-slate-500 mt-0.5 max-w-2xl">
                Contract amounts included — carrier margins and O&P excluded.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {budgetAdjusted ? (
              <button
                onClick={handleGenerateClick}
                disabled={generating}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : crews.length > 0 ? (
                  <RefreshCw className="w-3.5 h-3.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>
                  {generating ? 'Generating…' : crews.length > 0 ? 'Regenerate' : 'Generate Work Orders'}
                </span>
              </button>
            ) : (
              <button
                onClick={() => onNavigateSection('buyout')}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 shadow-sm transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Adjust Budget to Unlock</span>
              </button>
            )}

            <button
              onClick={() => void downloadAllCrewPdfs()}
              disabled={crews.length === 0 || exporting}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>
                {exporting ? 'Building PDFs…' : `Download All Crew PDFs (${crews.length})`}
              </span>
            </button>

            <button
              onClick={saveToDrive}
              disabled={crews.length === 0 || savingDrive}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors disabled:opacity-50"
            >
              {savingDrive ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDrive className="w-3.5 h-3.5" />
              )}
              <span>Save PDFs to Drive</span>
            </button>
          </div>
        </div>

        {/* Status strip */}
        {crews.length > 0 && (
          <div
            className={`mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 ${
              hasContracts ? 'md:grid-cols-5' : 'md:grid-cols-4'
            } gap-3`}
          >
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Crew sections
              </span>
              <span className="text-[16px] font-bold text-slate-900 tabular-nums">
                {crews.length}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Trades covered
              </span>
              <span className="text-[16px] font-bold text-slate-900 tabular-nums">
                {tradeIds.length}
              </span>
            </div>
            {hasContracts && (
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  Contract value
                </span>
                <span className="text-[16px] font-bold text-emerald-700 tabular-nums">
                  {formatMoney(contractValue)}
                </span>
              </div>
            )}
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Generation source
              </span>
              <span className="text-[13px] font-semibold text-slate-800">
                {aiCrews === crews.length
                  ? 'AI field packet'
                  : aiCrews === 0
                    ? 'Field templates'
                    : `AI (${aiCrews}) + templates (${crews.length - aiCrews})`}
              </span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Generated
              </span>
              <span className="text-[12px] font-mono font-semibold text-slate-700">
                {estimate.work_orders_generated_at
                  ? new Date(estimate.work_orders_generated_at).toLocaleString()
                  : '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Packet predates the buyout adjustment requirement */}
      {crews.length > 0 && !budgetAdjusted && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-[12px]">
          This packet predates the buyout adjustment requirement. Adjust the budget to enable
          regeneration and keep contract amounts in sync.
        </div>
      )}

      {/* Stale budget warning — the buyout budget was revised after last generation */}
      {budgetRevisedAfterGeneration && crews.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 text-[12px] text-amber-800 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              The buyout budget was revised after these work orders were generated — contract
              amounts shown may be out of date. Regenerate to lock in the latest adjusted budget.
            </p>
          </div>
          <button
            onClick={handleGenerateClick}
            disabled={generating}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-60 shrink-0"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Regenerate Now</span>
          </button>
        </div>
      )}

      {/* Site logistics */}
      {crews.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            <h4 className="text-[13px] font-semibold tracking-tight text-slate-900">
              Site Logistics &amp; Working Rules (printed on the PDF cover)
            </h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                Working hours
              </span>
              <p className="text-slate-600 mt-0.5">{site.working_hours}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                Parking &amp; staging
              </span>
              <p className="text-slate-600 mt-0.5">{site.parking_staging}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                Dust &amp; trash disposal
              </span>
              <p className="text-slate-600 mt-0.5">{site.waste_disposal}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider">
                Emergency protocol
              </span>
              <p className="text-slate-600 mt-0.5">{site.emergency_protocol}</p>
            </div>
          </div>
        </div>
      )}

      {/* Empty / prompt state — locked until the buyout budget is adjusted */}
      {crews.length === 0 && !budgetAdjusted && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center shadow-none">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800">
            Final Work Orders are Locked
          </h3>
          <p className="text-[12px] text-slate-500 max-w-md mx-auto mt-1">
            Adjust the buyout budget first. The Sub Bid and margin adjustments set the final dollar
            amount on each subcontractor agreement, so the packet cannot be generated until the
            budget is adjusted.
          </p>
          <button
            onClick={() => onNavigateSection('buyout')}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold bg-amber-600 text-white hover:bg-amber-700 shadow-sm transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Go to Buyout Budget</span>
          </button>
          <p className="text-[11px] text-slate-400 mt-2">
            Workflow: 1 · Extract estimate → 2 · Adjust buyout budget → 3 · Generate final work
            orders.
          </p>
        </div>
      )}

      {/* Empty / prompt state — budget adjusted, ready to generate final contracts */}
      {crews.length === 0 && budgetAdjusted && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center shadow-none">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 mx-auto flex items-center justify-center mb-3">
            <HardHat className="w-6 h-6" />
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800">
            No field work orders generated yet
          </h3>
          <p className="text-[12px] text-slate-500 max-w-md mx-auto mt-1">
            Budget adjusted ✓ — generate one work order per crew for{' '}
            {estimate.trade_sections.length} trade package(s). Each crew becomes a separate,
            send-ready PDF with its exact 5-part scope — quantities, materials and QC. Contract
            amounts follow your adjusted buyout budget.
          </p>
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{generating ? 'Generating…' : 'Generate Field Work Orders'}</span>
          </button>
          <button
            onClick={() => onNavigateSection('packages')}
            className="mt-4 ml-2 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <span>Review Trade Packages</span>
          </button>
          <p className="text-[11px] text-slate-400 mt-2">
            AI generation typically takes 10–30 seconds. If the AI service is unavailable the
            documents are built from deterministic field templates.
          </p>
        </div>
      )}

      {/* Crew cards */}
      {crews.map((crew, idx) => {
        const isExpanded = expandedCrewId === crew.crew_id;
        const contract = crew.contract;
        return (
          <div
            key={crew.crew_id}
            className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none transition-all hover:border-slate-300"
          >
            <div className="p-4 sm:p-5 flex items-center justify-between gap-4">
              <button
                onClick={() => setExpandedCrewId(isExpanded ? null : crew.crew_id)}
                className="flex flex-1 items-start gap-3.5 min-w-0 text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center justify-center shrink-0">
                  <HardHat className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[14px] font-semibold text-slate-900">{crew.crew_name}</h4>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        crew.source === 'ai'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {crew.source === 'ai' ? 'AI GENERATED' : 'FIELD TEMPLATE'}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-1">{crew.crew_scope}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    {crew.trade_task_ids.map((id) => (
                      <span
                        key={id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {id}
                      </span>
                    ))}
                    <span className="text-[11px] text-slate-400">
                      {crew.instructions.reduce((acc, g) => acc + g.items.length, 0)} field steps •{' '}
                      {crew.qc_checklist.length} QC checks
                    </span>
                  </div>
                  {contract && contract.budget_lines.length > 0 && (
                    <p className="text-[11px] font-semibold text-slate-700 mt-1 tabular-nums">
                      Contract {formatMoney(contract.contract_amount)} ·{' '}
                      {contract.budget_lines.length} budget line(s)
                    </p>
                  )}
                </div>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:inline text-[11px] font-semibold text-slate-400">
                  Section {idx + 1}
                </span>
                <button
                  onClick={() => void downloadCrewPdf(crew)}
                  disabled={exportingCrewId === crew.crew_id}
                  title="Download this subcontractor's standalone work order PDF"
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-60"
                >
                  {exportingCrewId === crew.crew_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  <span>PDF</span>
                </button>
                <button
                  onClick={() => setExpandedCrewId(isExpanded ? null : crew.crew_id)}
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

            {isExpanded && (
              <div className="px-4 sm:px-5 pt-4 pb-5 border-t border-slate-100 text-[12px] space-y-4">
                {contract && contract.budget_lines.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5">
                      <FileSignature className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        CONTRACT AMOUNT & BUDGET LINE LINKAGE
                      </span>
                    </div>
                    <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden">
                      <div className="divide-y divide-slate-100">
                        {contract.budget_lines.map((line, lineIdx) => (
                          <div
                            key={`${line.task_id}-${lineIdx}`}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-white"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                type="button"
                                onClick={() => onNavigateSection('packages')}
                                title={`Open the ${line.task_id} budget line in Trade Packages`}
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-100 text-slate-700 border border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors shrink-0"
                              >
                                {line.task_id}
                              </button>
                              <span className="text-slate-700 font-medium truncate">
                                {line.trade_name}
                              </span>
                              {line.trade_division && (
                                <span className="text-[10px] text-slate-400 truncate">
                                  {line.trade_division}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {line.basis === 'sub_bid' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Sub bid
                                </span>
                              )}
                              {line.basis === 'budgeted_buyout' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                  Budgeted buyout
                                </span>
                              )}
                              <span className="text-[12px] font-semibold text-slate-900 tabular-nums">
                                {formatMoney(line.amount)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 border-t border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          TOTAL CONTRACT AMOUNT
                        </span>
                        <span className="text-[13px] font-bold text-slate-900 tabular-nums">
                          {formatMoney(contract.contract_amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    1 · Scope Summary
                  </span>
                  <p className="text-slate-600 mt-1">{crew.scope_summary}</p>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    2 · Safety, Site Protection &amp; Containment
                  </span>
                  <ul className="mt-1 space-y-1">
                    {crew.safety_protocols.map((item, i) => (
                      <li key={i} className="flex gap-2 text-slate-600">
                        <ShieldCheck className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    3 · Step-by-Step Field Instructions
                  </span>
                  <div className="mt-1 space-y-2">
                    {crew.instructions.map((group, gi) => (
                      <div key={gi}>
                        <span className="font-semibold text-slate-800 text-[12px]">
                          {group.area}
                        </span>
                        <ul className="mt-0.5 space-y-1">
                          {group.items.map((item, ii) => (
                            <li key={ii} className="flex gap-2 text-slate-600">
                              <span className="text-red-500 font-bold shrink-0">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    4 · Material Specifications &amp; Fasteners
                  </span>
                  <ul className="mt-1 space-y-1">
                    {crew.material_specs.map((item, i) => (
                      <li key={i} className="flex gap-2 text-slate-600">
                        <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    5 · Quality Control &amp; Punchlist Standards
                  </span>
                  <ul className="mt-1 space-y-1">
                    {crew.qc_checklist.map((item, i) => (
                      <li key={i} className="flex gap-2 text-slate-600">
                        <span className="w-3.5 h-3.5 shrink-0 mt-0.5 border border-slate-300 rounded-[3px] bg-white inline-block" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {crew.exclusions.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-red-700 font-bold text-[11px] uppercase tracking-wider">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Do Not Perform / Scope Exclusions
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {crew.exclusions.map((item, i) => (
                        <li key={i} className="flex gap-2 text-red-700">
                          <span className="font-bold shrink-0">×</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer hints */}
      {crews.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3 text-[12px] text-slate-500">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-700">
              Each PDF is a standalone document for one subcontractor — download and send it directly.
            </p>
            <p className="mt-0.5">
              Contract amounts reflect the approved subcontract budget. Carrier pricing, margins
              and O&P never appear anywhere in the packet.
            </p>
          </div>
        </div>
      )}

      {/* Regenerate confirmation */}
      <ConfirmModal
        isOpen={confirmRegen}
        title="Regenerate Field Work Orders?"
        subtitle={`${crews.length} crew document(s) will be replaced`}
        message="This will regenerate every crew work order from the current trade packages, quantities and exclusions."
        consequence="Any manual edits baked into the current work orders will be overwritten."
        confirmLabel="Regenerate"
        onConfirm={() => void generate()}
        onCancel={() => setConfirmRegen(false)}
      />
    </div>
  );
};
