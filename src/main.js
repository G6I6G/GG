const SAVE_KEY = "cookie-forge-save";
const CLOUD_KEY = "cookie-forge-cloud";
const AUTO_SAVE_INTERVAL = 30000;

const formatNumber = (value) => {
  if (value >= 1e12) return (value / 1e12).toFixed(2) + " трлн";
  if (value >= 1e9) return (value / 1e9).toFixed(2) + " млрд";
  if (value >= 1e6) return (value / 1e6).toFixed(2) + " млн";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return value.toFixed(0);
};

class AudioManager {
  constructor() {
    this.ctx = null;
    this.musicPlaying = false;
    this.musicNodes = [];
    this.ambientNodes = [];
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  playTone({ freq = 220, type = "sine", duration = 0.2, gain = 0.1 }) {
    this.ensureContext();
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gainNode).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playClick() {
    this.playTone({ freq: 260, type: "triangle", duration: 0.12, gain: 0.12 });
  }

  playPurchase() {
    this.playTone({ freq: 320, type: "sine", duration: 0.2, gain: 0.08 });
  }

  playUpgrade() {
    this.playTone({ freq: 540, type: "triangle", duration: 0.25, gain: 0.1 });
  }

  playAchievement() {
    this.playTone({ freq: 720, type: "sine", duration: 0.35, gain: 0.12 });
  }

  playGolden() {
    this.playTone({ freq: 880, type: "square", duration: 0.3, gain: 0.08 });
  }

  playSpell() {
    this.playTone({ freq: 630, type: "sine", duration: 0.3, gain: 0.1 });
  }

  playSeason() {
    this.playTone({ freq: 420, type: "triangle", duration: 0.4, gain: 0.08 });
  }

  playEvent() {
    this.playTone({ freq: 500, type: "sine", duration: 0.25, gain: 0.1 });
  }

  toggleMusic(progress = 0) {
    this.ensureContext();
    if (this.musicPlaying) {
      this.musicNodes.forEach((node) => node.stop());
      this.musicNodes = [];
      this.musicPlaying = false;
      this.stopAmbient();
      return false;
    }

    const base = [196, 262, 330, 392];
    base.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = index % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq + progress * 60;
      gain.gain.setValueAtTime(0.03 / (index + 1), this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.02 / (index + 1), this.ctx.currentTime + 20);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      this.musicNodes.push(osc);
    });
    this.musicPlaying = true;
    this.startAmbient();
    return true;
  }

  startAmbient() {
    this.stopAmbient();
    const hum = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    hum.type = "sine";
    hum.frequency.value = 90;
    gain.gain.setValueAtTime(0.015, this.ctx.currentTime);
    hum.connect(gain).connect(this.ctx.destination);
    hum.start();
    this.ambientNodes.push(hum);
  }

  stopAmbient() {
    this.ambientNodes.forEach((node) => node.stop());
    this.ambientNodes = [];
  }
}

class StorageManager {
  constructor(key) {
    this.key = key;
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error("Не удалось загрузить сохранение", err);
      return null;
    }
  }

  save(state) {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch (err) {
      console.error("Не удалось сохранить игру", err);
    }
  }
}

class Building {
  constructor({ id, name, baseCost, baseCps, flavor }) {
    this.id = id;
    this.name = name;
    this.baseCost = baseCost;
    this.baseCps = baseCps;
    this.flavor = flavor;
    this.count = 0;
  }

  getCost() {
    return Math.round(this.baseCost * Math.pow(1.15, this.count));
  }

  getBulkCost(amount) {
    let total = 0;
    for (let i = 0; i < amount; i += 1) {
      total += Math.round(this.baseCost * Math.pow(1.15, this.count + i));
    }
    return total;
  }
}

class Upgrade {
  constructor(config) {
    Object.assign(this, config);
    this.purchased = false;
  }
}

class Achievement {
  constructor(config) {
    Object.assign(this, config);
    this.unlocked = false;
  }
}

class MiniGameManager {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.cooldowns = {};
    this.games = this.buildGames();
  }

  setUI(ui) {
    this.ui = ui;
  }

  getCooldownRemaining(id) {
    const until = this.cooldowns[id] || 0;
    return Math.max(0, until - performance.now());
  }

  startCooldown(id, seconds) {
    this.cooldowns[id] = performance.now() + seconds * 1000;
  }

  activate(id) {
    const game = this.games.find((g) => g.id === id);
    if (!game) return false;
    if (game.requirement && !game.requirement()) {
      this.ui?.setMiniStatus("Мини-игра еще не разблокирована.");
      return false;
    }
    const remaining = this.getCooldownRemaining(id);
    if (remaining > 0) {
      this.ui?.setMiniStatus(`Мини-игра на перезарядке: ${Math.ceil(remaining / 1000)} сек.`);
      return false;
    }
    game.activate();
    this.startCooldown(id, game.cooldown || 12);
    return true;
  }

  buildGames() {
    return [
      {
        id: "burst",
        name: "Печенье-бурст",
        description: "10 секунд: клики дают в 5 раз больше печенья",
        requirement: () => this.game.totalClicks >= 50,
        cooldown: 20,
        activate: () => {
          this.game.addTemporaryClickBoost(5, 10);
          this.ui?.setMiniStatus("Печенье-бурст активирован: x5 клики на 10 секунд.");
        },
      },
      {
        id: "garden",
        name: "Сад",
        description: "Вырастите сахарные ростки: +8% ко всему производству на 30 сек.",
        requirement: () => this.game.getBuildingCount("farm") >= 5,
        cooldown: 40,
        activate: () => {
          this.game.addActiveEffect({
            id: "garden",
            name: "Садовод",
            duration: 30,
            cpsMultiplier: 1.08,
          });
          this.ui?.setMiniStatus("Сад: +8% производство на 30 секунд.");
        },
      },
      {
        id: "stock",
        name: "Биржа",
        description: "Сделка века: получить 6% текущих печений",
        requirement: () => this.game.getBuildingCount("bank") >= 3,
        cooldown: 35,
        activate: () => {
          const reward = this.game.cookies * 0.06;
          this.game.addCookies(reward);
          this.ui?.setMiniStatus(`Биржа: прибыль ${formatNumber(reward)} печенья.`);
        },
      },
      {
        id: "pantheon",
        name: "Пантеон",
        description: "Вызвать богов: +10% кликов и CPS на 20 сек.",
        requirement: () => this.game.getBuildingCount("temple") >= 3,
        cooldown: 45,
        activate: () => {
          this.game.addActiveEffect({
            id: "pantheon",
            name: "Божественное благословение",
            duration: 20,
            cpsMultiplier: 1.1,
            clickMultiplier: 1.1,
          });
          this.ui?.setMiniStatus("Пантеон активен: +10% на 20 сек.");
        },
      },
      {
        id: "time-warp",
        name: "Сдвиг времени",
        description: "Моментально добавляет 40 секунд автопроизводства",
        requirement: () => this.game.getBuildingCount("time") >= 1,
        cooldown: 30,
        activate: () => {
          const reward = this.game.getCps() * 40;
          this.game.addCookies(reward);
          this.ui?.setMiniStatus(`Сдвиг времени: +${formatNumber(reward)} печенья.`);
        },
      },
      {
        id: "dragon-play",
        name: "Игры с драконом",
        description: "Дракон активен дольше: +6 сек бонуса",
        requirement: () => this.game.dragonLevel >= 1,
        cooldown: 50,
        activate: () => {
          this.game.extendDragon(6);
          this.ui?.setMiniStatus("Дракон ликует: бонус продлен на 6 секунд.");
        },
      },
    ];
  }
}

