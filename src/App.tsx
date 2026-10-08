import React, { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { SideMenu, PROJECT_NAV_ITEMS } from './components/SideMenu';
import { EntryCard } from './components/EntryCard';
import { IntakeSection } from './components/sections/IntakeSection';
import { Toast, ToastMessage } from './components/Toast';
import { ConfirmModal } from './components/ConfirmModal';
import {
  EstimateResult,
  CustomerSelectionItem,
  TradeSection,
  WorkOrder,
  WorkOrderSiteLogistics,
} from './types/estimate';
import { SAMPLE_ESTIMATES } from './services/sampleEstimates';
import { generateFinalWorkOrders, isBudgetAdjusted } from './services/workOrderGeneration';
import { getCurrentUser, logout, verifySession, GappsUser } from './services/gappsAuth';
import { saveCustomerProfile, CustomerProfileSummary } from './services/gappsApi';
import { LoginPage } from './components/LoginPage';

// Keep in sync with the EntryCard upload guard. Vercel serverless request bodies cap at ~4.5MB; base64 inflates by ~4/3.
const MAX_SERVERLESS_PDF_BYTES = 3.2 * 1024 * 1024;

// Code-split the non-default tabs: only one section is mounted at a time, so
// heavy deps (frappe-gantt, pdf-lib) stay out of the initial bundle.
const TradePackagesSection = lazy(() =>
  import('./components/sections/TradePackagesSection').then((m) => ({
    default: m.TradePackagesSection,
  }))
);
const BuyoutBudgetSection = lazy(() =>
  import('./components/sections/BuyoutBudgetSection').then((m) => ({
    default: m.BuyoutBudgetSection,
  }))
);
const GanttScheduleSection = lazy(() =>
  import('./components/sections/GanttScheduleSection').then((m) => ({
    default: m.GanttScheduleSection,
  }))
);
const WorkspaceSyncSection = lazy(() =>
  import('./components/sections/WorkspaceSyncSection').then((m) => ({
    default: m.WorkspaceSyncSection,
  }))
);
const WorkOrdersSection = lazy(() =>
  import('./components/sections/WorkOrdersSection').then((m) => ({
    default: m.WorkOrdersSection,
  }))
);
const JsonExportSection = lazy(() =>
  import('./components/sections/JsonExportSection').then((m) => ({
    default: m.JsonExportSection,
  }))
);
const CustomerSelectionsSection = lazy(() =>
  import('./components/sections/CustomerSelectionsSection').then((m) => ({
    default: m.CustomerSelectionsSection,
  }))
);
const CustomersSection = lazy(() =>
  import('./components/sections/CustomersSection').then((m) => ({
    default: m.CustomersSection,
  }))
);

// Fallback shown while a lazy-loaded section chunk downloads.
const SectionFallback = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-6 h-6 rounded-full border-2 border-slate-300 border-t-red-600 animate-spin" />
    <span className="sr-only">Loading section</span>
  </div>
);

