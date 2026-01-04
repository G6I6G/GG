const SAVE_KEY = "cookie-forge-save";
const AUTO_SAVE_INTERVAL = 10000;

const formatNumber = (value) => {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + " млрд";
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + " млн";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return value.toFixed(0);
};

class AudioManager {
  constructor() {
    this.ctx = null;
    this.musicPlaying = false;
    this.musicNodes = [];
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  playClick() {
    this.ensureContext();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = 240;
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  toggleMusic() {
    this.ensureContext();
    if (this.musicPlaying) {
      this.musicNodes.forEach((node) => node.stop());
      this.musicNodes = [];
      this.musicPlaying = false;
      return false;
    }

    const base = [196, 262, 330];
    base.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = index === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.03 / (index + 1), this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.02 / (index + 1), this.ctx.currentTime + 30);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      this.musicNodes.push(osc);
    });
    this.musicPlaying = true;
    return true;
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
  constructor({ id, name, baseCost, baseCps }) {
    this.id = id;
    this.name = name;
    this.baseCost = baseCost;
    this.baseCps = baseCps;
    this.count = 0;
  }

  getCost() {
    return Math.round(this.baseCost * Math.pow(1.15, this.count));
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
    this.games = this.buildGames();
  }

  buildGames() {
    return [
      {
        id: "burst",
        name: "Печенье-бурст",
        description: "10 секунд: клики дают в 5 раз больше печенья",
        activate: () => {
          this.game.addTemporaryClickBoost(5, 10);
          this.ui.setMiniStatus("Печенье-бурст активирован: x5 клики на 10 секунд.");
        },
      },
      {
        id: "lottery",
        name: "Лотерея печенья",
        description: "Выиграй от 1% до 10% текущего запаса печенья",
        activate: () => {
          const reward = this.game.cookies * (0.01 + Math.random() * 0.09);
          this.game.addCookies(reward);
          this.ui.setMiniStatus(`Лотерея: получено ${formatNumber(reward)} печенья.`);
        },
      },
      {
        id: "time-warp",
        name: "Сдвиг времени",
        description: "Моментально добавляет 30 секунд автопроизводства",
        activate: () => {
          const reward = this.game.getCps() * 30;
          this.game.addCookies(reward);
          this.ui.setMiniStatus(`Сдвиг времени: +${formatNumber(reward)} печенья.`);
        },
      },
    ];
  }
}

class Game {
  constructor(audio, storage) {
    this.audio = audio;
    this.storage = storage;

    this.cookies = 0;
    this.totalCookies = 0;
    this.totalClicks = 0;
    this.prestigeLevel = 0;
    this.prestigeBonus = 0;

    this.clickMultiplier = 1;
    this.clickFlat = 0;
    this.autoMultiplier = 1;
    this.globalMultiplier = 1;
    this.dragonBoost = 1;
    this.dragonTimes = 0;
    this.buildingBonuses = {};

    this.upgrades = [];
    this.buildings = [];
    this.achievements = [];
    this.purchasedUpgrades = new Set();
    this.unlockedAchievements = new Set();

    this.dragonCooldown = 0;
    this.dragonTimer = 0;
    this.activeClickBoost = { multiplier: 1, expires: 0 };
    this.lastAchievementCheck = performance.now();

    this.lastTick = performance.now();

    this.initData();
    this.load();
  }

  initData() {
    this.buildings = this.createBuildings();
    this.buildings.forEach((b) => {
      this.buildingBonuses[b.id] = 1;
    });
    this.upgrades = this.generateUpgrades();
    this.achievements = this.generateAchievements();
  }

  createBuildings() {
    return [
      new Building({ id: "cursor", name: "Курсор", baseCost: 15, baseCps: 0.1 }),
      new Building({ id: "grandma", name: "Бабушка", baseCost: 100, baseCps: 1 }),
      new Building({ id: "farm", name: "Ферма", baseCost: 500, baseCps: 4 }),
      new Building({ id: "factory", name: "Фабрика", baseCost: 3000, baseCps: 10 }),
      new Building({ id: "mine", name: "Шахта", baseCost: 12000, baseCps: 40 }),
      new Building({ id: "portal", name: "Портал", baseCost: 250000, baseCps: 400 }),
      new Building({ id: "time", name: "Временная лаборатория", baseCost: 1200000, baseCps: 2000 }),
      new Building({ id: "quantum", name: "Квантовый реактор", baseCost: 6000000, baseCps: 9000 }),
    ];
  }

