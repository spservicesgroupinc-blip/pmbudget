const fs = require('fs');
const path = require('path');
const ASAR = 'C:/Users/russe/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const NM = path.join(ASAR, 'dsh', 'node_modules', '@deepseek-ai');
const OUT = 'C:/ghannt/asar-dump';

const PKGS = [
  'cordis', 'cordis-plugin-loader', 'cordis-plugin-include', 'cordis-plugin-group',
  'dsh-client-ui-slots', 'dsh-client-connection', 'dsh-web', 'dsh-host-frontend-static',
  'dsh-client-ui-sidebar-browser', 'dsh-client-ui-cordis', 'dsh-client-ui-theme',
  'dsh-client-ui-settings', 'dsh-client-ui-conversation', 'dsh-client-ui-sidebar',
  'dsh-client-ui-renderer', 'dsh-client-ui-primitives', 'dsh-client-ui-layout',
  'dsh-tool-cordis', 'dsh-workflow-ptc', 'dsh-subagent', 'dsh-spill', 'dsh-typert-protocol',
  'dsh-typert-registry', 'dsh-typert-loader', 'dsh-storage-domain', 'dsh-session-log-deepseek',
  'dsh-lazy-require', 'dsh-hmr', 'dsh-client-hmr', 'dsh-cmdline', 'dsh-home-paths',
  'dsh-native-command', 'dsh-host-open-in-app', 'dsh-host-directory-picker',
  'dsh-api-settings-controller', 'dsh-api-session-controller', 'dsh-api-workspace-controller',
  'dsh-api-terminal-controller', 'dsh-api-job-controller', 'dsh-api-account-controller',
  'dsh-api-remotes', 'dsh-api-workspace-files', 'dsh-experimental-schedule-bundle',
  'dsh-experimental-voice-input-bundle', 'dsh-experimental-agent-team-profile',
  'dsh-experimental-tool-agent-team', 'dsh-experimental-client-ui-agent-team',
  'dsh-experimental-speech-to-text-sensevoice', 'dsh-experimental-api-speech-to-text',
  'dsh-agent-preset', 'dsh-permission-presets', 'dsh-schedule', 'dsh-tool-web',
  'dsh-workflow', 'dsh-web-search-deepseek', 'dsh-web-fetch-http', 'dsh-webhook-github',
  'dsh-hooks-claude-code', 'dsh-hooks-codex', 'dsh-office-to-pdf', 'dsh-mcp-client',
  'dsh-mcp-resources', 'dsh-terminal', 'dsh-credentials', 'dsh-credentials-local',
  'dsh-launch-environment', 'dsh-session-persistence', 'dsh-session-query',
  'dsh-session-persistence-jsonl', 'dsh-session-query-sqlite', 'dsh-invariants',
  'dsh-compaction', 'dsh-compaction-basic', 'dsh-compaction-image-offload',
  'dsh-compaction-tool-result-pruner', 'dsh-message-feedback', 'dsh-session-title',
  'dsh-session-title-llm', 'dsh-session-title-first-prompt-llm', 'dsh-attachment',
  'dsh-attachment-local', 'dsh-file-reference', 'dsh-file-reference-local',
  'dsh-output-retention', 'dsh-session-checkpoint-policy', 'dsh-token-meter',
  'dsh-time-context', 'dsh-tmux-context', 'dsh-system-prompt', 'dsh-persona',
  'dsh-anonymous-user-id', 'dsh-goal', 'dsh-goal-round-driver', 'dsh-plan-mode',
  'dsh-user-questions', 'dsh-tool-ask-user', 'dsh-user-approval', 'dsh-agent-instructions',
  'dsh-agent-loop', 'dsh-agent-tool-presentation', 'dsh-repeat-tool-reminder',
  'dsh-command-compact', 'dsh-command-feedback', 'dsh-command-goal', 'dsh-deepseek-account',
  'dsh-deepseek-account-platform', 'dsh-deepseek-llm-api-extensions', 'dsh-llm',
  'dsh-llm-deepseek', 'dsh-llm-deepseek-account', 'dsh-llm-deepseek-api-key',
  'dsh-llm-pi-ai', 'dsh-llm-retry', 'dsh-tool-call-timeout-policy', 'dsh-timeout',
  'dsh-deque', 'dsh-util-code-language', 'dsh-util-crypto', 'dsh-util-time',
  'dsh-util-values', 'dsh-util-workspace-path', 'dsh-win32-process', 'dsh-bash-local',
  'dsh-bash-sandbox', 'dsh-pwsh-local', 'dsh-pwsh-sandbox', 'dsh-tool-bash',
  'dsh-tool-bash-persistent', 'dsh-tool-pwsh', 'dsh-tool-pwsh-persistent', 'dsh-sandbox',
  'dsh-sandbox-local', 'dsh-sandbox-policy', 'dsh-sandbox-windows-acl', 'dsh-fs-local',
  'dsh-fs-observation-policy', 'dsh-fs-sandbox', 'dsh-chunked-list', 'dsh-session',
  'dsh-session-format', 'dsh-session-format-catalog', 'dsh-session-format-v0-to-v1',
  'dsh-session-format-v1-to-v2', 'dsh-session-format-v2-to-v3', 'dsh-session-format-v3-to-v4',
  'dsh-session-projection', 'dsh-session-projection-cache', 'dsh-session-reference',
  'dsh-session-stats', 'dsh-session-telemetry', 'dsh-session-telemetry-otel',
  'dsh-session-turn-outline', 'dsh-otel', 'dsh-host-product-telemetry-otel',
  'dsh-client-product-analytics', 'dsh-job', 'dsh-job-controller', 'dsh-skill',
  'dsh-skill-badge', 'dsh-skill-filesystem', 'dsh-skill-office', 'dsh-tool-skill',
  'dsh-tool-fs', 'dsh-tool-fs-search', 'dsh-tool-str-replace-editor', 'dsh-tool-todo',
  'dsh-tool-goal', 'dsh-tool-jobs', 'dsh-tool-present', 'dsh-tool-subagent',
  'dsh-tool-subagent-control', 'dsh-tool-web', 'dsh-tool-workflow',
  'dsh-tool-workspace-dependencies', 'dsh-tool-cordis', 'dsh-tool-ralph', 'dsh-web-app',
  'dsh-headless', 'dsh-acp', 'dsh-acp-app', 'dsh-atomic-write', 'dsh-authorization',
  'dsh-workspace', 'dsh-workspace-changes', 'dsh-client-file-upload', 'dsh-client-locale',
  'dsh-client-resources', 'dsh-client-shortcuts', 'dsh-client-ui-shortcuts',
];

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  let ents;
  try { ents = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (filter && !filter(e, src)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else { try { fs.copyFileSync(s, d); } catch (err) {} }
  }
}

const filter = (e, src) => {
  if (e.name === 'node_modules') return false;
  if (e.name === 'dist' && !src.includes('dsh-web-frontend')) return false;
  return true;
};

let n = 0;
for (const p of PKGS) {
  const src = path.join(NM, p);
  const dst = path.join(OUT, p);
  try { copyDir(src, dst, filter); n++; } catch (e) { console.log('FAIL ' + p + ': ' + e.message); }
}
console.log('copied ' + n + ' of ' + PKGS.length);