class Game {
  constructor(audio, storage, cloudStorage) {
    this.audio = audio;
    this.storage = storage;
    this.cloudStorage = cloudStorage;

    this.cookies = 0;
    this.totalCookies = 0;
    this.totalClicks = 0;
    this.prestigeLevel = 0;
    this.prestigeBonus = 0;
    this.prestigeChips = 0;

    this.clickMultiplier = 1;
    this.clickFlat = 0;
    this.autoMultiplier = 1;
    this.globalMultiplier = 1;

    this.baseBuildingBonuses = {};
    this.synergyBonuses = {};

    this.upgrades = [];
    this.buildings = [];
    this.achievements = [];
    this.synergies = [];
    this.prestigeUpgrades = [];

    this.purchasedUpgrades = new Set();
    this.unlockedAchievements = new Set();
    this.purchasedPrestige = new Set();

    this.dragonLevel = 0;
    this.dragonBoost = 1;
    this.dragonCooldown = 0;
    this.dragonTimer = 0;
    this.dragonTimes = 0;

    this.activeClickBoost = { multiplier: 1, expires: 0 };
    this.activeEffects = [];

    this.mana = 100;
    this.maxMana = 100;
    this.spellCooldowns = {};

    this.currentSeason = null;
    this.seasonEnds = 0;
    this.seasonBonus = 1;

    this.storyLog = [];
    this.lastStoryEvent = performance.now();

    this.theme = "midnight";
    this.skin = "classic";

    this.lastAchievementCheck = performance.now();
    this.lastTick = performance.now();
    this.goldenSpawnMultiplier = 1;
    this.goldenCookieNext = performance.now() + this.randomGoldenDelay();
    this.buyMultiplier = 1;

    this.initData();
    this.load();
  }

  initData() {
    this.buildings = this.createBuildings();
    this.buildings.forEach((b) => {
      this.baseBuildingBonuses[b.id] = 1;
      this.synergyBonuses[b.id] = 1;
    });
    this.upgrades = this.generateUpgrades();
    this.achievements = this.generateAchievements();
    this.synergies = this.generateSynergies();
    this.prestigeUpgrades = this.generatePrestigeUpgrades();
    this.spells = this.generateSpells();
    this.seasons = this.generateSeasons();
  }

  createBuildings() {
    return [
      new Building({ id: "cursor", name: "Курсор", baseCost: 15, baseCps: 0.1, flavor: "Автокликеры с умной начинкой." }),
      new Building({ id: "grandma", name: "Бабушка", baseCost: 100, baseCps: 1, flavor: "Теплый дух домашней выпечки." }),
      new Building({ id: "farm", name: "Ферма", baseCost: 500, baseCps: 4, flavor: "Сахарные поля без края." }),
      new Building({ id: "factory", name: "Фабрика", baseCost: 3000, baseCps: 10, flavor: "Конвейеры будущего." }),
      new Building({ id: "mine", name: "Шахта", baseCost: 12000, baseCps: 40, flavor: "Добыча шоколадной руды." }),
      new Building({ id: "bank", name: "Банк", baseCost: 55000, baseCps: 120, flavor: "Финансовые деривативы из печенья." }),
      new Building({ id: "temple", name: "Храм", baseCost: 150000, baseCps: 360, flavor: "Ритуалы карамели." }),
      new Building({ id: "wizard", name: "Башня мага", baseCost: 350000, baseCps: 900, flavor: "Заклинания теста." }),
      new Building({ id: "shipment", name: "Грузчик", baseCost: 850000, baseCps: 2100, flavor: "Межзвездная доставка печенья." }),
      new Building({ id: "alchemy", name: "Алхимическая лаборатория", baseCost: 1800000, baseCps: 4500, flavor: "Золотые смеси." }),
      new Building({ id: "portal", name: "Портал", baseCost: 3500000, baseCps: 9000, flavor: "Печенье из других миров." }),
      new Building({ id: "time", name: "Машина времени", baseCost: 9000000, baseCps: 18000, flavor: "Печенье до первого укуса." }),
      new Building({ id: "antimatter", name: "Антиматерия", baseCost: 22000000, baseCps: 36000, flavor: "Анти-крошки." }),
      new Building({ id: "prism", name: "Призма", baseCost: 52000000, baseCps: 72000, flavor: "Спектр сладости." }),
      new Building({ id: "chancemaker", name: "Шансомёт", baseCost: 125000000, baseCps: 150000, flavor: "Удача в каждой крошке." }),
      new Building({ id: "fractal", name: "Фрактальный двигатель", baseCost: 300000000, baseCps: 300000, flavor: "Вечное повторение." }),
      new Building({ id: "console", name: "JS-консоль", baseCost: 700000000, baseCps: 620000, flavor: "Баги превращаются в печенье." }),
      new Building({ id: "idleverse", name: "Айдл-Вселенная", baseCost: 1600000000, baseCps: 1200000, flavor: "Симуляции сладости." }),
      new Building({ id: "cortex", name: "Кортикальный пекарь", baseCost: 3500000000, baseCps: 2400000, flavor: "Нейро-печенье." }),
      new Building({ id: "starforge", name: "Звездная кузня", baseCost: 7800000000, baseCps: 5200000, flavor: "Сверхновые печенья." }),
    ];
  }

  getBuildingCount(id) {
    const building = this.buildings.find((b) => b.id === id);
    return building ? building.count : 0;
  }

  generateUpgrades() {
    const upgrades = [];
    this.buildings.forEach((b) => {
      [1.2, 1.5, 2, 2.5].forEach((multiplier, index) => {
        upgrades.push(
          new Upgrade({
            id: `${b.id}-upgrade-${index + 1}`,
            name: `${b.name}: улучшение ${index + 1}`,
            description: `Увеличивает эффективность ${b.name} на ${(multiplier * 100 - 100).toFixed(0)}%.`,
            cost: Math.round(b.baseCost * Math.pow(12, index + 1)),
            kind: "building-mult",
            buildingId: b.id,
            multiplier,
          })
        );
      });
    });

    for (let i = 1; i <= 12; i++) {
      upgrades.push(
        new Upgrade({
          id: `click-up-${i}`,
          name: `Клик-мастер ${i}`,
          description: `Клик приносит больше: множитель +${(i * 10).toFixed(0)}% и +${i * 2} печ.`,
          cost: Math.round(80 * Math.pow(1.7, i)),
          kind: "click-mult",
          multiplier: 1 + i * 0.1,
          flat: i * 2,
        })
      );
    }

    for (let i = 1; i <= 10; i++) {
      upgrades.push(
        new Upgrade({
          id: `auto-up-${i}`,
          name: `Автоматизация ${i}`,
          description: `Автопроизводство увеличено на ${(15 + i * 6).toFixed(0)}%.`,
          cost: Math.round(800 * Math.pow(1.8, i)),
          kind: "auto-mult",
          multiplier: 1 + (15 + i * 6) / 100,
        })
      );
    }

    for (let i = 1; i <= 10; i++) {
      upgrades.push(
        new Upgrade({
          id: `global-up-${i}`,
          name: `Священный сахар ${i}`,
          description: `Все производство усиливается на ${(6 + i * 4).toFixed(0)}%.`,
          cost: Math.round(2500 * Math.pow(1.9, i)),
          kind: "global-mult",
          multiplier: 1 + (6 + i * 4) / 100,
        })
      );
    }

    return upgrades;
  }

