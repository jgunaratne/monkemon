// Monkemon — Sky-Vine Tree & 77 Golden Banana Relics Storyline!
// A clear, upbeat, easy-to-follow Monkemon adventure across 10 Sky-Vine Worlds:
//   • Premise: 10 islands float along the giant Sky-Vine Tree, held together by 77 Golden Banana Relics.
//   • Explorer Dad set out ahead of you to protect the Relics from Team Brash, leaving you his Banana Compass (#1/77).
//   • Recurring Cast: Mom, Explorer Dad, Sensei Bob, Sage Liana, Scout Kai, Boss Brash, Solar Kong (#19) & King Monkezilla (#20)!

export const TOTAL_BANANA_RELICS = 77;

export const KEY_ITEMS_META = {
  prism_detector: {
    id: 'prism_detector',
    name: 'Dad’s Banana Compass (#1/77)',
    icon: '💎',
    desc: 'A glowing Golden Relic left by Explorer Dad! Shows how many Relics are still hidden in your current World.',
  },
  prism_blessing: {
    id: 'prism_blessing',
    name: 'Sky-Vine Spark',
    icon: '✨',
    desc: 'A warm charm from Sage Liana that wakes up sleeping Sky-Vine Pillars.',
  },
  kai_mask_gear: {
    id: 'kai_mask_gear',
    name: 'Scout Kai’s Backpack',
    icon: '🎒',
    desc: 'Recovered inside Mirage Tower so desert ranger Kai can team up with you against Boss Brash.',
  },
  mini_shrinker: {
    id: 'mini_shrinker',
    name: 'Tiny-Ray Gadget',
    icon: '🔬',
    desc: 'A playful shrinking ray from the Giant’s Manor! Lets you shrink down to clear Boss Brash’s sleep-spores.',
  },
  pippa_locket: {
    id: 'pippa_locket',
    name: 'Scout Whistle',
    icon: '📿',
    desc: 'A thank-you gift from young Camper Pippa after guiding her safely out of North Mountain Cave.',
  },
  true_eye: {
    id: 'true_eye',
    name: 'Glow-Sight Pearl',
    icon: '👁️',
    desc: 'Found inside the Undersea Volcano; dims the dazzling crystal glare inside Bright Cave.',
  },
  heroic_melody: {
    id: 'heroic_melody',
    name: 'Jukebox Token',
    icon: '🎵',
    desc: 'Plays Dad’s favorite tune on the Pine Cabin jukebox, opening the trapdoor to his Ranger Hideout!',
  },
  sewer_key: {
    id: 'sewer_key',
    name: 'Waterway Gate Key',
    icon: '🗝️',
    desc: 'Opens the secret canal tunnel beneath Gold City after Queen Vana locked the main gates.',
  },
  smuggler_ledger: {
    id: 'smuggler_ledger',
    name: 'Harbor Crate Map',
    icon: '📜',
    desc: 'Found on the harbor cargo ship with Sensei Bob, showing where Lord Gouda hid Snow Town’s stolen Relics!',
  },
  sky_lance: {
    id: 'sky_lance',
    name: 'Starlight Spear',
    icon: '🔱',
    desc: 'A gleaming sky-tamer spear won in the Cloud Maze (+15% Squad Attack power!).',
  },
  aegis_charm: {
    id: 'aegis_charm',
    name: 'Cloud Shield Charm',
    icon: '🛡️',
    desc: 'Awarded by Elder Bamboon after your friendly Cloud Hall trial; protects your Monkemon at the Summit!',
  },
  banana_calibur: {
    id: 'banana_calibur',
    name: 'Golden Banana-Blade',
    icon: '⚔️',
    desc: 'Found beside Explorer Dad in the Volcano Bastion; boosts every Monkemon move in the final showdown!',
  },
  goddess_heart: {
    id: 'goddess_heart',
    name: 'Sky-Tree Core Seed',
    icon: '💛',
    desc: 'The true heart of the Sky-Vine Tree! Keeps all 10 Worlds steady when the 77 Relics come together.',
  },
  seven_blade: {
    id: 'seven_blade',
    name: 'Seven-Star Baton',
    icon: '🗡️',
    desc: 'Rare champion baton won from the Ancient Clay Guardian at the Summit Shrine (+10% Crit power!).',
  },
};

