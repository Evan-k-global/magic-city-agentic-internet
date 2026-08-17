const DISCOVERY_USER_AGENT = 'MagicCity/1.0 (local dev food discovery)';

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function normalizeCuisineText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();
}

function matchesCuisine(tags = {}, cuisine) {
  const desired = normalizeCuisineText(cuisine);
  if (!desired || desired === 'dinner') return true;
  const haystack = [
    tags.cuisine,
    tags['cuisine:primary'],
    tags.name,
    tags.description,
    tags.brand
  ]
    .filter(Boolean)
    .map(normalizeCuisineText)
    .join(' ');
  if (!haystack) return true;
  if (desired === 'sushi') return /sushi|japanese|asian/.test(haystack);
  if (desired === 'tacos') return /taco|mexican|latin/.test(haystack);
  if (desired === 'pizza') return /pizza|italian|pizzeria/.test(haystack);
  if (desired === 'burgers') return /burger|american|grill/.test(haystack);
  if (desired === 'ramen') return /ramen|japanese|asian|noodle/.test(haystack);
  return haystack.includes(desired);
}

function buildAddress(tags = {}) {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:unit'],
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode']
  ].filter(Boolean);
  return parts.join(' ');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'user-agent': DISCOVERY_USER_AGENT,
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`food_discovery_http_${response.status}`);
  }
  return response.json();
}

async function geocodeLocalArea({ zipCode, streetAddress }) {
  const query = streetAddress || zipCode || '';
  if (!query) {
    throw new Error('food_discovery_missing_location');
  }
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'us',
    q: query
  });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  const place = Array.isArray(data) ? data[0] : null;
  const lat = toNumber(place?.lat);
  const lon = toNumber(place?.lon);
  if (!place || lat === null || lon === null) {
    throw new Error('food_discovery_geocode_failed');
  }
  return {
    lat,
    lon,
    displayName: place.display_name || query
  };
}

async function queryNearbyPlaces({ lat, lon, radiusMeters = 2200 }) {
  const overpass = `[out:json][timeout:25];
(
  node["amenity"~"restaurant|fast_food|food_court"](around:${radiusMeters},${lat},${lon});
  way["amenity"~"restaurant|fast_food|food_court"](around:${radiusMeters},${lat},${lon});
  relation["amenity"~"restaurant|fast_food|food_court"](around:${radiusMeters},${lat},${lon});
);
out center 40;`;
  return fetchJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ data: overpass }).toString()
  });
}

function mapPlacesToRestaurants(elements = [], { lat, lon, cuisine }) {
  const dedupe = new Set();
  return elements
    .map((element) => {
      const tags = element.tags || {};
      const name = tags.name || tags.brand || null;
      const pointLat = toNumber(element.lat ?? element.center?.lat);
      const pointLon = toNumber(element.lon ?? element.center?.lon);
      if (!name || pointLat === null || pointLon === null) return null;
      if (!matchesCuisine(tags, cuisine)) return null;
      const key = `${name.toLowerCase()}|${buildAddress(tags).toLowerCase()}`;
      if (dedupe.has(key)) return null;
      dedupe.add(key);
      const distanceMiles = milesBetween(lat, lon, pointLat, pointLon);
      const cuisineText = normalizeCuisineText(tags.cuisine || '').replace(/\b\w/g, (c) => c.toUpperCase());
      const deliverySignal = tags.takeaway === 'yes' || tags.delivery === 'yes' || tags.amenity === 'fast_food';
      const highlight = [
        distanceMiles ? `${distanceMiles.toFixed(distanceMiles < 1 ? 1 : 0)} mi away` : '',
        cuisineText || '',
        deliverySignal ? 'takeout/delivery friendly' : '',
        tags.website ? 'website available' : ''
      ].filter(Boolean).join(' · ');
      return {
        name,
        eta: null,
        total: null,
        highlight: highlight || 'near your local area',
        source: 'openstreetmap',
        website: tags.website || null,
        phone: tags.phone || null,
        address: buildAddress(tags) || null,
        cuisine: cuisineText || null,
        takeaway: tags.takeaway || null,
        delivery: tags.delivery || null,
        openingHours: tags.opening_hours || null,
        distanceMiles: Number(distanceMiles.toFixed(2))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, 12);
}

export async function discoverNearbyFoodOptions({ zipCode, streetAddress, cuisine }) {
  const area = await geocodeLocalArea({ zipCode, streetAddress });
  const nearby = await queryNearbyPlaces(area);
  const restaurants = mapPlacesToRestaurants(nearby.elements || [], {
    lat: area.lat,
    lon: area.lon,
    cuisine
  });
  return {
    mode: 'openstreetmap_live_discovery',
    source: 'openstreetmap',
    area,
    restaurants,
    notes: restaurants.length
      ? `Found ${restaurants.length} real nearby places around ${area.displayName}.`
      : `No nearby places matched that cuisine around ${area.displayName}.`
  };
}
