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
