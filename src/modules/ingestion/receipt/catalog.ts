/**
 * A starter dictionary of what US receipts sell, used to turn a receipt's
 * wording ("GV WHL MLK GL") into the item the user tracks ("Milk") and its
 * brand ("Great Value"), and to spot things that never need restocking.
 *
 * Plain tables, so adding an item or an abbreviation is one line. Terms are
 * matched as whole words, singular or plural ("egg" matches "EGGS"); a longer
 * term beats a shorter one ("paper towels" beats "towel").
 */

export interface CatalogItem {
  name: string;
  category: string;
  /** The unit a new product of this kind is counted in, when it isn't just "each". */
  unit: string | null;
  /** False for things that don't get used up (furniture, electronics...). */
  consumable: boolean;
}

export interface Identified {
  item: CatalogItem | null;
  /** Display name, like "Great Value". */
  brand: string | null;
  /** The receipt's words without the brand's, for naming an item the dictionary doesn't know. */
  withoutBrand: string;
}

// Name | Category | unit ("-" for each) | terms: what receipts call it, abbreviations included.
const CONSUMABLES = `
Milk | Groceries | gallon | milk, mlk, whl mlk, 2% mlk, skim, 1% mlk
Almond Milk | Groceries | carton | almond milk, almondmilk, almd mlk, alm mlk
Oat Milk | Groceries | carton | oat milk, oatmilk
Soy Milk | Groceries | carton | soy milk, soymilk
Half and Half | Groceries | - | half and half, half n half, hlf hlf
Heavy Cream | Groceries | - | heavy cream, hvy crm, whipping cream
Coffee Creamer | Groceries | - | creamer, coffee creamer, coffee mate
Butter | Groceries | - | butter, btr
Eggs | Groceries | eggs | egg, eggs, lg eggs, lrg egg, eggs lrg
Cheese | Groceries | - | cheese, chs, chz, shredded cheese, shred cheese, fiesta shred, cheddar, mozzarella, mozz, american singles
Cream Cheese | Groceries | - | cream cheese, crm chs
Yogurt | Groceries | - | yogurt, yoghurt, yog, ygrt, greek yogurt, gk ygt
Sour Cream | Groceries | - | sour cream, sr crm
Bread | Groceries | loaf | bread, brd, wheat bread, white bread, whl wht, sandwich bread
Bagels | Groceries | - | bagel, bagels
Tortillas | Groceries | - | tortilla, tortillas, tort, flour tortilla
Buns | Groceries | - | bun, buns, hamburger buns, hot dog buns
English Muffins | Groceries | - | english muffin, eng muffin
Bananas | Groceries | - | banana, bananas, bnna, bnn
Apples | Groceries | - | apple, apples, gala, fuji, honeycrisp, granny smith
Oranges | Groceries | - | orange, oranges, navel, mandarin, clementine, cuties
Lemons | Groceries | - | lemon, lemons
Limes | Groceries | - | lime, limes
Grapes | Groceries | - | grape, grapes
Strawberries | Groceries | - | strawberry, strawberries, strwbry, strawbry, strawb
Blueberries | Groceries | - | blueberry, blueberries, blubry, bluebry
Avocados | Groceries | - | avocado, avocados, avo, hass avocado
Tomatoes | Groceries | - | tomato, tomatoes, grape tomato, grape tomatoes, roma, tom
Onions | Groceries | - | onion, onions, yellow onion, red onion
Potatoes | Groceries | - | potato, potatoes, russet
Carrots | Groceries | - | carrot, carrots, baby carrots
Lettuce | Groceries | - | lettuce, romaine, iceberg
Salad Mix | Groceries | - | salad, salad mix, spring mix
Spinach | Groceries | - | spinach, baby spinach
Kale | Groceries | - | kale
Broccoli | Groceries | - | broccoli, broc
Bell Peppers | Groceries | - | bell pepper, green pepper, red pepper, peppers
Cucumbers | Groceries | - | cucumber, cucumbers, cuke
Garlic | Groceries | - | garlic
Celery | Groceries | - | celery
Mushrooms | Groceries | - | mushroom, mushrooms, mush
Cilantro | Groceries | - | cilantro
Chicken Breast | Groceries | lb | chicken breast, chkn brst, chix brst, chk brst, boneless breast, ff bs breast
Chicken Thighs | Groceries | lb | chicken thigh, chkn thgh, thigh, thighs
Chicken Drumsticks | Groceries | lb | drumstick, drumsticks, chicken legs
Chicken | Groceries | lb | chicken, chkn, chix, ckn, whole chicken, rotisserie, roti ckn
Ground Beef | Groceries | lb | ground beef, grnd beef, grd bf, gr beef, grnd bf, hamburger
Steak | Groceries | lb | steak, ribeye, sirloin, ny strip
Pork Chops | Groceries | lb | pork chop, pork chops, pork
Bacon | Groceries | - | bacon, crmb bcn
Sausage | Groceries | - | sausage, sausages, sausg, kielb, bratwurst
Ham | Groceries | - | ham
Ground Turkey | Groceries | lb | ground turkey, grnd turkey
Deli Meat | Groceries | - | deli, deli meat, lunch meat, sliced turkey, turkey breast
Hot Dogs | Groceries | - | hot dog, hot dogs, franks
Salmon | Groceries | lb | salmon
Shrimp | Groceries | lb | shrimp
Tuna | Groceries | can | tuna, chunk light
Fish | Groceries | lb | tilapia, cod, fish fillet
Rice | Groceries | bag | rice, jasmine, basmati
Pasta | Groceries | box | pasta, spaghetti, penne, rotini, linguine, fettuccine, noodles
Mac and Cheese | Groceries | box | mac and cheese, mac cheese, mac n cheese, macaroni cheese
Pasta Sauce | Groceries | jar | pasta sauce, marinara, spag sauce, tomato sauce
Cereal | Groceries | box | cereal, crl, cheerios, frosted flakes, corn flakes, raisin bran
Oatmeal | Groceries | - | oatmeal, oats, quick oats
Flour | Groceries | bag | flour
Sugar | Groceries | bag | sugar
Salt | Groceries | - | salt
Black Pepper | Groceries | - | black pepper, ground pepper
Cooking Oil | Groceries | bottle | oil, vegetable oil, veg oil, olive oil, evoo, canola, canola oil
Peanut Butter | Groceries | jar | peanut butter, peanut buttr, pnt btr, pnut butter, pb
Jelly | Groceries | jar | jelly, jam, preserves
Honey | Groceries | - | honey
Ketchup | Groceries | bottle | ketchup, catsup
Mustard | Groceries | bottle | mustard
Mayonnaise | Groceries | jar | mayo, mayonnaise
Salad Dressing | Groceries | bottle | dressing, ranch, vinaigrette
Soup | Groceries | can | soup, chicken noodle, onionsoup
Canned Beans | Groceries | can | beans, black beans, pinto beans, kidney beans, refried beans
Broth | Groceries | carton | broth, stock, bone broth
Maple Syrup | Groceries | bottle | syrup, maple syrup, pancake syrup
Pancake Mix | Groceries | box | pancake mix, pancake, bisquick
Coffee | Groceries | bag | coffee, cof, ground coffee, coffee beans, whole bean, light roast, medium roast, dark roast, french roast, folgers, maxwell house
Coffee Pods | Groceries | pods | k cup, k cups, kcup, kcups, coffee pods, keurig
Tea | Groceries | box | tea, tea bags, green tea
Granola Bars | Groceries | box | granola bar, granola bars, protein bar, cereal bar
Chips | Groceries | bag | chips, chip, tortilla chips, potato chips, doritos, lays, pringles
Crackers | Groceries | box | crackers, cracker, goldfish, ritz, cheez it
Cookies | Groceries | - | cookie, cookies, oreo, oreos
Popcorn | Groceries | - | popcorn
Nuts | Groceries | bag | nuts, almonds, cashews, peanuts, walnuts, pecans, trail mix
Salsa | Groceries | jar | salsa, jackorgsalsa
Frozen Pizza | Groceries | - | pizza, frz pizza, frozen pizza
Ice Cream | Groceries | - | ice cream, ice crm
Frozen Vegetables | Groceries | bag | frozen veg, frz veg, frozen vegetables, mixed vegetables, mixed vegg
Frozen Meals | Groceries | - | frozen meal, frozen dinner, entree, pot pie
Water | Beverages | case | water, spring water, drinking water, purified water, bottled water
Sparkling Water | Beverages | case | sparkling water, seltzer, sparkling, lacroix, bubly
Soda | Beverages | - | soda, cola, coke, diet coke, pepsi, sprite, dr pepper, mountain dew, ginger ale, root beer
Juice | Beverages | bottle | juice, oj, orange juice, apple juice, cranberry juice
Sports Drink | Beverages | - | sports drink, gatorade, powerade
Energy Drink | Beverages | - | energy drink, red bull, monster energy, celsius
Beer | Beverages | - | beer, lager, ipa
Wine | Beverages | bottle | wine, chardonnay, cabernet, merlot, pinot, sauvignon, rose wine, sparkling wine
Kombucha | Beverages | bottle | kombucha
Toilet Paper | Household | rolls | toilet paper, bath tissue, toilet tissue, tp, bth tiss, bath tiss, bathroom tissue
Paper Towels | Household | rolls | paper towels, paper towel, ppr twl, ppr towel, ppr twls, towel roll
Facial Tissues | Household | boxes | tissues, facial tissue, facial tissues
Napkins | Household | pack | napkins, napkin
Paper Plates | Household | pack | paper plate, paper plates, foam plate, plastic plates
Disposable Cups | Household | pack | plastic cups, paper cups, solo cups, foam cups
Trash Bags | Household | bags | trash bags, trash bag, garbage bags, garbage bag, kitchen bags, tall kitchen
Storage Bags | Household | pack | storage bags, sandwich bags, freezer bags, zipper bags, ziploc
Aluminum Foil | Household | roll | foil, aluminum foil, alum foil
Plastic Wrap | Household | roll | plastic wrap, cling wrap, saran
Laundry Detergent | Household | bottle | laundry detergent, detergent, det, laundry det, liq det, liquid detergent
Laundry Pods | Household | pods | laundry pods, pacs, laundry pacs, tideoxipods
Fabric Softener | Household | bottle | fabric softener, softener, fab soft
Dryer Sheets | Household | box | dryer sheets, dryer sheet
Bleach | Household | bottle | bleach
Dish Soap | Household | bottle | dish soap, dish liquid, dishwashing liquid, dish det
Dishwasher Detergent | Household | box | dishwasher detergent, dishwasher pods, dw det, dishwasher tabs
Sponges | Household | pack | sponge, sponges, scrub sponge
All-Purpose Cleaner | Household | bottle | cleaner, all purpose, multi surface, spray cleaner, kitchen cleaner, bathroom cleaner
Disinfecting Wipes | Household | pack | disinfecting wipes, clorox wipes, lysol wipes, cleaning wipes, swifr wet
Glass Cleaner | Household | bottle | glass cleaner, windex
Air Freshener | Household | - | air freshener, febreze
Light Bulbs | Household | pack | light bulb, light bulbs, led bulb, bulbs
Batteries | Household | batteries | battery, batteries, aa, aaa, duracell, energizer
Shampoo | Personal Care | bottle | shampoo, shmp, panteneshamp
Conditioner | Personal Care | bottle | conditioner, cond
Body Wash | Personal Care | bottle | body wash, bodywash, shower gel
Bar Soap | Personal Care | bars | bar soap, soap bar, soap bars
Hand Soap | Personal Care | bottle | hand soap, hand wash, liquid soap, soft soap
Toothpaste | Personal Care | tube | toothpaste, tthpst, tooth paste
Toothbrushes | Personal Care | - | toothbrush, toothbrushes, tooth brush
Mouthwash | Personal Care | bottle | mouthwash, mouth wash, mouth rinse
Dental Floss | Personal Care | - | floss, dental floss
Deodorant | Personal Care | - | deodorant, deo, antiperspirant
Razors | Personal Care | pack | razor, razors, razor blades, cartridges
Shaving Cream | Personal Care | can | shaving cream, shave gel, shave cream
Lotion | Personal Care | bottle | lotion, moisturizer, body lotion
Sunscreen | Personal Care | bottle | sunscreen, sunblock, spf
Cotton Swabs | Personal Care | pack | cotton swabs, cotton swab, q tips, qtips
Cotton Balls | Personal Care | pack | cotton balls, cotton rounds
Pads | Personal Care | pack | maxi pads, pads, liners, panty liners
Tampons | Personal Care | box | tampons, tampon
Contact Solution | Personal Care | bottle | contact solution, saline solution
Diapers | Baby | diapers | diaper, diapers
Baby Wipes | Baby | pack | baby wipes, wipes
Baby Formula | Baby | can | formula, infant formula
Baby Food | Baby | - | baby food, puree pouch
Dog Food | Pet | bag | dog food, dog fd, kibble, pedigree
Cat Food | Pet | - | cat food, cat fd, friskies, meow mix, fancy feast
Cat Litter | Pet | box | cat litter, litter, kitty litter, tidy cats, fresh step
Pet Treats | Pet | bag | dog treats, cat treats, treats, milk bone
Pain Reliever | Health | bottle | pain reliever, ibuprofen, ibu, acetaminophen, aspirin, advil, tylenol, motrin, aleve
Vitamins | Health | bottle | vitamin, vitamins, multivitamin, gummies
Allergy Medicine | Health | box | allergy, claritin, zyrtec, allegra, benadryl
Cold Medicine | Health | box | cold and flu, dayquil, nyquil, cough syrup, mucinex
Bandages | Health | box | bandage, bandages, band aid, bandaids
`;

