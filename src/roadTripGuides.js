const ROAD_TRIP_GUIDES = [
  {
    key: 'new-england-loop',
    label: 'New England fall coast and mountains loop',
    region: 'New England',
    summary: 'A classic New England road trip mixing Boston, coastal Maine, the White Mountains, Vermont villages, and Berkshires or Connecticut River Valley backroads.',
    theme: 'Coast, small towns, foliage, seafood, and mountain drives',
    startCity: 'Boston',
    endCity: 'Boston',
    defaultLength: '7 days',
    defaultPace: 'Balanced scenic days',
    overnightAreas: ['Portland or Kennebunkport', 'Bar Harbor or Midcoast Maine', 'North Conway', 'Stowe or Woodstock', 'Berkshires or Boston'],
    mapsQuery: 'Boston Portland Maine Acadia National Park White Mountains Stowe Woodstock Vermont Berkshires Boston road trip',
    staysQuery: 'Portland Maine Bar Harbor North Conway Stowe Woodstock Vermont Berkshires inns',
    highlightsQuery: 'best New England road trip Acadia White Mountains Vermont villages fall foliage seafood',
    searchPatterns: [
      /\bnew england\b/,
      /\bmaine\b/,
      /\bvermont\b/,
      /\bnew hampshire\b/,
      /\bacadia\b/,
      /\bwhite mountains?\b/,
      /\bboston\b/,
      /\bfall foliage\b/,
      /\bberkshires?\b/
    ],
    dayStops: [
      {
        day: 1,
        route: 'Boston -> Salem or Cape Ann -> Portland',
        driveTime: '2.5 to 4 hours with coastal stops',
        highlights: ['Cape Ann shoreline', 'Portland Old Port', 'Lighthouse stop if weather is clear'],
        mealStop: 'Seafood lunch north of Boston or dinner in Portland',
        overnight: 'Portland or Kennebunkport'
      },
      {
        day: 2,
        route: 'Portland -> Midcoast Maine -> Bar Harbor',
        driveTime: '4 to 5.5 hours with stops',
        highlights: ['Camden or Rockland pause', 'Penobscot Bay views', 'Evening arrival near Acadia'],
        mealStop: 'Lobster roll or harbor lunch on the Midcoast',
        overnight: 'Bar Harbor or Midcoast Maine'
      },
      {
        day: 3,
        route: 'Acadia National Park day',
        driveTime: 'Low mileage park day',
        highlights: ['Park Loop Road', 'Ocean Path or Jordan Pond', 'Cadillac Mountain if timed entry works'],
        mealStop: 'Picnic or village lunch near Bar Harbor',
        overnight: 'Bar Harbor or nearby'
      },
      {
        day: 4,
        route: 'Maine coast -> White Mountains',
        driveTime: '4.5 to 6 hours',
        highlights: ['Kancamagus Highway if timing fits', 'Covered bridge stop', 'Mountain town evening'],
        mealStop: 'Casual lunch en route through western Maine or Conway',
        overnight: 'North Conway or Jackson'
      },
      {
        day: 5,
        route: 'White Mountains -> Stowe or Woodstock',
        driveTime: '3 to 5 hours with scenic detours',
        highlights: ['Franconia Notch option', 'Vermont village green', 'Farm or maple stop'],
        mealStop: 'Cafe lunch in a Vermont village',
        overnight: 'Stowe, Woodstock, or Waitsfield'
      },
      {
        day: 6,
        route: 'Vermont slow day -> Berkshires',
        driveTime: '3 to 4.5 hours',
        highlights: ['Route 100 segments', 'Bookstore or art stop', 'Berkshire hill town evening'],
        mealStop: 'Farm-to-table lunch or bakery stop',
        overnight: 'Berkshires or Connecticut River Valley'
      },
      {
        day: 7,
        route: 'Berkshires -> Boston',
        driveTime: '2.5 to 4 hours',
        highlights: ['Mass MoCA or Stockbridge option', 'Slow return', 'Final Boston dinner'],
        mealStop: 'Berkshire brunch or Worcester-area pause',
        overnight: 'Trip complete'
      }
    ]
  },
  {
    key: 'pacific-coast-highway',
    label: 'Pacific Coast Highway',
    region: 'California',
    summary: 'A classic California coast drive from San Francisco to Los Angeles with Big Sur, design towns, and long scenic lunches.',
    theme: 'Coast, food, and classic California towns',
    startCity: 'San Francisco',
    endCity: 'Los Angeles',
    defaultLength: '5 days',
    defaultPace: 'Balanced scenic days',
    overnightAreas: ['Carmel or Monterey', 'San Luis Obispo', 'Santa Barbara', 'Los Angeles'],
    mapsQuery: 'San Francisco to Los Angeles via Pacific Coast Highway',
    staysQuery: 'Carmel Monterey San Luis Obispo Santa Barbara boutique hotels',
    highlightsQuery: 'Big Sur overlooks Hearst Castle Malibu lunch stops',
    searchPatterns: [
      /\bpacific coast\b/,
      /\bpch\b/,
      /\bhighway 1\b/,
      /\bbig sur\b/,
      /\bcarmel\b/,
      /\bmonterey\b/,
      /\bsanta barbara\b/,
      /\bmalibu\b/,
      /\bcoast(al)? drive\b/
    ],
    dayStops: [
      {
        day: 1,
        route: 'San Francisco -> Half Moon Bay -> Santa Cruz -> Carmel',
        driveTime: '3 to 4 hours driving',
        highlights: ['Coffee stop in Half Moon Bay', 'Monterey Bay shoreline pause', 'Golden-hour walk in Carmel'],
        mealStop: 'Seafood lunch in Santa Cruz or Monterey',
        overnight: 'Carmel or Monterey'
      },
      {
        day: 2,
        route: 'Carmel -> Bixby Bridge -> Big Sur -> Cambria',
        driveTime: '4 to 5 hours with scenic stops',
        highlights: ['Bixby Bridge overlook', 'McWay Falls pull-offs', 'Big Sur state park viewpoints'],
        mealStop: 'Big Sur cafe lunch',
        overnight: 'Cambria'
      },
      {
        day: 3,
        route: 'Cambria -> Hearst Castle -> Morro Bay -> San Luis Obispo',
        driveTime: '2.5 to 3.5 hours',
        highlights: ['Hearst Castle visit', 'Morro Bay waterfront', 'Slow evening in SLO'],
        mealStop: 'Harbor lunch in Morro Bay',
        overnight: 'San Luis Obispo'
      },
      {
        day: 4,
        route: 'San Luis Obispo -> Santa Barbara -> Malibu',
        driveTime: '4 to 5 hours with stops',
        highlights: ['Santa Barbara mission district', 'Beach stretch in Malibu', 'Sunset drive into LA'],
        mealStop: 'Santa Barbara lunch',
        overnight: 'Los Angeles'
      },
      {
        day: 5,
        route: 'Los Angeles slow day',
        driveTime: 'Local driving only',
        highlights: ['Getty or Griffith option', 'Neighborhood food crawl', 'Beach or design district finish'],
        mealStop: 'Late lunch in Venice, Silver Lake, or Santa Monica',
        overnight: 'Los Angeles or depart'
      }
    ]
  },
  {
    key: 'yosemite-and-sierra',
    label: 'Yosemite and Eastern Sierra',
    summary: 'A California mountain loop for granite, lakes, alpine roads, and a stronger national-park guidebook than a generic flight itinerary.',
    theme: 'Granite, lakes, and national parks',
    startCity: 'San Francisco',
    endCity: 'San Francisco',
    defaultLength: '5 days',
    defaultPace: 'Balanced scenic days',
    overnightAreas: ['Yosemite gateway', 'Mammoth Lakes', 'Lake Tahoe', 'Gold Country'],
    mapsQuery: 'San Francisco Yosemite Mammoth Lakes Lake Tahoe loop',
    staysQuery: 'Yosemite gateway Mammoth Lakes Lake Tahoe lodges',
    highlightsQuery: 'Tioga Pass Yosemite viewpoints Mammoth Lakes Lake Tahoe stops',
    searchPatterns: [
      /\byosemite\b/,
      /\btioga\b/,
      /\bmammoth\b/,
      /\beastern sierra\b/,
      /\blake tahoe\b/,
      /\bsequoia\b/,
      /\bnational park road trip\b/
    ],
    dayStops: [
      {
        day: 1,
        route: 'San Francisco -> Groveland -> Yosemite gateway',
        driveTime: '4 to 5 hours',
        highlights: ['Gold Country coffee stop', 'Sunset arrival near Yosemite', 'Quiet dinner before early park start'],
        mealStop: 'Groveland lunch',
        overnight: 'Yosemite gateway'
      },
      {
        day: 2,
        route: 'Yosemite Valley day',
        driveTime: 'Low mileage park day',
        highlights: ['Tunnel View', 'Valley floor loop', 'Waterfall or meadow walk'],
        mealStop: 'Picnic lunch in the valley',
        overnight: 'Yosemite gateway'
      },
      {
        day: 3,
        route: 'Yosemite -> Tioga Pass -> Mono Lake -> Mammoth Lakes',
        driveTime: '4 to 5 hours with stops',
        highlights: ['High Sierra viewpoints', 'Mono Lake tufas', 'Evening in Mammoth'],
        mealStop: 'Roadside lunch after Tioga Pass',
        overnight: 'Mammoth Lakes'
      },
      {
        day: 4,
        route: 'Mammoth Lakes -> Lake Tahoe',
        driveTime: '3.5 to 4.5 hours',
        highlights: ['Alpine lake stop', 'Tahoe west shore or south shore arrival', 'Sunset by the lake'],
        mealStop: 'Lunch in Bishop or Carson Valley depending on route',
        overnight: 'Lake Tahoe'
      },
      {
        day: 5,
        route: 'Lake Tahoe -> Placerville -> San Francisco',
        driveTime: '4 to 5 hours',
        highlights: ['Morning lake walk', 'Gold Country coffee stop', 'Return with one slow scenic break'],
        mealStop: 'Placerville lunch',
        overnight: 'Trip complete'
      }
    ]
  },
  {
    key: 'wine-country-and-redwoods',
    label: 'Wine Country and Redwoods',
    summary: 'A California northbound loop mixing Napa or Sonoma ease with Mendocino and towering redwood parks.',
    theme: 'Wine country, design towns, and redwoods',
    startCity: 'San Francisco',
    endCity: 'San Francisco',
    defaultLength: '5 days',
    defaultPace: 'Relaxed scenic days',
    overnightAreas: ['Napa or Sonoma', 'Mendocino', 'Humboldt or Trinidad', 'Healdsburg'],
    mapsQuery: 'San Francisco Napa Mendocino Redwood National and State Parks loop',
    staysQuery: 'Napa Sonoma Mendocino Healdsburg boutique inns',
    highlightsQuery: 'Mendocino redwood park viewpoints Anderson Valley Healdsburg food stops',
    searchPatterns: [
      /\bnapa\b/,
      /\bsonoma\b/,
      /\bwine country\b/,
      /\bmendocino\b/,
      /\bredwood\b/,
      /\bredwoods\b/,
      /\bhealdsburg\b/
    ],
    dayStops: [
      {
        day: 1,
        route: 'San Francisco -> Napa or Sonoma',
        driveTime: '1.5 to 2.5 hours',
        highlights: ['Slow start out of the city', 'One tasting or olive oil stop', 'Early evening town walk'],
        mealStop: 'Long lunch in Napa or Sonoma',
        overnight: 'Napa or Sonoma'
      },
      {
        day: 2,
        route: 'Wine Country -> Anderson Valley -> Mendocino',
        driveTime: '3 to 4 hours',
        highlights: ['Anderson Valley scenic drive', 'Coastal cliffs in Mendocino', 'Sunset on the bluffs'],
        mealStop: 'Anderson Valley lunch',
        overnight: 'Mendocino'
      },
      {
        day: 3,
        route: 'Mendocino -> Avenue of the Giants / Humboldt',
        driveTime: '4 to 5 hours',
        highlights: ['Redwood groves', 'Short forest walks', 'Quiet evening near the coast or river'],
        mealStop: 'Roadside lunch near Leggett or Humboldt',
        overnight: 'Humboldt or Trinidad'
      },
      {
        day: 4,
        route: 'Redwood park day -> Healdsburg',
        driveTime: '4 to 5 hours with morning park stop',
        highlights: ['Morning among the redwoods', 'Southbound scenic drive', 'Dinner in Healdsburg'],
        mealStop: 'Picnic or cafe near the parks',
        overnight: 'Healdsburg'
      },
      {
        day: 5,
        route: 'Healdsburg -> Point Reyes optional detour -> San Francisco',
        driveTime: '2 to 4 hours',
        highlights: ['Coffee in Healdsburg', 'Optional Point Reyes or Marin stop', 'Return with a relaxed finish'],
        mealStop: 'Marin lunch stop',
        overnight: 'Trip complete'
      }
    ]
  }
];

function normalizeRoadTripGuideKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function listCaliforniaRoadTripGuides() {
  return ROAD_TRIP_GUIDES.filter((guide) => guide.region === 'California').map((guide) => ({ ...guide }));
}

export function listRoadTripGuides() {
  return ROAD_TRIP_GUIDES.map((guide) => ({ ...guide }));
}

export function getCaliforniaRoadTripGuide(key = '') {
  const normalized = normalizeRoadTripGuideKey(key);
  return ROAD_TRIP_GUIDES.find((guide) => guide.region === 'California' && guide.key === normalized)
    || ROAD_TRIP_GUIDES.find((guide) => guide.key === 'pacific-coast-highway');
}

export function getRoadTripGuide(key = '') {
  const normalized = normalizeRoadTripGuideKey(key);
  return ROAD_TRIP_GUIDES.find((guide) => guide.key === normalized) || ROAD_TRIP_GUIDES[0];
}

export function inferCaliforniaRoadTripGuide(prompt = '', destination = '') {
  const lower = `${String(prompt || '')} ${String(destination || '')}`.toLowerCase();
  return ROAD_TRIP_GUIDES.find((guide) => guide.region === 'California' && guide.searchPatterns.some((pattern) => pattern.test(lower)))
    || getCaliforniaRoadTripGuide('');
}

