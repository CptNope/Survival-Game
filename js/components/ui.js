// UI system for handling all game interface elements
export class UISystem {
    constructor(game) {
        this.game = game;
        
        // UI elements
        this.woodText = null;
        this.stoneText = null;
        this.planksText = null;
        this.toolsText = null;
        this.healthBar = null;
        this.oxygenBar = null; // New oxygen bar
        this.expBar = null;
        this.levelText = null;
        
        // Menu elements
        this.menuPanel = null;
        this.craftingPanel = null; // Store reference to crafting panel
        this.touchControlsEnabled = false;
        this.touchControlsPanel = null;
        this.touchJoystick = null;
        
        // Create UI
        this.createUI();
    }
    
    createUI() {
        // Create fullscreen UI
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        
        // Create inventory panel
        this.createInventoryPanel(advancedTexture);
        
        // Create health bar
        this.createHealthBar(advancedTexture);
        
        // Create oxygen bar
        this.createOxygenBar(advancedTexture);
        
        // Create experience bar and level display
        this.createExperienceUI(advancedTexture);
        
        // Create crafting panel (initially hidden)
        this.createCraftingPanel(advancedTexture);
        
        // Create menu button
        this.createMenuButton(advancedTexture);
        
        // Create crafting button
        this.createCraftingButton(advancedTexture);
    }
    
    createInventoryPanel(advancedTexture) {
        // Create inventory panel
        const inventoryPanel = new BABYLON.GUI.StackPanel();
        inventoryPanel.width = "200px";
        inventoryPanel.height = "200px";
        inventoryPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        inventoryPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        inventoryPanel.paddingLeft = "10px";
        inventoryPanel.paddingTop = "10px";
        advancedTexture.addControl(inventoryPanel);
        
        // Create inventory text elements
        this.woodText = new BABYLON.GUI.TextBlock();
        this.woodText.text = "Wood: 0";
        this.woodText.color = "white";
        this.woodText.height = "30px";
        inventoryPanel.addControl(this.woodText);
        
        this.stoneText = new BABYLON.GUI.TextBlock();
        this.stoneText.text = "Stone: 0";
        this.stoneText.color = "white";
        this.stoneText.height = "30px";
        inventoryPanel.addControl(this.stoneText);
        
        this.planksText = new BABYLON.GUI.TextBlock();
        this.planksText.text = "Planks: 0";
        this.planksText.color = "white";
        this.planksText.height = "30px";
        inventoryPanel.addControl(this.planksText);
        
        this.toolsText = new BABYLON.GUI.TextBlock();
        this.toolsText.text = "Tools: 0";
        this.toolsText.color = "white";
        this.toolsText.height = "30px";
        inventoryPanel.addControl(this.toolsText);
    }
    
    createHealthBar(advancedTexture) {
        // Create health bar container
        const healthBarContainer = new BABYLON.GUI.Rectangle();
        healthBarContainer.width = "200px";
        healthBarContainer.height = "30px";
        healthBarContainer.cornerRadius = 5;
        healthBarContainer.color = "white";
        healthBarContainer.thickness = 2;
        healthBarContainer.background = "black";
        healthBarContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthBarContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        healthBarContainer.left = 10;
        healthBarContainer.bottom = 90; // Moved up to make room for oxygen bar
        advancedTexture.addControl(healthBarContainer);
        
        this.healthBar = new BABYLON.GUI.Rectangle();
        this.healthBar.width = "100%";
        this.healthBar.height = "100%";
        this.healthBar.background = "red";
        this.healthBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthBarContainer.addControl(this.healthBar);
        
        // Create health text
        const healthText = new BABYLON.GUI.TextBlock();
        healthText.text = "Health";
        healthText.color = "white";
        healthText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        healthBarContainer.addControl(healthText);
    }
    
