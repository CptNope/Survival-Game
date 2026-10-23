import test from 'node:test';
import assert from 'node:assert/strict';
import { InventorySystem } from '../js/components/inventory.js';
import { CombatSystem } from '../js/components/combat.js';
import { PlayerSystem } from '../js/components/player.js';
function fixture() {
 const game = {paused:false, playerSystem:{health:50,maxHealth:100,isDead:false},uiSystem:{showNotification(){},updateInventoryUI(){},updateExperienceUI(){},updateHealthUI(){},showLevelUpMessage(){}}};
 game.inventorySystem=new InventorySystem(game);return game;
}
test('crafting fails atomically and follows the displayed recipe',()=>{
 const g=fixture(),i=g.inventorySystem;
 assert.equal(i.craft('tools'),false);assert.equal(i.inventory.tools,0);
 i.inventory.wood=2;i.inventory.stone=2;
 assert.equal(i.craft('planks'),true);assert.equal(i.craft('tools'),true);
 assert.deepEqual(i.inventory,{wood:0,stone:0,planks:0,tools:1,ironOre:0,iron:0,fiber:0,herbs:0,berries:0,ironTools:0});
 assert.equal(i.craft('unknown'),false);
});
test('dressing caps health and consumes nothing at full health',()=>{
 const g=fixture(),i=g.inventorySystem;i.inventory.wood=9;g.playerSystem.health=90;
 assert.equal(i.craft('bandage'),true);assert.equal(g.playerSystem.health,100);
 assert.equal(i.craft('bandage'),false);assert.equal(i.inventory.wood,6);
});
test('large XP awards grant all levels and heal the real player',()=>{
 const g=fixture();g.combatSystem=new CombatSystem(g);g.combatSystem.gainExperience(260);
 assert.equal(g.combatSystem.level,3);assert.equal(g.combatSystem.experience,10);
 assert.equal(g.playerSystem.health,140);assert.equal(g.playerSystem.maxHealth,140);
});
test('dead players cannot reclaim loot or craft',()=>{
 const g=fixture();g.playerSystem.isDead=true;g.inventorySystem.inventory.wood=2;
 g.inventorySystem.droppedItems=[{}];
 assert.doesNotThrow(()=>g.inventorySystem.checkForLoot());
 assert.equal(g.inventorySystem.craft('planks'),false);
});
test('paused and dead players cannot attack',()=>{
 const g=fixture(),c=new CombatSystem(g);g.paused=true;
 assert.doesNotThrow(()=>c.tryAttack());assert.equal(c.isAttacking,false);
 g.paused=false;g.playerSystem.isDead=true;
 assert.doesNotThrow(()=>c.tryAttack());assert.equal(c.isAttacking,false);
});
test('jump rises from level ground and lands at multiple frame rates',()=>{
 for(const fps of [30,60,120]){
 const p=Object.create(PlayerSystem.prototype);
 Object.assign(p,{game:{scene:{getAnimationRatio:()=>60/fps},terrainSystem:{isWaterArea:()=>false,getPerlinHeight:()=>0}},camera:{position:{x:0,y:2,z:0}},isDead:false,isGrounded:true,isFlying:false,jumpHeight:.22,gravity:.012,jumpVelocity:0,jumpTimerThreshold:300,oxygenLevel:100,maxOxygen:100,oxygenRefillRate:.5,keys:{jump:false,descend:false}});
 p.jump();p.update();assert.ok(p.camera.position.y>2);
 for(let n=0;n<fps*2;n++)p.update();
 assert.equal(p.isGrounded,true);assert.equal(p.camera.position.y,2);
 }
});

test('ore requires a tool; iron tools improve yield without consuming the tool',()=>{
 const g=fixture(),i=g.inventorySystem;
 let disposed=false; const mesh={dispose(){disposed=true;}};
 i.harvestableObjects=[{mesh,type:'ore'}];g.pickTarget=()=>({hit:true,pickedMesh:mesh});
 i.tryHarvest();assert.equal(disposed,false);assert.equal(i.inventory.ironOre,0);
 i.inventory.tools=1;i.tryHarvest();assert.equal(disposed,true);assert.equal(i.inventory.ironOre,2);assert.equal(i.inventory.tools,1);
 i.harvestableObjects=[{mesh,type:'ore'}];i.inventory.ironTools=1;i.tryHarvest();assert.equal(i.inventory.ironOre,5);
});
test('plants harvest by hand and yield their own resource',()=>{
 for(const [type,item,count] of [['fiber','fiber',3],['herb','herbs',2],['berry','berries',3]]) {
  const g=fixture(),i=g.inventorySystem;const mesh={dispose(){}};
  i.harvestableObjects=[{mesh,type}];g.pickTarget=()=>({hit:true,pickedMesh:mesh});
  i.tryHarvest();assert.equal(i.inventory[item],count);assert.equal(i.harvestableObjects.length,0);
 }
});
test('ore-to-iron-tool progression charges all ingredients exactly',()=>{
 const g=fixture(),i=g.inventorySystem;
 Object.assign(i.inventory,{ironOre:4,wood:4,planks:1,fiber:2});
 assert.equal(i.craft('ironTools'),false);
 assert.equal(i.craft('iron'),true);assert.equal(i.craft('iron'),true);assert.equal(i.craft('ironTools'),true);
 assert.equal(i.inventory.ironTools,1);
 for(const item of ['ironOre','wood','planks','fiber','iron'])assert.equal(i.inventory[item],0);
});
test('herbal and berry healing never over-heals or consumes ingredients at full health',()=>{
 const g=fixture(),i=g.inventorySystem;Object.assign(i.inventory,{fiber:4,herbs:4,berries:4});
 assert.equal(i.craft('herbalWrap'),true);assert.equal(g.playerSystem.health,100);
 assert.equal(i.craft('herbalWrap'),false);assert.equal(i.inventory.herbs,2);
 assert.equal(i.craft('snack'),false);assert.equal(i.inventory.berries,4);
 g.playerSystem.health=95;assert.equal(i.craft('snack'),true);assert.equal(g.playerSystem.health,100);assert.equal(i.inventory.berries,2);
});

test('death drops every resource type and clears all inventory slots',()=>{
 const g=fixture(),i=g.inventorySystem,dropped=[];
 for(const item of Object.keys(i.inventory))i.inventory[item]=3;
 i.createLootBag=(position,item,count)=>dropped.push({item,count});
 i.dropAllItems({x:1,y:2,z:3});
 assert.equal(dropped.length,10);assert.ok(dropped.every(drop=>drop.count===3));
 assert.ok(Object.values(i.inventory).every(count=>count===0));
});
