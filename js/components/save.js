import { ITEMS } from '../resources.js';

export const SAVE_KEY = 'the-wilds-save-v1';
export const SAVE_VERSION = 1;

const finite = (value, fallback, low = 0, high = 100) =>
    Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

function readPosition(value) {
    if (!value || typeof value !== 'object') return null;
    const x=finite(value.x, NaN,-99999,99999);
    const z=finite(value.z, NaN,-99999,99999);
    const y=finite(value.y, NaN,-1000,9999);
    return [x,y,z].every(Number.isFinite) ? {x,y,z} : null;
}

export class SaveSystem {
    constructor(game, storage = null) {
        this.game=game;
        this.storage=storage;
        this.elapsed=0;
        this.lastSaved=null;
    }

    getStorage() {
        // Storage access can throw in private browsing or restrictive PWA modes.
        try { return this.storage || globalThis.localStorage || null; }
        catch { return null; }
    }

    capture() {
        const g=this.game,p=g.playerSystem,c=g.combatSystem;
        const pos=p.camera.position,rotation=p.camera.rotation;
        const items=g.inventorySystem.inventory;
        return {
            version:SAVE_VERSION,savedAt:Date.now(),
            position:{x:pos.x,y:pos.y,z:pos.z},
            rotation:{x:rotation.x,y:rotation.y,z:rotation.z},
            health:p.health, maxHealth:p.maxHealth,
            inventory:Object.fromEntries(Object.keys(ITEMS).map(key=>[key,items[key] || 0])),
            combat:{level:c.level,experience:c.experience,expToNextLevel:c.expToNextLevel,attackPower:c.attackPower},
            dayCount:g.dayCount,dayTime:g.dayTime,
            hunger:g.survivalSystem.hunger,thirst:g.survivalSystem.thirst,cold:g.survivalSystem.cold,
            discovered:[...g.explorationSystem.discovered].slice(-5000),
            harvestedIds:[...g.terrainSystem.harvestedIds].slice(-20000),
            structures:g.buildSystem.structures.map(({id,type,x,y,z,rotation})=>({id,type,x,y,z,rotation})),
            drops:g.inventorySystem.droppedItems.slice(0,100).map(drop=>({
                itemType:drop.itemType,count:drop.count,
                position:{x:drop.position.x,y:drop.position.y,z:drop.position.z}
            }))
        };
    }

    save() {
        const g=this.game;
        if (!g.playerSystem || g.playerSystem.isDead) return false;
        try {
            const storage=this.getStorage();
            if (!storage) return false;
            storage.setItem(SAVE_KEY,JSON.stringify(this.capture()));
            this.lastSaved=Date.now();
            this.elapsed=0;
            this.game.uiSystem?.setSaveStatus?.('Expedition saved');
            return true;
        } catch (error) {
            console.warn('Save unavailable:',error);
            this.game.uiSystem?.setSaveStatus?.('Unable to save on this device');
            return false;
        }
    }

    load() {
        try {
            const storage=this.getStorage();
            if (!storage) return false;
            const raw=storage.getItem(SAVE_KEY);
            if (!raw) return false;
            const saved=JSON.parse(raw);
            if (!saved || saved.version!==SAVE_VERSION || !readPosition(saved.position)) return false;
            return this.restore(saved);
        } catch (error) {
            console.warn('Could not restore expedition:',error);
            return false;
        }
    }

    restore(saved) {
        const g=this.game,p=g.playerSystem,c=g.combatSystem;
        const position=readPosition(saved.position);
        if (!position || saved.version!==SAVE_VERSION) return false;
        const level=Math.floor(finite(saved.combat?.level,1,1,100));
        const expToNext=Math.floor(finite(saved.combat?.expToNextLevel,100,1,1e8));
        c.level=level;
        c.expToNextLevel=expToNext;
        c.experience=Math.floor(finite(saved.combat?.experience,0,0,expToNext-1));
        c.attackPower=finite(saved.combat?.attackPower,10,1,5000);
        p.maxHealth=finite(saved.maxHealth,100,100,5000);
        p.health=finite(saved.health,p.maxHealth,1,p.maxHealth);
        p.isDead=false; p.lootDropped=false;
        p.oxygenLevel=p.maxOxygen;
        p.jumpVelocity=0;p.isGrounded=true;p.isFlying=false;p.isSwimming=false;
        p.camera.position.x=position.x;p.camera.position.y=position.y;p.camera.position.z=position.z;
        const rot=saved.rotation || {};
        p.camera.rotation.x=finite(rot.x,0,-1.5,1.5);
        p.camera.rotation.y=finite(rot.y,0,-Math.PI*1000,Math.PI*1000);
        p.camera.rotation.z=0;

        const inventory=g.inventorySystem.inventory;
        for (const key of Object.keys(ITEMS))
            inventory[key]=Math.floor(finite(saved.inventory?.[key],0,0,9999));
        g.dayCount=Math.floor(finite(saved.dayCount,1,1,999999));
        g.dayTime=finite(saved.dayTime,60,0,g.dayLength-0.001);
        g.survivalSystem.hunger=finite(saved.hunger,100);
        g.survivalSystem.thirst=finite(saved.thirst,100);
        g.survivalSystem.cold=finite(saved.cold,0);
        g.explorationSystem.discovered=new Set((Array.isArray(saved.discovered)?saved.discovered:[])
            .filter(id=>typeof id==='string' && id.length<128).slice(0,5000));
        g.terrainSystem.harvestedIds=new Set((Array.isArray(saved.harvestedIds)?saved.harvestedIds:[])
            .filter(id=>typeof id==='string' && id.length<128).slice(0,20000));

        // Initial chunks are generated before load; remove the previously
        // harvested meshes so restored depletion agrees with the saved world.
        for(const [key,chunk] of g.terrainSystem.chunkMap) {
            for(const obj of chunk.objects || []) {
                if (!g.terrainSystem.harvestedIds.has(obj.resourceId)) continue;
                obj.mesh.dispose(false,true);
                const index=g.inventorySystem.harvestableObjects.indexOf(obj);
                if(index>=0) g.inventorySystem.harvestableObjects.splice(index,1);
            }
            chunk.objects=chunk.objects?.filter(obj=>!g.terrainSystem.harvestedIds.has(obj.resourceId)) || [];
        }
        g.buildSystem.restore(saved.structures);

        // Loot is restored only from saved state, not recomputed from inventory.
        for(const drop of g.inventorySystem.droppedItems) drop.mesh.dispose(false,true);
        g.inventorySystem.droppedItems=[];
        for(const item of (Array.isArray(saved.drops)?saved.drops:[]).slice(0,100)) {
            const at=readPosition(item?.position);
            if(!at || !Object.hasOwn(ITEMS,item.itemType)) continue;
            const count=Math.floor(finite(item.count,0,0,9999));
            if(count>0) g.inventorySystem.createLootBag(at,item.itemType,count);
        }

        g.terrainSystem.checkChunkUpdates();
        g.uiSystem?.updateInventoryUI();
        g.uiSystem?.updateExperienceUI();
        g.uiSystem?.setSaveStatus?.('Expedition restored');
        return true;
    }

    update(dt) {
        if (this.game.paused) return;
        this.elapsed+=Math.max(0,Math.min(.1,dt));
        if(this.elapsed>=30) this.save();
    }
}