    createOxygenBar(advancedTexture) {
        // Create oxygen bar container
        const oxygenBarContainer = new BABYLON.GUI.Rectangle();
        oxygenBarContainer.width = "200px";
        oxygenBarContainer.height = "30px";
        oxygenBarContainer.cornerRadius = 5;
        oxygenBarContainer.color = "white";
        oxygenBarContainer.thickness = 2;
        oxygenBarContainer.background = "black";
        oxygenBarContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        oxygenBarContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        oxygenBarContainer.left = 10;
        oxygenBarContainer.bottom = 50;
        advancedTexture.addControl(oxygenBarContainer);
        
        this.oxygenBar = new BABYLON.GUI.Rectangle();
        this.oxygenBar.width = "100%";
        this.oxygenBar.height = "100%";
        this.oxygenBar.background = "lightblue";
        this.oxygenBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        oxygenBarContainer.addControl(this.oxygenBar);
        
        // Create oxygen text
        const oxygenText = new BABYLON.GUI.TextBlock();
        oxygenText.text = "Oxygen";
        oxygenText.color = "white";
        oxygenText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        oxygenBarContainer.addControl(oxygenText);
    }
    
    createExperienceUI(advancedTexture) {
        // Create experience bar container
        const expBarContainer = new BABYLON.GUI.Rectangle();
        expBarContainer.width = "200px";
        expBarContainer.height = "20px";
        expBarContainer.cornerRadius = 5;
        expBarContainer.color = "white";
        expBarContainer.thickness = 2;
        expBarContainer.background = "black";
        expBarContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        expBarContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        expBarContainer.left = 10;
        expBarContainer.bottom = 20; // Increased to avoid overlap with oxygen bar
        advancedTexture.addControl(expBarContainer);
        
        this.expBar = new BABYLON.GUI.Rectangle();
        this.expBar.width = "0%";
        this.expBar.height = "100%";
        this.expBar.background = "yellow";
        this.expBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        expBarContainer.addControl(this.expBar);
        
        // Create level text
        this.levelText = new BABYLON.GUI.TextBlock();
        this.levelText.text = "Level 1";
        this.levelText.color = "white";
        this.levelText.fontSize = 14;
        this.levelText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        expBarContainer.addControl(this.levelText);
    }
    
    createCraftingPanel(advancedTexture) {
        // Create crafting panel
        const craftingPanel = new BABYLON.GUI.Rectangle("craftingPanel");
        craftingPanel.width = "300px";
        craftingPanel.height = "400px";
        craftingPanel.cornerRadius = 10;
        craftingPanel.color = "white";
        craftingPanel.thickness = 2;
        craftingPanel.background = "#333333";
        craftingPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        craftingPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        craftingPanel.isVisible = false; // Hidden by default
        advancedTexture.addControl(craftingPanel);
        
        // Store a reference to the crafting panel
        this.craftingPanel = craftingPanel;
        
        // Create crafting title
        const craftingTitle = new BABYLON.GUI.TextBlock();
        craftingTitle.text = "Crafting";
        craftingTitle.color = "white";
        craftingTitle.fontSize = 20;
        craftingTitle.height = "40px";
        craftingTitle.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        craftingTitle.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        craftingTitle.top = "10px";
        craftingPanel.addControl(craftingTitle);
        
        // Create close button
        const closeButton = BABYLON.GUI.Button.CreateSimpleButton("closeButton", "X");
        closeButton.width = "30px";
        closeButton.height = "30px";
        closeButton.color = "white";
        closeButton.thickness = 2;
        closeButton.cornerRadius = 15;
        closeButton.background = "red";
        closeButton.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        closeButton.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        closeButton.top = "10px";
        closeButton.left = "-10px";
        closeButton.onPointerClickObservable.add(() => {
            craftingPanel.isVisible = false;
        });
        craftingPanel.addControl(closeButton);
        
        // Create crafting options
        const craftingOptions = new BABYLON.GUI.StackPanel();
        craftingOptions.width = "260px";
        craftingOptions.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        craftingOptions.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        craftingOptions.top = "60px";
        craftingPanel.addControl(craftingOptions);
        
        // Add crafting buttons
        this.addCraftingButton(craftingOptions, "Craft Planks (2 Wood)", () => {
            if (this.game.inventorySystem.craft("planks")) {
                this.updateInventoryUI();
            }
        });
        
        this.addCraftingButton(craftingOptions, "Craft Tools (3 Planks + 2 Stone)", () => {
            if (this.game.inventorySystem.craft("tools")) {
                this.updateInventoryUI();
            }
        });
    }
    
