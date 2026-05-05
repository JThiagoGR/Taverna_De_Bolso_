const socket=io();
const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');

let me=null, players=[], maps=[], activeMapId=null, walls=[], doors=[], fogEnabled=false, globalLight=false;
let globalSpawns={player:null,npc:null}, ruler=null;
let scale=1, offsetX=0, offsetY=0, tool='move', drawTool='wall';
let selectedId=null, dragToken=null, dragMap=null, pan=false, dragOff=[0,0], lastPointer=null;
let wallStart=null, rulerStart=null;
const tokenImages={}, mapImages={};

let drawPending=false;
function requestDraw(){
  if(drawPending) return;
  drawPending=true;
  requestAnimationFrame(()=>{
    drawPending=false;
    if(typeof draw === 'function') draw();
  });
}

function resize(){canvas.width=innerWidth;canvas.height=innerHeight;requestDraw();}
addEventListener('resize',resize);resize();

function $(id){return document.getElementById(id);}
function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
function isMaster(){return !!(me&&me.isMaster);}
function room(){return $('room')?.value||'mesa1';}
function currentRoom(){return me?.room||room();}

function join(master){
  const name=$('name').value||'Jogador', rm=$('room').value||'mesa1', tokenId=$('tokenId').value||'';
  socket.emit('join',{name,room:rm,tokenId,isMaster:master});
  $('login').style.display='none';$('toolbar').style.display='flex';$('tokenImageToggle').style.display='block';
  document.body.classList.toggle('masterMode',master);
  $('masterToggle').style.display=master?'inline-block':'none';
}
socket.on('you',d=>{me={...d,room:room()};});
socket.on('state',s=>{
  players=s.players||[];maps=s.maps||[];activeMapId=s.activeMapId||maps[0]?.id||null;
  walls=s.walls||[];doors=s.doors||[];fogEnabled=!!s.fogEnabled;globalLight=!!s.globalLight;
  globalSpawns=s.globalSpawns||{player:null,npc:null};ruler=s.ruler||null;
  preload();renderMapList();renderPlayers();requestDraw();
});
socket.on('playerMoved',p=>{upsert(players,p);preloadToken(p);requestDraw();});
socket.on('playerUpdated',p=>{upsert(players,p);preloadToken(p);renderPlayers();requestDraw();});
socket.on('rulerUpdated',r=>{ruler=r;requestDraw();});

function upsert(arr,obj){const i=arr.findIndex(x=>x.id===obj.id);if(i>=0)arr[i]={...arr[i],...obj};else arr.push(obj);}
function preload(){maps.forEach(preloadMap);players.forEach(preloadToken);}
function preloadMap(m){if(!m||!m.src)return null;if(mapImages[m.id]&&mapImages[m.id].__src===m.src)return mapImages[m.id];const img=new Image();img.__src=m.src;img.onload=requestDraw;img.src=m.src;mapImages[m.id]=img;return img;}
function preloadToken(p){if(!p||!p.img)return null;if(tokenImages[p.id]&&tokenImages[p.id].__src===p.img)return tokenImages[p.id];const img=new Image();img.__src=p.img;img.onload=requestDraw;img.src=p.img;tokenImages[p.id]=img;return img;}

function setTool(t){tool=t;['tMove','tRuler','tPan'].forEach(id=>$(id)?.classList.remove('active'));if(t==='move')$('tMove').classList.add('active');if(t==='ruler')$('tRuler').classList.add('active');if(t==='pan')$('tPan').classList.add('active');}
function cycleDrawTool(){drawTool=drawTool==='wall'?'door':'wall';tool='draw';$('tDraw').textContent=drawTool==='wall'?'🧱':'🚪';}
function toggleMaster(){$('master').style.display=$('master').style.display==='none'?'block':'none';}
function toggleTokenPanel(){$('tokenImagePanel').style.display=$('tokenImagePanel').style.display==='none'?'block':'none';}
function hideTokenPanel(){$('tokenImagePanel').style.display='none';}
function logout(){location.reload();}
function toggleFullscreen(){document.fullscreenElement?document.exitFullscreen():document.body.requestFullscreen();}
function center(){const m=maps.find(x=>x.id===activeMapId)||maps[0];if(m){scale=1;offsetX=canvas.width/2-(m.x+m.w/2)*scale;offsetY=canvas.height/2-(m.y+m.h/2)*scale;}requestDraw();}

