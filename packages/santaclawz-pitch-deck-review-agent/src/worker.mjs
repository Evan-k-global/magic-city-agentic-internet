import fs from 'node:fs';
import crypto from 'node:crypto';

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
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

async function fetchDeckMetadata(url = '') {
  const value = String(url || '').trim();
  if (!value) {
    return {
      excerpt: '',
      readMode: 'no_link',
      title: '',
      readSummary: 'No deck link supplied; used provided context only.'
    };
  }
  try {
    const response = await fetch(value, {
      headers: {
        'user-agent': 'SantaClawzPitchDeckReviewAgent/0.1'
      }
    });
    const html = await response.text();
    const title = extractMetaContent(html, ['og:title', 'twitter:title']) || '';
    const description = extractMetaContent(html, ['description', 'og:description', 'twitter:description']) || '';
    const bodyText = stripHtml(html);
    const blocked = /appear to be a bot|verify you are human|captcha|access denied/i.test(bodyText);
    const excerpt = [
      title ? `Deck title: ${title}` : '',
      description ? `Deck description: ${description}` : '',
      blocked ? 'The live deck page served a bot-check or access shell instead of readable deck body.' : ''
    ].filter(Boolean).join('\n').trim();
    return {
      excerpt,
      readMode: blocked ? 'deck_metadata_only_blocked' : 'link_metadata_only',
      title,
      readSummary: blocked
        ? 'Deck metadata loaded, but the live deck body was blocked; this review is metadata/context based.'
        : 'Deck metadata loaded; this review does not claim a full live deck read unless deck text was supplied.'
    };
  } catch {
    return {
      excerpt: '',
      readMode: 'link_metadata_only',
      title: '',
      readSummary: 'Used the deck link as metadata-only fallback because the live page could not be fetched reliably.'
    };
  }
}

async function buildReviewSource(input = {}) {
  const docsendUrl = String(input.docsendUrl || '').trim();
  const memoText = String(input.memoText || '').trim();
  const memoFileName = String(input.memoFileName || '').trim();
  if (memoText) {
    return {
      docsendUrl,
      excerpt: memoText.slice(0, 3000),
      readMode: memoFileName ? 'uploaded_deck_text' : 'pasted_memo_text',
      readSummary: memoFileName
        ? `Reviewed locally extracted deck text from ${memoFileName}.`
        : 'Reviewed pasted deck or memo text supplied to the agent.',
      sourceLabel: memoFileName ? `Uploaded deck text (${memoFileName})` : 'Pasted memo text'
    };
  }
  const metadata = await fetchDeckMetadata(docsendUrl);
  return {
    docsendUrl,
    excerpt: metadata.excerpt || '',
    readMode: metadata.readMode,
    readSummary: metadata.readSummary,
    sourceLabel: metadata.title ? `Deck metadata (${metadata.title})` : (docsendUrl ? 'Deck metadata' : 'Founder context only')
  };
}

