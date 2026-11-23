// Main game class
import { TerrainSystem } from './components/terrain.js';
import { ExplorationSystem } from './components/exploration.js';
import { UISystem } from './components/ui.js';
import { AnimalSystem } from './components/animals.js';
import { CombatSystem } from './components/combat.js';
import { PlayerSystem } from './components/player.js';
import { InventorySystem } from './components/inventory.js';
import { SurvivalSystem } from './components/survival.js';
import { BuildingSystem } from './components/building.js';
import { SaveSystem } from './components/save.js';
import { WeatherSystem } from './components/weather.js';
import { TouchControls } from './components/touch.js';
import { SkySystem } from './components/sky.js';
import { AudioSystem } from './components/audio.js';
import { EffectsSystem } from './components/effects.js';
import { ProgressionSystem } from './components/progression.js';
import { DungeonSystem } from './components/dungeon.js';
import { GearSystem } from './components/equipment.js';
import { ViewSystem } from './components/view.js';
import { BuffSystem } from './components/buffs.js';
import { PerkSystem } from './components/perks.js';
import { RegionSystem } from './components/regions.js';
import { ArcherySystem } from './components/archery.js';
import { LegendSystem } from './components/legends.js';
import { PoiSystem } from './components/pois.js';
import { SeasonSystem } from './components/seasons.js';
import { BountySystem } from './components/bounties.js';
import { RaidSystem } from './components/raids.js';
import { FishingSystem, GardenSystem } from './components/homestead.js';
import { CompanionSystem } from './components/companion.js';
import { QualitySystem } from './components/quality.js';
import { StorageSystem } from './components/storage.js';
import { loadSettings, saveSettings } from './settings.js';

export class SurvivalGame {
    constructor() {
        // Core engine properties
        this.engine = null;
        this.scene = null;
        this.camera = null;

        // Game systems
        this.terrainSystem = null;
        this.uiSystem = null;
        this.animalSystem = null;
        this.combatSystem = null;
        this.playerSystem = null;
        this.inventorySystem = null;
        this.survivalSystem = null;
        this.buildSystem = null;
        this.saveSystem = null;
        this.weatherSystem = null;
        this.touchControls = null;
        this.explorationSystem = null;
        this.skySystem = null;
        this.audio = null;
        this.effects = null;
        this.progression = null;
        this.dungeonSystem = null;
        this.gear = null;
        this.viewSystem = null;
        this.settings = loadSettings();

        // Day/night cycle properties
        this.paused = true;
        this.dayCount = 1;
        this.dayTime = 60; // 0 to 300 (5 min cycle)
        this.dayLength = 300; // seconds
        this.sunLight = null;
        this.ambientLight = null;

        // Input state
        this.primaryHeld = false;
        this.pointerLockRefusals = 0;
        this.ambienceTimer = 0;

        // Initialize the game
        this.init();
    }

