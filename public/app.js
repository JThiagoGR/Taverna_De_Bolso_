
const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let me=null;
let players=[];
let maps=[];
let activeMapId=null;
let walls=[];
let doors=[];
let drawings=[];
let globalSpawns={player:null,npc:null};
let ruler=null;
let scale=1, offsetX=0, offsetY=0;
let tool='move', drawTool='wall';
let selectedId=null;
let tokenImages={}, mapImages={};
let dynamicVision=true;
let drawPending=false;

function $(id){return document.getElementById(id);}
function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
function A(v){return Array.isArray(v)?v:[];}
function isMaster(){return !!(me&&me.isMaster);}
function room(){return me?.room || $('room')?.value || 'mesa1';}
function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}

function resize(){canvas.width=innerWidth;canvas.height=innerHeight;requestDraw();}
addEventListener('resize',resize);resize();

function join(master){
  const name=$('name').value||'Jogador';
  const rm=$('room').value||'mesa1';
  const tokenId=$('tokenId').value||'';
  socket.emit('join',{name,room:rm,tokenId,isMaster:master});
  $('login').style.display='none';
  $('toolbar').style.display='flex';
  $('tokenImageToggle').style.display='block';
  document.body.classList.toggle('masterMode',master);
  $('masterToggle').style.display=master?'inline-block':'none';
}
function toggleMaster(){$('master').style.display=$('master').style.display==='none'?'block':'none';}
function toggleTokenPanel(){$('tokenImagePanel').style.display=$('tokenImagePanel').style.display==='none'?'block':'none';}
function hideTokenPanel(){$('tokenImagePanel').style.display='none';}
function logout(){location.reload();}
function toggleFullscreen(){document.fullscreenElement?document.exitFullscreen():document.body.requestFullscreen();}
function setTool(t){
  tool=t;
  ['tMove','tRuler','tPan','tDraw'].forEach(id=>$(id)?.classList.remove('active'));
  if(t==='move')$('tMove')?.classList.add('active');
  if(t==='ruler')$('tRuler')?.classList.add('active');
  if(t==='pan')$('tPan')?.classList.add('active');
  if(t==='draw')$('tDraw')?.classList.add('active');
}
function cycleDrawTool(){
  if(!isMaster())return;
  tool='draw';
  drawTool=drawTool==='wall'?'door':'wall';
  $('tDraw').textContent=drawTool==='wall'?'🧱':'🚪';
  setTool('draw');
}
function toggleFog(){
  if(!isMaster())return alert('Só o Mestre controla a escuridão.');
  dynamicVision=!dynamicVision;
  socket.emit('setDynamicVision',{room:room(),value:dynamicVision});
  updateVisionButton();
  requestDraw();
}
function toggleLight(){toggleFog();}

function center(){
  let p=null;
  if(isMaster()) p=selectedId?players.find(x=>String(x.id)===String(selectedId)):null;
  else p=myToken();
  if(p){offsetX=canvas.width/2-N(p.x)*scale;offsetY=canvas.height/2-N(p.y)*scale;requestDraw();return;}
  const m=maps.find(x=>String(x.id)===String(activeMapId))||maps[0];
  if(m){offsetX=canvas.width/2-(N(m.x)+N(m.w,1000)/2)*scale;offsetY=canvas.height/2-(N(m.y)+N(m.h,700)/2)*scale;requestDraw();}
}

function updateVisionButton(){
  let b=$('btnDynamicVision');
  if(!b){
    const tb=$('toolbar');
    if(tb){
      b=document.createElement('button');
      b.id='btnDynamicVision';
      b.textContent='👁️';
      b.title='Escuridão/visão dinâmica - só Mestre';
      b.onclick=()=>toggleFog();
      tb.appendChild(b);
    }
  }
  if(b){
    b.style.display=isMaster()?'inline-block':'none';
    b.classList.toggle('active',dynamicVision);
  }
}

