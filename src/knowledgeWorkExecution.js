function splitLines(raw = '') {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
}

function detectDelimiter(lines = []) {
  const sample = lines.slice(0, 5).join('\n');
  const candidates = [
    { delimiter: '\t', score: (sample.match(/\t/g) || []).length },
    { delimiter: ',', score: (sample.match(/,/g) || []).length },
    { delimiter: ';', score: (sample.match(/;/g) || []).length },
    { delimiter: '|', score: (sample.match(/\|/g) || []).length }
  ].sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].delimiter : ',';
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function normalizeHeader(value, index) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `column_${index + 1}`;
}

function uniqueHeaders(headers = []) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = normalizeHeader(header, index);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeDelimited(headers, rows, delimiter = ',') {
  const lines = [headers.join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(delimiter));
  }
  return lines.join('\n');
}

function inferOutputDelimiter(outputFormat = 'csv') {
  const lower = String(outputFormat || 'csv').toLowerCase();
  if (lower === 'tsv') return '\t';
  if (lower === 'pipe') return '|';
  return ',';
}

function normalizeCell(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeJson(raw = '') {
  const text = String(raw || '').trim();
  return text.startsWith('[') || text.startsWith('{');
}

function normalizeSemanticCell(header, value) {
  const normalized = normalizeCell(value);
  if (!normalized) return '';
  const key = String(header || '').toLowerCase();

  if (/(^|_)(email|e_mail)(_|$)/.test(key)) return normalized.toLowerCase();

  if (/(^|_)(phone|mobile|telephone|tel)(_|$)/.test(key)) {
    const compact = normalized.replace(/[^\d+]/g, '');
    if (compact.startsWith('00')) return `+${compact.slice(2)}`;
    return compact;
  }

  if (/(^|_)(date|dob|birthday|created_at|updated_at)(_|$)/.test(key)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  if (/(amount|price|total|cost|balance|revenue|subtotal)/.test(key)) {
    const compact = normalized.replace(/[$,\s]/g, '');
    const amount = Number(compact);
    if (Number.isFinite(amount)) return amount.toFixed(2);
  }

  return normalized;
}

function rowIsBlank(row = {}, headers = []) {
  return headers.every((header) => !String(row[header] ?? '').trim());
}

function rowMatchesHeaderValues(row = {}, headers = []) {
  return headers.length > 0 && headers.every((header) => {
    const value = normalizeCell(row[header] ?? '').toLowerCase();
    return value === String(header || '').toLowerCase();
  });
}

function summarizeColumnQuality(rows = [], headers = []) {
  return headers
    .map((header) => {
      const missing = rows.reduce((count, row) => count + (!String(row[header] ?? '').trim() ? 1 : 0), 0);
      return { header, missing };
    })
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 3)
    .filter((entry) => entry.missing > 0);
}

function parseJsonRows(rawData = '') {
  if (!looksLikeJson(rawData)) return null;
  try {
    const parsed = JSON.parse(rawData);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rows)
        ? parsed.rows
        : Array.isArray(parsed?.data)
          ? parsed.data
          : null;
    if (!Array.isArray(rows)) return null;
    const objectRows = rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    if (!objectRows.length) return null;
    const sourceHeaders = [];
    for (const row of objectRows) {
      for (const key of Object.keys(row)) {
        if (!sourceHeaders.includes(key)) sourceHeaders.push(key);
      }
    }
    const headers = uniqueHeaders(sourceHeaders);
    const rawRows = objectRows.map((row) => {
      const nextRow = {};
      headers.forEach((header, index) => {
        const sourceKey = sourceHeaders[index];
        nextRow[header] = normalizeSemanticCell(header, row[sourceKey] ?? '');
      });
      return nextRow;
    });
    return { headers, rawRows, delimiter: 'json' };
  } catch {
    return null;
  }
}