// Friendly Guest Companions who walk beside you in 3D and cheer/assist in battle!
export const GUEST_COMPANIONS = {
  sensei_bob: {
    id: 'sensei_bob',
    name: 'Sensei Bob',
    role: 'Hometown Teacher',
    icon: '🎓',
    modelGlb: 'assets/models/senseibob.glb',
    primaryColor: '#38bdf8',
    assistName: 'Sensei Palm Strike',
    assistElement: 'bob',
    assistBonusDmg: 0.28,
    assistHealPct: 0.08,
    desc: 'Your friendly Hometown teacher! Helps guide your new Monkemon squad safely through North Cave.',
  },
  mystic_liana: {
    id: 'mystic_liana',
    name: 'Sage Liana',
    role: 'Sky-Vine Keeper',
    icon: '⚡',
    modelGlb: 'assets/models/mysticlangur.glb',
    primaryColor: '#c084fc',
    assistName: 'Sky-Vine Spark Bolt',
    assistElement: 'stuffie',
    assistBonusDmg: 0.34,
    assistHealPct: 0.1,
    desc: 'Guardian of the Sky-Vine Shrine! Teams up with you to chase Boss Brash out of the North Fort.',
  },
  masked_kai: {
    id: 'masked_kai',
    name: 'Scout Kai',
    role: 'Desert Ranger',
    icon: '🧭',
    modelGlb: 'assets/models/trainer_scout.glb',
    primaryColor: '#f59e0b',
    assistName: 'Dune Dash Strike',
    assistElement: 'dog',
    assistBonusDmg: 0.32,
    assistHealPct: 0,
    desc: 'A cheerful desert ranger and friend of your Dad who helps you climb Mirage Tower.',
  },
  dad_rex: {
    id: 'dad_rex',
    name: 'Explorer Dad',
    role: 'Sky-Vine Ranger',
    icon: '⭐',
    modelGlb: 'assets/models/trainer_warden.glb',
    primaryColor: '#facc15',
    assistName: 'Dad’s Star Slam',
    assistElement: 'mug',
    assistBonusDmg: 0.38,
    assistHealPct: 0.12,
    desc: 'Your adventurous Dad! Travels the 10 Sky-Vine Worlds to keep the 77 Golden Relics safe.',
  },
  hana_bob: {
    id: 'hana_bob',
    name: 'Sensei Bob',
    role: 'Traveling Mentor',
    icon: '🥋',
    modelGlb: 'assets/models/senseibob.glb',
    primaryColor: '#fb7185',
    assistName: 'Double Dojo Chop',
    assistElement: 'bob',
    assistBonusDmg: 0.3,
    assistHealPct: 0.08,
    desc: 'Sensei Bob meets up with you again in Snow Canal Town to take back the stolen Relics from Lord Gouda!',
  },
  goddess_liana: {
    id: 'goddess_liana',
    name: 'Sage Liana (Awakened)',
    role: 'Guardian of the Sky-Tree',
    icon: '🌟',
    modelGlb: 'assets/models/mysticlangur.glb',
    primaryColor: '#fde047',
    assistName: 'Golden Canopy Blessing',
    assistElement: 'stuffie',
    assistBonusDmg: 0.36,
    assistHealPct: 0.22,
    desc: 'Powered up by the Sky-Tree Core Seed! Heals and shields your Monkemon against #20 King Monkezilla!',
  },
};

export function getGuestCompanion(state) {
  const id = state && state.guestCompanion;
  return id && GUEST_COMPANIONS[id] ? GUEST_COMPANIONS[id] : null;
}