  generateSynergies() {
    const buildingMap = Object.fromEntries(this.buildings.map((b) => [b.id, b.name]));
    const pairs = [
      ["cursor", "grandma"],
      ["grandma", "farm"],
      ["farm", "factory"],
      ["factory", "mine"],
      ["mine", "bank"],
      ["bank", "temple"],
      ["temple", "wizard"],
      ["wizard", "shipment"],
      ["shipment", "alchemy"],
      ["alchemy", "portal"],
      ["portal", "time"],
      ["time", "antimatter"],
      ["antimatter", "prism"],
      ["prism", "chancemaker"],
      ["chancemaker", "fractal"],
      ["fractal", "console"],
      ["console", "idleverse"],
      ["idleverse", "cortex"],
      ["cortex", "starforge"],
      ["grandma", "factory"],
      ["farm", "bank"],
      ["factory", "temple"],
      ["mine", "wizard"],
      ["bank", "shipment"],
      ["temple", "portal"],
      ["wizard", "time"],
      ["shipment", "prism"],
      ["alchemy", "chancemaker"],
      ["portal", "fractal"],
      ["time", "console"],
      ["antimatter", "idleverse"],
      ["prism", "cortex"],
      ["chancemaker", "starforge"],
      ["cursor", "wizard"],
      ["grandma", "alchemy"],
      ["farm", "time"],
    ];

    return pairs.map((pair, idx) => {
      const [a, b] = pair;
      const nameA = buildingMap[a] || a;
      const nameB = buildingMap[b] || b;
      return {
        id: `syn-${idx + 1}`,
        name: `Синергия ${idx + 1}`,
        description: `Когда есть 10 «${nameA}» и 10 «${nameB}», усилить «${nameB}» на 15%.`,
        requirement: { a, b, count: 10 },
        target: b,
        targetName: nameB,
        multiplier: 1.15,
        active: false,
      };
    });
  }

  generateAchievements() {
    const achievements = [
      new Achievement({
        id: "click-100",
        name: "100 кликов",
        description: "Кликните по печенью 100 раз.",
        reward: { type: "click", multiplier: 1.1 },
        condition: (game) => game.totalClicks >= 100,
      }),
      new Achievement({
        id: "click-1000",
        name: "1000 кликов",
        description: "Кликните по печенью 1000 раз.",
        reward: { type: "click", multiplier: 1.15 },
        condition: (game) => game.totalClicks >= 1000,
      }),
      new Achievement({
        id: "cookies-1m",
        name: "Миллион печений",
        description: "Произведите 1,000,000 печений.",
        reward: { type: "global", multiplier: 1.05 },
        condition: (game) => game.totalCookies >= 1_000_000,
      }),
      new Achievement({
        id: "cookies-100m",
        name: "100 миллионов",
        description: "Произведите 100,000,000 печений.",
        reward: { type: "global", multiplier: 1.08 },
        condition: (game) => game.totalCookies >= 100_000_000,
      }),
      new Achievement({
        id: "dragon-1",
        name: "Повелитель дракона",
        description: "Активируйте дракона хотя бы раз.",
        reward: { type: "cps", multiplier: 1.05 },
        condition: (game) => game.dragonTimes > 0,
      }),
      new Achievement({
        id: "prestige-1",
        name: "Реинкарнатор",
        description: "Совершите первую реинкарнацию.",
        reward: { type: "global", multiplier: 1.1 },
        condition: (game) => game.prestigeLevel > 0,
      }),
    ];

    const clickThresholds = Array.from({ length: 24 }, (_, i) => 250 * (i + 1));
    clickThresholds.forEach((th, idx) => {
      achievements.push(
        new Achievement({
          id: `click-${idx}`,
          name: `Кликовый фанат ${idx + 1}`,
          description: `Совершите ${th} кликов по печенью`,
          condition: (game) => game.totalClicks >= th,
        })
      );
    });

    const cookieThresholds = Array.from({ length: 30 }, (_, i) => Math.pow(1.8, i) * 5000);
    cookieThresholds.forEach((th, idx) => {
      achievements.push(
        new Achievement({
          id: `cookies-${idx}`,
          name: `Запасливый ${idx + 1}`,
          description: `Накопите ${formatNumber(th)} печенья`,
          condition: (game) => game.totalCookies >= th,
        })
      );
    });

    this.buildings.forEach((b) => {
      for (let i = 1; i <= 8; i++) {
        const need = i * 10;
        achievements.push(
          new Achievement({
            id: `${b.id}-ach-${i}`,
            name: `${b.name}: партия ${i}`,
            description: `Купите ${need} шт. здания ${b.name}`,
            condition: (game) => {
              const building = game.buildings.find((x) => x.id === b.id);
              return building && building.count >= need;
            },
          })
        );
      }
    });

    const upgradeThresholds = Array.from({ length: 20 }, (_, i) => (i + 1) * 4);
    upgradeThresholds.forEach((th, idx) => {
      achievements.push(
        new Achievement({
          id: `upgrade-${idx}`,
          name: `Инженер ${idx + 1}`,
          description: `Купите ${th} улучшений`,
          condition: (game) => game.purchasedUpgrades.size >= th,
        })
      );
    });

    return achievements;
  }

  generatePrestigeUpgrades() {
    return [
      { id: "heavenly-1", name: "Небесный сахар", cost: 5, description: "Постоянно +5% к CPS", effect: { type: "global", multiplier: 1.05 } },
      { id: "heavenly-2", name: "Серебряный клик", cost: 8, description: "+10% к кликам", effect: { type: "click", multiplier: 1.1 } },
      { id: "heavenly-3", name: "Сладкий поток", cost: 12, description: "+8% к автопроизводству", effect: { type: "cps", multiplier: 1.08 } },
      { id: "heavenly-4", name: "Звездная удача", cost: 20, description: "Золотые печенья появляются чаще", effect: { type: "golden", multiplier: 0.8 } },
    ];
  }

  generateSpells() {
    return [
      {
        id: "spark",
        name: "Искра сахара",
        cost: 20,
        cooldown: 12,
        description: "Усилить клики в 2 раза на 12 сек.",
        requirement: () => this.getBuildingCount("wizard") >= 1,
        cast: () => this.addActiveEffect({ id: "spark", name: "Искра сахара", duration: 12, clickMultiplier: 2 }),
      },
      {
        id: "arcane",
        name: "Арканическая синергия",
        cost: 35,
        cooldown: 25,
        description: "Синергии сильнее на 25% в течение 20 сек.",
        requirement: () => this.getBuildingCount("temple") >= 3,
        cast: () => this.addActiveEffect({ id: "arcane", name: "Арканическая синергия", duration: 20, synergyMultiplier: 1.25 }),
      },
      {
        id: "meteor",
        name: "Шоколадный метеор",
        cost: 40,
        cooldown: 30,
        description: "Мгновенно получить 45 секунд CPS.",
        requirement: () => this.totalCookies >= 50000,
        cast: () => this.addCookies(this.getCps() * 45),
      },
      {
        id: "chrono",
        name: "Хроно-клик",
        cost: 25,
        cooldown: 20,
        description: "+15% к CPS и кликам на 15 сек.",
        requirement: () => this.getBuildingCount("time") >= 1,
        cast: () => this.addActiveEffect({ id: "chrono", name: "Хроно-клик", duration: 15, cpsMultiplier: 1.15, clickMultiplier: 1.15 }),
      },
    ];
  }