socket.on('you',d=>{me={...d,room:$('room').value||'mesa1'};updateVisionButton();});
socket.on('state',s=>{
  if(!s)return;
  players=A(s.players); maps=A(s.maps); walls=A(s.walls); doors=A(s.doors); drawings=A(s.drawings);
  globalSpawns=s.globalSpawns||{player:null,npc:null};
  activeMapId=s.activeMapId||maps[0]?.id||null;
  dynamicVision=s.dynamicVision!==undefined?!!s.dynamicVision:dynamicVision;
  ruler=s.ruler||null;
  preloadAll();
  renderMapList();
  renderPlayers();
  updateVisionButton();
  requestDraw();
});
socket.on('playerMoved',p=>{upsert(players,p);preloadToken(p);requestDraw();});
socket.on('playerUpdated',p=>{upsert(players,p);preloadToken(p);renderPlayers();requestDraw();});
socket.on('wallsUpdated',w=>{walls=A(w);requestDraw();});
socket.on('doorsUpdated',d=>{doors=A(d);requestDraw();});
socket.on('rulerUpdated',r=>{ruler=r||null;requestDraw();});
socket.on('dynamicVisionUpdated',v=>{dynamicVision=!!v;updateVisionButton();requestDraw();});
socket.on('diceRolled',r=>showDiceRoll(r));

function upsert(arr,obj){if(!obj||!obj.id)return;const i=arr.findIndex(x=>String(x.id)===String(obj.id));if(i>=0)arr[i]={...arr[i],...obj};else arr.push(obj);}
function preloadAll(){maps.forEach(preloadMap);players.forEach(preloadToken);}
function preloadMap(m){
  if(!m||!m.src)return null;
  if(mapImages[m.id]&&mapImages[m.id].__src===m.src)return mapImages[m.id];
  const img=new Image(); img.__src=m.src; img.onload=requestDraw; img.src=m.src; mapImages[m.id]=img; return img;
}
function preloadToken(p){
  if(!p||!p.img)return null;
  if(tokenImages[p.id]&&tokenImages[p.id].__src===p.img)return tokenImages[p.id];
  const img=new Image(); img.__src=p.img; img.onload=requestDraw; img.src=p.img; tokenImages[p.id]=img; return img;
}

