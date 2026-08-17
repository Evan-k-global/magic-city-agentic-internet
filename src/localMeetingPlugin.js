import { writeExecutionArtifact } from './executionArtifacts.js';
import { buildMeetingPackage } from './knowledgeWorkExecution.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_MEETING_PLUGIN_ID || 'local-meeting-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_MEETING_PLUGIN_OWNER || 'meeting-package-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const RUN_ONCE = process.argv.includes('--once');

function escapeIcsText(value = '') {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildMeetingFollowUpIcs({ title, description, attendees = [] }) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setUTCHours(16, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const attendeeLines = attendees
    .filter(Boolean)
    .map((email) => `ATTENDEE;CN=${escapeIcsText(email)}:mailto:${email}`)
    .join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Magic City//Meeting Workflow//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}-magic-city-meeting@magic.city`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    attendeeLines,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\n');
}

function buildContactVcard(email = '') {
  const normalized = String(email || '').trim().toLowerCase();
  const localName = normalized.split('@')[0] || normalized || 'participant';
  const displayName = localName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || normalized;
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    `EMAIL;TYPE=INTERNET:${normalized}`,
    'END:VCARD'
  ].join('\n');
}

function buildGoogleCalendarDraftUrl({ title, description, attendees = [] }) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description,
    dates: `${formatIcsDate(start)}/${formatIcsDate(end)}`
  });
  if (attendees.length) params.set('add', attendees.join(','));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildMailtoUrl({ attendees = [], subject, body }) {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  return `mailto:${encodeURIComponent(attendees.join(','))}?${params.toString()}`;
}

function buildGitHubHandoffBrief({
  meetingType,
  audience,
  urgency,
  repoFullName,
  summaryBullets = [],
  actionItems = [],
  decisions = []
}) {
  return [
    '# GitHub handoff brief',
    '',
    `- Repo: ${repoFullName || 'No repo specified yet'}`,
    `- Meeting type: ${meetingType}`,
    `- Audience: ${audience}`,
    `- Urgency: ${urgency}`,
    '',
    '## Summary',
    ...(summaryBullets.length ? summaryBullets.map((item) => `- ${item}`) : ['- No summary bullets captured yet.']),
    '',
    '## Proposed follow-through',
    ...(actionItems.length ? actionItems.map((item) => `- [ ] ${item}`) : ['- [ ] Review the meeting notes and create the next issue or PR task.']),
    '',
    '## Decisions',
    ...(decisions.length ? decisions.map((item) => `- ${item}`) : ['- No explicit decisions were detected.']),
    '',
    '## Suggested GitHub next step',
    repoFullName
      ? `Create or update an issue/PR handoff in ${repoFullName} with the action checklist above.`
      : 'Add a repo target in the execution sheet if you want Magic City to aim this at a specific GitHub repo.'
  ].join('\n');
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

function formatMeetingWorkflowError(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) {
    return 'Magic City could not complete the meeting workflow right now. Retry in a moment, or keep using the exported artifacts for now.';
  }
  if (/network_request_failed|failed to fetch|networkerror|network request failed|load failed|non_json_response|invalid_json|http_502|http_503|http_504/i.test(raw)) {
    return 'Magic City could not reach the meeting workflow or sync bridge right now. Retry in a moment, or keep using the exported artifacts for now.';
  }
  if (/google calendar|google agent access|calendar events are disabled|calendar permission|review-gated/i.test(raw)) {
    return raw;
  }
  if (/^[a-z0-9_:/.-]+$/i.test(raw) && !raw.includes(' ')) {
    return raw.replace(/[:/.-]+/g, ' ').replace(/_/g, ' ').trim();
  }
  return raw;
}