export function cleanupSpreadsheetData({ rawData = '', cleanupGoals = '', outputFormat = 'csv' } = {}) {
  const lines = splitLines(rawData).filter((line) => line.trim().length > 0);
  const parsedJson = parseJsonRows(rawData);
  const delimiter = parsedJson?.delimiter || detectDelimiter(lines);
  const defaultHeaders = ['value'];
  const rawRows = [];
  let headers = defaultHeaders;
  let repeatedHeaderRowsDropped = 0;

  if (parsedJson) {
    headers = parsedJson.headers;
    rawRows.push(...parsedJson.rawRows);
  } else if (lines.length === 0) {
    headers = defaultHeaders;
  } else if (lines.length === 1 && !/[\t,;|]/.test(lines[0])) {
    headers = defaultHeaders;
    rawRows.push({ value: normalizeCell(lines[0]) });
  } else {
    const parsed = lines.map((line) => splitDelimitedLine(line, delimiter));
    const headerRow = parsed.shift() || [];
    headers = uniqueHeaders(headerRow);
    for (const values of parsed) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = normalizeSemanticCell(header, values[index] ?? '');
      });
      rawRows.push(row);
    }
  }

  const nonBlankRows = [];
  let blankRowsDropped = 0;
  for (const row of rawRows) {
    if (rowIsBlank(row, headers)) {
      blankRowsDropped += 1;
      continue;
    }
    if (rowMatchesHeaderValues(row, headers)) {
      repeatedHeaderRowsDropped += 1;
      continue;
    }
    nonBlankRows.push(row);
  }
  const dedupeRequested = !/keep duplicates/i.test(String(cleanupGoals || ''));
  const seen = new Set();
  const cleanedRows = [];
  let duplicateRowsDropped = 0;
  for (const row of nonBlankRows) {
    const key = JSON.stringify(headers.map((header) => row[header] ?? ''));
    if (dedupeRequested && seen.has(key)) {
      duplicateRowsDropped += 1;
      continue;
    }
    seen.add(key);
    cleanedRows.push(row);
  }

  const outputDelimiter = inferOutputDelimiter(outputFormat);
  const cleanedDelimited = serializeDelimited(headers, cleanedRows, outputDelimiter);
  const cleanedJson = JSON.stringify(cleanedRows, null, 2);
  const sparseColumns = summarizeColumnQuality(cleanedRows, headers);
  const report = [
    '# Spreadsheet cleanup report',
    '',
    `- Source rows: ${rawRows.length}`,
    `- Clean rows: ${cleanedRows.length}`,
    `- Blank rows removed: ${blankRowsDropped}`,
    `- Repeated header rows removed: ${repeatedHeaderRowsDropped}`,
    `- Duplicate rows removed: ${duplicateRowsDropped}`,
    `- Output format: ${String(outputFormat || 'csv').toUpperCase()}`,
    `- Headers: ${headers.join(', ')}`,
    cleanupGoals ? `- Cleanup goals: ${cleanupGoals}` : '- Cleanup goals: standard normalize, trim, and dedupe',
    sparseColumns.length ? `- Sparse columns: ${sparseColumns.map((entry) => `${entry.header} (${entry.missing} missing)`).join(', ')}` : '- Sparse columns: none detected'
  ].join('\n');

  return {
    headers,
    rows: cleanedRows,
    rawRowCount: rawRows.length,
    cleanRowCount: cleanedRows.length,
    blankRowsDropped,
    repeatedHeaderRowsDropped,
    duplicateRowsDropped,
    sparseColumns,
    delimiter,
    cleanedDelimited,
    cleanedJson,
    report
  };
}

