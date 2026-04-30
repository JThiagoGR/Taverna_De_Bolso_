const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const rooms = {};

const mapsDir = path.join(__dirname, 'public', 'maps');
if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });
app.use(express.static('public'));
const upload = multer({ dest: mapsDir, limits: { fileSize: 15 * 1024 * 1024 } });

const clean = s => String(s || 'taverna').replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'taverna';
const getRoom = n => { const k = clean(n); if (!rooms[k]) rooms[k] = { tokens: [], map: null, walls: [], players: {} }; return rooms[k]; };

app.get('/health', (req, res) => res.send('ok'));

app.post('/upload', upload.single('file'), (req, res) => {
  const r = getRoom(req.body.room);
  r.map = { src: '/maps/' + req.file.filename, w: +req.body.w || 1400, h: +req.body.h || 900 };
  io.to(clean(req.body.room)).emit('map', r.map);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Taverna de Bolso</title>
<script src="/socket.io/socket.io.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@3d-dice/dice-box@1.0.15/dist/dice-box.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui}body{background:#080810;color:#fff;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
#login{position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(ellipse at top,#1a1a2e 0%,#080810 70%);z-index:1000}
.card{background:#141420ee;border:1px solid #2a2a40;border-radius:24px;padding:32px;width:92%;max-width:360px;text-align:center}
h1{color:#ffb300;font-size:30px;margin:10px 0 4px;text-shadow:0 0 20px #ffb30055}.sub{opacity:.65;font-size:14px;margin-bottom:24px}
input{width:100%;background:#0a0a14;border:1px solid #333;padding:15px;border-radius:14px;color:#fff;font-size:16px;margin:7px 0}
.btn{width:100%;padding:15px;border:0;border-radius:14px;font-size:17px;font-weight:700;margin:8px 0;cursor:pointer}
.btn-m{background:linear-gradient(135deg,#d32f2f,#b71c1c);color:#fff}.btn-j{background:linear-gradient(135deg,#388e3c,#1b5e20);color:#fff}
#app{display:none;height:100vh}
#top{height:54px;background:#141420ee;border-bottom:1px solid #2a2a40;display:flex;align-items:center;gap:6px;padding:0 8px}
#top button{background:#0a0a14;border:1px solid #333;color:#fff;padding:9px 12px;border-radius:10px;font-size:15px}
#top button.on{background:#ffb300;color:#000;border-color:#ffb300}
#cv{width:100vw;height:calc(100vh - 54px);display:block;background:#000;touch-action:none}
#chat{position:fixed;right:8px;top:62px;width:220px;max-height:250px;background:#000d;border:1px solid #333;border-radius:12px;padding:8px;font-size:13px;overflow:auto;z-index:10}
#chat div{margin:5px 0;padding:5px;border-bottom:1px solid #222;line-height:1.4}
#sheet{position:fixed;inset:54px 0 0 0;background:#0c0c14f5;padding:16px;overflow:auto;display:none;z-index:50}
.sheet-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.sheet-h h2{color:#ffb300}.x{width:38px;height:38px;border-radius:50%;background:#222;border:0;color:#fff;font-size:24px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.attr{background:#141420;border:1px solid #2a2a40;border-radius:14px;padding:11px;text-align:center}
.attr input{width:100%;background:transparent;border:0;color:#fff;text-align:center;font-size:22px;font-weight:700}
.attr button{width:100%;margin-top:7px;padding:7px;background:#1f1f2e;border:0;color:#ffb300;border-radius:9px}
.field{background:#141420;border:1px solid #2a2a40;color:#fff;padding:12px;border-radius:12px;width:100%;margin:7px 0}
textarea.field{min-height:75px;resize:vertical}
.save{width:100%;padding:15px;background:linear-gradient(135deg,#388e3c,#2e7d32);border:0;color:#fff;border-radius:14px;font-weight:700;margin-top:12px}
#dice{position:fixed;inset:0;background:#000;display:none;z-index:200}
#dices{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#141420f0;border:1px solid #2a2a40;padding:14px;border-radius:18px;display:none;z-index:201;gap:7px;flex-wrap:wrap;max-width:96vw;justify-content:center}
#dices button{min-width:56px;min-height:56px;background:#0a0a14;border:1px solid #444;color:#fff;border-radius:13px;font-size:17px;font-weight:600}
.modbox{width:100%;display:flex;gap:8px;margin-bottom:10px;justify-content:center;align-items:center}
.modbox input{width:80px;background:#0a0a14;border:1px solid #444;color:#fff;padding:11px;border-radius:11px;text-align:center;font-size:17px;font-weight:600}
.modbox button{width:44px;height:44px;font-size:20px}
@media(min-width:900px){#sheet{left:auto;right:20px;top:70px;width:400px;bottom:auto;max-height:88vh;border-radius:20px;border:1px solid #2a2a40}}
</style>
</head>
<body>
<div id="login">
  <div class="card">
    <div style="font-size:52px">ðŸº</div>
    <h1>TAVERNA DE BOLSO</h1>
    <div class="sub">RPG de mesa no seu bolso</div>
    <input id="room" placeholder="Nome da taverna" value="taverna" maxlength="20">
    <input id="name" placeholder="Seu nome" maxlength="16">
    <button class="btn btn-m" onclick="enter(1)">ðŸ‘‘ MESTRE</button>
    <button class="btn btn-j" onclick="enter(0)">ðŸŽ² JOGADOR</button>
  </div>
</div>

<div id="app">
  <div id="top">
    <button id="tm" class="on" onclick="setTool('move')">âœ‹</button>
    <button id="tw" onclick="setTool('wall')">ðŸ§±</button>
    <button onclick="addNpc()">+NPC</button>
    <button onclick="toggleSheet()">ðŸ“œ</button>
    <button onclick="openDice()">ðŸŽ²</button>
    <button id="mapbtn" onclick="document.getElementById('mapfile').click()" style="display:none">ðŸ—ºï¸</button>
    <span id="info" style="margin-left:auto;font-size:13px;opacity:.75"></span>
    <input type="file" id="mapfile" accept="image/*" hidden>
  </div>
  <canvas id="cv"></canvas>
  <div id="chat"></div>
</div>

<div id="sheet">
  <div class="sheet-h"><h2>Ficha</h2><button class="x" onclick="toggleSheet()">Ã—</button></div>
  <input id="fn" class="field" placeholder="Nome">
  <div class="grid3">
    <input id="fca" class="field" type="number" placeholder="CA">
    <input id="fhp" class="field" type="number" placeholder="PV">
    <input id="fhm" class="field" type="number" placeholder="PV Max">
  </div>
  <div class="grid3">
    <div class="attr">FOR<input id="a0" type="number" value="10"><button onclick="rollAttr(0)">d20</button></div>
    <div class="attr">DES<input id="a1" type="number" value="10"><button onclick="rollAttr(1)">d20</button></div>
    <div class="attr">CON<input id="a2" type="number" value="10"><button onclick="rollAttr(2)">d20</button></div>
    <div class="attr">INT<input id="a3" type="number" value="10"><button onclick="rollAttr(3)">d20</button></div>
    <div class="attr">SAB<input id="a4" type="number" value="10"><button onclick="rollAttr(4)">d20</button></div>
    <div class="attr">CAR<input id="a5" type="number" value="10"><button onclick="rollAttr(5)">d20</button></div>
  </div>
  <textarea id="fatk" class="field" placeholder="Ataques..."></textarea>
  <textarea id="finv" class="field" placeholder="InventÃ¡rio..."></textarea>
  <button class="save" onclick="saveSheet()">ðŸ’¾ Salvar</button>
</div>

<div id="dice"></div>
<div id="dices">
  <div class="modbox">
    <button onclick="chgMod(-1)">âˆ’</button>
    <input id="mod" type="number" value="0" inputmode="numeric">
    <button onclick="chgMod(1)">+</button>
    <span style="opacity:.6;font-size:13px">MOD</span>
  </div>
  <button onclick="roll('1d4')">d4</button><button onclick="roll('1d6')">d6</button><button onclick="roll('1d8')">d8</button>
  <button onclick="roll('1d10')">d10</button><button onclick="roll('1d12')">d12</button><button onclick="roll('1d20')">d20</button>
  <button onclick="roll('1d100')">d100</button><button onclick="roll('2d20kh1')" style="background:#1b3d1f">ADV</button>
  <button onclick="roll('2d20kl1')" style="background:#3d1b1b">DIS</button><button onclick="closeDice()">âœ•</button>
</div>

<script>
const socket=io(),cv=document.getElementById('cv'),ctx=cv.getContext('2d');
let state={tokens:[],map:null,walls:[]}, me={id:0,master:false,name:'',room:''};
let sel=null, drag=null, pan=null, ox=0, oy=0, zoom=1, tool='move', diceBox=null;
let sx=0, sy=0, st=0, moved=false, longPress=false, timer=null, moveThrottle=null;
const $=id=>document.getElementById(id);

const log=t=>{
  const c=$('chat');
  const div=document.createElement('div');
  div.innerHTML=t;
  c.appendChild(div);
  c.scrollTop=c.scrollHeight;
};

function resize(){cv.width=innerWidth;cv.height=innerHeight-54}

let renderLoop=null;
function startRender(){
  if(renderLoop)return;
  function frame(){
    draw();
    renderLoop=requestAnimationFrame(frame);
  }
  frame();
}

addEventListener('resize',resize);

function enter(isMaster){
  me.master=isMaster; me.room=$('room').value.trim()||'taverna'; me.name=$('name').value.trim()||(isMaster?'Mestre':'Aventureiro');
  $('login').style.display='none'; $('app').style.display='block';
  $('info').textContent=me.room+' â€¢ '+me.name;
  if(isMaster) $('mapbtn').style.display='block';
  socket.emit('join',{room:me.room,master:isMaster,name:me.name});
  resize();
  startRender();
  log('<span style="color:#4caf50">ðŸº Bem-vindo Ã  taverna!</span>');
}

function world(x,y){const r=cv.getBoundingClientRect();return{x:(x-r.left-ox)/zoom,y:(y-r.top-oy)/zoom}}

function draw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.save(); ctx.translate(ox,oy); ctx.scale(zoom,zoom);
  if(state.map){const img=new Image();img.src=state.map.src;if(img.complete)ctx.drawImage(img,0,0,state.map.w,state.map.h)}
  ctx.strokeStyle='#ff3b3b'; ctx.lineWidth=4/zoom; ctx.lineCap='round';
  state.walls.forEach(w=>{ctx.beginPath();ctx.moveTo(w.x1,w.y1);ctx.lineTo(w.x2,w.y2);ctx.stroke()});
  const my=state.tokens.find(t=>t.owner===me.id);
  state.tokens.forEach(t=>{
    if(!t||!t.x||!t.y)return;
    if(!me.master&&my){const d=Math.hypot(t.x-my.x,t.y-my.y);if(t.owner!==me.id&&d>220)return}
    ctx.fillStyle=t.color||'#4a90e2'; ctx.beginPath(); ctx.arc(t.x,t.y,24,0,7); ctx.fill();
    ctx.lineWidth=sel?.id===t.id?5:3; ctx.strokeStyle=sel?.id===t.id?'#ffb300':'#000'; ctx.stroke();
    const hp=(t.hp||0)/(t.maxHp||1); ctx.fillStyle='#000c'; ctx.fillRect(t.x-25,t.y+29,50,7); ctx.fillStyle=hp>.6?'#4caf50':hp>.3?'#ff9800':'#f44336'; ctx.fillRect(t.x-25,t.y+29,50*hp,7);
    ctx.fillStyle='#fff'; ctx.font='bold 14px system-ui'; ctx.textAlign='center'; ctx.strokeStyle='#000'; ctx.lineWidth=4; ctx.strokeText(t.name||'?',t.x,t.y-33); ctx.fillText(t.name||'?',t.x,t.y-33);
  });
  ctx.restore();
  if(!me.master&&my){
    ctx.save(); ctx.fillStyle='rgba(0,0,0,0.92)'; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.globalCompositeOperation='destination-out'; ctx.beginPath();
    ctx.arc(my.x*zoom+ox,my.y*zoom+oy,240*zoom,0,7); ctx.fill(); ctx.restore();
  }
}

function setTool(t){tool=t;$('tm').classList.toggle('on',t==='move');$('tw').classList.toggle('on',t==='wall')}

function addNpc(){
  if(!me.master) return alert('SÃ³ o mestre cria NPC');
  const names=['Goblin','Orc','Esqueleto','Lobo','Bandido'];
  const n={
    id:'npc_'+Date.now(),
    x:400+Math.random()*200,
    y:300+Math.random()*150,
    name:names[Math.floor(Math.random()*names.length)],
    owner:0,
    color:'#'+Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),
    hp:12,maxHp:15,ca:13,attr:[13,12,12,8,10,8]
  };
  socket.emit('token',n);
  log('<span style="color:#ff9800">ðŸ‘¹ NPC '+n.name+' criado</span>');
}

function toggleSheet(){const s=$('sheet');const o=s.style.display!=='block';s.style.display=o?'block':'none';if(o&&sel){$('fn').value=sel.name||'';$('fca').value=sel.ca||10;$('fhp').value=sel.hp||10;$('fhm').value=sel.maxHp||10;const a=sel.attr||[10,10,10,10];for(let i=0;i<6;i++)$('a'+i).value=a[i];$('fatk').value=sel.atk||'';$('finv').value=sel.inv||''}}
function saveSheet(){if(!sel)return;if(!me.master&&sel.owner!==me.id)return alert('Apenas seu personagem!');sel.name=$('fn').value;sel.ca=+$('fca').value;sel.hp=+$('fhp').value;sel.maxHp=+$('fhm').value;sel.attr=[0,1,2,3,4,5].map(i=>+$('a'+i).value);sel.atk=$('fatk').value;sel.inv=$('finv').value;socket.emit('token',sel);toggleSheet()}

async function openDice(){$('dice').style.display='block';$('dices').style.display='flex';$('dice').style.background='#000';if(!diceBox){diceBox=new DiceBox('#dice',{assetPath:'https://cdn.jsdelivr.net/npm/@3d-dice/dice-box@1.0.15/dist/assets/',scale:innerWidth<700?5.5:7.5,themeColor:'#ffb300',spinForce:5,throwForce:5});await diceBox.init()}}
function closeDice(){$('dice').style.display='none';$('dices').style.display='none'}
function chgMod(d){$('mod').value=parseInt($('mod').value||0)+d}
function playSound(f1,f2,d){try{const c=new(window.AudioContext||webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.type='square';o.frequency.setValueAtTime(f1,c.currentTime);o.frequency.exponentialRampToValueAtTime(f2,c.currentTime+d);g.gain.setValueAtTime(0.12,c.currentTime);g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+d);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+d)}catch(e){}}

async function roll(notation){
  await openDice();
  playSound(700,250,0.16);
  const mod=parseInt($('mod').value||0);
  const m=notation.match(/(\d+)d(\d+)(kh1|kl1)?/);
  if(!m){log('<span style="color:#f44">âŒ Erro no dado</span>');return;}
  try{
    const res=await diceBox.roll(\`\${notation}\`);
    let vals=res.map(r=>r.value);
    let base=vals.reduce((a,b)=>a+b,0);
    let shown=base;
    if(notation.includes('kh1'))shown=Math.max(...vals);
    if(notation.includes('kl1'))shown=Math.min(...vals);
    const total=shown+mod;
    const is20=notation.includes('d20');
    const checkVal=is20?(notation.includes('k')?shown:vals[0]):0;
    const crit=is20&&checkVal===20;
    const fail=is20&&checkVal===1;
    const el=$('dice');
    if(crit){el.style.background='radial-gradient(circle at center, rgba(255,215,0,0.6) 0%, rgba(0,0,0,0.95) 65%)';playSound(1200,1800,0.35)}
    else if(fail){el.style.background='radial-gradient(circle at center, rgba(255,30,30,0.6) 0%, rgba(0,0,0,0.95) 65%)';playSound(300,80,0.4)}
    let txt=\`<b>\${me.name}</b>: ðŸŽ² \${notation}\`;
    if(vals.length>1)txt+=\` [\${vals.join(',')}]\`;
    if(notation.includes('k'))txt+=\` â†’ <b>\${shown}</b>\`;
    if(mod)txt+=\` \${mod>0?'+':''}\${mod} = <b>\${total}</b>\`;
    if(crit)txt+=' <span style="color:gold;font-weight:700">âœ¨ CRÃTICO!</span>';
    if(fail)txt+=' <span style="color:#f44;font-weight:700">ðŸ’€ FALHA!</span>';
    log(txt);
    socket.emit('roll',txt);
    alert(\`Resultado: \${notation} = \${total}\`);
  }catch(e){console.error(e);log('<span style="color:#f44">âŒ Erro ao rolar</span>')}
  setTimeout(closeDice,2500);
}

function rollAttr(i){const v=+$('a'+i).value||10;const m=Math.floor((v-10)/2);$('mod').value=m;roll('1d20')}

$('mapfile').onchange=async e=>{const f=e.target.files[0];if(!f||!me.master)return;const fd=new FormData();fd.append('file',f);fd.append('room',me.room);fd.append('w',1600);await fetch('/upload',{method:'POST',body:fd})}

function start(x,y){sx=x;sy=y;st=Date.now();moved=false;longPress=false;const p=world(x,y);const hit=state.tokens.find(t=>Math.hypot(t.x-p.x,t.y-p.y)<28&&(me.master||t.owner===me.id));clearTimeout(timer);timer=setTimeout(()=>{longPress=true;if(hit&&tool==='move'){drag=hit;sel=hit}},190);return{hit}}

function move(x,y){
  if(Math.hypot(x-sx,y-sy)>7)moved=true;
  const p=world(x,y);
  if(drag){
    drag.x=p.x;
    drag.y=p.y;
    if(!moveThrottle){
      moveThrottle=setTimeout(()=>{
        socket.emit('token',{id:drag.id,x:drag.x,y:drag.y,name:drag.name,owner:drag.owner,color:drag.color,hp:drag.hp,maxHp:drag.maxHp,ca:drag.ca});
        moveThrottle=null;
      },33);
    }
  }else if(pan){
    ox=x-pan.x;
    oy=y-pan.y;
  }
}

function end(x,y,hit){
  clearTimeout(timer);
  const dt=Date.now()-st;
  const d=Math.hypot(x-sx,y-sy);
  if(drag){
    socket.emit('token',{id:drag.id,x:drag.x,y:drag.y,name:drag.name,owner:drag.owner,color:drag.color,hp:drag.hp,maxHp:drag.maxHp,ca:drag.ca});
    clearTimeout(moveThrottle);
    moveThrottle=null;
  }
  if(!moved&&d<12&&dt<320&&!longPress&&hit&&tool==='move'){sel=hit;toggleSheet()}
  if(tool==='wall'&&me.master&&sx){const p=world(x,y);const s=world(sx,sy);state.walls.push({x1:s.x,y1:s.y,x2:p.x,y2:p.y});socket.emit('walls',state.walls)}
  drag=null;pan=null;
}

cv.addEventListener('mousedown',e=>{const {hit}=start(e.clientX,e.clientY);if(!hit&&tool==='move')pan={x:e.clientX-ox,y:e.clientY-oy}});
cv.addEventListener('mousemove',e=>move(e.clientX,e.clientY));
window.addEventListener('mouseup',e=>{const p=world(e.clientX,e.clientY);const h=state.tokens.find(t=>Math.hypot(t.x-p.x,t.y-p.y)<28);end(e.clientX,e.clientY,h)});
cv.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];const {hit}=start(t.clientX,t.clientY);if(!hit&&tool==='move')pan={x:t.clientX-ox,y:t.clientY-oy}},{passive:false});
cv.addEventListener('touchmove',e=>{e.preventDefault();const t=e.touches[0];move(t.clientX,t.clientY)},{passive:false});
cv.addEventListener('touchend',e=>{e.preventDefault();const t=e.changedTouches[0];const p=world(t.clientX,t.clientY);const h=state.tokens.find(k=>Math.hypot(k.x-p.x,k.y-p.y)<28);end(t.clientX,t.clientY,h)},{passive:false});
cv.addEventListener('wheel',e=>{e.preventDefault();const k=e.deltaY<0?1.13:0.87;ox=e.clientX-(e.clientX-ox)*k;oy=e.clientY-(e.clientY-oy)*k;zoom=Math.max(0.35,Math.min(3.5,zoom*k))});

socket.on('state',d=>{state=d;me.id=d.pid;log('<span style="color:#4caf50">Conectado como '+(me.master?'Mestre':me.name)+'</span>')});
socket.on('token',t=>{const i=state.tokens.findIndex(x=>x.id===t.id);if(i>=0){state.tokens[i]={...state.tokens[i],...t}}else{state.tokens.push(t)}});
socket.on('map',m=>{state.map=m;log('<span style="color:#4caf50">ðŸ—ºï¸ Mapa atualizado</span>')});
socket.on('walls',w=>{state.walls=w});
socket.on('roll',r=>{log(r)});
socket.on('log',t=>log(t));
</script></body></html>`));

io.on('connection', socket => {
  socket.on('join', data => {
    const r = getRoom(data.room);
    socket.join(data.room); socket.room = data.room; socket.master = data.master;
    if (data.master) {
      socket.pid = 0;
    } else {
      let pid = 1; while (r.players[pid]) pid++;
      socket.pid = pid; r.players[pid] = true;
      if (!r.tokens.find(t => t.id === 'p' + pid)) {
        r.tokens.push({ id: 'p' + pid, x: 280 + pid * 80, y: 320, name: data.name || 'HerÃ³i', owner: pid, color: '#4a90e2', hp: 18, maxHp: 18, ca: 16, attr: [16, 14, 15, 10, 12, 11] });
      }
    }
    socket.emit('state', {...r, pid: socket.pid });
    socket.to(socket.room).emit('log', '<span style="color:#4caf50">â†’ '+data.name+' entrou</span>');
  });

  socket.on('token', t => {
    const r = rooms[socket.room];
    if (!r) return;
    const canMove = socket.master || t.owner === socket.pid || (t.owner === 0 && socket.master);
    if (!canMove) return;
    const i = r.tokens.findIndex(x => x.id === t.id);
    if (i >= 0) {
      r.tokens[i] = {...r.tokens[i],...t};
    } else {
      r.tokens.push(t);
    }
    io.to(socket.room).emit('token', r.tokens[i >= 0? i : r.tokens.length - 1]);
  });

  socket.on('walls', w => {
    const r = rooms[socket.room]; if (!r ||!socket.master) return;
    r.walls = w; io.to(socket.room).emit('walls', w);
  });

  socket.on('roll', r => {
    io.to(socket.room).emit('roll', r);
  });
});

http.listen(PORT, () => console.log('ðŸº Taverna de Bolso v2.1 rodando na porta ' + PORT));