function worldPos(ev){const r=canvas.getBoundingClientRect();return[(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];}
function rect(m){return{x:N(m.x),y:N(m.y),w:N(m.w,1000),h:N(m.h,700)}}
function mapAt(x,y){for(let i=maps.length-1;i>=0;i--){const r=rect(maps[i]);if(x>=r.x+2&&y>=r.y+2&&x<=r.x+r.w-2&&y<=r.y+r.h-2)return maps[i];}return null;}
function clampToMap(p){let m=mapAt(p.x,p.y)||maps.find(mm=>mm.id===p.mapId)||maps[0];if(!m)return p;const r=rect(m);p.x=Math.max(r.x+2,Math.min(r.x+r.w-2,p.x));p.y=Math.max(r.y+2,Math.min(r.y+r.h-2,p.y));p.mapId=m.id;return p;}

function loadImageFromInput(file,url,cb){if(file){const r=new FileReader();r.onload=e=>cb(e.target.result);r.readAsDataURL(file);}else if(url)cb(url);else alert('Escolha arquivo ou URL.');}
function loadMap(){if(!isMaster())return;loadImageFromInput($('mapFile').files[0],$('mapUrl').value.trim(),src=>{const img=new Image();img.onload=()=>socket.emit('setMap',{room:currentRoom(),src,w:img.naturalWidth||1000,h:img.naturalHeight||700});img.src=src;});}
function addMapFromMaster(){if(!isMaster())return;loadImageFromInput($('newMapFile').files[0],$('newMapUrl').value.trim(),src=>{const img=new Image();img.onload=()=>socket.emit('addMap',{room:currentRoom(),src,name:$('newMapName').value||'Mapa',side:$('mapSide').value,w:img.naturalWidth||1000,h:img.naturalHeight||700});img.src=src;});}
function setActiveMap(id){activeMapId=id;center();socket.emit('mapsUpdated',{room:currentRoom(),maps,activeMapId});renderMapList();}
function focusMapFixed(id){const m=maps.find(x=>x.id===id);if(m){offsetX=canvas.width/2-(m.x+m.w/2)*scale;offsetY=canvas.height/2-(m.y+m.h/2)*scale;requestDraw();}}
function deleteMap(id){if(!isMaster()||!confirm('Deletar mapa?'))return;socket.emit('deleteMap',{room:currentRoom(),id});}
function sendSelectedTokenToMap(id){const p=players.find(x=>x.id===selectedId);const m=maps.find(x=>x.id===id);if(!p||!m)return alert('Selecione um token.');p.x=m.x+80;p.y=m.y+80;p.mapId=m.id;socket.emit('move',{room:currentRoom(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH});}
let adjustMapId=null;function setAdjustMap(id){adjustMapId=id;alert('Arraste o mapa.');renderMapList();}function stopAdjustMap(){adjustMapId=null;renderMapList();}

function renderMapList(){const box=$('mapList');if(!box)return;const fmt=p=>p?`${Math.round(p.x)},${Math.round(p.y)}`:'não marcado';let html=`<div class="section"><b>Spawn global</b><br><small>Jogador: ${fmt(globalSpawns.player)}<br>NPC: ${fmt(globalSpawns.npc)}</small><div class="row"><button onclick="markGlobalSpawn('player')">Marcar Jogador</button><button onclick="markGlobalSpawn('npc')">Marcar NPC</button></div><div class="row"><button onclick="clearGlobalSpawn('player')">Remover Jogador</button><button onclick="clearGlobalSpawn('npc')">Remover NPC</button></div></div>`;if(adjustMapId)html+=`<button class="danger" onclick="stopAdjustMap()">⛔ Parar ajuste</button>`;html+=maps.map(m=>`<div class="section"><b>${m.id===activeMapId?'✅ ':''}${m.name}</b><br><small>x:${Math.round(m.x)} y:${Math.round(m.y)} w:${Math.round(m.w)} h:${Math.round(m.h)}</small><div class="row"><button onclick="focusMapFixed('${m.id}')">Ver</button><button onclick="setActiveMap('${m.id}')">Ativo</button><button onclick="setAdjustMap('${m.id}')">Ajustar</button></div><div class="row"><button onclick="sendSelectedTokenToMap('${m.id}')">Enviar Token</button><button class="danger" onclick="deleteMap('${m.id}')">Del</button></div></div>`).join('');box.innerHTML=html;}
function renderPlayers(){const box=$('playerList');if(!box)return;box.innerHTML=players.map(p=>`<div><button onclick="selectToken('${p.id}')">${p.isNpc?'👹':'🧍'} ${p.name||p.id}</button></div>`).join('');}
function selectToken(id){selectedId=id;requestDraw();}

function markGlobalSpawn(kind){if(!isMaster())return;pendingSpawn=kind;alert('Clique no mapa para marcar spawn.');}
function clearGlobalSpawn(kind){socket.emit('clearGlobalSpawn',{room:currentRoom(),kind});}
let pendingSpawn=null;

function addNpc(){if(!isMaster())return;const m=maps.find(x=>x.id===activeMapId)||maps[0];const sp=globalSpawns.npc;const npc={id:'npc_'+Date.now(),name:$('npcName').value||'NPC',isNpc:true,ownerId:'master',x:sp?sp.x:(m?m.x+80:100),y:sp?sp.y:(m?m.y+80:100),mapId:m?.id||null,hp:N($('npcHp').value,10),hpmax:N($('npcHp').value,10),ca:N($('npcCa').value,10),light:0,tokenStyle:'topdown',spriteW:32,spriteH:65,facing:1,color:'#d44',img:''};socket.emit('addNpc',{room:currentRoom(),npc});}
function currentEditableToken(){return players.find(p=>p.id===selectedId)||players.find(p=>!p.isNpc&&p.ownerId===me?.pid);}
function setTokenImg(){const p=currentEditableToken();if(!p)return alert('Selecione token.');loadImageFromInput($('tokenFile').files[0],$('tokenUrl').value.trim(),src=>{p.img=src;preloadToken(p);socket.emit('updatePlayer',{room:currentRoom(),id:p.id,img:src});});}
function applyTokenStyleSize(){const p=currentEditableToken();if(!p)return;const st=$('tokenStyleSelect').value;p.tokenStyle=st;if(st==='standee')p.spriteH=N($('tokenSizeInput').value,65);else p.spriteW=N($('tokenSizeInput').value,32);socket.emit('updatePlayer',{room:currentRoom(),id:p.id,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH});}
function applyTokenLight(){const p=currentEditableToken();if(!p)return;p.light=N($('tokenLightInput').value,20);socket.emit('updatePlayer',{room:currentRoom(),id:p.id,light:p.light});}
function toggleFog(){fogEnabled=!fogEnabled;socket.emit('setFog',{room:currentRoom(),value:fogEnabled});}
function toggleLight(){globalLight=!globalLight;socket.emit('setGlobalLight',{room:currentRoom(),value:globalLight});}
function openSheet(p){selectedId=p.id;$('sheet').style.display='block';$('sName').value=p.name||'';$('sHp').value=p.hp||0;$('sMax').value=p.hpmax||0;$('sCa').value=p.ca||0;$('sLight').value=p.light||0;}
function closeSheet(){$('sheet').style.display='none';}
function saveSheet(){const p=players.find(x=>x.id===selectedId);if(!p)return;p.name=$('sName').value;p.hp=N($('sHp').value);p.hpmax=N($('sMax').value);p.ca=N($('sCa').value);p.light=N($('sLight').value);socket.emit('updatePlayer',{room:currentRoom(),id:p.id,name:p.name,hp:p.hp,hpmax:p.hpmax,ca:p.ca,light:p.light});closeSheet();}
function delToken(){if(!selectedId)return;socket.emit('deleteToken',{room:currentRoom(),id:selectedId});closeSheet();}

function undoLastWall(){socket.emit('undoWall',{room:currentRoom()});}
function toggleDice(){$('dice').style.display=$('dice').style.display==='none'?'block':'none';}
function roll(expr){expr=String(expr||'1d20');const m=expr.match(/(\d*)d(\d+)([+-]\d+)?/i);if(!m)return;const n=N(m[1],1),d=N(m[2],20),mod=N(m[3],0);let rolls=[];for(let i=0;i<n;i++)rolls.push(1+Math.floor(Math.random()*d));const total=rolls.reduce((a,b)=>a+b,0)+mod;$('diceLog').innerHTML=`<div>${expr}: [${rolls.join(', ')}] ${mod?mod:''} = <b>${total}</b></div>`+$('diceLog').innerHTML;}

function exportFullMap(){const state={version:'taverna-clean-v2',maps,activeMapId,players,walls,doors,fogEnabled,globalLight,globalSpawns};const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='taverna-cena.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function importFullMapClick(){const input=$('saveMapFile');input.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const state=JSON.parse(ev.target.result);socket.emit('importFullState',{room:currentRoom(),state});};r.readAsText(f);};input.click();}

canvas.addEventListener('mousedown',e=>{const [x,y]=worldPos(e);lastPointer=[x,y];if(pendingSpawn&&isMaster()){socket.emit('setGlobalSpawn',{room:currentRoom(),kind:pendingSpawn,x,y});pendingSpawn=null;return;}if(tool==='pan'){pan=true;dragOff=[e.clientX-offsetX,e.clientY-offsetY];return;}if(tool==='ruler'){rulerStart=[x,y];ruler={a:rulerStart,b:rulerStart};socket.emit('setRuler',{room:currentRoom(),ruler});return;}if(tool==='draw'&&isMaster()){wallStart=[x,y];return;}if(adjustMapId&&isMaster()){const m=maps.find(mm=>mm.id===adjustMapId);if(m){dragMap=m;dragOff=[x-m.x,y-m.y];return;}}if(tool==='move'){for(let i=players.length-1;i>=0;i--){const p=players[i];if(!isMaster()&&(p.isNpc||p.ownerId!==me?.pid))continue;const r=p.tokenStyle==='standee'?Math.max(24,(p.spriteH||65)*.4):(p.spriteW||32);if(Math.hypot(p.x-x,p.y-y)<r){dragToken=p;selectedId=p.id;dragOff=[p.x-x,p.y-y];return;}}}});
addEventListener('mousemove',e=>{const [x,y]=worldPos(e);if(pan){offsetX=e.clientX-dragOff[0];offsetY=e.clientY-dragOff[1];requestDraw();return;}if(rulerStart&&tool==='ruler'){ruler={a:rulerStart,b:[x,y]};socket.emit('setRuler',{room:currentRoom(),ruler});requestDraw();return;}if(dragMap){dragMap.x=x-dragOff[0];dragMap.y=y-dragOff[1];socket.emit('mapsUpdated',{room:currentRoom(),maps,activeMapId});requestDraw();return;}if(dragToken){const oldX=dragToken.x;dragToken.x=x+dragOff[0];dragToken.y=y+dragOff[1];if(Math.abs(dragToken.x-oldX)>1)dragToken.facing=dragToken.x-oldX>=0?-1:1;clampToMap(dragToken);socket.emit('move',{room:currentRoom(),id:dragToken.id,x:dragToken.x,y:dragToken.y,mapId:dragToken.mapId,tokenStyle:dragToken.tokenStyle,spriteW:dragToken.spriteW,spriteH:dragToken.spriteH});requestDraw();}});
addEventListener('mouseup',e=>{const [x,y]=worldPos(e);if(wallStart&&tool==='draw'&&isMaster()){const wall=[wallStart,[x,y]];socket.emit(drawTool==='door'?'addDoor':'addWall',{room:currentRoom(),[drawTool==='door'?'door':'wall']:drawTool==='door'?{wall,open:false}:wall});}if(rulerStart&&tool==='ruler'){socket.emit('setRuler',{room:currentRoom(),ruler:null});rulerStart=null;}wallStart=null;dragToken=null;dragMap=null;pan=false;});
canvas.addEventListener('wheel',e=>{e.preventDefault();const mx=e.clientX,my=e.clientY,wx=(mx-offsetX)/scale,wy=(my-offsetY)/scale;scale=Math.max(.08,Math.min(12,scale*(e.deltaY<0?1.12:.88)));offsetX=mx-wx*scale;offsetY=my-wy*scale;requestDraw();},{passive:false});
canvas.addEventListener('dblclick',e=>{const [x,y]=worldPos(e);const p=players.find(p=>Math.hypot(p.x-x,p.y-y)<40);if(p&&(isMaster()||p.ownerId===me?.pid))openSheet(p);});

function lightRadius(p){const l=N(p.light);return l>0?Math.max(80,l*12):(!p.isNpc?200:0);}
function ownToken(){return players.find(p=>!p.isNpc&&p.ownerId===me?.pid)||players.find(p=>!p.isNpc&&p.id===me?.pid)||players.find(p=>!p.isNpc);}
function visible(p){if(isMaster()||!fogEnabled||globalLight)return true;const own=ownToken();if(!own)return true;if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))return true;return Math.hypot(p.x-own.x,p.y-own.y)<=lightRadius(own);}
function drawToken(p){if(!visible(p))return;const img=tokenImages[p.id];const x=p.x*scale+offsetX,y=p.y*scale+offsetY;if(img&&img.complete&&img.naturalWidth){const stand=p.tokenStyle==='standee',h=(stand?(p.spriteH||65):(p.spriteW||32))*scale,w=h*(img.naturalWidth/img.naturalHeight);if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}else ctx.drawImage(img,x-w/2,y-h/2,w,h);}else{ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();}}
function draw(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);maps.forEach(m=>{const img=mapImages[m.id];if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,m.x*scale+offsetX,m.y*scale+offsetY,m.w*scale,m.h*scale);else{ctx.fillStyle='#333';ctx.fillRect(m.x*scale+offsetX,m.y*scale+offsetY,m.w*scale,m.h*scale);}if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.strokeRect(m.x*scale+offsetX,m.y*scale+offsetY,m.w*scale,m.h*scale);}});if(isMaster()){ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';walls.forEach(w=>{ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});doors.forEach(d=>{ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();});ctx.restore();}if(isMaster()){[ ['player','🧍','#50ff8c'],['npc','👹','#ff5050'] ].forEach(([k,ic,c])=>{const p=globalSpawns[k];if(!p)return;const x=p.x*scale+offsetX,y=p.y*scale+offsetY;ctx.fillStyle='rgba(0,0,0,.85)';ctx.strokeStyle=c;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='21px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ic,x,y);});players.filter(p=>!p.isNpc).forEach(p=>{ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);ctx.beginPath();ctx.arc(p.x*scale+offsetX,p.y*scale+offsetY,lightRadius(p)*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);});}if(!isMaster()&&fogEnabled&&!globalLight){const own=ownToken();if(own){ctx.fillStyle='rgba(0,0,0,.92)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='destination-out';ctx.fillStyle='#000';ctx.beginPath();ctx.arc(own.x*scale+offsetX,own.y*scale+offsetY,lightRadius(own)*scale,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';}}players.forEach(drawToken);if(ruler){ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ruler.a[0]*scale+offsetX,ruler.a[1]*scale+offsetY);ctx.lineTo(ruler.b[0]*scale+offsetX,ruler.b[1]*scale+offsetY);ctx.stroke();ctx.fillStyle='#00e5ff';ctx.fillText(Math.round(Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1])/10)+' ft',(ruler.a[0]+ruler.b[0])*scale/2+offsetX,(ruler.a[1]+ruler.b[1])*scale/2+offsetY);}}
setInterval(requestDraw,1000/30);


// ===== PATCH FINAL FISICA/LUZ/TOKEN/PORTAS =====
(function(){
  if(window.__TAVERNA_PATCH_FISICA_LUZ_TOKEN_PORTAS__) return;
  window.__TAVERNA_PATCH_FISICA_LUZ_TOKEN_PORTAS__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function W(){return A(walls)}
  function D(){return A(doors)}
  function MAPS(){return A(maps)}

  // ---------- tamanho / altura ----------
  window.applyTokenStyleSize=function(){
    const p=(selectedId?P().find(x=>x.id===selectedId):null) || (typeof currentEditableToken==='function'?currentEditableToken():null);
    if(!p)return alert('Selecione um token.');
    if(!isMaster() && p.ownerId!==me?.pid)return alert('Você só pode alterar seu token.');

    const st=document.getElementById('tokenStyleSelect')?.value || p.tokenStyle || 'topdown';
    const size=N(document.getElementById('tokenSizeInput')?.value, st==='standee' ? (p.spriteH||65) : (p.spriteW||32));
    p.tokenStyle=st;
    if(st==='standee'){
      p.spriteH=Math.max(25,Math.min(220,size));
      // largura é proporcional no desenho; deixa spriteW apenas como referência
      if(!p.spriteW)p.spriteW=32;
    }else{
      p.spriteW=Math.max(20,Math.min(160,size));
      if(!p.spriteH)p.spriteH=65;
    }
    socket.emit('updatePlayer',{room:R(),id:p.id,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH});
    requestDraw();
  };

  // ---------- luz / visibilidade ----------
  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }
  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) || P().find(p=>!p.isNpc&&p.id===me?.pid) || P().find(p=>!p.isNpc);
  }
  function isVisibleToClient(p){
    if(isMaster())return true;
    if(!fogEnabled || globalLight)return true; // nevoa desligada: NPC aparece
    const own=ownToken();
    if(!own)return true;
    if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y))<=lightRadius(own);
  }

  // ---------- geometria / colisão paredes ----------
  function ccw(ax,ay,bx,by,cx,cy){return (cy-ay)*(bx-ax)>(by-ay)*(cx-ax)}
  function segIntersects(a,b,c,d){
    return ccw(a[0],a[1],c[0],c[1],d[0],d[1])!==ccw(b[0],b[1],c[0],c[1],d[0],d[1]) &&
           ccw(a[0],a[1],b[0],b[1],c[0],c[1])!==ccw(a[0],a[1],b[0],b[1],d[0],d[1]);
  }
  function blockingSegments(){
    const segs=[];
    W().forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});
    D().forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});
    return segs;
  }
  function blockedMove(x1,y1,x2,y2){
    const a=[x1,y1],b=[x2,y2];
    return blockingSegments().some(s=>segIntersects(a,b,s[0],s[1]));
  }
  function mapAt(x,y){
    for(let i=MAPS().length-1;i>=0;i--){
      const m=MAPS()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }
  function clampMap(p){
    let m=mapAt(p.x,p.y)||MAPS().find(mm=>mm.id===p.mapId)||MAPS()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // ---------- portas: mestre abre/fecha clicando perto ----------
  function distPointSeg(px,py,a,b){
    const x1=a[0],y1=a[1],x2=b[0],y2=b[1],dx=x2-x1,dy=y2-y1;
    const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  window.toggleDoorAt=function(x,y){
    if(!isMaster())return false;
    let best=null,bd=999999;
    D().forEach((d,i)=>{if(!d||!d.wall)return;const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);if(dd<bd){bd=dd;best=i}});
    if(best!==null&&bd<18){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw();
      return true;
    }
    return false;
  };

  // ---------- movimento sem refazer caminho ----------
  let drag=null, off=[0,0], lastEmit=0, lastGood=null;
  function worldPos(ev){const r=canvas.getBoundingClientRect();return[(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale]}
  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i];
      if(!isMaster()&&(p.isNpc||p.ownerId!==me?.pid))continue;
      const rad=p.tokenStyle==='standee'?Math.max(24,N(p.spriteH,65)*.4):Math.max(18,N(p.spriteW,32)*.8);
      if(Math.hypot(N(p.x)-x,N(p.y)-y)<=rad)return p;
    }
    return null;
  }
  function onDown(ev){
    const [x,y]=worldPos(ev);

    // abre/fecha porta no modo desenho ou pan com duplo clique não necessário: clique perto de porta segurando Alt ou ferramenta draw door
    if(isMaster() && (ev.altKey || (tool==='draw' && drawTool==='door')) && toggleDoorAt(x,y)){
      ev.preventDefault();ev.stopImmediatePropagation();return true;
    }

    if(tool!=='move')return false;
    const p=hitToken(x,y);
    if(!p)return false;
    drag=p; selectedId=p.id; off=[N(p.x)-x,N(p.y)-y]; lastGood={x:N(p.x),y:N(p.y),mapId:p.mapId};
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    return true;
  }
  function onMove(ev){
    if(!drag)return false;
    const [x,y]=worldPos(ev);
    const oldX=N(drag.x), oldY=N(drag.y);
    let nx=x+off[0], ny=y+off[1];

    if(blockedMove(oldX,oldY,nx,ny)){
      nx=lastGood.x; ny=lastGood.y;
    }

    drag.x=nx; drag.y=ny; clampMap(drag);

    if(!blockedMove(oldX,oldY,drag.x,drag.y)){
      lastGood={x:drag.x,y:drag.y,mapId:drag.mapId};
    }

    const dx=drag.x-oldX;
    if(Math.abs(dx)>1)drag.facing=dx>=0?-1:1; // corrige lado da miniatura

    const now=Date.now();
    if(now-lastEmit>55){
      lastEmit=now;
      socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
    }
    requestDraw();
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    return true;
  }
  function onUp(ev){
    if(!drag)return false;
    socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
    drag=null; lastGood=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    return true;
  }
  canvas.addEventListener('mousedown',onDown,true);
  window.addEventListener('mousemove',onMove,true);
  window.addEventListener('mouseup',onUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])onDown(e.touches[0])},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(drag&&e.touches&&e.touches[0])onMove(e.touches[0])},{capture:true,passive:false});
  window.addEventListener('touchend',onUp,true);

  // ---------- desenho livre de paredes / portas ----------
  // mantém o sistema antigo, só remove exigência de estar dentro de mapa para wallStart,
  // e renderiza paredes/portas sempre para mestre.

  // ---------- render final ----------
  function imgToken(p){preloadToken&&preloadToken(p);return tokenImages[p.id]}
  window.drawToken=function(p){
    if(!isVisibleToClient(p))return;
    const img=imgToken(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}
      else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
    }
  };
  function drawMapsFinal(){
    MAPS().forEach(m=>{
      const img=mapImages[m.id]||preloadMap(m);
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,N(m.x)*scale+offsetX,N(m.y)*scale+offsetY,N(m.w,1000)*scale,N(m.h,700)*scale);
      else{ctx.fillStyle='#333';ctx.fillRect(N(m.x)*scale+offsetX,N(m.y)*scale+offsetY,N(m.w,1000)*scale,N(m.h,700)*scale);}
      if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.lineWidth=2;ctx.strokeRect(N(m.x)*scale+offsetX,N(m.y)*scale+offsetY,N(m.w,1000)*scale,N(m.h,700)*scale);}
    });
  }
  function drawWallsDoorsFinal(){
    if(!isMaster())return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';
    W().forEach(w=>{if(!w||!w[0]||!w[1])return;ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});
    D().forEach(d=>{if(!d||!d.wall)return;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();});
    ctx.restore();
  }
  function drawFogFinal(){
    if(isMaster()||!fogEnabled||globalLight)return;
    const own=ownToken(); if(!own)return;
    ctx.fillStyle='rgba(0,0,0,.92)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();ctx.arc(N(own.x)*scale+offsetX,N(own.y)*scale+offsetY,lightRadius(own)*scale,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation='source-over';
  }
  function drawLightAndRulerFinal(){
    if(isMaster()){
      P().filter(p=>!p.isNpc).forEach(p=>{ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);ctx.beginPath();ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,lightRadius(p)*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);});
    }
    if(ruler){ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ruler.a[0]*scale+offsetX,ruler.a[1]*scale+offsetY);ctx.lineTo(ruler.b[0]*scale+offsetX,ruler.b[1]*scale+offsetY);ctx.stroke();}
  }
  const oldDraw=window.draw;
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    drawMapsFinal();
    drawWallsDoorsFinal();
    drawLightAndRulerFinal();
    drawFogFinal();
    P().forEach(p=>window.drawToken(p));
  };

  socket.on('doorsUpdated',ds=>{doors=ds||[];requestDraw();});
  console.log('Patch física/luz/token/portas aplicado.');
})();