  generateSeasons() {
    return [
      { id: "spring", name: "Весенний фестиваль", bonus: 1.06, goldenBoost: 1.1, theme: "spring" },
      { id: "summer", name: "Летний карнавал", bonus: 1.08, goldenBoost: 1.15, theme: "summer" },
      { id: "autumn", name: "Осенний урожай", bonus: 1.1, goldenBoost: 1.2, theme: "autumn" },
      { id: "winter", name: "Зимняя сказка", bonus: 1.12, goldenBoost: 1.25, theme: "winter" },
      { id: "halloween", name: "Хэллоуин", bonus: 1.09, goldenBoost: 1.3, theme: "halloween" },
      { id: "easter", name: "Пасхальный парад", bonus: 1.07, goldenBoost: 1.2, theme: "easter" },
    ];
  }

  addCookies(amount) {
    this.cookies += amount;
    this.totalCookies += amount;
  }

  clickCookie() {
    this.totalClicks += 1;
    this.audio?.playClick();
    const value = this.getClickValue();
    this.addCookies(value);
    this.checkAchievements();
    this.ui?.updateClickValue(value);
    this.ui?.spawnCookieChips();
    this.ui?.spawnFloatingText(`+${formatNumber(value)}`);
  }

  getClickValue() {
    const prestigeBonus = 1 + this.prestigeBonus;
    const effectBonus = this.getEffectMultiplier("click");
    const base =
      (1 + this.clickFlat) *
      this.clickMultiplier *
      prestigeBonus *
      this.globalMultiplier *
      this.dragonBoost *
      this.activeClickBoost.multiplier *
      effectBonus;
    return base;
  }

  getCps() {
    this.updateSynergies();
    let cps = 0;
    this.buildings.forEach((b) => {
      const baseBonus = this.baseBuildingBonuses[b.id] || 1;
      const synergyBonus = this.synergyBonuses[b.id] || 1;
      cps += b.baseCps * b.count * baseBonus * synergyBonus;
    });
    const prestigeBonus = 1 + this.prestigeBonus;
    cps *= this.autoMultiplier * prestigeBonus * this.globalMultiplier * this.dragonBoost * this.seasonBonus;
    cps *= this.getEffectMultiplier("cps");
    return cps;
  }

  getEffectMultiplier(type) {
    let multiplier = 1;
    this.activeEffects.forEach((effect) => {
      if (type === "cps" && effect.cpsMultiplier) multiplier *= effect.cpsMultiplier;
      if (type === "click" && effect.clickMultiplier) multiplier *= effect.clickMultiplier;
    });
    return multiplier;
  }

  buyBuilding(id) {
    const building = this.buildings.find((b) => b.id === id);
    if (!building) return false;
    const amount = this.buyMultiplier || 1;
    const cost = building.getBulkCost(amount);
    if (this.cookies < cost) return false;
    this.cookies -= cost;
    building.count += amount;
    this.checkAchievements();
    this.audio?.playPurchase();
    return true;
  }

  buyAllBuildings() {
    let bought = false;
    let purchasedThisLoop = true;
    while (purchasedThisLoop) {
      purchasedThisLoop = false;
      this.buildings.forEach((b) => {
        if (this.cookies >= b.getCost()) {
          this.cookies -= b.getCost();
          b.count += 1;
          purchasedThisLoop = true;
          bought = true;
        }
      });
    }
    if (bought) this.audio?.playPurchase();
    return bought;
  }

  buyUpgrade(id) {
    const upgrade = this.upgrades.find((u) => u.id === id);
    if (!upgrade || upgrade.purchased) return false;
    if (this.cookies < upgrade.cost) return false;
    this.cookies -= upgrade.cost;
    upgrade.purchased = true;
    this.purchasedUpgrades.add(upgrade.id);
    this.applyUpgrade(upgrade);
    this.checkAchievements();
    this.audio?.playUpgrade();
    this.ui?.renderUpgrades();
    return true;
  }

  buyPrestigeUpgrade(id) {
    const upgrade = this.prestigeUpgrades.find((u) => u.id === id);
    if (!upgrade || this.purchasedPrestige.has(id)) return false;
    if (this.prestigeChips < upgrade.cost) return false;
    this.prestigeChips -= upgrade.cost;
    this.purchasedPrestige.add(id);
    this.applyReward(upgrade.effect);
    this.ui?.renderPrestigeUpgrades();
    this.audio?.playUpgrade();
    return true;
  }

  applyUpgrade(upgrade) {
    switch (upgrade.kind) {
      case "building-mult":
        this.baseBuildingBonuses[upgrade.buildingId] =
          (this.baseBuildingBonuses[upgrade.buildingId] || 1) * (upgrade.multiplier || 1);
        break;
      case "click-mult":
        this.clickMultiplier *= upgrade.multiplier || 1;
        this.clickFlat += upgrade.flat || 0;
        break;
      case "auto-mult":
        this.autoMultiplier *= upgrade.multiplier || 1;
        break;
      case "global-mult":
        this.globalMultiplier *= upgrade.multiplier || 1;
        break;
      default:
        break;
    }
  }

  applyReward(reward) {
    if (!reward) return;
    if (reward.type === "click") this.clickMultiplier *= reward.multiplier || 1;
    if (reward.type === "global") this.globalMultiplier *= reward.multiplier || 1;
    if (reward.type === "cps") this.autoMultiplier *= reward.multiplier || 1;
    if (reward.type === "golden") this.goldenSpawnMultiplier = reward.multiplier || 1;
  }

