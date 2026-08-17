import { writeExecutionArtifact } from './executionArtifacts.js';
import { cleanupSpreadsheetData } from './knowledgeWorkExecution.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';
import * as XLSX from 'xlsx';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_SPREADSHEET_PLUGIN_ID || 'local-spreadsheet-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_SPREADSHEET_PLUGIN_OWNER || 'spreadsheet-cleanup-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const RUN_ONCE = process.argv.includes('--once');

function buildSpreadsheetPreview(cleanup, outputFormat = 'csv', maxRows = 25) {
  const previewRows = Array.isArray(cleanup.rows) ? cleanup.rows.slice(0, maxRows) : [];
  if (String(outputFormat).toLowerCase() === 'json') {
    return JSON.stringify(previewRows, null, 2);
  }
  const delimiter = String(outputFormat).toLowerCase() === 'tsv' ? '\t' : ',';
  const escapeValue = (value) => {
    const text = String(value ?? '');
    if (!/[",\n\t]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const headerLine = cleanup.headers.map((header) => escapeValue(header)).join(delimiter);
  const rowLines = previewRows.map((row) =>
    cleanup.headers.map((header) => escapeValue(row?.[header] ?? '')).join(delimiter)
  );
  return [headerLine, ...rowLines].join('\n');
}

function buildSpreadsheetWorkbookBuffer(cleanup, maxRows = null) {
  const rows = Array.isArray(cleanup.rows)
    ? (Number.isFinite(maxRows) ? cleanup.rows.slice(0, maxRows) : cleanup.rows)
    : [];
  const matrix = [
    cleanup.headers,
    ...rows.map((row) => cleanup.headers.map((header) => row?.[header] ?? ''))
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cleaned');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function headers() {
  return {
    'content-type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(`non_json_response:${path}:${response.status}:${contentType || 'unknown'}:${snippet}`);
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`invalid_json:${path}:${response.status}:${String(error.message)}`);
  }
  if (!response.ok) {
    throw new Error(data.error || `http_${response.status}`);
  }
  return data;
}

function buildFulfillment(session) {
  const selections = session.finalSelections || session.selections || {};
  const outputFormat = String(selections.outputFormat || 'csv').toLowerCase();
  const fundingMode = String(session.paymentOrchestration?.fundingMode || selections.paymentFundingMode || 'magic_city_credits');
  const cleanup = cleanupSpreadsheetData({
    rawData: session.localPrivateContext?.rawData || selections.rawData || '',
    cleanupGoals: selections.cleanupGoals || '',
    outputFormat
  });
  const previewOnly = fundingMode === 'free_preview';
  const exportContent = outputFormat === 'xlsx'
    ? buildSpreadsheetWorkbookBuffer(cleanup, previewOnly ? 25 : null)
    : (previewOnly
      ? buildSpreadsheetPreview(cleanup, outputFormat)
      : (outputFormat === 'json' ? cleanup.cleanedJson : cleanup.cleanedDelimited));
  const exportArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'spreadsheet',
    label: previewOnly ? 'preview-export' : 'cleaned-export',
    extension: outputFormat,
    content: exportContent
  });
  const reportArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'spreadsheet',
    label: 'cleanup-report',
    extension: 'md',
    content: cleanup.report
  });
  const completionState = previewOnly ? 'ready_for_review' : 'completed';
  const nextHumanAction = previewOnly
    ? 'Preview the cleaned rows now, then switch to credits when you want the full cleaned export.'
    : 'Download the cleaned export or rerun the package with different cleanup settings.';
  return {
    status: 'fulfilled',
    result: buildExecutionResult({
      session,
      completionState,
      nextHumanAction,
      artifacts: [
        { label: previewOnly ? 'Preview export' : 'Cleaned export', url: exportArtifact.url, sha256: exportArtifact.sha256 },
        { label: 'Cleanup report', url: reportArtifact.url, sha256: reportArtifact.sha256 }
      ],
      extraResult: {
        previewOnly,
        fundingMode,
        outputFormat,
        headers: cleanup.headers,
        cleanRowCount: cleanup.cleanRowCount,
        previewRowCount: Math.min(cleanup.cleanRowCount, 25),
        duplicateRowsDropped: cleanup.duplicateRowsDropped,
        blankRowsDropped: cleanup.blankRowsDropped,
        repeatedHeaderRowsDropped: cleanup.repeatedHeaderRowsDropped,
        sparseColumns: cleanup.sparseColumns,
        cleanupGoals: selections.cleanupGoals || '',
        serviceTier: selections.serviceTier || '',
        rowCountBand: selections.rowCountBand || '',
        exportUrl: exportArtifact.url,
        reportUrl: reportArtifact.url
      }
    }),
    handoff: {
      label: previewOnly ? 'Download preview export' : 'Download cleaned export',
      url: exportArtifact.url
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} ${previewOnly ? 'Free preview generated.' : 'Full export generated.'} Prepared by ${PLUGIN_ID} for ${session.handoffData?.title || 'spreadsheet cleanup'}.`,
    proofRef: `${PLUGIN_ID}:${session.id}`
  };
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        ownerAgentId: OWNER_AGENT_ID,
        kind: 'spreadsheet',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['spreadsheet-cleanup-agent', 'spreadsheet.export'],
        tools: ['spreadsheet.parse', 'spreadsheet.normalize', 'spreadsheet.export'],
        privacyModes: ['private'],
        helperAgents: ['sheet-parser', 'normalizer', 'export-builder'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'spreadsheet_artifacts'
        }
      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) throw error;
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, { kind: 'spreadsheet', pluginId: PLUGIN_ID })) return false;

  if (!session.claimedByPluginId) {
    await api(`/connectors/sessions/${session.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ pluginId: PLUGIN_ID })
    });
  }

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Parsing spreadsheet input',
      detail: 'Reading the pasted sheet, inferring the delimiter, and normalizing the raw structure for cleanup.',
      state: 'parsing'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Cleaning and deduplicating rows',
      detail: 'Applying header normalization, trimming values, dropping blank rows, and deduplicating repeated records.',
      state: 'cleaning'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Writing export artifacts',
      detail: 'Saving the cleaned export and cleanup report into durable artifacts for this session.',
      state: 'packaging'
    })
  });

  await api(`/connectors/sessions/${session.id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...buildFulfillment(session)
    })
  });
  console.log(`[local-spreadsheet-plugin] fulfilled ${session.id}`);
  return true;
}

async function tick() {
  const { sessions } = await api('/connectors/sessions');
  let processed = 0;
  for (const session of sessions) {
    try {
      const changed = await processSession(session);
      if (changed) processed += 1;
    } catch (error) {
      if (String(error.message).includes('session_claimed_by_other_plugin')) continue;
      console.error(`[local-spreadsheet-plugin] session ${session.id} failed: ${error.message}`);
    }
  }
  return processed;
}

async function main() {
  if (!API_KEY) {
    throw new Error('missing_plugin_api_key');
  }
  await ensurePluginRegistration();
  if (RUN_ONCE) {
    await tick();
    return;
  }
  console.log(`[local-spreadsheet-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-spreadsheet-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-spreadsheet-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