// Category: terms. Shown in the list but unticked by default.
const DURABLES = `
furniture: chair, table, desk, sofa, couch, bed frame, dresser, bookcase, bookshelf, shelf, cabinet, stool, ottoman, nightstand, futon, recliner, bench, mattress
home decor: lamp, rug, curtain, curtains, mirror, picture frame, frame, vase, clock, pillow, throw, blanket, comforter, duvet, sheet set, quilt, artificial plant, wall art
electronics: tv, television, laptop, tablet, ipad, iphone, phone, headphones, earbuds, airpods, speaker, charger, cable, hdmi, usb, monitor, keyboard, mouse, printer, router, camera, console, controller, smartwatch, power bank, extension cord, surge protector
appliances: microwave, toaster, blender, kettle, coffee maker, vacuum, fan, heater, air fryer, hair dryer, mixer, instant pot
kitchenware: pan, frying pan, skillet, knife, knives, spatula, cutting board, dinnerware, bowl set, plate set, mug, mugs, drinking glasses, tumbler, water bottle, utensils, cookware, bakeware, container set
clothing: shirt, tee, t shirt, pants, jeans, shorts, dress, skirt, socks, jacket, coat, hoodie, sweater, shoes, sneakers, boots, sandals, hat, underwear, bra, pajamas, leggings, gloves, scarf
toys and games: toy, toys, lego, doll, figure, figures, action figure, cutie car, puzzle, board game, video game, plush
tools: hammer, drill, screwdriver, wrench, tool, toolkit, ladder, tape measure, flashlight, hose, rake, shovel
other durable goods: book, backpack, umbrella, bike, bicycle, luggage, suitcase, gift card, storage bin, hanger, hangers, basket, towel, bath towel, beach towel, shower curtain, slipper, slippers, snorkel, snorkel set, grill cover
`;