  generateUpgrades() {
    const upgrades = [];

    // Building multipliers
    this.buildings.forEach((b) => {
      for (let tier = 1; tier <= 80; tier++) {
        const multiplier = 1 + (6 + tier) / 100;
        upgrades.push(
          new Upgrade({
            id: `${b.id}-upgrade-${tier}`,
            name: `${b.name}: усилитель ${tier}`,
            description: `Увеличивает производство ${b.name} на ${(multiplier * 100 - 100).toFixed(0)}%.`,
            cost: Math.round(b.baseCost * Math.pow(1.32, tier) * 6),
            kind: "building-mult",
            buildingId: b.id,
            multiplier,
          })
        );
      }
    });

    // Click upgrades
    for (let i = 1; i <= 40; i++) {
      upgrades.push(
        new Upgrade({
          id: `click-up-${i}`,
          name: `Клик-мастер ${i}`,
          description: `Клик приносит больше: множитель +${(i * 8).toFixed(0)}% и +${i} печенья за клик.`,
          cost: Math.round(60 * Math.pow(1.5, i)),
          kind: "click-mult",
          multiplier: 1 + i * 0.08,
          flat: i,
        })
      );
    }

    // Auto production upgrades
    for (let i = 1; i <= 25; i++) {
      upgrades.push(
        new Upgrade({
          id: `auto-up-${i}`,
          name: `Автоматизация ${i}`,
          description: `Автопроизводство увеличено на ${(20 + i * 5).toFixed(0)}%.`,
          cost: Math.round(500 * Math.pow(1.6, i)),
          kind: "auto-mult",
          multiplier: 1 + (20 + i * 5) / 100,
        })
      );
    }

    // Global production upgrades
    for (let i = 1; i <= 20; i++) {
      upgrades.push(
        new Upgrade({
          id: `global-up-${i}`,
          name: `Священный сахар ${i}`,
          description: `Все производство усиливается на ${(5 + i * 3).toFixed(0)}%.`,
          cost: Math.round(2500 * Math.pow(1.7, i)),
          kind: "global-mult",
          multiplier: 1 + (5 + i * 3) / 100,
        })
      );
    }

    return upgrades;
  }