function buildPitchReviewPackage(input = {}, source = {}) {
  const companyLabel = input.companyName || 'The company';
  const fundraisingStage = input.fundraisingStage || 'Seed';
  const audience = input.audience || 'Generalist seed investor';
  const reviewAsk = input.reviewAsk || 'Full investor memo + objections';
  const founderContext = String(input.founderContext || '').trim();
  const investorConcerns = String(input.investorConcerns || '').trim();
  const reviewBasis = source.readMode === 'uploaded_deck_text'
    ? 'Reviewed uploaded or locally extracted deck text.'
    : source.readMode === 'pasted_memo_text'
      ? 'Reviewed pasted deck or memo text.'
      : source.docsendUrl
        ? `${source.readSummary} Founder context was blended in when supplied.`
        : 'No deck link was provided, so this package is based on supplied founder context.';
  const excerptBlock = source.excerpt
    ? `## Deck excerpt\n\n${source.excerpt.slice(0, 1800)}\n`
    : '## Deck excerpt\n\nNo stable deck text excerpt was supplied or captured.\n';
  const memo = [
    `# ${companyLabel} pitch memo`,
    '',
    `- Stage: ${fundraisingStage}`,
    `- Audience: ${audience}`,
    `- Review ask: ${reviewAsk}`,
    `- Review basis: ${reviewBasis}`,
    '',
    '## What feels strong',
    '- The story is strongest when the problem, wedge, user, and urgency are visible in the first two or three slides.',
    '- Investors will look for proof around why now, why this team, and why this market can compound.',
    '- The best version of this deck should connect traction, GTM, and defensibility explicitly.',
    '',
    '## What feels weak or missing',
    '- Compress the narrative faster: problem -> product -> proof -> market -> moat -> ask.',
    '- If the deck leans on vision, add concrete evidence and sharper milestones.',
    '- If the deck leans on product detail, simplify the story for why the company can become large and inevitable.',
    '',
    excerptBlock,
    '## Founder context used',
    founderContext || 'No additional founder context was supplied.',
    '',
    '## Review recommendation',
    `For ${audience.toLowerCase()}, the next pass should focus on ${reviewAsk.toLowerCase()} with tighter narrative compression and clearer proof.`
  ].join('\n');
  const objections = [
    '# Investor questions and objections',
    '',
    '- What is the sharpest wedge and why does it win now?',
    '- Which proof points are real today versus directional?',
    '- What is the credible GTM path for the next 12-18 months?',
    '- Why does this become venture-scale rather than a strong feature, services business, or niche product?',
    '- What milestone will this round unlock that materially changes the company?',
    investorConcerns ? `- Specific concern to answer: ${investorConcerns}` : ''
  ].filter(Boolean).join('\n');
  const rewrite = [
    '# Narrative rewrite advice',
    '',
    '1. Open with the user pain and exact category wedge, not broad market ambition.',
    '2. Show proof earlier: traction, customer pull, distribution edge, or technical advantage.',
    '3. Collapse the market section into a believable expansion path.',
    '4. Make the ask concrete: round size, use of funds, and milestone unlocks.',
    '5. End on why this team is structurally advantaged to win.'
  ].join('\n');
  const checklist = [
    '# Next-step checklist',
    '',
    '- Tighten the first three slides until the wedge is obvious.',
    '- Add two or three proof points that survive investor skepticism.',
    '- Rewrite GTM in plain language.',
    '- Make the fundraise ask specific and milestone-based.',
    '- Rerun the review after the rewrite.'
  ].join('\n');
  return { memo, objections, rewrite, checklist };
}

function artifact(label, fileName, content, contentType = 'text/markdown; charset=utf-8') {
  return {
    label,
    fileName,
    contentType,
    sha256: sha256(content),
    content
  };
}

export async function runPitchDeckReview(input = {}) {
  const source = await buildReviewSource(input);
  const review = buildPitchReviewPackage(input, source);
  const previewOnly = Boolean(input.previewOnly);
  const artifacts = [
    artifact(previewOnly ? 'Pitch review preview' : 'Investor memo', 'investor_memo.md', review.memo)
  ];
  if (!previewOnly) {
    artifacts.push(
      artifact('Investor objections', 'investor_objections.md', review.objections),
      artifact('Narrative rewrite advice', 'narrative_rewrite_advice.md', review.rewrite),
      artifact('Next-step checklist', 'next_step_checklist.md', review.checklist)
    );
  }
  const receipt = {
    schemaVersion: 'pitch-deck-review-receipt-v1',
    sessionId: input.sessionId || null,
    agentId: 'pitch-deck-review-agent',
    completedAt: new Date().toISOString(),
    readMode: source.readMode,
    readSummary: source.readSummary,
    sourceLabel: source.sourceLabel,
    docsendUrl: source.docsendUrl || '',
    artifactHashes: artifacts.map(({ label, fileName, sha256 }) => ({ label, fileName, sha256 }))
  };
  artifacts.push(artifact('Receipt', 'receipt.json', JSON.stringify(receipt, null, 2), 'application/json; charset=utf-8'));
  return {
    status: 'fulfilled',
    completionState: previewOnly ? 'ready_for_review' : 'completed',
    nextHumanAction: previewOnly
      ? 'Review the preview memo, then run the full review when ready.'
      : 'Download the review package, tighten the deck, and rerun once you want another pass.',
    result: {
      previewOnly,
      readMode: source.readMode,
      readSummary: source.readSummary,
      sourceLabel: source.sourceLabel,
      artifacts
    }
  };
}

async function readJsonArg() {
  const filePath = process.argv[2];
  if (filePath) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const stdin = fs.readFileSync(0, 'utf8').trim();
  return stdin ? JSON.parse(stdin) : {};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = await readJsonArg();
  const output = await runPitchDeckReview(input);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