// Name | terms | the item a brand on its own means, if it only makes one thing.
const BRANDS = `
Great Value | gv, great value, grt val |
Kirkland Signature | ks, kirkland, kirkland signature, kirk sig |
Member's Mark | mm, members mark |
Good & Gather | good gather, gg |
up&up | up up, upup |
Market Pantry | market pantry, mkt pantry |
365 | 365, whole foods 365 |
Equate | equate |
Parent's Choice | parents choice |
Simple Truth | simple truth |
Kroger | kroger |
Signature Select | signature select |
Trader Joe's | trader joes |
Charmin | charmin | Toilet Paper
Cottonelle | cottonelle | Toilet Paper
Angel Soft | angel soft | Toilet Paper
Quilted Northern | quilted northern | Toilet Paper
Bounty | bounty | Paper Towels
Scott | scott |
Kleenex | kleenex | Facial Tissues
Puffs | puffs | Facial Tissues
Tide | tide | Laundry Detergent
Gain | gain | Laundry Detergent
Persil | persil | Laundry Detergent
All | all free clear | Laundry Detergent
Downy | downy | Fabric Softener
Bounce | bounce | Dryer Sheets
Clorox | clorox |
Lysol | lysol |
Dawn | dawn | Dish Soap
Palmolive | palmolive | Dish Soap
Cascade | cascade | Dishwasher Detergent
Finish | finish | Dishwasher Detergent
Glad | glad | Trash Bags
Hefty | hefty |
Ziploc | ziploc | Storage Bags
Reynolds | reynolds | Aluminum Foil
Febreze | febreze | Air Freshener
Windex | windex | Glass Cleaner
Swiffer | swiffer |
Mr. Clean | mr clean |
Scrub Daddy | scrub daddy | Sponges
Colgate | colgate | Toothpaste
Crest | crest | Toothpaste
Oral-B | oral b |
Listerine | listerine | Mouthwash
Dove | dove |
Olay | olay |
Gillette | gillette | Razors
Schick | schick | Razors
Old Spice | old spice |
Degree | degree | Deodorant
Secret | secret | Deodorant
Head & Shoulders | head shoulders | Shampoo
Pantene | pantene |
Neutrogena | neutrogena |
Aveeno | aveeno |
Cetaphil | cetaphil |
Pampers | pampers | Diapers
Huggies | huggies | Diapers
Luvs | luvs | Diapers
Similac | similac | Baby Formula
Enfamil | enfamil | Baby Formula
Purina | purina |
Friskies | friskies | Cat Food
Meow Mix | meow mix | Cat Food
Fancy Feast | fancy feast | Cat Food
Iams | iams |
Pedigree | pedigree | Dog Food
Blue Buffalo | blue buffalo |
Tidy Cats | tidy cats | Cat Litter
Fresh Step | fresh step | Cat Litter
Arm & Hammer | arm hammer |
Horizon | horizon | Milk
Fairlife | fairlife | Milk
Lactaid | lactaid | Milk
Silk | silk |
Oatly | oatly | Oat Milk
Chobani | chobani | Yogurt
Yoplait | yoplait | Yogurt
Dannon | dannon | Yogurt
Tillamook | tillamook |
Kraft | kraft |
Heinz | heinz |
Barilla | barilla | Pasta
Kellogg's | kelloggs |
General Mills | general mills |
Quaker | quaker |
Folgers | folgers | Coffee
Maxwell House | maxwell house | Coffee
Starbucks | starbucks |
Dunkin' | dunkin |
Lavazza | lavazza | Coffee
Coca-Cola | coca cola, coke | Soda
Pepsi | pepsi | Soda
LaCroix | lacroix | Sparkling Water
Gatorade | gatorade | Sports Drink
Nature Valley | nature valley | Granola Bars
Lay's | lays | Chips
Frito-Lay | frito lay | Chips
Tyson | tyson |
Oscar Mayer | oscar mayer |
Hillshire Farm | hillshire |
Nature's Own | natures own | Bread
Wonder | wonder | Bread
Sara Lee | sara lee |
Dave's Killer Bread | daves killer | Bread
Duracell | duracell | Batteries
Energizer | energizer | Batteries
Advil | advil | Pain Reliever
Tylenol | tylenol | Pain Reliever
Band-Aid | band aid | Bandages
`;

