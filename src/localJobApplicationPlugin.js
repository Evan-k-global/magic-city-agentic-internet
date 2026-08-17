import crypto from 'node:crypto';
import { writeExecutionArtifact } from './executionArtifacts.js';
import { buildJobApplicationPackage } from './knowledgeWorkExecution.js';
import { runJobApplicationExecutionInBrowser } from './browserExecution.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';
import {
  JOB_APPLICATION_MODE_PLAN,
  buildJobApplyMethod,
  buildJobBundleStatementKind,
  buildJobEntryStatementKind,
  buildJobProofReceiptKind,
  describeJobApplicationMode,
  describeJobApplicationModeLower,
  describeJobConfirmationState,
  describeJobLedgerStatus,
  normalizeJobApplicationMode,
  summarizeJobLedger
} from './jobApplicationModels.js';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_JOB_PLUGIN_ID || 'local-job-application-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_JOB_PLUGIN_OWNER || 'job-application-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const JOB_BROWSER_TIMEOUT_MS = Math.max(10000, Number(process.env.MAGIC_CITY_JOB_BROWSER_TIMEOUT_MS ?? 60000));
const RUN_ONCE = process.argv.includes('--once');

function hashHex(input) {
  return `0x${crypto.createHash('sha256').update(String(input || '')).digest('hex')}`;
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

function formatJobWorkflowError(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) {
    return 'Magic City could not complete the job application workflow right now. Retry in a moment.';
  }
  if (/job_browser_timeout_/i.test(raw)) {
    return 'The application browser worker took too long. Retry, narrow the scope, or let Your Agent continue the ATS tail.';
  }
  if (/browser_launch_failed|browser_plan_launch_failed|browser_adapter_unavailable|browser_plan_unavailable/i.test(raw)) {
    return 'The application browser runtime is unavailable right now. Retry in a moment or use Your Agent for the ATS/browser tail.';
  }
  if (/network_request_failed|failed to fetch|networkerror|network request failed|load failed|non_json_response|invalid_json|http_502|http_503|http_504/i.test(raw)) {
    return 'Magic City could not reach the application browser worker right now. Retry in a moment.';
  }
  if (/auth_required/i.test(raw)) {
    return 'Sign in first, then retry the application workflow.';
  }
  if (/insufficient_credits/i.test(raw)) {
    return 'Not enough credits are available for this application workflow. Add credits, then retry.';
  }
  if (/^[a-z0-9_:/.-]+$/i.test(raw) && !raw.includes(' ')) {
    return raw.replace(/[:/.-]+/g, ' ').replace(/_/g, ' ').trim();
  }
  return raw;
}

function buildJobLedgerProof({ session, jobMode, row, sequence }) {
  const statementKind = buildJobEntryStatementKind({ jobMode, status: row.status });
  const envelopeMaterial = {
    sessionId: session.id,
    sequence,
    board: row.board || null,
    atsProvider: row.atsProvider || null,
    label: row.label || null,
    jobTitle: row.jobTitle || null,
    searchUrl: row.searchUrl || null,
    jobUrl: row.jobUrl || null,
    status: row.status || null,
    executionOwner: row.executionOwner || null,
    previewArtifactSha256: row.previewArtifact?.sha256 || null,
    observedAt: row.observedAt || null,
    filledFields: Array.isArray(row.filledFields) ? row.filledFields : [],
    requiredCount: Number(row.requiredCount || 0) || 0,
    resumeUploaded: Boolean(row.resumeUploaded)
  };
  return {
    schema: 'magic-city-zktls-job-receipt-v1',
    sponsored: true,
    sponsor: 'magic-city',
    queue: 'background',
    receiptKind: buildJobProofReceiptKind({ jobMode, status: row.status }),
    statementKind,
    visibility: 'hashes_only',
    envelopeHash: hashHex(JSON.stringify(envelopeMaterial)),
    zekoAttestation: {
      mode: 'background_sponsored',
      network: 'zeko:testnet',
      status: 'queued_via_session_receipt',
      statementKind
    }
  };
}

