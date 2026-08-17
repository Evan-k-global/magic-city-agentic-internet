const SMALL_NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};

const TENS_NUMBER_WORDS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

const NUMBER_WORD_PATTERN = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[-\\s]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred))*';
const SHOPPING_LIST_LEAD_PATTERN = /\b(?:(?:shopping|camping|packing|grocery|gift|supply|supplies)\s+list|list\s+of\s+(?:things|items|stuff|products|supplies|groceries|purchases)(?:\s+to\s+(?:get|buy|order|purchase|pick\s*up))?|(?:things|items|stuff|products|supplies|groceries|purchases)\s+to\s+(?:get|buy|order|purchase|pick\s*up)|(?:get|buy|order|purchase|pick\s*up)\s+(?:these|the following)\s+(?:things|items|stuff|products|supplies|groceries|purchases))\b/i;
const SHOPPING_LIST_CONTEXT_PATTERN = /\b(?:list|items?|things?|stuff|products?|supplies|groceries|basket|cart|amazon|target|walmart|buy|purchase|order|get|pick\s*up|budget|spend)\b/i;
const INLINE_LIST_SEPARATOR_PATTERN = /(?:^|\s)(?:[-*]|\d+[.)])\s+/g;

function parseNumberWords(value = '') {
  const tokens = String(value || '').toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (Object.hasOwn(SMALL_NUMBER_WORDS, token)) {
      current += SMALL_NUMBER_WORDS[token];
      continue;
    }
    if (Object.hasOwn(TENS_NUMBER_WORDS, token)) {
      current += TENS_NUMBER_WORDS[token];
      continue;
    }
    if (token === 'hundred') {
      current = Math.max(1, current) * 100;
      continue;
    }
    return null;
  }
  total += current;
  return total > 0 && total <= 10000 ? total : null;
}

function inferUsdBudgetFromNumberWords(text = '') {
  const patterns = [
    new RegExp(`(?:^|[^\\w])(?:under|below|budget(?:ed)?(?:\\s+at)?|max(?:imum)?(?:\\s+spend)?(?:\\s+of)?|up to|less than|no more than|spend(?:ing)?(?:\\s+up to)?|cap(?:ped)?(?:\\s+at)?|limit(?:ed)?(?:\\s+to)?|for)\\s+(${NUMBER_WORD_PATTERN})\\s*(?:usd|dollars?|bucks?)?\\b`, 'i'),
    new RegExp(`(?:^|[^\\w])(${NUMBER_WORD_PATTERN})\\s*(?:usd|dollars?|bucks?)\\s*(?:tops?|max(?:imum)?(?:\\s+spend)?|budget|limit|cap|spend)?\\b`, 'i'),
    new RegExp(`(?:^|[^\\w])(${NUMBER_WORD_PATTERN})\\s*(?:tops?|max(?:imum)?(?:\\s+spend)?|budget|limit|cap|spend)\\b`, 'i')
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    const amount = parseNumberWords(match?.[1] || '');
    if (amount != null) return `$${amount}`;
  }
  return '';
}

export function inferUsdBudgetLabel(value = '') {
  const text = String(value || '');
  const patterns = [
    /(?:^|[^\w])budget(?:\s+[a-z0-9' -]{0,48})?\s*(?:is|=|:|of|around|about)?\s*\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)?\b/i,
    /(?:^|[^\w])(?:under|below|budget(?:ed)?(?:\s+at)?|ma[xs](?:imum)?(?:\s+spend)?(?:\s+of)?|up to|less than|no more than|spend(?:ing)?(?:\s+up to)?|extra\s+spend|additional\s+spend|cap(?:ped)?(?:\s+at)?|limit(?:ed)?(?:\s+to)?|for)\s*\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)?\b/i,
    /(?:^|[^\w])\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)?\s*(?:ma[xs](?:imum)?(?:\s+spend)?|budget|limit|cap|extra\s+spend|additional\s+spend|spend)\b/i,
    /(?:^|[^\w])([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)\s*(?:ma[xs](?:imum)?(?:\s+spend)?|budget|limit|cap|extra\s+spend|additional\s+spend|spend)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return `$${match[1].replace(/,/g, '')}`;
  }
  const standalone = text.trim().match(/^\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)?$/i);
  if (standalone?.[1]) return `$${standalone[1].replace(/,/g, '')}`;
  return inferUsdBudgetFromNumberWords(text);
}