// Exact 77-Relic Ledger (`1` Dad's Banana Compass + `76` across the 10 Worlds = `77`!)
export const WORLD_RELIC_LEDGER = [
  // Starting Gift from Explorer Dad (1)
  { id: 'relic:dad_prism', zoneId: 'sunpalm', count: 1, label: 'Dad’s Banana Compass (Alex’s House)' },

  // World 1: Sunpalm Island (13)
  { id: 'chest:ncave_chest_1', zoneId: 'sunpalm', count: 1, label: 'North Passage Cave Chest' },
  { id: 'chest:ruins_west_vault', zoneId: 'sunpalm', count: 1, label: 'Sun-Baked Pyramid Chest' },
  { id: 'npc:mystic_liana_blessing', zoneId: 'sunpalm', count: 1, label: 'Sage Liana’s Shrine Gift' },
  { id: 'chest:wbase_west_chest', zoneId: 'sunpalm', count: 1, label: 'North Fort Supply Chest' },
  { id: 'trainer:boss_brash_vanguard', zoneId: 'sunpalm', count: 2, label: 'North Fort Captain' },
  { id: 'chest:micro_left_hand', zoneId: 'sunpalm', count: 1, label: 'Tiny-Ray Spore Cavern (West)' },
  { id: 'chest:micro_right_hand', zoneId: 'sunpalm', count: 1, label: 'Tiny-Ray Spore Cavern (East)' },
  { id: 'chest:micro_stomach', zoneId: 'sunpalm', count: 1, label: 'Tiny-Ray Spore Cavern (Center)' },
  { id: 'chest:micro_feet', zoneId: 'sunpalm', count: 1, label: 'Tiny-Ray Spore Cavern (South)' },
  { id: 'trainer:boss_micro_phage', zoneId: 'sunpalm', count: 3, label: 'Sleep-Spore Boss' },

  // World 2: Amber Oasis Dunes (7)
  { id: 'chest:canopy_oasis_chest', zoneId: 'canopy', count: 1, label: 'Oasis Palm Relic Chest' },
  { id: 'trainer:warden_skippy', zoneId: 'canopy', count: 1, label: 'Peanut Butter House (Master Skippy)' },
  { id: 'chest:tower_kai_gear', zoneId: 'canopy', count: 1, label: 'Mirage Tower (Kai’s Pack Chest)' },
  { id: 'chest:tower_west_relic', zoneId: 'canopy', count: 1, label: 'Mirage Tower West Hall' },
  { id: 'trainer:boss_general_brash', zoneId: 'canopy', count: 3, label: 'Boss Brash (Mirage Tower Top)' },

  // World 3: Giant's Woods & Estate (3)
  { id: 'chest:giants_courtyard_chest', zoneId: 'giants_realm', count: 1, label: 'Giant’s Courtyard Chest' },
  { id: 'chest:giant_floor_chest', zoneId: 'giants_realm', count: 1, label: 'Giant’s Manor Hall Chest' },
  { id: 'chest:giant_micron_chest', zoneId: 'giants_realm', count: 1, label: 'Giant’s Bookcase (Tiny-Ray Chest)' },

  // World 4: Solar Lagoon & Port (10)
  { id: 'npc:pippa_mountain_rescue', zoneId: 'sparkstone', count: 2, label: 'North Mountain Cave (Camper Pippa)' },
  { id: 'chest:mtcave_west', zoneId: 'sparkstone', count: 1, label: 'North Mountain Cave Ledge' },
  { id: 'trainer:warden_marina', zoneId: 'sparkstone', count: 1, label: 'Fish House Port (Captain Marina)' },
  { id: 'chest:uvolcano_pearl_chest', zoneId: 'sparkstone', count: 1, label: 'Undersea Volcano Pearl Chest' },
  { id: 'trainer:boss_caldera_geartail', zoneId: 'sparkstone', count: 2, label: 'Undersea Volcano Guardian' },
  { id: 'chest:light_cave_prism_1', zoneId: 'sparkstone', count: 2, label: 'Bright Cave Crystal Vault' },
  { id: 'chest:light_cave_prism_2', zoneId: 'sparkstone', count: 1, label: 'Bright Cave Sunbeam Ledge' },

  // World 5: Pine Valley & Dad's Hideout (6)
  { id: 'chest:gbase_west_vault', zoneId: 'guardian_realm', count: 1, label: 'Dad’s Hideout West Chest' },
  { id: 'chest:gbase_east_vault', zoneId: 'guardian_realm', count: 1, label: 'Dad’s Hideout East Chest' },
  { id: 'npc:dad_guardian_reunion', zoneId: 'guardian_realm', count: 2, label: 'Reunion with Explorer Dad' },
  { id: 'chest:mlair_canyon_chest', zoneId: 'guardian_realm', count: 1, label: 'Monster Gorge Cliff Chest' },
  { id: 'trainer:boss_gorge_raider', zoneId: 'guardian_realm', count: 1, label: 'Monster Gorge Boss' },

  // World 6: Gold City & Crater (7)
  { id: 'chest:sewer_west_ledge', zoneId: 'metropolis_realm', count: 1, label: 'Waterway West Chest' },
  { id: 'chest:sewer_east_ledge', zoneId: 'metropolis_realm', count: 1, label: 'Waterway East Chest' },
  { id: 'chest:svolcano_core_chest', zoneId: 'metropolis_realm', count: 2, label: 'Crater Volcano Core Chest' },
  { id: 'chest:vpalace_treasury', zoneId: 'metropolis_realm', count: 1, label: 'Gold Palace Vault' },
  { id: 'trainer:boss_queen_vana', zoneId: 'metropolis_realm', count: 2, label: 'Queen Vana (Gold Palace)' },

  // World 7: Grand Derby Valley (4)
  { id: 'chest:race_pit_chest', zoneId: 'race_realm', count: 1, label: 'Winner’s Circle Chest' },
  { id: 'chest:race_chicane_chest', zoneId: 'race_realm', count: 1, label: 'S-Curve Track Chest' },
  { id: 'trainer:boss_derby_ace', zoneId: 'race_realm', count: 2, label: 'Derby Champion Flash' },

  // World 8: Snow Canal Capital (4)
  { id: 'chest:harbor_ledger_chest', zoneId: 'frostpeak', count: 1, label: 'Harbor Ship Chest' },
  { id: 'trainer:warden_truffle', zoneId: 'frostpeak', count: 1, label: 'Pork House (Master Truffle)' },
  { id: 'trainer:boss_lord_gouda', zoneId: 'frostpeak', count: 2, label: 'Lord Gouda (Snow Keep Roof)' },

  // World 9: Starry Cloud Isles (9)
  { id: 'chest:gauntlet_entry_relic', zoneId: 'cloud_realm', count: 1, label: 'Cloud Maze Chest' },
  { id: 'chest:cloud_isle_chest', zoneId: 'cloud_realm', count: 1, label: 'Starlight Cloud Island Chest' },
  { id: 'chest:cloud_east_wing', zoneId: 'cloud_realm', count: 2, label: 'Cloud Hall East Chest' },
  { id: 'trainer:boss_skyfather_bamboon', zoneId: 'cloud_realm', count: 5, label: 'Elder Bamboon (Cloud Hall Trial)' },

  // World 10: Volcano Summit & Sky Shrine (13)
  { id: 'chest:final_west_bastion', zoneId: 'cinderpeak', count: 1, label: 'Summit Bastion Chest' },
  { id: 'chest:final_banana_calibur', zoneId: 'cinderpeak', count: 1, label: 'Golden Banana-Blade Pedestal' },
  { id: 'chest:crater_bridge_chest', zoneId: 'cinderpeak', count: 2, label: 'Summit Lava Bridge Chest' },
  { id: 'trainer:champion_chuck', zoneId: 'cinderpeak', count: 2, label: 'Beef House (Champion Chuck)' },
  { id: 'trainer:boss_solar_betrayer', zoneId: 'cinderpeak', count: 4, label: 'Solar Kong (#19)' },
  { id: 'boss:king_monkezilla', zoneId: 'cinderpeak', count: 3, label: 'King Monkezilla (#20)' },
];

