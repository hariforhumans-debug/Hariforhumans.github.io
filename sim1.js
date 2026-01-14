// --- 0. UI INJECTION (Menu & Game Over) ---
const uiHTML = `
<style>
    /* Layout Overlays */
    .game-ui-overlay {
        position: absolute;
        top: 0; left: 0;
        width: 800px; height: 600px;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        z-index: 100;
        background: rgba(0,0,0,0.8);
        font-family: 'Segoe UI', sans-serif;
    }
    .hidden { display: none !important; }

    /* Neon Button Styling */
    :root {
        --neon-glow-color: #FFFFFF;
        --button-bg-color: #0d0d0d;
    }

    .neon-button {
        background: var(--button-bg-color);
        color: var(--neon-glow-color);
        border: 2px solid var(--neon-glow-color);
        padding: 15px 40px;
        font-size: 1.2rem;
        text-transform: uppercase;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        border-radius: 5px;
        transition: all 0.3s ease-in-out;
        box-shadow: 0 0 10px rgba(255, 255, 255, 0.5), 
                    0 0 20px rgba(255, 255, 255, 0.3), 
                    0 0 40px rgba(255, 255, 255, 0.1);
        letter-spacing: 2px;
    }

    .neon-button:hover {
        background: var(--neon-glow-color);
        color: var(--button-bg-color);
        box-shadow: 0 0 10px var(--neon-glow-color),
                    0 0 30px var(--neon-glow-color),
                    0 0 60px var(--neon-glow-color);
        transform: scale(1.05);
    }

    h1 {
        color: white;
        text-shadow: 0 0 10px rgba(255,255,255,0.8);
        margin-bottom: 20px;
    }
</style>

<div id="menu-screen" class="game-ui-overlay">
    <h1>MY RPG ADVENTURE</h1>
    <button id="start-btn" class="neon-button">START GAME</button>
</div>

<div id="death-screen" class="game-ui-overlay hidden">
    <h1 style="color: #ff4444; text-shadow: 0 0 10px red;">GAME OVER</h1>
    <button id="retry-btn" class="neon-button">TRY AGAIN</button>
</div>
`;

document.body.insertAdjacentHTML('beforeend', uiHTML);

const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");

// --- 1. ASSETS ---
const SPRITE_DATA = {
    player: 'player.png', grass: 'grass.png', floor: 'floor_tile.png',
    tree: 'tree.png', house: 'building.png', enemy: 'enemy.png',
    sword: 'sword.png', chest: 'chest.png', chest_open: 'open_chest.png',
    boss: 'boss.png', mana_potion: 'mana_potion.png'
};

const images = {};
const sounds = {
    swing: new Audio('sword.mp3'),
    fireball: new Audio('fire.mp3'),
    pickup: new Audio('item.mp3'),
    bgm: new Audio('undertale.mp3')
};
sounds.bgm.loop = true;

let loadedImages = 0;
const totalImages = Object.keys(SPRITE_DATA).length;

function preload() {
    for (let key in SPRITE_DATA) {
        const img = new Image();
        img.src = SPRITE_DATA[key];
        img.onload = () => {
            try { images[key] = removeWhite(img); } catch (e) { images[key] = img; }
            if (++loadedImages === totalImages) requestAnimationFrame(mainLoop);
        };
        img.onerror = () => {
            const err = document.createElement('canvas');
            err.width = 64; err.height = 64;
            const eCtx = err.getContext('2d');
            eCtx.fillStyle = "magenta"; eCtx.fillRect(0,0,64,64);
            images[key] = err;
            if (++loadedImages === totalImages) requestAnimationFrame(mainLoop);
        };
    }
}

function removeWhite(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const t = c.getContext('2d');
    t.drawImage(img, 0, 0);
    const d = t.getImageData(0,0,c.width,c.height);
    for (let i=0; i<d.data.length; i+=4) {
        if (d.data[i] > 240 && d.data[i+1] > 240 && d.data[i+2] > 240) d.data[i+3] = 0;
    }
    t.putImageData(d, 0, 0);
    const n = new Image(); n.src = c.toDataURL();
    return n;
}

// --- 2. STATE ---
let cameraX = 0, cameraY = 0, savedWorldX = 0, savedWorldY = 0;
let mouseX = 0, mouseY = 0;
let gameState = "menu";
let combatMode = "sword"; 
let hasMagic = false;
let killCount = 0;
let bossSpawned = false;

const BASE_SPEED = 0.3; 
const keys = {};
const worldObjects = new Map();
let enemies = [], fireballs = [], particles = [];

