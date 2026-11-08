// Map-Inspired Walkable 3D Interior, Town, Shrine, Cave, Tower, Castle & Dungeon Layouts!
// Every enterable area across all 10 Sky-Vine Realms has a dedicated tile floorplan:
//   `#` = 3D Cutaway Wall / Cave Rock / Moat Rampart / Chicane Barrier (blocking)
//   `.` = Main Floor
//   `=` = Paved Carpet / Walkable Bridge / Checkered Finish / Bookcase Step Ramp (walkable)
//   `D` = Raised Stone / Tatami Dais (walkable)
//   `~` = Animated GLSL Water / Canal / Sewer / Bio-Stream (blocking)
//   `^` = Animated GLSL Magma / Lava Rift (blocking)
//   `+` = Glowing Emerald Oasis Full-Heal Pad (walkable auto-heal!)
//   `>` = Glowing Derby Speed-Boost Pad (walkable speed surge!)
//   `P` = Classical Marble / Timber / Gold Pillar (blocking)
//   `T` = Courtyard Tree / Pine / Cactus / Potted Shrub (blocking)
//   `B` = Cozy Bed / Giant Bed (blocking)
//   `K` = Tall Bookshelf / Giant Bookcase Wall (blocking)

export const INTERIOR_MAPS = {
  // =========================================================================
  // REALM 1: SUNPALM FRONTIER (Ch. 1–2 & Ch. 5 Micro-Sanctum)
  // =========================================================================

  // 1a. Alex's Hometown Cottage (inspired by HomeTown two-room cozy cottage + upstairs nook)
  alex_house: {
    id: 'alex_house',
    title: 'ALEX HOUSE (HOMETOWN)',
    theme: 'cottage',
    tileSize: 1.25,
    grid: [
      '###############',
      '#BB.#..KKK..#.#',
      '#...#.......=.#',
      '#...====.====.#',
      '###.#..===..###',
      '#T..=..===....#',
      '#......===....#',
      '#..T..........#',
      '######===######',
    ],
    entryTile: [7, 7],
    exitTile: [7, 8],
    stations: [
      { kind: 'heal_station', col: 3, row: 2, label: "ALEX'S BED" },
      { kind: 'pc', col: 11, row: 1 },
      {
        kind: 'mom',
        col: 8,
        row: 5,
        voiceKey: 'alex_mom',
        voiceLine: 'Have fun out there, Alex! Take the Banana Compass Dad left on your desk and visit Sensei Bob at the Schoolhouse!',
      },
      {
        kind: 'lore',
        col: 7,
        row: 2,
        label: "DAD'S NOTE",
        loreText: '📖 Explorer Dad’s Note: "Left my Banana Compass (Relic #1/77) by your bed! It glows whenever Golden Relics are nearby. Visit Sensei Bob first!"',
      },
    ],
    chests: [
      { id: 'home_attic_chest', col: 13, row: 1, label: 'Dad’s Travel Pack', relics: 0, balls: 5, berries: 3, coins: 60 },
    ],
  },

  // 1b. Hometown Schoolhouse & Monkeball Lab (inspired by HomeTown top schoolhouse with desk rows & Sensei Bob)
  cove_pavilion: {
    id: 'cove_pavilion',
    title: 'SENSEI BOB’S SCHOOL & LAB',
    theme: 'school',
    tileSize: 1.25,
    grid: [
      '#################',
      '#KKK..DDDDD..KKK#',
      '#B....DDDDD.....#',
      '#.......=.......#',
      '#..#.#..=..P.P..#',
      '#.......=.......#',
      '#..#.#..=..P.P..#',
      '#T......=......T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 2, label: 'SCHOOL NURSE STATION' },
      { kind: 'shop', col: 13, row: 2 },
      { kind: 'pc', col: 14, row: 7 },
      {
        kind: 'prof',
        col: 8,
        row: 2,
        name: 'Teacher Sensei Bob',
        badgeText: '🎓 SENSEI',
        voiceKey: 'prof_welcome',
        voiceLine: 'Monster Biology class dismissed! Your classmates are joining to form a 4-Monkemon squad, and I’ll escort you through North Passage Cave myself!',
        grantRelics: 0,
        grantStarterSquad: true,
        joinCompanion: 'sensei_bob',
        storyScene: 'sensei_bob_joins',
      },
    ],
    chests: [
      { id: 'school_supply_chest', col: 2, row: 7, label: 'Classroom Starter Chest', balls: 6, superBalls: 1, coins: 80 },
    ],
  },

  // 1c. North Passage Cave (inspired by FirstWorld-CaveOfNorth: winding south L-corridor, eastern 2-chest chamber, north switchback exit!)
  north_cave: {
    id: 'north_cave',
    title: 'NORTH PASSAGE CAVE',
    theme: 'cave',
    tileSize: 1.28,
    grid: [
      '###########===###',
      '#########.....###',
      '#########.##..###',
      '#####.....##....#',
      '#####.###.#####.#',
      '#####...#.....#.#',
      '#######.#####...#',
      '###.....#...###.#',
      '###.###...#.....#',
      '#...#########...#',
      '#...............#',
      '##===############',
    ],
    entryTile: [3, 10],
    exitTile: [3, 11],
    warps: [
      {
        id: 'north_cave_upper_exit',
        col: 12,
        row: 0,
        toOverworldPos: { x: 24.5, z: 9.5 },
        grantFlag: 'cleared_north_cave',
        grantRelics: 0,
        clearCompanion: 'sensei_bob',
        storyScene: 'sensei_bob_parts',
        label: 'Exit North to Crossroads River Valley',
        badgeText: '⛰️ NORTH EXIT',
      },
    ],
    stations: [
      {
        kind: 'trainer',
        col: 12,
        row: 2,
        trainerDef: {
          id: 'boss_north_cave_wyrm',
          name: 'Cavern Hatchling Geartail',
          role: 'North Cave Gatekeeper',
          introLine: 'SKREEE!! None shall exit North Passage Cave—wait, is that Teacher Sensei Bob behind you?!',
          rewardCoins: 110,
          victoryRelics: 0,
          team: [{ speciesId: 'geartail', level: 4 }],
        },
      },
      {
        kind: 'npc',
        col: 11,
        row: 1,
        name: 'Sensei Bob',
        badgeText: '🥋 SENSEI',
        modelGlb: 'assets/models/senseibob.glb',
        scale: 1.25,
        healParty: true,
        grantFlag: 'cleared_north_cave',
        line: 'See how Dad’s Banana Compass glows when Golden Relics remain in a World? Step out the north exit whenever you’re ready!',
      },
    ],
    chests: [
      { id: 'ncave_chest_1', col: 9, row: 8, label: 'Bronze Cavern Chest', relics: 1, balls: 5, berries: 3, coins: 90 },
      { id: 'ncave_chest_2', col: 15, row: 3, label: 'Miner’s Hammer Chest', relics: 0, superBalls: 2, coins: 120 },
    ],
    wildSpawns: [
      { speciesId: 'puppuchin', level: 3, col: 8, row: 10 },
      { speciesId: 'mugchimp', level: 4, col: 7, row: 5 },
    ],
  },

  // 1d. First Frontier Town (inspired by FirstWorld-FirstTown: walled plaza, cross avenue, SW pond, SE orchard, Inn & Pub)
  first_town: {
    id: 'first_town',
    title: 'FIRST FRONTIER TOWN',
    theme: 'town',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P...DDD...P..#',
      '#.#..#.===.#..#.#',
      '#......===......#',
      '#..===========..#',
      '#~~~~~.===.T.T..#',
      '#~~~~~.===..T.T.#',
      '#......===.T.T..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 8, row: 1, label: 'FRONTIER INN' },
      { kind: 'shop', col: 3, row: 2 },
      { kind: 'pc', col: 13, row: 2 },
      {
        kind: 'npc',
        col: 11,
        row: 4,
        name: 'Crossroads Villager',
        badgeText: '💬 TIP',
        line: 'Team Brash raided the SW Ancient Pyramid and set up camp in the North Fort! Visit Sage Liana at the West Shrine first!',
      },
    ],
    chests: [
      { id: 'first_town_orchard_chest', col: 14, row: 7, label: 'Orchard Supply Stash', relics: 0, balls: 5, berries: 4, coins: 100 },
    ],
  },

  // 1e. Shrine of Mystic Liana (classical columned temple hall + Micro-Sanctum portal!)
  mystic_shrine: {
    id: 'mystic_shrine',
    title: 'SHRINE OF MYSTIC LIANA',
    theme: 'shrine',
    tileSize: 1.28,
    grid: [
      '#################',
      '#P..P..DDD..P..P#',
      '#......DDD......#',
      '#.P....===....P.#',
      '#......===......#',
      '#.P....===....P.#',
      '#~~....===....~~#',
      '#..P...===...P..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'enter_mystic_body',
        col: 11,
        row: 2,
        toInteriorId: 'mystic_body',
        requireKeyItem: 'mini_shrinker',
        lockedHint: '🔬 Sage Liana is sleepy from Boss Brash’s spores! Grab the Tiny-Ray Gadget in World 3 (Giant’s Manor bookcase) to shrink down and clear them!',
        label: 'Use Tiny-Ray to Clear Sleep-Spores',
        badgeText: '🔬 TINY-RAY',
      },
    ],
    stations: [
      { kind: 'heal', col: 5, row: 2, label: 'SACRED LOTUS FONT' },
      {
        kind: 'npc',
        col: 8,
        row: 2,
        name: 'Sage Liana',
        badgeText: '⚡ SKY SAGE',
        modelGlb: 'assets/models/mysticlangur.glb',
        scale: 1.32,
        healParty: true,
        grantKeyItem: 'prism_blessing',
        grantRelics: 1,
        relicId: 'npc:mystic_liana_blessing',
        joinCompanion: 'mystic_liana',
        joinUnlessFlag: 'defeated_brash_base',
        storyScene: 'liana_joins_party',
        healedStoryScene: 'liana_healed_awakening',
        line: '77 Golden Banana Relics keep the Sky-Vine Worlds safe! Let’s team up and clear Boss Brash’s crew out of the North Fort!',
      },
    ],
  },

  // 1f. Tiny-Ray Spore Cavern
  mystic_body: {
    id: 'mystic_body',
    title: 'TINY-RAY SPORE CAVERN',
    theme: 'biosanctum',
    tileSize: 1.24,
    grid: [
      '######=====######',
      '#####..DDD..#####',
      '#####..===..#####',
      '#....=======....#',
      '#.##..#===#..##.#',
      '#.....#+.+#.....#',
      '#####..===..#####',
      '####...#=#...####',
      '###...##=##...###',
      '##....#===#....##',
      '######=====######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    warps: [
      {
        id: 'exit_micro_to_shrine',
        col: 8,
        row: 10,
        toInteriorId: 'mystic_shrine',
        label: 'Grow Back to Normal Size',
        badgeText: '✨ RETURN',
      },
    ],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_micro_phage',
          name: 'Sleep-Spore Pyrodril',
          role: 'Boss Brash’s Spore Leader',
          isWarden: true,
          introLine: 'BZZT! You used the Tiny-Ray to find our spore hideout?! You won’t take these 3 Golden Relics back!',
          rewardCoins: 520,
          victoryRelics: 3,
          victoryFlag: 'healed_mystic_liana',
          postVictoryScene: 'liana_healed_awakening',
          team: [
            { speciesId: 'howlshade', level: 12 },
            { speciesId: 'pyrodril', level: 14 },
          ],
        },
      },
    ],
    chests: [
      { id: 'micro_left_hand', col: 2, row: 3, label: 'Left-Hand Synapse Chest', relics: 1, superBalls: 2, coins: 150 },
      { id: 'micro_right_hand', col: 14, row: 3, label: 'Right-Hand Synapse Chest', relics: 1, superBalls: 2, coins: 150 },
      { id: 'micro_stomach', col: 2, row: 5, label: 'Stomach Chamber Chest', relics: 1, balls: 6, berries: 5 },
      { id: 'micro_feet', col: 13, row: 9, label: 'Reflex Foot Chest', relics: 1, coins: 180 },
    ],
    wildSpawns: [
      { speciesId: 'voltamarin', level: 11, col: 5, row: 7 },
      { speciesId: 'plushaki', level: 11, col: 11, row: 7 },
    ],
  },

  // 1g. Ancient Relic Ruins (inspired by FirstWorld-RelicsOfTheAncientGods: stepped pyramid halls & treasury)
  ancient_ruins: {
    id: 'ancient_ruins',
    title: 'ANCIENT RELIC PYRAMID',
    theme: 'ruins',
    tileSize: 1.26,
    grid: [
      '#################',
      '#..#...DDD...#..#',
      '#..#.#.===.#.#..#',
      '#....#..=..#....#',
      '####....=....####',
      '#..P..=====..P..#',
      '#..#....=....#..#',
      '#.......=.......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 5,
        trainerDef: {
          id: 'trainer_ruins_whip',
          name: 'Team Brash Scout',
          role: 'Relic Snatcher',
          introLine: 'Hands off! Team Brash already hauled the main Golden Relics to our North Fort!',
          rewardCoins: 160,
          victoryRelics: 0,
          team: [
            { speciesId: 'mossaki', level: 5 },
            { speciesId: 'chimpark', level: 5 },
          ],
        },
      },
      {
        kind: 'npc',
        col: 8,
        row: 1,
        name: 'Temple Keeper',
        badgeText: '🏺 LOOTED',
        grantRelics: 0,
        grantFlag: 'inspected_raided_ruins',
        storyScene: 'ruins_already_looted',
        line: 'Team Brash took the main Relics to their North Fort—but they missed the West Vault chest! Visit Sage Liana at the West Shrine too!',
      },
    ],
    chests: [
      { id: 'ruins_west_vault', col: 1, row: 1, label: 'Ancient Relic Vault', relics: 1, balls: 6, superBalls: 1, coins: 110 },
      { id: 'ruins_east_vault', col: 15, row: 1, label: 'Plundered Speed Vault', relics: 0, berries: 5, coins: 110 },
    ],
    wildSpawns: [
      { speciesId: 'mossaki', level: 5, col: 4, row: 5 },
      { speciesId: 'chimpark', level: 5, col: 12, row: 5 },
    ],
  },

  // 1h. Boss Brash's Northern Fort
  warlord_base: {
    id: 'warlord_base',
    title: 'TEAM BRASH NORTH FORT',
    theme: 'fortress',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P...DDD...P..#',
      '#.##.#.===.#.##.#',
      '#....#..=..#....#',
      '#.####..=..####.#',
      '#......===......#',
      '#.##..#===#..##.#',
      '#.....#===#.....#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 7, label: 'CAPTURED SUPPLY BENCH' },
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_brash_vanguard',
          name: 'Captain Crunch (Team Brash)',
          role: 'North Fort Boss',
          isWarden: true,
          introLine: 'Too slow! Boss Brash already fled up the Sky-Vine Pillar to World 2—and left a sleep-spore trap behind!',
          rewardCoins: 340,
          victoryRelics: 2,
          victoryFlag: 'defeated_brash_base',
          postVictoryScene: 'brash_base_pillar_and_curse',
          postVictoryClearCompanion: 'mystic_liana',
          team: [
            { speciesId: 'chimpark', level: 6 },
            { speciesId: 'bobmonk', level: 7 },
          ],
        },
      },
    ],
    chests: [
      { id: 'wbase_west_chest', col: 1, row: 3, label: 'Barracks Relic Chest', relics: 1, balls: 6, superBalls: 1, coins: 120 },
      { id: 'wbase_east_chest', col: 15, row: 3, label: 'Surplus Armory Chest', relics: 0, berries: 4, coins: 130 },
    ],
    wildSpawns: [{ speciesId: 'chimpark', level: 5, col: 8, row: 4 }],
  },

  // =========================================================================
  // REALM 2: AMBER OASIS DUNES (Ch. 3 — Peanut Butter House & Stepped Tower)
  // =========================================================================

  // 2a. Peanut Butter House Dojo (Concept-Spec House #2 + Desert Oasis Sanctuary)
  peanut_butter_house: {
    id: 'peanut_butter_house',
    title: 'PEANUT BUTTER HOUSE DOJO',
    theme: 'peanut_dojo',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P..DDDDD..P..#',
      '#.....DDDDD.....#',
      '#..P..=====..P..#',
      '#....=======....#',
      '#..P.=======.P..#',
      '#.....=====.....#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 6, label: 'OASIS DOJO HEAL BENCH' },
      { kind: 'shop', col: 13, row: 6 },
      { kind: 'pc', col: 14, row: 2 },
      {
        kind: 'warden',
        col: 8,
        row: 1,
        wardenId: 'warden_skippy',
        victoryRelics: 1,
      },
    ],
    chests: [
      { id: 'pb_dojo_chest', col: 2, row: 2, label: 'Golden Jar Reserve', relics: 0, balls: 6, superBalls: 2, coins: 150 },
    ],
  },

  // 2b. Stepped Mirage Tower — Lower Octagonal Colonnade
  stepped_tower: {
    id: 'stepped_tower',
    title: 'STEPPED MIRAGE TOWER (1F–4F)',
    theme: 'desert_tower',
    tileSize: 1.26,
    grid: [
      '####=========####',
      '###..P..=..P..###',
      '##..P...=...P..##',
      '#..P....=....P..#',
      '#.#...=====...#.#',
      '#....#..=..#....#',
      '##..P...=...P..##',
      '###..P..=..P..###',
      '######=====######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'tower_to_summit',
        col: 8,
        row: 0,
        toInteriorId: 'stepped_tower_top',
        label: 'Ascend to Mirage Tower Summit Bridge',
        badgeText: '🗼 SUMMIT',
      },
    ],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 4,
        name: 'Scout Kai',
        badgeText: '🧭 DAD’S PAL',
        healParty: true,
        line: 'Hey! I work with your Dad! Team Brash locked my gear in the east chest—open it and let’s beat Boss Brash on the roof together!',
      },
    ],
    chests: [
      {
        id: 'tower_kai_gear',
        col: 14,
        row: 5,
        label: 'Kai’s Stolen Pack',
        relics: 1,
        keyItem: 'kai_mask_gear',
        joinCompanion: 'masked_kai',
        storyScene: 'kai_joins_tower',
        superBalls: 2,
        coins: 180,
      },
      { id: 'tower_west_relic', col: 2, row: 5, label: 'Mirage Pillar Chest', relics: 1, balls: 6, berries: 4 },
    ],
    wildSpawns: [
      { speciesId: 'voltamarin', level: 8, col: 8, row: 5 },
      { speciesId: 'mossaki', level: 9, col: 11, row: 3 },
    ],
  },

  // 2c. Stepped Mirage Tower — Summit Sky-Bridge Boss Chamber
  stepped_tower_top: {
    id: 'stepped_tower_top',
    title: 'MIRAGE TOWER SUMMIT BRIDGE',
    theme: 'desert_tower',
    tileSize: 1.25,
    grid: [
      '#################',
      '#^^^^^DDDDD^^^^^#',
      '#^^^^^DDDDD^^^^^#',
      '#^^^^^^===^^^^^^#',
      '#^^^^^^===^^^^^^#',
      '#^^^^^^===^^^^^^#',
      '#^^^^^=====^^^^^#',
      '#^^^^^..=..^^^^^#',
      '######=====######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'summit_back_down',
        col: 8,
        row: 8,
        toInteriorId: 'stepped_tower',
        label: 'Descend to Mirage Tower Hall',
        badgeText: '⬇️ DOWN',
      },
    ],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_general_brash',
          name: 'Boss Brash',
          role: 'Team Brash Leader',
          isWarden: true,
          introLine: 'Gahaha! A mystery boss promised me rule over the Dunes if I hoard these Golden Relics! Try getting past me!',
          rewardCoins: 500,
          victoryRelics: 3,
          victoryFlag: 'defeated_brash_tower',
          postVictoryScene: 'brash_tower_defeated',
          postVictoryClearCompanion: 'masked_kai',
          team: [
            { speciesId: 'bobmonk', level: 9 },
            { speciesId: 'voltamarin', level: 10 },
            { speciesId: 'chimpark', level: 11 },
          ],
        },
      },
    ],
  },

  // =========================================================================
  // REALM 3: COLOSSUS WALLED ESTATE (Ch. 4 — Smallfolk Woods & Giant's Manor)
  // =========================================================================

  // 3a. Smallfolk Forest Village (with Apprentice Pip at the shop back door!)
  giants_town: {
    id: 'giants_town',
    title: 'SMALLFOLK WOODLAND VILLAGE',
    theme: 'town',
    tileSize: 1.26,
    grid: [
      '#################',
      '#T..#...=..K...T#',
      '#...#...=.......#',
      '#..###.===.###..#',
      '#......===......#',
      '#..T...===...T..#',
      '#......===......#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 2, row: 2, label: 'WOODLAND INN' },
      { kind: 'shop', col: 12, row: 4 },
      {
        kind: 'npc',
        col: 13,
        row: 1,
        name: 'Apprentice Pip (Back Counter)',
        badgeText: '🔎 CLUE',
        grantRelics: 0,
        line: 'Psst! The whole eastern city was built for Giants! Climb the lowest step of the NE Bookcase inside Giant’s Manor to reach their Mini-Shrinker!',
      },
    ],
  },

  // 3b. Colossus Giant's Manor (inspired by GiantsWorld-Houses: giant checkered floor, giant beds, climbable NE bookcase -> Mini-Shrinker!)
  giants_manor: {
    id: 'giants_manor',
    title: 'COLOSSUS GIANT’S MANOR',
    theme: 'giant_house',
    tileSize: 1.32,
    grid: [
      '#################',
      '#..P...DDD..KKKK#',
      '#...........===K#',
      '#..BBBB.....#==.#',
      '#..BBBB.....#.#.#',
      '#...............#',
      '#..........BBBB.#',
      '#..P.......BBBB.#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'npc',
        col: 7,
        row: 5,
        name: 'Explorer Tiny Tim',
        badgeText: '🪜 BOOKCASE',
        line: 'Everything in here is ten times our size! Walk up the wooden step-ramp along the NE bookcase (`===`) to open the Giant’s Gadget Chest!',
      },
    ],
    chests: [
      {
        id: 'giant_micron_chest',
        col: 12,
        row: 2,
        label: 'Giant Bookcase Top Chest',
        keyItem: 'mini_shrinker',
        relics: 1,
        superBalls: 3,
        coins: 240,
      },
      { id: 'giant_floor_chest', col: 4, row: 6, label: 'Giant Tile Floor Chest', relics: 1, balls: 7, berries: 5, coins: 180 },
    ],
    wildSpawns: [
      { speciesId: 'mooboon', level: 11, col: 6, row: 2 },
      { speciesId: 'plushaki', level: 12, col: 10, row: 6 },
    ],
  },

  // =========================================================================
  // REALM 4: SOLAR LAGOON & SQUEAKY PORT (Ch. 6 — Sun Palace, Fish House & Undersea Volcano)
  // =========================================================================

  // 4a. Solar Kong's Sun Palace
  solar_palace: {
    id: 'solar_palace',
    title: 'SOLAR KONG’S SUN PALACE',
    theme: 'palace',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P..DDDDD..P..#',
      '#..P..DDDDD..P..#',
      '#..P..=====..P..#',
      '#.....=====.....#',
      '#..P..=====..P..#',
      '#~~...=====...~~#',
      '#..P..=====..P..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 4, row: 4, label: 'SUNLIGHT FOUNTAIN' },
      {
        kind: 'npc',
        col: 8,
        row: 1,
        name: 'Solar Kong',
        badgeText: '☀️ SUN PATRON',
        modelGlb: 'assets/models/solarkong.glb',
        scale: 1.38,
        grantRelics: 0,
        storyScene: 'solar_patron_riddle',
        line: 'Welcome, young tamer! A glowing Sea-Ring Relic rests inside the Undersea Grotto to the south—bring it back to help protect the Sky-Vine!',
      },
    ],
  },

  // 4b. Northern Mountain Rescue Cave (rescuing Scout Pippa & her Locket)
  mountain_cave: {
    id: 'mountain_cave',
    title: 'NORTHERN MOUNTAIN CAVE',
    theme: 'cave',
    tileSize: 1.26,
    grid: [
      '#################',
      '#...#..DDD..#...#',
      '#.#.#..===..#.#.#',
      '#.#....===....#.#',
      '#...###===###...#',
      '###....===....###',
      '#...#..===..#...#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'npc',
        col: 8,
        row: 1,
        name: 'Camper Pippa',
        badgeText: '👧 CAMPER',
        healParty: true,
        grantKeyItem: 'pippa_locket',
        grantFlag: 'rescued_pippa_cave',
        grantRelics: 2,
        relicId: 'npc:pippa_mountain_rescue',
        line: 'Thanks for helping me out of this twisty cave! Your Explorer Dad is up in World 5’s Pine Valley—take these 2 Golden Relics!',
      },
    ],
    chests: [
      { id: 'mtcave_west', col: 1, row: 1, label: 'Crystal Ledge Chest', relics: 1, balls: 6, superBalls: 2 },
      { id: 'mtcave_east', col: 15, row: 1, label: 'Hermes Shoe Grotto Chest', relics: 0, berries: 5, coins: 190 },
    ],
    wildSpawns: [{ speciesId: 'lemuripple', level: 13, col: 8, row: 5 }],
  },

  // 4c. Port Town & Fish House Dojo (piers & canals + Concept-Spec Fish House #3!)
  fish_house: {
    id: 'fish_house',
    title: 'FISH HOUSE & LAGOON PORT',
    theme: 'fish_dojo',
    tileSize: 1.28,
    grid: [
      '#################',
      '#~~P..DDDDD..P~~#',
      '#~~...DDDDD...~~#',
      '#..===..=..===..#',
      '#~~..=======..~~#',
      '#~~..=======..~~#',
      '#....==~~~==....#',
      '#..P...===...P..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 6, label: 'PORT HARBOR SANCTUARY' },
      { kind: 'shop', col: 13, row: 6 },
      { kind: 'pc', col: 13, row: 3 },
      {
        kind: 'warden',
        col: 8,
        row: 1,
        wardenId: 'warden_marina',
        victoryRelics: 1,
      },
    ],
    chests: [
      { id: 'fish_pier_chest', col: 3, row: 3, label: 'Captain’s Sea Locker', relics: 0, balls: 7, superBalls: 2, coins: 210 },
    ],
  },

  // 4d. Undersea Volcano (concentric lava caldera + 2 glowing Oasis Heal Tiles `+` + True-Sight Pearl!)
  undersea_volcano: {
    id: 'undersea_volcano',
    title: 'UNDERSEA CALDERA VOLCANO',
    theme: 'volcano_dungeon',
    tileSize: 1.28,
    grid: [
      '#################',
      '#^^^..DDDDD..^^^#',
      '#^^.+..===..+.^^#',
      '#^..^^.===.^^..^#',
      '#..^^^.===.^^^..#',
      '#...==.===.==...#',
      '#^^....===....^^#',
      '#^^^...===...^^^#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_caldera_geartail',
          name: 'Magma Sentinel Geartail',
          role: 'Undersea Volcano Guardian',
          isWarden: true,
          introLine: 'CLANG-ROAR! Step from the courtesy Healing Spring and prove your worth for the True-Sight Pearl!',
          rewardCoins: 620,
          victoryRelics: 2,
          victoryKeyItem: 'true_eye',
          team: [
            { speciesId: 'geartail', level: 14 },
            { speciesId: 'proboscrown', level: 15 },
          ],
        },
      },
    ],
    chests: [
      {
        id: 'uvolcano_pearl_chest',
        col: 4,
        row: 2,
        label: 'Magma Spring Relic Chest',
        keyItem: 'true_eye',
        relics: 1,
        superBalls: 3,
        coins: 250,
      },
      { id: 'uvolcano_east_chest', col: 12, row: 2, label: 'Obsidian Vent Chest', relics: 0, balls: 8, berries: 5 },
    ],
    wildSpawns: [
      { speciesId: 'duckaque', level: 13, col: 5, row: 5 },
      { speciesId: 'geartail', level: 14, col: 11, row: 5 },
    ],
  },

  // 4e. Cave of Brightness (eastern crystal cavern in Solar Lagoon)
  cave_of_light: {
    id: 'cave_of_light',
    title: 'CAVE OF BRIGHTNESS',
    theme: 'shrine',
    tileSize: 1.26,
    grid: [
      '#################',
      '#..P...DDD...P..#',
      '#..~~..===..~~..#',
      '#......===......#',
      '#..P.=======.P..#',
      '#......===......#',
      '#..~~..===..~~..#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    chests: [
      { id: 'light_cave_prism_1', col: 8, row: 1, label: 'Radiant Prism Vault', relics: 2, superBalls: 3, coins: 260 },
      { id: 'light_cave_prism_2', col: 2, row: 4, label: 'Sunbeam Grotto Chest', relics: 1, balls: 6, berries: 5 },
    ],
    wildSpawns: [{ speciesId: 'proboscrown', level: 15, col: 13, row: 4 }],
  },

  // =========================================================================
  // REALM 5: GUARDIAN PINES & MONSTER GORGE (Ch. 7–8 — Pub Jukebox, Bunker & Gorge)
  // =========================================================================

  // 5a. Guardian Pine Pub (tables, bar counter, Jukebox unlocking secret bunker!)
  guardian_pub: {
    id: 'guardian_pub',
    title: 'GUARDIAN PINE TAVERN & INN',
    theme: 'cottage',
    tileSize: 1.26,
    grid: [
      '#################',
      '#..#...KKK..BBBB#',
      '#..=...===......#',
      '#..###....#####.#',
      '#..........#....#',
      '#..P...P........#',
      '#......P........#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'pub_secret_bunker_stairs',
        col: 3,
        row: 1,
        toInteriorId: 'guardian_base',
        requireKeyItem: 'heroic_melody',
        lockedHint: '🎵 A false wall hums behind the Jukebox! Play the Guardian Jukebox first to slide open the secret bunker stairs!',
        label: 'Descend to Secret Guardian Bunker',
        badgeText: '🕵️ BUNKER',
      },
    ],
    stations: [
      { kind: 'heal', col: 14, row: 2, label: 'PINE INN BEDS' },
      { kind: 'shop', col: 8, row: 2 },
      {
        kind: 'jukebox',
        col: 3,
        row: 2,
        grantKeyItem: 'heroic_melody',
        line: '🎵 Played the Heroic Guardian Anthem on the Jukebox! *CLICK-RUMBLE!* The back wall slid open, revealing stairs to the Underground Bunker!',
      },
    ],
  },

  // 5b. Underground Guardian Base (inspired by GuardianWorld-GuardianBase: multi-room resistance bunker + Commander Rex / Alex's Dad!)
  guardian_base: {
    id: 'guardian_base',
    title: 'SECRET GUARDIAN BUNKER HQ',
    theme: 'fortress',
    tileSize: 1.26,
    grid: [
      '#################',
      '#..#...DDD...#..#',
      '#..=...===...=..#',
      '####.#.===.#.####',
      '#....#.===.#....#',
      '#.##...===...##.#',
      '#......===......#',
      '#..P...===...P..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'bunker_to_pub',
        col: 8,
        row: 8,
        toInteriorId: 'guardian_pub',
        label: 'Climb Back to Pine Tavern',
        badgeText: '⬆️ TAVERN',
      },
    ],
    stations: [
      { kind: 'pc', col: 14, row: 6 },
      { kind: 'heal', col: 2, row: 6, label: 'GUARDIAN MED-BAY' },
      {
        kind: 'npc',
        col: 8,
        row: 1,
        name: 'Explorer Dad!',
        badgeText: '⭐ DAD',
        healParty: true,
        grantRelics: 2,
        relicId: 'npc:dad_guardian_reunion',
        grantFlag: 'met_dad_guardian_base',
        joinCompanion: 'dad_rex',
        joinUnlessFlag: 'saved_pippa_gorge',
        storyScene: 'dad_guardian_reveal_and_ambush',
        line: 'You found my Ranger Hideout, kiddo! Wild Gorge Raiders just ran off toward Monster Gorge with a pouch of Relics—let’s team up and get them back!',
      },
    ],
    chests: [
      { id: 'gbase_west_vault', col: 1, row: 1, label: 'Ranger Vault #1', relics: 1, superBalls: 3, coins: 260 },
      { id: 'gbase_east_vault', col: 15, row: 1, label: 'Ranger Vault #2', relics: 1, balls: 8, berries: 6 },
    ],
  },

  // 5c. Monster Lair Gorge
  monster_lair: {
    id: 'monster_lair',
    title: 'MONSTER LAIR CANYON',
    theme: 'cave',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..DDD.###......#',
      '#..===...#..###.#',
      '#.#####..=..#...#',
      '#.....####..#.#.#',
      '#.###.......#.#.#',
      '#...######....#.#',
      '#........===....#',
      '#########===#####',
    ],
    entryTile: [10, 7],
    exitTile: [10, 8],
    stations: [
      {
        kind: 'trainer',
        col: 4,
        row: 1,
        trainerDef: {
          id: 'boss_gorge_raider',
          name: 'Gorge Pack Leader Howlshade',
          role: 'Monster Gorge Boss',
          isWarden: true,
          introLine: 'GRRAAH! Nobody takes these shiny Golden Relics back from our Monster Gorge pack!',
          rewardCoins: 680,
          victoryRelics: 1,
          victoryFlag: 'saved_pippa_gorge',
          postVictoryScene: 'monster_gorge_dad_promise',
          postVictoryClearCompanion: 'dad_rex',
          team: [
            { speciesId: 'frostgibbon', level: 15 },
            { speciesId: 'howlshade', level: 16 },
          ],
        },
      },
      {
        kind: 'npc',
        col: 2,
        row: 2,
        name: 'Camper Pippa',
        badgeText: '💛 SAFE',
        healParty: true,
        line: 'You and Explorer Dad got the Relics back! Dad headed up to World 10’s Volcano Summit—go catch up with him!',
      },
    ],
    chests: [
      { id: 'mlair_canyon_chest', col: 15, row: 1, label: 'Gorge Cliff Chest', relics: 1, superBalls: 3, coins: 280 },
    ],
    wildSpawns: [{ speciesId: 'howlshade', level: 15, col: 8, row: 5 }],
  },

  // =========================================================================
  // REALM 6: GOLD CITY & CRATER (Ch. 9 — Locked City Gates, Waterway & Volcano)
  // =========================================================================

  // 6a. Timber Village
  outcast_village: {
    id: 'outcast_village',
    title: 'TIMBER VILLAGE',
    theme: 'cottage',
    tileSize: 1.26,
    grid: [
      '#################',
      '#T..BBBB..BBBB.T#',
      '#...............#',
      '#..T...===...T..#',
      '#......===......#',
      '#..T...===...T..#',
      '#......===......#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 4, row: 2, label: 'FOREST CAMPFIRE REST' },
      {
        kind: 'npc',
        col: 8,
        row: 3,
        name: 'Villager Leo',
        badgeText: '🗝️ HINT',
        grantRelics: 0,
        storyScene: 'outcast_leo_plea',
        line: 'Greedy Queen Vana locked Gold City’s front gates so she can keep every Relic! Grab the Gate Key in the Waterway Grate, and check Crater Volcano too!',
      },
    ],
  },

  // 6b. Underground City Waterway
  palace_sewers: {
    id: 'palace_sewers',
    title: 'GOLD CITY WATERWAY',
    theme: 'sewer',
    tileSize: 1.26,
    grid: [
      '######=====######',
      '#....~~===~~....#',
      '#.##.=======.##.#',
      '#....~~===~~....#',
      '#....===~===....#',
      '#.##.~~===~~.##.#',
      '#....=======....#',
      '#....~~===~~....#',
      '######=====######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'sewer_into_palace',
        col: 8,
        row: 0,
        toInteriorId: 'vanity_palace',
        requireKeyItem: 'sewer_key',
        lockedHint: '🗝️ The Palace grate is locked! Open the chest in the southeast corner of this Waterway for the Gate Key first!',
        label: 'Enter Gold Palace!',
        badgeText: '🏛️ PALACE',
      },
    ],
    chests: [
      { id: 'sewer_west_ledge', col: 1, row: 2, label: 'Aqueduct Relic Chest', relics: 1, superBalls: 2, coins: 260 },
      { id: 'sewer_east_ledge', col: 15, row: 6, label: 'Waterway Key Chest', relics: 1, keyItem: 'sewer_key', balls: 8, berries: 5 },
    ],
    wildSpawns: [
      { speciesId: 'lemuripple', level: 16, col: 4, row: 4 },
      { speciesId: 'geartail', level: 16, col: 12, row: 4 },
    ],
  },

  // 6c. Gold City Palace
  vanity_palace: {
    id: 'vanity_palace',
    title: 'GOLD CITY PALACE',
    theme: 'palace',
    tileSize: 1.28,
    grid: [
      '#################',
      '#P..P..DDD..P..P#',
      '#......DDD......#',
      '#.#..#.===.#..#.#',
      '#..===========..#',
      '#.#..#.===.#..#.#',
      '#..~~..===..~~..#',
      '#..P...===...P..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 4, label: 'MARBLE SALON HEAL' },
      { kind: 'shop', col: 13, row: 4 },
      { kind: 'pc', col: 14, row: 7 },
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_queen_vana',
          name: 'Queen Vana',
          role: 'Gold City Ruler',
          isWarden: true,
          introLine: 'How did you slip inside my locked Gold Palace?! Every shiny Golden Relic in this city belongs to ME!',
          rewardCoins: 760,
          victoryRelics: 2,
          victoryFlag: 'defeated_empress_vana',
          postVictoryScene: 'vana_wedding_crashed',
          team: [
            { speciesId: 'proboscrown', level: 16 },
            { speciesId: 'mysticlangur', level: 17 },
          ],
        },
      },
    ],
    chests: [
      { id: 'vpalace_treasury', col: 2, row: 2, label: 'Royal Gold Vault', relics: 1, superBalls: 3, coins: 300 },
    ],
  },

  // 6d. NW Crater Volcano
  seismic_volcano: {
    id: 'seismic_volcano',
    title: 'CRATER VOLCANO',
    theme: 'volcano_dungeon',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..DDD..^^^^^^^^#',
      '#..===..^^...^^^#',
      '#..===..^^.#.^^^#',
      '#..===..==...^^^#',
      '#^^===^^^^.#.^^^#',
      '#^^===^^^^...^^^#',
      '#^^...======.^^^#',
      '####===##########',
    ],
    entryTile: [5, 7],
    exitTile: [5, 8],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 2,
        name: 'Villager Leo',
        badgeText: '🔥 LAVA TREK',
        healParty: true,
        line: 'Phew, it’s toasty in here! Grab the 2 Golden Relics right ahead, then let’s go beat Queen Vana at Gold Palace!',
      },
    ],
    chests: [
      {
        id: 'svolcano_core_chest',
        col: 4,
        row: 1,
        label: 'Strength Relic Plume Chest',
        relics: 2,
        storyFlag: 'awakened_seismic_volcano',
        superBalls: 3,
        coins: 320,
      },
      { id: 'svolcano_island_chest', col: 11, row: 2, label: 'Fire Shield Isle Chest', relics: 0, balls: 8, berries: 6 },
    ],
    wildSpawns: [
      { speciesId: 'pyrodril', level: 17, col: 4, row: 4 },
      { speciesId: 'geartail', level: 16, col: 11, row: 6 },
    ],
  },

  // =========================================================================
  // REALM 7: GRAND S-CURVE RACE CIRCUIT (Ch. 10 — Paddock & S-Chicane Derby)
  // =========================================================================

  // 7a. Paddock Circuit Town (inspired by RaceWorld-RaceCircuit)
  paddock_town: {
    id: 'paddock_town',
    title: 'DERBY PADDOCK TOWN',
    theme: 'town',
    tileSize: 1.26,
    grid: [
      '#################',
      '#T..P..DDD..P..T#',
      '#......===......#',
      '#..###.===.###..#',
      '#......===......#',
      '#..P...===...P..#',
      '#......===......#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 2, label: 'PIT-STOP STABLES' },
      { kind: 'shop', col: 13, row: 2 },
      { kind: 'pc', col: 14, row: 6 },
      {
        kind: 'mount_rental',
        col: 8,
        row: 1,
        name: 'Derby Stablemaster',
        badgeText: '🐉 RENT MOUNT',
        grantRelics: 0,
        line: 'Pick your racing mount! ("If you can even get old Pokey Tortoise onto the track, he’s free!") Faster mounts boost S-Curve Raceway speed!',
      },
      {
        kind: 'npc',
        col: 6,
        row: 4,
        name: 'Solar Patron’s Race Clerk',
        badgeText: '📋 WAIVER',
        line: 'Solar Patron says: "Sign this indemnity waiver right here! After what you four accomplished on my Ocean World, I have no doubt you’ll win!"',
      },
    ],
  },

  // 7b. Grand S-Chicane Race Course (inspired by RaceWorld-RaceCourse: checkered start/finish, hairpin S-curve, tree-lined backstretch & turbo pads!)
  race_course: {
    id: 'race_course',
    title: 'GRAND S-CURVE RACEWAY',
    theme: 'race_track',
    tileSize: 1.3,
    grid: [
      '###################',
      '#..>>.......>>.DDD#',
      '#.##.#######.##===#',
      '#.#..#TTTTT#..#===#',
      '#.>.##TTTTT##..#..#',
      '#...#..>>...#..>..#',
      '###.#.#####.#.###.#',
      '#T..=.....>.=...T.#',
      '####===############',
    ],
    entryTile: [5, 7],
    exitTile: [5, 8],
    stations: [
      {
        kind: 'npc',
        col: 10,
        row: 5,
        name: 'Solar Patron (VIP Box)',
        badgeText: '☀️ PATRON',
        modelGlb: 'assets/models/solarkong.glb',
        scale: 1.28,
        storyScene: 'derby_patron_cameo',
        line: 'Bravo, young racer! Your Prism shows you’ve collected nearly all 77 Relics across the Worlds—keep gathering every last one!',
      },
      {
        kind: 'trainer',
        col: 16,
        row: 1,
        trainerDef: {
          id: 'boss_derby_ace',
          name: 'Grand Prix Ace Flash',
          role: 'S-Curve Derby Champion',
          isWarden: true,
          introLine: 'VROOOOM! You cleared the S-Chicane in record time—battle my Dragon-Armor squad at the Finish Podium for the Derby Trophy Relics!',
          rewardCoins: 820,
          victoryRelics: 2,
          victoryFlag: 'won_grand_derby',
          team: [
            { speciesId: 'puppuchin', level: 17 },
            { speciesId: 'bamboon', level: 18 },
          ],
        },
      },
    ],
    chests: [
      { id: 'race_chicane_chest', col: 8, row: 5, label: 'Infield Chicane Trophy', relics: 1, superBalls: 3, coins: 300 },
    ],
    wildSpawns: [{ speciesId: 'bamboon', level: 17, col: 11, row: 7 }],
  },

  // =========================================================================
  // REALM 8: CANAL CAPITAL & BLOSSOM HARBOR (Ch. 11 — Pork House, Smuggler Ship & Moonlit Keep)
  // =========================================================================

  // 8a. Canal Capital & Pork House Dojo (central bridged canal + secret back-counter shopkeeper + Master Truffle!)
  pork_house: {
    id: 'pork_house',
    title: 'PORK HOUSE & CANAL CAPITAL',
    theme: 'pork_dojo',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P..DDDDD..P..#',
      '#.....DDDDD.....#',
      '#..K...===...T..#',
      '#~~~~~~===~~~~~~#',
      '#~~~~~~===~~~~~~#',
      '#..P...===...P..#',
      '#T.............T#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 6, label: 'STEAMING ONSEN HEAL' },
      { kind: 'shop', col: 13, row: 6 },
      { kind: 'pc', col: 14, row: 2 },
      {
        kind: 'npc',
        col: 4,
        row: 3,
        name: 'Town Shopkeeper',
        badgeText: '🤫 TIP',
        grantRelics: 0,
        line: 'Psst! Sensei Bob is waiting down at the Harbor Cargo Ship—Lord Gouda hid the town’s Golden Relics aboard!',
      },
      {
        kind: 'warden',
        col: 8,
        row: 1,
        wardenId: 'warden_truffle',
        victoryRelics: 1,
      },
    ],
  },

  // 8b. Harbor Cargo Ship
  canal_harbor: {
    id: 'canal_harbor',
    title: 'CANAL HARBOR & CARGO SHIP',
    theme: 'fish_dojo',
    tileSize: 1.28,
    grid: [
      '#################',
      '#~~~~=======~~~~#',
      '#~~~#..DDD..#~~~#',
      '#~~~#..===..#~~~#',
      '#~~~~~~===~~~~~~#',
      '#~~~~~~===~~~~~~#',
      '#..P..=====..P..#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 6,
        name: 'Sensei Bob',
        badgeText: '🥋 MENTOR',
        healParty: true,
        joinCompanion: 'hana_bob',
        joinUnlessFlag: 'defeated_lord_gouda',
        storyScene: 'shogun_mystery_start',
        line: 'Great to see you again! Grab the Harbor Crate Map from the ship’s hold, then let’s go challenge Lord Gouda at Snow Keep!',
      },
    ],
    chests: [
      {
        id: 'harbor_ledger_chest',
        col: 8,
        row: 2,
        label: 'Cargo Hold Relic Chest',
        keyItem: 'smuggler_ledger',
        relics: 1,
        superBalls: 3,
        coins: 320,
      },
    ],
    wildSpawns: [{ speciesId: 'frostgibbon', level: 18, col: 10, row: 3 }],
  },

  // 8c. Snow Keep
  shogun_castle: {
    id: 'shogun_castle',
    title: 'SNOW KEEP CASTLE',
    theme: 'pork_dojo',
    tileSize: 1.28,
    grid: [
      '######=====######',
      '#~~~~..DDD..~~~~#',
      '#~..#.=====.#..~#',
      '#~.#..#===#..#.~#',
      '#~.#.#..=..#.#.~#',
      '#~...#..=..#...~#',
      '#~~~~..===..~~~~#',
      '#..T...===...T..#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'castle_to_rooftop',
        col: 8,
        row: 0,
        toInteriorId: 'shogun_rooftop',
        label: 'Climb to Moonlit Rooftop',
        badgeText: '🌙 ROOFTOP',
      },
    ],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_gouda_jr',
          name: 'Castle Captain Gouda Jr.',
          role: 'Snow Keep Gatekeeper',
          introLine: 'Halt! Nobody climbs up to my dad’s moonlit rooftop with Sensei Bob on my watch!',
          rewardCoins: 480,
          victoryRelics: 0,
          team: [
            { speciesId: 'frostgibbon', level: 19 },
            { speciesId: 'senseibob', level: 19 },
          ],
        },
      },
    ],
    chests: [
      { id: 'castle_west_armory', col: 2, row: 5, label: 'Kimono Silk Chest', relics: 0, superBalls: 3, coins: 340 },
      { id: 'castle_east_armory', col: 14, row: 5, label: 'Tatami Guard Vault', relics: 0, balls: 8, berries: 6 },
    ],
    wildSpawns: [
      { speciesId: 'senseibob', level: 19, col: 8, row: 4 },
      { speciesId: 'mysticlangur', level: 19, col: 4, row: 2 },
    ],
  },

  // 8d. Moonlit Rooftop
  shogun_rooftop: {
    id: 'shogun_rooftop',
    title: 'MOONLIT CASTLE ROOFTOP',
    theme: 'moon_rooftop',
    tileSize: 1.26,
    grid: [
      '#################',
      '######DDDDD######',
      '#####.DDDDD.#####',
      '####...===...####',
      '###....===....###',
      '##.....===.....##',
      '#......===......#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    warps: [
      {
        id: 'rooftop_down_castle',
        col: 8,
        row: 8,
        toInteriorId: 'shogun_castle',
        label: 'Descend into Snow Keep',
        badgeText: '⬇️ KEEP',
      },
    ],
    stations: [
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_lord_gouda',
          name: 'Lord Gouda',
          role: 'Snow Keep Boss',
          isWarden: true,
          introLine: 'You and Sensei Bob want Snow Town’s Golden Relics back?! Defeat my champion Monkemon under the moon first!',
          rewardCoins: 920,
          victoryRelics: 2,
          victoryFlag: 'defeated_lord_gouda',
          postVictoryScene: 'shogun_rooftop_victory',
          postVictoryClearCompanion: 'hana_bob',
          team: [
            { speciesId: 'senseibob', level: 19 },
            { speciesId: 'mysticlangur', level: 20 },
            { speciesId: 'bamboon', level: 21 },
          ],
        },
      },
    ],
  },

  // =========================================================================
  // REALM 9: CLOUD-BRIDGE SKY ISLES
  // =========================================================================

  // 9a. Cloud Maze
  gauntlet_dungeon: {
    id: 'gauntlet_dungeon',
    title: 'STARLIGHT CLOUD MAZE',
    theme: 'ruins',
    tileSize: 1.28,
    grid: [
      '#################',
      '#...#..DDD..#...#',
      '#.#.#.#===#.#.#.#',
      '#.#...#===#...#.#',
      '#.###..===..###.#',
      '#.....#.=.#.....#',
      '#.###...=...###.#',
      '#.......=.......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    chests: [
      { id: 'gauntlet_entry_relic', col: 6, row: 7, label: 'Entrance Pedestal Relic', relics: 1, balls: 8, coins: 300 },
      { id: 'gauntlet_deep_vault', col: 8, row: 1, label: 'Starlight Spear Vault', relics: 0, keyItem: 'sky_lance', superBalls: 5, berries: 8, coins: 450 },
      { id: 'gauntlet_west_vault', col: 1, row: 1, label: 'Cloud Tamer Chest', relics: 0, superBalls: 3, coins: 320 },
    ],
    wildSpawns: [
      { speciesId: 'howlshade', level: 21, col: 4, row: 5 },
      { speciesId: 'pyrodril', level: 22, col: 12, row: 5 },
    ],
  },

  // 9b. Twin-Wing Cloud Hall
  cloud_palace: {
    id: 'cloud_palace',
    title: 'TWIN-WING CLOUD HALL',
    theme: 'cloud_palace',
    tileSize: 1.28,
    grid: [
      '#################',
      '#~~~~.DDDDD.~~~~#',
      '#~~~~..===..~~~~#',
      '#~~~~..===..~~~~#',
      '#.P.P.=====.P.P.#',
      '#...............#',
      '#.P.P.=====.P.P.#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 5, label: 'CELESTIAL CLOUD FONT' },
      {
        kind: 'trainer',
        col: 8,
        row: 1,
        trainerDef: {
          id: 'boss_skyfather_bamboon',
          name: 'Elder Bamboon',
          role: 'Keeper of Cloud Hall',
          isWarden: true,
          introLine: 'Welcome to Cloud Hall! Show me how strong your Monkemon have grown to earn my Cloud Shield Charm!',
          rewardCoins: 1050,
          victoryRelics: 5,
          victoryKeyItem: 'aegis_charm',
          victoryFlag: 'earned_cloud_aegis',
          postVictoryScene: 'skyfather_duel_won',
          team: [
            { speciesId: 'frostgibbon', level: 21 },
            { speciesId: 'senseibob', level: 22 },
            { speciesId: 'bamboon', level: 23 },
          ],
        },
      },
    ],
    chests: [
      { id: 'cloud_east_wing', col: 14, row: 5, label: 'East Wing Feather Chest', relics: 2, superBalls: 4, coins: 380 },
    ],
  },

  // =========================================================================
  // REALM 10: VOLCANO SUMMIT & CENTRAL SKY SHRINE
  // =========================================================================

  // 10a. Beef House Championship Hall
  beef_house: {
    id: 'beef_house',
    title: 'BEEF HOUSE CHAMPIONSHIP HALL',
    theme: 'beef_dojo',
    tileSize: 1.3,
    grid: [
      '#################',
      '#^^P..DDDDD..P^^#',
      '#^^...DDDDD...^^#',
      '#..===========..#',
      '#^^..=======..^^#',
      '#^^..=======..^^#',
      '#..P..=====..P..#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      { kind: 'heal', col: 3, row: 7, label: 'CHAMPION PREP BENCH' },
      { kind: 'shop', col: 13, row: 7 },
      { kind: 'pc', col: 14, row: 3 },
      {
        kind: 'warden',
        col: 8,
        row: 1,
        wardenId: 'champion_chuck',
        victoryRelics: 2,
      },
    ],
    chests: [
      { id: 'beef_dojo_chest', col: 2, row: 3, label: 'Championship Belt Vault', relics: 0, superBalls: 4, coins: 400 },
    ],
  },

  // 10b. Summit Bastion
  final_dungeon: {
    id: 'final_dungeon',
    title: 'SUMMIT BASTION',
    theme: 'volcano_dungeon',
    tileSize: 1.28,
    grid: [
      '#################',
      '#^^.#..DDD..#.^^#',
      '#^^.#..===..#.^^#',
      '#...+..===..+...#',
      '#.####.===.####.#',
      '#......===......#',
      '#^^.#..===..#.^^#',
      '#^^....===....^^#',
      '#######===#######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 5,
        name: 'Explorer Dad!',
        badgeText: '⭐ DAD JOINS',
        healParty: true,
        joinCompanion: 'dad_rex',
        joinUnlessFlag: 'defeated_solar_patron',
        storyScene: 'final_bastion_dad_stand',
        line: 'Great job making it to the Summit, kiddo! Beat the Iron Guardian ahead to claim the Sky-Tree Core Seed and Golden Banana-Blade!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'boss_war_mech',
          name: 'Iron Bastion Guardian',
          role: 'Keeper of the Core Seed',
          isWarden: true,
          introLine: 'DEFENSE MODE ACTIVE! PROVE YOUR SQUAD CAN PROTECT THE SKY-TREE CORE SEED!',
          rewardCoins: 980,
          victoryRelics: 0,
          victoryKeyItem: 'goddess_heart',
          team: [
            { speciesId: 'geartail', level: 24 },
            { speciesId: 'pyrodril', level: 25 },
          ],
        },
      },
    ],
    chests: [
      {
        id: 'final_banana_calibur',
        col: 8,
        row: 1,
        label: 'Golden Banana-Blade Pedestal',
        keyItem: 'banana_calibur',
        relics: 1,
        superBalls: 5,
        berries: 8,
        coins: 600,
      },
      { id: 'final_west_bastion', col: 4, row: 3, label: 'Summit Bastion Chest', relics: 1, balls: 10 },
    ],
    wildSpawns: [
      { speciesId: 'pyrodril', level: 24, col: 8, row: 4 },
      { speciesId: 'howlshade', level: 24, col: 12, row: 5 },
    ],
  },

  // 10c. Central Sky-Vine Shrine
  central_shrine: {
    id: 'central_shrine',
    title: 'CENTRAL SKY-VINE SHRINE',
    theme: 'starlight_shrine',
    tileSize: 1.3,
    grid: [
      '#################',
      '#~~~~DDDDDDD~~~~#',
      '#~~~~P.DDD.P~~~~#',
      '#~~~~..===..~~~~#',
      '#~~~~.P===P.~~~~#',
      '#~~~~..===..~~~~#',
      '#~~~~.P===P.~~~~#',
      '#~~~~.=====.~~~~#',
      '######=====######',
    ],
    entryTile: [8, 7],
    exitTile: [8, 8],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 7,
        name: 'Explorer Dad',
        badgeText: '✨ RALLY',
        healParty: true,
        line: 'Solar Kong is right ahead trying to steal all 77 Relics—let’s stop him and calm #20 King Monkezilla together!',
      },
      {
        kind: 'trainer',
        col: 10,
        row: 7,
        trainerDef: {
          id: 'trainer_clay_idol',
          name: 'Ancient Clay Guardian',
          role: 'Keeper of the Seven-Star Baton',
          introLine: 'RUMBLE-CLACK! Defeat this ancient shrine guardian to earn the rare Seven-Star Baton!',
          rewardCoins: 1500,
          victoryRelics: 0,
          victoryKeyItem: 'seven_blade',
          team: [
            { speciesId: 'senseibob', level: 26 },
            { speciesId: 'bamboon', level: 27 },
          ],
        },
      },
      {
        kind: 'trainer',
        col: 8,
        row: 4,
        trainerDef: {
          id: 'boss_solar_betrayer',
          name: 'Solar Kong (#19)',
          role: 'Greedy Relic Boss (#19)',
          isWarden: true,
          voiceKey: 'boss19_titanape',
          preBattleScene: 'solar_extortion_76_twist',
          introLine: 'THE 77 GOLDEN RELICS ARE MINE!! NOBODY CAN STOP MY SOLAR POWER!!',
          rewardCoins: 1400,
          victoryRelics: 4,
          victoryFlag: 'defeated_solar_patron',
          postVictoryScene: 'solar_servant_shield_and_statue',
          postVictoryJoinCompanion: 'goddess_liana',
          team: [
            { speciesId: 'geartail', level: 25 },
            { speciesId: 'pyrodril', level: 26 },
            { speciesId: 'solarkong', level: 27 },
          ],
        },
      },
    ],
    wildSpawns: [
      {
        id: 'shrine_boss_20_monkezilla',
        speciesId: 'monkezilla',
        level: 30,
        col: 8,
        row: 1,
        isAlpha: true,
        isFinalBoss: true,
        music: 'monkezilla',
        voiceKey: 'boss20_monkezilla',
        introLine: 'ROOOAAAR!! #20 KING MONKEZILLA AWAKENS! Battle or catch the giant protector to save the Sky-Vine Tree!',
      },
    ],
  },

  // =========================================================================
  // OPEN-WORLD FRONTIER SIDE-AREAS, GROTTOS, OBSERVATORIES & LAIRS (Worlds 1–10)
  // Optional off-road dungeons & sanctuaries rewarding curious explorers!
  // =========================================================================

  // W1 Optional Grotto: Tidepool Smuggler Cove (Western Tidepool Cape, World 1)
  smuggler_cove: {
    id: 'smuggler_cove',
    title: 'TIDEPOOL SMUGGLER COVE',
    subtitle: 'World 1 Frontier Grotto · Tidal Bridges & Hidden Supply Cache',
    theme: 'sea_palace',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..~~~..+..~~~..#',
      '#..~~~.....~~~..#',
      '#..===..P..===..#',
      '#...............#',
      '#.~~~..===..~~~.#',
      '#.~~~..===..~~~.#',
      '#......===......#',
      '#..P...===...P..#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 8,
        name: 'Driftwood Explorer Pip',
        badgeText: '🧭 SCOUT',
        healParty: true,
        line: 'You hiked all the way out to Western Tidepool Cape! Rare water-loving Monkemon nest along these bioluminescent tidal bridges!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 4,
        trainerDef: {
          id: 'trainer_cove_buccaneer',
          name: 'Tidepool Buccaneer Rico',
          role: 'Smuggler Cove Lookout',
          introLine: 'Yo-ho! Nobody raids the Tidepool Cove cache without besting my wave-riding squad first!',
          rewardCoins: 175,
          victoryRelics: 0,
          team: [
            { speciesId: 'duckaque', level: 5 },
            { speciesId: 'puppuchin', level: 5 },
          ],
        },
      },
    ],
    chests: [
      { id: 'smuggler_cove_cache', col: 2, row: 1, label: 'Smuggler Captain Cache', relics: 0, superBalls: 2, balls: 6, coins: 160 },
      { id: 'smuggler_cove_berries', col: 14, row: 1, label: 'Driftwood Berry Barrel', relics: 0, berries: 6, balls: 4, coins: 90 },
    ],
    wildSpawns: [
      { speciesId: 'duckaque', level: 5, col: 3, row: 4 },
      { speciesId: 'lemuripple', level: 6, col: 13, row: 4 },
    ],
  },

  // W2 Optional Ruins: Mirage Canyon Vault (Northwest Red-Rock Canyon, World 2)
  mirage_canyon_ruins: {
    id: 'mirage_canyon_ruins',
    title: 'MIRAGE CANYON VAULT',
    subtitle: 'World 2 Frontier Ruins · Buried Oasis Colonnade',
    theme: 'pyramid',
    tileSize: 1.28,
    grid: [
      '#################',
      '#.P....DDD....P.#',
      '#......===......#',
      '#.~~~..===..~~~.#',
      '#.~~~+.....+~~~.#',
      '#..==..P.P..==..#',
      '#...............#',
      '#..###.===.###..#',
      '#......===......#',
      '#.P....===....P.#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 8,
        name: 'Canyon Cartographer Tariq',
        badgeText: '🗺️ LORE',
        healParty: true,
        line: 'Before the Shifting Sands swallowed the northwest wadi, caravans rested beside these subterranean oasis springs.',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_mirage_seeker',
          name: 'Relic-Seeker Zahra',
          role: 'Canyon Vault Explorer',
          introLine: 'You tracked the desert mirage through the northern canyon! Show me how fiercely your squad shines!',
          rewardCoins: 240,
          victoryRelics: 0,
          team: [
            { speciesId: 'voltamarin', level: 8 },
            { speciesId: 'mooboon', level: 9 },
          ],
        },
      },
    ],
    chests: [
      { id: 'mirage_vault_west', col: 3, row: 1, label: 'Sun-Bleached Amphora Chest', relics: 0, superBalls: 2, berries: 5, coins: 210 },
      { id: 'mirage_vault_east', col: 13, row: 1, label: 'Oasis Caravan Strongbox', relics: 0, balls: 8, superBalls: 1, coins: 150 },
    ],
    wildSpawns: [
      { speciesId: 'voltamarin', level: 8, col: 3, row: 6 },
      { speciesId: 'chimpark', level: 9, col: 13, row: 6 },
    ],
  },

  // W3 Optional Conservatory: Colossus Botanical Conservatory (Eastern Headland, World 3)
  giants_conservatory: {
    id: 'giants_conservatory',
    title: 'COLOSSUS BOTANICAL CONSERVATORY',
    subtitle: 'World 3 Frontier Glasshouse · Giant Nectar Canals',
    theme: 'giant_hall',
    tileSize: 1.3,
    grid: [
      '#################',
      '#.T....DDD....T.#',
      '#..~~..===..~~..#',
      '#..==..===..==..#',
      '#......+.+......#',
      '#.P.#..===..#.P.#',
      '#......===......#',
      '#..~~..===..~~..#',
      '#..==..===..==..#',
      '#.T....===....T.#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 8,
        name: 'Meadow Botanist Fern',
        badgeText: '🌱 HERBALIST',
        healParty: true,
        line: 'The Giants built this sunlit glasshouse to cultivate house-sized banana orchids! Plush Monkemon adore the warm pollen!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_conservatory_orin',
          name: 'Head Gardener Orin',
          role: 'Colossus Conservatory Keeper',
          introLine: 'Careful around the giant dew-planters! Let’s test your team’s bond under the glass dome!',
          rewardCoins: 280,
          victoryRelics: 0,
          team: [
            { speciesId: 'plushaki', level: 11 },
            { speciesId: 'mossaki', level: 12 },
          ],
        },
      },
    ],
    chests: [
      { id: 'conservatory_seed_chest', col: 3, row: 1, label: 'Heirloom Seed Trunk', relics: 0, superBalls: 3, berries: 6, coins: 240 },
      { id: 'conservatory_nectar_chest', col: 13, row: 1, label: 'Golden Pollen Coffer', relics: 0, balls: 8, coins: 180 },
    ],
    wildSpawns: [
      { speciesId: 'plushaki', level: 11, col: 2, row: 5 },
      { speciesId: 'mossaki', level: 12, col: 14, row: 5 },
    ],
  },

  // W4 Optional Sea-Grotto: Abyssal Coral Grotto (Southwest Coral Peninsula, World 4)
  sunken_coral_grotto: {
    id: 'sunken_coral_grotto',
    title: 'ABYSSAL CORAL GROTTO',
    subtitle: 'World 4 Frontier Trench · Luminous Pearl Lagoons',
    theme: 'sea_palace',
    tileSize: 1.28,
    grid: [
      '#################',
      '#~~~...DDD...~~~#',
      '#~~~...===...~~~#',
      '#..==..+.+..==..#',
      '#..~~.......~~..#',
      '#..~~..P.P..~~..#',
      '#..==..===..==..#',
      '#......===......#',
      '#~~~...===...~~~#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 7,
        name: 'Pearl-Diver Marina',
        badgeText: '🐚 DIVER',
        healParty: true,
        line: 'These glowing coral pools connect straight to the deep ocean trench. Step onto the pearl spring anytime to refresh your squad!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_coral_diver',
          name: 'Trench Navigator Coral',
          role: 'Abyssal Reef Warden',
          introLine: 'Few tamers swim all the way to the southwest coral shoals—brace for a high-tide surge!',
          rewardCoins: 320,
          victoryRelics: 0,
          team: [
            { speciesId: 'lemuripple', level: 13 },
            { speciesId: 'proboscrown', level: 14 },
          ],
        },
      },
    ],
    chests: [
      { id: 'coral_grotto_pearl', col: 5, row: 1, label: 'Abyssal Pearl Reliquary', relics: 0, superBalls: 3, balls: 6, coins: 270 },
      { id: 'coral_grotto_shells', col: 11, row: 1, label: 'Luminous Conch Chest', relics: 0, berries: 7, coins: 200 },
    ],
    wildSpawns: [
      { speciesId: 'lemuripple', level: 13, col: 1, row: 5 },
      { speciesId: 'proboscrown', level: 14, col: 15, row: 5 },
    ],
  },

  // W5 Optional Outpost: Emerald Ranger Watchtower (Northern Crag Overlook, World 5)
  watchtower_cavern: {
    id: 'watchtower_cavern',
    title: 'EMERALD RANGER WATCHTOWER',
    subtitle: 'World 5 Frontier Garrison · Canopy Highland Overlook',
    theme: 'cave',
    tileSize: 1.28,
    grid: [
      '#################',
      '#..P...DDD...P..#',
      '#......===......#',
      '#.###..===..###.#',
      '#...+..===..+...#',
      '#......===......#',
      '#.###.......###.#',
      '#...#..===..#...#',
      '#......===......#',
      '#..P...===...P..#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 8,
        name: 'Lookout Scout Rowan',
        badgeText: '🏹 GARRISON',
        healParty: true,
        line: 'From our northern crag watchtower you can see all five canopy valleys of the Guardian Pines!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_watchtower_vance',
          name: 'Ranger Captain Vance',
          role: 'Northern Highland Commander',
          introLine: 'Impressive trailcraft reaching the northern watch-crag! Let’s sharpen your tactics before the higher realms!',
          rewardCoins: 360,
          victoryRelics: 0,
          team: [
            { speciesId: 'geartail', level: 15 },
            { speciesId: 'howlshade', level: 15 },
          ],
        },
      },
    ],
    chests: [
      { id: 'watchtower_armory', col: 1, row: 7, label: 'Ranger Expedition Pack', relics: 0, superBalls: 3, balls: 8, coins: 290 },
      { id: 'watchtower_rations', col: 15, row: 7, label: 'Highland Espresso Crate', relics: 0, berries: 8, coins: 220 },
    ],
    wildSpawns: [
      { speciesId: 'geartail', level: 15, col: 3, row: 2 },
      { speciesId: 'frostgibbon', level: 15, col: 13, row: 2 },
    ],
  },

  // W6 Optional Magma Cavern: Ashen Basalt Lava Tubes (Northeast Volcanic Badlands, World 6)
  ashen_lava_tubes: {
    id: 'ashen_lava_tubes',
    title: 'ASHEN BASALT LAVA TUBES',
    subtitle: 'World 6 Frontier Tunnels · Rebel Smelter Hideout',
    theme: 'volcano_dungeon',
    tileSize: 1.28,
    grid: [
      '#################',
      '#^^....DDD....^^#',
      '#^^....===....^^#',
      '#..==..+.+..==..#',
      '#..^^.......^^..#',
      '#..^^.#####.^^..#',
      '#..==...=...==..#',
      '#......===......#',
      '#^^....===....^^#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 7,
        name: 'Outcast Sculptor Milo',
        badgeText: '🔥 REBEL CAMP',
        healParty: true,
        line: 'Citizens banished from the Vain Matriarch’s walled city carved a safe refuge out here in the northeast basalt tubes!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_lava_centurion',
          name: 'Exiled Centurion Kael',
          role: 'Basalt Tube Defender',
          introLine: 'The magma vents keep the Matriarch’s patrols away—show me your squad can endure volcanic heat!',
          rewardCoins: 420,
          victoryRelics: 0,
          team: [
            { speciesId: 'pyrodril', level: 17 },
            { speciesId: 'chimpark', level: 17 },
          ],
        },
      },
    ],
    chests: [
      { id: 'lava_tube_cache', col: 4, row: 1, label: 'Rebel Forge Strongbox', relics: 0, superBalls: 4, balls: 8, coins: 340 },
      { id: 'lava_tube_obsidian', col: 12, row: 1, label: 'Obsidian Ingot Chest', relics: 0, berries: 8, coins: 260 },
    ],
    wildSpawns: [
      { speciesId: 'pyrodril', level: 17, col: 1, row: 5 },
      { speciesId: 'chimpark', level: 17, col: 15, row: 5 },
    ],
  },

  // W7 Optional Circuit Vault: Grandstand Trophy Cavern (Southern Cape Speedway, World 7)
  champions_paddock_vault: {
    id: 'champions_paddock_vault',
    title: 'GRANDSTAND TROPHY CAVERN',
    subtitle: 'World 7 Frontier Speedway · Underground Turbo Loop',
    theme: 'race_track',
    tileSize: 1.3,
    grid: [
      '#################',
      '#.>>>>.DDD.>>>>.#',
      '#.>....===....>.#',
      '#.>.##.+.+.##.>.#',
      '#.>...........>.#',
      '#.>.##.===.##.>.#',
      '#.>....===....>.#',
      '#.>>>>.===.>>>>.#',
      '#......===......#',
      '#.P....===....P.#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 5,
        row: 8,
        name: 'Pit-Chief Wrench',
        badgeText: '🏁 PIT CREW',
        healParty: true,
        line: 'Welcome to the secret southern speedway! Hit the yellow > Turbo Strips to rocket around the trophy loop!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_trophy_ace',
          name: 'Time-Trial Ace Nitro',
          role: 'Southern Circuit Record-Holder',
          introLine: 'Full throttle! Nobody touches the Grandstand Trophy Chests unless they can outpace my Geartail!',
          rewardCoins: 460,
          victoryRelics: 0,
          team: [
            { speciesId: 'geartail', level: 18 },
            { speciesId: 'voltamarin', level: 19 },
          ],
        },
      },
    ],
    chests: [
      { id: 'trophy_cavern_gold', col: 7, row: 1, label: 'Golden Cup Paddock Vault', relics: 0, superBalls: 4, balls: 8, coins: 390 },
      { id: 'trophy_cavern_pit', col: 9, row: 1, label: 'Pit-Crew Berry Cooler', relics: 0, berries: 9, superBalls: 2, coins: 260 },
    ],
    wildSpawns: [
      { speciesId: 'geartail', level: 18, col: 2, row: 4 },
      { speciesId: 'voltamarin', level: 18, col: 14, row: 4 },
    ],
  },

  // W8 Optional Retreat: Misty Bamboo Hot-Spring Hermitage (Northwest Alpine Gorge, World 8)
  bamboo_hotspring_hermitage: {
    id: 'bamboo_hotspring_hermitage',
    title: 'BAMBOO HOT-SPRING HERMITAGE',
    subtitle: 'World 8 Frontier Onsen · Steaming Cedar Springs',
    theme: 'edo_castle',
    tileSize: 1.28,
    grid: [
      '#################',
      '#.~~~..DDD..~~~.#',
      '#.~~~+.....+~~~.#',
      '#..==..===..==..#',
      '#......===......#',
      '#.P..P.===.P..P.#',
      '#......===......#',
      '#.~~~..===..~~~.#',
      '#..==..===..==..#',
      '#.T....===....T.#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 8,
        name: 'Onsen Keeper Satsuki',
        badgeText: '♨️ ONSEN',
        healParty: true,
        line: 'Soak weary paws in our steaming alpine springs! Wise Bamboon and Senseibob meditate here far from the Shogunate’s bustle.',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 3,
        trainerDef: {
          id: 'trainer_bamboo_hermit',
          name: 'Sword-Hermit Ren',
          role: 'Alpine Bamboo Grandmaster',
          introLine: 'Still mind, swift strike! Show me the harmony you forged climbing the northwest snow-pass!',
          rewardCoins: 520,
          victoryRelics: 0,
          team: [
            { speciesId: 'senseibob', level: 20 },
            { speciesId: 'bamboon', level: 21 },
          ],
        },
      },
    ],
    chests: [
      { id: 'hermitage_scroll_box', col: 6, row: 1, label: 'Cedar Lacquer Scroll Chest', relics: 0, superBalls: 4, balls: 10, coins: 430 },
      { id: 'hermitage_tea_chest', col: 10, row: 1, label: 'Matcha & Sweet-Bun Box', relics: 0, berries: 10, coins: 310 },
    ],
    wildSpawns: [
      { speciesId: 'bamboon', level: 20, col: 3, row: 5 },
      { speciesId: 'senseibob', level: 20, col: 13, row: 5 },
    ],
  },

  // W9 Optional Spire: Celestial Starlight Observatory (Far Northern Cloud-Reef, World 9)
  starlight_observatory: {
    id: 'starlight_observatory',
    title: 'CELESTIAL STARLIGHT OBSERVATORY',
    subtitle: 'World 9 Frontier Spire · Astral Astrolabe Rotunda',
    theme: 'starlight_shrine',
    tileSize: 1.3,
    grid: [
      '#################',
      '#~~~...DDD...~~~#',
      '#~~~.P.===.P.~~~#',
      '#..===.+.+.===..#',
      '#..~~~.....~~~..#',
      '#..===.P.P.===..#',
      '#..~~~.===.~~~..#',
      '#......===......#',
      '#~~~.P.===.P.~~~#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 7,
        name: 'Astral Archivist Lyra',
        badgeText: '🔭 ASTROLABE',
        healParty: true,
        line: 'Through our northern crystal telescope, you can trace the Sky-Vine Spire binding all ten realms together across the sea of clouds!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_star_seer',
          name: 'Star-Chart Sage Orion',
          role: 'Celestial Observatory Keeper',
          introLine: 'The constellations foretold a fearless tamer crossing the northern cloud-bridges—let our starlight duel begin!',
          rewardCoins: 580,
          victoryRelics: 0,
          team: [
            { speciesId: 'mysticlangur', level: 22 },
            { speciesId: 'geartail', level: 23 },
          ],
        },
      },
    ],
    chests: [
      { id: 'observatory_prism_cache', col: 5, row: 1, label: 'Astral Telescope Vault', relics: 0, superBalls: 5, balls: 10, coins: 500 },
      { id: 'observatory_comet_box', col: 11, row: 1, label: 'Star-Dew Reliquary', relics: 0, berries: 10, superBalls: 2, coins: 350 },
    ],
    wildSpawns: [
      { speciesId: 'mysticlangur', level: 22, col: 1, row: 5 },
      { speciesId: 'geartail', level: 22, col: 15, row: 5 },
    ],
  },

  // W10 Optional Apex Lair: Obsidian Caldera Roost (Western Volcanic Rim, World 10)
  obsidian_dragon_roost: {
    id: 'obsidian_dragon_roost',
    title: 'OBSIDIAN CALDERA ROOST',
    subtitle: 'World 10 Frontier Sanctum · Ancient Magma Challenge',
    theme: 'volcano_dungeon',
    tileSize: 1.3,
    grid: [
      '#################',
      '#^^^...DDD...^^^#',
      '#^^^.P.===.P.^^^#',
      '#..===.+.+.===..#',
      '#..^^^.....^^^..#',
      '#..===.#.#.===..#',
      '#..^^^.===.^^^..#',
      '#......===......#',
      '#^^^.P.===.P.^^^#',
      '#......===......#',
      '#######===#######',
    ],
    entryTile: [8, 9],
    exitTile: [8, 10],
    stations: [
      {
        kind: 'npc',
        col: 6,
        row: 7,
        name: 'Caldera Chronicler Pyra',
        badgeText: '🌋 SANCTUM',
        healParty: true,
        line: 'Only the boldest explorers scale the western obsidian rim! Apex-tier Monkemon train amid these searing magma vents!',
      },
      {
        kind: 'trainer',
        col: 8,
        row: 2,
        trainerDef: {
          id: 'trainer_flame_warden_ignis',
          name: 'Ancient Flame-Warden Ignis',
          role: 'Obsidian Rim Champion',
          introLine: 'Before you enter the Central Sky-Vine Nexus, temper your courage against the hottest flames of the Summit!',
          rewardCoins: 760,
          victoryRelics: 0,
          team: [
            { speciesId: 'pyrodril', level: 25 },
            { speciesId: 'howlshade', level: 25 },
            { speciesId: 'solarkong', level: 26 },
          ],
        },
      },
    ],
    chests: [
      { id: 'dragon_roost_hoard', col: 5, row: 1, label: 'Obsidian Sovereign Hoard', relics: 0, superBalls: 5, berries: 8, coins: 650 },
      { id: 'dragon_roost_embers', col: 11, row: 1, label: 'Caldera Champion Chest', relics: 0, balls: 12, superBalls: 3, coins: 420 },
    ],
    wildSpawns: [
      { speciesId: 'pyrodril', level: 25, col: 1, row: 5 },
      { speciesId: 'howlshade', level: 25, col: 15, row: 5 },
      { speciesId: 'solarkong', level: 26, col: 8, row: 4 },
    ],
  },
};

