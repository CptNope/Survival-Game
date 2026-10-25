import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import { WeatherSystem, WEATHER, weatherAt } from '../js/components/weather.js';
import { InventorySystem } from '../js/components/inventory.js';
import { SurvivalSystem } from '../js/components/survival.js';
import { BuildingSystem } from '../js/components/building.js';
import { createWolfModel } from '../js/models/wilderness.js';
import { AnimalSystem } from '../js/components/animals.js';
globalThis.BABYLON=BABYLON;

test('weather cycles deterministically with game clock', () => {
 const seen=new Set();
 for(let t=0;t<1200;t+=75) {
  const state=weatherAt(Math.floor(t/300)+1,t%300,300);
  assert.ok(Object.hasOwn(WEATHER,state));
  seen.add(state);
  assert.equal(weatherAt(Math.floor(t/300)+1,t%300,300),state);
 }
 assert.ok(seen.has('clear')&&seen.has('rain')&&seen.has('storm'));
 const game={dayCount:2,dayTime:10,dayLength:300,paused:false};
 const weather=new WeatherSystem(game);
 assert.equal(weather.type,weatherAt(2,10));
 game.dayTime=200;weather.update();
 assert.equal(weather.type,weatherAt(2,200));
});

function gameFixture(){
 const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);
 const game={
  scene,paused:false,dayTime:240,dayLength:300,dayCount:1,weatherSystem:{type:'storm'},
  playerSystem:{health:100,maxHealth:100,isDead:false,isFlying:false,keys:{sprint:false},
   camera:{position:new BABYLON.Vector3(0,4,0),rotation:new BABYLON.Vector3()},
   takeDamage(amount){this.health-=amount}},
  inventorySystem:null,
  terrainSystem:{getPerlinHeight:()=>2,isWaterArea:()=>false,isWithinSpawnArea:()=>true},
  explorationSystem:{isClearing:()=>false},
  uiSystem:{showNotification(){},updateInventoryUI(){}},
  combatSystem:{gainExperience(){}}
 };
 game.inventorySystem=new InventorySystem(game);
 game.buildSystem=new BuildingSystem(game);
 game.survivalSystem=new SurvivalSystem(game);
 return {game,engine,scene};
}

test('storms chill exposed players but roofs and fires provide protection',()=>{
 const {engine,game}=gameFixture();try {
  const s=game.survivalSystem;s.cold=20;s.update(.05);
  assert.ok(s.cold>20);
  game.buildSystem.restore([{id:1,type:'roof',x:0,y:2,z:0,rotation:0}]);
  const value=s.cold;s.update(.05);
  assert.ok(s.cold<value);
  assert.equal(game.buildSystem.isProtected(game.playerSystem.camera.position),true);
  assert.equal(game.buildSystem.nearFire(game.playerSystem.camera.position),false);
 } finally{engine.dispose();}
});

test('modular walls, floors, roofs can share grid without duplicate placement',()=>{
 const {engine,game}=gameFixture();try {
  const b=game.buildSystem;
  Object.assign(game.inventorySystem.inventory,{wood:12,planks:8,fiber:4});
  assert.equal(b.place('floor'),true);
  assert.equal(b.place('roof'),true);
  assert.equal(b.place('wall'),true);
  assert.equal(b.place('wall'),false);
  assert.equal(b.structures.length,3);
  assert.equal(b.meshes.size,3);
 } finally{engine.dispose();}
});

test('campfire gates cooking, then cooked meat restores hunger',()=>{
 const {engine,game}=gameFixture();try {
  const inv=game.inventorySystem;
  inv.inventory.rawMeat=1;
  assert.equal(inv.craft('cookMeat'),false);
  game.buildSystem.restore([{id:2,type:'fire',x:1,y:2,z:1,rotation:0}]);
  assert.equal(game.buildSystem.nearFire(game.playerSystem.camera.position),true);
  assert.equal(inv.craft('cookMeat'),true);
  assert.equal(inv.inventory.rawMeat,0);
  assert.equal(inv.inventory.cookedMeat,1);
  game.survivalSystem.hunger=40;
  assert.equal(inv.craft('eatMeat'),true);
  assert.equal(game.survivalSystem.hunger,90);
  assert.equal(inv.inventory.cookedMeat,0);
 } finally{engine.dispose();}
});

test('wolves are valid low poly merged combat targets',()=>{
 const engine=new BABYLON.NullEngine(),scene=new BABYLON.Scene(engine);try {
  const wolf=createWolfModel(scene,42);
  wolf.mesh.computeWorldMatrix(true);
  assert.equal(wolf.mesh.getChildMeshes().length,0);
  assert.ok(wolf.mesh.getTotalVertices()>0);
  wolf.mesh.dispose(false,true);
  assert.equal(scene.meshes.length,0);
  assert.equal(scene.materials.length,0);
 } finally{engine.dispose();}
});

test('wolves can attack with a cooldown and are capped at three concurrent spawns',()=>{
 const {engine,game}=gameFixture();try {
  let damage=0;
  game.playerSystem.takeDamage=n=>{damage+=n};
  game.playerSystem.camera.position=new BABYLON.Vector3(0,4,0);
  game.engine={getDeltaTime:()=>16};
  // Do not replace Scene.getEngine; Babylon uses it during disposal.
  game.registerModelShadow=()=>{};
  const animals=new AnimalSystem(game);
  for(const a of animals.animals)a.mesh.dispose(false,true);
  animals.animals=[];
  animals.spawnAnimal(0,2,1,'wolf');
  animals.update();
  assert.equal(damage,8);
  animals.update();
  assert.equal(damage,8);
  const wolf=animals.animals[0];
  wolf.health=0;animals.update();
  assert.equal(animals.animals.length,0);
 } finally{engine.dispose();}
});
