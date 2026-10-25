// Main game class
import { TerrainSystem } from './components/terrain.js';
import { UISystem } from './components/ui.js';
import { AnimalSystem } from './components/animals.js';
import { CombatSystem } from './components/combat.js';
import { PlayerSystem } from './components/player.js';
import { InventorySystem } from './components/inventory.js';

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
        
        // Day/night cycle properties
        this.paused = true;
        this.dayCount = 1;
        this.dayTime = 60; // 0 to 300 (5 min cycle)
        this.dayLength = 300; // seconds
        this.sunLight = null;
        this.ambientLight = null;
        
        // Initialize the game
        this.init();
    }

    init() {
        try {
            // Get the canvas element
            const canvas = document.getElementById("renderCanvas");
            
            // Generate the BABYLON 3D engine
            this.engine = new BABYLON.Engine(canvas, true);
            // Scale GPU workload by screen density, particularly on high-DPI phones.
            const touch = window.matchMedia('(pointer: coarse)').matches;
            this.engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / (touch ? 1.5 : 2)));
            
            // Create the scene
            this.scene = new BABYLON.Scene(this.engine);
            this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
            this.scene.fogDensity = 0.007;
            this.scene.clearColor = new BABYLON.Color3(0.5, 0.8, 1.0); // Sky blue background
            
            // Movement and terrain collision use FreeCamera/manual physics; no Cannon world needed.

            // Create lighting
            this.setupLighting();
            
            // Initialize systems in the correct order
            // First create inventory system as it's needed by terrain for harvestable objects
            this.inventorySystem = new InventorySystem(this);
            
            // Create terrain system next as it's needed by player for height calculations
            this.terrainSystem = new TerrainSystem(this);
            
            // Create player system
            this.playerSystem = new PlayerSystem(this);
            
            // Create combat system
            this.combatSystem = new CombatSystem(this);
            
            // Create animal system which depends on combat
            this.animalSystem = new AnimalSystem(this);
            
            // Create UI system last as it depends on all other systems
            this.uiSystem = new UISystem(this);
            
            // Update UI once all systems are initialized
            if (this.uiSystem) {
                this.uiSystem.updateInventoryUI();
            }
            
            // Add keyboard controls
            this.setupControls();
            
            // Game loop
            this.setupGameLoop();
            
            // Watch for browser/canvas resize events
            window.addEventListener("resize", () => {
                this.engine.resize();
            });
        } catch (e) {
            console.error("Error initializing game:", e);
            throw e;
        }
    }
    
    setupLighting() {
        // Create sun and moon for day/night cycle
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
        
        // Ambient light for night time
        this.ambientLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.2;
    }
    
    registerModelShadow(mesh) {
        this.shadowGenerator.addShadowCaster(mesh, true);
        mesh.onDisposeObservable.add(() => this.shadowGenerator.removeShadowCaster(mesh, true));
    }

    pickTarget() {
        return this.scene.pickWithRay(this.playerSystem.camera.getForwardRay(5));
    }

    setPaused(value) {
        this.paused = value;
        const camera = this.playerSystem.camera;
        this.playerSystem.keys.jump = false;
        this.playerSystem.keys.descend = false;
        this.playerSystem.keys.sprint = false;
        camera.cameraDirection.setAll(0);
        camera.cameraRotation.setAll(0);
        if (value) {
            camera.detachControl();
            document.exitPointerLock?.();
        } else camera.attachControl(this.engine.getRenderingCanvas(), true);
    }

    setupControls() {
        const canvas = this.engine.getRenderingCanvas();
        canvas.addEventListener('click', () => {
            if (this.paused) return;
            if (!document.pointerLockElement) {
                canvas.requestPointerLock?.()?.catch(() => {});
                return;
            }
            this.inventorySystem.tryHarvest();
            this.combatSystem.tryAttack();
        });
        canvas.addEventListener('contextmenu', event => {
            event.preventDefault();
            if (!this.paused) this.combatSystem.specialAttack();
        });
        window.addEventListener('keydown', event => {
            if (event.repeat) return;
            if (event.code === 'Escape') this.uiSystem.toggleMenu();
            if (event.code === 'KeyC') this.uiSystem.toggleCrafting();
            if (this.paused) return;
            this.playerSystem.updateKeyState(event.keyCode, true);
            if (event.code === 'Space') { event.preventDefault(); this.playerSystem.jump(); }
        });
        window.addEventListener('keyup', event => this.playerSystem.updateKeyState(event.keyCode, false));
        window.addEventListener('blur', () => this.uiSystem.openPanel('menu'));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.uiSystem.openPanel('menu');
        });
        this.setPaused(true);
    }

    setupGameLoop() {
        // Game loop for physics and movement
        this.scene.onBeforeRenderObservable.add(() => {
            if (this.paused) return;
            // Update player physics
            this.playerSystem.update();
            
            // Check if we need to update terrain chunks
            this.terrainSystem.checkChunkUpdates();
            
            // Check for nearby loot to pick up
            this.inventorySystem.update();
        });

        // Start render loop
        this.engine.runRenderLoop(() => {
            this.terrainSystem.processChunkQueue();
            // Update day/night cycle
            if (!this.paused) this.updateDayNightCycle();
            
            // Update animal spawning and movement
            if (!this.paused) this.animalSystem.update();
            this.uiSystem.update();
            
            // Scene rendering
            this.scene.render();
        });
    }
    
    // Day/night cycle
    updateDayNightCycle() {
        this.dayTime += Math.min(this.engine.getDeltaTime() / 1000, 0.05);
        if (this.dayTime >= this.dayLength) { this.dayTime -= this.dayLength; this.dayCount++; }
        const angle = this.dayTime / this.dayLength * Math.PI * 2;
        const daylight = Math.max(0, Math.sin(angle));
        this.sunLight.direction.set(Math.cos(angle), -Math.sin(angle), 0.25);
        this.sunLight.position.copyFrom(this.playerSystem.camera.position.subtract(this.sunLight.direction.scale(65)));
        this.sunLight.intensity = daylight * 1.15;
        this.ambientLight.intensity = 0.22 + daylight * 0.45;
        const night = new BABYLON.Color3(0.035, 0.065, 0.12);
        const day = new BABYLON.Color3(0.55, 0.72, 0.77);
        this.scene.clearColor = BABYLON.Color3.Lerp(night, day, daylight);
        this.scene.fogColor = this.scene.clearColor;
    }
}