const STEMS: [RegExp, string][] = [
  [/ies$/, "y"],
  [/oes$/, "o"],
  [/([^s])s$/, "$1"],
];
/** "berries" -> "berry", "tomatoes" -> "tomato", "eggs" -> "egg". Short words are left alone. */
const stem = (word: string) => {
  if (word.length <= 3) return word;
  for (const [pattern, replacement] of STEMS) if (pattern.test(word)) return word.replace(pattern, replacement);
  return word;
};

/** Words, as written, and their matching keys. Apostrophes join a word ("member's" -> "members"). */
function words(text: string): { text: string; key: string }[] {
  return text
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}%]+/u)
    .filter((word) => word && word.toLowerCase() !== "and")
    .map((word) => ({ text: word, key: stem(word.toLowerCase()) }));
}

interface Entry<T> {
  keys: string[];
  value: T;
}

function entries<T>(terms: string, value: T): Entry<T>[] {
  return terms
    .split(",")
    .map((term) => words(term.trim()).map((word) => word.key))
    .filter((keys) => keys.length > 0)
    .map((keys) => ({ keys, value }));
}

const ITEMS: Entry<CatalogItem>[] = [
  ...CONSUMABLES.trim()
    .split("\n")
    .flatMap((line) => {
      const [name, category, unit, terms] = line.split("|").map((part) => part.trim());
      return entries(terms, { name, category, unit: unit === "-" ? null : unit, consumable: true });
    }),
  ...DURABLES.trim()
    .split("\n")
    .flatMap((line) => {
      const [category, terms] = line.split(":").map((part) => part.trim());
      return entries(terms, { name: "", category, unit: null, consumable: false });
    }),
];

