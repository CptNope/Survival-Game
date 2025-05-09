// Main game entry point
import { SurvivalGame } from './game.js';

// Variable to store the deferred PWA installation prompt
window.deferredPrompt = null;

// Handle PWA installation prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Store the event so it can be triggered later
    window.deferredPrompt = e;
    console.log('PWA installation prompt available');
});

// Handle successful installation
window.addEventListener('appinstalled', () => {
    // Clear the deferredPrompt variable
    window.deferredPrompt = null;
    console.log('PWA was installed');
});

// Start the game when the page loads
window.addEventListener("load", () => {
    // Initialize game
    const game = new SurvivalGame();
    console.log("Game initialized");
    
    // Check if running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('Running as installed PWA');
    }
});

// Make SurvivalGame accessible from the console for debugging
window.SurvivalGame = SurvivalGame;
