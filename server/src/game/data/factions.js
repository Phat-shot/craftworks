'use strict';
// ═══════════════════════════════════════════════════════════════════
//  C&C GENERALS — Faction Data
//  3 factions: USA, China, GLA
// ═══════════════════════════════════════════════════════════════════

// ── Shared constants ─────────────────────────────────────────────
const UNIT_TYPES = {
  infantry: 'infantry',
  vehicle:  'vehicle',
  aircraft: 'aircraft',
  builder:  'builder',   // Dozer / Worker
};

// ── USA ──────────────────────────────────────────────────────────
const USA = {
  id: 'usa',
  name: 'USA',
  icon: '🦅',
  color: '#4080c0',
  description: 'Technologisch überlegene Streitkräfte. Braucht Energie. Dozer baut Strukturen.',
  needsPower: true,
  builderUnit: 'dozer',

  // Power production/consumption per structure
  structures: {
    command_center: {
      id:'command_center', name:'Kommandozentrale', icon:'🏛️',
      cost:1000, buildTime:45, power:0, hp:1500,
      size:4, prereq:[], produces:['dozer'],
      desc:'Hauptgebäude. Produces Dozer.',
    },
    power_plant: {
      id:'power_plant', name:'Kraftwerk', icon:'⚡',
      cost:100, buildTime:15, power:+10, hp:400,
      size:2, prereq:['command_center'],
      desc:'+10 Energie.',
    },
    supply_depot: {
      id:'supply_depot', name:'Versorgungsdepot', icon:'📦',
      cost:200, buildTime:20, power:-2, hp:500,
      size:3, prereq:['command_center'],
      desc:'Goldgewinnung automatisch.',
    },
    barracks: {
      id:'barracks', name:'Kaserne', icon:'🏗️',
      cost:300, buildTime:20, power:-2, hp:600,
      size:3, prereq:['command_center'],
      produces:['ranger','missile_defender','pathfinder'],
      desc:'Infanterie ausbilden.',
    },
    war_factory: {
      id:'war_factory', name:'Waffenfabrik', icon:'🏭',
      cost:800, buildTime:30, power:-4, hp:1000,
      size:4, prereq:['command_center'],
      produces:['crusader','paladin','humvee','tomahawk'],
      desc:'Fahrzeuge produzieren.',
    },
    air_force_command: {
      id:'air_force_command', name:'Luftwaffenkommando', icon:'✈️',
      cost:800, buildTime:25, power:-4, hp:700,
      size:4, prereq:['power_plant','war_factory'],
      produces:['raptor','comanche','stealth_fighter','aurora'],
      desc:'Lufteinheiten. Kampfjets & Hubschrauber.',
    },
    strategy_center: {
      id:'strategy_center', name:'Strategiezentrum', icon:'🎯',
      cost:1000, buildTime:30, power:-4, hp:800,
      size:4, prereq:['air_force_command'],
      desc:'Freischalten: Bombardierung, Schildmodus, Angriffsmodus.',
    },
    patriot_battery: {
      id:'patriot_battery', name:'Patriot-Batterie', icon:'🚀',
      cost:800, buildTime:20, power:-3, hp:500,
      size:2, prereq:['power_plant'],
      desc:'Luftabwehr. Schießt Flugzeuge & Raketen ab.',
    },
    particle_cannon: {
      id:'particle_cannon', name:'Partikelkanone', icon:'🔆',
      cost:2500, buildTime:60, power:-8, hp:600,
      size:4, prereq:['strategy_center'],
      desc:'Superwaffe. Feuert Partikelstrahl auf Ziel.',
    },
    fire_base: {
      id:'fire_base', name:'Feuerbasis', icon:'🗼',
      cost:500, buildTime:20, power:-2, hp:700,
      size:3, prereq:['barracks'],
      desc:'Artilleriestellung. Kann Infanterie unterbringen.',
    },
  },

  units: {
    dozer: {
      id:'dozer', name:'Dozer', icon:'🚜', type:'builder',
      cost:1000, buildTime:15, hp:200, spd:2, armor:0.1,
      prereq:[], producedBy:['command_center'],
      desc:'Baut alle USA-Strukturen.',
    },
    ranger: {
      id:'ranger', name:'Ranger', icon:'🪖', type:'infantry',
      cost:300, buildTime:6, hp:100, spd:4, dmg:15, range:4, armor:0,
      prereq:['barracks'], producedBy:['barracks'],
      upgrades:['flash_bang'],
      desc:'Standard-Infanterie. Flash-Bang Granaten möglich.',
    },
    missile_defender: {
      id:'missile_defender', name:'Raketensoldat', icon:'💂', type:'infantry',
      cost:400, buildTime:8, hp:100, spd:3, dmg:40, range:8, armor:0,
      armorType:'anti_vehicle',
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Panzerbrechende Raketen. Effektiv gegen Fahrzeuge & Gebäude.',
    },
    pathfinder: {
      id:'pathfinder', name:'Pathfinder', icon:'🎯', type:'infantry',
      cost:600, buildTime:10, hp:80, spd:4, dmg:50, range:10, armor:0,
      prereq:['strategy_center'], producedBy:['barracks'],
      desc:'Scharfschütze. Hohe Reichweite, getarnt wenn stehend.',
    },
    crusader: {
      id:'crusader', name:'Crusader-Panzer', icon:'🛡️', type:'vehicle',
      cost:800, buildTime:14, hp:600, spd:5, dmg:80, range:5, armor:0.3,
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Standar-Kampfpanzer. Solide Allround-Einheit.',
    },
    paladin: {
      id:'paladin', name:'Paladin-Panzer', icon:'⚔️', type:'vehicle',
      cost:1200, buildTime:18, hp:800, spd:4, dmg:100, range:6, armor:0.4,
      prereq:['strategy_center'], producedBy:['war_factory'],
      special:'laser_shield',
      desc:'Laserkanone + Raketenabwehr-Schild.',
    },
    humvee: {
      id:'humvee', name:'Humvee', icon:'🚙', type:'vehicle',
      cost:500, buildTime:10, hp:350, spd:8, dmg:25, range:5, armor:0.1,
      slots:4, // can carry infantry
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Schnelles Transport-/Kampffahrzeug. Trägt 4 Infanteristen.',
    },
    tomahawk: {
      id:'tomahawk', name:'Tomahawk-Werfer', icon:'🎯', type:'vehicle',
      cost:1000, buildTime:16, hp:250, spd:3, dmg:150, range:15, armor:0.1,
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Langstrecken-Raketenwerfer. Kann sich nicht verteidigen.',
    },
    raptor: {
      id:'raptor', name:'F-22 Raptor', icon:'✈️', type:'aircraft',
      cost:1200, buildTime:20, hp:350, spd:12, dmg:120, range:8, armor:0.2,
      prereq:['air_force_command'], producedBy:['air_force_command'],
      desc:'Überlegenes Luftkampfflugzeug.',
    },
    comanche: {
      id:'comanche', name:'Comanche', icon:'🚁', type:'aircraft',
      cost:1000, buildTime:16, hp:300, spd:8, dmg:80, range:6, armor:0.15,
      prereq:['air_force_command'], producedBy:['air_force_command'],
      special:'stealth',
      desc:'Tarnkopter. Unsichtbar außer im Angriff.',
    },
    stealth_fighter: {
      id:'stealth_fighter', name:'Tarnkampfjet', icon:'🥷', type:'aircraft',
      cost:1400, buildTime:22, hp:280, spd:14, dmg:200, range:10, armor:0.1,
      prereq:['air_force_command'], producedBy:['air_force_command'],
      special:'stealth',
      desc:'Tarnbomber. Sehr hoher Schaden.',
    },
    aurora: {
      id:'aurora', name:'Aurora-Bomber', icon:'☄️', type:'aircraft',
      cost:2000, buildTime:28, hp:200, spd:20, dmg:500, range:0, armor:0,
      prereq:['air_force_command','strategy_center'], producedBy:['air_force_command'],
      desc:'Hyperschall-Bomber. Einzelner verheerender Angriff.',
    },
  },

  generalPowers: [
    {id:'spy_drone',   name:'Spionagedrohne',   cost:1, icon:'🔭', desc:'Enthüllt Feindgebiet für 30s.'},
    {id:'carpet_bomb', name:'Teppichbombing',    cost:3, icon:'💥', desc:'B-52 wirft Bombenteppich.'},
    {id:'paradrop',    name:'Fallschirmjäger',   cost:3, icon:'🪂', desc:'5 Ranger werden abgeworfen.'},
    {id:'particle_uplink', name:'Partikelangriff', cost:5, icon:'🔆', desc:'Sofortiger Partikelstrahl.'},
    {id:'fuel_air_bomb',   name:'Sauerstoffbombe', cost:3, icon:'🌡️', desc:'Verbrannte Zone, Infanterie vernichtet.'},
  ],
};