export function stripUsdBudgetPhrases(value = '') {
  return String(value || '')
    .replace(/(?:^|[^\w])(?:under|below|budget(?:ed)?(?:\s+at)?|ma[xs](?:imum)?(?:\s+spend)?(?:\s+of)?|up to|less than|no more than|spend(?:ing)?(?:\s+up to)?|extra\s+spend|additional\s+spend|cap(?:ped)?(?:\s+at)?|limit(?:ed)?(?:\s+to)?|for)\s*\$?\s*[0-9][0-9,]*(?:\.\d{1,2})?\s*(?:usd|dollars?|bucks?)?\b/gi, ' ')
    .replace(/(?:^|[^\w])\$\s*[0-9][0-9,]*(?:\.\d{1,2})?\s*(?:usd|dollars?|bucks?)?\s*(?:ma[xs](?:imum)?(?:\s+spend)?|budget|limit|cap|extra\s+spend|additional\s+spend|spend)\b/gi, ' ')
    .replace(/(?:^|[^\w])[0-9][0-9,]*(?:\.\d{1,2})?\s*(?:usd|dollars?|bucks?)\s*(?:ma[xs](?:imum)?(?:\s+spend)?|budget|limit|cap|extra\s+spend|additional\s+spend|spend)\b/gi, ' ')
    .replace(new RegExp(`(?:^|[^\\w])(?:under|below|budget(?:ed)?(?:\\s+at)?|ma[xs](?:imum)?(?:\\s+spend)?(?:\\s+of)?|up to|less than|no more than|spend(?:ing)?(?:\\s+up to)?|extra\\s+spend|additional\\s+spend|cap(?:ped)?(?:\\s+at)?|limit(?:ed)?(?:\\s+to)?|for)\\s+${NUMBER_WORD_PATTERN}\\s*(?:usd|dollars?|bucks?)?\\b`, 'gi'), ' ')
    .replace(new RegExp(`(?:^|[^\\w])${NUMBER_WORD_PATTERN}\\s*(?:usd|dollars?|bucks?)\\s*(?:tops?|ma[xs](?:imum)?(?:\\s+spend)?|budget|limit|cap|extra\\s+spend|additional\\s+spend|spend)?\\b`, 'gi'), ' ')
    .replace(new RegExp(`(?:^|[^\\w])${NUMBER_WORD_PATTERN}\\s*(?:tops?|ma[xs](?:imum)?(?:\\s+spend)?|budget|limit|cap|extra\\s+spend|additional\\s+spend|spend)\\b`, 'gi'), ' ');
}

export function inferBrowserBudgetScope(value = '') {
  return /\b(?:also\s+add|add(?:ing)?\s+(?:this|these|the)?[\s\S]{0,80}?\bto\s+(?:my\s+)?cart|append(?:ing)?\s+to\s+(?:my\s+)?cart|extra\s+spend|additional\s+spend|existing\s+cart|current\s+cart|already\s+in\s+(?:my\s+)?cart)\b/i.test(String(value || ''))
    ? 'incremental_cart_addition'
    : 'total_checkout';
}

function normalizeShoppingItemText(value = '') {
  return stripUsdBudgetPhrases(value)
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
    .replace(/^\s*(?:and|also|plus|then)\s+/i, '')
    .replace(/\b(?:from|on|at|via)\s+(?:amazon|amazon\.com|target|target\.com|walmart|walmart\.com)\b/gi, ' ')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidShoppingItemText(value = '') {
  const line = String(value || '').trim();
  return line.length >= 2 &&
    line.length <= 120 &&
    !/\b(?:total|max(?:imum)?|budget|spend|under|less than|checkout|amazon\.com)\b/i.test(line) &&
    !/[.!?]$/.test(line);
}

function extractInlineShoppingItems(value = '') {
  const text = String(value || '').replace(/\r?\n/g, ' ');
  const leadMatch = text.match(SHOPPING_LIST_LEAD_PATTERN);
  if (!leadMatch && !SHOPPING_LIST_CONTEXT_PATTERN.test(text)) return [];
  const tail = leadMatch
    ? text.slice((leadMatch.index ?? 0) + leadMatch[0].length)
    : text;
  INLINE_LIST_SEPARATOR_PATTERN.lastIndex = 0;
  const firstSeparator = INLINE_LIST_SEPARATOR_PATTERN.exec(tail);
  if (!firstSeparator) return [];
  const itemTail = tail.slice(firstSeparator.index);
  return itemTail
    .replace(INLINE_LIST_SEPARATOR_PATTERN, '\n')
    .split(/\n+/)
    .map(normalizeShoppingItemText)
    .filter(isValidShoppingItemText)
    .slice(0, 20);
}

export function extractBrowserShoppingItems(value = '') {
  const text = String(value || '');
  const entries = text
    .split(/\r?\n/)
    .map((line) => ({
      bullet: /^\s*(?:[-*]|\d+[.)])\s+/.test(line),
      text: line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
    }))
    .filter((entry) => entry.text);
  const listLead = entries.findIndex((entry) => SHOPPING_LIST_LEAD_PATTERN.test(entry.text));
  const firstBullet = entries.findIndex((entry) => entry.bullet);
  const bulletCount = entries.filter((entry) => entry.bullet).length;
  const startIndex = listLead >= 0
    ? listLead + 1
    : bulletCount >= 2 && firstBullet >= 0 && SHOPPING_LIST_CONTEXT_PATTERN.test(text)
      ? firstBullet
      : -1;
  const inlineItems = extractInlineShoppingItems(text);
  if (inlineItems.length > 1 && (startIndex < 0 || entries.slice(startIndex).length < 2)) return inlineItems;
  if (startIndex < 0) return [];
  return entries
    .slice(startIndex)
    .map((entry) => normalizeShoppingItemText(entry.text))
    .filter(isValidShoppingItemText)
    .slice(0, 20);
}
