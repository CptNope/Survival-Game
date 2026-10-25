import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickAxes, applyTouchLook, applyJoystick, TouchControls } from '../js/components/touch.js';

const camera = () => ({
    speed: .36,
    rotation: {x:0,y:0,z:0},
    cameraDirection: {x:0,y:0,z:0}
});

test('thumbstick clamps diagonals without unnatural speed boost', () => {
    const center = joystickAxes(0,0);
    assert.deepEqual(center,{x:0,y:0});
    assert.deepEqual(joystickAxes(60,0,60),{x:1,y:0});
    assert.deepEqual(joystickAxes(0,-60,60),{x:0,y:-1});
    const diagonal = joystickAxes(200,-200,60);
    assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.y)-1)<1e-9);
    assert.deepEqual(joystickAxes(4,2,60),{x:0,y:0});
});

test('touch camera drag respects pitch limits and ignores invalid events',()=>{
    const c=camera();
    applyTouchLook(c,100,-50);
    assert.ok(c.rotation.y>0);
    assert.ok(c.rotation.x<0);
    applyTouchLook(c,0,-999999);
    assert.equal(c.rotation.x,-1.45);
    applyTouchLook(c,0,999999);
    assert.equal(c.rotation.x,1.45);
    const x=c.rotation.x,y=c.rotation.y;
    applyTouchLook(c,NaN,0);
    assert.equal(c.rotation.x,x);
    assert.equal(c.rotation.y,y);
});

test('joystick moves in camera-heading direction and honors delta time',()=>{
    const c=camera();
    applyJoystick(c,{x:0,y:-1},1);
    assert.ok(Math.abs(c.cameraDirection.z-.36)<1e-9);
    assert.ok(Math.abs(c.cameraDirection.x)<1e-9);
    c.cameraDirection.x=0;c.cameraDirection.z=0;
    c.rotation.y=Math.PI/2;
    applyJoystick(c,{x:0,y:-1},2);
    assert.ok(Math.abs(c.cameraDirection.x-.72)<1e-9);
    assert.ok(Math.abs(c.cameraDirection.z)<1e-9);
    c.cameraDirection.x=0;c.cameraDirection.z=0;
    applyJoystick(c,{x:1,y:0},1);
    assert.ok(Math.abs(c.cameraDirection.z+.36)<1e-9);
    c.cameraDirection.x=0;c.cameraDirection.z=0;
    applyJoystick(c,{x:1,y:1},99);
    assert.ok(Math.abs(c.cameraDirection.z)<=.9+1e-9);
    assert.ok(Math.abs(c.cameraDirection.x)<=.9+1e-9);
});

test('touch movement stops immediately while paused or dead',()=>{
    const c=camera();
    const t=Object.create(TouchControls.prototype);
    t.enabled=true;
    t.axes={x:0,y:-1};
    t.game={
        paused:true,
        playerSystem:{isDead:false,camera:c},
        scene:{getAnimationRatio:()=>1}
    };
    t.update();
    assert.equal(c.cameraDirection.z,0);
    t.game.paused=false;t.game.playerSystem.isDead=true;t.update();
    assert.equal(c.cameraDirection.z,0);
    t.game.playerSystem.isDead=false;t.update();
    assert.ok(c.cameraDirection.z>0);
});

test('pausing resets the stick and all held movement keys',()=>{
    const t=Object.create(TouchControls.prototype),keys={jump:true,sprint:true,descend:true};
    const controls={hidden:false,querySelectorAll:()=>[]};
    let moved='unknown';
    t.enabled=true;t.controls=controls;t.axes={x:1,y:.5};t.movePointer=2;t.lookPointer=3;
    t.knob={style:{set transform(value){moved=value;}}};
    t.game={playerSystem:{keys}};
    t.setPaused(true);
    assert.equal(controls.hidden,true);
    assert.deepEqual(t.axes,{x:0,y:0});
    assert.deepEqual(keys,{jump:false,sprint:false,descend:false});
    assert.equal(moved,'translate(0, 0)');
    t.setPaused(false);
    assert.equal(controls.hidden,false);
});