function loadImage(file,url,cb){
  if(file){const fr=new FileReader();fr.onload=e=>cb(e.target.result);fr.readAsDataURL(file);}
  else if(url)cb(url);
  else alert('Escolha arquivo ou URL.');
}
function loadMap(){
  if(!isMaster())return;
  loadImage($('mapFile').files[0],$('mapUrl').value.trim(),src=>{
    const img=new Image(); img.onload=()=>socket.emit('setMap',{room:room(),src,w:img.naturalWidth||1000,h:img.naturalHeight||700}); img.src=src;
  });
}
function addMapFromMaster(){
  if(!isMaster())return;
  loadImage($('newMapFile').files[0],$('newMapUrl').value.trim(),src=>{
    const img=new Image(); img.onload=()=>socket.emit('addMap',{room:room(),src,name:$('newMapName').value||'Mapa',side:$('mapSide').value,w:img.naturalWidth||1000,h:img.naturalHeight||700}); img.src=src;
  });
}
function setActiveMap(id){activeMapId=id;socket.emit('mapsUpdated',{room:room(),maps,activeMapId});center();renderMapList();}
function focusMapFixed(id){const m=maps.find(x=>String(x.id)===String(id));if(m){offsetX=canvas.width/2-(N(m.x)+N(m.w,1000)/2)*scale;offsetY=canvas.height/2-(N(m.y)+N(m.h,700)/2)*scale;requestDraw();}}
function deleteMap(id){if(isMaster()&&confirm('Deletar mapa?'))socket.emit('deleteMap',{room:room(),id});}
function setAdjustMap(id){adjustMapId=id;alert('Arraste o mapa.');}
function sendSelectedTokenToMap(id){
  const p=players.find(x=>String(x.id)===String(selectedId)),m=maps.find(x=>String(x.id)===String(id));
  if(!p||!m)return alert('Selecione um token.');
  p.x=N(m.x)+80;p.y=N(m.y)+80;p.mapId=m.id;
  socket.emit('move',{room:room(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,facing:p.facing});
}
let adjustMapId=null;

function renderMapList(){
  const box=$('mapList'); if(!box)return;
  const fmt=p=>p?`${Math.round(N(p.x))},${Math.round(N(p.y))}`:'não marcado';
  let html=`<div class="section"><b>Spawn global</b><br><small>Jogador: ${fmt(globalSpawns.player)}<br>NPC: ${fmt(globalSpawns.npc)}</small><div class="row"><button onclick="markGlobalSpawn('player')">Marcar Jogador</button><button onclick="markGlobalSpawn('npc')">Marcar NPC</button></div><div class="row"><button onclick="clearGlobalSpawn('player')">Remover Jogador</button><button onclick="clearGlobalSpawn('npc')">Remover NPC</button></div></div>`;
  html+=maps.map(m=>`<div class="section"><b>${m.id===activeMapId?'✅ ':''}${m.name}</b><br><small>x:${Math.round(N(m.x))} y:${Math.round(N(m.y))} w:${Math.round(N(m.w,1000))} h:${Math.round(N(m.h,700))}</small><div class="row"><button onclick="focusMapFixed('${m.id}')">Ver</button><button onclick="setActiveMap('${m.id}')">Ativo</button><button onclick="setAdjustMap('${m.id}')">Ajustar</button></div><div class="row"><button onclick="sendSelectedTokenToMap('${m.id}')">Enviar Token</button><button class="danger" onclick="deleteMap('${m.id}')">Del</button></div></div>`).join('');
  box.innerHTML=html;
}
function renderPlayers(){const box=$('playerList');if(!box)return;box.innerHTML=players.map(p=>`<div><button onclick="selectToken('${p.id}')">${p.isNpc?'👹':'🧍'} ${p.name||p.id}</button></div>`).join('');}
function selectToken(id){selectedId=id;requestDraw();}
function markGlobalSpawn(kind){pendingSpawn=kind;alert('Clique no mapa.');}
function clearGlobalSpawn(kind){socket.emit('clearGlobalSpawn',{room:room(),kind});}
let pendingSpawn=null;

function addNpc(){
  if(!isMaster())return;
  const m=maps.find(x=>x.id===activeMapId)||maps[0], sp=globalSpawns.npc;
  const npc={id:'npc_'+Date.now(),name:$('npcName').value||'NPC',isNpc:true,ownerId:'master',x:sp?sp.x:(m?N(m.x)+80:100),y:sp?sp.y:(m?N(m.y)+80:100),mapId:m?.id||null,hp:N($('npcHp').value,10),hpmax:N($('npcHp').value,10),ca:N($('npcCa').value,10),light:0,tokenStyle:'topdown',spriteW:32,spriteH:65,facing:1,color:'#d44',img:''};
  socket.emit('addNpc',{room:room(),npc});
}
function currentEditableToken(){return players.find(p=>p.id===selectedId)||myToken();}
function setTokenImg(){
  const p=currentEditableToken(); if(!p)return alert('Selecione token.');
  loadImage($('tokenFile').files[0],$('tokenUrl').value.trim(),src=>{p.img=src;preloadToken(p);socket.emit('updatePlayer',{room:room(),id:p.id,img:src});});
}
function applyTokenStyleSize(){
  const p=currentEditableToken(); if(!p)return;
  const st=$('tokenStyleSelect').value; p.tokenStyle=st;
  if(st==='standee')p.spriteH=Math.max(25,N($('tokenSizeInput').value,65)); else p.spriteW=Math.max(20,N($('tokenSizeInput').value,32));
  socket.emit('updatePlayer',{room:room(),id:p.id,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH});
}
function applyTokenLight(){const p=currentEditableToken();if(!p)return;p.light=N($('tokenLightInput').value,20);socket.emit('updatePlayer',{room:room(),id:p.id,light:p.light});}
function openSheet(p){selectedId=p.id;$('sheet').style.display='block';$('sName').value=p.name||'';$('sHp').value=p.hp||0;$('sMax').value=p.hpmax||0;$('sCa').value=p.ca||0;$('sLight').value=p.light||0;}
function closeSheet(){$('sheet').style.display='none';}
function saveSheet(){const p=players.find(x=>x.id===selectedId);if(!p)return;p.name=$('sName').value;p.hp=N($('sHp').value);p.hpmax=N($('sMax').value);p.ca=N($('sCa').value);p.light=N($('sLight').value);socket.emit('updatePlayer',{room:room(),id:p.id,name:p.name,hp:p.hp,hpmax:p.hpmax,ca:p.ca,light:p.light});closeSheet();}
function delToken(){if(selectedId)socket.emit('deleteToken',{room:room(),id:selectedId});closeSheet();}

function toggleDice(){$('dice').style.display=$('dice').style.display==='none'?'block':'none';}
const diceSeen=new Set();
function makeRoll(expr){
  expr=String(expr||'1d20').replace(/\s+/g,'');
  const m=expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i); if(!m)return null;
  const n=Math.max(1,Math.min(60,N(m[1],1))), die=Math.max(2,N(m[2],20)), mod=N(m[3],0), rolls=[];
  for(let i=0;i<n;i++)rolls.push(1+Math.floor(Math.random()*die));
  return {id:'roll_'+Date.now()+'_'+Math.random().toString(36).slice(2),expr,n,die,mod,rolls,total:rolls.reduce((a,b)=>a+b,0)+mod,by:me?.pid,name:isMaster()?'Mestre':(players.find(p=>p.ownerId===me?.pid||p.id===me?.pid)?.name||me?.pid||'Jogador')};
}
function roll(expr){const r=makeRoll(expr);if(!r)return alert('Rolagem inválida.');showDiceRoll(r);socket.emit('diceRoll',{room:room(),result:r});}
function showDiceRoll(r){if(!r||diceSeen.has(r.id))return;diceSeen.add(r.id);const log=$('diceLog');if(!log)return;const mod=r.mod?(r.mod>0?`+${r.mod}`:`${r.mod}`):'';const div=document.createElement('div');div.innerHTML=`<b>${r.name||r.by}</b> rolou ${r.expr}: [${r.rolls.join(', ')}] ${mod} = <b>${r.total}</b>`;log.prepend(div);}

