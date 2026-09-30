import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Loader2,
  FileCode,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Layers,
  X,
} from 'lucide-react';
import { SAMPLE_ESTIMATES, RAW_ESTIMATE_SNIPPET } from '../services/sampleEstimates';
import { EstimateResult } from '../types/estimate';

// Keep in sync with the App.tsx upload guard. Vercel serverless request bodies cap at ~4.5MB; base64 inflates by ~4/3.
const MAX_SERVERLESS_PDF_BYTES = 3.2 * 1024 * 1024;
const PDF_TOO_LARGE_MESSAGE =
  'PDF is larger than 3.2 MB. Serverless uploads are capped at ~4.5 MB — for large estimates use Paste Text, or split the PDF.';

/** True for the PDF type accepted by the upload input. */
const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

interface EntryCardProps {
  onProcessPdf: (file: File, componentsFile?: File | null) => Promise<void>;
  onProcessText: (text: string) => Promise<void>;
  onLoadSample: (sampleKey: string) => void;
  isProcessing: boolean;
  currentEstimate: EstimateResult | null;
  errorMessage: string | null;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  onProcessPdf,
  onProcessText,
  onLoadSample,
  isProcessing,
  currentEstimate,
  errorMessage,
}) => {
  const [mode, setMode] = useState<'upload' | 'paste' | 'sample'>('upload');
  const [pastedText, setPastedText] = useState(RAW_ESTIMATE_SNIPPET);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Optional second upload: Xactimate Component Breakdown Report.
  const [componentsFile, setComponentsFile] = useState<File | null>(null);
  const [componentsDragActive, setComponentsDragActive] = useState(false);
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const componentsInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isPdfFile(file) && file.size > MAX_SERVERLESS_PDF_BYTES) {
        setFileError(PDF_TOO_LARGE_MESSAGE);
        return;
      }
      setFileError(null);
      setSelectedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (isPdfFile(file) && file.size > MAX_SERVERLESS_PDF_BYTES) {
        setFileError(PDF_TOO_LARGE_MESSAGE);
        // Allow re-selecting the same file after a rejected pick.
        e.target.value = '';
        return;
      }
      setFileError(null);
      setSelectedFile(file);
    }
  };

  const acceptComponentsFile = (file: File | null | undefined) => {
    if (!file) return;
    if (isPdfFile(file) && file.size > MAX_SERVERLESS_PDF_BYTES) {
      setComponentsError(PDF_TOO_LARGE_MESSAGE);
      return;
    }
    setComponentsError(null);
    setComponentsFile(file);
  };

  const handleComponentsDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setComponentsDragActive(true);
    } else if (e.type === 'dragleave') {
      setComponentsDragActive(false);
    }
  };

  const handleComponentsDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setComponentsDragActive(false);
    acceptComponentsFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  };

  const handleComponentsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      acceptComponentsFile(file);
      // Allow re-selecting the same file after a rejected pick.
      e.target.value = '';
    }
  };

  const handleTriggerProcess = () => {
    if (mode === 'upload' && selectedFile) {
      onProcessPdf(selectedFile, componentsFile);
    } else if (mode === 'paste' && pastedText.trim()) {
      onProcessText(pastedText);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <UploadCloud className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Estimate Intake &amp; Subcontractor Trade Roll-Up
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Upload an Xactimate PDF or paste estimate text to synthesize trade packages, buyout budgets, and Gantt logic.
            </p>
          </div>
        </div>

        {/* Input Mode Selector */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              mode === 'upload'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            PDF Upload
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              mode === 'paste'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Paste Text
          </button>
          <button
            type="button"
            onClick={() => setMode('sample')}
            className={`px-3 py-1 rounded-md font-medium transition-colors ${
              mode === 'sample'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sample Claims
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-5">
        {errorMessage && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 flex items-start gap-2.5 text-[12px] text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block">Processing Error:</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {mode === 'upload' && (
          <div className="space-y-4">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                dragActive
                  ? 'border-red-500 bg-red-50/50'
                  : selectedFile
                  ? 'border-emerald-300 bg-emerald-50/30'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="max-w-md mx-auto flex flex-col items-center">
                {selectedFile ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                      {(selectedFile.size / 1024).toFixed(1)} KB · Ready to analyze with DeepSeek
                    </p>
                    <p className="text-[11px] text-red-600 mt-2 font-medium">
                      Click to choose another file
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-2">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <p className="text-[13px] font-medium text-slate-800">
                      Drag &amp; drop your <span className="font-semibold text-slate-900">Xactimate estimate PDF</span> here
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Supports full multi-page line item estimates, summary sheets, and ESX/PDF exports
                    </p>
                    <span className="mt-3 inline-flex items-center text-[12px] font-semibold text-red-600 hover:text-red-700">
                      Or browse local files
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Optional second upload: Xactimate Component Breakdown Report */}
            <div
              onDragEnter={handleComponentsDrag}
              onDragLeave={handleComponentsDrag}
              onDragOver={handleComponentsDrag}
              onDrop={handleComponentsDrop}
              onClick={() => !componentsFile && componentsInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 transition-colors ${
                componentsFile
                  ? 'border-emerald-300 bg-emerald-50/30'
                  : componentsDragActive
                  ? 'border-red-500 bg-red-50/50 cursor-pointer'
                  : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50 cursor-pointer'
              }`}
            >
              <input
                ref={componentsInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleComponentsFileChange}
                className="hidden"
              />
              {componentsFile ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-slate-900 truncate">
                        {componentsFile.name}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {(componentsFile.size / 1024).toFixed(1)} KB · Component quantities merged into the extraction
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={(e) => {
                      e.stopPropagation();
                      setComponentsFile(null);
                    }}
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-45"
                    aria-label="Remove component breakdown PDF"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-left">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-slate-700">
                      Component Breakdown Report{' '}
                      <span className="font-normal text-slate-400">(optional)</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Attach the Xactimate component report to use exact quantities for material allowances and customer selections.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {componentsError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 flex items-start gap-2.5 text-[12px] text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{componentsError}</span>
              </div>
            )}

            {fileError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 flex items-start gap-2.5 text-[12px] text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1">{fileError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Zero client secrets · Server-side DeepSeek API · Instant JSON roll-up</span>
              </div>
              <button
                type="button"
                disabled={!selectedFile || isProcessing}
                onClick={handleTriggerProcess}
                className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing PDF Estimate…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Process Xactimate Estimate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {mode === 'paste' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
                Paste Xactimate Line Items or Summary Text
              </label>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                rows={6}
                placeholder="Paste Xactimate estimate text with WTR, DRY, PNT, FCC category codes..."
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-slate-50 text-[12px] font-mono text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Tip: Copy from Xactimate summary report or text printout including room breakdowns and category codes.
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setPastedText(RAW_ESTIMATE_SNIPPET)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Load Sample Xactimate Text</span>
              </button>

              <button
                type="button"
                disabled={!pastedText.trim() || isProcessing}
                onClick={handleTriggerProcess}
                className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Synthesizing Packages…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Extract Trade Packages</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {mode === 'sample' && (
          <div className="space-y-3">
            <p className="text-[12px] text-slate-600">
              Select one of our pre-analyzed real restoration loss scenarios to immediately populate trade packages, buyout margins, and the Gantt schedule:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              {/* Sample 1 */}
              <div
                onClick={() => onLoadSample('water_damage')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50/30 cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      Water Loss
                    </span>
                    <span className="text-[11px] font-bold text-slate-900 tabular-nums">
                      $48,720.50
                    </span>
                  </div>
                  <h4 className="text-[13px] font-semibold text-slate-900 leading-snug">
                    Michael &amp; Sarah Jenkins
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">
                    State Farm · Claim #92-8419-X21
                  </p>
                  <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">
                    8 trade packages (Mitigation, Drywall flood cut, LVP flooring, Baseboards).
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                >
                  Load Water Claim
                </button>
              </div>

              {/* Sample 2 */}
              <div
                onClick={() => onLoadSample('fire_rebuild')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50/30 cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                      Kitchen Fire
                    </span>
                    <span className="text-[11px] font-bold text-slate-900 tabular-nums">
                      $94,350.00
                    </span>
                  </div>
                  <h4 className="text-[13px] font-semibold text-slate-900 leading-snug">
                    David &amp; Amanda Torres
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">
                    Chubb Ins · Claim #CB-2026-8812
                  </p>
                  <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">
                    9 trade packages (Framing, Full MEP rewire, Custom Shaker Cabinets, Tile).
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                >
                  Load Fire Claim
                </button>
              </div>

              {/* Sample 3 */}
              <div
                onClick={() => onLoadSample('storm_rebuild')}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 hover:bg-red-50/30 cursor-pointer transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Storm / Hail
                    </span>
                    <span className="text-[11px] font-bold text-slate-900 tabular-nums">
                      $63,980.00
                    </span>
                  </div>
                  <h4 className="text-[13px] font-semibold text-slate-900 leading-snug">
                    Robert Vance
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">
                    Liberty Mutual · Claim #LM-550912
                  </p>
                  <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">
                    7 trade packages (32 SQ Roofing, Siding/Gutters, Glazing, Ceilings).
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                >
                  Load Storm Claim
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-700">Workflow Target:</span>
          <span>Xactimate Estimate &rarr; Trade Packages &rarr; Buyout Budget &rarr; Gantt &rarr; Google Workspace</span>
        </div>
        <div>
          {currentEstimate ? (
            <span className="font-semibold text-emerald-700">
              Active Estimate Loaded ({currentEstimate.trade_sections.length} packages ready)
            </span>
          ) : (
            <span>Ready for input</span>
          )}
        </div>
      </div>
    </div>
  );
};