function buildJobLedger(session, packageData, execution) {
  const jobMode = normalizeJobApplicationMode(execution.jobMode);
  const applications = Array.isArray(execution.applications) ? execution.applications : [];
  return applications.map((row, index) => {
    const proof = buildJobLedgerProof({
      session,
      jobMode,
      row,
      sequence: index + 1
    });
    const status = String(row.status || (jobMode === JOB_APPLICATION_MODE_PLAN ? 'research_ready' : 'prepared_for_review')).trim().toLowerCase();
    const nextHumanAction = String(row.nextHumanAction || '').trim() || (
      status === 'submitted'
        ? 'Track the ATS status and keep the follow-up package handy for replies or interview loops.'
        : status === 'prepared_for_agent'
          ? 'Let Your Agent continue from this ATS surface, or open the prepared page yourself if you want to finish the last-mile steps manually.'
          : status === 'prepared_for_review'
            ? 'Open the prepared ATS page and finish the final submit step if the site still needs you.'
            : status === 'blocked'
              ? 'Open the ATS page directly, unblock the gate, or switch the run over to Your Agent.'
              : jobMode === JOB_APPLICATION_MODE_PLAN
                ? 'Review this role in the plan and promote it into an application run if it fits.'
                : 'Review this role manually before trying another run.'
    );
    return {
      id: `job-${index + 1}`,
      sequence: index + 1,
      board: row.board || '',
      boardLabel: row.label || row.board || 'Job board',
      atsProvider: row.atsProvider || row.board || '',
      atsLabel: row.atsLabel || row.label || row.board || 'ATS',
      executionOwner: row.executionOwner || 'magic_city_worker',
      executionOwnerLabel: row.executionOwnerLabel || 'Magic City execution worker',
      jobTitle: row.jobTitle || `${packageData.searchRole} opening`,
      searchUrl: row.searchUrl || null,
      jobUrl: row.jobUrl || null,
      applicationUrl: row.applicationUrl || null,
      manualTakeoverUrl: row.manualTakeoverUrl || row.applicationUrl || row.jobUrl || row.searchUrl || null,
      manualTakeoverLabel: row.manualTakeoverLabel || null,
      manualTakeoverReason: row.manualTakeoverReason || null,
      status,
      statusLabel: describeJobLedgerStatus(status),
      confirmationState: String(row.confirmationState || '').trim().toLowerCase() || (status === 'submitted' ? 'submitted_pending_verification' : status === 'prepared_for_agent' ? 'handoff_ready' : status === 'blocked' ? 'blocked' : 'prepared'),
      confirmationLabel: row.confirmationLabel || describeJobConfirmationState(
        String(row.confirmationState || '').trim().toLowerCase() || (status === 'submitted' ? 'submitted_pending_verification' : status === 'prepared_for_agent' ? 'handoff_ready' : status === 'blocked' ? 'blocked' : 'prepared')
      ),
      applyMethod: buildJobApplyMethod({ jobMode, status }),
      requiredCount: Number(row.requiredCount || 0) || 0,
      unansweredRequiredCount: Number(row.unansweredRequiredCount || 0) || 0,
      filledFields: Array.isArray(row.filledFields) ? row.filledFields : [],
      resumeUploaded: Boolean(row.resumeUploaded),
      submissionEvidence: row.submissionEvidence || null,
      currentPageTitle: row.currentPageTitle || null,
      observedAt: row.observedAt || null,
      previewArtifact: row.previewArtifact || null,
      nextHumanAction,
      proof
    };
  });
}

function buildJobProofManifest({ session, packageData, execution, jobLedger }) {
  const jobMode = normalizeJobApplicationMode(execution.jobMode);
  const counts = {
    ...summarizeJobLedger(jobLedger),
    requested: Number(packageData.applicationLimit || 0) || 0
  };
  const statementKind = buildJobBundleStatementKind({ jobMode, jobLedger });
  const entries = jobLedger.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    board: row.board,
    atsProvider: row.atsProvider,
    status: row.status,
    executionOwner: row.executionOwner,
    jobTitle: row.jobTitle,
    statementKind: row.proof.statementKind,
    receiptKind: row.proof.receiptKind,
    envelopeHash: row.proof.envelopeHash,
    queue: row.proof.queue,
    zekoAttestation: row.proof.zekoAttestation
  }));
  const ledgerHash = hashHex(JSON.stringify(entries));
  const bundleHash = hashHex(JSON.stringify({
    statementKind,
    counts,
    entries
  }));
  return {
    schema: 'magic-city-job-proof-manifest-v1',
    lane: 'job',
    jobMode,
    sponsored: true,
    sponsor: 'magic-city',
    receiptSchema: 'magic-city-zktls-job-receipt-v1',
    statementKind,
    ledgerHash,
    bundleHash,
    counts,
    boards: packageData.jobBoards,
    zekoAttestation: {
      mode: 'background_sponsored',
      network: 'zeko:testnet',
      status: 'queued_after_receipt_commitment',
      statementKind
    },
    entries
  };
}