function exportFullMap(){const state={version:'taverna-clean-final',maps,activeMapId,players,walls,doors,drawings,globalSpawns,dynamicVision};const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='taverna-cena.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function importFullMapClick(){const input=$('saveMapFile');input.onchange=e=>{const f=e.target.files[0];if(!f)return;const fr=new FileReader();fr.onload=ev=>socket.emit('importFullState',{room:room(),state:JSON.parse(ev.target.result)});fr.readAsText(f);};input.click();}

function myToken(){return players.find(p=>!p.isNpc&&p.ownerId===me?.pid)||players.find(p=>!p.isNpc&&p.id===me?.pid)||null;}
function worldPos(ev){const r=canvas.getBoundingClientRect();return[(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];}
function mapAt(x,y){for(let i=maps.length-1;i>=0;i--){const m=maps[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;}return null;}
function tokenBox(p,x=N(p.x),y=N(p.y)){
  if(p.tokenStyle==='standee'){const h=N(p.spriteH,65),w=Math.max(26,h*.45);return{l:x-w/2,r:x+w/2,t:y-h,b:y+8};}
  const s=Math.max(24,N(p.spriteW,32));return{l:x-s/2,r:x+s/2,t:y-s/2,b:y+s/2};
}
function ccw(a,b,c){return(c[1]-a[1])*(b[0]-a[0])>(b[1]-a[1])*(c[0]-a[0]);}
function segHit(a,b,c,d){return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d);}
function blockingSegments(){const segs=[];walls.forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});doors.forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});return segs;}
function boxEdges(b){return[[[b.l,b.t],[b.r,b.t]],[[b.r,b.t],[b.r,b.b]],[[b.r,b.b],[b.l,b.b]],[[b.l,b.b],[b.l,b.t]]];}
function blockedTokenMove(p,ox,oy,nx,ny){
  const blocks=blockingSegments(); if(!blocks.length)return false;
  const ob=tokenBox(p,ox,oy), nb=tokenBox(p,nx,ny);
  const paths=[[[ob.l,ob.t],[nb.l,nb.t]],[[ob.r,ob.t],[nb.r,nb.t]],[[ob.r,ob.b],[nb.r,nb.b]],[[ob.l,ob.b],[nb.l,nb.b]],[[ox,oy],[nx,ny]]];
  const edges=boxEdges(nb);
  return blocks.some(w=>paths.some(q=>segHit(q[0],q[1],w[0],w[1]))||edges.some(e=>segHit(e[0],e[1],w[0],w[1])));
}
function clampToken(p){let m=mapAt(p.x,p.y)||maps.find(mm=>mm.id===p.mapId)||maps[0];if(!m)return p;let b=tokenBox(p);const mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);if(b.l<mx+2)p.x+=mx+2-b.l;if(b.r>mx+mw-2)p.x-=b.r-(mx+mw-2);if(b.t<my+2)p.y+=my+2-b.t;if(b.b>my+mh-2)p.y-=b.b-(my+mh-2);p.mapId=m.id;return p;}