// ── CHINA ─────────────────────────────────────────────────────────
const CHINA = {
  id: 'china',
  name: 'China',
  icon: '🐉',
  color: '#c03020',
  description: 'Starke Panzertruppen, Propaganda & nukleare Optionen. Braucht Energie.',
  needsPower: true,
  builderUnit: 'dozer',

  structures: {
    command_center: {
      id:'command_center', name:'Kommandozentrale', icon:'🏛️',
      cost:1000, buildTime:45, power:0, hp:2000,
      size:4, prereq:[], produces:['dozer'],
      desc:'Hauptgebäude. Erzeugt Dozer.',
    },
    nuclear_reactor: {
      id:'nuclear_reactor', name:'Atomreaktor', icon:'⚛️',
      cost:600, buildTime:20, power:+20, hp:500,
      size:3, prereq:['command_center'],
      desc:'+20 Energie. Explodiert bei Zerstörung → Strahlungszone.',
    },
    supply_center: {
      id:'supply_center', name:'Versorgungszentrum', icon:'📦',
      cost:200, buildTime:18, power:-2, hp:600,
      size:3, prereq:['command_center'],
      desc:'Automatische Goldgewinnung.',
    },
    barracks: {
      id:'barracks', name:'Kaserne', icon:'🏗️',
      cost:300, buildTime:20, power:-2, hp:700,
      size:3, prereq:['command_center'],
      produces:['red_guard','tank_hunter','hacker'],
      desc:'Infanterie ausbilden.',
    },
    war_factory: {
      id:'war_factory', name:'Waffenfabrik', icon:'🏭',
      cost:800, buildTime:30, power:-4, hp:1200,
      size:4, prereq:['command_center'],
      produces:['battlemaster','dragon_tank','gattling_tank','troop_crawler'],
      desc:'Fahrzeuge & Panzer produzieren.',
    },
    radar: {
      id:'radar', name:'Radar', icon:'📡',
      cost:600, buildTime:20, power:-3, hp:500,
      size:3, prereq:['barracks','war_factory'],
      desc:'Enthüllt Minimap. Ermöglicht Overlord & MiG.',
    },
    propaganda_center: {
      id:'propaganda_center', name:'Propagandazentrum', icon:'📢',
      cost:800, buildTime:25, power:-3, hp:600,
      size:3, prereq:['barracks'],
      desc:'Heilt benachbarte Einheiten. Schussfeste Aura.',
    },
    internet_center: {
      id:'internet_center', name:'Internetzentrum', icon:'💻',
      cost:1000, buildTime:30, power:-4, hp:700,
      size:4, prereq:['radar'],
      desc:'Hacker produzieren Geld passiv. Freischaltung Overlord-Upgrade.',
    },
    nuclear_missile_silo: {
      id:'nuclear_missile_silo', name:'Atomraketen-Silo', icon:'☢️',
      cost:2500, buildTime:60, power:-8, hp:800,
      size:4, prereq:['propaganda_center','nuclear_reactor'],
      desc:'Superwaffe: Nukleare ICBM auf Zielgebiet.',
    },
    gattling_cannon: {
      id:'gattling_cannon', name:'Gatling-Kanone', icon:'🔫',
      cost:600, buildTime:18, power:-3, hp:600,
      size:2, prereq:['war_factory'],
      desc:'Luftabwehr & Infanterieabwehr. Heizt sich auf.',
    },
    bunker: {
      id:'bunker', name:'Bunker', icon:'🏰',
      cost:400, buildTime:15, power:0, hp:1000,
      size:2, prereq:['barracks'],
      desc:'Bis zu 5 Infanteristen. Schussfenster.',
    },
  },

  units: {
    dozer: {
      id:'dozer', name:'Dozer', icon:'🚜', type:'builder',
      cost:1000, buildTime:15, hp:200, spd:2, armor:0.1,
      prereq:[], producedBy:['command_center'],
      desc:'Baut alle China-Strukturen.',
    },
    red_guard: {
      id:'red_guard', name:'Rote Garde', icon:'🪖', type:'infantry',
      cost:200, buildTime:5, hp:120, spd:4, dmg:12, range:4, armor:0,
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Billige Masseninfanterie. In Gruppen effektiv.',
    },
    tank_hunter: {
      id:'tank_hunter', name:'Panzerjäger', icon:'💪', type:'infantry',
      cost:300, buildTime:7, hp:100, spd:3, dmg:50, range:7, armor:0,
      armorType:'anti_vehicle',
      prereq:['barracks'], producedBy:['barracks'],
      desc:'RPG-Schütze. Sehr effektiv gegen Panzer.',
    },
    hacker: {
      id:'hacker', name:'Hacker', icon:'💻', type:'infantry',
      cost:600, buildTime:12, hp:60, spd:3, dmg:0, range:0, armor:0,
      special:'hacking', // generates gold
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Hackt Geld. Kann feindliche Strukturen lahmlegen.',
    },
    black_lotus: {
      id:'black_lotus', name:'Black Lotus', icon:'🌸', type:'infantry',
      cost:1500, buildTime:20, hp:80, spd:5, dmg:0, range:0, armor:0,
      special:'capture_hack',
      prereq:['internet_center'], producedBy:['barracks'],
      desc:'Heldin. Kann Gebäude kapern & feindliche Einheiten hacken.',
    },
    battlemaster: {
      id:'battlemaster', name:'Battlemaster-Panzer', icon:'🛡️', type:'vehicle',
      cost:600, buildTime:12, hp:500, spd:5, dmg:70, range:5, armor:0.3,
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Günstiger Kampfpanzer. In Masse sehr stark.',
    },
    overlord: {
      id:'overlord', name:'Overlord-Panzer', icon:'⚔️', type:'vehicle',
      cost:2000, buildTime:25, hp:2000, spd:3, dmg:150, range:6, armor:0.5,
      prereq:['radar'], producedBy:['war_factory'],
      upgrades:['bunker_add','gattling_add','propaganda_add'],
      desc:'Riesiger Schwerpanzer. Kann ein Upgrade erhalten.',
    },
    dragon_tank: {
      id:'dragon_tank', name:'Drachenpanzer', icon:'🐉', type:'vehicle',
      cost:700, buildTime:14, hp:450, spd:4, dmg:60, range:4, armor:0.25,
      dmgType:'fire',
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Flammenwerfer-Panzer. Verursacht Feuerschaden.',
    },
    gattling_tank: {
      id:'gattling_tank', name:'Gatling-Panzer', icon:'🔫', type:'vehicle',
      cost:900, buildTime:16, hp:400, spd:6, dmg:40, range:8, armor:0.2,
      dmgType:'anti_air',
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Dreifach-Gatling. Luftabwehr & Infanterieabwehr.',
    },
    troop_crawler: {
      id:'troop_crawler', name:'Truppentransporter', icon:'🚌', type:'vehicle',
      cost:800, buildTime:14, hp:600, spd:6, dmg:0, range:0, armor:0.2,
      slots:8, // carries infantry
      prereq:['war_factory'], producedBy:['war_factory'],
      desc:'Trägt 8 Infanteristen. Schussfenster seitlich.',
    },
    mig: {
      id:'mig', name:'MiG-Jäger', icon:'✈️', type:'aircraft',
      cost:1200, buildTime:18, hp:300, spd:14, dmg:100, range:7, armor:0.1,
      prereq:['radar'], producedBy:['war_factory'],
      desc:'Luftüberlegenheitsjäger. Sehr schnell.',
    },
    helix: {
      id:'helix', name:'Helix-Hubschrauber', icon:'🚁', type:'aircraft',
      cost:1400, buildTime:22, hp:700, spd:6, dmg:80, range:6, armor:0.25,
      slots:6,
      prereq:['radar'], producedBy:['war_factory'],
      upgrades:['bunker_turret','propaganda_tower'],
      desc:'Schwerer Kampfhubschrauber. Trägt 6 Infanteristen.',
    },
  },

  generalPowers: [
    {id:'cash_hack',        name:'Geld-Hack',        cost:1, icon:'💰', desc:'Hacker verdienen sofort 2000$.'},
    {id:'artillery_barrage', name:'Artilleriefeuer', cost:2, icon:'💥', desc:'Mehrere Artilleriegranaten auf Ziel.'},
    {id:'cluster_mines',    name:'Minenfeld',        cost:2, icon:'💣', desc:'Platziert Minenfeld im Zielbereich.'},
    {id:'neutron_bomb',     name:'Neutronenbombe',   cost:4, icon:'☢️', desc:'Tötet Infanterie, Gebäude bleiben.'},
    {id:'nuclear_missile',  name:'Atombombe',        cost:5, icon:'☢️', desc:'Sofortiger Nuklearschlag auf Ziel.'},
  ],
};