function buildJobArtifacts(session, execution) {
  const selections = session.finalSelections || session.selections || {};
  const localPrivate = session.localPrivateContext || {};
  const jobMode = normalizeJobApplicationMode(execution.jobMode);
  const packageData = buildJobApplicationPackage({
    resumeText: localPrivate.resumeText || '',
    targetRole: selections.targetRole || session.localContext?.targetRole || '',
    locationPreference: selections.locationPreference || session.localContext?.locationPreference || '',
    companyTargets: selections.companyTargets || '',
    jobBoards: selections.jobBoards || session.localContext?.jobBoards || '',
    submissionMode: execution.submissionMode || selections.submissionMode || session.localContext?.submissionMode || 'review_before_submit',
    applicationLimit: selections.applicationLimit || session.localContext?.applicationLimit || '3',
    coverLetterNotes: localPrivate.coverLetterNotes || '',
    applicantName: localPrivate.applicantName || '',
    applicantEmail: localPrivate.applicantEmail || '',
    applicantPhone: localPrivate.applicantPhone || '',
    linkedinUrl: localPrivate.linkedinUrl || '',
    portfolioUrl: localPrivate.portfolioUrl || ''
  });
  const applications = Array.isArray(execution.applications) ? execution.applications : [];
  const jobLedger = buildJobLedger(session, packageData, execution);
  const proofManifest = buildJobProofManifest({ session, packageData, execution, jobLedger });
  const shippedCount = jobLedger.filter((row) => row.status === 'submitted').length;
  const preparedCount = jobLedger.filter((row) => ['prepared_for_review', 'prepared_for_agent'].includes(row.status)).length;
  const agentPreparedCount = jobLedger.filter((row) => row.status === 'prepared_for_agent').length;
  const researchedCount = jobLedger.filter((row) => row.status === 'research_ready').length;
  const report = [
    `# ${describeJobApplicationMode(jobMode)}`,
    '',
    `- Role: ${packageData.searchRole}`,
    `- Location: ${packageData.searchLocation}`,
    `- Boards: ${packageData.jobBoards.join(', ')}`,
    `- Workflow: ${describeJobApplicationModeLower(jobMode)}`,
    `- Submission mode: ${execution.submissionMode}`,
    `- Applications submitted: ${shippedCount}`,
    `- Applications prepared for checkout: ${preparedCount}`,
    `- Applications prepared for Your Agent: ${agentPreparedCount}`,
    `- Applications researched: ${researchedCount}`,
    '',
    '## Ledger',
    ...(jobLedger.length
      ? jobLedger.map((row) => `- ${row.sequence}. ${row.atsLabel || row.boardLabel}: ${row.jobTitle || 'candidate opening'} · ${row.statusLabel} · ${row.confirmationLabel} · ${row.applyMethod} · ${row.executionOwnerLabel}${row.jobUrl ? ` · ${row.jobUrl}` : row.searchUrl ? ` · ${row.searchUrl}` : ''}`)
      : ['- No application targets were prepared.'])
  ].join('\n');
  const summaryArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'job',
    label: 'application-summary',
    extension: 'md',
    content: report
  });
  const ledgerArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'job',
    label: 'application-ledger-export',
    extension: 'json',
    content: JSON.stringify(jobLedger, null, 2)
  });
  const proofManifestArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'job',
    label: 'job-proof-manifest-export',
    extension: 'json',
    content: JSON.stringify(proofManifest, null, 2)
  });
  return {
    packageData,
    applications,
    jobMode,
    jobLedger,
    proofManifest,
    shippedCount,
    preparedCount,
    agentPreparedCount,
    researchedCount,
    artifacts: [
      { label: 'Application summary', url: summaryArtifact.url, sha256: summaryArtifact.sha256 },
      { label: 'Application ledger export', url: ledgerArtifact.url, sha256: ledgerArtifact.sha256 },
      { label: 'Job proof manifest export', url: proofManifestArtifact.url, sha256: proofManifestArtifact.sha256 },
      ...applications
        .filter((row) => row.previewArtifact?.url)
        .slice(0, 3)
        .map((row, index) => ({
          label: `${row.label} preview ${index + 1}`,
          url: row.previewArtifact.url,
          sha256: row.previewArtifact.sha256
        }))
    ]
  };
}