// Shared Sanctuary / Outpost Inn fallback template for auxiliary rest huts (`second_town`, `dune_outpost`, `hanas_village`, `edo_court`, `summit_rest`)
export const DEFAULT_SANCTUARY_MAP = {
  id: 'sanctuary',
  title: 'SANCTUARY INN & MART',
  theme: 'town',
  tileSize: 1.25,
  grid: [
    '###############',
    '#..P..DDD..P..#',
    '#.....===.....#',
    '#.#...===...#.#',
    '#.....===.....#',
    '#..P..===..P..#',
    '#T...........T#',
    '######===######',
  ],
  entryTile: [7, 6],
  exitTile: [7, 7],
  stations: [
    { kind: 'heal', col: 7, row: 1, label: 'SANCTUARY HEALING WELL' },
    { kind: 'shop', col: 3, row: 3 },
    { kind: 'pc', col: 11, row: 3 },
  ],
  chests: [],
};

export function getInteriorMapSpec(houseDef) {
  if (!houseDef) return DEFAULT_SANCTUARY_MAP;
  if (houseDef.interiorMapId && INTERIOR_MAPS[houseDef.interiorMapId]) {
    return INTERIOR_MAPS[houseDef.interiorMapId];
  }
  if (INTERIOR_MAPS[houseDef.id]) {
    return INTERIOR_MAPS[houseDef.id];
  }
  return {
    ...DEFAULT_SANCTUARY_MAP,
    id: houseDef.id,
    title: houseDef.label || 'SANCTUARY',
  };
}