  updateSynergies() {
    const synergyMultiplier = this.getActiveSynergyMultiplier();
    this.synergyBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));
    this.synergies.forEach((syn) => {
      const a = this.buildings.find((b) => b.id === syn.requirement.a);
      const b = this.buildings.find((b) => b.id === syn.requirement.b);
      syn.active = Boolean(a && b && a.count >= syn.requirement.count && b.count >= syn.requirement.count);
      if (syn.active) {
        const current = this.synergyBonuses[syn.target] || 1;
        this.synergyBonuses[syn.target] = current * syn.multiplier * synergyMultiplier;
      }
    });
  }

  getActiveSynergyMultiplier() {
    const effect = this.activeEffects.find((item) => item.synergyMultiplier);
    return effect ? effect.synergyMultiplier : 1;
  }

  addTemporaryClickBoost(multiplier, seconds) {
    const now = performance.now();
    this.activeClickBoost = {
      multiplier: this.activeClickBoost.multiplier * multiplier,
      expires: now + seconds * 1000,
    };
  }

  addActiveEffect(effect) {
    const now = performance.now();
    const newEffect = {
      ...effect,
      expires: now + (effect.duration || 0) * 1000,
    };
    this.activeEffects.push(newEffect);
    this.ui?.showNotification(`Активирован эффект: ${effect.name}`);
  }

  activateDragon() {
    const now = performance.now();
    if (this.dragonCooldown > now) return false;
    const duration = 18 + this.dragonLevel * 2;
    this.dragonCooldown = now + 45000;
    this.dragonTimer = now + duration * 1000;
    this.dragonBoost = 2.5 + this.dragonLevel * 0.3;
    this.dragonTimes += 1;
    this.audio?.playEvent();
    this.ui?.showNotification("Дракон пробудился!");
    return true;
  }

  extendDragon(extraSeconds) {
    if (this.dragonTimer > performance.now()) {
      this.dragonTimer += extraSeconds * 1000;
    }
  }

  feedDragon() {
    const cost = 5000 * Math.pow(2.2, this.dragonLevel);
    if (this.cookies < cost) return false;
    this.cookies -= cost;
    this.dragonLevel += 1;
    this.ui?.showNotification(`Дракон накормлен. Уровень ${this.dragonLevel}.`);
    return true;
  }

  castSpell(id) {
    const spell = this.spells.find((s) => s.id === id);
    if (!spell) return false;
    if (spell.requirement && !spell.requirement()) {
      this.ui?.showNotification("Заклинание пока недоступно.");
      return false;
    }
    const remaining = this.spellCooldowns[id] || 0;
    if (remaining > performance.now()) return false;
    if (this.mana < spell.cost) return false;
    this.mana -= spell.cost;
    spell.cast();
    this.spellCooldowns[id] = performance.now() + spell.cooldown * 1000;
    this.audio?.playSpell();
    this.ui?.renderSpells();
    return true;
  }

  triggerSeason(season) {
    this.currentSeason = season;
    this.seasonBonus = season.bonus;
    this.seasonEnds = performance.now() + 120000;
    this.ui?.applySeasonTheme(season.theme);
    this.audio?.playSeason();
    this.ui?.showNotification(`Сезон начался: ${season.name}`);
  }

  randomSeason() {
    const season = this.seasons[Math.floor(Math.random() * this.seasons.length)];
    this.triggerSeason(season);
  }

  randomGoldenDelay() {
    const base = 25000 + Math.random() * 25000;
    const boost = this.goldenSpawnMultiplier || 1;
    const seasonBoost = this.currentSeason?.goldenBoost || 1;
    return (base * boost) / seasonBoost;
  }

  grantGoldenCookie() {
    const effects = [
      { id: "frenzy", name: "Френзи", cpsMultiplier: 7, duration: 25 },
      { id: "click-frenzy", name: "Клик-френзи", clickMultiplier: 10, duration: 12 },
    ];
    const roll = Math.random();
    if (roll < 0.33) {
      const reward = this.getCps() * (20 + Math.random() * 30);
      this.addCookies(reward);
      this.ui?.showNotification(`Счастливчик! +${formatNumber(reward)} печенья.`);
      this.ui?.spawnFloatingText(`+${formatNumber(reward)}`);
      return;
    }
    const effect = effects[Math.floor(Math.random() * effects.length)];
    this.addActiveEffect(effect);
  }

  prestige() {
    const bonus = Math.floor(Math.sqrt(this.totalCookies) / 5000);
    if (bonus <= 0) return false;
    this.prestigeLevel += 1;
    this.prestigeBonus += bonus / 100;
    this.prestigeChips += bonus;

    this.cookies = 0;
    this.totalClicks = 0;
    this.buildings.forEach((b) => (b.count = 0));
    this.baseBuildingBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));
    this.synergyBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));

    this.clickMultiplier = 1;
    this.clickFlat = 0;
    this.autoMultiplier = 1;
    this.globalMultiplier = 1;
    this.dragonBoost = 1;
    this.activeClickBoost = { multiplier: 1, expires: 0 };
    this.activeEffects = [];

    this.upgrades.forEach((u) => (u.purchased = false));
    this.purchasedUpgrades.clear();
    this.unlockedAchievements.clear();
    this.achievements.forEach((a) => (a.unlocked = false));

    this.purchasedPrestige.forEach((id) => {
      const upgrade = this.prestigeUpgrades.find((u) => u.id === id);
      if (upgrade) this.applyReward(upgrade.effect);
    });

    this.save();
    this.ui?.showNotification("Реинкарнация завершена. Потенциал возрос!");
    return true;
  }

  checkAchievements() {
    this.achievements.forEach((ach) => {
      if (this.unlockedAchievements.has(ach.id)) return;
      if (ach.condition(this)) {
        this.unlockedAchievements.add(ach.id);
        ach.unlocked = true;
        this.applyReward(ach.reward);
        this.audio?.playAchievement();
        this.ui?.showNotification(`Достижение: ${ach.name}`);
      }
    });
  }

  addUI(ui) {
    this.ui = ui;
  }

  load() {
    const data = this.storage.load();
    if (!data) return;
    this.cookies = data.cookies || 0;
    this.totalCookies = data.totalCookies || 0;
    this.totalClicks = data.totalClicks || 0;
    this.prestigeLevel = data.prestigeLevel || 0;
    this.prestigeBonus = data.prestigeBonus || 0;
    this.prestigeChips = data.prestigeChips || 0;
    this.dragonLevel = data.dragonLevel || 0;
    this.dragonTimes = data.dragonTimes || 0;
    this.theme = data.theme || this.theme;
    this.skin = data.skin || this.skin;

    this.resetMultipliers();

    if (Array.isArray(data.buildings)) {
      data.buildings.forEach((save) => {
        const target = this.buildings.find((b) => b.id === save.id);
        if (target) target.count = save.count || 0;
      });
    }

    if (Array.isArray(data.upgrades)) {
      const purchasedIds = new Set(data.upgrades.filter((u) => u.purchased).map((u) => u.id));
      this.upgrades.forEach((u) => {
        u.purchased = purchasedIds.has(u.id);
        if (u.purchased) {
          this.purchasedUpgrades.add(u.id);
          this.applyUpgrade(u);
        }
      });
    }

    if (Array.isArray(data.achievements)) {
      data.achievements.forEach((id) => {
        this.unlockedAchievements.add(id);
        const ach = this.achievements.find((a) => a.id === id);
        if (ach) {
          ach.unlocked = true;
          this.applyReward(ach.reward);
        }
      });
    }

    if (Array.isArray(data.prestigeUpgrades)) {
      data.prestigeUpgrades.forEach((id) => {
        this.purchasedPrestige.add(id);
        const upgrade = this.prestigeUpgrades.find((u) => u.id === id);
        if (upgrade) this.applyReward(upgrade.effect);
      });
    }

    this.checkAchievements();
  }

  resetMultipliers() {
    this.clickMultiplier = 1;
    this.clickFlat = 0;
    this.autoMultiplier = 1;
    this.globalMultiplier = 1;
    this.baseBuildingBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));
    this.synergyBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));
  }

  save() {
    const state = {
      cookies: this.cookies,
      totalCookies: this.totalCookies,
      totalClicks: this.totalClicks,
      prestigeLevel: this.prestigeLevel,
      prestigeBonus: this.prestigeBonus,
      prestigeChips: this.prestigeChips,
      dragonLevel: this.dragonLevel,
      dragonTimes: this.dragonTimes || 0,
      buildings: this.buildings.map((b) => ({ id: b.id, count: b.count })),
      upgrades: this.upgrades.map((u) => ({ id: u.id, purchased: u.purchased })),
      achievements: Array.from(this.unlockedAchievements),
      prestigeUpgrades: Array.from(this.purchasedPrestige),
      theme: this.theme,
      skin: this.skin,
    };
    this.storage.save(state);
    if (this.ui) {
      this.ui.showSaveData(state);
    }
  }

  export() {
    const state = {
      cookies: this.cookies,
      totalCookies: this.totalCookies,
      totalClicks: this.totalClicks,
      prestigeLevel: this.prestigeLevel,
      prestigeBonus: this.prestigeBonus,
      prestigeChips: this.prestigeChips,
      dragonLevel: this.dragonLevel,
      dragonTimes: this.dragonTimes || 0,
      buildings: this.buildings.map((b) => ({ id: b.id, count: b.count })),
      upgrades: this.upgrades.map((u) => ({ id: u.id, purchased: u.purchased })),
      achievements: Array.from(this.unlockedAchievements),
      prestigeUpgrades: Array.from(this.purchasedPrestige),
      theme: this.theme,
      skin: this.skin,
    };
    return JSON.stringify(state);
  }

  import(data) {
    try {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      this.storage.save(parsed);
      window.location.reload();
    } catch (err) {
      console.error("Импорт не удался", err);
    }
  }

  loop() {
    const now = performance.now();
    const delta = (now - this.lastTick) / 1000;
    this.lastTick = now;

    const cps = this.getCps();
    this.addCookies(cps * delta);

    if (this.activeClickBoost.expires && now > this.activeClickBoost.expires) {
      this.activeClickBoost = { multiplier: 1, expires: 0 };
    }

    this.activeEffects = this.activeEffects.filter((effect) => now <= effect.expires);

    if (this.dragonTimer && now > this.dragonTimer) {
      this.dragonBoost = 1;
      this.dragonTimer = 0;
    }

    if (this.seasonEnds && now > this.seasonEnds) {
      this.currentSeason = null;
      this.seasonBonus = 1;
      this.ui?.applySeasonTheme(null);
    }

    if (this.mana < this.maxMana) {
      this.mana = Math.min(this.maxMana, this.mana + delta * 6);
    }

    if (now - this.lastAchievementCheck > 1000) {
      this.checkAchievements();
      this.lastAchievementCheck = now;
    }

    if (now > this.goldenCookieNext) {
      this.ui?.spawnGoldenCookie();
      this.goldenCookieNext = now + this.randomGoldenDelay();
    }

    if (now - this.lastStoryEvent > 90000) {
      this.triggerStoryEvent();
      this.lastStoryEvent = now;
    }

    if (!this.currentSeason && now % 240000 < 1000) {
      this.randomSeason();
    }

    if (this.ui) this.ui.render();
    requestAnimationFrame(() => this.loop());
  }

  triggerStoryEvent() {
    const events = [
      { name: "Охота за магическим печеньем", reward: () => this.addCookies(this.getCps() * 20) },
      { name: "Экспедиция за реликвиями", reward: () => this.addActiveEffect({ id: "relic", name: "Реликвии", duration: 20, cpsMultiplier: 1.12 }) },
      { name: "Тайный рецепт", reward: () => this.addTemporaryClickBoost(3, 12) },
    ];
    const event = events[Math.floor(Math.random() * events.length)];
    event.reward();
    this.storyLog.unshift(`${event.name}`);
    if (this.storyLog.length > 5) this.storyLog.pop();
    this.ui?.showNotification(`Сюжетное событие: ${event.name}`);
    this.audio?.playEvent();
  }
}