export function getZoneRelicStatus(state, zoneId) {
  const collected = new Set((state && state.collectedRelicIds) || []);
  let total = 0;
  let found = 0;
  for (const entry of WORLD_RELIC_LEDGER) {
    if (entry.zoneId !== zoneId) continue;
    total += entry.count;
    if (collected.has(entry.id)) found += entry.count;
  }
  return {
    found,
    total,
    remaining: Math.max(0, total - found),
  };
}

// Clear, simple, 1-goal-at-a-time Chapter Tracker!
export const STORY_CHAPTERS = [
  {
    chapter: 1,
    id: 'ch1_hometown_cave',
    zoneId: 'sunpalm',
    title: 'World 1 — Meet Sensei Bob & Cross North Cave',
    objective: 'Visit Sensei Bob’s School in Hometown Bay to get your rookie squad, then walk north through North Passage Cave!',
    doneWhenFlag: 'cleared_north_cave',
  },
  {
    chapter: 2,
    id: 'ch2_first_realm_base',
    zoneId: 'sunpalm',
    title: 'World 1 — Help Sage Liana Open the Sky-Vine',
    objective: 'Meet Sage Liana at her West Shrine, then clear Boss Brash’s crew from the North Fort to wake up Sky-Vine Pillar #1!',
    doneWhenFlag: 'defeated_brash_base',
  },
  {
    chapter: 3,
    id: 'ch3_dune_tower',
    zoneId: 'canopy',
    title: 'World 2 — Peanut Butter House & Mirage Tower',
    objective: 'Earn Badge #1 at Peanut Butter House and beat Boss Brash atop Mirage Tower in the eastern dunes!',
    doneWhenFlag: 'defeated_brash_tower',
  },
  {
    chapter: 4,
    id: 'ch4_giants_manor',
    zoneId: 'giants_realm',
    title: 'World 3 — Find the Tiny-Ray in Giant’s Manor',
    objective: 'Cross into the Giant’s Walled Estate and climb the Giant’s Manor bookcase to get the Tiny-Ray!',
    doneWhenKeyItem: 'mini_shrinker',
  },
  {
    chapter: 5,
    id: 'ch5_micro_sanctum',
    zoneId: 'sunpalm',
    title: 'World 1 — Cure Sage Liana with the Tiny-Ray',
    objective: 'Take the Sky-Vine back to Sage Liana’s Shrine in World 1 and clear the sleep-spores so she feels great again!',
    doneWhenFlag: 'healed_mystic_liana',
  },
  {
    chapter: 6,
    id: 'ch6_solar_lagoon',
    zoneId: 'sparkstone',
    title: 'World 4 — Fish House & Undersea Volcano',
    objective: 'Earn Badge #2 at Fish House Port and get the Glow-Sight Pearl from the southern Undersea Volcano!',
    doneWhenKeyItem: 'true_eye',
  },
  {
    chapter: 7,
    id: 'ch7_guardian_bunker',
    zoneId: 'guardian_realm',
    title: 'World 5 — Find Explorer Dad in Pine Valley',
    objective: 'Enter the Pine Cabin and play the Jukebox to open the secret stairs to Explorer Dad’s Hideout!',
    doneWhenFlag: 'met_dad_guardian_base',
  },
  {
    chapter: 8,
    id: 'ch8_monster_gorge',
    zoneId: 'guardian_realm',
    title: 'World 5 — Team Up with Dad in Monster Gorge',
    objective: 'Head northwest into Monster Gorge with Explorer Dad to rescue lost Relics and open Sky-Vine #5!',
    doneWhenFlag: 'cleared_monster_gorge',
  },
  {
    chapter: 9,
    id: 'ch9_metropolis_volcano',
    zoneId: 'metropolis_realm',
    title: 'World 6 — Unlock Gold City’s Gates',
    objective: 'Grab the Waterway Key beneath the city, visit Crater Volcano, and beat greedy Queen Vana inside Gold Palace!',
    doneWhenFlag: 'freed_gilded_metropolis',
  },
  {
    chapter: 10,
    id: 'ch10_race_circuit',
    zoneId: 'race_realm',
    title: 'World 7 — Win the Grand S-Curve Derby!',
    objective: 'Pick a speedy mount at Paddock Stables and dash across the S-Curve Raceway boost pads to win the Trophy!',
    doneWhenFlag: 'won_grand_derby',
  },
  {
    chapter: 11,
    id: 'ch11_canal_castle',
    zoneId: 'frostpeak',
    title: 'World 8 — Pork House & Snow Keep',
    objective: 'Earn Badge #3 at Pork House, check the Harbor Ship with Sensei Bob, and defeat Lord Gouda atop Snow Keep!',
    doneWhenFlag: 'defeated_moonlit_keep',
  },
  {
    chapter: 12,
    id: 'ch12_cloud_hall',
    zoneId: 'cloud_realm',
    title: 'World 9 — Elder Bamboon’s Cloud Trial',
    objective: 'Cross the starry Cloud Bridges and win Elder Bamboon’s friendly trial inside Twin-Wing Cloud Hall!',
    doneWhenFlag: 'earned_cloud_aegis',
  },
  {
    chapter: 14,
    id: 'ch14_final_caldera',
    zoneId: 'cinderpeak',
    title: 'World 10 — Summit Finale: Solar Kong & King Monkezilla!',
    objective: 'Earn Badge #4 at Beef House, join Dad in the Bastion, and defeat #19 Solar Kong & #20 King Monkezilla at Central Sky Shrine!',
    doneWhenFlag: 'defeated_king_monkezilla',
  },
];