export default function App() {
  const [activeSection, setActiveSectionState] = useState<string>('intake');
  const setActiveSection = useCallback((section: string) => {
    setActiveSectionState(section);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const currentSection = PROJECT_NAV_ITEMS.find((section) => section.id === activeSection)!;
  const [currentEstimate, setCurrentEstimate] = useState<EstimateResult | null>(
    SAMPLE_ESTIMATES.water_damage
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Google Workspace session (Sheets-backed login via the Apps Script backend)
  const [currentUser, setCurrentUser] = useState<GappsUser | null>(() => getCurrentUser());

  // Confirm Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    message: string;
    consequence?: string;
    confirmLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Validate the persisted Sheets session on mount (revoked/expired sessions
  // fall back to the login page).
  useEffect(() => {
    let cancelled = false;
    verifySession().then((user) => {
      if (!cancelled) setCurrentUser(user);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = (type: 'success' | 'warning' | 'error', message: string) => {
    setToast({
      id: String(Date.now()),
      type,
      message,
    });
  };

  const handleSignOut = async () => {
    try {
      await logout();
    } catch (err: any) {
      console.error(err);
    }
    setCurrentUser(null);
    showToast('success', 'Signed out');
  };

  const handleReset = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset Current Estimate Session?',
      subtitle: 'Clear loaded claim and trade packages',
      message:
        'This will clear the active Xactimate claim data, custom subcontractor bids, and schedule timeline.',
      consequence: 'Any unsaved changes to trade packages or custom bids will be cleared.',
      confirmLabel: 'Reset Session',
      isDestructive: true,
      onConfirm: () => {
        setCurrentEstimate(null);
        setHasUnsavedChanges(false);
        setErrorMessage(null);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        showToast('warning', 'Estimate session cleared');
      },
    });
  };

  // Convert File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Process PDF Estimate through backend (optional second PDF: Component Breakdown Report)
  const handleProcessPdf = async (file: File, componentsFile?: File | null) => {
    if (file.size > MAX_SERVERLESS_PDF_BYTES) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      setErrorMessage(
        `This PDF is ${sizeMb} MB — serverless uploads cap at ~4.5 MB. Use the Paste Text option for large estimates, or split the PDF.`
      );
      showToast('error', 'PDF too large to upload');
      return;
    }
    if (componentsFile && componentsFile.size > MAX_SERVERLESS_PDF_BYTES) {
      const sizeMb = (componentsFile.size / 1024 / 1024).toFixed(1);
      setErrorMessage(
        `The component breakdown PDF is ${sizeMb} MB — serverless uploads cap at ~4.5 MB. Split the PDF or upload the estimate without it.`
      );
      showToast('error', 'Component breakdown PDF too large to upload');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const base64Data = await fileToBase64(file);
      const componentsBase64 = componentsFile ? await fileToBase64(componentsFile) : null;

      const res = await fetch('/api/process-estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pdfBase64: base64Data,
          filename: file.name,
          ...(componentsBase64
            ? {
                componentsPdfBase64: componentsBase64,
                componentsFilename: componentsFile?.name,
              }
            : {}),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${res.status}`);
      }

      const data: EstimateResult = await res.json();
      data.source_filename = file.name;
      data.extracted_at = new Date().toISOString();
      if (componentsFile) {
        data.components_filename = componentsFile.name;
      }

      setCurrentEstimate(data);
      setHasUnsavedChanges(false);
      autoSaveCustomerProfile(data);
      const warns = data.processing?.warnings || [];
      const selCount = data.customer_selections?.length || 0;
      showToast(
        warns.length > 0 ? 'warning' : 'success',
        `Extracted ${data.trade_sections.length} trade packages for ${data.project_meta.client_name} — adjust the buyout budget to unlock final work orders${
          warns.length ? ` (${warns.length} extraction warning(s))` : ''
        }${selCount ? ` · ${selCount} customer selection item(s)` : ''}.`
      );
      setActiveSection('buyout');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(
        err.message ||
          'Failed to process estimate PDF. Please verify your DEEPSEEK_API_KEY or test with sample claim data.'
      );
      showToast('error', 'Estimate processing error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Process Text Estimate through backend
  const handleProcessText = async (text: string) => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/process-estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          textContent: text,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${res.status}`);
      }

      const data: EstimateResult = await res.json();
      data.source_filename = 'Pasted_Estimate_Text.txt';
      data.extracted_at = new Date().toISOString();

      setCurrentEstimate(data);
      setHasUnsavedChanges(false);
      autoSaveCustomerProfile(data);
      const warns = data.processing?.warnings || [];
      showToast(
        warns.length > 0 ? 'warning' : 'success',
        `Extracted ${data.trade_sections.length} trade packages for ${data.project_meta.client_name} — adjust the buyout budget to unlock final work orders${
          warns.length ? ` (${warns.length} extraction warning(s))` : ''
        }.`
      );
      setActiveSection('buyout');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Failed to process estimate text.');
      showToast('error', 'Estimate parsing error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Load sample estimate directly
  const handleLoadSample = (sampleKey: string) => {
    const sample = SAMPLE_ESTIMATES[sampleKey];
    if (sample) {
      setCurrentEstimate(JSON.parse(JSON.stringify(sample)));
      setHasUnsavedChanges(false);
      setErrorMessage(null);
      showToast('success', `Loaded claim: ${sample.project_meta.client_name} — adjust the buyout budget to unlock final work orders.`);
      setActiveSection('buyout');
    }
  };

  // Update single trade. Buyout-page edits additionally stamp
  // budget_adjusted_at, which unlocks final work order generation.
  const handleUpdateTrade = (
    taskId: string,
    updated: Partial<TradeSection>,
    options?: { markBudgetAdjusted?: boolean }
  ) => {
    if (!currentEstimate) return;
    const newTrades = currentEstimate.trade_sections.map((t) =>
      t.task_id === taskId ? { ...t, ...updated } : t
    );
    setCurrentEstimate({
      ...currentEstimate,
      trade_sections: newTrades,
      ...(options?.markBudgetAdjusted ? { budget_adjusted_at: new Date().toISOString() } : {}),
    });
    setHasUnsavedChanges(true);
  };

  // Removes a trade package from the estimate entirely. Other tasks that list
  // the removed task as a predecessor have that dependency stripped so the
  // scheduler can re-sequence them from the project start.
  const handleRemoveTrade = (taskId: string) => {
    if (!currentEstimate) return;
    const target = currentEstimate.trade_sections.find(
      (t) => t.task_id === taskId
    );
    const remaining = currentEstimate.trade_sections.filter(
      (t) => t.task_id !== taskId
    );
    const cleaned = remaining.map((t) => {
      const preds = (t.predecessors || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const kept = preds.filter((p) => p !== taskId);
      return kept.length === preds.length
        ? t
        : { ...t, predecessors: kept.join(', ') };
    });
    setCurrentEstimate({
      ...currentEstimate,
      trade_sections: cleaned,
    });
    setHasUnsavedChanges(true);
    showToast(
      'success',
      `Removed ${taskId}${target ? ` — ${target.trade_name}` : ''} from the schedule.`
    );
  };

  // Bulk-applies the target buyout % to every trade's sub bid — one click both
  // adjusts the budget and unlocks final work order generation.
  const handleApplyBuyoutToAll = (pct: number) => {
    if (!currentEstimate) return;
    const clamped = Math.min(100, Math.max(0, pct));
    const trades = currentEstimate.trade_sections.map((t) => ({
      ...t,
      subcontractor_bid: Math.round((t.billable_revenue || 0) * (clamped / 100) * 100) / 100,
    }));
    setCurrentEstimate({
      ...currentEstimate,
      trade_sections: trades,
      budget_adjusted_at: new Date().toISOString(),
    });
    setHasUnsavedChanges(true);
    showToast(
      'success',
      `Applied ${clamped}% target buyout to ${trades.length} trades — budget updated for final work orders.`
    );
  };

  // Generates the final contract-bearing packet from the ADJUSTED budget and
  // navigates to the packet. Gated: refuses until budget_adjusted_at is set.
  const handleGenerateFinalWorkOrders = async () => {
    const estimate = currentEstimate;
    if (!estimate) return;
    if (!isBudgetAdjusted(estimate)) {
      showToast('warning', 'Adjust the buyout budget before generating final work orders.');
      return;
    }
    const result = await generateFinalWorkOrders(estimate);
    if (result.workOrders.length === 0) {
      showToast('warning', 'No trade packages available to generate work orders.');
      return;
    }
    // Stale guard: only apply if the same estimate object is still loaded.
    setCurrentEstimate((prev) =>
      prev === estimate
        ? {
            ...prev,
            work_orders: result.workOrders,
            work_order_site: result.siteLogistics || prev.work_order_site,
            work_orders_generated_at: result.generatedAt,
          }
        : prev
    );
    setHasUnsavedChanges(true);
    if (result.usedFallback) {
      showToast(
        'warning',
        `Final work orders generated from field templates${
          result.errorMessage ? ` (${result.errorMessage})` : ''
        } — contract amounts follow the adjusted budget.`
      );
    } else {
      showToast('success', `Generated ${result.workOrders.length} final work orders via ${result.sourceLabel}.`);
    }
    setActiveSection('workorders');
  };

  // Append a new trade package to the current estimate
  const handleAddTrade = () => {
    if (!currentEstimate) {
      showToast('warning', 'Load an estimate before adding a trade package');
      setActiveSection('intake');
      return;
    }
    const existing = currentEstimate.trade_sections;
    const maxNum = existing.reduce((max, t) => {
      const m = t.task_id.match(/^T-(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const newTrade: TradeSection = {
      task_id: `T-${maxNum + 1}`,
      trade_name: 'New Trade Package',
      category_codes_included: ['GEN'],
      billable_revenue: 0,
      suggested_duration_days: 2,
      predecessors: existing.length > 0 ? existing[existing.length - 1].task_id : '',
      scope_summary: 'Describe the scope of work for this package.',
    };
    setCurrentEstimate({
      ...currentEstimate,
      trade_sections: [...existing, newTrade],
    });
    setHasUnsavedChanges(true);
    showToast('success', `Added ${newTrade.task_id} — New Trade Package`);
    setActiveSection('packages');
  };

  // Apply generated field work orders so the packet, JSON export and PDF all
  // render from the same estimate record.
  const handleApplyWorkOrders = (
    workOrders: WorkOrder[],
    siteLogistics?: WorkOrderSiteLogistics,
    generatedAt?: string
  ) => {
    setCurrentEstimate((prev) =>
      prev
        ? {
            ...prev,
            work_orders: workOrders,
            work_order_site: siteLogistics || prev.work_order_site,
            work_orders_generated_at: generatedAt || new Date().toISOString(),
          }
        : prev
    );
    setHasUnsavedChanges(true);
  };

  // Persist edited customer selections (customer-facing allowance sheet rows).
  const handleUpdateSelections = (items: CustomerSelectionItem[]) => {
    if (!currentEstimate) return;
    setCurrentEstimate((prev) => (prev ? { ...prev, customer_selections: items } : prev));
    setHasUnsavedChanges(true);
  };

  // Opens a saved customer profile record back into the active session.
  const handleOpenCustomerProfile = (
    estimate: EstimateResult,
    profile: CustomerProfileSummary
  ) => {
    setCurrentEstimate(estimate);
    setHasUnsavedChanges(false);
    setErrorMessage(null);
    showToast(
      'success',
      `Opened customer profile — ${profile.client_name} (Claim ${profile.claim_number}).`
    );
    setActiveSection('intake');
  };

  // Fire-and-forget customer profile save after a fresh extraction.
  const autoSaveCustomerProfile = (estimate: EstimateResult) => {
    void saveCustomerProfile(estimate)
      .then((profile) =>
        showToast(
          'success',
          `Customer profile saved — ${profile.client_name} (Claim ${profile.claim_number}).`
        )
      )
      .catch((err: any) =>
        showToast(
          'warning',
          `Customer profile auto-save failed: ${err?.message || 'unknown error'}`
        )
      );
  };

  // Sheets-based login gates the entire app (see instructions/apps-script-deployment.md).
  if (!currentUser) {
    return (
      <LoginPage
        onAuthenticated={(user) => {
          setCurrentUser(user);
          showToast('success', `Signed in as ${user.email}`);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans antialiased selection:bg-red-500/20">
      {/* Header */}
      <Header
        currentEstimate={currentEstimate}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onReset={handleReset}
        onNavigateSection={setActiveSection}
      />

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-[1400px] w-full min-w-0 mx-auto px-3 py-4 sm:px-5 sm:py-6">
        <div className="flex min-w-0 flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Side Menu */}
          <SideMenu
            activeSection={activeSection}
            onSelectSection={setActiveSection}
            onAddTrade={handleAddTrade}
            currentEstimate={currentEstimate}
            isProcessing={isProcessing}
            hasUnsavedChanges={hasUnsavedChanges}
          />

          {/* Content Column */}
          <div className="flex-1 min-w-0 space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{currentSection.label}</h1>
              <p className="mt-1 text-sm leading-6 text-slate-500">{currentSection.description}</p>
            </div>

            {/* Keep draft upload inputs mounted when another section is open. */}
            <div hidden={activeSection !== 'intake'}>
              <EntryCard
                onProcessPdf={handleProcessPdf}
                onProcessText={handleProcessText}
                onLoadSample={handleLoadSample}
                isProcessing={isProcessing}
                currentEstimate={currentEstimate}
                errorMessage={errorMessage}
              />
            </div>

            {/* Active Section Only */}
            {activeSection === 'intake' && (
              <IntakeSection
                estimate={currentEstimate}
                onNavigateSection={setActiveSection}
              />
            )}

            {/* Lazy-loaded sections share one boundary; only the active tab mounts. */}
            <Suspense fallback={<SectionFallback />}>
              {activeSection === 'packages' && (
                <TradePackagesSection
                  estimate={currentEstimate}
                  onUpdateTrade={handleUpdateTrade}
                  onAddTrade={handleAddTrade}
                  onNavigateSection={setActiveSection}
                />
              )}

              {activeSection === 'buyout' && (
                <BuyoutBudgetSection
                  estimate={currentEstimate}
                  onUpdateTrade={(id, updated) =>
                    handleUpdateTrade(id, updated, { markBudgetAdjusted: true })
                  }
                  onNavigateSection={setActiveSection}
                  onApplyBuyoutToAll={handleApplyBuyoutToAll}
                  onGenerateFinalWorkOrders={handleGenerateFinalWorkOrders}
                />
              )}

              {activeSection === 'gantt' && (
                <GanttScheduleSection
                  estimate={currentEstimate}
                  onNavigateSection={setActiveSection}
                  onUpdateTrade={handleUpdateTrade}
                  onRemoveTrade={handleRemoveTrade}
                  onShowToast={showToast}
                />
              )}

              {activeSection === 'workspace' && (
                <WorkspaceSyncSection
                  estimate={currentEstimate}
                  currentUser={currentUser}
                  onShowToast={showToast}
                />
              )}

              {activeSection === 'workorders' && (
                <WorkOrdersSection
                  estimate={currentEstimate}
                  onShowToast={showToast}
                  onNavigateSection={setActiveSection}
                  onApplyWorkOrders={handleApplyWorkOrders}
                />
              )}

              {activeSection === 'selections' && (
                <CustomerSelectionsSection
                  estimate={currentEstimate}
                  onUpdateSelections={handleUpdateSelections}
                  onNavigateSection={setActiveSection}
                  onShowToast={showToast}
                />
              )}

              {activeSection === 'customers' && (
                <CustomersSection
                  currentEstimate={currentEstimate}
                  onOpenProfile={handleOpenCustomerProfile}
                  onShowToast={showToast}
                />
              )}

              {activeSection === 'json' && (
                <JsonExportSection
                  estimate={currentEstimate}
                  onShowToast={showToast}
                />
              )}
            </Suspense>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-auto bg-white py-4">
        <div className="max-w-[1400px] mx-auto px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px] text-slate-500">
          <div>
            <span className="font-semibold text-slate-700">Hays+Sons</span> &bull; Project Manager Workspace
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Estimate &middot; Plan &middot; Deliver</span>
          </div>
        </div>
      </footer>

      {/* Floating Toast */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        subtitle={confirmModal.subtitle}
        message={confirmModal.message}
        consequence={confirmModal.consequence}
        confirmLabel={confirmModal.confirmLabel}
        isDestructive={confirmModal.isDestructive}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