async function buildFulfillment(session) {
  const selections = session.finalSelections || session.selections || {};
  const jobMode = normalizeJobApplicationMode(selections.jobMode || session.localContext?.jobMode || JOB_APPLICATION_MODE_PLAN);
  const fundingMode = selections.paymentFundingMode || 'free_preview';
  const submissionMode = fundingMode === 'free_preview'
    ? 'review_before_submit'
    : jobMode === JOB_APPLICATION_MODE_PLAN
      ? 'review_before_submit'
    : (selections.submissionMode || session.localContext?.submissionMode || 'review_before_submit');

  const browserExecution = await Promise.race([
    runJobApplicationExecutionInBrowser(session, {
      onProgress: async ({ label, detail, state, browser }) => {
        await api(`/connectors/sessions/${session.id}/checkpoint`, {
          method: 'POST',
          body: JSON.stringify({
            pluginId: PLUGIN_ID,
            label,
            detail,
            state,
            browser
          })
        });
      }
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`job_browser_timeout_${JOB_BROWSER_TIMEOUT_MS}ms`)), JOB_BROWSER_TIMEOUT_MS);
    })
  ]);

  const execution = {
    ...browserExecution,
    submissionMode,
    jobMode
  };
  const { packageData, applications, jobLedger, proofManifest, shippedCount, preparedCount, agentPreparedCount, researchedCount, artifacts } = buildJobArtifacts(session, execution);
  const completionState = jobMode === JOB_APPLICATION_MODE_PLAN
    ? 'completed'
    : shippedCount > 0
      ? 'completed'
      : 'ready_for_review';
  const nextHumanAction = jobMode === JOB_APPLICATION_MODE_PLAN
    ? 'Review the researched roles, pick the best fits, and switch this session into Application run when you want Magic City to start applying.'
    : shippedCount > 0
      ? 'Review the shipped applications and keep using the summary/report for follow-through.'
      : agentPreparedCount > 0
        ? `Let ${session.personalAgentProfile?.name || 'Your Agent'} continue the prepared ATS flows, or open the prepared pages yourself if you want to finish the last-mile steps manually.`
        : 'Review the prepared application pages and finish any site-specific submit step if needed.';

  return {
    status: 'fulfilled',
    result: buildExecutionResult({
      session,
      completionState,
      nextHumanAction,
      artifacts,
      extraResult: {
        targetRole: packageData.searchRole,
        locationPreference: packageData.searchLocation,
        boards: packageData.jobBoards,
        applicationLimit: packageData.applicationLimit,
        submissionMode,
        jobMode,
        executionOwner: execution.executionOwner || 'magic_city_worker',
        executionOwnerLabel: execution.executionOwnerLabel || 'Magic City execution worker',
        jobsResearched: researchedCount,
        jobsPreparedForCheckout: preparedCount,
        jobsSubmitted: shippedCount,
        applicationsShipped: shippedCount,
        applicationsPrepared: jobMode === JOB_APPLICATION_MODE_PLAN ? researchedCount : preparedCount,
        publicProofSummary: {
          applicationsRequested: packageData.publicProofSummary.applicationsRequested,
          applicationsShipped: shippedCount,
          applicationsPrepared: jobMode === JOB_APPLICATION_MODE_PLAN ? researchedCount : preparedCount,
          applicationsPreparedForAgent: agentPreparedCount,
          boardsUsed: packageData.publicProofSummary.boardsUsed,
          verificationScope: 'counts_and_hashes_only',
          statementKind: proofManifest.statementKind,
          bundleHash: proofManifest.bundleHash,
          sponsored: true
        },
        jobLedger,
        jobProof: proofManifest,
        proofArtifactPatch: {
          statementKind: proofManifest.statementKind,
          actor: {
            workflow: 'job_application',
            jobMode,
            boards: packageData.jobBoards,
            executionOwner: execution.executionOwner || 'magic_city_worker',
            applicationsRequested: packageData.applicationLimit,
            applicationsSubmitted: shippedCount,
            applicationsPreparedForCheckout: preparedCount,
            applicationsPreparedForAgent: agentPreparedCount,
            applicationsResearched: researchedCount
          },
          publicInputs: {
            proofType: proofManifest.receiptSchema,
            proofHash: proofManifest.bundleHash
          }
        },
        applications,
        browserExecution: execution
      }
    }),
    handoff: {
      label: 'Open application summary',
      url: artifacts[0]?.url || null
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} ${jobMode === JOB_APPLICATION_MODE_PLAN ? `${researchedCount} role${researchedCount === 1 ? '' : 's'} researched for the plan.` : shippedCount > 0 ? `${shippedCount} application${shippedCount === 1 ? '' : 's'} shipped.` : agentPreparedCount > 0 ? `${agentPreparedCount} ATS flow${agentPreparedCount === 1 ? '' : 's'} prepared for ${session.personalAgentProfile?.name || 'Your Agent'}.` : `${preparedCount} application${preparedCount === 1 ? '' : 's'} prepared for review.`} Prepared by ${PLUGIN_ID} for ${session.handoffData?.title || describeJobApplicationMode(jobMode)}.`,
    proofRef: `${PLUGIN_ID}:${session.id}:${proofManifest.statementKind}`
  };
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        ownerAgentId: OWNER_AGENT_ID,
        kind: 'job',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['job-application-agent', 'jobs.prepare_applications'],
        tools: ['jobs.parse_resume', 'jobs.search_roles', 'jobs.prepare_applications'],
        privacyModes: ['private'],
        helperAgents: ['resume-parser', 'job-searcher', 'application-runner'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'browser_job_application'
        }
      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) throw error;
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, { kind: 'job', pluginId: PLUGIN_ID })) return false;

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
      label: 'Parsing resume package',
      detail: 'Reading the locally provided resume text, extracting applicant contact hints, and shaping the job search package.',
      state: 'parsing_resume'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Searching application targets',
      detail: 'Opening the selected job boards and finding matching roles that fit the requested job search.',
      state: 'searching_jobs'
    })
  });

  const fulfillment = await buildFulfillment(session);
  await api(`/connectors/sessions/${session.id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...fulfillment
    })
  });
  console.log(`[local-job-application-plugin] fulfilled ${session.id}`);
  return true;
}