// ===== PATCH MOBILE MOVIMENTO SUAVE + NEVOA CORRETA + PAREDE LIVRE =====
(function(){
  if(window.__TAVERNA_MOBILE_MOV_FOG_WALLS__) return;
  window.__TAVERNA_MOBILE_MOV_FOG_WALLS__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function W(){return A(walls)}
  function D(){return A(doors)}
  function MAPS(){return A(maps)}

  let usingTouch=false;
  let pinch=null;

  // ---------- imagem/cache ----------
  function imgMap(m){preloadMap&&preloadMap(m);return mapImages[m.id]}
  function imgToken(p){preloadToken&&preloadToken(p);return tokenImages[p.id]}

  // ---------- luz/névoa ----------
  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }
  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) || P().find(p=>!p.isNpc&&p.id===me?.pid) || P().find(p=>!p.isNpc);
  }
  function fogOn(){return !!fogEnabled && !globalLight}
  function visibleToClient(p){
    if(isMaster()) return true;
    if(!fogOn()) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  // ---------- colisão ----------
  function ccw(a,b,c){return (c[1]-a[1])*(b[0]-a[0])>(b[1]-a[1])*(c[0]-a[0])}
  function intersect(a,b,c,d){return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d)}
  function blockSegments(){
    const segs=[];
    W().forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});
    D().forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});
    return segs;
  }
  function blocked(x1,y1,x2,y2){
    const a=[x1,y1],b=[x2,y2];
    return blockSegments().some(s=>intersect(a,b,s[0],s[1]));
  }
  function mapAt(x,y){
    for(let i=MAPS().length-1;i>=0;i--){
      const m=MAPS()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }
  function clampMap(p){
    let m=mapAt(N(p.x),N(p.y)) || MAPS().find(mm=>mm.id===p.mapId) || MAPS()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // ---------- desenho livre de parede/porta ----------
  let freeDrawStart=null;
  function emitWallOrDoor(a,b){
    if(!isMaster())return;
    if(drawTool==='door') socket.emit('addDoor',{room:R(),door:{wall:[a,b],open:false}});
    else socket.emit('addWall',{room:R(),wall:[a,b]});
  }

  // ---------- porta mobile: toque longo ----------
  let holdTimer=null, holdPoint=null;
  function distPointSeg(px,py,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  function toggleDoorNear(x,y){
    if(!isMaster())return false;
    let best=-1,bd=9999;
    D().forEach((d,i)=>{if(!d||!d.wall)return;const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);if(dd<bd){bd=dd;best=i}});
    if(best>=0&&bd<25){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw();
      return true;
    }
    return false;
  }

  // ---------- movimento suave ----------
  let drag=null, dragOff=[0,0], lastGood=null, lastSend=0;
  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i];
      if(!isMaster()&&(p.isNpc||p.ownerId!==me?.pid))continue;
      const rad=p.tokenStyle==='standee'?Math.max(24,N(p.spriteH,65)*.45):Math.max(20,N(p.spriteW,32));
      if(Math.hypot(N(p.x)-x,N(p.y)-y)<=rad)return p;
    }
    return null;
  }

  // substitui handlers principais por captura e bloqueio quando pega token/parede.
  function startPointer(ev){
    if(ev.pointerType==='touch') usingTouch=true;
    if(usingTouch && ev.pointerType==='mouse') return false;
    const [x,y]=worldPos(ev);

    if(isMaster()){
      clearTimeout(holdTimer);
      holdPoint=[x,y];
      holdTimer=setTimeout(()=>{toggleDoorNear(holdPoint[0],holdPoint[1]);},600);
    }

    if(tool==='draw'&&isMaster()){
      freeDrawStart=[x,y]; // livre: sem snap no grid
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
      return true;
    }

    if(tool==='move'){
      const p=hitToken(x,y);
      if(p){
        drag=p;selectedId=p.id;dragOff=[N(p.x)-x,N(p.y)-y];lastGood={x:N(p.x),y:N(p.y),mapId:p.mapId};
        ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
        return true;
      }
    }
    return false;
  }
  function movePointer(ev){
    if(holdTimer){clearTimeout(holdTimer);holdTimer=null;}
    if(ev.pointerType==='touch') usingTouch=true;
    if(usingTouch && ev.pointerType==='mouse') return false;
    const [x,y]=worldPos(ev);

    if(freeDrawStart){
      // só preview via ruler temporário local
      ruler={a:freeDrawStart,b:[x,y]};
      requestDraw();
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
      return true;
    }

    if(drag){
      const oldX=N(drag.x), oldY=N(drag.y);
      let nx=x+dragOff[0], ny=y+dragOff[1];

      // colisão: não teleporta, apenas segura no último ponto válido
      if(blocked(oldX,oldY,nx,ny)){
        nx=lastGood.x;ny=lastGood.y;
      }

      drag.x=nx;drag.y=ny;clampMap(drag);

      if(!blocked(oldX,oldY,drag.x,drag.y)){
        lastGood={x:drag.x,y:drag.y,mapId:drag.mapId};
      }

      const dx=drag.x-oldX;
      if(Math.abs(dx)>0.5) drag.facing=dx>=0?-1:1;

      // movimento local imediato, rede com throttle
      const now=Date.now();
      if(now-lastSend>90){
        lastSend=now;
        socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
      }
      requestDraw();
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
      return true;
    }
    return false;
  }
  function endPointer(ev){
    if(holdTimer){clearTimeout(holdTimer);holdTimer=null;}

    if(freeDrawStart){
      const [x,y]=worldPos(ev.changedTouches?ev.changedTouches[0]:ev);
      emitWallOrDoor(freeDrawStart,[x,y]);
      freeDrawStart=null;
      ruler=null;
      ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
      return true;
    }

    if(drag){
      socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
      drag=null;lastGood=null;
      ev.preventDefault&&ev.preventDefault();
      return true;
    }
    return false;
  }

  canvas.addEventListener('pointerdown',startPointer,true);
  window.addEventListener('pointermove',movePointer,true);
  window.addEventListener('pointerup',endPointer,true);
  window.addEventListener('pointercancel',endPointer,true);

  // pinch zoom mobile
  let touches=new Map();
  canvas.addEventListener('touchstart',e=>{
    usingTouch=true;
    for(const t of e.changedTouches) touches.set(t.identifier,{x:t.clientX,y:t.clientY});
    if(touches.size===2){
      const pts=[...touches.values()];
      pinch={dist:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),scale,mid:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}};
    }
  },{passive:false});
  canvas.addEventListener('touchmove',e=>{
    for(const t of e.changedTouches) touches.set(t.identifier,{x:t.clientX,y:t.clientY});
    if(pinch&&touches.size===2){
      e.preventDefault();
      const pts=[...touches.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      const wx=(pinch.mid.x-offsetX)/pinch.scale, wy=(pinch.mid.y-offsetY)/pinch.scale;
      scale=Math.max(.08,Math.min(12,pinch.scale*(dist/pinch.dist)));
      offsetX=mid.x-wx*scale;offsetY=mid.y-wy*scale;
      requestDraw();
    }
  },{passive:false});
  canvas.addEventListener('touchend',e=>{
    for(const t of e.changedTouches) touches.delete(t.identifier);
    if(touches.size<2)pinch=null;
  },{passive:false});

  // ---------- render final com névoa certa ----------
  window.drawToken=function(p){
    if(!visibleToClient(p))return;
    const img=imgToken(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}
      else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
    }
  };

  function drawMapsFinal(){
    MAPS().forEach(m=>{
      const img=imgMap(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
    });
  }
  function drawWallsDoorsFinal(){
    if(!isMaster())return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';
    W().forEach(w=>{if(!w||!w[0]||!w[1])return;ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});
    D().forEach(d=>{if(!d||!d.wall)return;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();});
    ctx.restore();
  }
  function drawFogFinal(){
    if(isMaster()||!fogOn())return;
    const own=ownToken();if(!own)return;
    // cobre tudo
    ctx.fillStyle='rgba(0,0,0,.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    // fura o círculo da luz: mapa + tokens/NPC desenhados depois aparecem dentro
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();ctx.arc(N(own.x)*scale+offsetX,N(own.y)*scale+offsetY,lightRadius(own)*scale,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation='source-over';
  }
  function drawHUD(){
    if(isMaster()){
      P().filter(p=>!p.isNpc).forEach(p=>{ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);ctx.beginPath();ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,lightRadius(p)*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);});
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{const sp=globalSpawns[k];if(!sp)return;const x=N(sp.x)*scale+offsetX,y=N(sp.y)*scale+offsetY;ctx.fillStyle='rgba(0,0,0,.85)';ctx.strokeStyle=c;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='21px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ic,x,y);});
    }
    if(ruler){ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ruler.a[0]*scale+offsetX,ruler.a[1]*scale+offsetY);ctx.lineTo(ruler.b[0]*scale+offsetX,ruler.b[1]*scale+offsetY);ctx.stroke();}
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsFinal();
    drawWallsDoorsFinal();
    drawHUD();

    // jogador: mapa existe embaixo, névoa cobre, luz fura
    drawFogFinal();

    // tokens por cima, mas a função filtra NPC fora da luz
    P().forEach(p=>window.drawToken(p));
  };

  socket.on('doorsUpdated',ds=>{doors=ds||[];requestDraw();});
  console.log('Patch mobile/movimento/névoa/parede livre aplicado.');
})();


// ===== PATCH FINAL POLIMENTO: DELAY, LUZ, PAREDES, REGUA, MESTRE MOBILE =====
(function(){
  if(window.__TAVERNA_POLIMENTO_DELAY_LUZ_REGUA_MOBILE__) return;
  window.__TAVERNA_POLIMENTO_DELAY_LUZ_REGUA_MOBILE__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function W(){return A(walls)}
  function D(){return A(doors)}
  function MAPS(){return A(maps)}

  // ---------- helpers ----------
  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function imgMap(m){preloadMap&&preloadMap(m);return mapImages[m.id]}
  function imgToken(p){preloadToken&&preloadToken(p);return tokenImages[p.id]}

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }
  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) || P().find(p=>!p.isNpc&&p.id===me?.pid) || P().find(p=>!p.isNpc);
  }
  function fogOn(){return !!fogEnabled && !globalLight}
  function visibleToClient(p){
    if(isMaster()) return true;
    if(!fogOn()) return true;
    const own=ownToken(); if(!own) return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  // ---------- colisão ----------
  function ccw(a,b,c){return (c[1]-a[1])*(b[0]-a[0])>(b[1]-a[1])*(c[0]-a[0])}
  function intersect(a,b,c,d){return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d)}
  function blockSegments(){
    const segs=[];
    W().forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});
    D().forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});
    return segs;
  }
  function blocked(x1,y1,x2,y2){
    const a=[x1,y1],b=[x2,y2];
    return blockSegments().some(s=>intersect(a,b,s[0],s[1]));
  }
  function mapAt(x,y){
    for(let i=MAPS().length-1;i>=0;i--){
      const m=MAPS()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }
  function clampMap(p){
    let m=mapAt(N(p.x),N(p.y)) || MAPS().find(mm=>mm.id===p.mapId) || MAPS()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // ---------- movimento: menos delay ----------
  let drag=null, dragOff=[0,0], lastGood=null, lastEmit=0, lastLocalFrame=0;
  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i];
      if(!isMaster()&&(p.isNpc||p.ownerId!==me?.pid))continue;
      const rad=p.tokenStyle==='standee'?Math.max(28,N(p.spriteH,65)*.45):Math.max(22,N(p.spriteW,32)*.9);
      if(Math.hypot(N(p.x)-x,N(p.y)-y)<=rad)return p;
    }
    return null;
  }

  function startMove(ev){
    if(tool!=='move')return false;
    const [x,y]=worldPos(ev);
    const p=hitToken(x,y);
    if(!p)return false;
    drag=p;selectedId=p.id;
    dragOff=[N(p.x)-x,N(p.y)-y];
    lastGood={x:N(p.x),y:N(p.y),mapId:p.mapId};
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function moveMove(ev){
    if(!drag)return false;
    const [x,y]=worldPos(ev);
    const oldX=N(drag.x), oldY=N(drag.y);
    let nx=x+dragOff[0], ny=y+dragOff[1];

    if(blocked(oldX,oldY,nx,ny)){ nx=lastGood.x; ny=lastGood.y; }

    drag.x=nx;drag.y=ny;clampMap(drag);
    if(!blocked(oldX,oldY,drag.x,drag.y)) lastGood={x:drag.x,y:drag.y,mapId:drag.mapId};

    const dx=drag.x-oldX;
    if(Math.abs(dx)>0.35)drag.facing=dx>=0?-1:1;

    // local imediato: redesenha toda movimentação
    const now=performance.now();
    if(now-lastLocalFrame>8){ lastLocalFrame=now; requestDraw(); }

    // rede mais rápida, mas sem flood absurdo
    if(now-lastEmit>28){
      lastEmit=now;
      socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
    }

    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function endMove(ev){
    if(!drag)return false;
    socket.emit('move',{room:R(),id:drag.id,x:drag.x,y:drag.y,mapId:drag.mapId,tokenStyle:drag.tokenStyle,spriteW:drag.spriteW,spriteH:drag.spriteH,facing:drag.facing});
    drag=null;lastGood=null;
    requestDraw();
    ev&&ev.preventDefault&&ev.preventDefault();
    return true;
  }
  canvas.addEventListener('pointerdown',startMove,true);
  window.addEventListener('pointermove',moveMove,true);
  window.addEventListener('pointerup',endMove,true);
  window.addEventListener('pointercancel',endMove,true);

  // ignora ecos atrasados do servidor enquanto arrasta o próprio token
  const oldPMHandlers=true;
  socket.on('playerMoved',p=>{
    if(drag&&p&&p.id===drag.id)return;
  });

  // ---------- paredes mais livres ----------
  let wallFreeStart=null, wallPreview=null;
  function startWallFree(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    wallFreeStart=[x,y]; wallPreview={a:wallFreeStart,b:wallFreeStart};
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw();
    return true;
  }
  function moveWallFree(ev){
    if(!wallFreeStart)return false;
    const [x,y]=worldPos(ev);
    wallPreview={a:wallFreeStart,b:[x,y]};
    requestDraw();
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function endWallFree(ev){
    if(!wallFreeStart)return false;
    const [x,y]=worldPos(ev);
    const a=wallFreeStart,b=[x,y];
    if(Math.hypot(b[0]-a[0],b[1]-a[1])>4){
      if(drawTool==='door')socket.emit('addDoor',{room:R(),door:{wall:[a,b],open:false}});
      else socket.emit('addWall',{room:R(),wall:[a,b]});
    }
    wallFreeStart=null;wallPreview=null;
    requestDraw();
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  canvas.addEventListener('pointerdown',startWallFree,true);
  window.addEventListener('pointermove',moveWallFree,true);
  window.addEventListener('pointerup',endWallFree,true);

  // ---------- mestre mobile ----------
  // Botão de porta no celular: escolha ferramenta porta e toque longo ou toque perto da porta.
  window.openNearestDoorMobile=function(){
    if(!isMaster())return;
    alert('Toque perto de uma porta fechada no mapa para abrir/fechar.');
    window.__doorMobileMode=true;
  };
  function distPointSeg(px,py,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  function toggleDoorNear(x,y){
    let best=-1,bd=9999;
    D().forEach((d,i)=>{if(!d||!d.wall)return;const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);if(dd<bd){bd=dd;best=i}});
    if(best>=0&&bd<30){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw();
      return true;
    }
    return false;
  }
  canvas.addEventListener('pointerdown',ev=>{
    if(!isMaster()||!window.__doorMobileMode)return;
    const [x,y]=worldPos(ev);
    if(toggleDoorNear(x,y)){
      window.__doorMobileMode=false;
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    }
  },true);

  function ensureMobileMasterButtons(){
    if(!isMaster())return;
    const tb=document.getElementById('toolbar');
    if(tb&&!document.getElementById('btnDoorMobile')){
      const b=document.createElement('button');
      b.id='btnDoorMobile';b.textContent='🚪 Porta';b.title='Abrir/fechar porta no celular';b.onclick=openNearestDoorMobile;
      tb.appendChild(b);
    }
  }
  setTimeout(ensureMobileMasterButtons,800);

  // ---------- render: mapa dentro da luz ----------
  window.drawToken=function(p){
    if(!visibleToClient(p))return;
    const img=imgToken(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}
      else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
    }
  };
  function drawMapsFinal(){
    MAPS().forEach(m=>{
      const img=imgMap(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
    });
  }
  function drawWallsDoorsFinal(){
    if(!isMaster())return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';
    W().forEach(w=>{if(!w||!w[0]||!w[1])return;ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});
    D().forEach(d=>{if(!d||!d.wall)return;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();});
    if(wallPreview){ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';ctx.lineWidth=2/scale;ctx.setLineDash([8/scale,6/scale]);ctx.beginPath();ctx.moveTo(wallPreview.a[0],wallPreview.a[1]);ctx.lineTo(wallPreview.b[0],wallPreview.b[1]);ctx.stroke();ctx.setLineDash([]);}
    ctx.restore();
  }
  function drawFogFinal(){
    if(isMaster()||!fogOn())return;
    const own=ownToken();if(!own)return;
    // mapa já foi desenhado, agora cobre tudo fora da luz
    ctx.fillStyle='rgba(0,0,0,.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(N(own.x)*scale+offsetX,N(own.y)*scale+offsetY,lightRadius(own)*scale,0,Math.PI*2);
    ctx.fill();
    ctx.globalCompositeOperation='source-over';
  }
  function drawRulerDetailed(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:ruler;
    if(!rr||!rr.a||!rr.b)return;
    const ax=rr.a[0]*scale+offsetX,ay=rr.a[1]*scale+offsetY,bx=rr.b[0]*scale+offsetX,by=rr.b[1]*scale+offsetY;
    const distPx=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);
    const ft=distPx/10, m=ft*0.3048, squares=distPx/50;
    ctx.save();
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
    ctx.fillStyle='rgba(0,0,0,.82)';
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillRect(tx+8,ty-38,168,50);
    ctx.fillStyle='#00e5ff';ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-22);
    ctx.fillText(`${m.toFixed(1)} m | ${squares.toFixed(1)} quadrados`,tx+14,ty-6);
    ctx.restore();
  }
  function drawHUD(){
    if(isMaster()){
      P().filter(p=>!p.isNpc).forEach(p=>{ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);ctx.beginPath();ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,lightRadius(p)*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);});
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{const sp=globalSpawns[k];if(!sp)return;const x=N(sp.x)*scale+offsetX,y=N(sp.y)*scale+offsetY;ctx.fillStyle='rgba(0,0,0,.85)';ctx.strokeStyle=c;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.font='21px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ic,x,y);});
    }
    drawRulerDetailed();
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsFinal();
    drawWallsDoorsFinal();
    drawHUD();

    // primeiro a névoa fura o mapa; depois tokens visíveis aparecem por cima.
    drawFogFinal();

    P().forEach(p=>window.drawToken(p));
  };

  console.log('Patch final polimento aplicado.');
})();