class UI {
  constructor(game, audio, storage, miniGames, cloudStorage) {
    this.game = game;
    this.audio = audio;
    this.storage = storage;
    this.cloudStorage = cloudStorage;
    this.miniGames = miniGames;
    this.buildingContainer = document.getElementById("buildings");
    this.upgradeContainer = document.getElementById("upgrades");
    this.synergyContainer = document.getElementById("synergies");
    this.achievementContainer = document.getElementById("achievements");
    this.achievementSearch = document.getElementById("achievement-search");
    this.achievementProgress = document.getElementById("achievement-progress");
    this.miniContainer = document.getElementById("mini-games");
    this.miniStatus = document.getElementById("mini-status");
    this.spellContainer = document.getElementById("spells");
    this.prestigeContainer = document.getElementById("prestige-shop");
    this.activeEffectsContainer = document.getElementById("active-effects");
    this.notificationContainer = document.getElementById("notifications");
    this.storyContainer = document.getElementById("story-log");
    this.goldenWrapper = document.getElementById("golden-layer");
    this.lastAchievementUpdate = 0;
    this.lastAchievementCount = 0;

    this.bindEvents();
    this.renderBuildings();
    this.renderUpgrades();
    this.renderSynergies();
    this.renderAchievements();
    this.renderMiniGames();
    this.renderSpells();
    this.renderPrestigeUpgrades();
    this.renderStory();
    this.lastAchievementCount = this.game.unlockedAchievements.size;
    this.lastAchievementUpdate = performance.now();
    this.applyTheme();
    this.applySkin();
    this.setBuyMode(this.game.buyMultiplier);
  }