    addCraftingButton(parent, text, callback) {
        const button = BABYLON.GUI.Button.CreateSimpleButton("craftButton", text);
        button.width = "100%";
        button.height = "40px";
        button.color = "white";
        button.thickness = 2;
        button.cornerRadius = 5;
        button.background = "#666666";
        button.onPointerClickObservable.add(callback);
        button.paddingBottom = "10px";
        parent.addControl(button);
    }
    
    createMenuButton(advancedTexture) {
        // Create menu button
        const menuButton = BABYLON.GUI.Button.CreateSimpleButton("menuButton", "MENU");
        menuButton.width = "60px";
        menuButton.height = "40px";
        menuButton.cornerRadius = 5;
        menuButton.color = "white";
        menuButton.thickness = 2;
        menuButton.background = "#444444";
        menuButton.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        menuButton.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        menuButton.top = "10px";
        menuButton.left = "-10px";
        menuButton.onPointerClickObservable.add(() => {
            console.log("Menu button clicked");
            this.toggleMenu();
        });
        advancedTexture.addControl(menuButton);
    }
    
    createCraftingButton(advancedTexture) {
        // Create crafting button in the same style as menu button
        const craftingButton = BABYLON.GUI.Button.CreateSimpleButton("craftingButton", "CRAFT");
        craftingButton.width = "60px";
        craftingButton.height = "40px";
        craftingButton.cornerRadius = 5;
        craftingButton.color = "white";
        craftingButton.thickness = 2;
        craftingButton.background = "#444444";
        craftingButton.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        craftingButton.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        craftingButton.top = "10px";
        craftingButton.left = "-80px"; // Position to the left of the menu button
        craftingButton.onPointerClickObservable.add(() => {
            console.log("Crafting button clicked");
            this.toggleCrafting();
        });
        advancedTexture.addControl(craftingButton);
    }
    
    // Toggle menu visibility
    toggleMenu() {
        console.log("Toggle menu called");
        // Create menu if it doesn't exist yet
        if (!this.menuPanel) {
            console.log("Creating menu panel");
            this.createMenu();
        }
        
        // Toggle visibility
        this.menuPanel.isVisible = !this.menuPanel.isVisible;
        console.log("Menu visibility set to:", this.menuPanel.isVisible);
        
        // Hide crafting panel if menu is opened
        if (this.menuPanel.isVisible && this.craftingPanel) {
            console.log("Hiding crafting panel");
            this.craftingPanel.isVisible = false;
        }
    }
    
    // Toggle crafting panel visibility
    toggleCrafting() {
        console.log("Toggle crafting called");
        
        // Use the stored reference to the crafting panel
        if (this.craftingPanel) {
            // Toggle visibility
            this.craftingPanel.isVisible = !this.craftingPanel.isVisible;
            console.log("Crafting panel visibility set to:", this.craftingPanel.isVisible);
            
            // Hide menu if crafting panel is opened
            if (this.craftingPanel.isVisible && this.menuPanel) {
                this.menuPanel.isVisible = false;
            }
        } else {
            console.warn("Crafting panel not found - attempting to create it");
            // Create the UI if it doesn't exist yet
            const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
            this.createCraftingPanel(advancedTexture);
            if (this.craftingPanel) {
                this.craftingPanel.isVisible = true;
            }
        }
    }
    
