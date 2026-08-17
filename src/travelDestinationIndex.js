import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESTINATION_INDEX_PATH = path.join(__dirname, '..', 'data', 'travel-destinations.txt');

function normalizeTravelText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadTravelDestinationIndex() {
  try {
    const raw = fs.readFileSync(DESTINATION_INDEX_PATH, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [canonicalPart, aliasesPart = ''] = line.split('|');
        const canonical = String(canonicalPart || '').trim();
        const aliases = [
          canonical,
          ...String(aliasesPart || '')
            .split(',')
            .map((alias) => alias.trim())
            .filter(Boolean)
        ];
        const normalizedAliases = [...new Set(aliases.map(normalizeTravelText).filter(Boolean))].sort((a, b) => b.length - a.length);
        return canonical
          ? { canonical, aliases: normalizedAliases }
          : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const TRAVEL_DESTINATION_INDEX = loadTravelDestinationIndex();

export function findIndexedTravelDestination(input = '') {
  const normalized = normalizeTravelText(input);
  if (!normalized) return '';
  const haystack = ` ${normalized} `;
  let bestMatch = '';
  let bestAliasLength = 0;
  for (const entry of TRAVEL_DESTINATION_INDEX) {
    for (const alias of entry.aliases) {
      if (!alias || alias.length < bestAliasLength) continue;
      if (haystack.includes(` ${alias} `)) {
        bestMatch = entry.canonical;
        bestAliasLength = alias.length;
        break;
      }
    }
  }
  return bestMatch;
}

export function listIndexedTravelDestinations() {
  return TRAVEL_DESTINATION_INDEX.map((entry) => entry.canonical);
}