export function getActiveStoryChapter(state) {
  const flags = new Set((state && state.storyFlags) || []);
  const items = new Set((state && state.keyItems) || []);
  for (const ch of STORY_CHAPTERS) {
    if (ch.doneWhenFlag && !flags.has(ch.doneWhenFlag)) return ch;
    if (ch.doneWhenKeyItem && !items.has(ch.doneWhenKeyItem)) return ch;
  }
  return {
    chapter: 15,
    id: 'postgame_champion',
    zoneId: 'cinderpeak',
    title: 'Grand Champion — Explore All 10 Sky-Vine Worlds!',
    objective: 'The Sky-Vine Tree is safe! Explore hidden coves, collect all 77 Golden Relics, and catch all 20 Monkemon!',
  };
}

// Short, breezy, super-understandable Monkemon story scenes!
export function buildStoryScene(sceneId, playerName = 'ALEX') {
  const hero = playerName || 'ALEX';
  const scenes = {
    opening_bedroom_night: {
      title: 'WELCOME TO MONKEMON!',
      chapterTag: 'WORLD 1 · HOMETOWN BAY',
      pages: [
        {
          speaker: 'EXPLORER DAD’S NOTE',
          role: 'Left Beside the Banana Compass',
          icon: '💎',
          text: `“Hey ${hero}! Ten amazing islands float up the giant Sky-Vine Tree, held together by 77 Golden Banana Relics. Greedy Team Brash is trying to steal them, so I’ve gone ahead up the Sky-Vine to keep them safe!”`,
        },
        {
          speaker: 'MOM',
          role: 'Hometown Cottage',
          icon: '🧁',
          text: `“Dad left you his glowing Banana Compass—that’s Relic #1, and it tells you how many Relics are hidden on each island! Stop by Sensei Bob’s School next door, then climb the Sky-Vine Worlds to catch up with Dad!”`,
        },
      ],
    },
    sensei_bob_joins: {
      title: 'SENSEI BOB JOINS YOU!',
      chapterTag: 'HOMETOWN SCHOOL',
      pages: [
        {
          speaker: 'SENSEI BOB',
          role: 'Your Teacher & Mentor',
          icon: '🎓',
          text: `“Heading up the Sky-Vine to find your Dad, ${hero}? Awesome! Three friendly Monkemon from class want to join your team right away—and I’ll walk with you through North Passage Cave!”`,
        },
      ],
    },
    sensei_bob_parts: {
      title: 'THROUGH NORTH CAVE!',
      chapterTag: 'CROSSROADS VALLEY',
      pages: [
        {
          speaker: 'SENSEI BOB',
          role: 'Back to Class',
          icon: '👋',
          text: `“Nice battling, ${hero}! I need to head back to my students now. Follow the river road west to meet Sage Liana at her Shrine—she knows how to wake up the Sky-Vine Pillar!”`,
        },
      ],
    },
    ruins_already_looted: {
      title: 'TEAM BRASH WAS HERE!',
      chapterTag: 'SUN-BAKED PYRAMID',
      pages: [
        {
          speaker: 'SHRINE SCOUT',
          role: 'Pyramid Explorer',
          icon: '🏺',
          text: `“Boss Brash’s goons ran off to their North Fort with the Pyramid’s Relics! Grab the treasure they missed, then ask Sage Liana at the West Shrine for help!”`,
        },
      ],
    },
    liana_joins_party: {
      title: 'SAGE LIANA TEAMS UP!',
      chapterTag: 'SKY-VINE SHRINE',
      pages: [
        {
          speaker: 'SAGE LIANA',
          role: 'Keeper of the Sky-Vine',
          icon: '✨',
          text: `“Welcome, ${hero}! Boss Brash locked our island’s Sky-Vine Pillar from his North Fort. Take my Sky-Vine Spark—I’ll come with you and zap his guards in battle!”`,
        },
      ],
    },
    brash_base_pillar_and_curse: {
      title: 'SKY-VINE #1 AWAKENS!',
      chapterTag: 'NORTH FORT',
      pages: [
        {
          speaker: 'FORT CAPTAIN',
          role: 'Team Brash',
          icon: '💥',
          text: `“Uh-oh! Boss Brash already climbed the Sky-Vine to World 2’s Oasis Dunes—and he left a cloud of sleep-spores behind!”`,
        },
        {
          speaker: 'SAGE LIANA',
          role: 'Feeling Sleepy from the Spores',
          icon: '🌿',
          text: `“Yawn... those sleep-spores are making me dizzy! I’ll rest back at my Shrine while you climb the glowing Sky-Vine Pillar to chase Boss Brash into World 2, ${hero}!”`,
        },
      ],
    },
    kai_joins_tower: {
      title: 'SCOUT KAI JOINS IN!',
      chapterTag: 'MIRAGE TOWER',
      pages: [
        {
          speaker: 'SCOUT KAI',
          role: 'Friend of Explorer Dad',
          icon: '🧭',
          text: `“Thanks for finding my backpack, ${hero}! Your Dad helped me out once, so let’s team up and knock Boss Brash right off the top of Mirage Tower!”`,
        },
      ],
    },
    brash_tower_defeated: {
      title: 'BOSS BRASH DEFEATED!',
      chapterTag: 'MIRAGE TOWER TOP',
      pages: [
        {
          speaker: 'BOSS BRASH',
          role: 'Blasted Off!',
          icon: '🔥',
          text: `“Waaah! Fine, keep my Relics! Even Solar Kong said nobody could stop me—and you still can’t shrink small enough to clear my sleep-spores off Sage Liana!”`,
        },
        {
          speaker: 'SCOUT KAI',
          role: 'Helpful Tip!',
          icon: '🔬',
          text: `“Wait—the next Sky-Vine leads to World 3, Giant’s Woods! The Giants left behind a Tiny-Ray Gadget in their Manor. Grab it and we can cure Sage Liana in a snap!”`,
        },
      ],
    },
    liana_healed_awakening: {
      title: 'SAGE LIANA IS CURED!',
      chapterTag: 'SKY-VINE SHRINE',
      pages: [
        {
          speaker: 'SAGE LIANA',
          role: 'Full of Energy Again!',
          icon: '💚',
          text: `“Hooray—the Tiny-Ray cleared every last sleep-spore! Thank you, ${hero}! Sky-Vine Pillar #3 is wide open now—and keep an eye out for that smooth-talking Solar Kong ahead!”`,
        },
      ],
    },
    solar_patron_riddle: {
      title: 'SOLAR KONG’S CLUE',
      chapterTag: 'SUN PALACE · WORLD 4',
      pages: [
        {
          speaker: 'SOLAR KONG',
          role: 'Flashy Sun-Palace Host',
          icon: '☀️',
          text: `“Haha, welcome ${hero}! Collecting all 77 Golden Relics? Wonderful—keep gathering them for me... er, I mean, for peace! Tip: grab the Glow-Sight Pearl inside the southern Undersea Volcano to open Bright Cave!”`,
        },
      ],
    },
    dad_guardian_reveal_and_ambush: {
      title: 'FOUND EXPLORER DAD!',
      chapterTag: 'DAD’S RANGER HIDEOUT · WORLD 5',
      pages: [
        {
          speaker: 'EXPLORER DAD',
          role: 'Big Bear Hug!',
          icon: '⭐',
          text: `“${hero}!! Look at you and your Monkemon squad—you made it halfway up the Sky-Vine! Watch out for Solar Kong: he’s tricking tamers into bringing all 77 Relics to the Summit so he can hog their power!”`,
        },
        {
          speaker: 'EXPLORER DAD',
          role: 'Let’s Team Up!',
          icon: '🚨',
          text: `“Uh-oh—wild Gorge Raiders just ran off toward Monster Gorge in the northwest with a pouch of Relics! Come on, kiddo—let’s battle side-by-side and get them back!”`,
        },
      ],
    },
    monster_gorge_dad_promise: {
      title: 'MONSTER GORGE CLEARED!',
      chapterTag: 'PINE VALLEY · WORLD 5',
      pages: [
        {
          speaker: 'EXPLORER DAD',
          role: 'See You at the Summit!',
          icon: '🌟',
          text: `“Unstoppable teamwork, ${hero}! I’m scouting ahead to World 10’s Volcano Summit to find the Sky-Tree Core Seed so Solar Kong can’t wreck the tree. Meet me at the top!”`,
        },
      ],
    },
    outcast_leo_plea: {
      title: 'LOCKED OUT OF GOLD CITY',
      chapterTag: 'TIMBER VILLAGE · WORLD 6',
      pages: [
        {
          speaker: 'VILLAGER LEO',
          role: 'Locked Out by Queen Vana',
          icon: '🗝️',
          text: `“Vain Queen Vana locked Gold City’s gates so she can keep every shiny Relic for herself! Slip through the Waterway Grate to grab the Gate Key, and check Crater Volcano in the northwest for bonus Relics!”`,
        },
      ],
    },
    vana_wedding_crashed: {
      title: 'GOLD CITY GATES OPENED!',
      chapterTag: 'GOLD PALACE · WORLD 6',
      pages: [
        {
          speaker: 'VILLAGER LEO',
          role: 'Everyone Is Welcome Again!',
          icon: '🎉',
          text: `“You beat Queen Vana fair and square! She apologized and opened Gold City’s gates for everyone—and Sky-Vine Pillar #6 to Derby Valley is ready for you!”`,
        },
      ],
    },
    derby_patron_cameo: {
      title: 'FINISH LINE CHAMPIONS!',
      chapterTag: 'GRAND S-CURVE RACEWAY · WORLD 7',
      pages: [
        {
          speaker: 'DERBY ACE FLASH',
          role: 'Track Champion',
          icon: '🏁',
          text: `“What a sprint across the S-Curve boost pads, ${hero}! Beat my speedy Monkemon team at the podium to win the Derby Trophy Relics and unlock World 8!”`,
        },
      ],
    },
    shogun_mystery_start: {
      title: 'SENSEI BOB IN SNOW TOWN!',
      chapterTag: 'BLOSSOM HARBOR · WORLD 8',
      pages: [
        {
          speaker: 'SENSEI BOB',
          role: 'Back to Help Out!',
          icon: '🥋',
          text: `“Surprise, ${hero}! Greedy Lord Gouda hid Snow Town’s Relics on this cargo ship and locked himself inside Snow Keep! Let’s grab the Harbor Map and challenge him on his moonlit castle roof!”`,
        },
      ],
    },
    shogun_rooftop_victory: {
      title: 'SNOW KEEP LIBERATED!',
      chapterTag: 'MOONLIT ROOFTOP · WORLD 8',
      pages: [
        {
          speaker: 'SENSEI BOB',
          role: 'Proud Teacher!',
          icon: '🌙',
          text: `“Lord Gouda didn’t stand a chance against your squad, ${hero}! You’re almost at the very top of the Sky-Vine Tree—go show the Cloud Isles what you’ve got!”`,
        },
      ],
    },
    skyfather_revival_pact: {
      title: 'ELDER BAMBOON’S PEP TALK!',
      chapterTag: 'ABOVE THE CLOUDS',
      pages: [
        {
          speaker: 'ELDER BAMBOON',
          role: 'Keeper of Cloud Hall',
          icon: '☁️',
          text: `“Don’t give up, young ${hero}! I’ve healed all your Monkemon back to 100% HP. When you reach World 9’s Cloud Isles, come visit my Cloud Hall for a friendly match!”`,
        },
      ],
    },
    skyfather_duel_won: {
      title: 'CLOUD TRIAL PASSED!',
      chapterTag: 'TWIN-WING CLOUD HALL · WORLD 9',
      pages: [
        {
          speaker: 'ELDER BAMBOON',
          role: 'Keeper of Cloud Hall',
          icon: '🛡️',
          text: `“Bravo, ${hero}!! Take these Golden Relics and my Cloud Shield Charm—now you’re ready to climb the final Sky-Vine to World 10’s Volcano Summit and meet your Dad!”`,
        },
      ],
    },
    final_bastion_dad_stand: {
      title: 'DAD & THE SKY-TREE SEED!',
      chapterTag: 'SUMMIT BASTION · WORLD 10',
      pages: [
        {
          speaker: 'EXPLORER DAD',
          role: 'Fighting Beside You Again!',
          icon: '⭐',
          text: `“You made it to the Summit, ${hero}! Right past that Iron Guardian ahead are the Golden Banana-Blade and the Sky-Tree Core Seed. Let’s claim them together, then stop Solar Kong at Central Sky Shrine!”`,
        },
      ],
    },
    solar_extortion_76_twist: {
      title: 'SOLAR KONG GOES WILD!',
      chapterTag: 'CENTRAL SKY SHRINE · WORLD 10',
      pages: [
        {
          speaker: 'SOLAR KONG (#19)',
          role: 'Greedy Relic Hoarder!',
          icon: '☀️',
          text: `“Hand over the Relics, ${hero}—the whole Sky-Vine Tree belongs to ME!! Wait... why is the tree shaking?! The Relics are overloading without the Core Seed—RAAARGH, BATTLE ME!!”`,
        },
      ],
    },
    solar_servant_shield_and_statue: {
      title: 'THE FINAL GUARDIAN: KING MONKEZILLA!',
      chapterTag: 'HEART OF THE SKY-VINE TREE',
      pages: [
        {
          speaker: 'SAGE LIANA & EXPLORER DAD',
          role: 'All 77 Relics + Core Seed United!',
          icon: '🌟',
          text: `“Way to go, ${hero}—Solar Kong dropped every stolen Relic! Look: uniting them with the Core Seed woke up the giant protector of the tree—#20 KING MONKEZILLA—and it’s rampaging from the shockwave!”`,
        },
        {
          speaker: 'SAGE LIANA (AWAKENED)',
          role: 'Cheering & Healing Your Squad!',
          icon: '👑',
          text: `“I’ve healed your squad to 100% HP and I’ll shield you every turn! Calm #20 King Monkezilla in battle—or catch him in a Monkeball—to save all 10 Sky-Vine Worlds!”`,
        },
      ],
    },
    derby_stable_rental: {
      chapterTag: 'WORLD 7 · PADDOCK STABLES',
      title: 'Pick Your Derby Racing Mount!',
      pages: [
        {
          speaker: 'STABLE KEEPER',
          role: 'Derby Paddock',
          icon: '🐎',
          text: `“Welcome to Derby Valley, ${hero}! Pick a racing mount below, then enter the S-Curve Raceway next door and step on the yellow > Turbo Strips to zoom to the finish!”`,
        },
      ],
    },
    epilogue_family_adventure: {
      chapterTag: 'GRAND CHAMPION · FAMILY REUNION',
      title: 'Hooray! All 10 Sky-Vine Worlds Saved!',
      pages: [
        {
          speaker: 'MOM & EXPLORER DAD',
          role: 'Back Together in Sunpalm Bay!',
          icon: '🎉',
          text: `“You calmed #20 King Monkezilla and saved the entire Sky-Vine Tree, ${hero}! Sensei Bob and Sage Liana threw a huge banana-pancake party—and next trip, Mom, Dad, and you are exploring all 10 Worlds together!”`,
        },
      ],
    },
  };
  return scenes[sceneId] || null;
}