async function buildFulfillment(session) {
  const selections = session.finalSelections || session.selections || {};
  const fundingMode = String(session.paymentOrchestration?.fundingMode || selections.paymentFundingMode || 'magic_city_credits');
  const previewOnly = fundingMode === 'free_preview';
  const participantEmails = String(session.localPrivateContext?.participantEmails || selections.participantEmails || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const syncTarget = previewOnly ? 'Artifacts only' : (selections.syncTarget || 'Google workspace follow-through');
  const workflowTarget = syncTarget;
  const wantsGoogleSync = /google/i.test(syncTarget);
  const wantsGitHubHandoff = /github/i.test(syncTarget);
  const githubRepo = String(session.localPrivateContext?.githubRepo || selections.githubRepo || '').trim();
  const meetingPackage = buildMeetingPackage({
    transcript: session.localPrivateContext?.transcript || selections.transcript || '',
    meetingType: selections.meetingType || 'team meeting',
    outputPackage: selections.outputPackage || 'Summary only',
    audience: selections.audience || 'team',
    urgency: selections.urgency || 'standard'
  });
  const summaryArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'meeting',
    label: 'meeting-summary',
    extension: 'md',
    content: meetingPackage.outputs.summary
  });
  const artifacts = [
    { label: 'Meeting summary', url: summaryArtifact.url, sha256: summaryArtifact.sha256 }
  ];
  if (meetingPackage.deliverables.includes('actions')) {
    const actionArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'meeting',
      label: previewOnly ? 'meeting-action-preview' : 'meeting-actions',
      extension: 'md',
      content: meetingPackage.outputs.actions
    });
    artifacts.push({ label: previewOnly ? 'Action preview' : 'Action items', url: actionArtifact.url, sha256: actionArtifact.sha256 });
  }
  if (!previewOnly && meetingPackage.deliverables.includes('decisions')) {
    const decisionArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'meeting',
      label: 'meeting-decisions',
      extension: 'md',
      content: meetingPackage.outputs.decisions
    });
    artifacts.push({ label: 'Decisions', url: decisionArtifact.url, sha256: decisionArtifact.sha256 });
  }
  if (!previewOnly && meetingPackage.deliverables.includes('followUpEmail')) {
    const followUpArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'meeting',
      label: 'follow-up-email',
      extension: 'md',
      content: meetingPackage.outputs.followUpEmail
    });
    artifacts.push({ label: 'Follow-up email', url: followUpArtifact.url, sha256: followUpArtifact.sha256 });
  }
  if (!previewOnly && wantsGitHubHandoff) {
    const githubHandoffArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'meeting',
      label: 'github-handoff-brief',
      extension: 'md',
      content: buildGitHubHandoffBrief({
        meetingType: selections.meetingType || 'team meeting',
        audience: selections.audience || 'team',
        urgency: selections.urgency || 'standard',
        repoFullName: githubRepo,
        summaryBullets: meetingPackage.summaryBullets,
        actionItems: meetingPackage.actionItems,
        decisions: meetingPackage.decisions
      })
    });
    artifacts.push({ label: 'GitHub handoff brief', url: githubHandoffArtifact.url, sha256: githubHandoffArtifact.sha256 });
  }
  const followUpTitle = `Follow up on ${selections.meetingType || 'meeting'}`;
  const followUpDescription = [
    `Audience: ${selections.audience || 'team'}`,
    '',
    ...meetingPackage.summaryBullets.map((item) => `- ${item}`),
    '',
    'Action items:',
    ...(meetingPackage.actionItems.length ? meetingPackage.actionItems.map((item) => `- ${item}`) : ['- No explicit action items detected.'])
  ].join('\n');
  let calendarArtifact = null;
  if (!previewOnly) {
    calendarArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'meeting',
      label: 'meeting-follow-up',
      extension: 'ics',
      content: buildMeetingFollowUpIcs({
        title: followUpTitle,
        description: followUpDescription,
        attendees: participantEmails
      })
    });
    artifacts.push({ label: 'Calendar follow-up', url: calendarArtifact.url, sha256: calendarArtifact.sha256 });
    if (participantEmails.length) {
      const contactsArtifact = writeExecutionArtifact({
        sessionId: session.id,
        lane: 'meeting',
        label: 'meeting-contacts',
        extension: 'vcf',
        content: participantEmails.map((email) => buildContactVcard(email)).join('\n')
      });
      artifacts.push({ label: 'Participant contacts', url: contactsArtifact.url, sha256: contactsArtifact.sha256 });
    }
  }
  const googleCalendarUrl = buildGoogleCalendarDraftUrl({
    title: followUpTitle,
    description: followUpDescription,
    attendees: participantEmails
  });
  const followUpMailtoUrl = participantEmails.length
    ? buildMailtoUrl({
        attendees: participantEmails,
        subject: `Follow-up: ${selections.meetingType || 'meeting'}`,
        body: meetingPackage.outputs.followUpEmail
      })
    : null;
  const googleSync = previewOnly ? null : await maybeSyncMeetingToGoogle(session, {
    syncTarget,
    meetingType: selections.meetingType || 'team meeting',
    audience: selections.audience || 'team',
    participantEmails,
    summaryBullets: meetingPackage.summaryBullets,
    actionItems: meetingPackage.actionItems,
    followUpEmail: meetingPackage.outputs.followUpEmail
  });
  const completionState = previewOnly
    ? 'ready_for_review'
    : wantsGoogleSync
      ? (googleSync?.synced ? 'completed' : 'needs_user_confirmation')
      : 'completed';
  const nextHumanAction = previewOnly
    ? 'Review the free preview now, then switch to credits when you want follow-up automation and sync bridges.'
    : wantsGoogleSync
      ? (googleSync?.synced
          ? 'Google follow-up actions were created. Review the calendar event and Gmail draft if you want to send immediately.'
          : googleSync?.error
            ? `Google sync needs your review first: ${String(googleSync.error).replace(/_/g, ' ')}.`
            : wantsGitHubHandoff
              ? 'Open the Google draft or calendar event, then use the GitHub handoff brief to continue the engineering follow-through.'
              : 'Open the Google Calendar draft or email draft to finalize the follow-up quickly.')
      : syncTarget === 'Calendar + contact exports'
        ? 'Open the calendar and contact exports to import them into your preferred tools.'
        : wantsGitHubHandoff
          ? (githubRepo
              ? `Open the GitHub handoff brief and use it to continue the work in ${githubRepo}.`
              : 'Open the GitHub handoff brief and add the target repo before continuing the follow-through.')
        : 'Review the meeting artifacts and send the follow-up if you want to use it as-is.';
  return {
    status: 'fulfilled',
    result: buildExecutionResult({
      session,
      completionState,
      nextHumanAction,
      artifacts,
      extraResult: {
        previewOnly,
        fundingMode,
        summaryBullets: meetingPackage.summaryBullets,
        actionItems: meetingPackage.actionItems,
        decisions: meetingPackage.decisions,
        meetingType: selections.meetingType || 'team meeting',
        outputPackage: selections.outputPackage || 'Summary only',
        audience: selections.audience || 'team',
        urgency: selections.urgency || 'standard',
        syncTarget,
        workflowTarget,
        githubRepo,
        githubHandoffReady: wantsGitHubHandoff,
        participantEmails,
        transcriptLength: meetingPackage.transcriptLength,
        estimatedMinutes: meetingPackage.estimatedMinutes,
        syncLinks: previewOnly
          ? {}
          : wantsGoogleSync
            ? {
              googleCalendarUrl: googleSync?.calendarHtmlLink || googleCalendarUrl,
              followUpMailtoUrl: googleSync?.gmailDraftUrl || followUpMailtoUrl,
              contactsImportUrl: googleSync?.contactsCreated ? 'https://contacts.google.com/' : (participantEmails.length ? 'https://contacts.google.com/' : null)
            }
            : {},
        googleSync
      }
    }),
    handoff: {
      label: previewOnly
        ? 'Open meeting preview'
        : wantsGitHubHandoff && !wantsGoogleSync
          ? 'Open GitHub handoff brief'
        : syncTarget === 'Artifacts only'
          ? 'Open meeting summary'
          : (googleSync?.synced ? 'Open Google follow-up' : 'Open follow-up draft'),
      url: previewOnly
        ? summaryArtifact.url
        : wantsGitHubHandoff && !wantsGoogleSync
          ? (artifacts.find((artifact) => /github handoff/i.test(artifact.label || ''))?.url || summaryArtifact.url)
        : syncTarget === 'Artifacts only'
          ? summaryArtifact.url
          : (googleSync?.calendarHtmlLink || googleCalendarUrl)
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)}${previewOnly ? ' Free preview generated.' : googleSync?.synced ? ` Google sync completed for ${googleSync.connectedEmail || 'connected account'}.` : googleSync?.error ? ` Google sync not completed: ${googleSync.error}.` : ''}${wantsGitHubHandoff ? ` GitHub handoff brief${githubRepo ? ` prepared for ${githubRepo}` : ' prepared'}.` : ''} Prepared by ${PLUGIN_ID} for ${session.handoffData?.title || 'meeting workflow'}.`,
    proofRef: `${PLUGIN_ID}:${session.id}`
  };
}

async function maybeSyncMeetingToGoogle(session, payload) {
  const syncTarget = String(payload?.syncTarget || '');
  if (!/google/i.test(syncTarget)) return null;
  try {
    const data = await api('/connectors/google/sync/meeting', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        meeting: {
          syncTarget,
          meetingType: payload.meetingType,
          audience: payload.audience,
          participantEmails: payload.participantEmails,
          summaryBullets: payload.summaryBullets,
          actionItems: payload.actionItems,
          followUpEmail: payload.followUpEmail
        }
      })
    });
    return data.sync || null;
  } catch (error) {
    return {
      synced: false,
      error: formatMeetingWorkflowError(error)
    };
  }
}

async function markSessionFailed(session, error) {
  const message = formatMeetingWorkflowError(error);
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
        label: 'Meeting workflow failed',
        detail: message,
        state: 'failed'
      })
    }).catch(() => null);
    await api(`/connectors/sessions/${session.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        status: 'failed',
        notes: `Meeting workflow failed before the follow-through package could complete. ${message}`.trim(),
        fundingDisposition: 'release',
        result: {
          completionState: 'failed',
          nextHumanAction: 'Review the transcript inputs, then retry or keep using the exported meeting artifacts.',
          error: message
        },
        handoff: {}
      })
    }).catch(() => null);
  } catch {
    // if this fallback also fails, keep the original worker error in logs
  }
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        ownerAgentId: OWNER_AGENT_ID,
        kind: 'meeting',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['meeting-package-agent', 'meeting.generate_follow_up'],
        tools: ['meeting.parse_transcript', 'meeting.extract_actions', 'meeting.generate_follow_up'],
        privacyModes: ['private'],
        helperAgents: ['transcript-parser', 'action-extractor', 'follow-up-drafter'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'meeting_workflow'
        }
      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) throw error;
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, { kind: 'meeting', pluginId: PLUGIN_ID })) return false;

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
      label: 'Parsing transcript',
      detail: 'Reading the transcript or notes and extracting the most important blocks of the conversation.',
      state: 'parsing'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Extracting summary and actions',
      detail: 'Turning the meeting into summary bullets, action items, decisions, and follow-through content.',
      state: 'synthesizing'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Writing workflow artifacts',
      detail: 'Saving the meeting workflow into durable artifacts and connector-aware follow-through outputs.',
      state: 'packaging'
    })
  });

  await api(`/connectors/sessions/${session.id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...(await buildFulfillment(session))
    })
  });
  console.log(`[local-meeting-plugin] fulfilled ${session.id}`);
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
      await markSessionFailed(session, error);
      console.error(`[local-meeting-plugin] session ${session.id} failed: ${error.message}`);
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
  console.log(`[local-meeting-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-meeting-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-meeting-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