    // Create the game menu
    createMenu() {
        // Get the existing fullscreen UI
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("MenuUI");
        if (!advancedTexture) return;
        
        // Create menu panel
        this.menuPanel = new BABYLON.GUI.Rectangle("menuPanel");
        this.menuPanel.width = "300px";
        this.menuPanel.height = "400px";
        this.menuPanel.cornerRadius = 10;
        this.menuPanel.color = "white";
        this.menuPanel.thickness = 2;
        this.menuPanel.background = "#333333";
        this.menuPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.menuPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.menuPanel.isVisible = false; // Hidden by default
        advancedTexture.addControl(this.menuPanel);
        
        // Create menu title
        const menuTitle = new BABYLON.GUI.TextBlock("menuTitle");
        menuTitle.text = "Game Menu";
        menuTitle.color = "white";
        menuTitle.fontSize = 24;
        menuTitle.height = "40px";
        menuTitle.top = "10px";
        this.menuPanel.addControl(menuTitle);
        
        // Create stack panel for buttons
        const buttonPanel = new BABYLON.GUI.StackPanel("menuButtonPanel");
        buttonPanel.width = "220px";
        buttonPanel.top = "60px";
        buttonPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.menuPanel.addControl(buttonPanel);
        
        // Install PWA button
        const installBtn = BABYLON.GUI.Button.CreateSimpleButton("installButton", "Install Game as App");
        installBtn.width = "200px";
        installBtn.height = "40px";
        installBtn.color = "white";
        installBtn.background = "green";
        installBtn.thickness = 2;
        installBtn.cornerRadius = 10;
        installBtn.onPointerClickObservable.add(() => {
            this.promptPWAInstall();
        });
        buttonPanel.addControl(installBtn);
        
        // Add spacing
        const spacer1 = new BABYLON.GUI.Rectangle("spacer1");
        spacer1.width = "100%";
        spacer1.height = "20px";
        spacer1.background = "transparent";
        buttonPanel.addControl(spacer1);
        
        // Toggle gamepad controls button (works with both touch and mouse)
        const touchControlsBtn = BABYLON.GUI.Button.CreateSimpleButton("touchControlsButton", "Enable Gamepad Controls");
        touchControlsBtn.width = "200px";
        touchControlsBtn.height = "40px";
        touchControlsBtn.color = "white";
        touchControlsBtn.background = "blue";
        touchControlsBtn.thickness = 2;
        touchControlsBtn.cornerRadius = 10;
        touchControlsBtn.onPointerClickObservable.add(() => {
            this.toggleTouchControls();
            touchControlsBtn.textBlock.text = this.touchControlsEnabled ? "Disable Gamepad Controls" : "Enable Gamepad Controls";
        });
        buttonPanel.addControl(touchControlsBtn);
        
        // Add spacing
        const spacer2 = new BABYLON.GUI.Rectangle("spacer2");
        spacer2.width = "100%";
        spacer2.height = "20px";
        spacer2.background = "transparent";
        buttonPanel.addControl(spacer2);
        
        // Resume game button
        const resumeBtn = BABYLON.GUI.Button.CreateSimpleButton("resumeButton", "Resume Game");
        resumeBtn.width = "200px";
        resumeBtn.height = "40px";
        resumeBtn.color = "white";
        resumeBtn.background = "#666666";
        resumeBtn.thickness = 2;
        resumeBtn.cornerRadius = 10;
        resumeBtn.onPointerClickObservable.add(() => {
            this.menuPanel.isVisible = false;
        });
        buttonPanel.addControl(resumeBtn);
    }
    
