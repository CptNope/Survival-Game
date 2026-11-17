// Craftable base structures with one merged mesh each; active meshes stream
// around the player, while compact structure records are persisted by SaveSystem.
export const BUILDINGS = Object.freeze({
    shelter: {name: 'Lean-to shelter', cost: {wood: 6, planks: 2, fiber: 3}},
    fire: {name: 'Campfire', cost: {wood: 3, stone: 3}},
    floor: {name: 'Wooden floor', cost: {planks: 2}},
    wall: {name: 'Log wall', cost: {wood: 4}},
    roof: {name: 'Wooden roof', cost: {planks: 3, fiber: 2}},
    garden: {name: 'Garden bed', cost: {wood: 4, fiber: 2}},
    chest: {name: 'Storage chest', cost: {planks: 4, fiber: 2}}
});

function createModel(scene, type, item, material) {
    const pieces = [];
    const color = {
        wood: [.40,.28,.18], roof: [.31,.37,.24],
        stone: [.42,.43,.40], ember: [.93,.39,.15], ash: [.18,.17,.15], soil: [.24,.17,.11]
    };
    function tint(mesh, shade) {
        const rgb = color[shade], values = [];
        for (let i = 0; i < mesh.getTotalVertices(); i++) values.push(...rgb, 1);
        mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, values);
        pieces.push(mesh);
    }
    function beam(name, x, y, z, w, h, d, shade, tilt = 0) {
        const mesh = BABYLON.MeshBuilder.CreateBox(name, {width:w,height:h,depth:d},scene);
        mesh.position.set(x,y,z); mesh.rotation.x = tilt;
        tint(mesh,shade);
    }
    if (type === 'chest') {
        // A banded box with a slightly proud lid.
        beam('chest-body', 0,.42,0,1.5,.84,.95,'wood');
        beam('chest-lid', 0,.93,0,1.6,.2,1.05,'roof');
        beam('chest-band-left', -.5,.5,0,.12,1.02,1.0,'stone');
        beam('chest-band-right', .5,.5,0,.12,1.02,1.0,'stone');
        beam('chest-latch', 0,.72,.5,.2,.24,.08,'ember');
    }
    if (type === 'garden') {
        // A low timber frame filled with dark soil.
        beam('garden-soil', 0,.16,0,2.5,.2,1.7,'soil');
        beam('garden-front', 0,.2,.9,2.8,.4,.14,'wood');
        beam('garden-back', 0,.2,-.9,2.8,.4,.14,'wood');
        beam('garden-left', -1.33,.2,0,.14,.4,1.8,'wood');
        beam('garden-right', 1.33,.2,0,.14,.4,1.8,'wood');
    }
    if (type === 'shelter') {
        beam('base-platform', 0,.12,0,4,.22,3.3,'wood');
        beam('rear-wall', 0,1.35,-1.5,4,2.65,.18,'wood');
        for (const x of [-1.85,1.85]) {
            beam('support', x,1.4,1.35,.24,2.8,.24,'wood');
            beam('back-support', x,1.65,-1.5,.24,3.3,.24,'wood');
        }
        beam('sloping-roof', 0,2.85,-.05,4.5,.23,4,'roof',-.16);
        beam('sleep-mat', 0,.34,-.5,1.8,.1,1.35,'roof');
    } else if (type === 'floor') {
        beam('modular-floor',0,.13,0,4,.26,4,'wood');
        for(let x of [-1.8,1.8]) beam('foundation-edge',x,.1,0,.25,.36,4,'roof');
    } else if (type === 'wall') {
        for(let i=0;i<5;i++) beam('log-wall',0,.4+i*.55,0,4,.48,.42,'wood');
        for(let x of [-1.8,1.8]) beam('wall-support',x,1.4,0,.2,2.8,.6,'roof');
    } else if (type === 'roof') {
        beam('roof-slab',0,3.15,0,4.5,.25,4.5,'roof');
        for(let x of [-1.8,1.8]) beam('roof-rafter',x,2.97,0,.26,.24,4,'wood');
    } else {
        for (let i=0;i<8;i++) {
            const a=i*Math.PI/4;
            const rock=BABYLON.MeshBuilder.CreateIcoSphere('fire-ring', {radius:.34,subdivisions:1,flat:true},scene);
            rock.position.set(Math.cos(a)*.85,.2,Math.sin(a)*.85);
            tint(rock,'stone');
        }
        for (let i=0;i<3;i++) {
            const log=BABYLON.MeshBuilder.CreateCylinder('firewood',{height:1.35,diameter:.2,tessellation:6},scene);
            log.position.set(0,.25,0);log.rotation.z=Math.PI/2;
            log.rotation.y=i*Math.PI/3;
            tint(log,'wood');
        }
        const coal=BABYLON.MeshBuilder.CreateCylinder('coals',{height:.3,diameter:.7,tessellation:7},scene);
        coal.position.y=.3; tint(coal,'ember');
    }
    const mesh=BABYLON.Mesh.MergeMeshes(pieces,true,true);
    if (!mesh) return null;
    mesh.name='player-' + type + '-' + item.id;
    mesh.position.set(item.x,item.y,item.z);
    mesh.rotation.y=item.rotation;
    mesh.material=material;
    mesh.checkCollisions=!item.ghost && (type==='shelter' || type==='wall');
    mesh.isPickable=false; // Do not block harvesting or targeting behind a structure.
    mesh.receiveShadows=false;
    return mesh;
}

