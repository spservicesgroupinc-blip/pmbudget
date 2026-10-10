import React from 'react';
import { Check, Loader2, LogOut, Plus, Save } from 'lucide-react';
import type { EstimateResult } from '../types/estimate';
import type { GappsUser } from '../services/gappsAuth';
import { BrandLogo } from './BrandLogo';
import { InstallPwa } from './InstallPwa';

interface HeaderProps {
  currentEstimate: EstimateResult | null;
  currentUser: GappsUser | null;
  onSignOut: () => void;
  onNewJob: () => void;
  onSave: () => void;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isBusy: boolean;
  onNavigateSection: (sectionId: string) => void;
}
const actionClass = 'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-40 disabled:cursor-not-allowed';

export function Header({ currentEstimate, currentUser, onSignOut, onNewJob, onSave, hasUnsavedChanges, isSaving, isBusy, onNavigateSection }: HeaderProps) {
  const meta = currentEstimate?.project_meta;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-5">
        <div className="flex min-h-18 flex-wrap items-center justify-between gap-3 py-3">
          <button onClick={() => onNavigateSection('home')} aria-label="Go to home" disabled={isBusy} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><BrandLogo size={30} withWordmark sublabel="Project Manager Workspace" /></button>
          <div className="hidden min-w-0 flex-1 border-l border-slate-200 pl-5 xl:block"><p className="truncate text-sm font-semibold text-slate-800">{meta?.client_name || 'Jobs & project planning'}</p><p className="mt-1 truncate text-xs text-slate-500">{meta ? `Claim ${meta.claim_number}` : 'Hays + Sons'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden sm:block"><InstallPwa /></div>
            <button onClick={onNewJob} disabled={isBusy || isSaving} className={`${actionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}><Plus className="h-4 w-4" /> New job</button>
            {meta && <button onClick={onSave} disabled={isSaving || isBusy || !hasUnsavedChanges} className={`${actionClass} ${hasUnsavedChanges || isSaving ? 'border-red-600 bg-red-600 text-white hover:bg-red-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : hasUnsavedChanges ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}{isSaving ? 'Saving…' : hasUnsavedChanges ? 'Save changes' : 'Saved'}
            </button>}
            {currentUser && <button onClick={onSignOut} disabled={isBusy || isSaving} title={`Signed in as ${currentUser.email}. Sign out.`} aria-label="Sign out" className={`${actionClass} border-transparent text-slate-500 hover:bg-slate-50`}><span className="hidden max-w-28 truncate 2xl:inline">{currentUser.name || currentUser.email}</span><LogOut className="h-4 w-4" /></button>}
          </div>
        </div>
        {meta && <div className="flex items-center justify-between gap-3 border-t border-slate-100 py-2 xl:hidden"><span className="truncate text-xs font-medium text-slate-700">{meta.client_name}</span><span className="shrink-0 text-[11px] text-slate-500">{hasUnsavedChanges ? 'Unsaved changes' : `Claim ${meta.claim_number}`}</span></div>}
      </div>
    </header>
  );
}