    // Prompt PWA installation
    promptPWAInstall() {
        // Check if PWA install prompt is available (stored in main.js)
        if (window.deferredPrompt) {
            // Show the install prompt
            window.deferredPrompt.prompt();
            
            // Wait for the user to respond to the prompt
            window.deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('User accepted the PWA installation');
                    // Create a notification
                    this.showNotification("Game installation started!");
                } else {
                    console.log('User dismissed the PWA installation');
                    this.showNotification("Installation canceled");
                }
                // Clear the deferredPrompt variable
                window.deferredPrompt = null;
            });
        } else {
            // PWA already installed or not available
            this.showNotification("App already installed or installation not available in this browser");
        }
    }
    
    // Show a notification message
    showNotification(message) {
        const notification = new BABYLON.GUI.TextBlock("notification");
        notification.text = message;
        notification.color = "white";
        notification.fontSize = 18;
        notification.height = "30px";
        notification.background = "#333333";
        notification.paddingTop = "5px";
        notification.paddingBottom = "5px";
        notification.paddingLeft = "10px";
        notification.paddingRight = "10px";
        notification.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        notification.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        notification.top = "50px";
        
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("NotificationUI");
        advancedTexture.addControl(notification);
        
        // Remove notification after a few seconds
        setTimeout(() => {
            advancedTexture.removeControl(notification);
        }, 3000);
    }
    
    // Toggle gamepad controls for touch/mouse
    toggleTouchControls() {
        this.touchControlsEnabled = !this.touchControlsEnabled;
        console.log(`Gamepad controls ${this.touchControlsEnabled ? 'enabled' : 'disabled'}`);
        
        if (this.touchControlsEnabled) {
            // Create touch controls if they don't exist
            if (!this.touchControlsPanel) {
                this.createTouchControls();
            } else {
                // Show existing controls
                this.touchControlsPanel.isVisible = true;
            }
        } else if (this.touchControlsPanel) {
            // Hide touch controls
            this.touchControlsPanel.isVisible = false;
        }
    }
    
    // Create gamepad controls for both touch and mouse input
    createTouchControls() {
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("TouchControlsUI");
        if (!advancedTexture) return;
        
        // Create container for all touch controls
        this.touchControlsPanel = new BABYLON.GUI.Rectangle("touchControlsPanel");
        this.touchControlsPanel.width = "100%";
        this.touchControlsPanel.height = "100%";
        this.touchControlsPanel.thickness = 0;
        this.touchControlsPanel.background = "transparent";
        advancedTexture.addControl(this.touchControlsPanel);
        
        // Create virtual joystick for movement
        this.createVirtualJoystick();
        
        // Create action buttons (jump, interact, etc.)
        this.createActionButtons();
    }
    
    // Create virtual joystick for movement
    createVirtualJoystick() {
        // Create joystick container
        const joystickContainer = new BABYLON.GUI.Ellipse("joystickContainer");
        joystickContainer.width = "150px";
        joystickContainer.height = "150px";
        joystickContainer.thickness = 2;
        joystickContainer.color = "white";
        joystickContainer.alpha = 0.5;
        joystickContainer.background = "#333333";
        joystickContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        joystickContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        joystickContainer.left = "100px";
        joystickContainer.top = "-100px";
        this.touchControlsPanel.addControl(joystickContainer);
        
        // Create joystick thumb
        this.touchJoystick = new BABYLON.GUI.Ellipse("joystickThumb");
        this.touchJoystick.width = "60px";
        this.touchJoystick.height = "60px";
        this.touchJoystick.thickness = 0;
        this.touchJoystick.background = "white";
        this.touchJoystick.alpha = 0.8;
        joystickContainer.addControl(this.touchJoystick);
        
        // Joystick variables
        let joystickPointerStartX = 0;
        let joystickPointerStartY = 0;
        let joystickPointerID = -1;
        let joystickMaxDistance = 50;
        
        // Joystick down event
        joystickContainer.onPointerDownObservable.add((eventData) => {
            if (joystickPointerID < 0) {
                joystickPointerID = eventData.pointerId;
                joystickPointerStartX = eventData.x;
                joystickPointerStartY = eventData.y;
            }
        });
        
        // Joystick move event
        joystickContainer.onPointerMoveObservable.add((eventData) => {
            if (joystickPointerID === eventData.pointerId) {
                // Calculate joystick movement
                let deltaX = eventData.x - joystickPointerStartX;
                let deltaY = eventData.y - joystickPointerStartY;
                
                // Limit to max distance
                let distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                if (distance > joystickMaxDistance) {
                    deltaX = deltaX * joystickMaxDistance / distance;
                    deltaY = deltaY * joystickMaxDistance / distance;
                }
                
                // Move joystick thumb
                this.touchJoystick.left = deltaX;
                this.touchJoystick.top = deltaY;
                
                // Calculate normalized direction (-1 to 1)
                const normalizedDeltaX = deltaX / joystickMaxDistance;
                const normalizedDeltaY = deltaY / joystickMaxDistance;
                
                // Apply movement to player
                if (this.game.playerSystem && this.game.playerSystem.camera) {
                    // Get camera direction vectors
                    const cameraDirection = this.game.playerSystem.camera.getDirection(BABYLON.Vector3.Forward());
                    const cameraRight = this.game.playerSystem.camera.getDirection(BABYLON.Vector3.Right());
                    
                    // Zero out Y component to keep movement horizontal
                    cameraDirection.y = 0;
                    cameraRight.y = 0;
                    cameraDirection.normalize();
                    cameraRight.normalize();
                    
                    // Calculate movement direction
                    const moveDirection = new BABYLON.Vector3(
                        cameraRight.x * normalizedDeltaX + cameraDirection.x * -normalizedDeltaY,
                        0,
                        cameraRight.z * normalizedDeltaX + cameraDirection.z * -normalizedDeltaY
                    );
                    
                    // Apply movement
                    const speed = this.game.playerSystem.camera.speed * 0.5;
                    this.game.playerSystem.camera.position.addInPlace(moveDirection.scale(speed));
                }
            }
        });
        
        // Joystick up event
        joystickContainer.onPointerUpObservable.add((eventData) => {
            if (joystickPointerID === eventData.pointerId) {
                joystickPointerID = -1;
                // Reset joystick thumb position
                this.touchJoystick.left = 0;
                this.touchJoystick.top = 0;
            }
        });
    }
    
    // Create action buttons for touch controls
    createActionButtons() {
        // Jump button
        const jumpBtn = BABYLON.GUI.Button.CreateSimpleButton("jumpButton", "JUMP");
        jumpBtn.width = "80px";
        jumpBtn.height = "80px";
        jumpBtn.cornerRadius = 40;
        jumpBtn.color = "white";
        jumpBtn.thickness = 2;
        jumpBtn.background = "blue";
        jumpBtn.alpha = 0.7;
        jumpBtn.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        jumpBtn.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        jumpBtn.left = "-100px";
        jumpBtn.top = "-100px";
        this.touchControlsPanel.addControl(jumpBtn);
        
        // Jump button events
        jumpBtn.onPointerDownObservable.add(() => {
            if (this.game.playerSystem) {
                this.game.playerSystem.jump();
            }
        });
        
        // Action button (for harvesting/attacking)
        const actionBtn = BABYLON.GUI.Button.CreateSimpleButton("actionButton", "ACTION");
        actionBtn.width = "80px";
        actionBtn.height = "80px";
        actionBtn.cornerRadius = 40;
        actionBtn.color = "white";
        actionBtn.thickness = 2;
        actionBtn.background = "red";
        actionBtn.alpha = 0.7;
        actionBtn.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        actionBtn.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        actionBtn.left = "-200px";
        actionBtn.top = "-100px";
        this.touchControlsPanel.addControl(actionBtn);
        
        // Action button events
        actionBtn.onPointerDownObservable.add(() => {
            if (this.game.inventorySystem) {
                this.game.inventorySystem.tryHarvest();
            }
            if (this.game.combatSystem) {
                this.game.combatSystem.tryAttack();
            }
        });
    }
    
    // Update inventory UI
    updateInventoryUI() {
        if (this.game.inventorySystem) {
            const inventory = this.game.inventorySystem.inventory;
            this.woodText.text = `Wood: ${inventory.wood || 0}`;
            this.stoneText.text = `Stone: ${inventory.stone || 0}`;
            this.planksText.text = `Planks: ${inventory.planks || 0}`;
            this.toolsText.text = `Tools: ${inventory.tools || 0}`;
        }
        
        // Also update experience UI when inventory is updated
        this.updateExperienceUI();
    }
    
    // Update experience UI
    updateExperienceUI() {
        if (this.game.combatSystem && this.expBar) {
            const expPercentage = (this.game.combatSystem.experience / this.game.combatSystem.expToNextLevel) * 100;
            this.expBar.width = `${expPercentage}%`;
            this.levelText.text = `Level ${this.game.combatSystem.level}`;
        }
    }
    
    // Update health UI specifically
    updateHealthUI(health, maxHealth) {
        if (this.healthBar) {
            this.healthBar.width = `${(health / maxHealth) * 100}%`;
        }
    }
    
    // Update oxygen UI
    updateOxygenUI(oxygen, maxOxygen) {
        if (this.oxygenBar) {
            this.oxygenBar.width = `${(oxygen / maxOxygen) * 100}%`;
            
            // Change color based on oxygen level
            if (oxygen / maxOxygen < 0.3) {
                this.oxygenBar.background = "red"; // Critical oxygen level
            } else if (oxygen / maxOxygen < 0.6) {
                this.oxygenBar.background = "orange"; // Low oxygen level
            } else {
                this.oxygenBar.background = "lightblue"; // Normal oxygen level
            }
        }
    }
    
    // Show level up message
    showLevelUpMessage() {
        // Visual feedback for level up
        const levelUpText = new BABYLON.GUI.TextBlock();
        levelUpText.text = `LEVEL UP! Now level ${this.game.combatSystem.level}`;
        levelUpText.color = "yellow";
        levelUpText.fontSize = 30;
        levelUpText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        levelUpText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        
        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("LevelUpUI");
        advancedTexture.addControl(levelUpText);
        
        // Remove level up text after a few seconds
        setTimeout(() => {
            advancedTexture.dispose();
        }, 3000);
    }
}
