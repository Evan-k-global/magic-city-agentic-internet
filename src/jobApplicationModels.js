export const JOB_APPLICATION_MODE_PLAN = 'application_plan';
export const JOB_APPLICATION_MODE_RUN = 'application_run';

export function normalizeJobApplicationMode(value = '') {
  return String(value || '').trim().toLowerCase() === JOB_APPLICATION_MODE_RUN
    ? JOB_APPLICATION_MODE_RUN
    : JOB_APPLICATION_MODE_PLAN;
}

export function describeJobApplicationMode(value = '') {
  return normalizeJobApplicationMode(value) === JOB_APPLICATION_MODE_RUN
    ? 'Application run'
    : 'Application plan';
}

export function describeJobApplicationModeLower(value = '') {
  return normalizeJobApplicationMode(value) === JOB_APPLICATION_MODE_RUN
    ? 'application run'
    : 'application plan';
}

export function describeJobLedgerStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'submitted') return 'Submitted';
  if (normalized === 'prepared_for_review') return 'Prepared for checkout';
  if (normalized === 'prepared_for_agent') return 'Prepared for your agent';
  if (normalized === 'research_ready') return 'Researched';
  if (normalized === 'no_matches_found') return 'No matches';
  if (normalized === 'browser_adapter_unavailable') return 'Browser unavailable';
  if (normalized === 'blocked') return 'Blocked';
  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Pending';
}

export function describeJobConfirmationState(state = '') {
  const normalized = String(state || '').trim().toLowerCase();
  if (normalized === 'confirmed') return 'Submission confirmed';
  if (normalized === 'submitted_pending_verification') return 'Submitted, confirming receipt';
  if (normalized === 'handoff_ready') return 'Ready for local agent handoff';
  if (normalized === 'login_required') return 'Sign-in required';
  if (normalized === 'resume_required') return 'Resume upload needed';
  if (normalized === 'additional_questions_required') return 'More required answers needed';
  if (normalized === 'job_closed') return 'Role no longer accepting applications';
  if (normalized === 'prepared') return 'Prepared for review';
  if (normalized === 'no_match') return 'No clear listing found';
  if (normalized === 'blocked') return 'Blocked by the ATS';
  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Pending';
}

export function buildJobEntryStatementKind({ jobMode = JOB_APPLICATION_MODE_PLAN, status = '' } = {}) {
  const normalizedMode = normalizeJobApplicationMode(jobMode);
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedMode === JOB_APPLICATION_MODE_PLAN) {
    return normalizedStatus === 'no_matches_found'
      ? 'job_application:plan_no_match'
      : 'job_application:plan_candidate';
  }
  if (normalizedStatus === 'submitted') return 'job_application:submitted';
  if (normalizedStatus === 'prepared_for_review') return 'job_application:prepared_checkout';
  if (normalizedStatus === 'prepared_for_agent') return 'job_application:prepared_agent_handoff';
  if (normalizedStatus === 'no_matches_found') return 'job_application:no_match';
  if (normalizedStatus === 'blocked') return 'job_application:blocked';
  return 'job_application:run_candidate';
}

export function buildJobBundleStatementKind({ jobMode = JOB_APPLICATION_MODE_PLAN, jobLedger = [] } = {}) {
  const normalizedMode = normalizeJobApplicationMode(jobMode);
  if (normalizedMode === JOB_APPLICATION_MODE_PLAN) return 'job_application:plan_bundle';
  if (jobLedger.some((entry) => String(entry?.status || '').toLowerCase() === 'submitted')) {
    return 'job_application:submission_bundle';
  }
  if (jobLedger.some((entry) => String(entry?.status || '').toLowerCase() === 'prepared_for_agent')) {
    return 'job_application:agent_handoff_bundle';
  }
  if (jobLedger.some((entry) => String(entry?.status || '').toLowerCase() === 'prepared_for_review')) {
    return 'job_application:prepared_bundle';
  }
  return 'job_application:run_bundle';
}

export function buildJobProofReceiptKind({ jobMode = JOB_APPLICATION_MODE_PLAN, status = '' } = {}) {
  const normalizedMode = normalizeJobApplicationMode(jobMode);
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedMode === JOB_APPLICATION_MODE_PLAN) return 'zktls_job_listing_receipt';
  if (normalizedStatus === 'submitted') return 'zktls_job_submission_receipt';
  if (normalizedStatus === 'prepared_for_agent') return 'zktls_job_agent_handoff_receipt';
  if (normalizedStatus === 'prepared_for_review') return 'zktls_job_checkout_prep_receipt';
  if (normalizedStatus === 'no_matches_found') return 'zktls_job_search_receipt';
  return 'zktls_job_execution_receipt';
}

export function buildJobApplyMethod({ jobMode = JOB_APPLICATION_MODE_PLAN, status = '' } = {}) {
  const normalizedMode = normalizeJobApplicationMode(jobMode);
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedMode === JOB_APPLICATION_MODE_PLAN) return 'Research only';
  if (normalizedStatus === 'submitted') return 'Magic City auto-submit';
  if (normalizedStatus === 'prepared_for_agent') return 'Your Agent handoff';
  if (normalizedStatus === 'prepared_for_review') return 'Manual checkout handoff';
  return 'Review only';
}

export function summarizeJobLedger(jobLedger = []) {
  const rows = Array.isArray(jobLedger) ? jobLedger : [];
  return {
    requested: rows.length,
    researched: rows.filter((row) => String(row?.status || '').toLowerCase() === 'research_ready').length,
    preparedForCheckout: rows.filter((row) => String(row?.status || '').toLowerCase() === 'prepared_for_review').length,
    preparedForAgent: rows.filter((row) => String(row?.status || '').toLowerCase() === 'prepared_for_agent').length,
    submitted: rows.filter((row) => String(row?.status || '').toLowerCase() === 'submitted').length,
    noMatches: rows.filter((row) => String(row?.status || '').toLowerCase() === 'no_matches_found').length
  };
}
