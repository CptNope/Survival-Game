import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem, BUILDINGS } from '../js/components/building.js';
import { SaveSystem, SAVE_KEY, SAVE_VERSION } from '../js/components/save.js';

globalThis.BABYLON = BABYLON;

function gameFixture() {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const game = {
        scene, paused: false, dayTime: 60, dayLength: 300, dayCount: 1,
        playerSystem: {
            isDead: false, health: 100, maxHealth: 100, oxygenLevel: 100, maxOxygen: 100,
            isGrounded: true, isFlying: false, isSwimming: false, jumpVelocity: 0,
            keys: {sprint:false}, camera: {
                position: new BABYLON.Vector3(0,4,0),
                rotation: new BABYLON.Vector3(0,0,0)
            },
            takeDamage(n) { this.health -= n; }
        },
        terrainSystem: {
            waterHeight:1,
            getPerlinHeight: () => 2,
            isWaterArea: () => false,
            isWithinSpawnArea: () => true,
            harvestedIds: new Set(),
            chunkMap: new Map(),
            checkChunkUpdates() {}
        },
        explorationSystem: {discovered:new Set(), isClearing:()=>false},
        inventorySystem: {
            inventory: {wood:0,stone:0,planks:0,tools:0,ironOre:0,iron:0,fiber:0,herbs:0,berries:0,ironTools:0},
            harvestableObjects: [], droppedItems: [],
            createLootBag(position,itemType,count) {
                this.droppedItems.push({
                    mesh:{dispose(){}},position,itemType,count
                });
            }
        },
        combatSystem: {level:1,experience:0,expToNextLevel:100,attackPower:10},
        uiSystem: {showNotification(){},updateInventoryUI(){},updateExperienceUI(){},setSaveStatus(){}}
    };
    game.survivalSystem = new SurvivalSystem(game);
    game.buildSystem = new BuildingSystem(game);
    return {engine,scene,game};
}

test('survival needs tick consistently, pause completely, and react to sprinting', () => {
    const {engine,game} = gameFixture();
    try {
        const s=game.survivalSystem;
        s.update(.05);
        assert.ok(s.hunger<100 && s.thirst<100);
        const before=s.thirst;
        game.playerSystem.keys.sprint=true;
        s.update(.05);
        assert.ok(before-s.thirst>=.05*.15-1e-7);
        game.paused=true;
        const value=s.thirst;
        s.update(.05);
        assert.equal(s.thirst,value);
        game.paused=false;
        s.thirst=0;const health=game.playerSystem.health;
        s.update(.05);
        assert.ok(game.playerSystem.health<health);
    } finally {engine.dispose();}
});

test('shelter protects from overnight exposure; shoreline drinking requires nearby water', () => {
    const {engine,game}=gameFixture();
    try {
        const s=game.survivalSystem;
        game.dayTime=240;s.cold=50;
        s.update(.05);
        const unprotected=s.cold;
        game.buildSystem.structures.push({id:1,type:'shelter',x:1,y:2,z:1,rotation:0});
        s.update(.05);
        assert.ok(s.cold<unprotected);
        s.thirst=10;
        assert.equal(s.drink(),false);
        game.terrainSystem.isWaterArea=()=>true;
        game.playerSystem.camera.position.y=3;
        assert.equal(s.drink(),true);
        assert.equal(s.thirst,50);
    } finally {engine.dispose();}
});

test('building spends materials only on valid placement and streams one merged structure', () => {
    const {engine,game,scene}=gameFixture();
    try {
        const build=game.buildSystem,inv=game.inventorySystem.inventory;
        Object.assign(inv, {wood:6,planks:2,fiber:3});
        assert.equal(build.canAfford('shelter'),true);
        assert.equal(build.place('shelter'),true);
        assert.equal(inv.wood,0);assert.equal(inv.planks,0);assert.equal(inv.fiber,0);
        assert.equal(build.structures.length,1);
        assert.equal(build.meshes.size,1);
        assert.equal(scene.meshes.length,1);
        assert.equal(build.place('shelter'),false);
        assert.equal(build.isProtected(new BABYLON.Vector3(0,4,0)),true);
        game.playerSystem.camera.position.x=1000;
        build.update();
        assert.equal(build.meshes.size,0);
        game.playerSystem.camera.position.x=0;
        build.update();
        assert.equal(build.meshes.size,1);
        assert.equal(BUILDINGS.fire.cost.stone,3);
    } finally {engine.dispose();}
});

test('building rejects lake water and steep terrain without charging supplies', () => {
    const {engine,game}=gameFixture();
    try {
        const inv=game.inventorySystem.inventory;
        Object.assign(inv,{wood:3,stone:3});
        game.terrainSystem.isWaterArea=()=>true;
        assert.equal(game.buildSystem.place('fire'),false);
        assert.equal(inv.wood,3);
        assert.equal(inv.stone,3);
        game.terrainSystem.isWaterArea=()=>false;
        game.terrainSystem.getPerlinHeight=(x)=>x<0?6:2;
        game.playerSystem.camera.rotation.y=-Math.PI/2;
        assert.equal(game.buildSystem.place('fire'),false);
        assert.equal(inv.stone,3);
    } finally {engine.dispose();}
});

test('local save restores expedition stats, discoveries, depleted sites and shelters', () => {
    const {engine,game}=gameFixture();
    try {
        const items=new Map();
        const storage={setItem(key,value){items.set(key,value)},getItem(key){return items.get(key)||null}};
        const saves=new SaveSystem(game,storage);
        game.saveSystem=saves;
        game.inventorySystem.inventory.wood=9;
        game.playerSystem.camera.position.x=34;
        game.survivalSystem.hunger=61;
        game.survivalSystem.thirst=38;
        game.explorationSystem.discovered.add('first-camp');
        game.terrainSystem.harvestedIds.add('2,1:tree:1');
        game.buildSystem.restore([{id:7,type:'fire',x:6,y:2,z:8,rotation:0}]);
        assert.equal(saves.save(),true);
        const saved=JSON.parse(items.get(SAVE_KEY));
        assert.equal(saved.version,SAVE_VERSION);
        assert.equal(saved.structures.length,1);
        game.inventorySystem.inventory.wood=0;
        game.playerSystem.camera.position.x=0;
        game.survivalSystem.hunger=100;
        game.explorationSystem.discovered.clear();
        game.terrainSystem.harvestedIds.clear();
        game.buildSystem.restore([]);
        assert.equal(saves.load(),true);
        assert.equal(game.inventorySystem.inventory.wood,9);
        assert.equal(game.playerSystem.camera.position.x,34);
        assert.equal(game.survivalSystem.hunger,61);
        assert.equal(game.survivalSystem.thirst,38);
        assert.ok(game.explorationSystem.discovered.has('first-camp'));
        assert.ok(game.terrainSystem.harvestedIds.has('2,1:tree:1'));
        assert.equal(game.buildSystem.structures[0].id,7);
    } finally {engine.dispose();}
});

test('bad or obsolete save data cannot clobber the expedition', () => {
    const {engine,game}=gameFixture();
    try {
        const storage={getItem:()=>'{broken json'};
        assert.equal(new SaveSystem(game,storage).load(),false);
        storage.getItem=()=>JSON.stringify({version:30,position:{x:1,y:2,z:3}});
        assert.equal(new SaveSystem(game,storage).load(),false);
        game.playerSystem.isDead=true;
        let wrote=false;
        storage.setItem=()=>{wrote=true};
        assert.equal(new SaveSystem(game,storage).save(),false);
        assert.equal(wrote,false);
    } finally {engine.dispose();}
});