    init() {
        try {
            // Get the canvas element
            const canvas = document.getElementById("renderCanvas");

            // Generate the BABYLON 3D engine
            // No full-screen antialiasing on phones: it is the most expensive
            // thing a mobile GPU can be asked for, and the resolution is high anyway.
            const touch = window.matchMedia('(pointer: coarse)').matches;
            this.engine = new BABYLON.Engine(canvas, !touch, {powerPreference: 'high-performance', stencil: false});

            // Create the scene
            this.scene = new BABYLON.Scene(this.engine);
            // Nothing here listens for what is under the pointer, so the engine
            // need not go looking on every mouse move and tap.
            this.scene.skipPointerMovePicking = true;
            this.scene.skipPointerDownPicking = true;
            this.scene.skipPointerUpPicking = true;
            this.scene.autoClear = true;
            this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
            this.scene.fogDensity = 0.007;
            this.scene.clearColor = new BABYLON.Color3(0.5, 0.8, 1.0); // Sky blue background

            // Movement and terrain collision use FreeCamera/manual physics; no Cannon world needed.

            // Create lighting
            this.setupLighting();
            // Resolution, shadows and ground cover follow the graphics setting.
            this.quality = new QualitySystem(this);

            // Sound is synthesised on the fly and stays silent until the first click.
            this.audio = new AudioSystem(this, this.settings);
            this.progression = new ProgressionSystem(this);

            // Initialize systems in the correct order
            // Create exploration before terrain so procedural paths and clearings
            // influence vegetation even for the initial 3x3 chunks.
            this.explorationSystem = new ExplorationSystem(this);
            // Points of interest keep their doorsteps clear too, so they come first as well.
            this.pois = new PoiSystem(this);
            this.bounties = new BountySystem(this);
            this.raids = new RaidSystem(this);
            // The calendar comes before the terrain, which is coloured by it.
            this.seasons = new SeasonSystem(this);

            // Inventory is needed by terrain for gatherable resources.
            this.inventorySystem = new InventorySystem(this);

            // Create terrain system next as it's needed by player for height calculations
            this.terrainSystem = new TerrainSystem(this);
            this.explorationSystem.attachWorld(this.terrainSystem);

            // Create player system
            this.playerSystem = new PlayerSystem(this);
            this.applySettings();

            // Create combat system
            this.combatSystem = new CombatSystem(this);

            // Create animal system which depends on combat
            this.animalSystem = new AnimalSystem(this);

            // Resource needs and craftable structures depend on player and terrain.
            this.buildSystem = new BuildingSystem(this);
            this.weatherSystem = new WeatherSystem(this);
            this.survivalSystem = new SurvivalSystem(this);
            this.saveSystem = new SaveSystem(this);
            // Found equipment, and the dungeons it is found in.
            this.gear = new GearSystem(this);
            this.buffs = new BuffSystem(this);
            this.perks = new PerkSystem(this);
            this.regions = new RegionSystem(this);
            this.legends = new LegendSystem(this);
            this.fishing = new FishingSystem(this);
            this.gardens = new GardenSystem(this);
            this.companion = new CompanionSystem(this);
            this.storage = new StorageSystem(this);
            this.dungeonSystem = new DungeonSystem(this);

            // UI is created before restoring state so it can refresh all meters.
            this.uiSystem = new UISystem(this);
            // Cosmetic feedback needs the HUD overlay layers and the camera.
            this.effects = new EffectsSystem(this);
            // First-person, third-person and overhead cameras, and the avatar.
            this.viewSystem = new ViewSystem(this);
            this.archery = new ArcherySystem(this);
            this.skySystem = new SkySystem(this);
            this.saveSystem.load();
            this.progression.check();
            this.effects.refreshHeld();
            this.dungeonSystem.scanEntrances();
            this.skySystem.update(0);

            // Update UI once all systems are initialized
            if (this.uiSystem) {
                this.uiSystem.updateInventoryUI();
            }

            // Add keyboard controls
            this.setupControls();
            this.touchControls = new TouchControls(this);
            this.uiSystem.renderPanel(); // Now that the input method is known.

            // Game loop
            this.setupGameLoop();

            // Watch for browser/canvas resize events
            window.addEventListener("resize", () => {
                this.engine.resize();
            });
            // Local persistence never depends on network availability.
            window.addEventListener("pagehide", () => this.saveSystem.save());
        } catch (e) {
            console.error("Error initializing game:", e);
            throw e;
        }
    }

    setupLighting() {
        // One directional light is the sun by day and the moon by night.
        this.sunLight = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(0, -1, 0), this.scene);
        this.sunLight.intensity = 1.0;
        this.sunLight.shadowMinZ = 1;
        this.sunLight.shadowMaxZ = 180;
        this.sunLight.shadowFrustumSize = 85;
        this.shadowGenerator = new BABYLON.ShadowGenerator(512, this.sunLight);
        this.shadowGenerator.usePercentageCloserFiltering = true;
        this.shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_LOW;
        this.shadowGenerator.bias = 0.001;
        this.shadowGenerator.normalBias = 0.03;
        this.shadowGenerator.darkness = 0.3;
        this.sunLight.diffuse = new BABYLON.Color3(1, 1, 0.8);