// ===== PATCH MOBILE PAN/ZOOM CORRIGIDO =====
(function(){
  if(window.__TAVERNA_MOBILE_PAN_ZOOM_FIX__) return;
  window.__TAVERNA_MOBILE_PAN_ZOOM_FIX__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function isTouchEvent(e){return e.pointerType==='touch' || e.type.startsWith('touch')}
  function clampZoom(v){return Math.max(0.08,Math.min(12,v))}
  function request(){requestDraw&&requestDraw()}

  let panDrag=false;
  let panStart=null;
  let pinch=null;
  const activeTouches=new Map();

  function stop(e){
    e.preventDefault&&e.preventDefault();
    e.stopPropagation&&e.stopPropagation();
    e.stopImmediatePropagation&&e.stopImmediatePropagation();
  }

  // PAN DO MAPA: só quando ferramenta mão/pan estiver ativa.
  function panDown(e){
    if(tool!=='pan') return false;
    panDrag=true;
    panStart={x:e.clientX,y:e.clientY,ox:offsetX,oy:offsetY};
    stop(e);
    return true;
  }
  function panMove(e){
    if(!panDrag) return false;
    offsetX=panStart.ox+(e.clientX-panStart.x);
    offsetY=panStart.oy+(e.clientY-panStart.y);
    request();
    stop(e);
    return true;
  }
  function panUp(e){
    if(!panDrag) return false;
    panDrag=false;
    stop(e);
    return true;
  }

  canvas.addEventListener('pointerdown',panDown,true);
  window.addEventListener('pointermove',panMove,true);
  window.addEventListener('pointerup',panUp,true);
  window.addEventListener('pointercancel',panUp,true);

  // PINCH ZOOM: dois dedos sempre fazem zoom, independente da ferramenta.
  canvas.addEventListener('touchstart',e=>{
    for(const t of e.changedTouches){
      activeTouches.set(t.identifier,{x:t.clientX,y:t.clientY});
    }
    if(activeTouches.size===2){
      const pts=[...activeTouches.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      pinch={
        dist,
        scale,
        offsetX,
        offsetY,
        mid,
        wx:(mid.x-offsetX)/scale,
        wy:(mid.y-offsetY)/scale
      };
      panDrag=false;
      e.preventDefault();
      e.stopPropagation();
    }
  },{capture:true,passive:false});

  canvas.addEventListener('touchmove',e=>{
    for(const t of e.changedTouches){
      if(activeTouches.has(t.identifier)) activeTouches.set(t.identifier,{x:t.clientX,y:t.clientY});
    }
    if(pinch && activeTouches.size>=2){
      const pts=[...activeTouches.values()].slice(0,2);
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const mid={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      scale=clampZoom(pinch.scale*(dist/Math.max(1,pinch.dist)));
      offsetX=mid.x-pinch.wx*scale;
      offsetY=mid.y-pinch.wy*scale;
      request();
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  },{capture:true,passive:false});

  canvas.addEventListener('touchend',e=>{
    for(const t of e.changedTouches) activeTouches.delete(t.identifier);
    if(activeTouches.size<2) pinch=null;
  },{capture:true,passive:false});

  canvas.addEventListener('touchcancel',e=>{
    for(const t of e.changedTouches) activeTouches.delete(t.identifier);
    if(activeTouches.size<2) pinch=null;
  },{capture:true,passive:false});

  // WHEEL ZOOM desktop/mousepad: zoom no ponto do cursor.
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const mx=e.clientX,my=e.clientY;
    const wx=(mx-offsetX)/scale;
    const wy=(my-offsetY)/scale;
    const factor=e.deltaY<0?1.12:0.88;
    scale=clampZoom(scale*factor);
    offsetX=mx-wx*scale;
    offsetY=my-wy*scale;
    request();
  },{capture:true,passive:false});

  // Garante que o botão mão deixe claro que é só mover mapa.
  const oldSetTool=window.setTool;
  window.setTool=function(t){
    if(oldSetTool) oldSetTool(t);
    tool=t;
    if(t==='pan'){
      canvas.style.cursor='grab';
    }else if(t==='move'){
      canvas.style.cursor='default';
    }
  };

  console.log('Mobile pan/zoom corrigido: mão move mapa, pinça dá zoom.');
})();


// ===== FIX FINAL LUZ E NEVOA: MAPA DENTRO DA LUZ =====
(function(){
  if(window.__TAVERNA_FIX_FINAL_LUZ_NEVOA_MAPA__) return;
  window.__TAVERNA_FIX_FINAL_LUZ_NEVOA_MAPA__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function P(){return A(players)}
  function MAPS(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogOn(){
    return !!fogEnabled && !globalLight;
  }

  function insideOwnLight(p){
    if(isMaster()) return true;
    if(!fogOn()) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function') preloadMap(m);
    return mapImages[m.id];
  }

  function getTokenImg(p){
    if(typeof preloadToken==='function') preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapLayer(){
    MAPS().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX;
      const y=N(m.y)*scale+offsetY;
      const w=N(m.w,1000)*scale;
      const h=N(m.h,700)*scale;

      if(img&&img.complete&&img.naturalWidth){
        ctx.drawImage(img,x,y,w,h);
      }else{
        ctx.fillStyle='#333';
        ctx.fillRect(x,y,w,h);
      }

      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsForMaster(){
    if(!isMaster()) return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawFogCutByPlayerLight(){
    if(isMaster()) return;
    if(!fogOn()) return;

    const own=ownToken();
    if(!own) return;

    const x=N(own.x)*scale+offsetX;
    const y=N(own.y)*scale+offsetY;
    const r=lightRadius(own)*scale;

    // 1) cobre tudo com preto
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,0.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // 2) fura a névoa com preto sólido no destination-out
    // isso revela o mapa que já foi desenhado embaixo
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p || !insideOwnLight(p)) return;

    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX;
    const y=N(p.y)*scale+offsetY;

    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));

      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawMasterLightLinesAndSpawn(){
    if(!isMaster()) return;

    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];
        if(!sp)return;
        const x=N(sp.x)*scale+offsetX;
        const y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';
        ctx.strokeStyle=c;
        ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(x,y,22,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='21px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(ic,x,y);
      });
    }
  }

  function drawRulerLayer(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX;
    const ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX;
    const by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10;
    const mt=ft*0.3048;

    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();

    ctx.fillStyle='rgba(0,0,0,.82)';
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillRect(tx+8,ty-38,150,48);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-22);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-6);
  }

  // ORDEM FINAL:
  // 1 mapa
  // 2 paredes/linhas do mestre
  // 3 névoa furada pela luz
  // 4 tokens/NPC dentro da luz
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapLayer();
    drawWallsDoorsForMaster();
    drawMasterLightLinesAndSpawn();
    drawRulerLayer();

    // Aqui a névoa cobre tudo, mas abre a luz e deixa o mapa aparecer embaixo.
    drawFogCutByPlayerLight();

    // Tokens por cima, filtrados pela luz.
    P().forEach(p=>window.drawToken(p));
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix final luz/nevoa aplicado: mapa aparece dentro da luz.');
})();


// ===== FIX REGUA FINAL: NAO SOME TOKENS =====
(function(){
  if(window.__TAVERNA_FIX_REGUA_FINAL__) return;
  window.__TAVERNA_FIX_REGUA_FINAL__=true;

  let localRuler=null;
  let measuring=false;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function isMaster(){return !!(me&&me.isMaster)}
  function P(){return A(players)}
  function MAPS(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  // Régua própria, em captura, sem mexer em tokens.
  function rulerDown(ev){
    if(tool!=='ruler') return false;
    const [x,y]=worldPos(ev);
    measuring=true;
    localRuler={a:[x,y],b:[x,y],owner:me?.pid||'local'};
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw();
    return true;
  }

  function rulerMove(ev){
    if(!measuring) return false;
    const [x,y]=worldPos(ev);
    localRuler.b=[x,y];
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw();
    return true;
  }

  function rulerUp(ev){
    if(!measuring) return false;
    measuring=false;
    // Mantém a régua visível por 1.5s antes de limpar.
    const finalRuler=localRuler;
    ruler=finalRuler;
    socket.emit('setRuler',{room:R(),ruler:finalRuler});
    setTimeout(()=>{
      if(ruler===finalRuler){
        ruler=null;
        localRuler=null;
        socket.emit('setRuler',{room:R(),ruler:null});
        requestDraw();
      }
    },1500);
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',rulerDown,true);
  window.addEventListener('pointermove',rulerMove,true);
  window.addEventListener('pointerup',rulerUp,true);
  window.addEventListener('pointercancel',rulerUp,true);

  socket.on('rulerUpdated',r=>{
    ruler=r||null;
    requestDraw();
  });

  // Repõe visibilidade de token: régua nunca deve esconder token.
  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }
  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }
  function fogOn(){return !!fogEnabled && !globalLight}
  function visibleToken(p){
    if(isMaster())return true;
    if(!fogOn())return true;
    const own=ownToken();
    if(!own)return true;
    if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y))<=lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function')preloadMap(m);
    return mapImages[m.id];
  }
  function getTokenImg(p){
    if(typeof preloadToken==='function')preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapsLayer(){
    MAPS().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsLayer(){
    if(!isMaster())return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';
    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
      ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();
    });
    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;
      ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();
    });
    ctx.restore();
  }

  function drawFogLayer(){
    if(isMaster()||!fogOn())return;
    const own=ownToken(); if(!own)return;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(N(own.x)*scale+offsetX,N(own.y)*scale+offsetY,lightRadius(own)*scale,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p||!visibleToken(p))return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();
      }else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fff';ctx.stroke();
    }
  };

  function drawRulerLayer(){
    const rr=localRuler||ruler;
    if(!rr||!rr.a||!rr.b)return;
    const ax=rr.a[0]*scale+offsetX, ay=rr.a[1]*scale+offsetY;
    const bx=rr.b[0]*scale+offsetX, by=rr.b[1]*scale+offsetY;
    const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();

    ctx.fillStyle='rgba(0,0,0,.86)';
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  function drawMasterHUD(){
    if(!isMaster())return;
    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);
    });
    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];if(!sp)return;
        const x=N(sp.x)*scale+offsetX,y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';ctx.strokeStyle=c;ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle='#fff';ctx.font='21px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ic,x,y);
      });
    }
  }

  // Ordem corrigida:
  // mapa -> paredes -> HUD mestre -> névoa -> tokens -> régua por cima
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsLayer();
    drawWallsDoorsLayer();
    drawMasterHUD();
    drawFogLayer();

    P().forEach(p=>window.drawToken(p));

    // régua sempre por último para mestre e jogador
    drawRulerLayer();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix régua final aplicado.');
})();