let panDrag=false,panStart=null,dragP=null,dragOff=[0,0],lastGood=null,lastMoveEmit=0,measure=false,drawPts=null;
function canControl(p){return isMaster()||(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid));}
function hitToken(x,y){for(let i=players.length-1;i>=0;i--){const p=players[i];if(!canControl(p))continue;const b=tokenBox(p);if(x>=b.l&&x<=b.r&&y>=b.t&&y<=b.b)return p;}return null;}
function emitMove(p,force=false){const now=performance.now();if(!force&&now-lastMoveEmit<30)return;lastMoveEmit=now;socket.emit('move',{room:room(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH,facing:p.facing});}

canvas.addEventListener('pointerdown',ev=>{
  const [x,y]=worldPos(ev);
  if(pendingSpawn&&isMaster()){socket.emit('setGlobalSpawn',{room:room(),kind:pendingSpawn,x,y});pendingSpawn=null;ev.preventDefault();return;}
  if(tool==='pan'){panDrag=true;panStart={x:ev.clientX,y:ev.clientY,ox:offsetX,oy:offsetY};ev.preventDefault();return;}
  if(tool==='ruler'){measure=true;ruler={a:[x,y],b:[x,y]};socket.emit('setRuler',{room:room(),ruler});ev.preventDefault();return;}
  if(tool==='draw'&&isMaster()){drawPts=[[x,y]];ev.preventDefault();return;}
  if(isMaster()){const d=doorNear(x,y);if(d>=0){doors[d].open=!doors[d].open;socket.emit('setDoors',{room:room(),doors});ev.preventDefault();return;}}
  if(tool==='move'){const p=hitToken(x,y);if(p){dragP=p;selectedId=p.id;dragOff=[p.x-x,p.y-y];lastGood={x:p.x,y:p.y,mapId:p.mapId};ev.preventDefault();return;}}
},{passive:false});
window.addEventListener('pointermove',ev=>{
  const [x,y]=worldPos(ev);
  if(panDrag){offsetX=panStart.ox+(ev.clientX-panStart.x);offsetY=panStart.oy+(ev.clientY-panStart.y);requestDraw();ev.preventDefault();return;}
  if(measure){ruler.b=[x,y];socket.emit('setRuler',{room:room(),ruler});requestDraw();ev.preventDefault();return;}
  if(drawPts){const last=drawPts[drawPts.length-1];if(Math.hypot(x-last[0],y-last[1])>=1.5)drawPts.push([x,y]);requestDraw();ev.preventDefault();return;}
  if(dragP){const ox=dragP.x,oy=dragP.y;let nx=x+dragOff[0],ny=y+dragOff[1];if(blockedTokenMove(dragP,ox,oy,nx,ny)){nx=lastGood.x;ny=lastGood.y;}dragP.x=nx;dragP.y=ny;clampToken(dragP);if(!blockedTokenMove(dragP,ox,oy,dragP.x,dragP.y))lastGood={x:dragP.x,y:dragP.y,mapId:dragP.mapId};const dx=dragP.x-ox;if(Math.abs(dx)>.35)dragP.facing=dx>=0?1:-1;emitMove(dragP);requestDraw();ev.preventDefault();return;}
},{passive:false});
window.addEventListener('pointerup',ev=>{
  const [x,y]=worldPos(ev);
  if(panDrag){panDrag=false;ev.preventDefault();return;}
  if(measure){measure=false;ruler=null;socket.emit('setRuler',{room:room(),ruler:null});requestDraw();ev.preventDefault();return;}
  if(drawPts){if(Math.hypot(x-drawPts[drawPts.length-1][0],y-drawPts[drawPts.length-1][1])>.5)drawPts.push([x,y]);if(drawPts.length>1){if(drawTool==='door'){socket.emit('addDoor',{room:room(),door:{wall:[drawPts[0],drawPts[drawPts.length-1]],open:false}});}else{const batch=[];for(let i=1;i<drawPts.length;i++)batch.push([drawPts[i-1],drawPts[i]]);socket.emit('addWallsBatch',{room:room(),walls:batch});}}drawPts=null;requestDraw();ev.preventDefault();return;}
  if(dragP){emitMove(dragP,true);dragP=null;lastGood=null;requestDraw();ev.preventDefault();return;}
},{passive:false});
window.addEventListener('pointercancel',()=>{panDrag=false;measure=false;drawPts=null;dragP=null;ruler=null;socket.emit('setRuler',{room:room(),ruler:null});requestDraw();});

function doorNear(x,y){let best=-1,bd=99999;doors.forEach((d,i)=>{if(!d.wall)return;const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);if(dd<bd){bd=dd;best=i}});return bd<30?best:-1;}
function distPointSeg(px,py,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));}