export class BuildingSystem {
    constructor(game) {
        this.game=game;
        this.structures=[];
        this.meshes=new Map();
        this.nextId=1;
        this.maxStructures=120;
        this.lastStreamAt=0;
        this.material=new BABYLON.StandardMaterial('built-structure',game.scene);
        this.material.diffuseColor=BABYLON.Color3.White();
        this.material.specularColor=BABYLON.Color3.Black();
        // Placement preview: a translucent copy that turns red where building is blocked.
        this.ghostMaterial=new BABYLON.StandardMaterial('build-preview',game.scene);
        this.ghostMaterial.diffuseColor=BABYLON.Color3.White();
        this.ghostMaterial.specularColor=BABYLON.Color3.Black();
        this.ghostMaterial.alpha=.55;
        this.ghostMaterial.backFaceCulling=false;
        this.placing=null;
    }

    canAfford(type) {
        const recipe=BUILDINGS[type];
        const inventory=this.game.inventorySystem?.inventory;
        return Boolean(recipe && inventory && Object.entries(recipe.cost)
            .every(([item,needed])=>(inventory[item] || 0)>=needed));
    }

    // Where a structure would go: a few metres ahead, snapped to the build grid.
    target(type = 'shelter', turn = 0) {
        const player=this.game.playerSystem;
        if (player.isDead || player.isFlying) return null;
        const pos=player.camera.position;
        const heading=player.camera.rotation.y;
        const modular=['floor','wall','roof'].includes(type);
        const step=modular?4:2;
        const x=Math.round((pos.x+Math.sin(heading)*6)/step)*step;
        const z=Math.round((pos.z+Math.cos(heading)*6)/step)*step;
        const y=this.game.terrainSystem.getPerlinHeight(x,z);
        return {x,y,z,rotation:Math.round(heading/(Math.PI/4))*(Math.PI/4)+turn*(Math.PI/4)};
    }

    // Why a structure cannot stand at `at`, or '' when the site is good.
    blockedReason(type, at) {
        if (this.game.dungeonSystem?.active) return 'Nothing can be built underground';
        if (!at) return 'Land before building';
        const terrain=this.game.terrainSystem;
        const {x,y,z}=at;
        const modular=['floor','wall','roof'].includes(type);
        if (terrain.isWaterArea(x,z)) return 'Cannot build in water';
        if (!Number.isFinite(y)) return 'Need clear, dry, fairly level ground ahead';
        const heights=[[3,0],[-3,0],[0,3],[0,-3]]
            .map(([dx,dz])=>terrain.getPerlinHeight(x+dx,z+dz));
        if (heights.some(h=>Math.abs(h-y)>1.6)) return 'The ground is too steep here';
        // Modular pieces can share a 4m grid cell with complementary
        // pieces, but never overlap the same type at that location.
        if (this.structures.some(s => {
            const distance=Math.hypot(s.x-x,s.z-z);
            if(!modular || !['floor','wall','roof'].includes(s.type)) return distance<7;
            return distance<1 && s.type===type;
        })) return modular ? 'That piece is already built here' : 'Too close to another structure';
        if (this.game.inventorySystem.harvestableObjects.some(o =>
            o.mesh && Math.hypot(o.mesh.position.x-x,o.mesh.position.z-z)<3)) return 'Clear the trees and rocks first';
        if (this.game.explorationSystem?.isClearing(x,z) && !terrain.isWithinSpawnArea(x,z)) return 'Keep the trail and landmark clear';
        return '';
    }

    candidate(type = 'shelter', turn = 0) {
        const at=this.target(type,turn);
        return at && !this.blockedReason(type,at) ? at : null;
    }

    place(type, turn = 0) {
        if (!BUILDINGS[type] || this.game.playerSystem.isDead || this.structures.length>=this.maxStructures) return false;
        if (!this.canAfford(type)) {
            this.game.uiSystem?.showNotification('Not enough resources to build ' + BUILDINGS[type].name);
            return false;
        }
        const target=this.target(type,turn);
        const blocked=this.blockedReason(type,target);
        if (blocked) {
            this.game.uiSystem?.showNotification(blocked);
            this.game.audio?.play('deny');
            return false;
        }
        const at=target;
        const inv=this.game.inventorySystem.inventory;
        for (const [item,cost] of Object.entries(BUILDINGS[type].cost)) inv[item]-=cost;
        const record={id:this.nextId++,type,...at};
        this.structures.push(record);
        this.createVisible(record);
        this.game.uiSystem?.updateInventoryUI();
        this.game.uiSystem?.showNotification(BUILDINGS[type].name + ' built');
        this.game.audio?.play('build');
        this.game.effects?.burst?.(new BABYLON.Vector3(at.x,at.y+.6,at.z),'wood',16);
        this.game.progression?.record('built');
        this.game.saveSystem?.save();
        return true;
    }