// ── GLA ───────────────────────────────────────────────────────────
const GLA = {
  id: 'gla',
  name: 'GLA',
  icon: '☠️',
  color: '#806020',
  description: 'Guerilla-Taktiken, kein Strom nötig. Worker baut überall. Tunnel-Netzwerk.',
  needsPower: false,
  builderUnit: 'worker',

  structures: {
    command_center: {
      id:'command_center', name:'Kommandozentrale', icon:'🏛️',
      cost:500, buildTime:30, power:0, hp:1200,
      size:3, prereq:[], produces:['worker'],
      desc:'Hauptgebäude. Erzeugt Worker. Günstiger als andere.',
    },
    black_market: {
      id:'black_market', name:'Schwarzmarkt', icon:'💰',
      cost:300, buildTime:18, power:0, hp:600,
      size:3, prereq:['command_center'],
      desc:'Generiert passiv Geld. Jeder Schwarzmarkt +30$/Tick.',
    },
    barracks: {
      id:'barracks', name:'Kaserne', icon:'🏗️',
      cost:200, buildTime:15, power:0, hp:500,
      size:2, prereq:['command_center'],
      produces:['rebel','rpg_trooper','angry_mob'],
      desc:'Infanterie ausbilden.',
    },
    arms_dealer: {
      id:'arms_dealer', name:'Waffenhändler', icon:'🔫',
      cost:500, buildTime:20, power:0, hp:800,
      size:3, prereq:['barracks'],
      produces:['technical','scorpion','marauder','quad_cannon','scud_launcher'],
      desc:'Fahrzeuge & schwere Waffen.',
    },
    palace: {
      id:'palace', name:'Palast', icon:'🕌',
      cost:800, buildTime:25, power:0, hp:2000,
      size:4, prereq:['arms_dealer'],
      produces:['jarmen_kell'],
      upgrades:['anthrax_gamma','angry_mob_upgrade','vehicle_gun_upgrade'],
      desc:'Upgrades & Held Jarmen Kell.',
    },
    tunnel_network: {
      id:'tunnel_network', name:'Tunnelnetzwerk', icon:'🕳️',
      cost:600, buildTime:20, power:0, hp:800,
      size:2, prereq:['barracks'],
      desc:'Infanterie kann zwischen Tunneln teleportieren. Schussfenster.',
    },
    stinger_site: {
      id:'stinger_site', name:'Stinger-Stellung', icon:'🚀',
      cost:600, buildTime:18, power:0, hp:600,
      size:2, prereq:['barracks'],
      desc:'Luftabwehr mit Stinger-Raketen.',
    },
    scud_storm: {
      id:'scud_storm', name:'SCUD Storm', icon:'🌪️',
      cost:2500, buildTime:60, power:0, hp:800,
      size:4, prereq:['palace'],
      desc:'Superwaffe. Feuert Schwarm vergifteter SCUD-Raketen.',
    },
    radar_van: {
      id:'radar_van', name:'Radar-Van', icon:'📡',
      cost:500, buildTime:15, power:0, hp:300,
      size:2, prereq:['arms_dealer'],
      desc:'Mobiles Radar. Enthüllt Karte.',
    },
    demo_trap: {
      id:'demo_trap', name:'Sprengfalle', icon:'💣',
      cost:200, buildTime:8, power:0, hp:50,
      size:1, prereq:['barracks'],
      desc:'Versteckte Sprengfalle. Explodiert bei Kontakt.',
    },
  },

  units: {
    worker: {
      id:'worker', name:'Worker', icon:'👷', type:'builder',
      cost:600, buildTime:12, hp:150, spd:4, armor:0,
      prereq:[], producedBy:['command_center'],
      desc:'Baut alle GLA-Strukturen überall.',
    },
    rebel: {
      id:'rebel', name:'Rebell', icon:'🔫', type:'infantry',
      cost:200, buildTime:5, hp:80, spd:5, dmg:10, range:4, armor:0,
      prereq:['barracks'], producedBy:['barracks'],
      upgrades:['ak47_upgrade'],
      desc:'Billige Masseninfanterie. Kann Gebäude kapern.',
    },
    rpg_trooper: {
      id:'rpg_trooper', name:'RPG-Kämpfer', icon:'💪', type:'infantry',
      cost:300, buildTime:7, hp:90, spd:4, dmg:60, range:8, armor:0,
      armorType:'anti_vehicle',
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Panzerbrechend. Auch gegen Luft.',
    },
    angry_mob: {
      id:'angry_mob', name:'Wütende Menge', icon:'👊', type:'infantry',
      cost:400, buildTime:8, hp:60, spd:5, dmg:8, range:2, armor:0,
      count:10, // spawns 10
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Gruppe von 10 Zivilisten. Sehr billig.',
    },
    hijacker: {
      id:'hijacker', name:'Fahrzeugdieb', icon:'🎭', type:'infantry',
      cost:800, buildTime:12, hp:60, spd:6, dmg:0, range:2, armor:0,
      special:'hijack',
      prereq:['palace'], producedBy:['barracks'],
      desc:'Kann feindliche Fahrzeuge stehlen.',
    },
    terrorist: {
      id:'terrorist', name:'Terrorist', icon:'💥', type:'infantry',
      cost:200, buildTime:5, hp:60, spd:6, dmg:400, range:1, armor:0,
      special:'suicide',
      prereq:['barracks'], producedBy:['barracks'],
      desc:'Selbstmordattentäter. Enormer Schaden bei Zündung.',
    },
    jarmen_kell: {
      id:'jarmen_kell', name:'Jarmen Kell', icon:'🎯', type:'infantry',
      cost:1500, buildTime:20, hp:120, spd:6, dmg:200, range:12, armor:0,
      special:'sniper_disable', // can disable vehicle crew
      prereq:['palace'], producedBy:['palace'],
      desc:'Held. Scharfschütze. Kann Fahrzeuge kampfunfähig machen.',
    },
    technical: {
      id:'technical', name:'Technical', icon:'🚙', type:'vehicle',
      cost:400, buildTime:8, hp:300, spd:9, dmg:30, range:5, armor:0.1,
      prereq:['arms_dealer'], producedBy:['arms_dealer'],
      desc:'Schnelles Kampffahrzeug. Kann Rebellen transportieren.',
    },
    scorpion: {
      id:'scorpion', name:'Skorpion-Panzer', icon:'🦂', type:'vehicle',
      cost:600, buildTime:12, hp:450, spd:6, dmg:65, range:5, armor:0.25,
      prereq:['arms_dealer'], producedBy:['arms_dealer'],
      upgrades:['rocket_upgrade'],
      desc:'Basis-Kampfpanzer. Raketenupgrade möglich.',
    },
    marauder: {
      id:'marauder', name:'Marauder-Panzer', icon:'🚀', type:'vehicle',
      cost:800, buildTime:14, hp:600, spd:5, dmg:80, range:6, armor:0.3,
      prereq:['palace'], producedBy:['arms_dealer'],
      desc:'Schwerer Panzer mit Raketenwerfer.',
    },
    quad_cannon: {
      id:'quad_cannon', name:'Vierfach-Kanone', icon:'🔫', type:'vehicle',
      cost:700, buildTime:12, hp:400, spd:6, dmg:50, range:7, armor:0.15,
      dmgType:'anti_air',
      prereq:['arms_dealer'], producedBy:['arms_dealer'],
      desc:'Vierläufige Flak. Effektiv gegen Infanterie & Luft.',
    },
    scud_launcher: {
      id:'scud_launcher', name:'SCUD-Werfer', icon:'☠️', type:'vehicle',
      cost:1200, buildTime:18, hp:350, spd:3, dmg:200, range:20, armor:0.1,
      dmgType:'anthrax',
      prereq:['arms_dealer','palace'], producedBy:['arms_dealer'],
      desc:'Langstrecken-Giftgasrakete. Riesige Wirkungsfläche.',
    },
    bomb_truck: {
      id:'bomb_truck', name:'Bombentruck', icon:'🚛', type:'vehicle',
      cost:700, buildTime:12, hp:400, spd:7, dmg:1500, range:1, armor:0.1,
      special:'suicide',
      prereq:['arms_dealer'], producedBy:['arms_dealer'],
      desc:'Getarnter Selbstmord-LKW. Enormer Flächenschaden.',
    },
  },

  generalPowers: [
    {id:'rebel_ambush',  name:'Rebell-Hinterhalt',  cost:1, icon:'🔫', desc:'5 Rebellen erscheinen am Zielort.'},
    {id:'cash_bounty',   name:'Kopfgeld',            cost:1, icon:'💰', desc:'+100$ für jede vernichtete Einheit für 60s.'},
    {id:'anthrax_bomb',  name:'Anthrax-Bombe',       cost:3, icon:'☠️', desc:'Giftgasbombe auf Zielgebiet.'},
    {id:'demo_airstrike', name:'Demo-Luftangriff',   cost:3, icon:'💣', desc:'Mehrere Bomben fallen auf Ziel.'},
    {id:'scud_storm',    name:'SCUD-Sturm',          cost:5, icon:'🌪️', desc:'Schwarm vergifteter Raketen.'},
  ],
};

// ── Exports ──────────────────────────────────────────────────────
const GENERALS_FACTIONS = { usa: USA, china: CHINA, gla: GLA };

module.exports = { GENERALS_FACTIONS, USA, CHINA, GLA };

// Aliases for consistent import style
module.exports.FACTION_IDS = Object.keys(GENERALS_FACTIONS);
module.exports.DEFAULT_FACTION = 'gla';
