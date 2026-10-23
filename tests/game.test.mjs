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
 assert.deepEqual(i.inventory,{wood:0,stone:0,planks:0,tools:1});
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