const ITEMS_BY_NAME = new Map(ITEMS.filter((e) => e.value.consumable).map((e) => [e.value.name, e.value]));

const BRAND_ENTRIES: Entry<{ name: string; implies: CatalogItem | null }>[] = BRANDS.trim()
  .split("\n")
  .flatMap((line) => {
    const [name, terms, implies] = line.split("|").map((part) => part.trim());
    return entries(terms, { name, implies: implies ? (ITEMS_BY_NAME.get(implies) ?? null) : null });
  });

/** Where `keys` appears as a run in `within`, or -1. */
function findRun(within: string[], keys: string[]): number {
  for (let start = 0; start + keys.length <= within.length; start++) {
    if (keys.every((key, i) => within[start + i] === key)) return start;
  }
  return -1;
}

/** The entry with the longest term found in the words. On a tie the earlier entry wins (consumables come first). */
function longestMatch<T>(keys: string[], list: Entry<T>[]) {
  let best: { entry: Entry<T>; at: number } | null = null;
  for (const entry of list) {
    if (best && entry.keys.length <= best.entry.keys.length) continue;
    const at = findRun(keys, entry.keys);
    if (at !== -1) best = { entry, at };
  }
  return best;
}

/** What the dictionary can tell about one receipt line. */
export function identify(receiptName: string): Identified {
  const all = words(receiptName);
  const keys = all.map((word) => word.key);

  const brand = longestMatch(keys, BRAND_ENTRIES);
  const brandWords = brand ? new Set(brand.entry.keys.map((_, i) => brand.at + i)) : new Set<number>();
  // Look for the item outside the brand's words, so "Bounty" doesn't also count as a word of the item.
  const rest = all.filter((_, i) => !brandWords.has(i));
  const item = longestMatch(
    rest.map((word) => word.key),
    ITEMS,
  );

  return {
    item: item?.entry.value ?? brand?.entry.value.implies ?? null,
    brand: brand?.entry.value.name ?? null,
    withoutBrand: rest.map((word) => word.text).join(" "),
  };
}

/** How many consumable items the dictionary knows, for tests and curiosity. */
export const CATALOG_SIZE = ITEMS_BY_NAME.size;