    // --- Placement preview -------------------------------------------------
    beginPlacement(type) {
        if (!BUILDINGS[type]) return false;
        this.cancelPlacement();
        if (!this.canAfford(type)) {
            this.game.uiSystem?.showNotification('Not enough resources to build ' + BUILDINGS[type].name);
            return false;
        }
        const ghost=createModel(this.game.scene,type,{id:'preview',x:0,y:0,z:0,rotation:0,ghost:true},this.ghostMaterial);
        this.placing={type,turn:0,ghost,blocked:''};
        this.updatePlacement();
        return true;
    }

    cancelPlacement() {
        if (!this.placing) return false;
        this.placing.ghost?.dispose(false,false);
        this.placing=null;
        return true;
    }

    rotatePlacement(direction = 1) {
        if (!this.placing) return;
        this.placing.turn=(this.placing.turn+direction+8)%8;
        this.game.audio?.play('place');
    }

    confirmPlacement() {
        const placing=this.placing;
        if (!placing) return false;
        if (!this.place(placing.type,placing.turn)) return false;
        // Keep laying modular pieces while materials last.
        if (['floor','wall','roof'].includes(placing.type) && this.canAfford(placing.type)) this.updatePlacement();
        else this.cancelPlacement();
        return true;
    }

    // Each frame while placing: move the preview and tint it by validity.
    updatePlacement() {
        const placing=this.placing;
        if (!placing) return;
        const at=this.target(placing.type,placing.turn);
        placing.blocked=this.blockedReason(placing.type,at) ||
            (this.canAfford(placing.type) ? '' : 'Not enough resources');
        if (!placing.ghost) return;
        placing.ghost.setEnabled(Boolean(at));
        if (!at) return;
        placing.ghost.position.set(at.x,at.y+.03,at.z);
        placing.ghost.rotation.y=at.rotation;
        const ok=!placing.blocked;
        this.ghostMaterial.emissiveColor.set(ok?.15:.55, ok?.5:.08, ok?.2:.06);
        this.ghostMaterial.diffuseColor.set(ok?.75:1, ok?1:.45, ok?.75:.4);
    }

    createVisible(record) {
        if (this.meshes.has(record.id)) return;
        const mesh=createModel(this.game.scene,record.type,record,this.material);
        if (mesh) this.meshes.set(record.id,mesh);
    }

    isProtected(position) {
        return this.structures.some(item => {
            const radius=item.type==='shelter'?8:item.type==='fire'?5:item.type==='roof'?3:0;
            return radius>0 && Math.hypot(position.x-item.x,position.z-item.z)<=radius;
        });
    }

    // A lean-to or a roofed spot is somewhere to sleep.
    nearBed(position) {
        return this.structures.some(item => {
            const radius=item.type==='shelter'?6:item.type==='roof'?3:0;
            return radius>0 && Math.hypot(position.x-item.x,position.z-item.z)<=radius;
        });
    }

    nearFire(position) {
        return this.structures.some(item => item.type==='fire' &&
            Math.hypot(position.x-item.x,position.z-item.z)<=6);
    }

    update() {
        if (!this.game.playerSystem) return;
        const pos=this.game.playerSystem.camera.position;
        for(const item of this.structures){
            const dist=Math.hypot(pos.x-item.x,pos.z-item.z);
            if(dist<125) this.createVisible(item);
            else if(dist>150 && this.meshes.has(item.id)){
                this.meshes.get(item.id).dispose(false,false);
                this.meshes.delete(item.id);
            }
        }
    }

    restore(records) {
        this.cancelPlacement();
        for(const mesh of this.meshes.values()) mesh.dispose(false,false);
        this.meshes.clear();
        this.structures=[];
        this.nextId=1;
        const seen=new Set();
        for(const item of Array.isArray(records)?records.slice(0,this.maxStructures):[]){
            if(!item || !BUILDINGS[item.type] || !Number.isInteger(item.id) || item.id<1 || seen.has(item.id)) continue;
            if(![item.x,item.y,item.z,item.rotation].every(n=>Number.isFinite(n)&&Math.abs(n)<100000)) continue;
            seen.add(item.id);
            // Re-seat on the ground so saves survive changes to the terrain shape.
            const ground=this.game.terrainSystem?.getPerlinHeight?.(item.x,item.z);
            this.structures.push({id:item.id,type:item.type,x:item.x,y:Number.isFinite(ground)?ground:item.y,z:item.z,rotation:item.rotation});
            this.nextId=Math.max(this.nextId,item.id+1);
        }
        this.update();
    }
}
