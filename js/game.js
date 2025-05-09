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
        this.dayTime = 0; // 0 to 300 (5 min cycle)
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
            
            // Create the scene
            this.scene = new BABYLON.Scene(this.engine);
            this.scene.clearColor = new BABYLON.Color3(0.5, 0.8, 1.0); // Sky blue background
            
            // Enable physics engine with error handling
            try {
                const gravityVector = new BABYLON.Vector3(0, -9.81, 0);
                // Check if CannonJSPlugin is available
                if (typeof BABYLON.CannonJSPlugin === 'function') {
                    const physicsPlugin = new BABYLON.CannonJSPlugin();
                    this.scene.enablePhysics(gravityVector, physicsPlugin);
                    console.log('Physics engine initialized successfully');
                } else {
                    console.warn('CannonJSPlugin not available, physics disabled');
                    // Set a flag to indicate physics is disabled
                    this.physicsEnabled = false;
                }
            } catch (error) {
                console.warn('Failed to initialize physics engine:', error);
                // Set a flag to indicate physics is disabled
                this.physicsEnabled = false;
            }
            
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
        }
    }
    
    setupLighting() {
        // Create sun and moon for day/night cycle
        this.sunLight = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(0, -1, 0), this.scene);
        this.sunLight.intensity = 1.0;
        this.sunLight.diffuse = new BABYLON.Color3(1, 1, 0.8);
        
        // Ambient light for night time
        this.ambientLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this.scene);
        this.ambientLight.intensity = 0.2;
    }
    
    setupControls() {
        const keys = {};
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
                keys[evt.sourceEvent.key] = true;
            }
        ));
        
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
                keys[evt.sourceEvent.key] = false;
            }
        ));

        // Add click action for harvesting and attacking
        window.addEventListener('click', () => {
            this.inventorySystem.tryHarvest();
            this.combatSystem.tryAttack();
        });
        
        // Add right-click action for special attack
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Prevent context menu
            this.combatSystem.specialAttack();
        });

        // Add jump and flying controls
        window.addEventListener('keydown', (e) => {
            // Update key state
            this.playerSystem.updateKeyState(e.keyCode, true);
            
            // Handle jump action
            if (e.keyCode === 32) { // Space key
                this.playerSystem.jump();
            }
        });
        
        // Track key up events for flying controls
        window.addEventListener('keyup', (e) => {
            // Update key state
            this.playerSystem.updateKeyState(e.keyCode, false);
        });
    }
    
    setupGameLoop() {
        // Game loop for physics and movement
        this.scene.onBeforeRenderObservable.add(() => {
            // Update player physics
            this.playerSystem.update();
            
            // Check if we need to update terrain chunks
            this.terrainSystem.checkChunkUpdates();
            
            // Check for nearby loot to pick up
            this.inventorySystem.update();
        });

        // Start render loop
        this.engine.runRenderLoop(() => {
            // Update day/night cycle
            this.updateDayNightCycle();
            
            // Update animal spawning and movement
            this.animalSystem.update();
            
            // Scene rendering
            this.scene.render();
        });
    }
    
    // Day/night cycle
    updateDayNightCycle() {
        // Increment time
        this.dayTime += this.scene.getEngine().getDeltaTime() / 1000;
        if (this.dayTime > this.dayLength) {
            this.dayTime = 0;
        }
        
        // Calculate sun position
        const angle = (this.dayTime / this.dayLength) * Math.PI * 2;
        const sunX = Math.sin(angle);
        const sunY = Math.cos(angle);
        
        // Update sun direction
        this.sunLight.direction = new BABYLON.Vector3(sunX, sunY, 0);
        
        // Update light intensity based on time of day
        const dayFactor = Math.max(0, Math.sin((this.dayTime / this.dayLength) * Math.PI));
        this.sunLight.intensity = 0.5 + dayFactor * 0.5;
        
        // Update sky color
        const skyBlue = 0.5 + dayFactor * 0.3;
        this.scene.clearColor = new BABYLON.Color3(skyBlue * 0.5, skyBlue * 0.8, skyBlue);
    }
}