  generateAchievements() {
    const achievements = [];

    const clickThresholds = Array.from({ length: 120 }, (_, i) => 50 + i * 250);
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

    const cookieThresholds = Array.from({ length: 120 }, (_, i) => Math.pow(1.25, i) * 500);
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
      for (let i = 1; i <= 20; i++) {
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

    const upgradeThresholds = Array.from({ length: 80 }, (_, i) => (i + 1) * 5);
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

    achievements.push(
      new Achievement({
        id: "dragon-1",
        name: "Повелитель дракона",
        description: "Активируйте дракона",
        condition: (game) => game.dragonTimes > 0,
      })
    );

    achievements.push(
      new Achievement({
        id: "prestige-1",
        name: "Реинкарнатор",
        description: "Совершите первую реинкарнацию",
        condition: (game) => game.prestigeLevel > 0,
      })
    );

    while (achievements.length < 520) {
      const idx = achievements.length + 1;
      achievements.push(
        new Achievement({
          id: `meta-${idx}`,
          name: `Коллекционер ${idx}`,
          description: `Просто продолжайте копить печенье!`,
          condition: (game) => game.totalCookies >= 1000 * idx,
        })
      );
    }

    return achievements;
  }

  addCookies(amount) {
    this.cookies += amount;
    this.totalCookies += amount;
  }

  clickCookie() {
    this.totalClicks += 1;
    if (this.audio) this.audio.playClick();
    const value = this.getClickValue();
    this.addCookies(value);
    this.checkAchievements();
    this.ui && this.ui.updateClickValue(value);
  }

  getClickValue() {
    const prestigeBonus = 1 + this.prestigeBonus;
    const base = (1 + this.clickFlat) * this.clickMultiplier * prestigeBonus * this.globalMultiplier * this.dragonBoost * this.activeClickBoost.multiplier;
    return base;
  }

  getCps() {
    let cps = 0;
    this.buildings.forEach((b) => {
      const bonus = this.buildingBonuses[b.id] || 1;
      cps += b.baseCps * b.count * bonus;
    });
    const prestigeBonus = 1 + this.prestigeBonus;
    cps *= this.autoMultiplier * prestigeBonus * this.globalMultiplier * this.dragonBoost;
    return cps;
  }

  buyBuilding(id) {
    const building = this.buildings.find((b) => b.id === id);
    if (!building) return;
    const cost = building.getCost();
    if (this.cookies < cost) return;
    this.cookies -= cost;
    building.count += 1;
    this.checkAchievements();
  }

  buyUpgrade(id) {
    const upgrade = this.upgrades.find((u) => u.id === id);
    if (!upgrade || upgrade.purchased) return;
    if (this.cookies < upgrade.cost) return;
    this.cookies -= upgrade.cost;
    upgrade.purchased = true;
    this.purchasedUpgrades.add(upgrade.id);
    this.applyUpgrade(upgrade);
    this.checkAchievements();
    this.ui?.renderUpgrades();
  }

  applyUpgrade(upgrade) {
    switch (upgrade.kind) {
      case "building-mult":
        this.buildingBonuses[upgrade.buildingId] =
          (this.buildingBonuses[upgrade.buildingId] || 1) * (upgrade.multiplier || 1);
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

  addTemporaryClickBoost(multiplier, seconds) {
    const now = performance.now();
    this.activeClickBoost = {
      multiplier: this.activeClickBoost.multiplier * multiplier,
      expires: now + seconds * 1000,
    };
  }

  activateDragon() {
    const now = performance.now();
    if (this.dragonCooldown > now) return false;
    this.dragonCooldown = now + 40000;
    this.dragonTimer = now + 20000;
    this.dragonBoost = 3;
    this.dragonTimes = (this.dragonTimes || 0) + 1;
    setTimeout(() => {
      this.dragonBoost = 1;
    }, 20000);
    return true;
  }

  prestige() {
    const bonus = Math.floor(Math.sqrt(this.totalCookies) / 1000);
    if (bonus <= 0) return false;
    this.prestigeLevel += 1;
    this.prestigeBonus += bonus / 100;

    // reset run
    this.cookies = 0;
    this.totalClicks = 0;
    this.buildings.forEach((b) => (b.count = 0));
    this.buildingBonuses = Object.fromEntries(this.buildings.map((b) => [b.id, 1]));

    this.clickMultiplier = 1;
    this.clickFlat = 0;
    this.autoMultiplier = 1;
    this.globalMultiplier = 1;
    this.dragonBoost = 1;
    this.activeClickBoost = { multiplier: 1, expires: 0 };

    this.upgrades.forEach((u) => (u.purchased = false));
    this.purchasedUpgrades.clear();
    this.save();
    return true;
  }

  checkAchievements() {
    this.achievements.forEach((ach) => {
      if (this.unlockedAchievements.has(ach.id)) return;
      if (ach.condition(this)) {
        this.unlockedAchievements.add(ach.id);
        ach.unlocked = true;
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
    this.clickMultiplier = data.clickMultiplier || 1;
    this.clickFlat = data.clickFlat || 0;
    this.autoMultiplier = data.autoMultiplier || 1;
    this.globalMultiplier = data.globalMultiplier || 1;
    this.dragonBoost = data.dragonBoost || 1;
    this.buildingBonuses = data.buildingBonuses || this.buildingBonuses;
    this.dragonTimes = data.dragonTimes || 0;

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
        if (ach) ach.unlocked = true;
      });
    }

    this.checkAchievements();
  }

  save() {
    const state = {
      cookies: this.cookies,
      totalCookies: this.totalCookies,
      totalClicks: this.totalClicks,
      prestigeLevel: this.prestigeLevel,
      prestigeBonus: this.prestigeBonus,
      clickMultiplier: this.clickMultiplier,
      clickFlat: this.clickFlat,
      autoMultiplier: this.autoMultiplier,
      globalMultiplier: this.globalMultiplier,
      dragonBoost: this.dragonBoost,
      buildingBonuses: this.buildingBonuses,
      dragonTimes: this.dragonTimes || 0,
      buildings: this.buildings.map((b) => ({ id: b.id, count: b.count })),
      upgrades: this.upgrades.map((u) => ({ id: u.id, purchased: u.purchased })),
      achievements: Array.from(this.unlockedAchievements),
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
      clickMultiplier: this.clickMultiplier,
      clickFlat: this.clickFlat,
      autoMultiplier: this.autoMultiplier,
      globalMultiplier: this.globalMultiplier,
      dragonBoost: this.dragonBoost,
      buildingBonuses: this.buildingBonuses,
      dragonTimes: this.dragonTimes || 0,
      buildings: this.buildings.map((b) => ({ id: b.id, count: b.count })),
      upgrades: this.upgrades.map((u) => ({ id: u.id, purchased: u.purchased })),
      achievements: Array.from(this.unlockedAchievements),
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

    if (now - this.lastAchievementCheck > 1000) {
      this.checkAchievements();
      this.lastAchievementCheck = now;
    }

    if (this.ui) this.ui.render();
    requestAnimationFrame(() => this.loop());
  }
}

class UI {
  constructor(game, audio, storage) {
    this.game = game;
    this.audio = audio;
    this.storage = storage;
    this.buildingContainer = document.getElementById("buildings");
    this.upgradeContainer = document.getElementById("upgrades");
    this.achievementContainer = document.getElementById("achievements");
    this.achievementSearch = document.getElementById("achievement-search");
    this.achievementProgress = document.getElementById("achievement-progress");
    this.miniContainer = document.getElementById("mini-games");
    this.miniStatus = document.getElementById("mini-status");
    this.lastAchievementUpdate = 0;
    this.lastAchievementCount = 0;

    this.bindEvents();
    this.renderBuildings();
    this.renderUpgrades();
    this.renderAchievements();
    this.renderMiniGames();
    this.lastAchievementCount = this.game.unlockedAchievements.size;
    this.lastAchievementUpdate = performance.now();
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
    document.getElementById("toggle-music").addEventListener("click", (e) => {
      const playing = this.audio.toggleMusic();
      e.currentTarget.textContent = `Музыка: ${playing ? "вкл" : "выкл"}`;
    });
    document.getElementById("dragon-btn").addEventListener("click", () => {
      if (this.game.activateDragon()) {
        this.setDragonStatus("Дракон бодрствует и множит производство x3 на 20 сек!");
      }
    });
    document.getElementById("prestige-btn").addEventListener("click", () => {
      if (this.game.prestige()) {
        this.setDragonStatus("Реинкарнация завершена. Постоянный бонус усилен!");
      }
    });
    this.achievementSearch.addEventListener("input", () => this.renderAchievements());
    this.buildingContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-buy");
      if (id) this.game.buyBuilding(id);
    });
    this.upgradeContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-up");
      if (id) this.game.buyUpgrade(id);
    });
    this.miniContainer.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-mini");
      if (!id) return;
      const mini = this.game.miniGames.games.find((m) => m.id === id);
      if (mini) mini.activate();
    });
  }

  render() {
    document.getElementById("cookie-count").textContent = formatNumber(this.game.cookies);
    document.getElementById("cps").textContent = this.game.getCps().toFixed(1);
    document.getElementById("prestige").textContent = `${(this.game.prestigeBonus * 100).toFixed(1)}%`;
    document.getElementById("achievement-count").textContent = `${this.game.unlockedAchievements.size} / ${this.game.achievements.length}`;
    this.updateBuildingButtons();
    this.updateUpgradeButtons();
    this.updateDragon();
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
          <div class="desc">Производит ${b.baseCps} печ./сек. Сейчас: ${b.count}</div>
          <div class="meta">Стоимость: <span data-cost="${b.id}">${formatNumber(b.getCost())}</span></div>
        </div>
        <button data-buy="${b.id}">Купить</button>`;
      this.buildingContainer.appendChild(card);
    });
  }

  renderUpgrades() {
    this.upgradeContainer.innerHTML = "";
    const available = this.game.upgrades.filter((u) => !u.purchased).sort((a, b) => a.cost - b.cost).slice(0, 50);
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

  updateBuildingButtons() {
    this.game.buildings.forEach((b) => {
      const costEl = this.buildingContainer.querySelector(`[data-cost="${b.id}"]`);
      const btn = this.buildingContainer.querySelector(`[data-buy="${b.id}"]`);
      if (costEl) costEl.textContent = formatNumber(b.getCost());
      if (btn) btn.disabled = this.game.cookies < b.getCost();
      const desc = btn?.previousElementSibling?.querySelector(".desc");
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

  updateDragon() {
    const now = performance.now();
    const ready = this.game.dragonCooldown < now;
    const status = ready
      ? "Дракон отдыхает и готов к активации."
      : `Перезарядка: ${Math.ceil((this.game.dragonCooldown - now) / 1000)} сек.`;
    this.setDragonStatus(status);
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
    this.game.miniGames.games.forEach((game) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div>
          <div class="title">${game.name}</div>
        <div class="desc">${game.description}</div>
        </div>
        <button data-mini="${game.id}">Старт</button>`;
      this.miniContainer.appendChild(card);
    });
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
}

const storage = new StorageManager(SAVE_KEY);
const audio = new AudioManager();
const game = new Game(audio, storage);
game.miniGames = new MiniGameManager(game, {
  setMiniStatus: () => {},
});
const ui = new UI(game, audio, storage);
game.addUI(ui);
game.miniGames.ui = ui;
game.loop();

setInterval(() => game.save(), AUTO_SAVE_INTERVAL);