export function inferRoadTripGuide(prompt = '', destination = '') {
  const lower = `${String(prompt || '')} ${String(destination || '')}`.toLowerCase();
  return ROAD_TRIP_GUIDES.find((guide) => guide.searchPatterns.some((pattern) => pattern.test(lower)))
    || (/\bcalifornia|pch|highway 1|big sur|yosemite|napa|sonoma|redwoods|lake tahoe\b/.test(lower)
      ? getCaliforniaRoadTripGuide('')
      : ROAD_TRIP_GUIDES[0]);
}

export function buildRoadTripDayStopPreview(guide) {
  const resolved = guide?.dayStops?.length ? guide : getRoadTripGuide('');
  return resolved.dayStops
    .map((stop) => `Day ${stop.day}: ${stop.route} · ${stop.driveTime} · overnight ${stop.overnight}`)
    .join('\n');
}

export function buildRoadTripProviderLinks(guide) {
  const resolved = guide?.dayStops?.length ? guide : getRoadTripGuide('');
  return [
    {
      label: 'Open route map',
      url: `https://www.google.com/maps/search/${encodeURIComponent(resolved.mapsQuery)}`,
      note: 'Open the full driving route in a live map surface.',
      preferredForExecution: true,
      provider: 'google_maps_route'
    },
    {
      label: 'Search overnight stays',
      url: `https://www.google.com/search?q=${encodeURIComponent(resolved.staysQuery)}`,
      note: 'Compare stay areas that match the route pacing.',
      provider: 'stays_search'
    },
    {
      label: 'Search route highlights',
      url: `https://www.google.com/search?q=${encodeURIComponent(resolved.highlightsQuery)}`,
      note: 'Open the strongest scenic stops, parks, and lunch break ideas for this route.',
      provider: 'highlights_search'
    }
  ];
}