// ===== FIX MOBILE TOKEN + LUZ MAPA + FACING =====
(function(){
  if(window.__TAVERNA_FIX_MOBILE_TOKEN_LUZ_FACING__) return;
  window.__TAVERNA_FIX_MOBILE_TOKEN_LUZ_FACING__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function MAPS(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  // Problema 1:
  // no celular existiam vários handlers touch/pointer brigando; alguns paravam o evento antes do token.
  // Esta camada captura o toque primeiro quando tool === move e move localmente.
  let mobileDrag=null;
  let mobileOff=[0,0];
  let lastEmit=0;

  function worldPosFromClient(clientX,clientY){
    const r=canvas.getBoundingClientRect();
    return [(clientX-r.left-offsetX)/scale,(clientY-r.top-offsetY)/scale];
  }

  function canControl(p){
    if(!p||!me)return false;
    if(isMaster())return true;
    return !p.isNpc && (p.ownerId===me.pid || p.id===me.pid);
  }

  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i];
      if(!canControl(p))continue;
      const rad=p.tokenStyle==='standee'?Math.max(34,N(p.spriteH,65)*0.55):Math.max(28,N(p.spriteW,32)*1.2);
      if(Math.hypot(N(p.x)-x,N(p.y)-y)<=rad)return p;
    }
    return null;
  }

  function mapAt(x,y){
    for(let i=MAPS().length-1;i>=0;i--){
      const m=MAPS()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }

  function clampMap(p){
    let m=mapAt(N(p.x),N(p.y)) || MAPS().find(mm=>mm.id===p.mapId) || MAPS()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  function emitMove(p,force=false){
    const now=performance.now();
    if(!force && now-lastEmit<24)return;
    lastEmit=now;
    socket.emit('move',{
      room:R(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,
      tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH,facing:p.facing
    });
  }

  function startTokenTouch(e){
    if(tool!=='move')return false;
    const touch=e.touches&&e.touches.length===1?e.touches[0]:null;
    if(!touch)return false;
    const [x,y]=worldPosFromClient(touch.clientX,touch.clientY);
    const p=hitToken(x,y);
    if(!p)return false;
    mobileDrag=p;
    selectedId=p.id;
    mobileOff=[N(p.x)-x,N(p.y)-y];
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function moveTokenTouch(e){
    if(!mobileDrag)return false;
    const touch=e.touches&&e.touches.length===1?e.touches[0]:null;
    if(!touch)return false;

    const [x,y]=worldPosFromClient(touch.clientX,touch.clientY);
    const oldX=N(mobileDrag.x);
    mobileDrag.x=x+mobileOff[0];
    mobileDrag.y=y+mobileOff[1];
    clampMap(mobileDrag);

    const dx=mobileDrag.x-oldX;
    // Problema 3: miniatura não virava porque o facing não era atualizado no touch.
    // Mantém padrão: indo para direita => facing -1; esquerda => 1.
    if(Math.abs(dx)>0.4) mobileDrag.facing=dx>=0?-1:1;

    emitMove(mobileDrag,false);
    requestDraw&&requestDraw();

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return true;
  }

  function endTokenTouch(e){
    if(!mobileDrag)return false;
    emitMove(mobileDrag,true);
    mobileDrag=null;
    e.preventDefault&&e.preventDefault();
    e.stopPropagation&&e.stopPropagation();
    e.stopImmediatePropagation&&e.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('touchstart',startTokenTouch,{capture:true,passive:false});
  canvas.addEventListener('touchmove',moveTokenTouch,{capture:true,passive:false});
  canvas.addEventListener('touchend',endTokenTouch,{capture:true,passive:false});
  canvas.addEventListener('touchcancel',endTokenTouch,{capture:true,passive:false});

  // Desktop/pointer também atualiza facing corretamente.
  canvas.addEventListener('pointerdown',ev=>{
    if(ev.pointerType==='touch')return;
    if(tool!=='move')return;
    const [x,y]=worldPosFromClient(ev.clientX,ev.clientY);
    const p=hitToken(x,y);
    if(p){mobileDrag=p;selectedId=p.id;mobileOff=[N(p.x)-x,N(p.y)-y];}
  },true);
  window.addEventListener('pointermove',ev=>{
    if(ev.pointerType==='touch')return;
    if(!mobileDrag)return;
    const [x,y]=worldPosFromClient(ev.clientX,ev.clientY);
    const oldX=N(mobileDrag.x);
    mobileDrag.x=x+mobileOff[0];mobileDrag.y=y+mobileOff[1];clampMap(mobileDrag);
    const dx=mobileDrag.x-oldX;
    if(Math.abs(dx)>0.4)mobileDrag.facing=dx>=0?-1:1;
    emitMove(mobileDrag,false);
    requestDraw&&requestDraw();
  },true);
  window.addEventListener('pointerup',ev=>{
    if(ev.pointerType==='touch')return;
    if(mobileDrag){emitMove(mobileDrag,true);mobileDrag=null;}
  },true);

  // Problema 2:
  // o mapa não aparecia dentro da luz porque alguns renders antigos desenhavam token depois da névoa,
  // mas o mapa estava sendo coberto sem recorte certo. Aqui a ordem é fixa:
  // mapa -> paredes mestre -> névoa recortada -> tokens visíveis -> régua por cima.
  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogOn(){
    return !!fogEnabled && !globalLight;
  }

  function visibleToClient(p){
    if(isMaster())return true;
    if(!fogOn())return true;
    const own=ownToken();
    if(!own)return true;
    if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y))<=lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function')preloadMap(m);
    return mapImages[m.id];
  }

  function getTokenImg(p){
    if(typeof preloadToken==='function')preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapsLayer(){
    MAPS().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsLayer(){
    if(!isMaster())return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });
    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawFogLayer(){
    if(isMaster()||!fogOn())return;
    const own=ownToken();
    if(!own)return;
    const x=N(own.x)*scale+offsetX;
    const y=N(own.y)*scale+offsetY;
    const r=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';

    // cobre tudo
    ctx.fillStyle='rgba(0,0,0,0.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // fura 100% a luz; revela o mapa já desenhado embaixo.
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p||!visibleToClient(p))return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawRulerLayer(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX,ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX,by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10,mt=ft*0.3048,sq=dist/50;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  function drawMasterHUD(){
    if(!isMaster())return;
    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsLayer();
    drawWallsDoorsLayer();
    drawMasterHUD();
    drawFogLayer();
    P().forEach(p=>window.drawToken(p));
    drawRulerLayer();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix mobile token + luz mapa + facing aplicado.');
})();


// ===== FIX FINAL WALLS DOORS SYNC FOG =====
(function(){
  if(window.__TAVERNA_FIX_WALLS_SYNC_FOG__) return;
  window.__TAVERNA_FIX_WALLS_SYNC_FOG__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function MAPS(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  // ---------- SINCRONIZAÇÃO FORTE ----------
  function mergePlayer(p){
    if(!p||!p.id)return;
    const i=players.findIndex(x=>String(x.id)===String(p.id));
    if(i>=0)players[i]={...players[i],...p}; else players.push(p);
    if(typeof preloadToken==='function')preloadToken(p);
  }

  socket.on('state',s=>{
    if(!s)return;
    if(Array.isArray(s.players))players=s.players;
    if(Array.isArray(s.maps))maps=s.maps;
    if(Array.isArray(s.walls))walls=s.walls;
    if(Array.isArray(s.doors))doors=s.doors;
    if(s.activeMapId!==undefined)activeMapId=s.activeMapId;
    if(s.fogEnabled!==undefined)fogEnabled=!!s.fogEnabled;
    if(s.globalLight!==undefined)globalLight=!!s.globalLight;
    if(s.globalSpawns)globalSpawns=s.globalSpawns;
    if(s.ruler!==undefined)ruler=s.ruler;
    if(typeof preload==='function')preload();
    if(typeof renderMapList==='function')renderMapList();
    if(typeof renderPlayers==='function')renderPlayers();
    requestDraw&&requestDraw();
  });
  socket.on('playerMoved',p=>{mergePlayer(p);requestDraw&&requestDraw();});
  socket.on('playerUpdated',p=>{mergePlayer(p);if(typeof renderPlayers==='function')renderPlayers();requestDraw&&requestDraw();});
  socket.on('wallsUpdated',w=>{walls=A(w);requestDraw&&requestDraw();});
  socket.on('doorsUpdated',d=>{doors=A(d);requestDraw&&requestDraw();});
  socket.on('rulerUpdated',r=>{ruler=r||null;requestDraw&&requestDraw();});

  // updatePlayer local garantido
  const oldSaveSheet=window.saveSheet;
  window.saveSheet=function(){
    const p=players.find(x=>x.id===selectedId);
    if(!p)return oldSaveSheet?oldSaveSheet():undefined;
    p.name=document.getElementById('sName')?.value||p.name;
    p.hp=N(document.getElementById('sHp')?.value,p.hp);
    p.hpmax=N(document.getElementById('sMax')?.value,p.hpmax);
    p.ca=N(document.getElementById('sCa')?.value,p.ca);
    p.light=N(document.getElementById('sLight')?.value,p.light);
    socket.emit('updatePlayer',{room:R(),id:p.id,name:p.name,hp:p.hp,hpmax:p.hpmax,ca:p.ca,light:p.light});
    if(typeof closeSheet==='function')closeSheet();
    requestDraw&&requestDraw();
  };

  // ---------- PAREDES E PORTAS DESENHAM SEMPRE NO MODO DRAW ----------
  let drawStart=null;
  let drawPreview=null;

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  function wallDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    drawStart=[x,y];
    drawPreview={a:[x,y],b:[x,y]};
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function wallMove(ev){
    if(!drawStart)return false;
    const [x,y]=worldPos(ev);
    drawPreview={a:drawStart,b:[x,y]};
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function wallUp(ev){
    if(!drawStart)return false;
    const [x,y]=worldPos(ev);
    const a=drawStart,b=[x,y];
    if(Math.hypot(b[0]-a[0],b[1]-a[1])>4){
      if(drawTool==='door'){
        const door={wall:[a,b],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        const wall=[a,b];
        walls.push(wall);
        socket.emit('addWall',{room:R(),wall});
      }
    }
    drawStart=null;drawPreview=null;
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',wallDown,true);
  window.addEventListener('pointermove',wallMove,true);
  window.addEventListener('pointerup',wallUp,true);
  window.addEventListener('pointercancel',wallUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])wallDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(drawStart&&e.touches&&e.touches[0])wallMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(drawStart){const t=e.changedTouches&&e.changedTouches[0]; if(t)wallUp(t);}}, {capture:true,passive:false});

  // Abrir/fechar porta para mestre: Alt+clique ou botão porta.
  function distPointSeg(px,py,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  function toggleDoorAt(x,y){
    let best=-1,bd=99999;
    D().forEach((d,i)=>{if(!d||!d.wall)return;const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);if(dd<bd){bd=dd;best=i;}});
    if(best>=0&&bd<28){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw&&requestDraw();
      return true;
    }
    return false;
  }
  canvas.addEventListener('pointerdown',ev=>{
    if(!isMaster())return;
    if(!(ev.altKey||window.__doorMobileMode))return;
    const [x,y]=worldPos(ev);
    if(toggleDoorAt(x,y)){
      window.__doorMobileMode=false;
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    }
  },true);

  // ---------- NEVOA CORRETA ----------
  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }
  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }
  function fogOn(){return !!fogEnabled && !globalLight}
  function visibleToClient(p){
    if(isMaster())return true;
    if(!fogOn())return true;
    const own=ownToken();if(!own)return true;
    if(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y))<=lightRadius(own);
  }

  function getMapImg(m){if(typeof preloadMap==='function')preloadMap(m);return mapImages[m.id];}
  function getTokenImg(p){if(typeof preloadToken==='function')preloadToken(p);return tokenImages[p.id];}

  function drawMapsLayer(){
    MAPS().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsLayer(){
    if(!isMaster())return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';
    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
      ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();
    });
    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;
      ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();
    });
    if(drawPreview){
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=2/scale;ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.moveTo(drawPreview.a[0],drawPreview.a[1]);ctx.lineTo(drawPreview.b[0],drawPreview.b[1]);ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawFogLayer(){
    if(isMaster()||!fogOn())return;
    const own=ownToken();if(!own)return;
    const x=N(own.x)*scale+offsetX,y=N(own.y)*scale+offsetY,r=lightRadius(own)*scale;

    // Mapa já está desenhado. Agora cobre tudo e recorta a luz.
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,0.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p||!visibleToClient(p))return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}
      else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#fff';ctx.stroke();
    }
  };

  function drawHUD(){
    if(isMaster()){
      P().filter(p=>!p.isNpc).forEach(p=>{
        const r=lightRadius(p); if(!r)return;
        ctx.strokeStyle='rgba(80,180,255,.85)';ctx.setLineDash([8,6]);
        ctx.beginPath();ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      });
      if(typeof globalSpawns!=='undefined'){
        [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
          const sp=globalSpawns[k]; if(!sp)return;
          const x=N(sp.x)*scale+offsetX,y=N(sp.y)*scale+offsetY;
          ctx.fillStyle='rgba(0,0,0,.85)';ctx.strokeStyle=c;ctx.lineWidth=3;
          ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();ctx.stroke();
          ctx.fillStyle='#fff';ctx.font='21px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(ic,x,y);
        });
      }
    }
  }

  function drawRulerLayer(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX,ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX,by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10,mt=ft*0.3048,sq=dist/50;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  // Ordem definitiva:
  // mapa -> paredes/portas -> HUD mestre -> névoa -> tokens -> régua
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsLayer();
    drawWallsDoorsLayer();
    drawHUD();
    drawFogLayer();
    P().forEach(p=>window.drawToken(p));
    drawRulerLayer();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix walls/doors sync/fog aplicado.');
})();


// ===== FIX DEFINITIVO MAPA TOKEN NEVOA LUZ =====
(function(){
  if(window.__FIX_MAPA_TOKEN_NEVOA_LUZ__) return;
  window.__FIX_MAPA_TOKEN_NEVOA_LUZ__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogActive(){
    return !!fogEnabled && !globalLight;
  }

  function tokenInsidePlayerLight(p){
    if(isMaster()) return true;
    if(!fogActive()) return true;

    const own=ownToken();
    if(!own) return true;

    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;

    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function') preloadMap(m);
    return mapImages[m.id];
  }

  function getTokenImg(p){
    if(typeof preloadToken==='function') preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapsOnly(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX;
      const y=N(m.y)*scale+offsetY;
      const w=N(m.w,1000)*scale;
      const h=N(m.h,700)*scale;

      if(img&&img.complete&&img.naturalWidth){
        ctx.drawImage(img,x,y,w,h);
      }else{
        ctx.fillStyle='#333';
        ctx.fillRect(x,y,w,h);
      }

      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawMasterWallsDoors(){
    if(!isMaster()) return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    ctx.restore();
  }

  function cutFogByPlayerLight(){
    if(isMaster()) return;
    if(!fogActive()) return;

    const own=ownToken();
    if(!own) return;

    const x=N(own.x)*scale+offsetX;
    const y=N(own.y)*scale+offsetY;
    const r=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);

    // cobre o mapa inteiro
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,0.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // abre buraco 100% na luz do jogador
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p || !tokenInsidePlayerLight(p)) return;

    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX;
    const y=N(p.y)*scale+offsetY;

    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));

      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawMasterHud(){
    if(!isMaster()) return;

    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];
        if(!sp)return;
        const x=N(sp.x)*scale+offsetX;
        const y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';
        ctx.strokeStyle=c;
        ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(x,y,22,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='21px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(ic,x,y);
      });
    }
  }

  function drawRulerTop(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX, ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX, by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();

    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  // ORDEM FINAL CORRETA:
  // 1 mapa inteiro
  // 2 paredes/portas só mestre
  // 3 HUD mestre
  // 4 névoa cobre tudo e abre luz
  // 5 tokens/NPCs visíveis dentro da luz
  // 6 régua por cima
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsOnly();
    drawMasterWallsDoors();
    drawMasterHud();

    cutFogByPlayerLight();

    P().forEach(p=>window.drawToken(p));

    drawRulerTop();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix definitivo mapa/token/nevoa/luz aplicado.');
})();


// ===== AJUSTE NECESSARIO NEVOA DESTINATION OUT =====
(function(){
  if(window.__AJUSTE_NEVOA_DESTINATION_OUT__) return;
  window.__AJUSTE_NEVOA_DESTINATION_OUT__ = true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogActive(){
    return !!fogEnabled && !globalLight && !isMaster();
  }

  function insideLight(p){
    if(isMaster()) return true;
    if(!fogEnabled || globalLight) return true;

    const own=ownToken();
    if(!own)return true;

    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;

    return Math.hypot(N(p.x)-N(own.x), N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function') preloadMap(m);
    return mapImages[m.id];
  }

  function getTokenImg(p){
    if(typeof preloadToken==='function') preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapLayer(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX;
      const y=N(m.y)*scale+offsetY;
      const w=N(m.w,1000)*scale;
      const h=N(m.h,700)*scale;

      if(img&&img.complete&&img.naturalWidth){
        ctx.drawImage(img,x,y,w,h);
      }else{
        ctx.fillStyle='#333';
        ctx.fillRect(x,y,w,h);
      }

      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsMaster(){
    if(!isMaster())return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    ctx.restore();
  }

  // Esta é a correção exata da névoa:
  // mapa já desenhado -> preto cobre tudo -> destination-out abre a luz.
  function drawFogDestinationOut(){
    if(!fogActive())return;

    const player=ownToken();
    if(!player)return;

    const x=N(player.x)*scale+offsetX;
    const y=N(player.y)*scale+offsetY;
    const r=lightRadius(player)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);

    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,.96)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p||!insideLight(p))return;

    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX;
    const y=N(p.y)*scale+offsetY;

    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));

      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawMasterHUD(){
    if(!isMaster())return;

    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];
        if(!sp)return;
        const x=N(sp.x)*scale+offsetX;
        const y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';
        ctx.strokeStyle=c;
        ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(x,y,22,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='21px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(ic,x,y);
      });
    }
  }

  function drawRulerTop(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX, ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX, by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();

    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  // ORDEM FINAL:
  // 1 mapa
  // 2 paredes/HUD mestre
  // 3 nevoa destination-out
  // 4 tokens visíveis dentro da luz
  // 5 régua por cima
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapLayer();
    drawWallsDoorsMaster();
    drawMasterHUD();

    drawFogDestinationOut();

    P().forEach(p=>window.drawToken(p));

    drawRulerTop();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Ajuste necessário da névoa aplicado.');
})();