  bindEvents() {
    document.getElementById("big-cookie").addEventListener("click", () => this.game.clickCookie());
    document.getElementById("save-btn").addEventListener("click", () => this.game.save());
    document.getElementById("export-btn").addEventListener("click", () => {
      const data = this.game.export();
      this.showSaveData(JSON.parse(data));
    });
    document.getElementById("import-btn").addEventListener("click", () => {
      const raw = document.getElementById("save-data").value;
      if (raw.trim()) this.game.import(raw.trim());
    });
    document.getElementById("reset-btn").addEventListener("click", () => {
      localStorage.removeItem(SAVE_KEY);
      window.location.reload();
    });
    document.getElementById("toggle-music").addEventListener("click", (e) => {
      const progress = Math.min(1, this.game.prestigeLevel / 10);
      const playing = this.audio.toggleMusic(progress);
      e.currentTarget.textContent = `Музыка: ${playing ? "вкл" : "выкл"}`;
    });
    document.getElementById("dragon-btn").addEventListener("click", () => {
      if (this.game.activateDragon()) {
        this.setDragonStatus("Дракон бодрствует и множит производство!");
      }
    });
    document.getElementById("dragon-feed").addEventListener("click", () => {
      if (this.game.feedDragon()) {
        this.setDragonStatus("Дракон доволен и стал сильнее!");
      }
    });
    document.getElementById("prestige-btn").addEventListener("click", () => {
      this.game.prestige();
    });
    document.getElementById("buy-all-btn").addEventListener("click", () => this.game.buyAllBuildings());
    document.getElementById("cloud-save-btn").addEventListener("click", () => {
      this.cloudStorage.save(JSON.parse(this.game.export()));
      this.showNotification("Прогресс сохранен в облаке.");
    });
    document.getElementById("cloud-load-btn").addEventListener("click", () => {
      const data = this.cloudStorage.load();
      if (data) {
        this.storage.save(data);
        window.location.reload();
      } else {
        this.showNotification("Облачное сохранение не найдено.");
      }
    });

    this.achievementSearch.addEventListener("input", () => this.renderAchievements());

    this.buildingContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-buy");
      if (id) {
        const success = this.game.buyBuilding(id);
        if (success) this.animatePurchase(e.target.closest(".card"));
      }
    });
    this.upgradeContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-up");
      if (id) {
        const success = this.game.buyUpgrade(id);
        if (success) this.animateUpgrade(e.target.closest(".card"));
      }
    });
    this.spellContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-spell");
      if (id) {
        this.game.castSpell(id);
      }
    });
    this.prestigeContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-prestige");
      if (id) {
        this.game.buyPrestigeUpgrade(id);
      }
    });
    this.miniContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-mini");
      if (!id) return;
      this.miniGames.activate(id);
    });

    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
    });

    document.querySelectorAll("[data-buy-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setBuyMode(Number(btn.dataset.buyMode || 1));
      });
    });

    document.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.game.theme = btn.dataset.theme;
        this.applyTheme();
      });
    });

    document.querySelectorAll("[data-skin]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.game.skin = btn.dataset.skin;
        this.applySkin();
      });
    });
  }

  setBuyMode(multiplier) {
    this.game.buyMultiplier = multiplier;
    document.querySelectorAll("[data-buy-mode]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.buyMode) === multiplier);
    });
    this.updateBuildingButtons();
  }

  render() {
    document.getElementById("cookie-count").textContent = formatNumber(this.game.cookies);
    document.getElementById("lifetime-cookies").textContent = formatNumber(this.game.totalCookies);
    document.getElementById("cps").textContent = this.game.getCps().toFixed(1);
    document.getElementById("prestige").textContent = `${(this.game.prestigeBonus * 100).toFixed(1)}%`;
    document.getElementById("achievement-count").textContent = `${this.game.unlockedAchievements.size} / ${this.game.achievements.length}`;
    document.getElementById("total-clicks").textContent = formatNumber(this.game.totalClicks);
    document.getElementById("chip-count").textContent = `${this.game.prestigeChips}`;
    document.getElementById("mana-count").textContent = `${Math.floor(this.game.mana)}/${this.game.maxMana}`;
    document.getElementById("dragon-level").textContent = `${this.game.dragonLevel}`;
    this.updateProgressVisuals();
    this.updateBuildingButtons();
    this.updateUpgradeButtons();
    this.updateSynergies();
    this.updateDragon();
    this.updateMiniButtons();
    this.renderActiveEffects();
    this.renderSpells();
    this.renderStory();

    const now = performance.now();
    if (
      now - this.lastAchievementUpdate > 1000 ||
      this.lastAchievementCount !== this.game.unlockedAchievements.size
    ) {
      this.renderAchievements();
      this.lastAchievementUpdate = now;
      this.lastAchievementCount = this.game.unlockedAchievements.size;
    }
  }

  renderBuildings() {
    this.buildingContainer.innerHTML = "";
    this.game.buildings.forEach((b) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div>
          <div class="title">${b.name}</div>
          <div class="desc">${b.flavor}</div>
          <div class="desc">Производит ${b.baseCps} печ./сек. Сейчас: ${b.count}</div>
          <div class="meta"><span data-cost-label="${b.id}">Стоимость (x${this.game.buyMultiplier})</span>: <span data-cost="${b.id}">${formatNumber(b.getCost())}</span></div>
        </div>
        <button data-buy="${b.id}">Купить</button>`;
      this.buildingContainer.appendChild(card);
    });
  }

  renderUpgrades() {
    this.upgradeContainer.innerHTML = "";
    const available = this.game.upgrades.filter((u) => !u.purchased).sort((a, b) => a.cost - b.cost).slice(0, 60);
    available.forEach((u) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div>
          <div class="title">${u.name}</div>
          <div class="desc">${u.description}</div>
          <div class="meta">Цена: ${formatNumber(u.cost)}</div>
        </div>
        <button data-up="${u.id}">Купить</button>`;
      this.upgradeContainer.appendChild(card);
    });
  }

  renderSynergies() {
    this.synergyContainer.innerHTML = "";
    this.game.synergies.forEach((syn) => {
      const card = document.createElement("div");
      card.className = "card synergy";
      card.innerHTML = `
        <div>
          <div class="title">${syn.name}</div>
          <div class="desc">${syn.description}</div>
          <div class="meta">Цель: ${syn.targetName || syn.target}</div>
        </div>
        <span class="pill">${syn.active ? "Активно" : "Нужно"}</span>`;
      this.synergyContainer.appendChild(card);
    });
  }

  updateSynergies() {
    this.synergyContainer.querySelectorAll(".pill").forEach((pill, idx) => {
      const syn = this.game.synergies[idx];
      if (!syn) return;
      pill.textContent = syn.active ? "Активно" : "Нужно";
      pill.classList.toggle("active", syn.active);
    });
  }

  updateBuildingButtons() {
    this.game.buildings.forEach((b) => {
      const costEl = this.buildingContainer.querySelector(`[data-cost="${b.id}"]`);
      const labelEl = this.buildingContainer.querySelector(`[data-cost-label="${b.id}"]`);
      const btn = this.buildingContainer.querySelector(`[data-buy="${b.id}"]`);
      const bulkCost = b.getBulkCost(this.game.buyMultiplier || 1);
      if (costEl) costEl.textContent = formatNumber(bulkCost);
      if (labelEl) labelEl.textContent = `Стоимость (x${this.game.buyMultiplier})`;
      if (btn) btn.disabled = this.game.cookies < bulkCost;
      const desc = btn?.previousElementSibling?.querySelectorAll(".desc")[1];
      if (desc) desc.textContent = `Производит ${b.baseCps} печ./сек. Сейчас: ${b.count}`;
    });
  }

  updateUpgradeButtons() {
    this.upgradeContainer.querySelectorAll("[data-up]").forEach((btn) => {
      const id = btn.getAttribute("data-up");
      const upgrade = this.game.upgrades.find((u) => u.id === id);
      if (upgrade) btn.disabled = this.game.cookies < upgrade.cost;
    });
  }

  renderAchievements() {
    this.achievementProgress.textContent = `${this.game.unlockedAchievements.size}/${this.game.achievements.length}`;
    const filter = (this.achievementSearch.value || "").toLowerCase();
    this.achievementContainer.innerHTML = "";
    this.game.achievements
      .filter((a) => a.name.toLowerCase().includes(filter) || a.description.toLowerCase().includes(filter))
      .forEach((ach) => {
        const card = document.createElement("div");
        card.className = "achievement" + (ach.unlocked ? "" : " locked");
        card.innerHTML = `
          <div class="name">${ach.name}</div>
          <div class="text">${ach.description}</div>
        `;
        this.achievementContainer.appendChild(card);
      });
  }

  renderMiniGames() {
    this.miniContainer.innerHTML = "";
    this.miniGames.games.forEach((game) => {
      const unlocked = game.requirement ? game.requirement() : true;
      const card = document.createElement("div");
      card.className = `card${unlocked ? "" : " locked"}`;
      card.innerHTML = `
        <div>
          <div class="title">${game.name}</div>
          <div class="desc">${game.description}</div>
          <div class="meta">${unlocked ? `КД: ${game.cooldown || 12} сек.` : "Требуется прогресс"}</div>
        </div>
        <button data-mini="${game.id}">Старт</button>`;
      const btn = card.querySelector("button");
      btn.disabled = !unlocked;
      this.miniContainer.appendChild(card);
    });
  }

  updateMiniButtons() {
    this.miniContainer.querySelectorAll("[data-mini]").forEach((btn) => {
      const id = btn.getAttribute("data-mini");
      const remaining = this.miniGames.getCooldownRemaining(id);
      const game = this.miniGames.games.find((item) => item.id === id);
      const unlocked = game?.requirement ? game.requirement() : true;
      btn.disabled = !unlocked || remaining > 0;
      const label = !unlocked ? "Закрыто" : remaining > 0 ? `${Math.ceil(remaining / 1000)}с` : "Старт";
      btn.textContent = label;
    });
  }

  renderSpells() {
    this.spellContainer.innerHTML = "";
    this.game.spells.forEach((spell) => {
      const remaining = this.game.spellCooldowns[spell.id] || 0;
      const cooldown = Math.max(0, remaining - performance.now());
      const unlocked = spell.requirement ? spell.requirement() : true;
      const card = document.createElement("div");
      card.className = `card${unlocked ? "" : " locked"}`;
      card.innerHTML = `
        <div>
          <div class="title">${spell.name}</div>
          <div class="desc">${spell.description}</div>
          <div class="meta">${unlocked ? `Манна: ${spell.cost} | КД: ${Math.ceil(cooldown / 1000)}с` : "Требуется разблокировка"}</div>
        </div>
        <button data-spell="${spell.id}">Колдовать</button>`;
      const btn = card.querySelector("button");
      btn.disabled = !unlocked || this.game.mana < spell.cost || cooldown > 0;
      this.spellContainer.appendChild(card);
    });
  }

  renderPrestigeUpgrades() {
    this.prestigeContainer.innerHTML = "";
    this.game.prestigeUpgrades.forEach((upgrade) => {
      const purchased = this.game.purchasedPrestige.has(upgrade.id);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div>
          <div class="title">${upgrade.name}</div>
          <div class="desc">${upgrade.description}</div>
          <div class="meta">Цена: ${upgrade.cost} чипов</div>
        </div>
        <button data-prestige="${upgrade.id}">${purchased ? "Куплено" : "Купить"}</button>`;
      const btn = card.querySelector("button");
      btn.disabled = purchased || this.game.prestigeChips < upgrade.cost;
      this.prestigeContainer.appendChild(card);
    });
  }

  renderActiveEffects() {
    this.activeEffectsContainer.innerHTML = "";
    if (this.game.activeEffects.length === 0 && this.game.currentSeason) {
      const seasonItem = document.createElement("div");
      seasonItem.className = "effect";
      seasonItem.textContent = `${this.game.currentSeason.name} (сезон)`;
      this.activeEffectsContainer.appendChild(seasonItem);
      return;
    }
    this.game.activeEffects.forEach((effect) => {
      const remaining = Math.max(0, Math.ceil((effect.expires - performance.now()) / 1000));
      const item = document.createElement("div");
      item.className = "effect";
      item.textContent = `${effect.name} · ${remaining}с`;
      this.activeEffectsContainer.appendChild(item);
    });
    if (this.game.currentSeason) {
      const seasonItem = document.createElement("div");
      seasonItem.className = "effect";
      seasonItem.textContent = `${this.game.currentSeason.name} (сезон)`;
      this.activeEffectsContainer.appendChild(seasonItem);
    }
  }

  renderStory() {
    this.storyContainer.innerHTML = "";
    this.game.storyLog.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "story-item";
      item.textContent = entry;
      this.storyContainer.appendChild(item);
    });
  }

  updateDragon() {
    const now = performance.now();
    const ready = this.game.dragonCooldown < now;
    const status = ready
      ? "Дракон отдыхает и готов к активации."
      : `Перезарядка: ${Math.ceil((this.game.dragonCooldown - now) / 1000)} сек.`;
    this.setDragonStatus(status);
  }

  setDragonStatus(text) {
    document.getElementById("dragon-status").textContent = text;
  }

  setMiniStatus(text) {
    this.miniStatus.textContent = text;
  }

  showSaveData(state) {
    document.getElementById("save-data").value = JSON.stringify(state);
  }

  updateClickValue(value) {
    document.getElementById("click-value").textContent = `+${value.toFixed(1)} за клик`;
  }

  showNotification(text) {
    const item = document.createElement("div");
    item.className = "notification";
    item.textContent = text;
    this.notificationContainer.appendChild(item);
    setTimeout(() => {
      item.classList.add("fade");
    }, 2600);
    setTimeout(() => item.remove(), 3200);
  }

  spawnFloatingText(text) {
    const item = document.createElement("div");
    item.className = "floating-text";
    item.textContent = text;
    item.style.left = `${40 + Math.random() * 20}%`;
    item.style.top = `${50 + Math.random() * 10}%`;
    document.body.appendChild(item);
    setTimeout(() => item.remove(), 1400);
  }

  spawnCookieChips() {
    const cookie = document.getElementById("big-cookie");
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.left = `${40 + Math.random() * 40}%`;
    chip.style.top = `${40 + Math.random() * 40}%`;
    cookie.appendChild(chip);
    setTimeout(() => chip.remove(), 900);
  }

  spawnGoldenCookie() {
    if (!this.goldenWrapper || this.goldenWrapper.querySelector(".golden-cookie")) return;
    const golden = document.createElement("button");
    golden.className = "golden-cookie";
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? -200 : edge === 1 ? window.innerWidth + 200 : Math.random() * window.innerWidth;
    const y = edge === 2 ? -200 : edge === 3 ? window.innerHeight + 200 : Math.random() * window.innerHeight;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    golden.style.setProperty("--from-x", `${x - centerX}px`);
    golden.style.setProperty("--from-y", `${y - centerY}px`);
    golden.addEventListener("click", () => {
      this.game.grantGoldenCookie();
      this.audio?.playGolden();
      this.spawnGoldenBurst(golden);
      golden.remove();
    });
    this.goldenWrapper.appendChild(golden);
    this.showNotification("Появилось золотое печенье!");
    setTimeout(() => golden.remove(), 12000);
  }

  spawnGoldenBurst(origin) {
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement("span");
      particle.className = "cookie-particle";
      particle.style.left = origin.offsetLeft + 40 + "px";
      particle.style.top = origin.offsetTop + 40 + "px";
      particle.style.setProperty("--dx", `${-40 + Math.random() * 80}px`);
      particle.style.setProperty("--dy", `${-40 + Math.random() * 80}px`);
      this.goldenWrapper.appendChild(particle);
      setTimeout(() => particle.remove(), 1000);
    }
  }

  animatePurchase(card) {
    if (!card) return;
    card.classList.add("pop");
    setTimeout(() => card.classList.remove("pop"), 400);
  }

  animateUpgrade(card) {
    if (!card) return;
    card.classList.add("glow");
    setTimeout(() => card.classList.remove("glow"), 600);
  }

  switchTab(tab) {
    document.querySelectorAll(".tab-button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === tab);
    });
  }

  updateProgressVisuals() {
    const total = this.game.totalCookies;
    let stage = "dawn";
    if (total >= 1e7) stage = "cosmic";
    else if (total >= 1e5) stage = "factory";
    else if (total >= 1e3) stage = "village";
    document.body.dataset.progress = stage;
  }

  applyTheme() {
    document.body.dataset.theme = this.game.theme;
  }

  applySkin() {
    document.getElementById("big-cookie").dataset.skin = this.game.skin;
  }

  applySeasonTheme(theme) {
    document.body.dataset.season = theme || "";
  }
}

const storage = new StorageManager(SAVE_KEY);
const cloudStorage = new StorageManager(CLOUD_KEY);
const audio = new AudioManager();
const game = new Game(audio, storage, cloudStorage);
const miniGames = new MiniGameManager(game);
const ui = new UI(game, audio, storage, miniGames, cloudStorage);
miniGames.setUI(ui);
ui.miniGames = miniGames;
game.addUI(ui);
game.loop();

setInterval(() => game.save(), AUTO_SAVE_INTERVAL);