let lastTime = 0, spawnTimer = 0;
let player = { hp: 100, maxHp: 100, mana: 100, maxMana: 100, invuln: 0 };
let isSwinging = false, swingProgress = 0, swingAngle = 0;
let chest = { x: 400, y: 350, w: 60, h: 60, isOpen: false };

// --- 3. INPUTS & BUTTONS ---
document.getElementById("start-btn").onclick = () => {
    gameState = "overworld";
    document.getElementById("menu-screen").classList.add("hidden");
    sounds.bgm.play().catch(()=>{});
};

document.getElementById("retry-btn").onclick = () => location.reload();

window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'r') combatMode = (combatMode === "sword") ? "magic" : "sword";
});
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

canvas.onmousedown = (e) => {
    if (gameState === "menu" || player.hp <= 0) return;
    if (e.button === 0) {
        if (combatMode === "sword" && !isSwinging) {
            isSwinging = true; swingProgress = 0;
            sounds.swing.currentTime = 0; sounds.swing.play().catch(()=>{}); 
        } else if (combatMode === "magic" && hasMagic && player.mana >= 20) {
            shootFireball();
            sounds.fireball.currentTime = 0; sounds.fireball.play().catch(()=>{});
        }
    }
};

function shootFireball() {
    player.mana -= 20;
    const ang = Math.atan2(mouseY - canvas.height/2, mouseX - canvas.width/2);
    fireballs.push({ x: cameraX, y: cameraY, vx: Math.cos(ang)*0.6, vy: Math.sin(ang)*0.6, life: 1500 });
}

function createDeathEffect(x, y) {
    for(let i=0; i<8; i++) particles.push({ x, y, vx: (Math.random()-0.5)*0.5, vy: (Math.random()-0.5)*0.5, life: 500 });
    sounds.pickup.currentTime = 0; sounds.pickup.play().catch(()=>{});
}

// --- 4. WORLD GEN ---
function getCell(gx, gy) {
    const id = `${gx},${gy}`;
    if (worldObjects.has(id)) return worldObjects.get(id);
    const seed = Math.abs(Math.sin(gx * 12.98 + gy * 78.23) * 43758) % 1;
    let obj = null;
    if (seed < 0.05) obj = { type: 'house', w: 160, h: 160, z: gy * 200 + 150 };
    else if (seed < 0.25) obj = { type: 'tree', w: 80, h: 80, z: gy * 200 + 70 };
    if (obj) { obj.x = gx * 200; obj.y = gy * 200; worldObjects.set(id, obj); }
    return obj;
}