canvas.addEventListener('wheel',ev=>{ev.preventDefault();const mx=ev.clientX,my=ev.clientY,wx=(mx-offsetX)/scale,wy=(my-offsetY)/scale;scale=Math.max(.08,Math.min(12,scale*(ev.deltaY<0?1.12:.88)));offsetX=mx-wx*scale;offsetY=my-wy*scale;requestDraw();},{passive:false});
canvas.addEventListener('dblclick',ev=>{const [x,y]=worldPos(ev);const p=hitToken(x,y);if(p)openSheet(p);});

function lightRadius(p){const l=N(p.light,0);return l>0?Math.max(80,l*12):(!p.isNpc?200:0);}
function visionSegments(){const segs=[];walls.forEach(w=>{if(w&&w[0]&&w[1])segs.push({a:w[0],b:w[1]})});doors.forEach(d=>{if(d&&d.wall&&!d.open)segs.push({a:d.wall[0],b:d.wall[1]})});return segs;}
function raySeg(px,py,ang,s){const rdx=Math.cos(ang),rdy=Math.sin(ang),x1=s.a[0],y1=s.a[1],x2=s.b[0],y2=s.b[1],sdx=x2-x1,sdy=y2-y1,den=rdx*sdy-rdy*sdx;if(Math.abs(den)<1e-6)return null;const qpx=x1-px,qpy=y1-py,t=(qpx*sdy-qpy*sdx)/den,u=(qpx*rdy-qpy*rdx)/den;return t>=0&&u>=0&&u<=1?{x:px+rdx*t,y:py+rdy*t,dist:t}:null;}
function visionPoly(tok){if(!tok)return[];const px=N(tok.x),py=N(tok.y),r=lightRadius(tok);if(r<=0)return[];const segs=visionSegments(),angles=[],eps=.0008;for(let i=0;i<96;i++)angles.push(Math.PI*2*i/96);segs.forEach(s=>[s.a,s.b].forEach(pt=>{const a=Math.atan2(pt[1]-py,pt[0]-px);angles.push(a-eps,a,a+eps)}));const pts=[];angles.forEach(a=>{let near={x:px+Math.cos(a)*r,y:py+Math.sin(a)*r,dist:r};segs.forEach(s=>{const h=raySeg(px,py,a,s);if(h&&h.dist<near.dist&&h.dist<=r)near=h});pts.push({...near,ang:Math.atan2(near.y-py,near.x-px)})});pts.sort((a,b)=>a.ang-b.ang);return pts;}
function inPoly(x,y,poly){let ins=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi+1e-6)+xi))ins=!ins}return ins;}