function splitTranscriptBlocks(transcript = '') {
  return String(transcript || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sentenceChunks(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function inferActionItems(blocks = []) {
  const actionRegex = /\b(will|needs to|need to|follow up|send|review|schedule|share|draft|prepare|confirm|deliver|update|clean up|fix)\b/i;
  const actions = [];
  for (const block of blocks) {
    if (actionRegex.test(block)) actions.push(block);
    if (actions.length >= 6) break;
  }
  return actions;
}

function inferDecisions(blocks = []) {
  const decisionRegex = /\b(decided|decision|agreed|approved|aligned on|confirmed)\b/i;
  return blocks.filter((block) => decisionRegex.test(block)).slice(0, 5);
}

function buildFollowUpEmail({ summaryBullets = [], actionItems = [], audience = 'team', meetingType = 'meeting' } = {}) {
  const intro = audience === 'client'
    ? `Thanks again for the ${meetingType}. Here is a quick recap and the next steps from our side.`
    : `Here is a quick recap from the ${meetingType}, plus the main next steps.`;
  const bullets = [
    ...summaryBullets.slice(0, 3).map((item) => `- ${item}`),
    ...actionItems.slice(0, 3).map((item) => `- Action: ${item}`)
  ];
  return [
    'Subject: Meeting recap and next steps',
    '',
    `Hi ${audience === 'client' ? 'there' : 'team'},`,
    '',
    intro,
    '',
    ...bullets,
    '',
    'Reply here if anything should be corrected or reprioritized.',
    '',
    'Best,',
    'Magic City'
  ].join('\n');
}

export function buildMeetingPackage({ transcript = '', meetingType = 'meeting', outputPackage = 'Summary + actions', audience = 'team', urgency = 'standard' } = {}) {
  const blocks = splitTranscriptBlocks(transcript);
  const sentences = sentenceChunks(transcript);
  const summaryBullets = (blocks.length ? blocks : sentences)
    .slice(0, 5)
    .map((line) => line.replace(/^[-*]\s*/, ''));
  const actionItems = inferActionItems(blocks.length ? blocks : sentences);
  const decisions = inferDecisions(blocks.length ? blocks : sentences);
  const outputs = {
    summary: [
      `# ${titleCase(meetingType)} workflow`,
      '',
      `- Audience: ${audience}`,
      `- Urgency: ${urgency}`,
      '',
      '## Summary',
      ...(summaryBullets.length ? summaryBullets.map((item) => `- ${item}`) : ['- No transcript content was provided.'])
    ].join('\n'),
    actions: [
      '# Action items',
      '',
      ...(actionItems.length ? actionItems.map((item) => `- ${item}`) : ['- No explicit action items were detected.'])
    ].join('\n'),
    decisions: [
      '# Decisions',
      '',
      ...(decisions.length ? decisions.map((item) => `- ${item}`) : ['- No explicit decisions were detected.'])
    ].join('\n'),
    followUpEmail: buildFollowUpEmail({ summaryBullets, actionItems, audience, meetingType })
  };

  const deliverables = ['summary'];
  if (/action/i.test(outputPackage) || /full/i.test(outputPackage)) deliverables.push('actions');
  if (/full/i.test(outputPackage)) {
    deliverables.push('decisions', 'followUpEmail');
  }

  return {
    summaryBullets,
    actionItems,
    decisions,
    outputs,
    deliverables,
    transcriptLength: String(transcript || '').length,
    blockCount: blocks.length,
    estimatedMinutes: Math.max(5, Math.round(String(transcript || '').split(/\s+/).filter(Boolean).length / 140))
  };
}

export function inferSpreadsheetRowCountBand(rawData = '') {
  const lines = splitLines(rawData).filter((line) => line.trim().length > 0);
  const rows = Math.max(0, lines.length - 1);
  if (rows > 5000) return '5k+ rows';
  if (rows > 500) return '500-5k rows';
  return 'Up to 500 rows';
}

export function inferMeetingLengthBand(transcript = '') {
  const words = String(transcript || '').split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(5, Math.round(words / 140));
  if (minutes > 60) return '60+ min';
  if (minutes > 30) return '30-60 min';
  return 'Up to 30 min';
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitLinesLoose(value = '') {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueList(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferCandidateName(resumeText = '') {
  const lines = splitLinesLoose(resumeText).slice(0, 6);
  for (const line of lines) {
    if (!line) continue;
    if (/@|https?:\/\/|linkedin\.com|github\.com|\+?\d/.test(line)) continue;
    if (line.length > 2 && line.length < 60) return line;
  }
  return '';
}

function extractEmail(value = '') {
  const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function extractPhone(value = '') {
  const match = String(value || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function extractUrls(value = '') {
  return uniqueList(String(value || '').match(/https?:\/\/[^\s)]+/gi) || []);
}

function inferPrimaryUrl(urls = [], pattern) {
  return urls.find((url) => pattern.test(String(url || '').toLowerCase())) || '';
}

function inferResumeHighlights(resumeText = '') {
  const lines = splitLinesLoose(resumeText);
  const bulletLines = lines
    .filter((line) => /^[-*•]/.test(line) || /\b(launched|built|led|grew|increased|reduced|improved|shipped|managed|owned)\b/i.test(line))
    .map((line) => line.replace(/^[-*•]\s*/, ''))
    .slice(0, 5);
  if (bulletLines.length) return bulletLines;
  return sentenceChunks(resumeText).slice(0, 4);
}

function inferResumeSkills(resumeText = '') {
  const matches = String(resumeText || '').match(/\b(JavaScript|TypeScript|Python|React|Node\.js|Node|SQL|Excel|Tableau|Figma|Product|Salesforce|HubSpot|GTM|marketing|operations|customer success|project management|analysis|analytics)\b/gi) || [];
  return uniqueList(matches.map((match) => titleCase(match))).slice(0, 10);
}

function inferExperienceYears(resumeText = '') {
  const matches = [...String(resumeText || '').matchAll(/\b(20\d{2}|19\d{2})\b/g)].map((match) => Number(match[1]));
  if (matches.length < 2) return null;
  const min = Math.min(...matches);
  const max = Math.max(...matches);
  const span = Math.max(0, max - min);
  return span ? `${span}+ years` : null;
}

function normalizeJobBoards(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((entry) => entry.trim());
  const normalized = raw
    .map((entry) => String(entry || '').trim().toLowerCase())
    .map((entry) => {
      if (/greenhouse/.test(entry)) return 'greenhouse';
      if (/lever/.test(entry)) return 'lever';
      if (/linkedin/.test(entry)) return 'linkedin';
      if (/workable/.test(entry)) return 'workable';
      if (/indeed/.test(entry)) return 'indeed';
      return entry;
    })
    .filter(Boolean);
  const deduped = uniqueList(normalized);
  return deduped.length ? deduped : ['linkedin', 'greenhouse', 'lever'];
}

export function buildJobApplicationPackage({
  resumeText = '',
  targetRole = '',
  locationPreference = '',
  companyTargets = '',
  jobBoards = '',
  submissionMode = 'review_before_submit',
  applicationLimit = '3',
  coverLetterNotes = '',
  applicantName = '',
  applicantEmail = '',
  applicantPhone = '',
  linkedinUrl = '',
  portfolioUrl = ''
} = {}) {
  const urls = extractUrls(resumeText);
  const normalizedBoards = normalizeJobBoards(jobBoards);
  const limitNumber = Math.max(1, Math.min(Number(applicationLimit) || 3, 12));
  const profile = {
    applicantName: normalizeWhitespace(applicantName) || inferCandidateName(resumeText),
    applicantEmail: normalizeWhitespace(applicantEmail) || extractEmail(resumeText),
    applicantPhone: normalizeWhitespace(applicantPhone) || extractPhone(resumeText),
    linkedinUrl: normalizeWhitespace(linkedinUrl) || inferPrimaryUrl(urls, /linkedin\.com/),
    portfolioUrl: normalizeWhitespace(portfolioUrl) || inferPrimaryUrl(urls, /(portfolio|github\.com|behance\.net|dribbble\.com|personal|website)/),
    experienceYears: inferExperienceYears(resumeText),
    skills: inferResumeSkills(resumeText),
    highlights: inferResumeHighlights(resumeText)
  };

  const searchRole = normalizeWhitespace(targetRole) || 'Generalist';
  const searchLocation = normalizeWhitespace(locationPreference) || 'Remote';
  const companyTerms = normalizeWhitespace(companyTargets);
  const searchQueries = normalizedBoards.map((board) => {
    if (board === 'linkedin') {
      return {
        board,
        label: 'LinkedIn Jobs',
        searchUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchRole)}&location=${encodeURIComponent(searchLocation)}`
      };
    }
    const domain = board === 'greenhouse'
      ? 'boards.greenhouse.io'
      : board === 'lever'
        ? 'jobs.lever.co'
        : board === 'workable'
          ? 'apply.workable.com'
          : 'indeed.com';
    const query = [`site:${domain}`, searchRole, searchLocation, companyTerms].filter(Boolean).join(' ');
    return {
      board,
      label: titleCase(board),
      searchUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`
    };
  });

  const coverLetterSnippet = [
    `Applying for ${searchRole}.`,
    profile.experienceYears ? `Experience: ${profile.experienceYears}.` : '',
    profile.skills.length ? `Relevant skills: ${profile.skills.slice(0, 5).join(', ')}.` : '',
    coverLetterNotes ? `Notes: ${normalizeWhitespace(coverLetterNotes)}` : ''
  ].filter(Boolean).join(' ');

  return {
    profile,
    searchRole,
    searchLocation,
    companyTargets: companyTerms,
    jobBoards: normalizedBoards,
    submissionMode,
    applicationLimit: limitNumber,
    searchQueries,
    coverLetterSnippet,
    publicProofSummary: {
      applicationsRequested: limitNumber,
      boardsUsed: normalizedBoards.length,
      submissionMode,
      role: searchRole,
      location: searchLocation
    }
  };
}