        // Sky light; the SkySystem tints it through the day.
        this.ambientLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.2;
        this.ambientLight.specular = BABYLON.Color3.Black();
    }

    registerModelShadow(mesh) {
        this.shadowGenerator.addShadowCaster(mesh, true);
        mesh.onDisposeObservable.add(() => this.shadowGenerator.removeShadowCaster(mesh, true));
    }

    // What the player is aiming at. Outside first person there is no eye-level
    // reticle, so the view decides (screen centre, or whatever is in front).
    pickTarget(range = 5) {
        if (this.viewSystem && !this.viewSystem.firstPerson) return this.viewSystem.pick(range);
        return this.scene.pickWithRay(this.playerSystem.camera.getForwardRay(range));
    }

    applySettings() {
        const camera = this.playerSystem?.camera;
        if (camera) camera.angularSensibility = 2200 / this.settings.sensitivity;
        this.audio?.setVolume(this.settings.volume);
        this.audio?.setMuted(this.settings.muted);
    }

    updateSettings(changes) {
        Object.assign(this.settings, changes);
        this.applySettings();
        saveSettings(this.settings);
    }

    setPaused(value) {
        this.paused = value;
        this.primaryHeld = false;
        this.archery?.cancel();
        const camera = this.playerSystem.camera;
        this.playerSystem.keys.jump = false;
        this.playerSystem.keys.descend = false;
        this.playerSystem.keys.sprint = false;
        camera.cameraDirection.setAll(0);
        camera.cameraRotation.setAll(0);
        this.touchControls?.setPaused(value);
        if (value) {
            camera.detachControl();
            document.exitPointerLock?.();
        } else {
            camera.attachControl(this.engine.getRenderingCanvas(), true);
            this.audio?.unlock();
        }
    }

    // Left click / HIT: confirm a build, swing at what is targeted, or attack.
    // `fresh` is true for the press itself and false for held-button repeats.
    primaryAction(fresh = true) {
        if (this.paused || this.playerSystem.isDead) return;
        if (this.buildSystem.placing) {
            if (fresh) this.buildSystem.confirmPlacement();
            return;
        }
        // A held button only needs to look again once the last swing has recovered.
        if (!fresh && (this.inventorySystem.swinging() || this.combatSystem.isAttacking)) return;
        // A line in the water takes the click: strike, or reel in.
        if (this.fishing.busy()) { if (fresh) this.fishing.act(); return; }
        if (this.inventorySystem.findTarget()) this.inventorySystem.tryHarvest();
        // At a shore with a rod and nothing to fight, the click casts.
        else if (fresh && !this.combatSystem.targeted() && this.fishing.act()) return;
        else this.combatSystem.tryAttack();
    }

    secondaryAction() {
        if (this.paused) return;
        if (this.buildSystem.cancelPlacement()) {
            this.uiSystem.showNotification('Building cancelled');
            return;
        }
        this.combatSystem.specialAttack();
    }

    // Sunrise, reached by waiting it out or by sleeping. Nights survived,
    // regrowth and the wolves' retreat all hang off this moment.
    advanceToDawn(message) {
        this.dayTime = 8;
        this.dayCount++;
        this.onNewDay(message, true);
    }

    onNewDay(message, slept = false) {
        if (!this.playerSystem.isDead) this.progression.record('nights');
        this.animalSystem.clearWolves(slept ? 0 : 30);
        const regrown = this.terrainSystem.regrow(this.dayCount);
        this.weatherSystem.refresh();
        // A new season, or one about to turn, is the morning's news.
        const calendar = this.seasons.onNewDay();
        this.uiSystem.showDayBanner(this.dayCount, message || calendar || (regrown ? 'The forest has grown back in places' : 'You made it through the night'), slept);
        this.saveSystem.save();
    }

    setupControls() {
        const canvas = this.engine.getRenderingCanvas();
        canvas.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'mouse' || event.button !== 0 || this.paused) return;
            this.audio?.unlock();
            // Capture the mouse first. Where the browser keeps refusing (some
            // embedded frames), play on without it: drag to look, click to act.
            if (!document.pointerLockElement && canvas.requestPointerLock && this.pointerLockRefusals < 3) {
                canvas.requestPointerLock()?.catch?.(() => { this.pointerLockRefusals++; });
                return;
            }
            this.primaryHeld = true;
            this.primaryAction(true);
        });
        window.addEventListener('pointerup', event => {
            if (event.pointerType === 'mouse' && event.button === 0) this.primaryHeld = false;
        });
        canvas.addEventListener('contextmenu', event => {
            event.preventDefault();
            this.secondaryAction();
        });
        canvas.addEventListener('wheel', event => {
            if (this.paused) return;
            if (this.buildSystem.placing) this.buildSystem.rotatePlacement(event.deltaY > 0 ? 1 : -1);
            else this.viewSystem.zoomBy(event.deltaY > 0 ? 1 : -1);
        }, {passive: true});
        window.addEventListener('keydown', event => {
            if (event.repeat) return;
            // Typing in a settings field must never move the player.
            if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
            if (event.code === 'Escape') {
                this.lastEscapeAt = performance.now();
                if (!this.paused && this.buildSystem.cancelPlacement()) return;
                this.uiSystem.toggleMenu();
            }
            if (event.code === 'KeyC') this.uiSystem.toggleCrafting();
            if (event.code === 'KeyG') this.uiSystem.toggleGear();
            if (event.code === 'KeyK') this.uiSystem.togglePerks();
            if (event.code === 'KeyN') this.uiSystem.toggleMap();
            if (event.code === 'KeyT') this.companion.toggleMode();
            if (event.code === 'KeyB') {
                if (!this.paused && this.buildSystem.cancelPlacement()) return;
                this.uiSystem.toggleBuilding();
            }
            if (event.code === 'KeyP') this.saveSystem.save();
            if (event.code === 'KeyM') {
                this.updateSettings({muted: !this.settings.muted});
                this.uiSystem.showNotification(this.settings.muted ? 'Sound off' : 'Sound on');
                this.uiSystem.syncSettings();
            }
            if (this.paused) return;
            this.playerSystem.updateKeyState(event.keyCode, true);
            if (event.code === 'Space') { event.preventDefault(); this.playerSystem.jump(); }
            if (event.code === 'KeyE') this.survivalSystem.interact();
            if (event.code === 'KeyF') this.effects.toggleTorch();
            if (event.code === 'KeyV') this.viewSystem.cycle();
            if (event.code === 'KeyQ') this.playerSystem.dodge();
            if (event.code === 'KeyH') this.inventorySystem.quickHeal();
            // R rotates a build preview; otherwise it draws the bow until released.
            if (event.code === 'KeyR') {
                if (this.buildSystem.placing) this.buildSystem.rotatePlacement(1);
                else this.archery.beginDraw();
            }
        });
        window.addEventListener('keyup', event => {
            this.playerSystem.updateKeyState(event.keyCode, false);
            if (event.code === 'KeyR') this.archery.release();
        });
        // Browsers swallow the Esc press that releases the mouse, so losing the
        // pointer lock is treated as that Esc: cancel a build, otherwise pause.
        document.addEventListener('pointerlockerror', () => { this.pointerLockRefusals++; });
        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement) this.pointerLockRefusals = 0;
            if (document.pointerLockElement || this.paused || this.touchControls?.enabled) return;
            if (performance.now() - (this.lastEscapeAt || -1e9) < 300) return;
            if (this.buildSystem.cancelPlacement()) {
                this.uiSystem.showNotification('Building cancelled');
                return;
            }
            this.uiSystem.openPanel('menu');
        });
        window.addEventListener('blur', () => this.uiSystem.openPanel('menu'));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { this.uiSystem.openPanel('menu'); this.audio?.suspend(); }
            else this.audio?.resume();
        });
        this.setPaused(true);
    }

    setupGameLoop() {
        // Game loop for physics and movement
        this.scene.onBeforeRenderObservable.add(() => {
            if (this.paused) return;
            // Update player physics
            this.playerSystem.update();
            this.touchControls?.update();
            if (this.primaryHeld) this.primaryAction(false);
            this.buildSystem.updatePlacement();

            const dt = Math.min(this.engine.getDeltaTime() / 1000, .05);
            this.quality.update(this.engine.getDeltaTime() / 1000);
            const underground = this.dungeonSystem.active;
            // Check if we need to update terrain chunks (the surface waits while underground)
            if (!underground) this.terrainSystem.checkChunkUpdates();

            // Check for nearby loot and landmark discoveries.
            this.inventorySystem.update();
            if (!underground) this.explorationSystem.update();
            this.dungeonSystem.update(dt);
            this.viewSystem.update(dt);
            this.gear.update(dt);
            this.buffs.update(dt);
            this.regions.update(dt);
            this.legends.update(dt);
            this.pois.update(dt);
            this.seasons.update(dt);
            this.raids.update(dt);
            this.fishing.update(dt);
            this.gardens.update(dt);
            this.companion.update(dt);
            this.archery.update(dt);
            this.survivalSystem.update(dt);
            this.saveSystem.update(dt);
            this.updateAmbience(dt);
        });

        // Start render loop
        this._buildingStreamAccumulator = 0;
        this.engine.runRenderLoop(() => {
            this.terrainSystem.processChunkQueue();
            this._buildingStreamAccumulator += Math.min(.05,this.engine.getDeltaTime()/1000);
            if (this._buildingStreamAccumulator > .65) {
                this.buildSystem.update();
                this.effects.updateFires();
                this._buildingStreamAccumulator = 0;
            }
            // Update day/night cycle
            if (!this.paused) {
                this.updateDayNightCycle();
                this.weatherSystem.update();
            }

            // Update animal spawning and movement
            if (!this.paused) this.animalSystem.update();
            this.uiSystem.update();

            // With a menu up nothing in the world moves, so there is no need
            // to redraw it sixty times a second behind the panel.
            if (this.paused && this.uiSystem.started && (this._pausedFrames = (this._pausedFrames || 0) + 1) % 8) return;
            this.scene.render();
        });
    }

    // Footsteps every frame; the ambience mix a few times a second.
    updateAmbience(dt) {
        const player = this.playerSystem;
        const position = player.camera.position;
        const terrain = this.terrainSystem;
        const underground = this.dungeonSystem.active;
        const wading = !underground && terrain.isWaterArea(position.x, position.z);
        this.audio.footsteps(position, player.isGrounded && !player.isSwimming, wading);
        this.ambienceTimer -= dt;
        if (this.ambienceTimer > 0) return;
        this.ambienceTimer = .3;
        this.audio.update(.3, {
            // Snow falls without a sound; a blizzard howls like a storm.
            weather: {snow: 'clear', blizzard: 'storm'}[this.weatherSystem.form] || this.weatherSystem.type,
            night: this.survivalSystem.isNight(),
            underwater: player.isUnderwater,
            underground,
            flying: player.isFlying,
            fireDistance: this.effects.nearestFireDistance
        });
    }

    // Day/night cycle
    updateDayNightCycle() {
        const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
        this.dayTime += dt;
        if (this.dayTime >= this.dayLength) {
            this.dayTime -= this.dayLength;
            this.dayCount++;
            this.onNewDay();
        }
        this.skySystem.update(dt);
    }
}