async function markSessionFailed(session, error) {
  const message = formatJobWorkflowError(error);
  const jobMode = normalizeJobApplicationMode(session?.localContext?.jobMode || JOB_APPLICATION_MODE_PLAN);
  const workflowLabel = describeJobApplicationModeLower(jobMode);
  try {
    if (!session?.claimedByPluginId) {
      await api(`/connectors/sessions/${session.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ pluginId: PLUGIN_ID })
      }).catch(() => null);
    }
    await api(`/connectors/sessions/${session.id}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        label: 'Job execution failed',
        detail: message,
        state: 'failed'
      })
    }).catch(() => null);
    await api(`/connectors/sessions/${session.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        status: 'failed',
        notes: `Job execution failed before the ${workflowLabel} could complete. ${message}`.trim(),
        fundingDisposition: 'release',
        result: {
          completionState: 'failed',
          nextHumanAction: 'Review the session details, then retry or adjust the target boards, role, or resume inputs.',
          error: message
        },
        handoff: {}
      })
    }).catch(() => null);
  } catch {
    // if this fallback also fails, keep the original worker error in logs
  }
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
      await markSessionFailed(session, error);
      console.error(`[local-job-application-plugin] session ${session.id} failed: ${error.message}`);
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
  console.log(`[local-job-application-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-job-application-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-job-application-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