// --- 5. MAIN LOOP ---
function mainLoop(timestamp) {
    const deltaTime = timestamp - lastTime || 0;
    lastTime = timestamp;
    if (gameState === "menu") { requestAnimationFrame(mainLoop); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // --- BOSS SPAWN LOGIC ---
    if (killCount >= 5 && !bossSpawned) {
        enemies.push({ x: cameraX + 300, y: cameraY - 300, hp: 30, maxHp: 30, type: 'boss', speed: 0.05, w: 128, h: 128 });
        bossSpawned = true;
    }

    // Movement
    let moveX = 0, moveY = 0;
    if (keys["w"]) moveY -= 1; if (keys["s"]) moveY += 1;
    if (keys["a"]) moveX -= 1; if (keys["d"]) moveX += 1;
    let nextX = cameraX + (moveX ? (moveX / Math.hypot(moveX, moveY)) * BASE_SPEED * deltaTime : 0);
    let nextY = cameraY + (moveY ? (moveY / Math.hypot(moveX, moveY)) * BASE_SPEED * deltaTime : 0);

    if (gameState === "overworld") {
        cameraX = nextX; cameraY = nextY;
        const curGX = Math.floor(cameraX/200), curGY = Math.floor(cameraY/200);
        const o = getCell(curGX, curGY);
        if (o && o.type === 'house' && Math.hypot(cameraX-(o.x+80), cameraY-(o.y+145)) < 30) {
            savedWorldX = cameraX; savedWorldY = cameraY + 40; gameState = "interior"; cameraX = 400; cameraY = 500;
        }
    } else if (gameState === "interior") {
        if (nextX > 250 && nextX < 550) cameraX = nextX;
        if (nextY > 250 && nextY < 550) cameraY = nextY;
        if (cameraY > 540) { gameState = "overworld"; cameraX = savedWorldX; cameraY = savedWorldY; }
        if (keys["e"] && Math.hypot(cameraX-chest.x, cameraY-chest.y) < 60 && !chest.isOpen) {
            chest.isOpen = true; hasMagic = true; player.hp = player.maxHp; 
            sounds.pickup.play().catch(()=>{});
        }
    }

    // Combat Updates
    if (isSwinging) {
        swingProgress += 0.01 * deltaTime;
        const ang = Math.atan2(mouseY - canvas.height/2, mouseX - canvas.width/2);
        swingAngle = (ang - 1.5) + (swingProgress * Math.PI);
        enemies.forEach(en => {
            if (Math.hypot(en.x-cameraX, en.y-cameraY) < 100 && !en.isHit) {
                en.hp -= 1; en.isHit = true; 
                if(en.hp <= 0) { createDeathEffect(en.x, en.y); killCount++; }
            }
        });
        if (swingProgress >= 1) { isSwinging = false; enemies.forEach(e => e.isHit = false); }
    }

    fireballs.forEach((fb, i) => {
        fb.x += fb.vx * deltaTime; fb.y += fb.vy * deltaTime; fb.life -= deltaTime;
        enemies.forEach(en => {
            if (Math.hypot(fb.x-en.x, fb.y-en.y) < 60) { 
                en.hp -= 2; fb.life = 0; 
                if(en.hp <= 0) { createDeathEffect(en.x, en.y); killCount++; }
            }
        });
        if (fb.life <= 0) fireballs.splice(i, 1);
    });

    if (gameState === "overworld") {
        spawnTimer += deltaTime;
        if (spawnTimer > 4000) {
            enemies.push({ x: cameraX+400, y: cameraY+400, hp: 3, maxHp: 3, type: 'enemy', speed: 0.08, w:64, h:64 });
            spawnTimer = 0;
        }
    }

    enemies.forEach(en => {
        const d = Math.hypot(cameraX-en.x, cameraY-en.y);
        if (d > 20) { en.x += ((cameraX-en.x)/d)*en.speed*deltaTime; en.y += ((cameraY-en.y)/d)*en.speed*deltaTime; }
        if (d < 40 && player.invuln <= 0) { player.hp -= 15; player.invuln = 1000; }
    });
    enemies = enemies.filter(e => e.hp > 0);
    if (player.invuln > 0) player.invuln -= deltaTime;

    // --- DRAWING ---
    const bg = (gameState === "overworld") ? images.grass : images.floor;
    for (let x=-64; x<canvas.width+64; x+=64) for (let y=-64; y<canvas.height+64; y+=64) {
        ctx.drawImage(bg, x-(cameraX%64), y-(cameraY%64), 64, 64);
    }

    let renderList = [];
    if (gameState === "overworld") {
        const cgX = Math.floor(cameraX/200), cgY = Math.floor(cameraY/200);
        for(let x=cgX-4; x<=cgX+4; x++) for(let y=cgY-4; y<=cgY+4; y++) {
            const o = getCell(x,y); if(o) renderList.push(o);
        }
    } else {
        renderList.push({type: chest.isOpen?'chest_open':'chest', x:chest.x-30, y:chest.y-30, w:60, h:60, z:chest.y});
    }
    enemies.forEach(e => renderList.push({type:e.type, x:e.x-(e.w/2), y:e.y-(e.h/2), w:e.w, h:e.h, z:e.y, hp:e.hp, maxHp:e.maxHp}));
    renderList.push({type:'player', x:cameraX-32, y:cameraY-32, w:64, h:64, z:cameraY});
    
    renderList.sort((a,b)=>a.z-b.z).forEach(o => {
        const sx = o.x-cameraX+canvas.width/2, sy = o.y-cameraY+canvas.height/2;
        ctx.drawImage(images[o.type], sx, sy, o.w, o.h);
        if (o.hp) {
            ctx.fillStyle="black"; ctx.fillRect(sx, sy-10, o.w, 5);
            ctx.fillStyle=(o.type==='boss')?"#9b59b6":"lime"; ctx.fillRect(sx, sy-10, (o.hp/o.maxHp)*o.w, 5);
        }
    });

    if (isSwinging && combatMode === "sword") {
        ctx.save(); ctx.translate(canvas.width/2, canvas.height/2); ctx.rotate(swingAngle + Math.PI/2);
        ctx.drawImage(images.sword, -10, -80, 20, 80); ctx.restore();
    }

    // UI Overlay (HP/Mana)
    ctx.fillStyle="red"; ctx.fillRect(10, 10, player.hp*2, 15);
    ctx.fillStyle="#00a2ff"; ctx.fillRect(10, 30, player.mana*2, 10);
    ctx.fillStyle="white"; ctx.font = "16px Arial";
    ctx.fillText(`KILLS: ${killCount}`, 10, 60);

    if (player.hp <= 0) { 
        sounds.bgm.pause();
        document.getElementById("death-screen").classList.remove("hidden");
        return; 
    }
    requestAnimationFrame(mainLoop);
}
preload();