function drawMaps(){maps.forEach(m=>{const img=preloadMap(m),x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h)}if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.strokeRect(x,y,w,h)}});}
function drawWallsDoors(){if(!isMaster())return;ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';ctx.lineJoin='round';walls.forEach(w=>{ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke()});doors.forEach(d=>{ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke()});if(drawPts&&drawPts.length>1){ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';ctx.lineWidth=(drawTool==='door'?5:3)/scale;if(drawTool==='door')ctx.setLineDash([8/scale,6/scale]);ctx.beginPath();ctx.moveTo(drawPts[0][0],drawPts[0][1]);for(let i=1;i<drawPts.length;i++)ctx.lineTo(drawPts[i][0],drawPts[i][1]);ctx.stroke();ctx.setLineDash([])}ctx.restore();}
function drawToken(p){const img=preloadToken(p),x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;if(img&&img.complete&&img.naturalWidth){const stand=p.tokenStyle==='standee',h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale,w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore()}else ctx.drawImage(img,x-w/2,y-h/2,w,h)}else{ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke()}}
function drawPlayerView(){const own=myToken();ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);if(!own)return;const poly=visionPoly(own);if(!poly.length)return;ctx.save();ctx.beginPath();ctx.moveTo(poly[0].x*scale+offsetX,poly[0].y*scale+offsetY);for(let i=1;i<poly.length;i++)ctx.lineTo(poly[i].x*scale+offsetX,poly[i].y*scale+offsetY);ctx.closePath();ctx.clip();drawMaps();players.forEach(p=>{if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))drawToken(p);else if(inPoly(p.x,p.y,poly))drawToken(p)});ctx.restore();}
function drawMasterView(){drawMaps();drawWallsDoors();players.forEach(drawToken);players.filter(p=>!p.isNpc).forEach(p=>{const poly=visionPoly(p);if(!poly.length)return;ctx.save();ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(poly[0].x*scale+offsetX,poly[0].y*scale+offsetY);for(let i=1;i<poly.length;i++)ctx.lineTo(poly[i].x*scale+offsetX,poly[i].y*scale+offsetY);ctx.closePath();ctx.stroke();ctx.setLineDash([]);ctx.restore()});}
function drawRuler(){if(!ruler)return;const ax=ruler.a[0]*scale+offsetX,ay=ruler.a[1]*scale+offsetY,bx=ruler.b[0]*scale+offsetX,by=ruler.b[1]*scale+offsetY;ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();ctx.restore();}
function draw(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);if(isMaster()||!dynamicVision)drawMasterView();else drawPlayerView();drawRuler();}
setInterval(requestDraw,1000/30);
