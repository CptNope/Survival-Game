# Survival Game

A 3D survival game built with Babylon.js featuring procedural terrain generation, resource harvesting, crafting, and combat.

## Features

- Procedurally generated terrain using Perlin noise
- Chunk-based terrain generation for better performance
- Day/night cycle with changing lighting
- Harvestable trees and rocks for resources
- Flying mechanics with double-jump activation
- Physics-enabled objects with realistic placement
- Safe spawn area with flat terrain and no obstacles
- Crafting system for creating tools and planks
- Animal spawning and AI movement
- Combat system with experience and leveling
- Health and experience tracking
- User interface for inventory and crafting
- Progressive Web App (PWA) support for offline play

## Setup

1. Start a local web server in the project directory
   - Python: `python -m http.server 8000`
   - Node.js: `npx serve`
2. Open `http://localhost:8000` in a modern web browser
3. Use mouse to look around and WASD keys (W=forward, A=left, S=backward, D=right) to move

## Dependencies

- Babylon.js (loaded from CDN)
- Babylon.js Loaders
- Babylon.js Procedural Textures
- Babylon.js Serializers
- Babylon.js GUI

## Controls

- Mouse: Look around
- WASD: Move player (W=forward, A=left, S=backward, D=right)
- Space: Jump (tap twice quickly to activate flying)
- While Flying:
  - Hold Space: Ascend higher
  - Hold Ctrl: Descend
  - Press Space again: Deactivate flying and fall
- Left Click: Harvest resources / Attack animals
- Right Click: Special attack (requires tools)

## Codebase Structure

The game is organized into a modular component-based architecture:

### Core Files
- `index.html`: Main HTML file with canvas and script imports
- `js/main.js`: Entry point that initializes the game
- `js/game.js`: Core game class that coordinates all systems
- `js/utils.js`: Utility functions used across the game

### Component System
Each game system is separated into its own module:

- `js/components/terrain.js`: Terrain generation and management
- `js/components/player.js`: Player movement, physics, and camera
- `js/components/inventory.js`: Resource management and crafting
- `js/components/animals.js`: Animal spawning and behavior
- `js/components/combat.js`: Combat mechanics and experience system
- `js/components/ui.js`: User interface elements

## Development

The game is built using Babylon.js, a powerful 3D engine for the web. The modular architecture makes it easy to extend with new features by adding new component systems or enhancing existing ones.

## License

MIT License
