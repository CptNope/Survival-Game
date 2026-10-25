import test from 'node:test';
import assert from 'node:assert/strict';
import BABYLON from 'babylonjs';
import {createTreeModel,createRockModel,createDeerModel,createRabbitModel,createLootModel,createOreModel,createPlantModel,animateDeer} from '../js/models/wilderness.js';
import {CombatSystem} from '../js/components/combat.js';
globalThis.BABYLON = BABYLON;
function fixture() { const engine=new BABYLON.NullEngine();return {engine,scene:new BABYLON.Scene(engine)}; }
test('all asset variants have finite geometry and fully release resources',()=>{
 const {engine,scene}=fixture();
 try {
  const factories=[s=>createTreeModel(scene,s,'pine'),s=>createTreeModel(scene,s,'oak'),s=>createRockModel(scene,s),s=>createDeerModel(scene,s).mesh,s=>createRabbitModel(scene,s).mesh,s=>createOreModel(scene,s),...['fiber','herb','berry'].map(type=>s=>createPlantModel(scene,s,type)),...['wood','stone','planks','tools','ironOre','iron','fiber','herbs','berries','ironTools'].map(type=>()=>createLootModel(scene,type))];
  for(const factory of factories) for(let seed=1;seed<=10;seed++) {
   const root=factory(seed);
   for(const mesh of [root,...root.getChildMeshes()]) {
    const vertices=mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind)||[];
    assert.ok(vertices.every(Number.isFinite));
    assert.ok((mesh.getVerticesData(BABYLON.VertexBuffer.ColorKind)||[]).every(Number.isFinite));
   }
   root.dispose(false,true);
   assert.equal(scene.meshes.length,0);assert.equal(scene.materials.length,0);assert.equal(scene.transformNodes.length,0);
  }
 } finally {engine.dispose();}
});
test('seeded trees repeat exactly and different seeds vary',()=>{
 const {engine,scene}=fixture();try {
 const a=createTreeModel(scene,1),b=createTreeModel(scene,1),c=createTreeModel(scene,2);
 const positions=m=>Array.from(m.getVerticesData(BABYLON.VertexBuffer.PositionKind));
 assert.deepEqual(positions(a),positions(b));assert.notDeepEqual(positions(a),positions(c));
 assert.equal(a.getChildMeshes().length,0);
 } finally {engine.dispose();}
});
test('deer gait moves diagonal legs together and feet remain near ground at rest',()=>{
 const {engine,scene}=fixture();try {
 const deer=createDeerModel(scene,1);deer.mesh.computeWorldMatrix(true);
 const bounds=deer.mesh.getHierarchyBoundingVectors();assert.ok(bounds.min.y>-.03 && bounds.min.y<.1);
 animateDeer(deer,.1,1);
 assert.equal(deer.legs[0].rotation.x,deer.legs[3].rotation.x);
 assert.ok(Math.abs(deer.legs[0].rotation.x+deer.legs[1].rotation.x)<1e-8);
 } finally {engine.dispose();}
});
test('combat recognizes deer geometry below leg pivots',()=>{
 const {engine,scene}=fixture();try {
 const deer={...createDeerModel(scene,1),health:30};
 const hitMesh=deer.legs[0].getChildMeshes()[0];
 const game={inventorySystem:{inventory:{ironTools:0}},paused:false,playerSystem:{isDead:false},animalSystem:{animals:[deer]},pickTarget:()=>({hit:true,pickedMesh:hitMesh})};
 new CombatSystem(game).tryAttack();assert.equal(deer.health,20);
 game.inventorySystem.inventory.ironTools=1;new CombatSystem(game).tryAttack();assert.equal(deer.health,2);
 } finally {engine.dispose();}
});

test('pine canopy faces outward toward an approaching ray',()=>{
 const {engine,scene}=fixture();try {
 const pine=createTreeModel(scene,7);pine.computeWorldMatrix(true);
 const ray=new BABYLON.Ray(new BABYLON.Vector3(0,2.8,-10),new BABYLON.Vector3(0,0,1),20);
 const hit=scene.pickWithRay(ray);
 assert.ok(hit.hit);assert.ok(BABYLON.Vector3.Dot(hit.getNormal(true),ray.direction)<0);
 } finally {engine.dispose();}
});

test('rabbits render as a single merged low-poly mesh', () => {
 const {engine,scene}=fixture();try {
  const rabbit=createRabbitModel(scene,31415);
  rabbit.mesh.computeWorldMatrix(true);
  assert.equal(rabbit.mesh.getChildMeshes().length,0);
  assert.ok(rabbit.mesh.getTotalVertices()>0);
  assert.equal(scene.meshes.length,1);
  rabbit.mesh.dispose(false,true);
  assert.equal(scene.meshes.length,0);
  assert.equal(scene.materials.length,0);
 } finally {engine.dispose();}
});
