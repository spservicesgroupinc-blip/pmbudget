import React, { useState } from 'react';
import {
  Code2,
  Copy,
  Check,
  Download,
  Terminal,
  FileCode,
} from 'lucide-react';
import { EstimateResult } from '../../types/estimate';

interface JsonExportSectionProps {
  estimate: EstimateResult | null;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
}

export const JsonExportSection: React.FC<JsonExportSectionProps> = ({
  estimate,
  onShowToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <Code2 className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No JSON Data to Display
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Upload an Xactimate estimate to generate the strict schema JSON response.
        </p>
      </div>
    );
  }

  // Format the output payload strictly according to the user prompt schema
  const strictOutput = {
    project_meta: {
      client_name: estimate.project_meta.client_name,
      claim_number: estimate.project_meta.claim_number,
      carrier: estimate.project_meta.carrier,
      ...(estimate.project_meta.policy_number
        ? { policy_number: estimate.project_meta.policy_number }
        : {}),
      ...(estimate.project_meta.property_address
        ? { property_address: estimate.project_meta.property_address }
        : {}),
      total_rcv: estimate.project_meta.total_rcv,
      overhead_and_profit: estimate.project_meta.overhead_and_profit || 0,
      ...(estimate.project_meta.base_subtotal !== undefined
        ? { base_subtotal: estimate.project_meta.base_subtotal }
        : {}),
      ...(estimate.project_meta.material_tax !== undefined
        ? { material_tax: estimate.project_meta.material_tax }
        : {}),
      ...(estimate.project_meta.op_total !== undefined
        ? { op_total: estimate.project_meta.op_total }
        : {}),
    },
    trade_sections: estimate.trade_sections.map((t) => ({
      task_id: t.task_id,
      trade_name: t.trade_name,
      ...(t.trade_division ? { trade_division: t.trade_division } : {}),
      ...(t.execution_type ? { execution_type: t.execution_type } : {}),
      category_codes_included: t.category_codes_included,
      billable_revenue: t.billable_revenue,
      suggested_duration_days: t.suggested_duration_days,
      predecessors: t.predecessors,
      scope_summary: t.scope_summary,
      ...(t.exclusions && t.exclusions.length > 0 ? { exclusions: t.exclusions } : {}),
      // Budget-engine extensions (present after AI processing).
      ...(t.direct_subtotal !== undefined ? { direct_subtotal: t.direct_subtotal } : {}),
      ...(t.retail_labor !== undefined ? { retail_labor: t.retail_labor } : {}),
      ...(t.retail_material !== undefined ? { retail_material: t.retail_material } : {}),
      ...(t.direct_material !== undefined ? { direct_material: t.direct_material } : {}),
      ...(t.direct_labor !== undefined ? { direct_labor: t.direct_labor } : {}),
      ...(t.total_direct_cost !== undefined
        ? { total_direct_cost: t.total_direct_cost }
        : {}),
      ...(t.gross_profit !== undefined ? { gross_profit: t.gross_profit } : {}),
      ...(t.gross_margin_pct !== undefined ? { gross_margin_pct: t.gross_margin_pct } : {}),
      // Emitted only when a bar was dragged in the Gantt scheduler, so the
      // strict schema is unchanged for auto-sequenced estimates.
      ...(t.schedule_start_override
        ? { schedule_start_override: t.schedule_start_override }
        : {}),
    })),
    ...(estimate.budget_audit ? { budget_audit: estimate.budget_audit } : {}),
    ...(estimate.material_allowances && estimate.material_allowances.length > 0
      ? { material_allowances: estimate.material_allowances }
      : {}),
    ...(estimate.customer_selections && estimate.customer_selections.length > 0
      ? { customer_selections: estimate.customer_selections }
      : {}),
    ...(estimate.work_orders && estimate.work_orders.length > 0
      ? { work_orders: estimate.work_orders }
      : {}),
  };

  const jsonString = JSON.stringify(strictOutput, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    onShowToast('success', 'JSON copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${estimate.project_meta.client_name.replace(/\s+/g, '_')}_Claim_${estimate.project_meta.claim_number}_TradePackages.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('success', 'JSON file downloaded');
  };

  const appsScriptCode = `function callDeepSeek(estimateText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("DEEPSEEK_API_KEY");
  const url = "https://api.deepseek.com/chat/completions";

  const payload = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: "You are the Senior Construction Estimator for Hays + Sons Complete Restoration. Output valid JSON only (project_meta, trade_sections, material_allowances) with no markdown."
      },
      {
        role: "user",
        content: "Process this Xactimate estimate into subcontractor trade packages and Gantt dependency schedule.\\n\\n" + estimateText
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1
  };

  const response = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const jsonResponse = JSON.parse(response.getContentText());
  return JSON.parse(jsonResponse.choices[0].message.content);
}`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(appsScriptCode);
    setCopiedScript(true);
    onShowToast('success', 'Google Apps Script snippet copied');
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Schema Verification Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 text-red-600">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                JSON Response Schema &amp; Automation Export
              </h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Strict schema adherence: <code className="text-slate-700 font-mono">project_meta</code>, <code className="text-slate-700 font-mono">trade_sections</code>, budget-engine fields, <code className="text-slate-700 font-mono">material_allowances</code> and the redacted <code className="text-slate-700 font-mono">work_orders</code> packet when generated.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-semibold text-slate-700 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-red-600 text-white hover:bg-red-700 text-[12px] font-semibold shadow-sm transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Code Viewer */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-none">
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
            <span className="ml-2 text-slate-300">response.json</span>
          </div>
          <span>Strict Schema Verified</span>
        </div>
        <pre className="p-4 text-[12px] font-mono text-emerald-400 overflow-x-auto max-h-[480px] leading-relaxed">
          {jsonString}
        </pre>
      </div>

      {/* Google Apps Script Integration Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-500" />
            <h4 className="text-[14px] font-semibold text-slate-900">
              Google Apps Script Snippet (UrlFetchApp)
            </h4>
          </div>
          <button
            onClick={handleCopyScript}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 hover:text-red-700"
          >
            {copiedScript ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copied Code</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Script</span>
              </>
            )}
          </button>
        </div>
        <p className="text-[12px] text-slate-500">
          Paste this script into Google Sheets or Docs Apps Script editor to automate estimate text processing with DeepSeek Chat (set{' '}
          <code className="font-mono text-slate-700">DEEPSEEK_API_KEY</code>{' '}
          in Script Properties):
        </p>
        <pre className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] font-mono text-slate-800 overflow-x-auto leading-relaxed">
          {appsScriptCode}
        </pre>
      </div>
    </div>
  );
};