// ===== FIX NEVOA SEGURA + REGUA SOLTOU + PAREDE ONDULADA =====
(function(){
  if(window.__TAVERNA_FIX_FOG_RULER_FREEHAND__) return;
  window.__TAVERNA_FIX_FOG_RULER_FREEHAND__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogActive(){
    return !!fogEnabled && !globalLight && !isMaster();
  }

  function insideLight(p){
    if(isMaster()) return true;
    if(!fogEnabled || globalLight) return true;
    const own=ownToken();
    if(!own)return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function')preloadMap(m);
    return mapImages[m.id];
  }
  function getTokenImg(p){
    if(typeof preloadToken==='function')preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMapLayer(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX;
      const y=N(m.y)*scale+offsetY;
      const w=N(m.w,1000)*scale;
      const h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsMaster(){
    if(!isMaster())return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    ctx.lineJoin='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    if(freeWallPoints && freeWallPoints.length>1){
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=(drawTool==='door'?5:3)/scale;
      ctx.setLineDash(drawTool==='door'?[8/scale,6/scale]:[]);
      ctx.beginPath();
      ctx.moveTo(freeWallPoints[0][0],freeWallPoints[0][1]);
      for(let i=1;i<freeWallPoints.length;i++)ctx.lineTo(freeWallPoints[i][0],freeWallPoints[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawSingleToken(p,force=false){
    if(!force && !insideLight(p))return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX;
    const y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  }
  window.drawToken=function(p){drawSingleToken(p,false);};

  // Névoa segura:
  // 1 mapa
  // 2 tokens todos por baixo
  // 3 névoa cobre tudo
  // 4 destination-out abre a luz
  // 5 redesenha tokens visíveis por cima
  // Assim mapa e token ficam visíveis dentro da luz.
  function drawFogSafe(){
    if(!fogActive())return;
    const own=ownToken();
    if(!own)return;

    const x=N(own.x)*scale+offsetX;
    const y=N(own.y)*scale+offsetY;
    const r=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,.96)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  function drawMasterHUD(){
    if(!isMaster())return;
    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];
        if(!sp)return;
        const x=N(sp.x)*scale+offsetX;
        const y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';
        ctx.strokeStyle=c;
        ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(x,y,22,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='21px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(ic,x,y);
      });
    }
  }

  // -------- RÉGUA: some ao soltar --------
  let localMeasure=null;
  let measureActive=false;

  function rulerDownFix(ev){
    if(tool!=='ruler')return false;
    const [x,y]=worldPos(ev);
    measureActive=true;
    localMeasure={a:[x,y],b:[x,y],owner:me?.pid||'local'};
    ruler=localMeasure;
    socket.emit('setRuler',{room:R(),ruler:localMeasure});
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function rulerMoveFix(ev){
    if(!measureActive)return false;
    const [x,y]=worldPos(ev);
    localMeasure.b=[x,y];
    ruler=localMeasure;
    socket.emit('setRuler',{room:R(),ruler:localMeasure});
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function rulerUpFix(ev){
    if(!measureActive)return false;
    measureActive=false;
    localMeasure=null;
    ruler=null;
    socket.emit('setRuler',{room:R(),ruler:null});
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',rulerDownFix,true);
  window.addEventListener('pointermove',rulerMoveFix,true);
  window.addEventListener('pointerup',rulerUpFix,true);
  window.addEventListener('pointercancel',rulerUpFix,true);

  function drawRulerTop(){
    const rr=localMeasure||ruler;
    if(!rr||!rr.a||!rr.b)return;
    const ax=rr.a[0]*scale+offsetX, ay=rr.a[1]*scale+offsetY;
    const bx=rr.b[0]*scale+offsetX, by=rr.b[1]*scale+offsetY;
    const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  // -------- PAREDE ONDULADA / LIVRE --------
  let freeWallPoints=null;
  let lastWallPoint=null;

  function addPointIfFar(arr,p,min=6){
    if(!arr.length){arr.push(p);return true;}
    const last=arr[arr.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min){arr.push(p);return true;}
    return false;
  }

  function freeWallDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    freeWallPoints=[[x,y]];
    lastWallPoint=[x,y];
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function freeWallMove(ev){
    if(!freeWallPoints)return false;
    const [x,y]=worldPos(ev);
    addPointIfFar(freeWallPoints,[x,y],5);
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function freeWallUp(ev){
    if(!freeWallPoints)return false;
    const [x,y]=worldPos(ev);
    addPointIfFar(freeWallPoints,[x,y],2);

    if(freeWallPoints.length>1){
      if(drawTool==='door'){
        // porta continua reta: primeiro ponto até último ponto.
        const door={wall:[freeWallPoints[0],freeWallPoints[freeWallPoints.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        // parede ondulada vira vários segmentos.
        for(let i=1;i<freeWallPoints.length;i++){
          const wall=[freeWallPoints[i-1],freeWallPoints[i]];
          walls.push(wall);
          socket.emit('addWall',{room:R(),wall});
        }
      }
    }

    freeWallPoints=null;
    lastWallPoint=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',freeWallDown,true);
  window.addEventListener('pointermove',freeWallMove,true);
  window.addEventListener('pointerup',freeWallUp,true);
  window.addEventListener('pointercancel',freeWallUp,true);

  // Render final.
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapLayer();
    drawWallsDoorsMaster();
    drawMasterHUD();

    if(fogActive()){
      // Desenha tokens antes para eles existirem por baixo da máscara aberta.
      P().forEach(p=>drawSingleToken(p,true));
      drawFogSafe();
      // Reforça tokens permitidos por cima.
      P().forEach(p=>drawSingleToken(p,false));
    }else{
      P().forEach(p=>drawSingleToken(p,true));
    }

    drawRulerTop();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix nevoa segura, régua solta e parede ondulada aplicado.');
})();


// ===== FIX FINAL VISIBILIDADE MAPA TOKEN DENTRO DA LUZ =====
(function(){
  if(window.__FIX_VISIBILIDADE_MAPA_TOKEN_LUZ__) return;
  window.__FIX_VISIBILIDADE_MAPA_TOKEN_LUZ__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function lightRadius(p){
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    if(p&&!p.isNpc)return 200;
    return 0;
  }

  function ownToken(){
    return P().find(p=>!p.isNpc&&p.ownerId===me?.pid) ||
           P().find(p=>!p.isNpc&&p.id===me?.pid) ||
           P().find(p=>!p.isNpc);
  }

  function fogActive(){
    return !!fogEnabled && !globalLight && !isMaster();
  }

  function insidePlayerLight(p){
    if(isMaster()) return true;
    if(!fogEnabled || globalLight) return true;

    const own=ownToken();
    if(!own) return true;

    // o próprio jogador sempre aparece para ele
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;

    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function getMapImg(m){
    if(typeof preloadMap==='function')preloadMap(m);
    return mapImages[m.id];
  }

  function getTokenImg(p){
    if(typeof preloadToken==='function')preloadToken(p);
    return tokenImages[p.id];
  }

  function drawMaps(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX;
      const y=N(m.y)*scale+offsetY;
      const w=N(m.w,1000)*scale;
      const h=N(m.h,700)*scale;

      if(img&&img.complete&&img.naturalWidth){
        ctx.drawImage(img,x,y,w,h);
      }else{
        ctx.fillStyle='#333';
        ctx.fillRect(x,y,w,h);
      }

      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsMaster(){
    if(!isMaster()) return;

    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    ctx.lineJoin='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawTokenRaw(p){
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX;
    const y=N(p.y)*scale+offsetY;

    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));

      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  }

  window.drawToken=function(p){
    if(!p || !insidePlayerLight(p)) return;
    drawTokenRaw(p);
  };

  function applyFogMask(){
    if(!fogActive()) return;

    const own=ownToken();
    if(!own) return;

    const x=N(own.x)*scale+offsetX;
    const y=N(own.y)*scale+offsetY;
    const r=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);

    // cobre tudo
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,0.96)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // abre a luz e revela tudo que foi desenhado por baixo: mapa e tokens
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  function drawMasterHud(){
    if(!isMaster()) return;

    P().filter(p=>!p.isNpc).forEach(p=>{
      const r=lightRadius(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(N(p.x)*scale+offsetX,N(p.y)*scale+offsetY,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    if(typeof globalSpawns!=='undefined'){
      [['player','🧍','#50ff8c'],['npc','👹','#ff5050']].forEach(([k,ic,c])=>{
        const sp=globalSpawns[k];
        if(!sp)return;
        const x=N(sp.x)*scale+offsetX;
        const y=N(sp.y)*scale+offsetY;
        ctx.fillStyle='rgba(0,0,0,.85)';
        ctx.strokeStyle=c;
        ctx.lineWidth=3;
        ctx.beginPath();
        ctx.arc(x,y,22,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle='#fff';
        ctx.font='21px Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(ic,x,y);
      });
    }
  }

  function drawRulerTop(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX, ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX, by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  // Render final:
  // 1) mapa
  // 2) todos tokens por baixo
  // 3) névoa cobre tudo e fura a luz, revelando mapa+tokens
  // 4) tokens dentro da luz redesenhados por cima para ficarem nítidos
  // 5) régua
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMaps();
    drawWallsDoorsMaster();
    drawMasterHud();

    if(fogActive()){
      // desenha todos por baixo para a luz revelar mapa e tokens
      P().forEach(p=>drawTokenRaw(p));
      applyFogMask();

      // redesenha só os permitidos dentro da luz por cima
      P().forEach(p=>window.drawToken(p));
    }else{
      P().forEach(p=>drawTokenRaw(p));
    }

    drawRulerTop();
  };

  setTimeout(()=>requestDraw&&requestDraw(),200);
  console.log('Fix final: mapa e tokens visíveis dentro da luz.');
})();


// ===== FIX DADOS SYNC + FACING + HITBOX + COLISAO + PAREDE LIVRE =====
(function(){
  if(window.__TAVERNA_FIX_DICE_FACING_HITBOX_COLLISION_FREEWALL__) return;
  window.__TAVERNA_FIX_DICE_FACING_HITBOX_COLLISION_FREEWALL__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function W(){return A(walls)}
  function D(){return A(doors)}
  function MAPS(){return A(maps)}

  // ---------- DADOS SINCRONIZADOS ----------
  function parseRoll(expr){
    expr=String(expr||'1d20').replace(/\s+/g,'');
    const m=expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if(!m)return null;
    const n=Math.max(1,Math.min(50,N(m[1],1)));
    const die=Math.max(2,Math.min(1000,N(m[2],20)));
    const mod=N(m[3],0);
    const rolls=[];
    for(let i=0;i<n;i++)rolls.push(1+Math.floor(Math.random()*die));
    return {expr,n,die,mod,rolls,total:rolls.reduce((a,b)=>a+b,0)+mod,by:me?.pid||'local',name:me?.isMaster?'Mestre':(me?.pid||'Jogador'),time:Date.now()};
  }

  window.roll=function(expr){
    const result=parseRoll(expr);
    if(!result)return alert('Rolagem inválida. Ex: 1d20, 2d6+3');
    socket.emit('diceRoll',{room:R(),result});
    showDiceRoll(result);
  };

  window.showDiceRoll=function(r){
    const log=document.getElementById('diceLog');
    if(!log)return;
    const who=r.name||r.by||'Jogador';
    const mod=r.mod? (r.mod>0?`+${r.mod}`:`${r.mod}`) : '';
    log.innerHTML=`<div><b>${who}</b> rolou ${r.expr}: [${(r.rolls||[]).join(', ')}] ${mod} = <b>${r.total}</b></div>`+log.innerHTML;
  };

  socket.on('diceRolled',r=>showDiceRoll(r));

  // ---------- GEOMETRIA / COLISÃO ----------
  function ccw(a,b,c){return (c[1]-a[1])*(b[0]-a[0])>(b[1]-a[1])*(c[0]-a[0])}
  function segIntersect(a,b,c,d){
    // ignora interseção quando começa exatamente na parede para evitar prender
    return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d);
  }
  function blockingSegments(){
    const segs=[];
    W().forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});
    D().forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});
    return segs;
  }
  function blockedMove(x1,y1,x2,y2){
    const a=[x1,y1],b=[x2,y2];
    return blockingSegments().some(s=>segIntersect(a,b,s[0],s[1]));
  }
  function mapAt(x,y){
    for(let i=MAPS().length-1;i>=0;i--){
      const m=MAPS()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }
  function clampMap(p){
    let m=mapAt(N(p.x),N(p.y))||MAPS().find(mm=>mm.id===p.mapId)||MAPS()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // ---------- HITBOX / MOVIMENTO / FACING ----------
  let moveDrag=null, moveOff=[0,0], lastGood=null, lastEmit=0;

  function worldPosFromEvent(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function canMoveToken(p){
    if(!p||!me)return false;
    if(isMaster())return true;
    return !p.isNpc&&(p.ownerId===me.pid||p.id===me.pid);
  }
  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i];
      if(!canMoveToken(p))continue;
      if(p.tokenStyle==='standee'){
        // miniatura em pé: hitbox pega no corpo todo, não só no pé
        const h=N(p.spriteH,65), w=Math.max(28,h*0.45);
        const left=N(p.x)-w/2, right=N(p.x)+w/2, top=N(p.y)-h, bottom=N(p.y)+12;
        if(x>=left&&x<=right&&y>=top&&y<=bottom)return p;
      }else{
        const rad=Math.max(24,N(p.spriteW,32)*0.9);
        if(Math.hypot(N(p.x)-x,N(p.y)-y)<=rad)return p;
      }
    }
    return null;
  }
  function emitMove(p,force=false){
    const now=performance.now();
    if(!force&&now-lastEmit<30)return;
    lastEmit=now;
    socket.emit('move',{room:R(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH,facing:p.facing});
  }
  function startMove(ev){
    if(tool!=='move')return false;
    const [x,y]=worldPosFromEvent(ev);
    const p=hitToken(x,y);
    if(!p)return false;
    moveDrag=p;selectedId=p.id;
    moveOff=[N(p.x)-x,N(p.y)-y];
    lastGood={x:N(p.x),y:N(p.y),mapId:p.mapId};
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function moveMove(ev){
    if(!moveDrag)return false;
    const [x,y]=worldPosFromEvent(ev);
    const oldX=N(moveDrag.x), oldY=N(moveDrag.y);
    let nx=x+moveOff[0], ny=y+moveOff[1];

    if(blockedMove(oldX,oldY,nx,ny)){
      nx=lastGood.x; ny=lastGood.y;
    }

    moveDrag.x=nx;moveDrag.y=ny;clampMap(moveDrag);

    if(!blockedMove(oldX,oldY,moveDrag.x,moveDrag.y)){
      lastGood={x:moveDrag.x,y:moveDrag.y,mapId:moveDrag.mapId};
    }

    const dx=moveDrag.x-oldX;
    // Corrige lado: direita = facing 1, esquerda = -1.
    // Se a arte estiver virando ao contrário, troca estes dois valores.
    if(Math.abs(dx)>0.35)moveDrag.facing=dx>=0?1:-1;

    emitMove(moveDrag,false);
    requestDraw&&requestDraw();
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function endMove(ev){
    if(!moveDrag)return false;
    emitMove(moveDrag,true);
    moveDrag=null;lastGood=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',startMove,true);
  window.addEventListener('pointermove',moveMove,true);
  window.addEventListener('pointerup',endMove,true);
  window.addEventListener('pointercancel',endMove,true);

  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches.length===1)startMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(moveDrag&&e.touches&&e.touches.length===1)moveMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',endMove,{capture:true,passive:false});
  window.addEventListener('touchcancel',endMove,{capture:true,passive:false});

  // ---------- PAREDE LIVRE / ONDULADA ----------
  let freePoints=null;
  function addPoint(arr,p,min=5){
    if(!arr.length){arr.push(p);return true}
    const last=arr[arr.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min){arr.push(p);return true}
    return false;
  }
  function wallDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPosFromEvent(ev);
    freePoints=[[x,y]];
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function wallMove(ev){
    if(!freePoints)return false;
    const [x,y]=worldPosFromEvent(ev);
    addPoint(freePoints,[x,y],4);
    requestDraw&&requestDraw();
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function wallUp(ev){
    if(!freePoints)return false;
    const [x,y]=worldPosFromEvent(ev);
    addPoint(freePoints,[x,y],2);
    if(freePoints.length>1){
      if(drawTool==='door'){
        const door={wall:[freePoints[0],freePoints[freePoints.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        // parede livre: divide em vários segmentos
        for(let i=1;i<freePoints.length;i++){
          const wall=[freePoints[i-1],freePoints[i]];
          walls.push(wall);
          socket.emit('addWall',{room:R(),wall});
        }
      }
    }
    freePoints=null;
    requestDraw&&requestDraw();
    ev&&ev.preventDefault&&ev.preventDefault();
    return true;
  }
  canvas.addEventListener('pointerdown',wallDown,true);
  window.addEventListener('pointermove',wallMove,true);
  window.addEventListener('pointerup',wallUp,true);
  window.addEventListener('pointercancel',wallUp,true);

  // ---------- RENDER PREVIEW + FACING ----------
  const oldDrawToken=window.drawToken;
  window.drawToken=function(p){
    if(!p)return;
    const img=(typeof preloadToken==='function'?(preloadToken(p),tokenImages[p.id]):tokenImages[p.id]);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else ctx.drawImage(img,x-w/2,y-h/2,w,h);
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();
    }
  };

  const prevDraw=window.draw;
  window.draw=function(){
    if(prevDraw)prevDraw();
    // preview da parede por cima
    if(isMaster()&&freePoints&&freePoints.length>1){
      ctx.save();
      ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
      ctx.lineCap='round';ctx.lineJoin='round';
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=(drawTool==='door'?5:3)/scale;
      ctx.setLineDash(drawTool==='door'?[8/scale,6/scale]:[]);
      ctx.beginPath();
      ctx.moveTo(freePoints[0][0],freePoints[0][1]);
      for(let i=1;i<freePoints.length;i++)ctx.lineTo(freePoints[i][0],freePoints[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  console.log('Fix dados, facing, hitbox, colisao e parede livre aplicado.');
})();


// ===== FIX DADO SEM DUPLICAR + SEM LUZ GLOBAL + REGUA SOME + PAREDE LIVRE REAL =====
(function(){
  if(window.__TAVERNA_FIX_DICE_NOGLOBAL_RULER_FREEWALL__) return;
  window.__TAVERNA_FIX_DICE_NOGLOBAL_RULER_FREEWALL__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}

  // ---------------- remover luz global ----------------
  globalLight=false;
  window.toggleLight=function(){
    globalLight=false;
    alert('Luz global removida. Use a luz dos tokens.');
    socket.emit('setGlobalLight',{room:R(),value:false});
    requestDraw&&requestDraw();
  };
  setTimeout(()=>{
    // Esconde o botão "💡 Luz Global" se existir, sem mexer no layout geral.
    document.querySelectorAll('button').forEach(b=>{
      if((b.textContent||'').includes('💡') || (b.textContent||'').toLowerCase().includes('luz global')){
        b.style.display='none';
      }
    });
  },700);

  // ---------------- dado sincronizado sem duplicar para quem rolou ----------------
  window.__lastDiceLocalId=null;

  function parseRoll(expr){
    expr=String(expr||'1d20').replace(/\s+/g,'');
    const m=expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if(!m)return null;
    const n=Math.max(1,Math.min(50,N(m[1],1)));
    const die=Math.max(2,Math.min(1000,N(m[2],20)));
    const mod=N(m[3],0);
    const rolls=[];
    for(let i=0;i<n;i++)rolls.push(1+Math.floor(Math.random()*die));
    return {
      id:'roll_'+Date.now()+'_'+Math.floor(Math.random()*999999),
      expr,n,die,mod,rolls,
      total:rolls.reduce((a,b)=>a+b,0)+mod,
      by:me?.pid||'local',
      name:me?.isMaster?'Mestre':(me?.pid||'Jogador'),
      time:Date.now()
    };
  }

  window.roll=function(expr){
    const result=parseRoll(expr);
    if(!result)return alert('Rolagem inválida. Ex: 1d20, 2d6+3');
    window.__lastDiceLocalId=result.id;
    showDiceRoll(result);
    socket.emit('diceRoll',{room:R(),result});
  };

  window.showDiceRoll=function(r){
    if(!r)return;
    const log=document.getElementById('diceLog');
    if(!log)return;
    if(log.querySelector(`[data-roll-id="${r.id}"]`))return;
    const who=r.name||r.by||'Jogador';
    const mod=r.mod?(r.mod>0?`+${r.mod}`:`${r.mod}`):'';
    const div=document.createElement('div');
    div.setAttribute('data-roll-id',r.id||('roll_'+Date.now()));
    div.innerHTML=`<b>${who}</b> rolou ${r.expr}: [${(r.rolls||[]).join(', ')}] ${mod} = <b>${r.total}</b>`;
    log.prepend(div);
  };

  // mata listeners duplicados visualmente: se voltar do servidor com mesmo id, ignora
  socket.on('diceRolled',r=>{
    if(r&&r.id&&r.id===window.__lastDiceLocalId)return;
    showDiceRoll(r);
  });

  // ---------------- régua some ao soltar ----------------
  let localRuler=null;
  let measuring=false;

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  function rulerDown(ev){
    if(tool!=='ruler')return false;
    const [x,y]=worldPos(ev);
    measuring=true;
    localRuler={a:[x,y],b:[x,y],owner:me?.pid||'local'};
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerMove(ev){
    if(!measuring)return false;
    const [x,y]=worldPos(ev);
    localRuler.b=[x,y];
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerUp(ev){
    if(!measuring)return false;
    measuring=false;
    localRuler=null;
    ruler=null;
    socket.emit('setRuler',{room:R(),ruler:null});
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',rulerDown,true);
  window.addEventListener('pointermove',rulerMove,true);
  window.addEventListener('pointerup',rulerUp,true);
  window.addEventListener('pointercancel',rulerUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])rulerDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(measuring&&e.touches&&e.touches[0])rulerMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(measuring)rulerUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  socket.on('rulerUpdated',r=>{
    ruler=r||null;
    requestDraw&&requestDraw();
  });

  // ---------------- parede livre real / ondulada ----------------
  let freeDraw=null;

  function addPoint(p,min=3){
    if(!freeDraw)freeDraw=[];
    if(!freeDraw.length){freeDraw.push(p);return;}
    const last=freeDraw[freeDraw.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min)freeDraw.push(p);
  }

  function wallDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    freeDraw=[];
    addPoint([x,y],0);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallMove(ev){
    if(!freeDraw)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],3);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallUp(ev){
    if(!freeDraw)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],1);

    if(freeDraw.length>1){
      if(drawTool==='door'){
        // porta fica reta, usando início e fim
        const door={wall:[freeDraw[0],freeDraw[freeDraw.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        // parede livre real: agrupa a linha como vários segmentos pequenos
        const batch=[];
        for(let i=1;i<freeDraw.length;i++){
          const seg=[freeDraw[i-1],freeDraw[i]];
          walls.push(seg);
          batch.push(seg);
        }
        socket.emit('addWallsBatch',{room:R(),walls:batch});
      }
    }

    freeDraw=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',wallDown,true);
  window.addEventListener('pointermove',wallMove,true);
  window.addEventListener('pointerup',wallUp,true);
  window.addEventListener('pointercancel',wallUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])wallDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(freeDraw&&e.touches&&e.touches[0])wallMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(freeDraw)wallUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  // Preview por cima, sem depender do render antigo.
  const prevDraw=window.draw;
  window.draw=function(){
    if(prevDraw)prevDraw();

    if(isMaster()&&freeDraw&&freeDraw.length>1){
      ctx.save();
      ctx.translate(offsetX,offsetY);
      ctx.scale(scale,scale);
      ctx.lineCap='round';
      ctx.lineJoin='round';
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=(drawTool==='door'?5:3)/scale;
      if(drawTool==='door')ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.moveTo(freeDraw[0][0],freeDraw[0][1]);
      for(let i=1;i<freeDraw.length;i++)ctx.lineTo(freeDraw[i][0],freeDraw[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  console.log('Fix dado sem duplicar, sem luz global, régua some, parede livre real aplicado.');
})();


// ===== PATCH FINAL SEM NEVOA + REGUA LIMPA + PAREDE LIVRE FORCADA =====
(function(){
  if(window.__TAVERNA_SEM_NEVOA_REGUA_PAREDE_LIVRE__) return;
  window.__TAVERNA_SEM_NEVOA_REGUA_PAREDE_LIVRE__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  fogEnabled=false;
  globalLight=false;
  window.toggleFog=function(){
    fogEnabled=false;
    socket.emit('setFog',{room:R(),value:false});
    alert('Névoa removida/desativada.');
    requestDraw&&requestDraw();
  };
  window.toggleLight=function(){
    globalLight=false;
    socket.emit('setGlobalLight',{room:R(),value:false});
    alert('Luz global removida.');
    requestDraw&&requestDraw();
  };
  setTimeout(()=>{
    document.querySelectorAll('button').forEach(b=>{
      const t=(b.textContent||'').toLowerCase();
      if(t.includes('🌫️')||t.includes('névoa')||t.includes('nevoa')||t.includes('💡')||t.includes('luz global')){
        b.style.display='none';
      }
    });
  },500);

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  let measuringFinal=false;
  let localRulerFinal=null;

  function rulerDownFinal(ev){
    if(tool!=='ruler') return false;
    const [x,y]=worldPos(ev);
    measuringFinal=true;
    localRulerFinal={a:[x,y],b:[x,y],owner:me?.pid||'local'};
    ruler=localRulerFinal;
    socket.emit('setRuler',{room:R(),ruler:localRulerFinal});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerMoveFinal(ev){
    if(!measuringFinal) return false;
    const [x,y]=worldPos(ev);
    localRulerFinal.b=[x,y];
    ruler=localRulerFinal;
    socket.emit('setRuler',{room:R(),ruler:localRulerFinal});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerClearFinal(ev){
    if(!measuringFinal && !ruler && !localRulerFinal) return false;
    measuringFinal=false;
    localRulerFinal=null;
    ruler=null;
    socket.emit('setRuler',{room:R(),ruler:null});
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',rulerDownFinal,true);
  window.addEventListener('pointermove',rulerMoveFinal,true);
  window.addEventListener('pointerup',rulerClearFinal,true);
  window.addEventListener('pointercancel',rulerClearFinal,true);
  window.addEventListener('blur',()=>{ruler=null;localRulerFinal=null;measuringFinal=false;socket.emit('setRuler',{room:R(),ruler:null});requestDraw&&requestDraw();},true);

  socket.on('rulerUpdated',r=>{
    ruler=r||null;
    if(!r){localRulerFinal=null;measuringFinal=false;}
    requestDraw&&requestDraw();
  });

  let freeWallFinal=null;

  function addFreePoint(p,min=2){
    if(!freeWallFinal) freeWallFinal=[];
    if(!freeWallFinal.length){freeWallFinal.push(p);return;}
    const last=freeWallFinal[freeWallFinal.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min) freeWallFinal.push(p);
  }

  function wallDownFinal(ev){
    if(!isMaster() || tool!=='draw') return false;
    const [x,y]=worldPos(ev);
    freeWallFinal=[];
    addFreePoint([x,y],0);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallMoveFinal(ev){
    if(!freeWallFinal) return false;
    const [x,y]=worldPos(ev);
    addFreePoint([x,y],2);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallUpFinal(ev){
    if(!freeWallFinal) return false;
    const [x,y]=worldPos(ev);
    addFreePoint([x,y],1);

    if(freeWallFinal.length>1){
      if(drawTool==='door'){
        const door={wall:[freeWallFinal[0],freeWallFinal[freeWallFinal.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        const batch=[];
        for(let i=1;i<freeWallFinal.length;i++){
          const seg=[freeWallFinal[i-1],freeWallFinal[i]];
          walls.push(seg);
          batch.push(seg);
        }
        socket.emit('addWallsBatch',{room:R(),walls:batch});
      }
    }

    freeWallFinal=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',wallDownFinal,true);
  window.addEventListener('pointermove',wallMoveFinal,true);
  window.addEventListener('pointerup',wallUpFinal,true);
  window.addEventListener('pointercancel',wallUpFinal,true);

  function getMapImg(m){ if(typeof preloadMap==='function')preloadMap(m); return mapImages[m.id]; }
  function getTokenImg(p){ if(typeof preloadToken==='function')preloadToken(p); return tokenImages[p.id]; }

  function drawMapsFinal(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX, y=N(m.y)*scale+offsetY, w=N(m.w,1000)*scale, h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth) ctx.drawImage(img,x,y,w,h);
      else {ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoorsFinal(){
    if(!isMaster()) return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    ctx.lineJoin='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1]) return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    if(freeWallFinal&&freeWallFinal.length>1){
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=(drawTool==='door'?5:3)/scale;
      if(drawTool==='door') ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.moveTo(freeWallFinal[0][0],freeWallFinal[0][1]);
      for(let i=1;i<freeWallFinal.length;i++) ctx.lineTo(freeWallFinal[i][0],freeWallFinal[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p) return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX, y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      } else {
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawRulerFinal(){
    const rr=localRulerFinal||ruler;
    if(!rr||!rr.a||!rr.b) return;
    const ax=rr.a[0]*scale+offsetX, ay=rr.a[1]*scale+offsetY;
    const bx=rr.b[0]*scale+offsetX, by=rr.b[1]*scale+offsetY;
    const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);
    const ft=dist/10, mt=ft*0.3048, sq=dist/50;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();

    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapsFinal();
    drawWallsDoorsFinal();
    P().forEach(p=>window.drawToken(p));
    drawRulerFinal();
  };

  setTimeout(()=>{ruler=null;socket.emit('setRuler',{room:R(),ruler:null});requestDraw&&requestDraw();},300);
  console.log('Patch final sem névoa, régua limpa e parede livre aplicado.');
})();


// ===== FIX PORTA FOCO COLISAO PAREDE LIVRE SEM RETA =====
(function(){
  if(window.__TAVERNA_FIX_DOOR_FOCUS_COLLISION_FREEWALL__) return;
  window.__TAVERNA_FIX_DOOR_FOCUS_COLLISION_FREEWALL__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  // FOCO: se tiver token selecionado, centraliza nele. Se não tiver, centraliza mapa ativo.
  window.center=function(){
    const p=selectedId?P().find(x=>String(x.id)===String(selectedId)):null;
    if(p){
      offsetX=canvas.width/2-N(p.x)*scale;
      offsetY=canvas.height/2-N(p.y)*scale;
      requestDraw&&requestDraw();
      return;
    }
    const m=M().find(x=>String(x.id)===String(activeMapId))||M()[0];
    if(m){
      offsetX=canvas.width/2-(N(m.x)+N(m.w,1000)/2)*scale;
      offsetY=canvas.height/2-(N(m.y)+N(m.h,700)/2)*scale;
      requestDraw&&requestDraw();
    }
  };

  // GEOMETRIA / COLISÃO
  function ccw(a,b,c){return (c[1]-a[1])*(b[0]-a[0])>(b[1]-a[1])*(c[0]-a[0])}
  function segIntersect(a,b,c,d){
    return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d);
  }
  function blockingSegments(){
    const segs=[];
    W().forEach(w=>{if(w&&w[0]&&w[1])segs.push(w)});
    D().forEach(d=>{if(d&&d.wall&&!d.open)segs.push(d.wall)});
    return segs;
  }
  function blockedMove(x1,y1,x2,y2){
    const a=[x1,y1],b=[x2,y2];
    return blockingSegments().some(s=>segIntersect(a,b,s[0],s[1]));
  }
  function mapAt(x,y){
    for(let i=M().length-1;i>=0;i--){
      const m=M()[i],mx=N(m.x),my=N(m.y),mw=N(m.w,1000),mh=N(m.h,700);
      if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
    }
    return null;
  }
  function clampMap(p){
    let m=mapAt(N(p.x),N(p.y))||M().find(mm=>mm.id===p.mapId)||M()[0];
    if(!m)return p;
    p.x=Math.max(N(m.x)+2,Math.min(N(m.x)+N(m.w,1000)-2,N(p.x)));
    p.y=Math.max(N(m.y)+2,Math.min(N(m.y)+N(m.h,700)-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // PORTA: mestre clica/toca na porta para abrir/fechar. Aberta fica verde.
  function distPointSeg(px,py,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  function toggleDoorNear(x,y){
    if(!isMaster())return false;
    let best=-1,bd=99999;
    D().forEach((d,i)=>{
      if(!d||!d.wall)return;
      const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);
      if(dd<bd){bd=dd;best=i}
    });
    if(best>=0&&bd<30){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw&&requestDraw();
      return true;
    }
    return false;
  }
  canvas.addEventListener('pointerdown',ev=>{
    if(!isMaster())return;
    const [x,y]=worldPos(ev);
    if(toggleDoorNear(x,y)){
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    }
  },true);
  canvas.addEventListener('touchstart',e=>{
    if(!isMaster()||!e.touches||!e.touches[0])return;
    const [x,y]=worldPos(e.touches[0]);
    if(toggleDoorNear(x,y)){
      e.preventDefault();e.stopPropagation();
    }
  },{capture:true,passive:false});

  // PAREDE LIVRE: desliga handlers antigos que criavam reta e força batch de segmentos.
  let freeLine=null;
  let drawingFree=false;

  function addPoint(p,min=2){
    if(!freeLine)freeLine=[];
    if(!freeLine.length){freeLine.push(p);return true;}
    const last=freeLine[freeLine.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min){freeLine.push(p);return true;}
    return false;
  }
  function freeDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    drawingFree=true;
    freeLine=[];
    addPoint([x,y],0);
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function freeMove(ev){
    if(!drawingFree||!freeLine)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],2);
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function freeUp(ev){
    if(!drawingFree||!freeLine)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],1);

    if(freeLine.length>1){
      if(drawTool==='door'){
        const door={wall:[freeLine[0],freeLine[freeLine.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        const batch=[];
        for(let i=1;i<freeLine.length;i++){
          const seg=[freeLine[i-1],freeLine[i]];
          walls.push(seg);
          batch.push(seg);
        }
        socket.emit('addWallsBatch',{room:R(),walls:batch});
      }
    }
    freeLine=null;drawingFree=false;
    ev&&ev.preventDefault&&ev.preventDefault();ev&&ev.stopPropagation&&ev.stopPropagation();ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  canvas.addEventListener('pointerdown',freeDown,true);
  window.addEventListener('pointermove',freeMove,true);
  window.addEventListener('pointerup',freeUp,true);
  window.addEventListener('pointercancel',freeUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])freeDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(drawingFree&&e.touches&&e.touches[0])freeMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(drawingFree)freeUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  // MOVIMENTO COM COLISÃO: não atravessa parede nem porta fechada.
  let dragTokenFix=null, dragOff=[0,0], lastGood=null, lastEmit=0;
  function canMove(p){return isMaster()||(!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid))}
  function hitToken(x,y){
    for(let i=P().length-1;i>=0;i--){
      const p=P()[i]; if(!canMove(p))continue;
      if(p.tokenStyle==='standee'){
        const h=N(p.spriteH,65), w=Math.max(28,h*.45);
        if(x>=N(p.x)-w/2&&x<=N(p.x)+w/2&&y>=N(p.y)-h&&y<=N(p.y)+14)return p;
      }else{
        const r=Math.max(24,N(p.spriteW,32)*.9);
        if(Math.hypot(N(p.x)-x,N(p.y)-y)<=r)return p;
      }
    }
    return null;
  }
  function emitMove(p,force=false){
    const now=performance.now();
    if(!force&&now-lastEmit<35)return;
    lastEmit=now;
    socket.emit('move',{room:R(),id:p.id,x:p.x,y:p.y,mapId:p.mapId,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH,facing:p.facing});
  }

  function moveDown(ev){
    if(tool!=='move')return false;
    const [x,y]=worldPos(ev);
    const p=hitToken(x,y); if(!p)return false;
    dragTokenFix=p; selectedId=p.id;
    dragOff=[N(p.x)-x,N(p.y)-y];
    lastGood={x:N(p.x),y:N(p.y),mapId:p.mapId};
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function moveMove(ev){
    if(!dragTokenFix)return false;
    const [x,y]=worldPos(ev);
    const oldX=N(dragTokenFix.x), oldY=N(dragTokenFix.y);
    let nx=x+dragOff[0], ny=y+dragOff[1];

    if(blockedMove(oldX,oldY,nx,ny)){
      nx=lastGood.x; ny=lastGood.y;
    }

    dragTokenFix.x=nx; dragTokenFix.y=ny; clampMap(dragTokenFix);
    if(!blockedMove(oldX,oldY,dragTokenFix.x,dragTokenFix.y)){
      lastGood={x:dragTokenFix.x,y:dragTokenFix.y,mapId:dragTokenFix.mapId};
    }

    const dx=dragTokenFix.x-oldX;
    if(Math.abs(dx)>.35)dragTokenFix.facing=dx>=0?1:-1;

    emitMove(dragTokenFix,false);
    ev.preventDefault&&ev.preventDefault();ev.stopPropagation&&ev.stopPropagation();ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function moveUp(ev){
    if(!dragTokenFix)return false;
    emitMove(dragTokenFix,true);
    dragTokenFix=null; lastGood=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    requestDraw&&requestDraw();
    return true;
  }
  canvas.addEventListener('pointerdown',moveDown,true);
  window.addEventListener('pointermove',moveMove,true);
  window.addEventListener('pointerup',moveUp,true);
  window.addEventListener('pointercancel',moveUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])moveDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(dragTokenFix&&e.touches&&e.touches[0])moveMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(dragTokenFix)moveUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  function getMapImg(m){ if(typeof preloadMap==='function')preloadMap(m); return mapImages[m.id]; }
  function getTokenImg(p){ if(typeof preloadToken==='function')preloadToken(p); return tokenImages[p.id]; }

  function drawAll(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507'; ctx.fillRect(0,0,canvas.width,canvas.height);

    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);}
    });

    if(isMaster()){
      ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.lineCap='round';ctx.lineJoin='round';
      W().forEach(w=>{if(!w||!w[0]||!w[1])return;ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});
      D().forEach(d=>{if(!d||!d.wall)return;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();});
      if(freeLine&&freeLine.length>1){ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';ctx.lineWidth=(drawTool==='door'?5:3)/scale;if(drawTool==='door')ctx.setLineDash([8/scale,6/scale]);ctx.beginPath();ctx.moveTo(freeLine[0][0],freeLine[0][1]);for(let i=1;i<freeLine.length;i++)ctx.lineTo(freeLine[i][0],freeLine[i][1]);ctx.stroke();ctx.setLineDash([]);}
      ctx.restore();
    }

    P().forEach(p=>{
      const img=getTokenImg(p);
      const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
      if(img&&img.complete&&img.naturalWidth){
        const stand=p.tokenStyle==='standee';const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
        if(stand){ctx.save();ctx.translate(x,y);ctx.scale(p.facing===-1?-1:1,1);ctx.drawImage(img,-w/2,-h,w,h);ctx.restore();}
        else ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }else{ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');ctx.beginPath();ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();}
    });
  }
  window.draw=drawAll;

  console.log('Fix porta, foco, colisão e parede livre sem reta aplicado.');
})();


// ===== PATCH ESTAVEL SYNC WALLS DOORS DICE RULER =====
(function(){
  if(window.__TAVERNA_STABLE_SYNC_WALLS_DICE_RULER__) return;
  window.__TAVERNA_STABLE_SYNC_WALLS_DICE_RULER__=true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f}
  function A(v){return Array.isArray(v)?v:[]}
  function isMaster(){return !!(me&&me.isMaster)}
  function R(){return me?.room || document.getElementById('room')?.value || 'mesa1'}
  function P(){return A(players)}
  function M(){return A(maps)}
  function W(){return A(walls)}
  function D(){return A(doors)}

  // Estado sincronizado forte
  function applyState(s){
    if(!s)return;
    if(Array.isArray(s.players)) players=s.players;
    if(Array.isArray(s.maps)) maps=s.maps;
    if(Array.isArray(s.walls)) walls=s.walls;
    if(Array.isArray(s.doors)) doors=s.doors;
    if(s.activeMapId!==undefined) activeMapId=s.activeMapId;
    if(s.globalSpawns) globalSpawns=s.globalSpawns;
    if(s.ruler!==undefined) ruler=s.ruler;
    fogEnabled=false;
    globalLight=false;
    if(typeof preload==='function') preload();
    if(typeof renderMapList==='function') renderMapList();
    if(typeof renderPlayers==='function') renderPlayers();
    requestDraw&&requestDraw();
  }

  socket.on('state', applyState);
  socket.on('wallsUpdated', w=>{walls=A(w);requestDraw&&requestDraw();});
  socket.on('doorsUpdated', d=>{doors=A(d);requestDraw&&requestDraw();});
  socket.on('rulerUpdated', r=>{ruler=r||null;requestDraw&&requestDraw();});
  socket.on('playerMoved', p=>{
    if(!p||!p.id)return;
    const i=players.findIndex(x=>String(x.id)===String(p.id));
    if(i>=0) players[i]={...players[i],...p}; else players.push(p);
    if(typeof preloadToken==='function') preloadToken(p);
    requestDraw&&requestDraw();
  });
  socket.on('playerUpdated', p=>{
    if(!p||!p.id)return;
    const i=players.findIndex(x=>String(x.id)===String(p.id));
    if(i>=0) players[i]={...players[i],...p}; else players.push(p);
    if(typeof preloadToken==='function') preloadToken(p);
    if(typeof renderPlayers==='function') renderPlayers();
    requestDraw&&requestDraw();
  });

  // Dados sincronizados sem duplicação local
  window.__shownRolls=window.__shownRolls||new Set();

  function showDiceRollStable(r){
    if(!r)return;
    if(r.id && window.__shownRolls.has(r.id)) return;
    if(r.id) window.__shownRolls.add(r.id);
    const log=document.getElementById('diceLog');
    if(!log)return;
    const who=r.name||r.by||'Jogador';
    const mod=r.mod?(r.mod>0?`+${r.mod}`:`${r.mod}`):'';
    const div=document.createElement('div');
    div.innerHTML=`<b>${who}</b> rolou ${r.expr}: [${(r.rolls||[]).join(', ')}] ${mod} = <b>${r.total}</b>`;
    log.prepend(div);
  }

  window.showDiceRoll=showDiceRollStable;

  function parseRoll(expr){
    expr=String(expr||'1d20').replace(/\s+/g,'');
    const m=expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if(!m)return null;
    const n=Math.max(1,Math.min(50,N(m[1],1)));
    const die=Math.max(2,Math.min(1000,N(m[2],20)));
    const mod=N(m[3],0);
    const rolls=[];
    for(let i=0;i<n;i++)rolls.push(1+Math.floor(Math.random()*die));
    return {
      id:'roll_'+Date.now()+'_'+Math.floor(Math.random()*999999),
      expr,n,die,mod,rolls,
      total:rolls.reduce((a,b)=>a+b,0)+mod,
      by:me?.pid||'local',
      name:me?.isMaster?'Mestre':(me?.pid||'Jogador'),
      time:Date.now()
    };
  }

  window.roll=function(expr){
    const result=parseRoll(expr);
    if(!result)return alert('Rolagem inválida. Ex: 1d20, 2d6+3');
    showDiceRollStable(result);
    socket.emit('diceRoll',{room:R(),result});
  };

  socket.on('diceRolled', showDiceRollStable);

  // Coordenadas
  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }

  // Régua estável: funciona para mestre/jogador e some ao soltar
  let measuring=false;
  let localRuler=null;

  function rulerDown(ev){
    if(tool!=='ruler')return false;
    const [x,y]=worldPos(ev);
    measuring=true;
    localRuler={a:[x,y],b:[x,y],owner:me?.pid||'local'};
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerMove(ev){
    if(!measuring)return false;
    const [x,y]=worldPos(ev);
    localRuler.b=[x,y];
    ruler=localRuler;
    socket.emit('setRuler',{room:R(),ruler:localRuler});
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function rulerUp(ev){
    if(!measuring)return false;
    measuring=false;
    localRuler=null;
    ruler=null;
    socket.emit('setRuler',{room:R(),ruler:null});
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',rulerDown,true);
  window.addEventListener('pointermove',rulerMove,true);
  window.addEventListener('pointerup',rulerUp,true);
  window.addEventListener('pointercancel',rulerUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])rulerDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(measuring&&e.touches&&e.touches[0])rulerMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(measuring)rulerUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  // Parede/porta estável: desenho livre para parede, porta reta
  let drawingWall=false;
  let wallPoints=null;

  function addPoint(p,min=2){
    if(!wallPoints)wallPoints=[];
    if(!wallPoints.length){wallPoints.push(p);return;}
    const last=wallPoints[wallPoints.length-1];
    if(Math.hypot(p[0]-last[0],p[1]-last[1])>=min) wallPoints.push(p);
  }

  function wallDown(ev){
    if(!isMaster()||tool!=='draw')return false;
    const [x,y]=worldPos(ev);
    drawingWall=true;
    wallPoints=[];
    addPoint([x,y],0);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallMove(ev){
    if(!drawingWall||!wallPoints)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],2);
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  function wallUp(ev){
    if(!drawingWall||!wallPoints)return false;
    const [x,y]=worldPos(ev);
    addPoint([x,y],1);

    if(wallPoints.length>1){
      if(drawTool==='door'){
        const door={wall:[wallPoints[0],wallPoints[wallPoints.length-1]],open:false};
        doors.push(door);
        socket.emit('addDoor',{room:R(),door});
      }else{
        const batch=[];
        for(let i=1;i<wallPoints.length;i++){
          const seg=[wallPoints[i-1],wallPoints[i]];
          walls.push(seg);
          batch.push(seg);
        }
        socket.emit('addWallsBatch',{room:R(),walls:batch});
      }
    }

    drawingWall=false;
    wallPoints=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    ev&&ev.stopPropagation&&ev.stopPropagation();
    ev&&ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }

  canvas.addEventListener('pointerdown',wallDown,true);
  window.addEventListener('pointermove',wallMove,true);
  window.addEventListener('pointerup',wallUp,true);
  window.addEventListener('pointercancel',wallUp,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])wallDown(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(drawingWall&&e.touches&&e.touches[0])wallMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',e=>{if(drawingWall)wallUp(e.changedTouches&&e.changedTouches[0]||e);},{capture:true,passive:false});

  // Porta: mestre clica/toca nela para abrir/fechar
  function distPointSeg(px,py,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  function toggleDoorNear(x,y){
    let best=-1,bd=99999;
    D().forEach((d,i)=>{
      if(!d||!d.wall)return;
      const dd=distPointSeg(x,y,d.wall[0],d.wall[1]);
      if(dd<bd){bd=dd;best=i;}
    });
    if(best>=0&&bd<30){
      doors[best].open=!doors[best].open;
      socket.emit('setDoors',{room:R(),doors});
      requestDraw&&requestDraw();
      return true;
    }
    return false;
  }
  canvas.addEventListener('pointerdown',ev=>{
    if(!isMaster()||tool==='draw'||tool==='ruler')return;
    const [x,y]=worldPos(ev);
    if(toggleDoorNear(x,y)){
      ev.preventDefault&&ev.preventDefault();
      ev.stopPropagation&&ev.stopPropagation();
      ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    }
  },true);

  // Render estável
  function getMapImg(m){if(typeof preloadMap==='function')preloadMap(m);return mapImages[m.id];}
  function getTokenImg(p){if(typeof preloadToken==='function')preloadToken(p);return tokenImages[p.id];}

  function drawMaps(){
    M().forEach(m=>{
      const img=getMapImg(m);
      const x=N(m.x)*scale+offsetX,y=N(m.y)*scale+offsetY,w=N(m.w,1000)*scale,h=N(m.h,700)*scale;
      if(img&&img.complete&&img.naturalWidth)ctx.drawImage(img,x,y,w,h);
      else{ctx.fillStyle='#333';ctx.fillRect(x,y,w,h);}
      if(isMaster()){
        ctx.strokeStyle=m.id===activeMapId?'#ffd250':'#c97c3d';
        ctx.lineWidth=2;
        ctx.strokeRect(x,y,w,h);
      }
    });
  }

  function drawWallsDoors(){
    if(!isMaster())return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    ctx.lineJoin='round';

    W().forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle='#c97c3d';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(w[0][0],w[0][1]);
      ctx.lineTo(w[1][0],w[1][1]);
      ctx.stroke();
    });

    D().forEach(d=>{
      if(!d||!d.wall)return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(d.wall[0][0],d.wall[0][1]);
      ctx.lineTo(d.wall[1][0],d.wall[1][1]);
      ctx.stroke();
    });

    if(wallPoints&&wallPoints.length>1){
      ctx.strokeStyle=drawTool==='door'?'#ff3333':'#c97c3d';
      ctx.lineWidth=(drawTool==='door'?5:3)/scale;
      if(drawTool==='door')ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.moveTo(wallPoints[0][0],wallPoints[0][1]);
      for(let i=1;i<wallPoints.length;i++)ctx.lineTo(wallPoints[i][0],wallPoints[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  window.drawToken=function(p){
    if(!p)return;
    const img=getTokenImg(p);
    const x=N(p.x)*scale+offsetX,y=N(p.y)*scale+offsetY;
    if(img&&img.complete&&img.naturalWidth){
      const stand=p.tokenStyle==='standee';
      const h=(stand?N(p.spriteH,65):N(p.spriteW,32))*scale;
      const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
      if(stand){
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
        ctx.restore();
      }else{
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.fillStyle=p.isNpc?'#d44':(p.color||'#c97c3d');
      ctx.beginPath();
      ctx.arc(x,y,(p.isNpc?18:14)*scale,0,Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#fff';
      ctx.stroke();
    }
  };

  function drawRuler(){
    if(!ruler)return;
    const ax=ruler.a[0]*scale+offsetX,ay=ruler.a[1]*scale+offsetY;
    const bx=ruler.b[0]*scale+offsetX,by=ruler.b[1]*scale+offsetY;
    const dist=Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]);
    const ft=dist/10,mt=ft*0.3048,sq=dist/50;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
    ctx.stroke();
    const tx=(ax+bx)/2,ty=(ay+by)/2;
    ctx.fillStyle='rgba(0,0,0,.86)';
    ctx.fillRect(tx+8,ty-42,176,55);
    ctx.fillStyle='#00e5ff';
    ctx.font='13px Arial';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft`,tx+14,ty-25);
    ctx.fillText(`${mt.toFixed(1)} m`,tx+14,ty-10);
    ctx.fillText(`${sq.toFixed(1)} quadrados`,tx+84,ty-10);
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    drawMaps();
    drawWallsDoors();
    P().forEach(p=>window.drawToken(p));
    drawRuler();
  };

  setTimeout(()=>{ruler=null;socket.emit('setRuler',{room:R(),ruler:null});requestDraw&&requestDraw();},300);
  console.log('Patch estável sync paredes portas dados régua aplicado.');
})();
