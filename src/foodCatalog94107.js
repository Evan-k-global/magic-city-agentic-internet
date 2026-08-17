export const LOCALIZED_FOOD_ZIP = '94107';

const CATALOG_94107 = [
  {
    name: 'TOKYROLL Sushi & Poke - SoMa',
    cuisines: ['sushi', 'japanese', 'poke'],
    address: '60 Morris St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/tokyroll-san-francisco-soma-sushi-poke/r-aa8d7ec2-6d5d-4372-abfc-38a61b55664e'
    },
    menuItems: [
      { name: 'Miso Soup', price: '$2.99', category: 'Appetizers & Sides' },
      { name: 'Edamame', price: '$4.99', category: 'Appetizers & Sides' },
      { name: 'Chicken Gyoza (6)', price: '$7.99', category: 'Appetizers & Sides' },
      { name: 'Thundercat Roll', price: '$15.49', category: 'Sushi Rolls' },
      { name: 'Aloha Bowl', price: '$17.99', category: 'Poke Bowls' },
      { name: 'Build Your Own Bowl', price: '$16.99+', category: 'Poke Bowls' }
    ]
  },
  {
    name: 'Moshi Moshi',
    cuisines: ['sushi', 'japanese'],
    address: '2092 3rd Street, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/moshimoshisf/r-af00f4bd-8608-4431-b70f-9b88189436fb'
    },
    menuItems: [
      { name: 'Edamame', price: '$6.50', category: 'Starters' },
      { name: 'Gyoza', price: '$14.95', category: 'Starters' },
      { name: 'Ahi Tuna Bowl', price: '$24.50', category: 'Grill Bowls' },
      { name: 'Salmon Teriyaki Bowl', price: '$25.50', category: 'Grill Bowls' },
      { name: 'Chicken Katsu Dinner', price: '$24.00', category: 'Dinner' },
      { name: 'Tonkatsu Dinner', price: '$24.00', category: 'Dinner' }
    ]
  },
  {
    name: 'Merkado',
    cuisines: ['mexican', 'tacos'],
    address: '130 Townsend St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/merkado-san-francisco-130-townsend-st/r-cc7a68a2-06a9-4089-ad7a-a8aeab87dc55'
    },
    menuItems: [
      { name: 'Chips n salsa', price: '$6.00', category: 'Bites' },
      { name: 'Guacamole', price: '$16.00', category: 'Bites' },
      { name: 'Asada Taco', price: '$7.50', category: 'Tacos' },
      { name: 'Baja Taco', price: '$7.00', category: 'Tacos' },
      { name: 'Barbacoa Taco', price: '$7.50', category: 'Tacos' },
      { name: 'Ceviche', price: '$18.00', category: 'Starters' }
    ]
  },
  {
    name: 'Long Bridge Pizza',
    cuisines: ['pizza', 'italian'],
    address: '2347 3rd St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/long-bridge-pizza-2347-3rd-st/r-18bf5b66-c334-4c57-adff-b5391f3a229a'
    },
    menuItems: [
      { name: 'Small Margherita', price: '$19.05', category: 'Small Pizzas' },
      { name: 'Small Pepperoni', price: '$19.85', category: 'Small Pizzas' },
      { name: 'Small White Pie', price: '$19.30', category: 'Small Pizzas' },
      { name: 'Large Margherita', price: '$31.15', category: 'Large Pizzas' },
      { name: 'Large Pepperoni', price: '$35.80', category: 'Large Pizzas' },
      { name: 'Large Loading Dock', price: '$39.90', category: 'Large Pizzas' }
    ]
  },
  {
    name: 'ROOH San Francisco',
    cuisines: ['indian'],
    address: '333 Brannan St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup', 'reservation'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/rooh-san-francisco/r-3ebf52a0-637b-4297-8e80-055129b9abab'
    },
    reservation: {
      provider: 'opentable',
      url: 'https://www.opentable.com/r/rooh-san-francisco'
    },
    menuItems: [
      { name: 'Chicken Pepperfry Taco', price: '$20.00', category: 'Small Plates' },
      { name: 'Maddur Vada', price: '$20.00', category: 'Small Plates' },
      { name: 'Lamb Chops', price: '$24.00', category: 'Small Plates' },
      { name: 'Rooh Butter Chicken', price: '$30.00', category: 'Large Plates' },
      { name: 'Lamb Korma', price: '$34.00', category: 'Large Plates' },
      { name: 'Lamb Shank Nihari', price: '$34.00', category: 'Large Plates' }
    ]
  },
  {
    name: 'Taksim',
    cuisines: ['mediterranean', 'turkish'],
    address: '564 4th St, San Francisco, CA 94107',
    policies: ['pickup', 'reservation'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/taksim/r-f053e9bc-42fe-4878-876b-18d44e5f63a3'
    },
    reservation: {
      provider: 'opentable',
      url: 'https://www.opentable.com/r/taksim-san-francisco?lang=en'
    },
    menuItems: [
      { name: 'Wood Fired Flower Bread', price: '$7.00', category: 'Appetizer' },
      { name: 'Blistered Shishitos', price: '$14.00', category: 'Appetizer' },
      { name: 'Taksim Trio Dips & Pita', price: '$19.00', category: 'Appetizer' },
      { name: 'Shish Kebab', price: '$21.00', category: 'Appetizer' },
      { name: 'Manti', price: '$19.00', category: 'Appetizer' },
      { name: 'Panisse Chickpea Fries', price: '$15.00', category: 'Appetizer' }
    ]
  },
  {
    name: 'Sun and Moon',
    cuisines: ['thai', 'ramen', 'japanese'],
    address: '415 Brannan St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/sun-and-moon/r-53e72af2-0533-4144-b514-437fbcfe5e79'
    },
    menuItems: [
      { name: 'Fresh Spring Rolls', price: '$13.00', category: 'Appetizers' },
      { name: 'Chicken Satay', price: '$15.00', category: 'Appetizers' },
      { name: 'Corn Crab Cake', price: '$18.00', category: 'Appetizers' },
      { name: 'Salmon Rolls', price: '$17.00', category: 'Appetizers' },
      { name: 'Japanese Ramen', price: '$19.00+', category: 'Ramen' },
      { name: 'Thai Entrees', price: '$18.00+', category: 'Entree' }
    ]
  },
  {
    name: 'SOHN',
    cuisines: ['korean', 'breakfast'],
    address: '2535 3rd St, San Francisco, CA 94107',
    policies: ['pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/sohn-2535-3rd-street'
    },
    menuItems: [
      { name: 'Popcorn Chicken (GF)', price: '$10.00', category: 'Snacks' },
      { name: 'Spicy Cold Noodle Salad', price: '$14.00', category: 'Bowls' },
      { name: 'Kimchi Fried Rice', price: '$14.00', category: 'Bowls' },
      { name: 'SŌHN Breakfast Sandwich', price: '$14.00', category: 'Sandwiches' },
      { name: 'Galbi Patty Melt', price: '$16.00', category: 'Sandwiches' },
      { name: 'Mayak Gyeran Rice Bowl', price: '$14.00', category: 'Bowls' }
    ]
  },
  {
    name: 'Hotel Utah Saloon',
    cuisines: ['american', 'burgers', 'sandwiches'],
    address: '500 4th St, San Francisco, CA 94107',
    policies: ['pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/hotel-utah-saloon-500-4th-street/r-8596e128-7d77-4c6f-b389-462419413f4b'
    },
    menuItems: [
      { name: 'Loaded Potato Skins', price: '$15.00', category: 'Starters' },
      { name: 'Hot Pastrami Sandwich', price: '$21.00+', category: 'Burgers & Sandwiches' },
      { name: 'Utah Burger', price: '$19.00', category: 'Burgers & Sandwiches' },
      { name: 'Black Bean Burger', price: '$19.00', category: 'Burgers & Sandwiches' },
      { name: 'KFC - Killer Fried Chicken Sandwich', price: '$19.00+', category: 'Burgers & Sandwiches' },
      { name: 'Fries', price: '$8.00+', category: 'Sides' }
    ]
  },
  {
    name: "Town's End Brunch",
    cuisines: ['breakfast', 'brunch', 'american'],
    address: '2 Townsend St, San Francisco, CA 94107',
    policies: ['pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/towns-end-brunch-2-townsend-street/r-6b67465c-92ed-4f9c-a4ac-e941b5d6d0cb'
    },
    menuItems: [
      { name: 'Breakfast Burrito', price: '$17.00', category: 'Featured Items' },
      { name: "Town's End Burger", price: '$15.00', category: 'Lunch and More' },
      { name: 'Chicken Fried Steak', price: '$18.00', category: 'Breakfast' },
      { name: 'Denver Omelette', price: '$17.00', category: 'Breakfast' },
      { name: 'South Of The Border Omelette', price: '$16.00', category: 'Breakfast' },
      { name: 'Single Buttermilk Pancake', price: '$6.00+', category: 'Breakfast' }
    ]
  },
  {
    name: "MoMo's",
    cuisines: ['american', 'pizza', 'seafood'],
    address: '760 2nd St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/momos-760-2nd-street'
    },
    menuItems: [
      { name: 'Ahi Poke Tostada', price: '$28.00', category: 'For the Table' },
      { name: 'Mussels & Fries', price: '$24.00', category: 'For the Table' },
      { name: 'Classic Margherita', price: '$21.00', category: 'Wood Fired Pizzas' },
      { name: 'Pepperoni & Sausage', price: '$25.00', category: 'Wood Fired Pizzas' },
      { name: 'Meatball Sub', price: '$23.00', category: 'Sandwiches' },
      { name: 'French Dip', price: '$26.00', category: 'Sandwiches' }
    ]
  },
  {
    name: 'Mochica',
    cuisines: ['peruvian', 'seafood', 'latin'],
    address: '1469 18th Street, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/mochica-1469-18th-street'
    },
    menuItems: [
      { name: 'Cebiche Pescado', price: '$25.00', category: 'Para Empezar' },
      { name: 'Ceviche Chino', price: '$27.00', category: 'Para Empezar' },
      { name: 'Pan con Chicharron', price: '$18.00', category: 'Sanguches' },
      { name: 'Pan con Pescado', price: '$18.00', category: 'Sanguches' },
      { name: 'Pan con Pollo', price: '$19.00', category: 'Sanguches' },
      { name: 'Huevos a lo Pobre', price: '$23.00', category: 'Main Courses' }
    ]
  },
  {
    name: 'Flour & Branch',
    cuisines: ['brunch', 'bakery', 'breakfast', 'sandwiches'],
    address: '493 3rd Street, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/flour-branch-493-3rd-street'
    },
    menuItems: [
      { name: 'Bagel', price: '$5.00+', category: 'Bagels & Sandwiches' },
      { name: 'Banana Ricotta Pancakes', price: '$18.00', category: 'Brunch' },
      { name: 'Beshert', price: '$19.00', category: 'Brunch' },
      { name: 'The Chipper', price: '$6.00', category: 'Sweets' },
      { name: 'The Brookie', price: '$6.00', category: 'Sweets' },
      { name: 'Pistachio Cream', price: '$6.00', category: 'Sweets' }
    ]
  },
  {
    name: 'The Plant Cafe Organic',
    cuisines: ['american', 'vegetarian', 'breakfast', 'healthy'],
    address: '2335 3rd St, San Francisco, CA 94107',
    policies: ['delivery', 'pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/the-plant-cafe-organic-2335-3rd-st'
    },
    menuItems: [
      { name: 'Spinach & White Cheddar Breakfast Sandwich', price: '$10.50', category: 'Breakfast' },
      { name: 'Bacon & White Cheddar Breakfast Sandwich', price: '$16.50', category: 'Breakfast' },
      { name: 'Breakfast Burrito', price: '$13.00', category: 'Breakfast' },
      { name: 'Power Bowl', price: '$14.00', category: 'Food' },
      { name: 'Pesto Tofu Scramble', price: '$14.00', category: 'Food' }
    ]
  },
  {
    name: 'Underdogs Cantina',
    cuisines: ['mexican', 'tacos', 'latin'],
    address: '128 King Street Suite 102, San Francisco, CA 94107',
    policies: ['pickup'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/underdogs-cantina/r-2ce98c22-2fda-46e8-9f81-2fa4cfd050cb'
    },
    menuItems: [
      { name: 'Chips & Salsa', price: '$6.00', category: 'Antojitos' },
      { name: 'Chips, Salsa, & Guac', price: '$10.75', category: 'Antojitos' },
      { name: 'Nachos', price: '$15.95', category: 'Antojitos' },
      { name: 'Elote', price: '$6.50', category: 'Antojitos' },
      { name: 'Queso Fundido', price: '$9.95', category: 'Antojitos' }
    ]
  },
  {
    name: 'Marlowe',
    cuisines: ['american', 'bistro', 'burgers'],
    address: '500 Brannan Street, San Francisco, CA 94107',
    policies: ['pickup', 'reservation'],
    source: {
      provider: 'magic_city_catalog',
      orderProvider: 'toast_web',
      sourceType: 'scraped_web',
      url: 'https://www.toasttab.com/local/order/marlowe-500-brannan-street/r-8f2c5129-1382-4989-9d17-59cf72bff0e6'
    },
    reservation: {
      provider: 'opentable',
      url: 'https://www.opentable.com/r/marlowe-san-francisco?lang=ja'
    },
    menuItems: [
      { name: 'Herb Crusted Lamb Ribs', price: '$24.00', category: 'Large Plates' },
      { name: 'Spicy Brick Chicken', price: '$30.00', category: 'Large Plates' },
      { name: 'Skirt Steak Salad', price: '$29.00', category: 'Salads' },
      { name: 'Fried Chicken Sandwich', price: '$16.00', category: 'Sandwiches' },
      { name: 'Marlowe Burger', price: '$17.00', category: 'Sandwiches' },
      { name: 'Chocolate Cake', price: '$12.00', category: 'Desserts' }
    ]
  }
];

