import { writeExecutionArtifact } from './executionArtifacts.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_PITCH_PLUGIN_ID || 'local-pitch-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_PITCH_PLUGIN_OWNER || 'pitch-deck-review-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const RUN_ONCE = process.argv.includes('--once');

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

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(text = '') {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractMetaContent(html = '', names = []) {
  for (const name of names) {
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
    const match = String(html || '').match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim();
  }
  return '';
}

async function fetchDocsendMetadata(url = '') {
  const value = String(url || '').trim();
  if (!value) {
    return {
      excerpt: '',
      readMode: 'no_link',
      title: '',
      readSummary: 'No DocSend link supplied; used founder context only.'
    };
  }
  try {
    const response = await fetch(value, {
      headers: {
        'user-agent': 'MagicCityPitchReview/1.0 (+https://magic-city.ai)'
      }
    });
    const html = await response.text();
    const title = extractMetaContent(html, ['og:title', 'twitter:title']) || '';
    const description = extractMetaContent(html, ['description', 'og:description', 'twitter:description']) || '';
    const bodyText = stripHtml(html);
    const blocked = /appear to be a bot|verify you are human|captcha|access denied/i.test(bodyText);
    const excerptParts = [
      title ? `DocSend title: ${title}` : '',
      description ? `DocSend description: ${description}` : '',
      blocked ? 'DocSend served a bot-check shell instead of a readable deck body.' : ''
    ].filter(Boolean);
    return {
      excerpt: excerptParts.join('\n').trim(),
      readMode: blocked ? 'docsend_metadata_only' : 'link_metadata_only',
      title,
      readSummary: blocked
        ? 'DocSend metadata loaded, but the live deck body was bot-blocked so Magic City stayed in metadata-only mode.'
        : 'DocSend metadata loaded. Magic City stayed lightweight and did not claim a full live deck read.'
    };
  } catch {
    return {
      excerpt: '',
      readMode: 'link_metadata_only',
      title: '',
      readSummary: 'Used the DocSend link as metadata-only fallback because the live page could not be fetched reliably.'
    };
  }
}

async function buildPitchReviewSource(session, selections = {}) {
  const docsendUrl = String(selections.docsendUrl || session.localContext?.docsendUrl || '').trim();
  const memoText = String(session.localPrivateContext?.memoText || '').trim();
  const memoFileName = String(session.localPrivateContext?.memoFileName || '').trim();
  const executionOwner = String(selections.executionOwner || session.selections?.executionOwner || '').trim().toLowerCase();
  if (memoText) {
    return {
      docsendUrl,
      excerpt: memoText.slice(0, 2200),
      readMode: memoFileName ? 'uploaded_deck_text' : 'pasted_memo_text',
      readSummary: memoFileName
        ? `Used locally extracted deck text from ${memoFileName}.`
        : 'Used the pasted memo text supplied in the execution sheet.',
      sourceLabel: memoFileName ? `Uploaded deck text (${memoFileName})` : 'Pasted memo text'
    };
  }
  if (docsendUrl && executionOwner === 'your_agent') {
    return {
      docsendUrl,
      excerpt: '',
      readMode: 'your_agent_docsend_handoff',
      readSummary: 'DocSend link prepared for Your Agent. Magic City stayed metadata-light and deferred the live page read.',
      sourceLabel: 'DocSend via Your Agent'
    };
  }
  const metadata = await fetchDocsendMetadata(docsendUrl);
  return {
    docsendUrl,
    excerpt: metadata.excerpt || '',
    readMode: metadata.readMode,
    readSummary: metadata.readSummary,
    sourceLabel: metadata.title ? `DocSend metadata (${metadata.title})` : (docsendUrl ? 'DocSend metadata' : 'Founder context only')
  };
}

function buildPitchReviewPackage({ companyName, fundraisingStage, audience, reviewAsk, docsendUrl, founderContext, investorConcerns, excerpt, readMode, readSummary }) {
  const companyLabel = companyName || 'The company';
  const reviewBasis = readMode === 'uploaded_deck_text'
    ? 'Magic City reviewed locally extracted deck text from the uploaded file.'
    : readMode === 'pasted_memo_text'
      ? 'Magic City reviewed the memo text pasted directly into the execution sheet.'
      : readMode === 'your_agent_docsend_handoff'
        ? `Magic City prepared the DocSend link at ${docsendUrl} for Your Agent to open locally and did not claim a direct live deck read.`
        : docsendUrl
          ? `${readSummary} Founder context was blended in locally.`
          : 'No DocSend link was provided, so this package is based only on the founder context supplied in the execution sheet.';
  const excerptBlock = excerpt
    ? `## Deck excerpt\n\n${excerpt.slice(0, 1600)}\n`
    : '## Deck excerpt\n\nNo stable text excerpt was captured from the live deck during this run.\n';
  const memo = [
    `# ${companyLabel} pitch memo`,
    '',
    `- Stage: ${fundraisingStage}`,
    `- Audience: ${audience}`,
    `- Review ask: ${reviewAsk}`,
    `- Review basis: ${reviewBasis}`,
    '',
    '## What feels strong',
    '- The story has a clearer lane when the problem, wedge, and user are named in the first 2 slides.',
    '- Investors will want tighter proof around why now, why this team, and why this market can compound.',
    '- The strongest version of this deck will connect traction, GTM, and defensibility much more explicitly.',
    '',
    '## What feels weak or missing',
    '- The narrative should compress faster: problem -> product -> proof -> market -> moat -> ask.',
    '- If the deck is heavy on vision, it needs more concrete evidence and sharper milestones.',
    '- If the deck is heavy on product detail, it needs a simpler story for why the company can become large and inevitable.',
    '',
    excerptBlock,
    '## Founder context used',
    founderContext ? founderContext : 'No additional founder context was supplied.',
    '',
    '## Review recommendation',
    `For ${audience.toLowerCase()}, the next pass should focus on ${reviewAsk.toLowerCase()} with tighter narrative compression and clearer proof.`
  ].join('\n');
  const objections = [
    '# Investor questions and objections',
    '',
    '- What is the sharpest wedge and why does it win now?',
    '- Which proof points are already real versus still directional?',
    '- What is the most credible GTM path for the next 12-18 months?',
    '- Why does this become a venture-scale company rather than a strong feature or niche business?',
    investorConcerns ? `- Specific founder concern to address: ${investorConcerns}` : ''
  ].filter(Boolean).join('\n');
  const rewrite = [
    '# Narrative rewrite advice',
    '',
    '1. Open with the user pain and the exact category wedge, not broad market ambition.',
    '2. Show proof earlier: traction, customer pull, or technical edge.',
    '3. Collapse the market section into a believable expansion path.',
    '4. Make the ask concrete: round size, use of funds, and milestone unlocks.',
    '5. End on why this team is structurally advantaged to win.'
  ].join('\n');
  const checklist = [
    '# Next-step checklist',
    '',
    '- Tighten the first 3 slides until the wedge is obvious.',
    '- Add 2-3 proof points that survive investor skepticism.',
    '- Rewrite the GTM slide in plain language.',
    '- Make the fundraise ask specific and milestone-based.',
    '- Run this deck again after the rewrite for another review pass.'
  ].join('\n');
  return { memo, objections, rewrite, checklist, readMode };
}

async function buildFulfillment(session) {
  const selections = session.finalSelections || session.selections || {};
  const fundingMode = String(session.paymentOrchestration?.fundingMode || selections.paymentFundingMode || 'free_preview');
  const previewOnly = fundingMode === 'free_preview';
  const source = await buildPitchReviewSource(session, selections);
  const docsendUrl = source.docsendUrl || '';
  const companyName = String(selections.companyName || session.localContext?.companyName || '').trim();
  const fundraisingStage = String(selections.fundraisingStage || session.localContext?.fundraisingStage || 'Seed').trim();
  const audience = String(selections.audience || session.localContext?.audience || 'Generalist seed investor').trim();
  const reviewAsk = String(selections.reviewAsk || session.localContext?.reviewAsk || 'Full investor memo + objections').trim();
  const founderContext = String(session.localPrivateContext?.founderContext || '').trim();
  const investorConcerns = String(session.localPrivateContext?.investorConcerns || '').trim();
  const review = buildPitchReviewPackage({
    companyName,
    fundraisingStage,
    audience,
    reviewAsk,
    docsendUrl,
    founderContext,
    investorConcerns,
    excerpt: source.excerpt,
    readMode: source.readMode,
    readSummary: source.readSummary
  });
  const memoArtifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'pitch',
    label: previewOnly ? 'pitch-review-preview' : 'pitch-investor-memo',
    extension: 'md',
    content: review.memo
  });
  const artifacts = [
    { label: previewOnly ? 'Pitch review preview' : 'Investor memo', url: memoArtifact.url, sha256: memoArtifact.sha256 }
  ];
  if (!previewOnly) {
    const objectionsArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'pitch',
      label: 'pitch-objections',
      extension: 'md',
      content: review.objections
    });
    const rewriteArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'pitch',
      label: 'pitch-rewrite-advice',
      extension: 'md',
      content: review.rewrite
    });
    const checklistArtifact = writeExecutionArtifact({
      sessionId: session.id,
      lane: 'pitch',
      label: 'pitch-next-steps',
      extension: 'md',
      content: review.checklist
    });
    artifacts.push(
      { label: 'Investor objections', url: objectionsArtifact.url, sha256: objectionsArtifact.sha256 },
      { label: 'Rewrite advice', url: rewriteArtifact.url, sha256: rewriteArtifact.sha256 },
      { label: 'Next-step checklist', url: checklistArtifact.url, sha256: checklistArtifact.sha256 }
    );
  }
  const completionState = previewOnly ? 'ready_for_review' : 'completed';
  const nextHumanAction = previewOnly
    ? 'Review the preview memo now, then switch to 1-credit mode when you want the full investor memo, objections, and rewrite package.'
    : 'Download the review package, tighten the deck, and rerun once you want another pass.';
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
        docsendUrl,
        companyName,
        fundraisingStage,
        audience,
        reviewAsk,
        readMode: source.readMode,
        readSummary: source.readSummary,
        sourceLabel: source.sourceLabel,
        executionOwner: String(selections.executionOwner || session.selections?.executionOwner || '').trim().toLowerCase() === 'your_agent'
          ? 'your_agent'
          : 'magic_city_worker',
        executionOwnerLabel: String(selections.executionOwner || session.selections?.executionOwner || '').trim().toLowerCase() === 'your_agent'
          ? `${session.personalAgentProfile?.name || 'Your Agent'} DocSend handoff`
          : 'Magic City pitch review worker'
      }
    }),
    handoff: {
      label: previewOnly ? 'Open review preview' : 'Open investor memo',
      url: memoArtifact.url
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} ${source.readSummary} Prepared by ${PLUGIN_ID} for ${session.handoffData?.title || 'pitch deck review'}.`,
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
        kind: 'pitch',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['pitch-deck-review-agent', 'pitch.build_memo'],
        tools: ['pitch.fetch_docsend', 'pitch.review_story', 'pitch.build_memo'],
        privacyModes: ['private'],
        helperAgents: ['deck-reader', 'story-critic', 'investor-memo-writer'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'pitch_review_artifacts'
        }
      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) throw error;
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, { kind: 'pitch', pluginId: PLUGIN_ID })) return false;
  const selections = session.finalSelections || session.selections || {};
  const usingLocalMemoText = Boolean(String(session.localPrivateContext?.memoText || '').trim());
  const docsendUrl = String(selections.docsendUrl || session.localContext?.docsendUrl || '').trim();

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
      label: usingLocalMemoText ? 'Reviewing uploaded deck text' : 'Reading pitch source',
      detail: usingLocalMemoText
        ? 'Using the local PDF/text deck extract that stayed on the Magic City side for this run.'
        : docsendUrl
          ? 'Keeping the DocSend review lightweight and metadata-first on the Magic City side.'
          : 'Using the founder notes and pasted memo text available for this pitch review.',
      state: 'reading'
    })
  });

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Writing investor memo',
      detail: 'Turning the deck story, objections, and rewrite advice into review artifacts.',
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
  console.log(`[local-pitch-plugin] fulfilled ${session.id}`);
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
      console.error(`[local-pitch-plugin] session ${session.id} failed: ${error.message}`);
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
  console.log(`[local-pitch-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-pitch-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-pitch-plugin] fatal: ${error.message}`);
  process.exit(1);
});