function normalizeCuisine(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();
}

function matchesCuisine(entry, cuisine) {
  const desired = normalizeCuisine(cuisine);
  if (!desired || desired === 'dinner') return true;
  return entry.cuisines.some((item) => normalizeCuisine(item).includes(desired) || desired.includes(normalizeCuisine(item)));
}

export function get94107Catalog(cuisine = '') {
  const filtered = CATALOG_94107.filter((entry) => matchesCuisine(entry, cuisine));
  return filtered.length ? filtered : CATALOG_94107;
}

export function get94107CatalogEntryByName(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return CATALOG_94107.find((entry) => entry.name.toLowerCase() === normalized) ?? null;
}

function parseMenuPriceUsd(price) {
  const match = String(price || '').match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : 0;
}

export function estimate94107OrderPricing(selections = {}) {
  const entry = get94107CatalogEntryByName(selections.restaurant || '');
  const menuItems = entry?.menuItems ?? [];
  const item1 = selections.item1 || selections.primaryItem || '';
  const item2 = selections.item2 || selections.secondaryItem || '';
  const item1Qty = Number(selections.item1Qty || selections.primaryQuantity || 1) || 1;
  const item2Qty = Number(selections.item2Qty || selections.secondaryQuantity || 1) || 1;
  const lineItems = [
    { name: item1, quantity: item1Qty },
    { name: item2, quantity: item2Qty }
  ]
    .filter((row) => row.name)
    .map((row) => {
      const menuItem = menuItems.find((item) => item.name === row.name) ?? null;
      const unitPriceUsd = parseMenuPriceUsd(menuItem?.price);
      return {
        name: row.name,
        quantity: row.quantity,
        unitPriceUsd,
        totalPriceUsd: Number((unitPriceUsd * row.quantity).toFixed(2)),
        category: menuItem?.category ?? null
      };
    });

  const subtotalUsd = Number(lineItems.reduce((sum, row) => sum + row.totalPriceUsd, 0).toFixed(2));
  return {
    restaurantName: entry?.name ?? selections.restaurant ?? '',
    provider: entry?.source?.provider ?? 'magic_city_catalog',
    orderProvider: entry?.source?.orderProvider ?? null,
    orderUrl: entry?.source?.url ?? null,
    policies: entry?.policies ?? [],
    address: entry?.address ?? null,
    reservation: entry?.reservation ?? null,
    lineItems,
    subtotalUsd
  };
}

export function build94107Discovery(cuisine = '') {
  const restaurants = get94107Catalog(cuisine);
  return {
    mode: 'magic_city_94107_catalog',
    source: 'magic_city_94107_catalog',
    area: {
      zipCode: LOCALIZED_FOOD_ZIP,
      displayName: '94107, San Francisco, California, United States'
    },
    restaurants: restaurants.map((entry, index) => ({
      name: entry.name,
      eta: index % 2 === 0 ? '24-36 min' : '28-40 min',
      total: null,
      highlight: `${entry.cuisines[0]} · ${entry.policies.join(' / ')}`,
      source: entry.source.provider,
      orderProvider: entry.source.orderProvider || null,
      sourceUrl: entry.source.url,
      reservationUrl: entry.reservation?.url || null,
      address: entry.address,
      policies: entry.policies
    })),
    menusByRestaurant: Object.fromEntries(
      restaurants.map((entry) => [entry.name, entry.menuItems])
    ),
    notes: `Pinned Magic City restaurant catalog for ${LOCALIZED_FOOD_ZIP}. Real restaurants, scraped menu items, and direct order or reservation surfaces.`
  };
}
