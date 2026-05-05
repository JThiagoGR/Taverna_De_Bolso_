

function smoothTokenMove(p,targetX,targetY){
  if(!p)return;
  const maxSpeed=4;
  let dx=targetX-p.x;
  let dy=targetY-p.y;
  const dist=Math.hypot(dx,dy);
  if(dist>maxSpeed){
    dx=(dx/dist)*maxSpeed;
    dy=(dy/dist)*maxSpeed;
  }
  const nx=p.x+dx, ny=p.y+dy;
  if(!blockedMoveLocal(p,nx,ny)){
    p.x=nx;
    p.y=ny;
    clampTokenToMap(p);
  }
}

function clampTokenToMap(p){
  if(!p)return;
  // Sem mapa/imagem carregada = sem limite.
  if(!mapImg || !mapWidth || !mapHeight)return;

  const margin = Math.max(18, typeof tokenRadius==='function' ? tokenRadius(p) : 20);

  p.x = Math.max(margin, Math.min(mapWidth - margin, p.x));
  p.y = Math.max(margin, Math.min(mapHeight - margin, p.y));
}


let camTargetX = 0;
let camTargetY = 0;
let followMode = true;

function smoothCamera(){
  offsetX += (camTargetX - offsetX) * 0.15;
  offsetY += (camTargetY - offsetY) * 0.15;
}

function centerOnToken(t){
  if(!t)return;
  camTargetX=(canvas.width/2)-(t.x*scale);
  camTargetY=(canvas.height/2)-(t.y*scale);
  offsetX=camTargetX;
  offsetY=camTargetY;
}

function updateFollowButton(){return;}
function toggleFollow(){followMode=!followMode;if(followMode)followOwnToken();}

function clampCamera(){
  // Câmera livre: não limita pan.
  // O limite fica apenas nos tokens quando existe mapa carregado.
  return;
}

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ['websocket','polling']
});const canvas=document.getElementById('canvas');const ctx=canvas.getContext('2d');
let lastPinchDist=0,lastPinchScale=1;
let drawMode='line', freeDrawPoints=null, circleStart=null;
let me=null,players=[],walls=[],doors=[],dragging=null,offsetX=0,offsetY=0,scale=1,tool='move',editingPlayer=null,tokenImages={},fogEnabled=false,mapImg=null,mapData=null,wallStart=null,rulerStart=null,rulerEnd=null,selectedId=null,globalLight=0,lastTap=0,lastX=0,lastY=0;let tokenPanelHidden=false;let tokenPanelOpen=false;
let drawPending=false,lastEmitMove=0,lastEmitZoom=0;
let mapWidth=0,mapHeight=0;
function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}

// ===== SINCRONIA ULTRA SUAVE =====
const NET_MOVE_INTERVAL = 45;
const NET_MOVE_MIN_DIST = 1;
const REMOTE_SMOOTH_SPEED = 14; // maior = mais rápido, sem teleportar visualmente
const REMOTE_SNAP_DIST = 900;   // se estiver MUITO longe, corrige para evitar atravessar mapa inteiro
const remoteTargets = {};
const lastNetMoveById = {};
let lastRemoteSmoothTime = performance.now();

function shouldSendMoveNet(p){
  if(!p)return false;
  const now=Date.now();
  const prev=lastNetMoveById[p.id]||{t:0,x:p.x,y:p.y};
  const dt=now-prev.t;
  const dist=Math.hypot((p.x||0)-(prev.x||0),(p.y||0)-(prev.y||0));
  if(dt<NET_MOVE_INTERVAL && dist<NET_MOVE_MIN_DIST)return false;
  lastNetMoveById[p.id]={t:now,x:p.x,y:p.y};
  return true;
}

function setRemoteTarget(id,x,y){}

function tickRemoteTargets(){}



// ===== SYNC ANTI-ECO TOKEN =====
const localMoveSeq = {};
const ignoreEchoUntil = {};
function nextMoveSeq(id){
  localMoveSeq[id]=(localMoveSeq[id]||0)+1;
  return localMoveSeq[id];
}

function emitMoveThrottled(p){
  if(!p||!me||!me.room)return;
  const now=Date.now();
  const prev=lastNetMoveById[p.id]||{t:0,x:p.x,y:p.y};
  const dist=Math.hypot((p.x||0)-(prev.x||0),(p.y||0)-(prev.y||0));
  if(now-prev.t<50 && dist<2)return;
  lastNetMoveById[p.id]={t:now,x:p.x,y:p.y};
  socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y),seq:nextMoveSeq(p.id)});
}

function emitMoveNow(p){
  if(!p||!me||!me.room)return;
  lastNetMoveById[p.id]={t:Date.now(),x:p.x,y:p.y};
  socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y),seq:nextMoveSeq(p.id)});
}

function emitZoomThrottled(force=false){if(!me||!me.isMaster)return;const now=Date.now();if(!force&&now-lastEmitZoom<180)return;lastEmitZoom=now;socket.emit('setZoom',{room:me.room,zoom:scale,offsetX,offsetY});}
function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;canvas.style.width=window.innerWidth+'px';canvas.style.height=window.innerHeight+'px';ctx.setTransform(1,0,0,1,0,0);if(me&&me.isMaster&&window.sharedRuler)try{socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});}catch(e){}requestDraw();}window.addEventListener('resize',resize);resize();

function applyRoleToolbar(){
  const isMaster=!!(me&&me.isMaster);

  document.querySelectorAll('.masterOnly').forEach(el=>{
    el.style.display=isMaster?'flex':'none';
  });

  // Jogador vê apenas: mover token, mover mapa, régua, dados, tela cheia, imagem do token e sair.
  const allowedPlayerIds=new Set(['tMove','tPan','tRuler','tDice','tFullscreen']);
  document.querySelectorAll('#toolbar button').forEach(btn=>{
    if(isMaster)return;
    const id=btn.id||'';
    const isLogout=(btn.getAttribute('onclick')||'').includes('logout()');
    btn.style.display=(allowedPlayerIds.has(id)||isLogout)?'flex':'none';
  });

  const tokenToggle=document.getElementById('tokenImageToggle');
  if(tokenToggle){
    tokenToggle.style.display=currentEditableToken()?'block':'none';
  }
}

function join(isMaster){const nameEl=document.getElementById('name');const roomEl=document.getElementById('room');const tokenEl=document.getElementById('tokenId');me={name:nameEl.value||'Jogador',room:roomEl.value||'mesa1',isMaster:!!isMaster,pid:null};try{enterFullscreen();}catch(e){}socket.emit('join',{room:me.room,name:me.name,isMaster:me.isMaster,tokenId:tokenEl.value.trim()||undefined});document.getElementById('login').style.display='none';document.getElementById('toolbar').style.display='flex';applyRoleToolbar();if(me&&!me.isMaster&&(tool==='draw'||tool==='clear'))setTool('move');updateFollowButton();applyRoleToolbar();if(me.isMaster){const isMobile=window.innerWidth<768;document.getElementById('master').style.display=isMobile?'none':'block';document.getElementById('masterToggle').style.display=isMobile?'block':'none';}else{document.getElementById('master').style.display='none';document.getElementById('masterToggle').style.display='none';}setTimeout(()=>{if(!me.isMaster){offsetX=window.innerWidth/2-400;offsetY=window.innerHeight/2-300;}requestDraw();if(me.isMaster)emitZoomThrottled(true);},100);}

function toggleFullscreen(){
  const el=document.documentElement;
  try{
    if(!document.fullscreenElement && !document.webkitFullscreenElement){
      if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
      else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
    }else{
      if(document.exitFullscreen)document.exitFullscreen().catch(()=>{});
      else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
    }
  }catch(e){}
}

function enterFullscreen(){
  const el=document.documentElement;
  try{
    if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
    else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
  }catch(e){}
}
function logout(){location.reload();}
function center(){
  let target=null;

  if(me&&me.isMaster){
    target=players.find(p=>p.id===selectedId)||players.find(p=>p.isNpc)||players[0];
  }else if(me){
    target=getOwnToken();
  }

  if(!target)return;

  centerOnToken(target);
  requestDraw();

  if(me&&me.isMaster){
    emitZoomThrottled(true);
  }
}

let didAutoFocusOwnToken=false;
function focusOwnTokenOnce(){
  if(!me||me.isMaster||didAutoFocusOwnToken)return;
  const own=getOwnToken();
  if(!own)return;
  centerOnToken(own);
  didAutoFocusOwnToken=true;
  requestDraw();
}


function getOwnToken(){
  if(!me||me.isMaster)return null;
  return players.find(p=>p.ownerId===me.pid&&!p.isNpc)||players.find(p=>p.id===me.pid&&!p.isNpc)||null;
}
function centerOnToken(t){
  if(!t)return;
  camTargetX=(canvas.width/2)-(t.x*scale);
  camTargetY=(canvas.height/2)-(t.y*scale);
  offsetX=camTargetX;
  offsetY=camTargetY;
}
function followOwnToken(){
  if(!me||me.isMaster)return;
  const own=getOwnToken();
  if(!own)return;
  centerOnToken(own);
  requestDraw();
}

function currentEditableToken(){
  if(!me)return null;
  if(selectedId){
    const s=players.find(p=>p.id===selectedId);
    if(s&&(me.isMaster||s.ownerId===me.pid))return s;
  }
  return players.find(p=>p.ownerId===me.pid&&!p.isNpc)||null;
}
function canEditToken(p){return !!p && (me?.isMaster || p.ownerId===me?.pid);}
function syncTokenPanel(){
  const panel=document.getElementById('tokenImagePanel');
  const toggle=document.getElementById('tokenImageToggle');
  if(!panel||!toggle||!me)return;
  const p=currentEditableToken();
  toggle.style.display=p?'block':'none';
  panel.style.display=(p&&tokenPanelOpen&&!tokenPanelHidden)?'block':'none';
  const url=document.getElementById('tokenUrl');
  if(url&&p)url.value=p.img||'';
}
function toggleTokenPanel(){
  tokenPanelHidden=false;
  tokenPanelOpen=!tokenPanelOpen;
  syncTokenPanel();
}
function hideTokenPanel(){
  tokenPanelHidden=true;
  tokenPanelOpen=false;
  const panel=document.getElementById('tokenImagePanel');
  if(panel)panel.style.display='none';
}
function applyTokenImageToPlayer(p,img){
  if(!p||!canEditToken(p))return;
  p.img=img||'';
  tokenImages[p.id]=null;
  if(img){
    const im=new Image();
    im.onload=()=>{tokenImages[p.id]=im;requestDraw();};
    im.onerror=()=>{tokenImages[p.id]=null;draw();};
    im.src=img;
  }
  socket.emit('updatePlayer',{room:me.room,id:p.id,img:p.img});
  draw();
}
function setMyTokenImg(){setTokenImg();}

function updateOrAddPlayer(p){if(p&&!p.isNpc&&(p.isMaster===true||String(p.id||'').startsWith('master_')||String(p.ownerId||'').startsWith('master_')))return;
  if(!p||!p.id)return;
  const i=players.findIndex(x=>x.id===p.id);
  if(i>=0)players[i]={...players[i],...p};
  else players.push(p);
  preloadTokenImages();
  syncTokenPanel();
  requestDraw();
  updatePlayerList();
}

function updateFogLightButtons(){
  const fogBtn=document.querySelector('button[onclick="toggleFog()"]');
  const lightBtn=document.querySelector('button[onclick="toggleLight()"]');
  if(fogBtn)fogBtn.textContent='🌫️ Névoa: '+(fogEnabled?'ON':'OFF');
  if(lightBtn)lightBtn.textContent='💡 Luz Global: '+(globalLight?'ON':'OFF');
}

socket.on('connect',()=>console.log('Conectado'));
socket.on('masterError',d=>alert(d?.msg||'Erro de Mestre'));
socket.on('joined',d=>{me.pid=d.pid;syncTokenPanel();applyRoleToolbar();});
socket.on('state',s=>{players=(s.players||[]).filter(p=>p.isNpc||!(p.isMaster===true||String(p.id||'').startsWith('master_')||String(p.ownerId||'').startsWith('master_')));if(me&&!me.isMaster&&!selectedId){const own=players.find(p=>p.ownerId===me.pid&&!p.isNpc)||players.find(p=>p.id===me.pid);if(own)selectedId=own.id;}walls=s.walls||[];doors=s.doors||[];fogEnabled=!!s.fog;globalLight=!!Number(s.globalLight||0);preloadTokenImages();syncTokenPanel();if(s.mapData&&s.mapData!==mapData){mapData=s.mapData;mapImg=new Image();mapImg.onload=()=>{mapWidth=mapImg.naturalWidth||mapImg.width||0;mapHeight=mapImg.naturalHeight||mapImg.height||0;requestDraw();};mapImg.src=mapData;}else if(!s.mapData&&mapData){clearLocalMap();}updateFogLightButtons();requestDraw();updatePlayerList();focusOwnTokenOnce();applyRoleToolbar();});
  socket.on('zoomUpdated', d => {
  if(me && me.isMaster) return;

  const oldScale = scale || 1;
  const newScale = Math.max(0.5,Math.min(3,Number(d.zoom)||oldScale));

  const centerX = (canvas.width / 2 - offsetX) / oldScale;
  const centerY = (canvas.height / 2 - offsetY) / oldScale;

  scale = newScale;

  offsetX = canvas.width / 2 - centerX * scale;
  offsetY = canvas.height / 2 - centerY * scale;
  camTargetX=offsetX;
  camTargetY=offsetY;

  requestDraw();
});
  socket.on('rulerUpdated',d=>{
  window.sharedRuler=d||null;
  if(d){
    rulerStart=d.a||null;
    rulerEnd=d.b||null;
  }else{
    rulerStart=null;
    rulerEnd=null;
  }
  requestDraw();
});
socket.on('playerRemoved',id=>{players=players.filter(p=>p.id!==id);requestDraw();updatePlayerList();});
socket.on('playerAdded',p=>updateOrAddPlayer(p));
socket.on('npcAdded',p=>updateOrAddPlayer(p));
  socket.on('playerMoved',p=>{
  const i=players.findIndex(x=>x.id===p.id);
  if(i>=0){
    const old=players[i];
    const localDragging = dragging && dragging.id===p.id;
    if(localDragging && !p.rejected){
      players[i]={...old,...p,x:old.x,y:old.y};
    }else{
      players[i]={...old,...p};
    }
  }else{
    players.push(p);
  }
  if(p.id===selectedId)syncTokenPanel();
  requestDraw();
  updatePlayerList();
});
socket.on('mapUpdated',data=>{
  const src=(typeof data==='object'&&data)?data.src:data;
  if(!src){clearLocalMap();return;}
  mapData=src;
  mapWidth=(typeof data==='object'&&data)?Number(data.w)||0:0;
  if(typeof data==='object'&&data&&data.id)activeMapId=data.id;
  mapHeight=(typeof data==='object'&&data)?Number(data.h)||0:0;
  mapImg=new Image();
  mapImg.onload=()=>{
    if(!mapWidth) mapWidth=mapImg.naturalWidth||mapImg.width||0;
    if(!mapHeight) mapHeight=mapImg.naturalHeight||mapImg.height||0;
    requestDraw();
  };
  mapImg.src=mapData;
});
socket.on('fogSet',f=>{fogEnabled=!!f;updateFogLightButtons();requestDraw();});
socket.on('fogUpdated',f=>{fogEnabled=!!f;updateFogLightButtons();requestDraw();});
socket.on('lightSet',l=>{globalLight=!!Number(l);updateFogLightButtons();requestDraw();});
socket.on('lightUpdated',l=>{globalLight=!!Number(l);updateFogLightButtons();requestDraw();});

function cycleDrawTool(){
  const modes=['line','free','circle','door'];
  const i=modes.indexOf(drawMode);
  drawMode=modes[(i+1)%modes.length];
  setTool('draw');
  updateDrawButton();
}

function updateDrawButton(){
  const b=document.getElementById('tDraw');
  if(!b)return;
  if(drawMode==='line'){b.textContent='✏️';b.title='Desenho: Parede reta';}
  if(drawMode==='free'){b.textContent='〰️';b.title='Desenho: Traço livre';}
  if(drawMode==='circle'){b.textContent='⭕';b.title='Desenho: Círculo';} if(drawMode==='door'){b.textContent='🚪';b.title='Desenho: Porta';}
}

function previewDrawShape(x,y){
  if(!me?.isMaster)return;
  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.scale(scale,scale);
  ctx.strokeStyle=drawMode==='door'?'rgba(255,45,45,1)':'#c97c3d';
  ctx.lineWidth=drawMode==='door'?4/scale:2/scale;
  ctx.setLineDash([6/scale,4/scale]);

  if((drawMode==='line'||drawMode==='door')&&wallStart){
    ctx.beginPath();
    ctx.moveTo(wallStart[0],wallStart[1]);
    ctx.lineTo(drawMode==='door'?x:Math.round(x/50)*50,drawMode==='door'?y:Math.round(y/50)*50);
    ctx.stroke();
  }

  if(drawMode==='free'&&freeDrawPoints&&freeDrawPoints.length>1){
    ctx.beginPath();
    ctx.moveTo(freeDrawPoints[0][0],freeDrawPoints[0][1]);
    for(const p of freeDrawPoints.slice(1))ctx.lineTo(p[0],p[1]);
    ctx.stroke();
  }

  if(drawMode==='circle'&&circleStart){
    const r=Math.hypot(x-circleStart[0],y-circleStart[1]);
    ctx.beginPath();
    ctx.arc(circleStart[0],circleStart[1],r,0,Math.PI*2);
    ctx.stroke();
  }

  ctx.restore();
}




function commitDrawTool(x,y){
  if(!me?.isMaster || tool!=='draw')return false;

  if(drawMode==='line'&&wallStart){
    const end=[Math.round(x/50)*50,Math.round(y/50)*50];
    if(wallStart[0]!==end[0]||wallStart[1]!==end[1]){
      socket.emit('addWall',{room:me.room,wall:[wallStart,end]});
    }
    wallStart=null;freeDrawPoints=null;circleStart=null;
    return true;
  }

  if(drawMode==='door'&&wallStart){
    const end=[x,y];
    if(Math.hypot(wallStart[0]-end[0],wallStart[1]-end[1])>6){
      socket.emit('addDoor',{room:me.room,door:{id:'door_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),wall:[wallStart,end],open:false}});
    }
    wallStart=null;freeDrawPoints=null;circleStart=null;
    return true;
  }

  if(drawMode==='free'&&freeDrawPoints&&freeDrawPoints.length>1){
    const wallsBatch=[];
    for(let i=0;i<freeDrawPoints.length-1;i++)wallsBatch.push([freeDrawPoints[i],freeDrawPoints[i+1]]);
    emitWallsBatch(wallsBatch);
    wallStart=null;freeDrawPoints=null;circleStart=null;
    return true;
  }

  if(drawMode==='circle'&&circleStart){
    const r=Math.hypot(x-circleStart[0],y-circleStart[1]);
    if(r>8)emitWallsBatch(makeCircleWalls(circleStart[0],circleStart[1],r));
    wallStart=null;freeDrawPoints=null;circleStart=null;
    return true;
  }

  wallStart=null;freeDrawPoints=null;circleStart=null;
  return false;
}



function makeCircleWalls(cx,cy,r){
  const segs=Math.max(12,Math.min(64,Math.round(r/12)));
  const out=[];
  for(let i=0;i<segs;i++){
    const a1=(Math.PI*2*i)/segs;
    const a2=(Math.PI*2*(i+1))/segs;
    out.push([[cx+Math.cos(a1)*r,cy+Math.sin(a1)*r],[cx+Math.cos(a2)*r,cy+Math.sin(a2)*r]]);
  }
  return out;
}

function emitWallsBatch(wallsBatch){
  if(!wallsBatch||!wallsBatch.length)return;
  socket.emit('addWalls',{room:me.room,walls:wallsBatch});
}

function setTool(t){if(!me?.isMaster&&(t==='draw'||t==='clear'))return;tool=t;document.querySelectorAll('#toolbar button').forEach(b=>b.classList.remove('active'));if(t==='move')document.getElementById('tMove').classList.add('active');if(t==='ruler')document.getElementById('tRuler').classList.add('active');if(t==='draw'){document.getElementById('tDraw').classList.add('active');updateDrawButton();}if(t==='pan')document.getElementById('tPan').classList.add('active');if(t==='clear')clearWalls();}
function getPos(e){const r=canvas.getBoundingClientRect();return[(e.clientX-r.left-offsetX)/scale,(e.clientY-r.top-offsetY)/scale];}

function tokenRadius(p){return 16;}
function distPointToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy);
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

// ===== COLISÃO LOCAL ROBUSTA =====
function distPointToSegLocal(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1;
  const len2=dx*dx+dy*dy;
  if(len2<=0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  const x=x1+t*dx, y=y1+t*dy;
  return Math.hypot(px-x,py-y);
}
function blockedBySegmentLocal(x,y,w,radius){
  if(!w||!w[0]||!w[1])return false;
  return distPointToSegLocal(x,y,w[0][0],w[0][1],w[1][0],w[1][1]) < Math.max(8,radius);
}
function doorBlocksMoveLocal(d){return d && d.open!==true && Array.isArray(d.wall);}

function blockedMoveLocal(p,nx,ny){
  if(!p)return true;
  const r=tokenRadius(p);

  for(const w of (walls||[])){
    if(!w||!w[0]||!w[1])continue;
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
    if(blockedBySegmentLocal(nx,ny,w,r))return true;
  }

  for(const door of (doors||[])){
    if(!doorBlocksMoveLocal(door))continue;
    const w=door.wall;
    if(!w||!w[0]||!w[1])continue;
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
    if(blockedBySegmentLocal(nx,ny,w,r))return true;
  }

  return (players||[]).some(o=>{
    if(!o||o.id===p.id)return false;
    return Math.hypot((o.x||0)-nx,(o.y||0)-ny)<(r+tokenRadius(o))*0.92;
  });
}
function tokenLightRadius(p){
  const raw=p?p.light:undefined;
  const v=(raw===undefined||raw===null||raw==='')?1:Math.max(0,Number(raw)||0);
  if(v<=0)return 0;
  return v<=20?v*50:v*5;
}








// ===== EVENTOS CANVAS CORRIGIDOS: RÉGUA PRIORITÁRIA + TOKEN + PAN =====
function findTokenAt(x,y,rad=26){
  let hit=null,best=999999;
  (typeof visiblePlayers==='function'?visiblePlayers():players).forEach(p=>{
    const d=Math.hypot(p.x-x,p.y-y);
    if(d<rad&&d<best){best=d;hit=p;}
  });
  return hit;
}

function beginRuler(x,y){
  dragging=null;
  rulerStart=[x,y];
  rulerEnd=[x,y];
  window.sharedRuler={a:rulerStart,b:rulerEnd};
  socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});
  requestDraw();
}

function moveRuler(x,y){
  if(!rulerStart)return;
  rulerEnd=[x,y];
  window.sharedRuler={a:rulerStart,b:rulerEnd};
  socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});
  requestDraw();
}

function endRuler(){
  if(me&&me.room){
    socket.emit('setRuler',{room:me.room,ruler:null});
  }
  window.sharedRuler=null;
  rulerStart=null;
  rulerEnd=null;
  requestDraw();
}

canvas.addEventListener('mousedown',e=>{
  const [x,y]=getPos(e);

  if(tool==='ruler'){
    beginRuler(x,y);
    return;
  }

  if(tool==='draw'){
    if(!me?.isMaster)return;
    if(drawMode==='line')wallStart=[Math.round(x/50)*50,Math.round(y/50)*50];
    if(drawMode==='door')wallStart=[x,y];
    if(drawMode==='free')freeDrawPoints=[[x,y]];
    if(drawMode==='circle')circleStart=[x,y];
    dragging=null;
    return;
  }

  if(tool==='pan'){
    if(me&&!me.isMaster){followMode=false;updateFollowButton?.();}
    dragging='pan';
    canvas.dataset.px=e.clientX;
    canvas.dataset.py=e.clientY;
    return;
  }

  if(tryToggleDoorAt(x,y)){dragging=null;return;}const hit=findTokenAt(x,y,26);
  if(hit&&!me.isMaster&&(hit.isNpc||hit.ownerId!==me.pid))return;
  if(hit&&tool==='move'){
    dragging=hit;
    selectedId=hit.id;
    tokenPanelHidden=false;
    tokenPanelOpen=false;
    syncTokenPanel();
  }
});

canvas.addEventListener('mousemove',e=>{
  const [x,y]=getPos(e);

  if(tool==='ruler'){
    if(rulerStart)moveRuler(x,y);
    return;
  }

  if(tool==='pan'&&dragging==='pan'){
    offsetX+=e.clientX-Number(canvas.dataset.px||e.clientX);
    offsetY+=e.clientY-Number(canvas.dataset.py||e.clientY);
    canvas.dataset.px=e.clientX;
    canvas.dataset.py=e.clientY;
    camTargetX=offsetX;
    camTargetY=offsetY;
    requestDraw();
    return;
  }

  if(dragging&&dragging!=='pan'){
    if(!me.isMaster&&dragging.isNpc){dragging=null;return;}
    if(!blockedMoveLocal(dragging,x,y)){if(activeMapId)dragging.mapId=activeMapId;dragging.path=Array.isArray(dragging.path)?dragging.path:[];dragging.path.push([Math.round(dragging.x),Math.round(dragging.y)]);if(dragging.path.length>120)dragging.path=dragging.path.slice(-120);smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
    return;
  }

  if(tool==='draw'&&me?.isMaster&&(wallStart||freeDrawPoints||circleStart)){
    if(drawMode==='free'&&freeDrawPoints){
      const last=freeDrawPoints[freeDrawPoints.length-1];
      if(!last||Math.hypot(last[0]-x,last[1]-y)>8)freeDrawPoints.push([x,y]);
    }
    requestDraw();
    previewDrawShape(x,y);
  }
});

canvas.addEventListener('mouseup',e=>{
  const [x,y]=getPos(e);
  if(tool==='draw'&&commitDrawTool(x,y)){dragging=null;return;}

  if(tool==='ruler'){
    endRuler();
    dragging=null;
    return;
  }

  if(tool==='draw'&&me?.isMaster){
    if((drawMode==='line'||drawMode==='door')&&wallStart){
      const end=[Math.round(x/50)*50,Math.round(y/50)*50];
      if(wallStart[0]!==end[0]||wallStart[1]!==end[1])socket.emit('addWall',{room:me.room,wall:[wallStart,end]});
    }
    if(drawMode==='free'&&freeDrawPoints&&freeDrawPoints.length>1){
      const wallsBatch=[];
      for(let i=0;i<freeDrawPoints.length-1;i++)wallsBatch.push([freeDrawPoints[i],freeDrawPoints[i+1]]);
      emitWallsBatch(wallsBatch);
    }
    if(drawMode==='circle'&&circleStart){
      const r=Math.hypot(x-circleStart[0],y-circleStart[1]);
      if(r>8)emitWallsBatch(makeCircleWalls(circleStart[0],circleStart[1],r));
    }
    wallStart=null;freeDrawPoints=null;circleStart=null;
  }

  if(dragging&&dragging!=='pan')emitMoveNow(dragging);
  if(dragging==='pan'&&me&&me.isMaster)emitZoomThrottled(true);
  dragging=null;
});


canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(!me||!me.isMaster)return;

  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left;
  const my=e.clientY-rect.top;

  const beforeX=(mx-offsetX)/scale;
  const beforeY=(my-offsetY)/scale;

  const factor=e.deltaY<0?1.1:0.9;
  scale=Math.max(0.5,Math.min(3,scale*factor));

  offsetX=mx-beforeX*scale;
  offsetY=my-beforeY*scale;
  camTargetX=offsetX;
  camTargetY=offsetY;

  emitZoomThrottled(true);
  requestDraw();
},{passive:false});

canvas.addEventListener('touchstart',e=>{
  e.preventDefault();

  if(e.touches.length===2){
    if(!me||!me.isMaster)return;
    const a=e.touches[0],b=e.touches[1];
    lastPinchDist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    lastPinchScale=scale;
    canvas.dataset.pinchX=(a.clientX+b.clientX)/2;
    canvas.dataset.pinchY=(a.clientY+b.clientY)/2;
    canvas.dataset.pinchOffsetX=offsetX;
    canvas.dataset.pinchOffsetY=offsetY;
    dragging=null;wallStart=null;rulerStart=null;
    return;
  }

  const t=e.touches[0];
  const [x,y]=getPos(t);

  if(tool==='ruler'){
    beginRuler(x,y);
    return;
  }

  if(tool==='draw'){
    if(!me?.isMaster)return;
    if(drawMode==='line')wallStart=[Math.round(x/50)*50,Math.round(y/50)*50];
    if(drawMode==='door')wallStart=[x,y];
    if(drawMode==='free')freeDrawPoints=[[x,y]];
    if(drawMode==='circle')circleStart=[x,y];
    dragging=null;
    return;
  }

  if(tool==='pan'){
    if(me&&!me.isMaster){followMode=false;updateFollowButton?.();}
    dragging='pan';
    canvas.dataset.px=t.clientX;
    canvas.dataset.py=t.clientY;
    return;
  }

  if(tryToggleDoorAt(x,y)){dragging=null;return;}const hit=findTokenAt(x,y,30);
  if(hit&&!me.isMaster&&(hit.isNpc||hit.ownerId!==me.pid))return;
  if(hit&&tool==='move'){
    dragging=hit;
    selectedId=hit.id;
    tokenPanelHidden=false;
    tokenPanelOpen=false;
    syncTokenPanel();
  }else{
    dragging=null;
  }
},{passive:false});

canvas.addEventListener('touchmove',e=>{
  e.preventDefault();

  if(e.touches.length===2&&lastPinchDist&&me?.isMaster){
    const a=e.touches[0],b=e.touches[1];
    const dist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    scale=Math.max(0.5,Math.min(3,lastPinchScale*(dist/lastPinchDist)));
    const cx=Number(canvas.dataset.pinchX)||window.innerWidth/2;
    const cy=Number(canvas.dataset.pinchY)||window.innerHeight/2;
    const pox=Number(canvas.dataset.pinchOffsetX)||offsetX;
    const poy=Number(canvas.dataset.pinchOffsetY)||offsetY;
    const ratio=scale/lastPinchScale;
    offsetX=cx-(cx-pox)*ratio;
    offsetY=cy-(cy-poy)*ratio;
    camTargetX=offsetX;
    camTargetY=offsetY;
    emitZoomThrottled();
    requestDraw();
    return;
  }

  const t=e.touches[0];
  const [x,y]=getPos(t);

  if(tool==='ruler'){
    if(rulerStart)moveRuler(x,y);
    return;
  }

  if(tool==='pan'&&dragging==='pan'){
    offsetX+=t.clientX-Number(canvas.dataset.px||t.clientX);
    offsetY+=t.clientY-Number(canvas.dataset.py||t.clientY);
    canvas.dataset.px=t.clientX;
    canvas.dataset.py=t.clientY;
    camTargetX=offsetX;
    camTargetY=offsetY;
    requestDraw();
    return;
  }

  if(dragging&&dragging!=='pan'){
    if(!me.isMaster&&dragging.isNpc){dragging=null;return;}
    if(!blockedMoveLocal(dragging,x,y)){if(activeMapId)dragging.mapId=activeMapId;dragging.path=Array.isArray(dragging.path)?dragging.path:[];dragging.path.push([Math.round(dragging.x),Math.round(dragging.y)]);if(dragging.path.length>120)dragging.path=dragging.path.slice(-120);smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
    return;
  }

  if(tool==='draw'&&me?.isMaster&&(wallStart||freeDrawPoints||circleStart)){
    if(drawMode==='free'&&freeDrawPoints){
      const last=freeDrawPoints[freeDrawPoints.length-1];
      if(!last||Math.hypot(last[0]-x,last[1]-y)>8)freeDrawPoints.push([x,y]);
    }
    requestDraw();
    previewDrawShape(x,y);
  }
},{passive:false});

canvas.addEventListener('touchend',e=>{
  e.preventDefault();

  if(e.touches.length<2)lastPinchDist=0;
  if(e.touches.length>0)return;

  if(tool==='ruler'){
    endRuler();
    dragging=null;
    return;
  }

  const t=e.changedTouches&&e.changedTouches[0];
  if(t){
    const [x,y]=getPos(t);
    if(tool==='draw'&&commitDrawTool(x,y)){dragging=null;return;}
    if(wallStart&&me?.isMaster){
      const end=[Math.round(x/50)*50,Math.round(y/50)*50];
      if(wallStart[0]!==end[0]||wallStart[1]!==end[1]){
        socket.emit('addWall',{room:me.room,wall:[wallStart,end]});
      }
      wallStart=null;
    }
  }

  if(dragging==='pan'&&me&&me.isMaster)emitZoomThrottled(true);
  dragging=null;
},{passive:false});

canvas.addEventListener('dblclick',e=>{
  const [x,y]=getPos(e);
  let c=null;
  players.forEach(p=>{if(Math.hypot(p.x-x,p.y-y)<24)c=p;});
  if(c&&((me.pid&&c.ownerId===me.pid)||me.isMaster)){openPlayerSheet(c.id);}
});
function isVisible(px,py,tx,ty){for(const w of walls){if(lineIntersect(px,py,tx,ty,w[0][0],w[0][1],w[1][0],w[1][1]))return false;}return true;}
function lineIntersect(x1,y1,x2,y2,x3,y3,x4,y4){const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);if(!d)return false;const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/d;return t>0&&t<1&&u>0&&u<1;}
function toggleDice(){const d=document.getElementById('dice');d.style.display=d.style.display==='none'?'block':'none';}
function roll(notation){if(!notation)return;const m=notation.match(/(\d*)d(\d+)([+-]\d+)?/i);if(!m)return;const count=parseInt(m[1]||1);const sides=parseInt(m[2]);const mod=parseInt(m[3]||0);socket.emit('rollDice',{room:me.room,player:me.name,notation,count,sides,mod});}
socket.on('diceRolled',d=>{const log=document.getElementById('diceLog');const div=document.createElement('div');div.style.marginBottom='4px';div.style.padding='4px';div.style.background='rgba(255,255,255,0.05)';div.style.borderRadius='4px';const rollsStr=d.rolls.join('+');const modStr=d.mod?`${d.mod>0?'+':''}${d.mod}`:'';div.innerHTML=`<strong style="color:#c97c3d">${d.player}</strong>: ${d.notation} = [${rollsStr}]${modStr} = <strong style="color:#fff">${d.total}</strong>`;log.insertBefore(div,log.firstChild);while(log.children.length>10)log.removeChild(log.lastChild);document.getElementById('dice').style.display='block';});



function drawMapInsideLight(mePlayer, radiusWorld){
  if(!mePlayer || !mapImg || radiusWorld<=0)return;

  const sx=offsetX+(mePlayer.x*scale);
  const sy=offsetY+(mePlayer.y*scale);
  const radiusScreen=radiusWorld*scale;

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.beginPath();
  ctx.arc(sx,sy,radiusScreen,0,Math.PI*2);
  ctx.clip();

  // Redesenha o mapa por cima da névoa, limitado ao círculo da luz.
  ctx.setTransform(scale,0,0,scale,offsetX,offsetY);
  ctx.drawImage(mapImg,0,0);

  // Grid e borda dentro da luz também aparecem.
  ctx.strokeStyle='rgba(255,255,255,0.08)';
  ctx.lineWidth=1/scale;
  const gb=getGridBounds();
  for(let i=gb.minX;i<=gb.maxX;i+=50){
    ctx.beginPath();ctx.moveTo(i,gb.minY);ctx.lineTo(i,gb.maxY);ctx.stroke();
  }
  for(let i=gb.minY;i<=gb.maxY;i+=50){
    ctx.beginPath();ctx.moveTo(gb.minX,i);ctx.lineTo(gb.maxX,i);ctx.stroke();
  }
  if(mapWidth&&mapHeight){
    ctx.strokeStyle='rgba(201,124,61,0.45)';
    ctx.lineWidth=2/scale;
    ctx.strokeRect(0,0,mapWidth,mapHeight);
  }

  ctx.restore();
  ctx.globalCompositeOperation='source-over';
}

function drawSingleTokenScreen(p){
  if(!p)return;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);

  const sx=offsetX+(p.x*scale);
  const sy=offsetY+(p.y*scale);
  const r=Math.max(12, tokenRadius(p)*scale);
  const img=tokenImages[p.id];

  if(img){
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx,sy,r,0,Math.PI*2);
    ctx.clip();
    ctx.drawImage(img,sx-r,sy-r,r*2,r*2);
    ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,0.75)';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(sx,sy,r,0,Math.PI*2);
    ctx.stroke();
  }else{
    ctx.fillStyle='#3a6';
    ctx.shadowColor='#3a6';
    ctx.shadowBlur=12;
    ctx.beginPath();
    ctx.arc(sx,sy,r*0.9,0,Math.PI*2);
    ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(255,255,255,0.65)';
    ctx.lineWidth=2;
    ctx.stroke();
  }

  ctx.fillStyle='#fff';
  ctx.font='12px sans-serif';
  ctx.textAlign='center';
  ctx.shadowColor='#000';
  ctx.shadowBlur=4;
  ctx.fillText(p.name||'Token',sx,sy-r-8);
  ctx.restore();
}


function drawTokensInsideLight(mePlayer, radiusWorld){
  if(!mePlayer || radiusWorld<=0)return;

  players.forEach(p=>{
    const d=Math.hypot(p.x-mePlayer.x,p.y-mePlayer.y);

    // O próprio token sempre aparece com luz.
    // Outros tokens/NPCs só aparecem se estiverem dentro da luz.
    if(p.id!==mePlayer.id && d>radiusWorld)return;

    drawSingleTokenScreen(p);
  });
}

function applyFinalFog(){
  if(!fogEnabled)return;
  if(globalLight)return;
  if(me&&me.isMaster)return;

  const mePlayer=players.find(p=>p.ownerId===me.pid&&!p.isNpc)||players.find(p=>p.id===me.pid&&!p.isNpc);

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='rgba(0,0,0,0.97)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();
  ctx.globalCompositeOperation='source-over';

  if(!mePlayer)return;

  const radiusWorld=tokenLightRadius(mePlayer);
  const radiusScreen=radiusWorld*scale;
  const sx=offsetX+(mePlayer.x*scale);
  const sy=offsetY+(mePlayer.y*scale);

  if(radiusWorld<=0)return;

  // Abre a área de luz na camada escura.
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation='destination-out';
  const grad=ctx.createRadialGradient(sx,sy,0,sx,sy,radiusScreen);
  grad.addColorStop(0,'rgba(0,0,0,1)');
  grad.addColorStop(0.75,'rgba(0,0,0,1)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=grad;
  ctx.beginPath();
  ctx.arc(sx,sy,radiusScreen,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation='source-over';

  // Garante visualmente que o mapa aparece dentro da luz.
  drawMapInsideLight(mePlayer, radiusWorld);

  // Redesenha o próprio token e NPCs/tokens que estiverem dentro da luz.
  drawTokensInsideLight(mePlayer, radiusWorld);
}

function preloadTokenImages(){
  players.forEach(p=>{
    if(p.img && !tokenImages[p.id]){
      const img=new Image();
      img.onload=()=>{tokenImages[p.id]=img;requestDraw();};
      img.onerror=()=>{tokenImages[p.id]=null;};
      img.src=p.img;
    }
  });
}

function getGridBounds(){
  // Com mapa carregado, o grid acompanha exatamente o tamanho da imagem.
  if(mapImg && mapWidth && mapHeight){
    return {minX:0,minY:0,maxX:mapWidth,maxY:mapHeight};
  }
  // Sem mapa, grid livre/grande.
  return {minX:-2000,minY:-2000,maxX:4000,maxY:4000};
}






function drawDoorsForMaster(){
  if(!me||!me.isMaster)return;

  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.scale(scale,scale);

  (doors||[]).forEach(d=>{
    if(!d||!d.wall)return;
    const w=d.wall;
    const x1=w[0][0], y1=w[0][1], x2=w[1][0], y2=w[1][1];

    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';

    ctx.strokeStyle='rgba(0,0,0,0.9)';
    ctx.lineWidth=9/scale;
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();

    ctx.strokeStyle=d.open?'rgba(0,255,120,1)':'rgba(255,0,0,1)';
    ctx.lineWidth=6/scale;
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();

    ctx.restore();
  });

  ctx.restore();
}





function tryToggleDoorAt(x,y){
  if(!me || !me.isMaster) return false;
  if(tool==='draw' || tool==='ruler') return false;
  if(typeof findDoorAt !== 'function') return false;

  const doorHit = findDoorAt(x,y);
  if(!doorHit || !doorHit.wall) return false;

  const w = doorHit.wall;
  const dist = distPointToSeg(x,y,w[0][0],w[0][1],w[1][0],w[1][1]);

  if(dist < (8/scale)){
    socket.emit('toggleDoor',{room:me.room,id:doorHit.id});
    return true;
  }
  return false;
}

// HITBOX_PORTA_PRECISA: a porta só ativa quando tocar bem em cima dela.
function findDoorAt(x,y){
  if(!me||!me.isMaster)return null;
  let best=null,bestD=999999;
  (doors||[]).forEach(d=>{
    if(!d||!d.wall)return;
    const w=d.wall;
    const dd=distPointToSeg(x,y,w[0][0],w[0][1],w[1][0],w[1][1]);
    if(dd<(8/scale)&&dd<bestD){best=d;bestD=dd;}
  });
  return best;
}


function drawPlayerVisionForMaster(){
  if(!me || !me.isMaster) return;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  players.forEach(p=>{
    if(p.isNpc) return;

    const r = tokenLightRadius(p);
    if(!r || r <= 0) return;

    ctx.save();
    ctx.strokeStyle='rgba(80,180,255,0.85)';
    ctx.fillStyle='rgba(80,180,255,0.08)';
    ctx.lineWidth=2/scale;
    ctx.setLineDash([8/scale,6/scale]);

    ctx.beginPath();
    ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle='rgba(180,230,255,0.95)';
    ctx.font=`${12/scale}px sans-serif`;
    ctx.textAlign='center';
    ctx.shadowColor='#000';
    ctx.shadowBlur=4/scale;
    ctx.fillText('visão: '+(p.light??0),p.x,p.y-r-8/scale);
    ctx.restore();
  });

  ctx.restore();
}

function draw(){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);if(mapImg)ctx.drawImage(mapImg,0,0);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1/scale;const gb=getGridBounds();
for(let i=gb.minX;i<=gb.maxX;i+=50){
  ctx.beginPath();
  ctx.moveTo(i,gb.minY);
  ctx.lineTo(i,gb.maxY);
  ctx.stroke();
}
for(let i=gb.minY;i<=gb.maxY;i+=50){
  ctx.beginPath();
  ctx.moveTo(gb.minX,i);
  ctx.lineTo(gb.maxX,i);
  ctx.stroke();
}
if(mapImg&&mapWidth&&mapHeight){
  ctx.strokeStyle='rgba(201,124,61,0.65)';
  ctx.lineWidth=2/scale;
  ctx.strokeRect(0,0,mapWidth,mapHeight);
  ctx.strokeStyle='rgba(255,255,255,0.06)';
  ctx.lineWidth=1/scale;
}ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.shadowColor='rgba(201,124,61,0.5)';ctx.shadowBlur=8/scale;if(me&&me.isMaster){walls.forEach(w=>{ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});}ctx.shadowBlur=0;players.forEach(p=>{if(p.img && !tokenImages[p.id]){const im=new Image();im.onload=()=>{tokenImages[p.id]=im;requestDraw();};im.src=p.img;}const img=tokenImages[p.id];ctx.save();const tokenR=tokenRadius(p);if(img){ctx.beginPath();ctx.arc(p.x,p.y,tokenR,0,7);ctx.clip();ctx.drawImage(img,p.x-tokenR,p.y-tokenR,tokenR*2,tokenR*2);ctx.restore();ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,tokenR,0,7);ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=2/scale;ctx.stroke();}else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.shadowColor=p.isNpc?'#a33':'#3a6';ctx.shadowBlur=12/scale;ctx.beginPath();ctx.arc(p.x,p.y,tokenR*0.9,0,7);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2/scale;ctx.stroke();}ctx.fillStyle='#fff';ctx.font=`${12/scale}px sans-serif`;ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4/scale;ctx.fillText(p.name,p.x,p.y-26/scale);ctx.shadowBlur=0;if(!p.isNpc || (me&&me.isMaster)){ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(p.x-18/scale,p.y+20/scale,36/scale,5/scale);ctx.fillStyle=p.hp>p.maxHp*0.5?'#4ade80':p.hp>p.maxHp*0.25?'#facc15':'#f87171';ctx.fillRect(p.x-18/scale,p.y+20/scale,36/scale*Math.max(0,p.hp/p.maxHp),5/scale);}if(p.id===selectedId){ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.shadowColor='#c97c3d';ctx.shadowBlur=12/scale;ctx.beginPath();ctx.arc(p.x,p.y,24/scale,0,7);ctx.stroke();}ctx.restore();});ctx.restore();drawDoorsForMaster();drawPlayerVisionForMaster();applyFinalFog();ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;if(rr&&rr.a&&rr.b){ctx.strokeStyle='#0ff';ctx.lineWidth=2/scale;ctx.beginPath();ctx.moveTo(rr.a[0],rr.a[1]);ctx.lineTo(rr.b[0],rr.b[1]);ctx.stroke();const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);ctx.fillStyle='#0ff';ctx.font=`${14/scale}px sans-serif`;ctx.fillText(Math.round(dist/10)+' ft',(rr.a[0]+rr.b[0])/2,(rr.a[1]+rr.b[1])/2);}ctx.restore();}
function addNpc(){if(!me||!me.isMaster){alert('Entre como Mestre para criar NPC');return;}socket.emit('addNpc',{room:me.room,name:document.getElementById('npcName').value||'NPC',hp:Number(document.getElementById('npcHp').value)||10,maxHp:Number(document.getElementById('npcHp').value)||Number(document.getElementById('npcHp').value)||10,ca:Number(document.getElementById('npcCa').value)||10});}

function clearLocalMap(){
  mapData=null;
  mapImg=null;
  mapWidth=0;
  mapHeight=0;
  const mf=document.getElementById('mapFile');
  if(mf)mf.value='';
  const mu=document.getElementById('mapUrl');
  if(mu)mu.value='';
  requestDraw();
}

function loadMap(){
  const src=(document.getElementById('mapUrl')?.value||'').trim();
  if(!src)return alert('Cole uma URL de imagem ou escolha um arquivo.');
  const img=new Image();
  img.onload=()=>{
    mapData=src;
    mapImg=img;
    mapWidth=img.naturalWidth||img.width||0;
    mapHeight=img.naturalHeight||img.height||0;
    requestDraw();
    const mf=document.getElementById('mapFile');if(mf)mf.value='';
    walls=[];doors=[];socket.emit('replaceWalls',{room:me.room,walls:[]});socket.emit('replaceDoors',{room:me.room,doors:[]});socket.emit('setMap',{room:me.room,mapData:src,mapW:mapWidth,mapH:mapHeight});
  };
  img.onerror=()=>{
    socket.emit('setMap',{room:me.room,mapData:src,mapW:0,mapH:0});
  };
  img.src=src;
}
function toggleFog(){fogEnabled=!fogEnabled;socket.emit('setFog',{room:me.room,fog:fogEnabled});updateFogLightButtons();requestDraw();}
function toggleLight(){globalLight=!globalLight;socket.emit('setLight',{room:me.room,light:globalLight?1:0});updateFogLightButtons();requestDraw();}
function setTokenImg(){const p=currentEditableToken();if(!p)return alert('Selecione um token primeiro.');const url=(document.getElementById('tokenUrl')?.value||'').trim();if(url){applyTokenImageToPlayer(p,url);return;}const f=document.getElementById('tokenFile')?.files?.[0];if(!f)return alert('Escolha uma imagem ou cole uma URL.');const r=new FileReader();r.onload=ev=>applyTokenImageToPlayer(p,ev.target.result);r.readAsDataURL(f);}
function saveSheet(){
  if(!editingPlayer)return;
  socket.emit('updatePlayer',{
    room:me.room,
    id:editingPlayer.id,
    name:document.getElementById('sName').value,
    hp:Number(document.getElementById('sHp').value),
    maxHp:Number(document.getElementById('sMax').value),
    ca:Number(document.getElementById('sCa').value),
    light:Number(document.getElementById('sLight').value)
  });
  closeSheet();
}
function delToken(){
  if(editingPlayer){
    socket.emit('removePlayer',{room:me.room,id:editingPlayer.id});
    closeSheet();
  }
}
function closeSheet(){document.getElementById('sheet').style.display='none';editingPlayer=null;}

function undoLastWall(){
  if(!me||!me.isMaster){
    alert('Só o Mestre pode desfazer paredes.');
    return;
  }
  socket.emit('undoWall',{room:me.room});
}

function clearWalls(){socket.emit('clearWalls',{room:me.room});}
function updatePlayerList(){const list=document.getElementById('playerList');if(!list||!me||!me.isMaster)return;list.innerHTML='';players.forEach(p=>{const div=document.createElement('div');div.className='player'+(p.isNpc?' npc':'');div.innerHTML=`<span class="name">${p.name}</span><span class="hp">${p.hp}/${p.maxHp}</span><button class="btn" onclick="openPlayerSheet('${p.id}')">📋</button>`;div.onclick=(e)=>{if(e.target.tagName!=='BUTTON'){selectedId=p.id;tokenPanelHidden=false;tokenPanelOpen=false;syncTokenPanel();center();}};list.appendChild(div);});}
function openPlayerSheet(id){
  const p=typeof id==='string'?players.find(x=>x.id===id):id;
  if(!p)return;
  if(!me.isMaster && p.ownerId!==me.pid)return;
  editingPlayer=p;
  selectedId=p.id;
  const sheet=document.getElementById('sheet');
  if(sheet)sheet.style.display='block';
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val??'';};
  set('sName',p.name||'Token');
  set('sHp',p.hp||0);
  set('sMax',p.maxHp||p.hp||10);
  set('sCa',p.ca||10);
  set('sLight',p.light||0);
  syncTokenPanel();
}
function openSelectedSheet(){if(selectedId)openPlayerSheet(selectedId);}
document.getElementById('mapFile')?.addEventListener('change',e=>{
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    const data=ev.target.result;
    mapData=data;
    mapImg=new Image();
    mapImg.onload=()=>{
      mapWidth=mapImg.naturalWidth||mapImg.width||0;
      mapHeight=mapImg.naturalHeight||mapImg.height||0;
      requestDraw();
      walls=[];doors=[];socket.emit('replaceWalls',{room:me.room,walls:[]});socket.emit('replaceDoors',{room:me.room,doors:[]});socket.emit('setMap',{room:me.room,mapData:data,mapW:mapWidth,mapH:mapHeight});
      e.target.value='';
    };
    mapImg.src=data;
  };
  r.readAsDataURL(f);
});
document.getElementById('tokenFile')?.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const p=currentEditableToken();if(!p)return alert('Selecione um token primeiro.');const r=new FileReader();r.onload=ev=>applyTokenImageToPlayer(p,ev.target.result);r.readAsDataURL(f);});

function toggleMaster(){
  const m=document.getElementById('master');
  const btn=document.getElementById('masterToggle');
  if(!m)return;
  const isHidden = m.style.display==='none' || window.getComputedStyle(m).display==='none';
  if(isHidden){
    m.style.display='block';
    if(btn)btn.innerText='✕';
    if(btn)btn.title='Fechar menu';
  }else{
    m.style.display='none';
    if(btn)btn.innerText='☰';
    if(btn)btn.title='Abrir menu';
  }
}


socket.on('rollResult',d=>{try{const log=document.getElementById('diceLog');if(!log)return;const div=document.createElement('div');div.style.marginBottom='4px';div.style.padding='4px';div.style.background='rgba(255,255,255,0.05)';div.style.borderRadius='4px';div.innerHTML=`<strong style="color:#c97c3d">${d.name||'Jogador'}</strong>: d20 = <strong style="color:#fff">${d.roll}</strong>`;log.insertBefore(div,log.firstChild);document.getElementById('dice').style.display='block';}catch(e){}});


function loop(){
  smoothCamera();
  clampCamera();
  draw();
  requestAnimationFrame(loop);
}
loop();

// FIX TOUCH MOBILE







// ===== DADOS CORRIGIDOS / ROBUSTOS =====
function parseDiceNotationFixed(notation){
  notation=String(notation||'').trim().toLowerCase();
  if(!notation)return null;
  const m=notation.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if(!m)return null;
  const count=Math.max(1,Math.min(30,parseInt(m[1]||'1',10)));
  const sides=Math.max(2,Math.min(1000,parseInt(m[2],10)));
  const mod=parseInt(m[3]||'0',10);
  return {notation,count,sides,mod};
}

function addDiceLogFixed(d){
  const log=document.getElementById('diceLog');
  const panel=document.getElementById('dice');
  if(!log)return;

  const div=document.createElement('div');
  div.style.marginBottom='4px';
  div.style.padding='6px';
  div.style.background='rgba(255,255,255,0.07)';
  div.style.borderRadius='6px';

  const rolls=Array.isArray(d.rolls)?d.rolls:[];
  const rollsStr=rolls.join('+');
  const mod=Number(d.mod)||0;
  const modStr=mod?`${mod>0?'+':''}${mod}`:'';

  div.innerHTML=`<strong style="color:#c97c3d">${d.player||'Jogador'}</strong>: ${d.notation||'dado'} = [${rollsStr}]${modStr} = <strong style="color:#fff">${d.total}</strong>`;
  log.insertBefore(div,log.firstChild);
  while(log.children.length>12)log.removeChild(log.lastChild);

  if(panel)panel.style.display='block';
}

window.toggleDice=function(){
  const d=document.getElementById('dice');
  if(!d)return alert('Painel de dados não encontrado.');
  d.style.display=(d.style.display==='none'||!d.style.display)?'block':'none';
};

window.roll=function(notation){
  const parsed=parseDiceNotationFixed(notation);
  if(!parsed){
    alert('Use formato tipo: 1d20, 2d6+3, 1d8-1');
    return;
  }

  const payload={
    room:me?.room||'mesa1',
    player:me?.name||'Jogador',
    notation:parsed.notation,
    count:parsed.count,
    sides:parsed.sides,
    mod:parsed.mod
  };

  if(socket&&socket.connected){
    socket.emit('rollDice',payload);
  }else{
    const rolls=Array.from({length:parsed.count},()=>1+Math.floor(Math.random()*parsed.sides));
    const total=rolls.reduce((a,b)=>a+b,0)+parsed.mod;
    addDiceLogFixed({...payload,rolls,total});
  }
};

if(socket&&socket.off)socket.off('diceRolled');
socket.on('diceRolled',d=>addDiceLogFixed(d));


// ===== MOBILE SHEET TAP FIX =====
let mobileTapInfo=null;

canvas.addEventListener('touchstart',e=>{
  if(e.touches.length!==1 || !me)return;
  const t=e.touches[0];
  const [x,y]=getPos(t);
  if(tryToggleDoorAt(x,y))return;const hit=(typeof findTokenAt==='function')?findTokenAt(x,y,34):players.find(p=>Math.hypot(p.x-x,p.y-y)<34);

  if(hit && (me.isMaster || (!hit.isNpc && hit.ownerId===me.pid))){
    mobileTapInfo={id:hit.id,x:t.clientX,y:t.clientY,time:Date.now()};
  }else{
    mobileTapInfo=null;
  }
},true);

canvas.addEventListener('touchend',e=>{
  if(!mobileTapInfo)return;
  const t=e.changedTouches&&e.changedTouches[0];
  if(!t){mobileTapInfo=null;return;}

  const moved=Math.hypot(t.clientX-mobileTapInfo.x,t.clientY-mobileTapInfo.y);
  const dt=Date.now()-mobileTapInfo.time;
  const id=mobileTapInfo.id;
  mobileTapInfo=null;

  // Toque curto/parado no token abre a ficha no celular.
  if(moved<12 && dt<450){
    selectedId=id;
    openPlayerSheet(id);
  }
},true);


// ===== MOBILE DOUBLE TAP SHEET =====
let lastTapTime = 0;
let lastTapId = null;

canvas.addEventListener('touchend', e => {
  if(e.changedTouches.length !== 1 || !me) return;

  const t = e.changedTouches[0];
  const [x,y] = getPos(t);

  if(tryToggleDoorAt(x,y)) return;

  const hit = (typeof findTokenAt === 'function')
    ? findTokenAt(x,y,34)
    : players.find(p => Math.hypot(p.x-x,p.y-y) < 34);

  if(!hit) return;

  if(!me.isMaster && (hit.isNpc || hit.ownerId !== me.pid)) return;

  const now = Date.now();

  if(lastTapId === hit.id && (now - lastTapTime) < 300){
    selectedId = hit.id;
    openPlayerSheet(hit.id);
    lastTapTime = 0;
    lastTapId = null;
    return;
  }

  lastTapTime = now;
  lastTapId = hit.id;
}, true);

// SAVE_IMPORT_COMPLETO_FINAL
function exportFullMap(){
  if(!me||!me.isMaster)return alert('Só o Mestre pode salvar.');
  const data={
    version:1,
    savedAt:new Date().toISOString(),
    map:{data:mapData||null,w:mapWidth||0,h:mapHeight||0},
    walls:Array.isArray(walls)?walls:[],
    doors:Array.isArray(doors)?doors:[],
    npcs:players.filter(p=>p.isNpc).map(p=>({
      id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,ca:p.ca,
      light:p.light||0,ownerId:p.ownerId||'master',isNpc:true,img:p.img||''
    }))
  };
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='taverna_cena_'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
}
function importFullMapClick(){
  if(!me||!me.isMaster)return alert('Só o Mestre pode importar.');
  const input=document.getElementById('saveMapFile');
  if(input)input.click();
}
function applyImportedScene(data){
  if(!data||typeof data!=='object')throw new Error('Arquivo inválido');
  const m=data.map||{};
  mapData=m.data||null; mapWidth=Number(m.w)||0; mapHeight=Number(m.h)||0;
  // Ao importar outro mapa/cena, apaga as paredes anteriores e usa apenas as paredes do arquivo.
  walls=Array.isArray(data.walls)?data.walls:[];
  doors=Array.isArray(data.doors)?data.doors:[];
  const npcs=Array.isArray(data.npcs)?data.npcs:[];
  players=players.filter(p=>!p.isNpc);
  npcs.forEach(n=>players.push({
    id:n.id||('npc_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)),
    name:String(n.name||'NPC').slice(0,40),
    x:Number(n.x)||400,y:Number(n.y)||300,
    hp:Number(n.hp)||10,maxHp:Number(n.maxHp)||Number(n.hp)||10,
    ca:Number(n.ca)||10,light:Number(n.light)||0,
    ownerId:n.ownerId||me.pid||'master',isNpc:true,img:n.img||''
  }));
  if(mapData){mapImg=new Image();mapImg.onload=()=>{if(!mapWidth)mapWidth=mapImg.naturalWidth||mapImg.width||0;if(!mapHeight)mapHeight=mapImg.naturalHeight||mapImg.height||0;requestDraw();};mapImg.src=mapData;}
  else{mapImg=null;mapWidth=0;mapHeight=0;}
  socket.emit('setMap',{room:me.room,mapData:mapData||'',mapW:mapWidth,mapH:mapHeight});
  socket.emit('replaceWalls',{room:me.room,walls});
  socket.emit('replaceDoors',{room:me.room,doors});
  socket.emit('replaceNpcs',{room:me.room,npcs});
  updatePlayerList();requestDraw();
}
document.getElementById('saveMapFile')?.addEventListener('change',e=>{
  const file=e.target.files&&e.target.files[0]; if(!file)return;
  const r=new FileReader();
  r.onload=ev=>{try{applyImportedScene(JSON.parse(ev.target.result));}catch(err){alert('Erro ao importar: '+err.message);} e.target.value='';};
  r.readAsText(file);
});

function playDoorSound(open){}

socket.on('reconnect',()=>{console.log('Reconectado.');if(me&&me.room)socket.emit('join',{room:me.room,name:me.name||'Jogador',isMaster:me.isMaster,tokenId:me.pid});});
socket.on('disconnect',()=>console.log('Desconectado. Tentando reconectar...'));

socket.on('moved',d=>{
  const p=players.find(x=>x.id===d.id);
  if(p){
    p.x=d.x;
    p.y=d.y;
    if(p.id===selectedId)syncTokenPanel();
    requestDraw();
  }
});
window.debugSyncMove = function(){
  console.log('SYNC DEBUG', {me, players: players.map(p=>({id:p.id,ownerId:p.ownerId,isNpc:p.isNpc,x:p.x,y:p.y}))});
};


// ===== LISTENERS DE SINCRONIA SEGUROS =====
if(!window.__tavernaSafeListenersInstalled){
  window.__tavernaSafeListenersInstalled = true;

  socket.on('playerUpdated',p=>{
    const i=players.findIndex(x=>x.id===p.id);
    if(i>=0)players[i]={...players[i],...p}; else players.push(p);
    if(p.id===selectedId)syncTokenPanel();
    requestDraw();
  });

  socket.on('wallAdded',w=>{walls.push(w);requestDraw();});
  socket.on('wallsAdded',ws=>{if(Array.isArray(ws)){walls.push(...ws);requestDraw();}});
  socket.on('wallRemoved',()=>{walls.pop();requestDraw();});
  socket.on('wallsUpdated',ws=>{walls=Array.isArray(ws)?ws:[];requestDraw();});
  socket.on('wallsCleared',()=>{walls=[];requestDraw();});

  socket.on('doorAdded',d=>{doors=doors||[];doors.push(d);requestDraw();});
  socket.on('doorsAdded',ds=>{doors=doors||[];if(Array.isArray(ds)){doors.push(...ds);requestDraw();}});
  socket.on('doorUpdated',d=>{
  doors=doors||[];
  const i=doors.findIndex(x=>x.id===d.id);
  if(i>=0)doors[i]=d; else doors.push(d);
  requestDraw();
});
  socket.on('doorRemoved',()=>{doors=doors||[];doors.pop();requestDraw();});
  socket.on('doorsCleared',()=>{doors=[];requestDraw();});

  socket.on('mapCleared',()=>{if(typeof clearLocalMap==='function')clearLocalMap();});
  socket.on('mapSet',data=>{
    const src=(typeof data==='object'&&data)?data.src:data;
    if(!src){if(typeof clearLocalMap==='function')clearLocalMap();return;}
    mapData=src;
    mapWidth=(typeof data==='object'&&data)?Number(data.w)||0:0;
  if(typeof data==='object'&&data&&data.id)activeMapId=data.id;
    mapHeight=(typeof data==='object'&&data)?Number(data.h)||0:0;
    mapImg=new Image();
    mapImg.onload=()=>{
      if(!mapWidth)mapWidth=mapImg.naturalWidth||mapImg.width||0;
      if(!mapHeight)mapHeight=mapImg.naturalHeight||mapImg.height||0;
      requestDraw();
    };
    mapImg.src=mapData;
  });

  socket.on('allCleared',()=>{
    walls=[];
    doors=[];
    players=players.filter(p=>!p.isNpc);
    if(typeof clearLocalMap==='function')clearLocalMap();
    requestDraw();
  });
}

window.join=join;

socket.on('removeToken',id=>{players=players.filter(p=>p.id!==id);requestDraw();updatePlayerList();});


// ===== MULTI MAPAS + CAMINHO DO TOKEN =====
let campaignMaps = [];
let activeMapId = null;
let spawnMapId = null;

function currentVisibleMapId(){return activeMapId||null;}
function visiblePlayers(){
  const mid=currentVisibleMapId();
  if(!mid)return players;
  return players.filter(p=>!p.mapId||p.mapId===mid);
}

function addMapFromMaster(){
  if(!me||!me.isMaster)return alert('Só o Mestre pode adicionar mapas.');
  const name=(document.getElementById('newMapName')?.value||('Mapa '+(campaignMaps.length+1))).trim();
  const url=(document.getElementById('newMapUrl')?.value||'').trim();
  const file=document.getElementById('newMapFile')?.files?.[0];

  const send=(src,w=0,h=0)=>{
    socket.emit('addMap',{room:me.room,map:{name,src,w,h}});
    const f=document.getElementById('newMapFile');if(f)f.value='';
    const u=document.getElementById('newMapUrl');if(u)u.value='';
  };

  if(file){
    const r=new FileReader();
    r.onload=e=>{
      const img=new Image();
      img.onload=()=>send(e.target.result,img.naturalWidth||img.width||0,img.naturalHeight||img.height||0);
      img.src=e.target.result;
    };
    r.readAsDataURL(file);
    return;
  }

  if(url){
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=()=>send(url,img.naturalWidth||img.width||0,img.naturalHeight||img.height||0);
    img.onerror=()=>send(url,0,0);
    img.src=url;
    return;
  }

  alert('Escolha arquivo ou coloque URL do mapa.');
}

function renderMapList(){
  const box=document.getElementById('mapList');
  if(!box)return;
  if(!campaignMaps.length){
    box.innerHTML='<div style="opacity:.7;font-size:12px">Nenhum mapa extra.</div>';
    return;
  }
  box.innerHTML=campaignMaps.map(m=>{
    const active=m.id===activeMapId?'✅':'';
    const spawn=m.id===spawnMapId?'🧍':'';
    const sendBtn=selectedId?`<button onclick="sendSelectedTokenToMap('${m.id}')">Enviar Token</button>`:'';
    return `<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px">
      <b>${active}${spawn} ${m.name||'Mapa'}</b>
      <div class="row" style="margin-top:5px">
        <button onclick="setActiveMap('${m.id}')">Ver</button>
        <button onclick="setSpawnMap('${m.id}')">Spawn</button>
        ${sendBtn}
      </div>
    </div>`;
  }).join('');
}
function setActiveMap(id){if(me?.isMaster)socket.emit('setActiveMap',{room:me.room,id});}
function setSpawnMap(id){if(me?.isMaster)socket.emit('setSpawnMap',{room:me.room,id});}
function sendSelectedTokenToMap(id){if(me?.isMaster&&selectedId)socket.emit('sendTokenToMap',{room:me.room,id:selectedId,mapId:id});}

socket.on('mapsUpdated',d=>{
  campaignMaps=d.maps||[];
  activeMapId=d.activeMapId||null;
  spawnMapId=d.spawnMapId||null;
  renderMapList();
  requestDraw();
});

socket.on('state',s=>{
  if(s&&Array.isArray(s.maps)){
    campaignMaps=s.maps||[];
    activeMapId=s.activeMapId||activeMapId;
    spawnMapId=s.spawnMapId||spawnMapId;
    renderMapList();
  }
});

function drawTokenPaths(){
  const mid=currentVisibleMapId();
  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.scale(scale,scale);
  for(const p of players){
    if(mid&&p.mapId&&p.mapId!==mid)continue;
    if(!Array.isArray(p.path)||p.path.length<2)continue;
    ctx.strokeStyle=p.isNpc?'rgba(180,90,255,.75)':'rgba(80,220,120,.75)';
    ctx.lineWidth=3/scale;
    ctx.beginPath();
    ctx.moveTo(p.path[0][0],p.path[0][1]);
    for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
    ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.9)';
    for(const pt of p.path){
      ctx.beginPath();
      ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();
}



// ===== PATCH v4 LIMPO CORRIGIDO: 1 sistema de token, movimento, luz e régua =====
(function(){
  if(window.__TAVERNA_V4_LIMPO_CORRIGIDO__) return;
  window.__TAVERNA_V4_LIMPO_CORRIGIDO__ = true;

  const STANDEE_H = 65;
  const TOPDOWN_SIZE = 32;
  const LIGHT_DEFAULT = 240;
  const LIGHT_UNIT = 12;

  function N(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function A(v){ return Array.isArray(v)?v:[]; }
  function master(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function plist(){ try{return A(players);}catch(e){return [];} }
  function wlist(){ try{return A(walls);}catch(e){return [];} }
  function dlist(){ try{return A(doors);}catch(e){return [];} }
  function mlist(){
    try{ if(Array.isArray(campaignMaps)&&campaignMaps.length) return campaignMaps; }catch(e){}
    if(mapImg && mapWidth && mapHeight) return [{id:'main',name:'Mapa Principal',x:0,y:0,w:mapWidth,h:mapHeight,src:mapData}];
    return [];
  }

  function rect(m){ return {x:N(m.x),y:N(m.y),w:N(m.w,1000),h:N(m.h,700)}; }
  function inside(m,x,y){
    const r=rect(m);
    return x>=r.x+2 && y>=r.y+2 && x<=r.x+r.w-2 && y<=r.y+r.h-2;
  }
  function mapAt(x,y){
    const ms=mlist();
    for(let i=ms.length-1;i>=0;i--) if(inside(ms[i],x,y)) return ms[i];
    return null;
  }
  function clampToken(p){
    if(!p) return p;
    let m=mapAt(N(p.x),N(p.y));
    if(!m && p.mapId) m=mlist().find(mm=>String(mm.id)===String(p.mapId)) || null;
    if(!m) m=mlist()[0] || null;
    if(!m) return p;
    const r=rect(m);
    p.x=Math.max(r.x+2,Math.min(r.x+r.w-2,N(p.x)));
    p.y=Math.max(r.y+2,Math.min(r.y+r.h-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }
  window.mapAtTokenPoint = mapAt;

  function normalizeToken(p){
    if(!p) return p;
    if(p.tokenStyle!=='standee') p.tokenStyle='topdown';
    if(p.facing!==-1) p.facing=1;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH=STANDEE_H;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW=TOPDOWN_SIZE;
    p.spriteH=Math.max(25,Math.min(180,N(p.spriteH,STANDEE_H)));
    p.spriteW=Math.max(20,Math.min(120,N(p.spriteW,TOPDOWN_SIZE)));
    return p;
  }

  function canMove(p){
    if(!p||!me) return false;
    if(me.isMaster) return true;
    return !p.isNpc && p.ownerId===me.pid;
  }

  // remove controles duplicados de versões antigas
  function removeDuplicatedTokenControls(){
    document.querySelectorAll(
      '#tokenSizeBoxFinal,#tokenSizeBoxFinal2,#tokenSizeBoxFinalR,#tokenLightBoxFinal,#tokenLightBoxFinalR,[id^="tokenSizeBox"]:not(#tokenSizeBoxV4Clean),[id^="tokenLightBox"]:not(#tokenLightBoxV4Clean)'
    ).forEach(el=>el.remove());
  }

  window.applyTokenSizeV4Clean=function(){
    const p=selectedId?plist().find(x=>x.id===selectedId):currentEditableToken?.();
    if(!p) return alert('Selecione um token primeiro.');
    if(!master() && p.ownerId!==me?.pid) return alert('Você só pode alterar seu token.');
    const mode=document.getElementById('tokenModeV4Clean')?.value || 'topdown';
    const size=N(document.getElementById('tokenSizeV4Clean')?.value, mode==='standee'?STANDEE_H:TOPDOWN_SIZE);
    p.tokenStyle = mode==='standee' ? 'standee' : 'topdown';
    if(p.tokenStyle==='standee') p.spriteH=Math.max(25,Math.min(180,size));
    else p.spriteW=Math.max(20,Math.min(120,size));
    socket.emit('updatePlayer',{room:room(),id:p.id,tokenStyle:p.tokenStyle,spriteW:p.spriteW,spriteH:p.spriteH});
    requestDraw();
  };

  window.applyTokenLightV4Clean=function(){
    const p=selectedId?plist().find(x=>x.id===selectedId):currentEditableToken?.();
    if(!p) return alert('Selecione um token primeiro.');
    if(!master() && p.ownerId!==me?.pid) return alert('Você só pode alterar seu token.');
    p.light=Math.max(0,Math.min(200,N(document.getElementById('tokenLightV4Clean')?.value,p.light||20)));
    socket.emit('updatePlayer',{room:room(),id:p.id,light:p.light});
    requestDraw();
  };

  function ensureTokenControls(){
    removeDuplicatedTokenControls();
    const parent=document.getElementById('tokenImagePanel')||document.body;
    if(!document.getElementById('tokenSizeBoxV4Clean')){
      const box=document.createElement('div');
      box.id='tokenSizeBoxV4Clean';
      box.className='section';
      box.innerHTML=`
        <label>Tamanho/Tipo</label>
        <select id="tokenModeV4Clean" style="width:100%;margin-bottom:4px">
          <option value="topdown">Top-down</option>
          <option value="standee">Miniatura em pé</option>
        </select>
        <input id="tokenSizeV4Clean" type="number" value="32" min="20" max="180">
        <button onclick="applyTokenSizeV4Clean()">Aplicar tamanho</button>
      `;
      parent.appendChild(box);
    }
    if(!document.getElementById('tokenLightBoxV4Clean')){
      const box=document.createElement('div');
      box.id='tokenLightBoxV4Clean';
      box.className='section';
      box.innerHTML=`
        <label>Luz</label>
        <input id="tokenLightV4Clean" type="number" value="20" min="0" max="200">
        <button onclick="applyTokenLightV4Clean()">Aplicar luz</button>
      `;
      parent.appendChild(box);
    }
  }
  setTimeout(ensureTokenControls,600);

  const tokenImgCache={}, mapImgCache={};
  function getTokenImg(p){
    if(!p||!p.img) return null;
    if(tokenImgCache[p.id] && tokenImgCache[p.id].__src===p.img) return tokenImgCache[p.id];
    const img=new Image();
    img.__src=p.img;
    img.onload=()=>{ tokenImgCache[p.id]=img; requestDraw(); };
    img.onerror=()=>{ tokenImgCache[p.id]=null; requestDraw(); };
    img.src=p.img;
    tokenImgCache[p.id]=img;
    return img;
  }
  function getMapImg(m){
    if(!m||!m.src) return null;
    if(mapImgCache[m.id] && mapImgCache[m.id].__src===m.src) return mapImgCache[m.id];
    const img=new Image();
    img.__src=m.src;
    img.onload=()=>requestDraw();
    img.src=m.src;
    mapImgCache[m.id]=img;
    return img;
  }

  function lightRadius(p){
    const v=Number(p&&p.light);
    if(Number.isFinite(v)&&v>0) return Math.max(60,v*LIGHT_UNIT);
    if(p&&!p.isNpc) return LIGHT_DEFAULT;
    return 0;
  }
  function fogOn(){ return !!fogEnabled && !globalLight; }
  function ownToken(){
    if(!me) return null;
    return plist().find(p=>!p.isNpc&&p.ownerId===me.pid) || plist().find(p=>!p.isNpc&&p.id===me.pid) || null;
  }
  function visibleToPlayer(p){
    if(master()||!fogOn()) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && p.ownerId===me.pid) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function drawMaps(){
    const ms=mlist();
    for(const m of ms){
      const r=rect(m);
      const img=m.id==='main'?mapImg:getMapImg(m);
      if(img&&img.complete!==false) ctx.drawImage(img,r.x,r.y,r.w,r.h);
      else { ctx.fillStyle='rgba(60,60,70,.7)'; ctx.fillRect(r.x,r.y,r.w,r.h); }
      if(master()){
        ctx.strokeStyle='rgba(201,124,61,.65)';
        ctx.lineWidth=2/scale;
        ctx.strokeRect(r.x,r.y,r.w,r.h);
      }
    }
  }

  function drawGrid(){
    const ms=mlist();
    if(!ms.length) return;
    const rs=ms.map(rect);
    const minX=Math.min(...rs.map(r=>r.x)), minY=Math.min(...rs.map(r=>r.y));
    const maxX=Math.max(...rs.map(r=>r.x+r.w)), maxY=Math.max(...rs.map(r=>r.y+r.h));
    ctx.strokeStyle='rgba(255,255,255,.06)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(minX/50)*50;x<=maxX;x+=50){ctx.beginPath();ctx.moveTo(x,minY);ctx.lineTo(x,maxY);ctx.stroke();}
    for(let y=Math.floor(minY/50)*50;y<=maxY;y+=50){ctx.beginPath();ctx.moveTo(minX,y);ctx.lineTo(maxX,y);ctx.stroke();}
  }

  function drawWallsDoors(){
    if(!master()) return;
    ctx.save();
    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    for(const w of wlist()){
      if(!w||!w[0]||!w[1]) continue;
      ctx.beginPath();ctx.moveTo(N(w[0][0]),N(w[0][1]));ctx.lineTo(N(w[1][0]),N(w[1][1]));ctx.stroke();
    }
    for(const d of dlist()){
      const w=d&&d.wall; if(!w||!w[0]||!w[1]) continue;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();ctx.moveTo(N(w[0][0]),N(w[0][1]));ctx.lineTo(N(w[1][0]),N(w[1][1]));ctx.stroke();
    }
    ctx.restore();
  }

  function drawToken(p){
    normalizeToken(p);
    clampToken(p);
    if(!visibleToPlayer(p)) return;

    const img=getTokenImg(p);
    const x=N(p.x), y=N(p.y);

    if(p.tokenStyle==='standee'){
      const h=N(p.spriteH,STANDEE_H);
      let w=h*0.55;
      if(img&&img.complete&&img.naturalWidth){
        w=h*((img.naturalWidth||img.width)/Math.max(1,(img.naturalHeight||img.height)));
      }
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x,y,Math.max(14,w*.32),7,0,0,Math.PI*2);
      ctx.fillStyle='rgba(0,0,0,.55)';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x,y);
      ctx.scale(p.facing===-1?-1:1,1);
      if(img&&img.complete&&img.naturalWidth) ctx.drawImage(img,-w/2,-h,w,h);
      else { ctx.fillStyle=p.isNpc?'#a33':'#3a6'; ctx.fillRect(-w/2,-h,w,h); }
      ctx.restore();
    }else{
      const size=N(p.spriteW,TOPDOWN_SIZE);
      const r=size/2;
      ctx.save();
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=p.isNpc?'#a33':'#3a6';
      ctx.fill();
      if(img&&img.complete&&img.naturalWidth){
        const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
        const s=Math.min((size*.80)/iw,(size*.80)/ih);
        const w=iw*s,h=ih*s;
        ctx.save();
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
        ctx.restore();
      }
      ctx.strokeStyle=p.id===selectedId?'#c97c3d':'rgba(255,255,255,.55)';
      ctx.lineWidth=(p.id===selectedId?3:2)/scale;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    }
  }

  function drawLightMaster(){
    if(!master()) return;
    ctx.save();
    for(const p of plist()){
      if(p.isNpc) continue;
      const r=lightRadius(p);
      if(!r) continue;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.fillStyle='rgba(80,180,255,.08)';
      ctx.lineWidth=2/scale;
      ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.arc(N(p.x),N(p.y),r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawRuler(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b) return;
    const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);
    ctx.save();
    ctx.strokeStyle='#00e5ff';
    ctx.lineWidth=3/scale;
    ctx.beginPath();ctx.moveTo(rr.a[0],rr.a[1]);ctx.lineTo(rr.b[0],rr.b[1]);ctx.stroke();
    ctx.fillStyle='#00e5ff';
    ctx.font=(14/scale)+'px sans-serif';
    ctx.fillText(Math.round(dist/10)+' ft',(rr.a[0]+rr.b[0])/2,(rr.a[1]+rr.b[1])/2);
    ctx.restore();
  }

  function applyFog(){
    if(master()||!fogOn()) return;
    const own=ownToken();
    if(!own) return;
    const sx=offsetX+N(own.x)*scale;
    const sy=offsetY+N(own.y)*scale;
    const rs=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='rgba(0,0,0,1)';
    ctx.beginPath();ctx.arc(sx,sy,rs*.86,0,Math.PI*2);ctx.fill();

    const g=ctx.createRadialGradient(sx,sy,rs*.72,sx,sy,rs);
    g.addColorStop(0,'rgba(0,0,0,1)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(sx,sy,rs,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    drawMaps();
    drawGrid();
    drawWallsDoors();
    for(const p of plist()) drawToken(p);
    drawLightMaster();
    drawRuler();
    ctx.restore();

    applyFog();
  };

  let draggingClean=null, offX=0, offY=0, lastEmit=0;
  function pos(e){ const r=canvas.getBoundingClientRect(); return [(e.clientX-r.left-offsetX)/scale,(e.clientY-r.top-offsetY)/scale]; }
  function hitToken(x,y){
    let hit=null,best=999999;
    for(const p of plist()){
      if(!canMove(p)) continue;
      const rad=p.tokenStyle==='standee'?Math.max(18,N(p.spriteH,STANDEE_H)*.40):Math.max(18,N(p.spriteW,TOPDOWN_SIZE)*.70);
      const d=Math.hypot(N(p.x)-x,N(p.y)-y);
      if(d<rad&&d<best){hit=p;best=d;}
    }
    return hit;
  }

  function startMove(e){
    if((tool||'move')!=='move') return false;
    const [x,y]=pos(e);
    const p=hitToken(x,y);
    if(!p) return false;
    draggingClean=p;
    selectedId=p.id;
    normalizeToken(draggingClean);
    clampToken(draggingClean);
    offX=N(draggingClean.x)-x;
    offY=N(draggingClean.y)-y;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    requestDraw();
    return true;
  }
  function moveMove(e){
    if(!draggingClean) return false;
    const [x,y]=pos(e);
    const oldX=N(draggingClean.x);
    draggingClean.x=x+offX;
    draggingClean.y=y+offY;
    const m=mapAt(draggingClean.x,draggingClean.y);
    if(!m) clampToken(draggingClean); else draggingClean.mapId=m.id;
    const dx=N(draggingClean.x)-oldX;
    if(Math.abs(dx)>1) draggingClean.facing=dx>=0?-1:1;
    const now=Date.now();
    if(now-lastEmit>45){
      lastEmit=now;
      socket.emit('move',{room:room(),id:draggingClean.id,x:Math.round(draggingClean.x),y:Math.round(draggingClean.y),mapId:draggingClean.mapId,tokenStyle:draggingClean.tokenStyle,spriteW:draggingClean.spriteW,spriteH:draggingClean.spriteH,seq:now});
    }
    requestDraw();
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    return true;
  }
  function endMove(e){
    if(!draggingClean) return false;
    clampToken(draggingClean);
    socket.emit('move',{room:room(),id:draggingClean.id,x:Math.round(draggingClean.x),y:Math.round(draggingClean.y),mapId:draggingClean.mapId,tokenStyle:draggingClean.tokenStyle,spriteW:draggingClean.spriteW,spriteH:draggingClean.spriteH,seq:Date.now()});
    draggingClean=null;
    if(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}
    requestDraw();
    return true;
  }

  canvas.addEventListener('mousedown',startMove,true);
  window.addEventListener('mousemove',moveMove,true);
  window.addEventListener('mouseup',endMove,true);
  canvas.addEventListener('touchstart',e=>{if(e.touches&&e.touches[0])startMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchmove',e=>{if(draggingClean&&e.touches&&e.touches[0])moveMove(e.touches[0]);},{capture:true,passive:false});
  window.addEventListener('touchend',endMove,true);

  socket.on('state',s=>{
    if(s&&Array.isArray(s.players)){
      players=s.players;
      players.forEach(p=>{normalizeToken(p);clampToken(p);});
    }
    requestDraw();
  });
  socket.on('playerMoved',p=>{
    if(!p||!p.id) return;
    normalizeToken(p);clampToken(p);
    const i=players.findIndex(x=>x.id===p.id);
    if(i>=0) players[i]={...players[i],...p}; else players.push(p);
    requestDraw();
  });
  socket.on('playerUpdated',p=>{
    if(!p||!p.id) return;
    normalizeToken(p);
    const i=players.findIndex(x=>x.id===p.id);
    if(i>=0) players[i]={...players[i],...p};
    requestDraw();
  });

  console.log('Taverna v4 limpo corrigido carregado.');
})();


// ===== RESTAURAÇÃO V4: SPAWN GLOBAL + IMPORT MAPAS + SUPER ZOOM + LUZ + TOKEN SEM CORTE =====
(function(){
  if(window.__TAVERNA_V4_RESTORE_SYSTEMS__) return;
  window.__TAVERNA_V4_RESTORE_SYSTEMS__ = true;

  const ZOOM_MIN = 0.08;
  const ZOOM_MAX = 12;
  const STANDEE_H_DEFAULT = 65;
  const TOPDOWN_DEFAULT = 32;
  const LIGHT_UNIT = 12;
  const LIGHT_DEFAULT = 260;

  function N(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function A(v){ return Array.isArray(v)?v:[]; }
  function isMaster(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function P(){ try{return A(players);}catch(e){return [];} }
  function W(){ try{return A(walls);}catch(e){return [];} }
  function D(){ try{return A(doors);}catch(e){return [];} }
  function maps(){
    try{ if(Array.isArray(campaignMaps) && campaignMaps.length) return campaignMaps; }catch(e){}
    if(mapImg && mapWidth && mapHeight) return [{id:'main',name:'Mapa Principal',x:0,y:0,w:mapWidth,h:mapHeight,src:mapData}];
    return [];
  }

  function mapRect(m){ return {x:N(m.x),y:N(m.y),w:N(m.w,1000),h:N(m.h,700)}; }
  function insideMap(m,x,y){
    const r=mapRect(m);
    return x>=r.x+2 && y>=r.y+2 && x<=r.x+r.w-2 && y<=r.y+r.h-2;
  }
  function mapAt(x,y){
    const ms=maps();
    for(let i=ms.length-1;i>=0;i--) if(insideMap(ms[i],x,y)) return ms[i];
    return null;
  }
  function placeInMap(p){
    if(!p) return p;
    let m=mapAt(N(p.x),N(p.y));
    if(!m && p.mapId) m=maps().find(mm=>String(mm.id)===String(p.mapId))||null;
    if(!m) m=maps()[0]||null;
    if(!m) return p;
    const r=mapRect(m);
    p.x=Math.max(r.x+2,Math.min(r.x+r.w-2,N(p.x)));
    p.y=Math.max(r.y+2,Math.min(r.y+r.h-2,N(p.y)));
    p.mapId=m.id;
    return p;
  }

  // -----------------------------
  // SUPER ZOOM
  // -----------------------------
  try{
    canvas.addEventListener('wheel', function(e){
      if(!me || !me.isMaster) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const r=canvas.getBoundingClientRect();
      const mx=e.clientX-r.left, my=e.clientY-r.top;
      const wx=(mx-offsetX)/scale, wy=(my-offsetY)/scale;
      const factor=e.deltaY<0?1.12:0.88;

      scale=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,scale*factor));
      offsetX=mx-wx*scale;
      offsetY=my-wy*scale;
      camTargetX=offsetX;
      camTargetY=offsetY;

      try{socket.emit('setZoom',{room:room(),zoom:scale,offsetX,offsetY});}catch(err){}
      requestDraw();
    }, {capture:true,passive:false});
  }catch(e){}

  // -----------------------------
  // SPAWN GLOBAL
  // -----------------------------
  window.globalSpawns = window.globalSpawns || {};
  function setSpawn(kind,x,y){
    kind=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    if(Number.isFinite(Number(x))&&Number.isFinite(Number(y))) window.globalSpawns[kind]={x:Number(x),y:Number(y)};
    else delete window.globalSpawns[kind];
  }
  function getSpawn(kind){
    const p=(window.globalSpawns||{})[kind];
    return p&&Number.isFinite(Number(p.x))?{x:Number(p.x),y:Number(p.y)}:null;
  }
  function readSpawn(s){
    if(!s) return;
    if(s.globalSpawns){
      if(s.globalSpawns.player) setSpawn('player',s.globalSpawns.player.x,s.globalSpawns.player.y);
      if(s.globalSpawns.npc) setSpawn('npc',s.globalSpawns.npc.x,s.globalSpawns.npc.y);
    }
    const px=s.globalSpawnPlayerX??s.universalPlayerSpawnX;
    const py=s.globalSpawnPlayerY??s.universalPlayerSpawnY;
    const nx=s.globalSpawnNpcX??s.universalNpcSpawnX;
    const ny=s.globalSpawnNpcY??s.universalNpcSpawnY;
    if(Number.isFinite(Number(px))&&Number.isFinite(Number(py))) setSpawn('player',px,py);
    if(Number.isFinite(Number(nx))&&Number.isFinite(Number(ny))) setSpawn('npc',nx,ny);
  }

  window.markGlobalSpawn=function(kind){
    if(!isMaster()) return alert('Só o Mestre pode marcar spawn.');
    window.__pendingSpawnRestore=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    alert('Clique dentro de um mapa para marcar spawn de '+(window.__pendingSpawnRestore==='npc'?'NPC':'jogador'));
  };
  window.clearGlobalSpawn=function(kind){
    if(!isMaster()) return;
    const k=String(kind||'both').toLowerCase();
    if(k==='player'||k==='both') delete window.globalSpawns.player;
    if(k==='npc'||k==='both') delete window.globalSpawns.npc;
    try{socket.emit('clearGlobalSpawnV2',{room:room(),kind:k});}catch(e){}
    renderMapList&&renderMapList();
    requestDraw();
  };

  function worldPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function clickSpawn(ev){
    if(!window.__pendingSpawnRestore || !isMaster()) return false;
    const [x,y]=worldPos(ev);
    if(!mapAt(x,y)) return alert('Spawn precisa ficar dentro de um mapa.');
    const k=window.__pendingSpawnRestore;
    window.__pendingSpawnRestore=null;
    setSpawn(k,Math.round(x),Math.round(y));
    try{socket.emit('setGlobalSpawnV2',{room:room(),kind:k,x:Math.round(x),y:Math.round(y)});}catch(e){}
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    renderMapList&&renderMapList();
    requestDraw();
    return true;
  }
  try{
    canvas.addEventListener('mousedown', clickSpawn, true);
    canvas.addEventListener('touchstart', e=>{if(window.__pendingSpawnRestore&&e.touches&&e.touches[0]) clickSpawn(e.touches[0]);}, {capture:true,passive:false});
  }catch(e){}

  // -----------------------------
  // IMPORTAR MAPAS SALVOS
  // -----------------------------
  window.importFullMapClick=function(){
    if(!isMaster()) return alert('Só o Mestre pode importar.');
    let input=document.getElementById('saveMapFile');
    if(!input){
      input=document.createElement('input');
      input.type='file';
      input.accept='application/json,.json';
      input.id='saveMapFile';
      input.style.display='none';
      document.body.appendChild(input);
    }
    const fresh=input.cloneNode(true);
    input.parentNode.replaceChild(fresh,input);
    input=fresh;
    input.onchange=function(e){
      const file=e.target.files&&e.target.files[0];
      if(!file) return;
      const r=new FileReader();
      r.onload=function(ev){
        try{
          const state=JSON.parse(ev.target.result);
          socket.emit('importFullState',{room:room(),state,merge:false});
          if(Array.isArray(state.maps)){
            try{campaignMaps=state.maps;}catch(err){window.campaignMaps=state.maps;}
            activeMapId=state.activeMapId || state.maps[0]?.id || activeMapId;
          }
          if(Array.isArray(state.players)) players=state.players;
          if(Array.isArray(state.walls)) walls=state.walls;
          if(Array.isArray(state.doors)) doors=state.doors;
          if(state.mapData){
            mapData=state.mapData;
            mapWidth=Number(state.mapW)||mapWidth;
            mapHeight=Number(state.mapH)||mapHeight;
            mapImg=new Image();
            mapImg.onload=()=>requestDraw();
            mapImg.src=mapData;
          }
          readSpawn(state);
          renderMapList&&renderMapList();
          requestDraw();
        }catch(err){ alert('Erro ao importar: '+err.message); }
      };
      r.readAsText(file);
    };
    input.click();
  };

  // -----------------------------
  // LISTA DE MAPAS COM SPAWN
  // -----------------------------
  const oldRenderMapList = window.renderMapList;
  window.renderMapList=function(){
    const box=document.getElementById('mapList');
    if(!box){ if(oldRenderMapList) oldRenderMapList(); return; }

    const fmt=p=>p?Math.round(p.x)+','+Math.round(p.y):'não marcado';
    let html=`<div style="border:1px solid rgba(201,124,61,.45);border-radius:8px;padding:7px;margin:4px 0 8px;font-size:12px;background:rgba(201,124,61,.10)">
      <b>Spawn global</b><br>
      <small>Jogador: ${fmt(getSpawn('player'))}<br>NPC: ${fmt(getSpawn('npc'))}</small>
      <div class="row" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
        <button onclick="markGlobalSpawn('player')">Marcar Jogador</button>
        <button onclick="markGlobalSpawn('npc')">Marcar NPC</button>
        <button onclick="clearGlobalSpawn('player')">Remover Jogador</button>
        <button onclick="clearGlobalSpawn('npc')">Remover NPC</button>
      </div>
    </div>`;

    const ms=maps().filter(m=>m.id!=='main');
    if(!ms.length){
      html += '<div style="opacity:.7;font-size:12px">Nenhum mapa extra.</div>';
    }else{
      html += ms.map(m=>{
        const active=m.id===activeMapId?'✅':'';
        return `<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px">
          <b>${active} ${m.name||'Mapa'}</b><br>
          <small>x:${Math.round(N(m.x))} y:${Math.round(N(m.y))} w:${Math.round(N(m.w,1000))} h:${Math.round(N(m.h,700))}</small>
          <div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
            <button onclick="setActiveMap&&setActiveMap('${m.id}')">Ver</button>
            <button onclick="sendSelectedTokenToMap&&sendSelectedTokenToMap('${m.id}')">Enviar Token</button>
          </div>
        </div>`;
      }).join('');
    }
    box.innerHTML=html;
  };

  // -----------------------------
  // TOKEN SEM CORTE + LUZ
  // -----------------------------
  const tokenCache={}, mapCache={};
  function getTokenImage(p){
    if(!p||!p.img) return null;
    if(tokenCache[p.id]&&tokenCache[p.id].__src===p.img) return tokenCache[p.id];
    const im=new Image();
    im.__src=p.img;
    im.onload=()=>{tokenCache[p.id]=im;requestDraw();};
    im.onerror=()=>{tokenCache[p.id]=null;requestDraw();};
    im.src=p.img;
    tokenCache[p.id]=im;
    return im;
  }
  function getMapImage(m){
    if(!m||!m.src) return null;
    if(mapCache[m.id]&&mapCache[m.id].__src===m.src) return mapCache[m.id];
    const im=new Image();
    im.__src=m.src;
    im.onload=()=>requestDraw();
    im.src=m.src;
    mapCache[m.id]=im;
    return im;
  }
  function normalizeToken(p){
    if(!p) return p;
    if(p.tokenStyle!=='standee') p.tokenStyle='topdown';
    if(p.facing!==-1) p.facing=1;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH=STANDEE_H_DEFAULT;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW=TOPDOWN_DEFAULT;
    p.spriteH=Math.max(25,Math.min(180,N(p.spriteH,STANDEE_H_DEFAULT)));
    p.spriteW=Math.max(20,Math.min(120,N(p.spriteW,TOPDOWN_DEFAULT)));
    placeInMap(p);
    return p;
  }
  function lightRadius(p){
    const v=Number(p&&p.light);
    if(Number.isFinite(v)&&v>0) return Math.max(80,v*LIGHT_UNIT);
    if(p&&!p.isNpc) return LIGHT_DEFAULT;
    return 0;
  }
  function fogIsOn(){ return !!fogEnabled && !globalLight; }
  function ownToken(){
    if(!me) return null;
    return P().find(p=>!p.isNpc&&p.ownerId===me.pid) || P().find(p=>!p.isNpc&&p.id===me.pid) || P().find(p=>!p.isNpc) || null;
  }
  function visibleToPlayer(p){
    if(isMaster()||!fogIsOn()) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===me.pid || p.id===me.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadius(own);
  }

  function drawMapsRestore(){
    for(const m of maps()){
      const r=mapRect(m);
      const im=m.id==='main'?mapImg:getMapImage(m);
      if(im&&im.complete!==false) ctx.drawImage(im,r.x,r.y,r.w,r.h);
      else{ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect(r.x,r.y,r.w,r.h);}
      if(isMaster()){
        ctx.strokeStyle='rgba(201,124,61,.65)';
        ctx.lineWidth=2/scale;
        ctx.strokeRect(r.x,r.y,r.w,r.h);
      }
    }
  }
  function drawGridRestore(){
    const ms=maps();
    if(!ms.length) return;
    const rs=ms.map(mapRect);
    const minX=Math.min(...rs.map(r=>r.x)), minY=Math.min(...rs.map(r=>r.y));
    const maxX=Math.max(...rs.map(r=>r.x+r.w)), maxY=Math.max(...rs.map(r=>r.y+r.h));
    ctx.strokeStyle='rgba(255,255,255,.06)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(minX/50)*50;x<=maxX;x+=50){ctx.beginPath();ctx.moveTo(x,minY);ctx.lineTo(x,maxY);ctx.stroke();}
    for(let y=Math.floor(minY/50)*50;y<=maxY;y+=50){ctx.beginPath();ctx.moveTo(minX,y);ctx.lineTo(maxX,y);ctx.stroke();}
  }
  function drawWallsDoorsRestore(){
    if(!isMaster()) return;
    ctx.save();
    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    for(const w of W()){
      if(!w||!w[0]||!w[1]) continue;
      ctx.beginPath();ctx.moveTo(N(w[0][0]),N(w[0][1]));ctx.lineTo(N(w[1][0]),N(w[1][1]));ctx.stroke();
    }
    for(const d of D()){
      const w=d&&d.wall;if(!w||!w[0]||!w[1]) continue;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();ctx.moveTo(N(w[0][0]),N(w[0][1]));ctx.lineTo(N(w[1][0]),N(w[1][1]));ctx.stroke();
    }
    ctx.restore();
  }
  function drawSpawnRestore(){
    if(!isMaster()) return;
    const arr=[];
    const p=getSpawn('player'), npc=getSpawn('npc');
    if(p) arr.push({x:p.x,y:p.y,icon:'🧍',color:'rgba(80,255,140,1)'});
    if(npc) arr.push({x:npc.x,y:npc.y,icon:'👹',color:'rgba(255,90,90,1)'});
    for(const s of arr){
      ctx.save();
      ctx.fillStyle='rgba(0,0,0,.75)';
      ctx.strokeStyle=s.color;
      ctx.lineWidth=3/scale;
      ctx.beginPath();ctx.arc(s.x,s.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.font=(20/scale)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.icon,s.x,s.y+1);
      ctx.restore();
    }
  }
  function drawTokenRestore(p){
    normalizeToken(p);
    if(!visibleToPlayer(p)) return;
    const im=getTokenImage(p);
    const x=N(p.x), y=N(p.y);
    if(p.tokenStyle==='standee'){
      const h=N(p.spriteH,STANDEE_H_DEFAULT);
      let w=h*.55;
      if(im&&im.complete&&im.naturalWidth){
        w=h*((im.naturalWidth||im.width)/Math.max(1,(im.naturalHeight||im.height)));
      }
      ctx.save();
      ctx.beginPath();ctx.ellipse(x,y,Math.max(14,w*.32),7,0,0,Math.PI*2);
      ctx.fillStyle='rgba(0,0,0,.55)';ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x,y);
      ctx.scale(p.facing===-1?-1:1,1);
      if(im&&im.complete&&im.naturalWidth) ctx.drawImage(im,-w/2,-h,w,h);
      else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fillRect(-w/2,-h,w,h);}
      ctx.restore();
    }else{
      const size=N(p.spriteW,TOPDOWN_DEFAULT);
      const r=size/2;
      ctx.save();
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fill();
      if(im&&im.complete&&im.naturalWidth){
        const iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height;
        const s=Math.min((size*.8)/iw,(size*.8)/ih);
        const w=iw*s, h=ih*s;
        ctx.save();
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
        ctx.drawImage(im,x-w/2,y-h/2,w,h);
        ctx.restore();
      }
      ctx.strokeStyle=p.id===selectedId?'#c97c3d':'rgba(255,255,255,.55)';
      ctx.lineWidth=(p.id===selectedId?3:2)/scale;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    }
  }
  function drawLightMasterRestore(){
    if(!isMaster()) return;
    ctx.save();
    for(const p of P()){
      if(p.isNpc) continue;
      const r=lightRadius(p); if(!r) continue;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.fillStyle='rgba(80,180,255,.08)';
      ctx.lineWidth=2/scale;
      ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.arc(N(p.x),N(p.y),r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function applyFogRestore(){
    if(isMaster()||!fogIsOn()) return;
    const own=ownToken(); if(!own) return;
    const sx=offsetX+N(own.x)*scale, sy=offsetY+N(own.y)*scale, rs=lightRadius(own)*scale;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,.94)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='rgba(0,0,0,1)';
    ctx.beginPath();ctx.arc(sx,sy,rs*.86,0,Math.PI*2);ctx.fill();

    const g=ctx.createRadialGradient(sx,sy,rs*.72,sx,sy,rs);
    g.addColorStop(0,'rgba(0,0,0,1)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath();ctx.arc(sx,sy,rs,0,Math.PI*2);ctx.fill();
    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    drawMapsRestore();
    drawGridRestore();
    drawWallsDoorsRestore();
    drawSpawnRestore();
    for(const p of P()) drawTokenRestore(p);
    drawLightMasterRestore();
    if(typeof drawRulerClean==='function') drawRulerClean();
    ctx.restore();

    applyFogRestore();
  };

  // Socket sync
  try{
    socket.on('state',s=>{readSpawn(s); setTimeout(()=>{renderMapList&&renderMapList();requestDraw();},30);});
    socket.on('mapsUpdated',d=>{readSpawn(d); setTimeout(()=>{renderMapList&&renderMapList();requestDraw();},30);});
  }catch(e){}

  setTimeout(()=>{renderMapList&&renderMapList();requestDraw();},800);
  console.log('Restauração v4 carregada.');
})();


// ===== PATCH EXATO: DRAW ORDEM CORRETA + DRAW TOKEN PROPORCIONAL =====
(function(){
  if(window.__TAVERNA_DRAW_LUZ_TOKEN_EXATO__) return;
  window.__TAVERNA_DRAW_LUZ_TOKEN_EXATO__ = true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function A(v){return Array.isArray(v)?v:[];}
  function isMaster(){try{return !!(me&&me.isMaster)}catch(e){return false}}
  function allPlayers(){try{return A(players)}catch(e){return []}}
  function allMaps(){
    try{if(Array.isArray(campaignMaps)&&campaignMaps.length)return campaignMaps}catch(e){}
    if(mapImg&&mapWidth&&mapHeight)return [{id:'main',x:0,y:0,w:mapWidth,h:mapHeight,src:mapData,name:'Mapa Principal'}];
    return [];
  }

  const mapCacheExact = {};
  function getMapImage(m){
    if(!m||!m.src)return null;
    if(m.id==='main' && mapImg)return mapImg;
    if(mapCacheExact[m.id]&&mapCacheExact[m.id].__src===m.src)return mapCacheExact[m.id];
    const img=new Image();
    img.__src=m.src;
    img.onload=()=>requestDraw&&requestDraw();
    img.src=m.src;
    mapCacheExact[m.id]=img;
    return img;
  }

  function tokenLightValue(p){
    // aceita lightRadius, light ou luz
    const lr = Number(p && p.lightRadius);
    if(Number.isFinite(lr) && lr>0) return lr;
    const l = Number(p && p.light);
    if(Number.isFinite(l) && l>0) return Math.max(60, l*12);
    const luz = Number(p && p.luz);
    if(Number.isFinite(luz) && luz>0) return Math.max(60, luz*12);
    // jogador sempre tem uma luz/visão básica se a névoa estiver ligada
    if(p && !p.isNpc) return 150;
    return 0;
  }

  function ownToken(){
    if(!me)return null;
    return allPlayers().find(p=>!p.isNpc&&p.ownerId===me.pid) ||
           allPlayers().find(p=>!p.isNpc&&p.id===me.pid) ||
           allPlayers().find(p=>!p.isNpc) ||
           null;
  }

  function isInsideOwnLight(p){
    if(isMaster() || !fogEnabled) return true;
    const own=ownToken();
    if(!own)return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid))return true;
    const r=tokenLightValue(own);
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= r;
  }

  // ÚNICA função pública de token proporcional.
  window.drawToken = function(p){
    if(!p || !isInsideOwnLight(p)) return;

    const img = tokenImages && tokenImages[p.id] ? tokenImages[p.id] : null;

    // x/y já são coordenadas do mundo. Aqui a função é chamada com transform do mundo ativo.
    const x = N(p.x);
    const y = N(p.y);

    ctx.save();
    ctx.translate(x, y);

    if(p.tokenStyle === 'standee'){
      if(img && img.complete && img.naturalWidth > 0){
        const h = N(p.spriteH, 65); // altura fixa controlável
        const w = h * (img.naturalWidth / Math.max(1,img.naturalHeight)); // largura proporcional
        ctx.save();
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img, -w/2, -h, w, h); // ancora no pé
        ctx.restore();
      }else{
        const r = 16;
        ctx.beginPath();
        ctx.arc(0, -r, r, 0, Math.PI*2);
        ctx.fillStyle = p.color || (p.isNpc ? '#a33' : '#c97c3d');
        ctx.fill();
      }
    }else{
      // top-down continua pequeno e usa contain dentro do círculo
      const size=N(p.spriteW,32);
      const r=size/2;
      ctx.beginPath();
      ctx.arc(0,0,r,0,Math.PI*2);
      ctx.fillStyle=p.color || (p.isNpc?'#a33':'#c97c3d');
      ctx.fill();

      if(img && img.complete && img.naturalWidth > 0){
        const s=Math.min((size*.82)/img.naturalWidth,(size*.82)/img.naturalHeight);
        const w=img.naturalWidth*s;
        const h=img.naturalHeight*s;
        ctx.save();
        ctx.beginPath();
        ctx.arc(0,0,r,0,Math.PI*2);
        ctx.clip();
        ctx.drawImage(img,-w/2,-h/2,w,h);
        ctx.restore();
      }

      ctx.strokeStyle=p.id===selectedId?'#c97c3d':'rgba(255,255,255,.55)';
      ctx.lineWidth=(p.id===selectedId?3:2)/scale;
      ctx.beginPath();
      ctx.arc(0,0,r,0,Math.PI*2);
      ctx.stroke();
    }

    ctx.restore();
  };

  function drawMapLayer(){
    const maps=allMaps();
    if(maps.length){
      for(const m of maps){
        const x=N(m.x), y=N(m.y), w=N(m.w,mapWidth||1000), h=N(m.h,mapHeight||700);
        const img=getMapImage(m);
        if(img && img.complete !== false){
          ctx.drawImage(img,x,y,w,h);
        }else{
          ctx.fillStyle='rgba(60,60,70,.7)';
          ctx.fillRect(x,y,w,h);
        }
        if(isMaster()){
          ctx.strokeStyle='rgba(201,124,61,.65)';
          ctx.lineWidth=2/scale;
          ctx.strokeRect(x,y,w,h);
        }
      }
    }
  }

  function drawGridLayer(){
    const maps=allMaps();
    if(!maps.length)return;
    const xs=maps.map(m=>N(m.x));
    const ys=maps.map(m=>N(m.y));
    const xe=maps.map(m=>N(m.x)+N(m.w,mapWidth||1000));
    const ye=maps.map(m=>N(m.y)+N(m.h,mapHeight||700));
    const minX=Math.min(...xs), minY=Math.min(...ys), maxX=Math.max(...xe), maxY=Math.max(...ye);
    ctx.strokeStyle='rgba(255,255,255,.055)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(minX/50)*50;x<=maxX;x+=50){ctx.beginPath();ctx.moveTo(x,minY);ctx.lineTo(x,maxY);ctx.stroke();}
    for(let y=Math.floor(minY/50)*50;y<=maxY;y+=50){ctx.beginPath();ctx.moveTo(minX,y);ctx.lineTo(maxX,y);ctx.stroke();}
  }

  function drawFogHoles(){
    if(!fogEnabled || globalLight)return;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='rgba(0,0,0,0.92)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';

    // mestre vê todos os buracos; jogador vê principalmente o próprio
    const sources = isMaster()
      ? allPlayers().filter(p=>!p.isNpc && tokenLightValue(p)>0)
      : [ownToken()].filter(Boolean);

    sources.forEach(p=>{
      const lx = (N(p.x) * scale) + offsetX;
      const ly = (N(p.y) * scale) + offsetY;
      const r = tokenLightValue(p) * scale;
      const g = ctx.createRadialGradient(lx,ly,0,lx,ly,r);
      g.addColorStop(0,'rgba(0,0,0,1)');
      g.addColorStop(0.82,'rgba(0,0,0,1)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.arc(lx,ly,r,0,Math.PI*2);
      ctx.fill();
    });

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  function drawWallsDoorsLayer(){
    if(!isMaster())return;
    const wl=Array.isArray(walls)?walls:[];
    const dl=Array.isArray(doors)?doors:[];
    ctx.save();
    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    wl.forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]),N(w[0][1]));
      ctx.lineTo(N(w[1][0]),N(w[1][1]));
      ctx.stroke();
    });
    dl.forEach(d=>{
      const w=d&&d.wall;if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]),N(w[0][1]));
      ctx.lineTo(N(w[1][0]),N(w[1][1]));
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawTokensLayer(){
    allPlayers().forEach(p=>window.drawToken(p));
  }

  function drawLightLinesMaster(){
    if(!isMaster())return;
    ctx.save();
    allPlayers().forEach(p=>{
      if(p.isNpc)return;
      const r=tokenLightValue(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.fillStyle='rgba(80,180,255,.08)';
      ctx.lineWidth=2/scale;
      ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.arc(N(p.x),N(p.y),r,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  // draw final com ordem correta: mapa -> grid/linhas mestre -> névoa furada -> tokens por cima
  window.draw = function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);

    // 1º mapa
    drawMapLayer();
    drawGridLayer();

    // Paredes/portas só mestre vê, e antes da névoa
    drawWallsDoorsLayer();
    drawLightLinesMaster();

    ctx.restore();

    // 2º névoa preta + buracos de luz
    drawFogHoles();

    // 3º tokens por cima
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    drawTokensLayer();
    ctx.restore();
  };

  setTimeout(()=>requestDraw&&requestDraw(),300);
  console.log('PATCH EXATO draw/luz/token aplicado');
})();


// ===== PATCH DEFINITIVO REAL: LUZ SOLIDA + TOKEN SEM CLIP =====
(function(){
  if(window.__TAVERNA_LUZ_SOLIDA_TOKEN_SEM_CLIP__) return;
  window.__TAVERNA_LUZ_SOLIDA_TOKEN_SEM_CLIP__ = true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function A(v){return Array.isArray(v)?v:[];}
  function isMaster(){try{return !!(me&&me.isMaster)}catch(e){return false}}

  function getLightRadius(p){
    const lr = N(p && p.lightRadius, 0);
    if(lr > 0) return lr;
    const light = N(p && p.light, 0);
    if(light > 0) return Math.max(60, light * 12);
    if(p && !p.isNpc) return 180;
    return 0;
  }

  function mapList(){
    try{
      if(Array.isArray(campaignMaps) && campaignMaps.length) return campaignMaps;
    }catch(e){}
    if(mapImg && mapWidth && mapHeight){
      return [{id:'main',x:0,y:0,w:mapWidth,h:mapHeight,src:mapData}];
    }
    return [];
  }

  const mapCache = {};
  function getMapImage(m){
    if(!m || !m.src) return null;
    if(m.id === 'main' && mapImg) return mapImg;
    if(mapCache[m.id] && mapCache[m.id].__src === m.src) return mapCache[m.id];
    const img = new Image();
    img.__src = m.src;
    img.onload = () => requestDraw && requestDraw();
    img.src = m.src;
    mapCache[m.id] = img;
    return img;
  }

  // ÚNICA FUNÇÃO FINAL DE TOKEN: sem clip, sem circle crop, largura proporcional.
  window.drawToken = function(p){
    if(!p) return;
    const img = tokenImages && tokenImages[p.id] ? tokenImages[p.id] : null;

    const x = (N(p.x) * scale) + offsetX;
    const y = (N(p.y) * scale) + offsetY;

    ctx.save();
    ctx.translate(x, y);

    if(img && img.complete && img.naturalWidth > 0){
      if(p.tokenStyle === 'topdown'){
        // top-down pequeno, mas ainda proporcional e sem cortar
        const h = N(p.spriteW, 32) * scale;
        const w = h * (img.naturalWidth / Math.max(1, img.naturalHeight));
        ctx.drawImage(img, -w/2, -h/2, w, h);
      }else{
        // miniatura em pé: altura fixa, largura proporcional, pé no chão
        const h = N(p.spriteH, 65) * scale;
        const w = h * (img.naturalWidth / Math.max(1, img.naturalHeight));
        ctx.scale(p.facing === -1 ? -1 : 1, 1);
        ctx.drawImage(img, -w/2, -h, w, h);
      }
    }else{
      const r = 16 * scale;
      ctx.beginPath();
      ctx.arc(0, -r, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color || (p.isNpc ? '#a33' : '#c97c3d');
      ctx.fill();
    }

    ctx.restore();
  };

  function drawMapFinal(){
    const maps = mapList();

    if(maps.length){
      for(const m of maps){
        const x=N(m.x), y=N(m.y), w=N(m.w,mapWidth||1000), h=N(m.h,mapHeight||700);
        const img=getMapImage(m);
        if(img && img.complete !== false){
          ctx.drawImage(img, (x*scale)+offsetX, (y*scale)+offsetY, w*scale, h*scale);
        }else{
          ctx.fillStyle='rgba(60,60,70,.7)';
          ctx.fillRect((x*scale)+offsetX, (y*scale)+offsetY, w*scale, h*scale);
        }
        if(isMaster()){
          ctx.strokeStyle='rgba(201,124,61,.75)';
          ctx.lineWidth=2;
          ctx.strokeRect((x*scale)+offsetX, (y*scale)+offsetY, w*scale, h*scale);
        }
      }
      return;
    }

    if(mapImg && mapImg.complete){
      ctx.drawImage(mapImg, offsetX, offsetY, mapWidth * scale, mapHeight * scale);
    }
  }

  function drawFogFinal(){
    if(isMaster()) return; // mestre nunca é coberto pela névoa
    if(!fogEnabled || globalLight) return;

    ctx.save();

    // preto sólido para cobrir tudo
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // fura 100% a névoa
    ctx.globalCompositeOperation = 'destination-out';

    const sources = (Array.isArray(players) ? players : []).filter(p=>{
      if(!p || p.isNpc) return false;
      if(isMaster()) return getLightRadius(p) > 0;
      return p.ownerId === me?.pid || p.id === me?.pid;
    });

    // fallback: se jogador não achou próprio token, usa qualquer player sem NPC
    if(!isMaster() && !sources.length){
      const any = (Array.isArray(players) ? players : []).find(p=>p && !p.isNpc);
      if(any) sources.push(any);
    }

    sources.forEach(p=>{
      const r = getLightRadius(p) * scale;
      if(r <= 0) return;
      const lx = (N(p.x) * scale) + offsetX;
      const ly = (N(p.y) * scale) + offsetY;

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function drawWallsDoorsMaster(){
    if(!isMaster()) return;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;

    (Array.isArray(walls)?walls:[]).forEach(w=>{
      if(!w||!w[0]||!w[1]) return;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]), N(w[0][1]));
      ctx.lineTo(N(w[1][0]), N(w[1][1]));
      ctx.stroke();
    });

    (Array.isArray(doors)?doors:[]).forEach(d=>{
      const w=d&&d.wall;
      if(!w||!w[0]||!w[1]) return;
      ctx.strokeStyle = d.open ? '#22cc66' : '#ff3333';
      ctx.lineWidth = 7/scale;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]), N(w[0][1]));
      ctx.lineTo(N(w[1][0]), N(w[1][1]));
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawLightLinesMaster(){
    if(!isMaster()) return;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    (Array.isArray(players)?players:[]).forEach(p=>{
      if(!p || p.isNpc) return;
      const r=getLightRadius(p);
      if(r<=0) return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.lineWidth=2/scale;
      ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.arc(N(p.x), N(p.y), r, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.restore();
  }

  // DRAW FINAL COM ORDEM CORRETA:
  // 1 mapa, 2 névoa furada, 3 tokens por cima
  window.draw = function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1º MAPA
    drawMapFinal();

    // mestre vê paredes/portas e linhas da luz
    drawWallsDoorsMaster();
    drawLightLinesMaster();

    // 2º NÉVOA PRETA + BURACOS DE LUZ
    drawFogFinal();

    // 3º TOKENS POR CIMA
    (Array.isArray(players)?players:[]).forEach(p => window.drawToken(p));
  };

  // Garante luz mínima nos jogadores se não tiver configurada
  (Array.isArray(players)?players:[]).forEach(p=>{
    if(p && !p.isNpc && !N(p.lightRadius,0) && !N(p.light,0)) p.lightRadius = 180;
  });

  setTimeout(()=>requestDraw&&requestDraw(),300);
  console.log('PATCH DEFINITIVO REAL aplicado: névoa sólida e token sem clip');
})();


// ===== FIX NEVOA MESTRE: mestre nao recebe overlay preto =====
(function(){
  if(window.__FIX_NEVOA_MESTRE__) return;
  window.__FIX_NEVOA_MESTRE__ = true;

  const prevDraw = window.draw;
  window.draw = function(){
    // se for mestre, força fogEnabled temporariamente falso só durante o render
    if(me && me.isMaster){
      const oldFog = fogEnabled;
      fogEnabled = false;
      try { prevDraw && prevDraw(); }
      finally { fogEnabled = oldFog; }
      return;
    }
    return prevDraw && prevDraw();
  };

  console.log('Fix névoa mestre aplicado: mestre vê tudo.');
})();


// ===== FIX FINAL REAL: MESTRE SEM NEVOA + NPC SO NA LUZ + MAPA NA LUZ + IMAGENS TODOS TOKENS =====
(function(){
  if(window.__TAVERNA_FIX_FOG_NPC_IMAGES_FINAL__) return;
  window.__TAVERNA_FIX_FOG_NPC_IMAGES_FINAL__ = true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function A(v){return Array.isArray(v)?v:[];}
  function master(){try{return !!(me&&me.isMaster)}catch(e){return false}}
  function playersList(){try{return A(players)}catch(e){return []}}
  function mapsList(){
    try{if(Array.isArray(campaignMaps)&&campaignMaps.length)return campaignMaps}catch(e){}
    if(mapImg&&mapWidth&&mapHeight)return [{id:'main',x:0,y:0,w:mapWidth,h:mapHeight,src:mapData,name:'Mapa Principal'}];
    return [];
  }

  const tokenCacheFinal = {};
  const mapCacheFinal = {};

  function getTokenImgFinal(p){
    if(!p || !p.img) return null;

    // usa cache global original se já tiver
    try{
      if(tokenImages && tokenImages[p.id] && tokenImages[p.id].complete && tokenImages[p.id].naturalWidth>0){
        return tokenImages[p.id];
      }
    }catch(e){}

    if(tokenCacheFinal[p.id] && tokenCacheFinal[p.id].__src===p.img) return tokenCacheFinal[p.id];

    const img=new Image();
    img.__src=p.img;
    img.onload=()=>{
      tokenCacheFinal[p.id]=img;
      try{ tokenImages[p.id]=img; }catch(e){}
      requestDraw&&requestDraw();
    };
    img.onerror=()=>{
      tokenCacheFinal[p.id]=null;
      requestDraw&&requestDraw();
    };
    img.src=p.img;
    tokenCacheFinal[p.id]=img;
    return img;
  }

  function getMapImgFinal(m){
    if(!m||!m.src)return null;
    if(m.id==='main' && mapImg)return mapImg;
    if(mapCacheFinal[m.id]&&mapCacheFinal[m.id].__src===m.src)return mapCacheFinal[m.id];
    const img=new Image();
    img.__src=m.src;
    img.onload=()=>requestDraw&&requestDraw();
    img.src=m.src;
    mapCacheFinal[m.id]=img;
    return img;
  }

  function lightRadiusFinal(p){
    const lr=N(p&&p.lightRadius,0);
    if(lr>0)return lr;
    const l=N(p&&p.light,0);
    if(l>0)return Math.max(80,l*12);
    if(p&&!p.isNpc)return 180;
    return 0;
  }

  function ownTokenFinal(){
    if(!me)return null;
    return playersList().find(p=>!p.isNpc&&p.ownerId===me.pid) ||
           playersList().find(p=>!p.isNpc&&p.id===me.pid) ||
           playersList().find(p=>!p.isNpc) ||
           null;
  }

  function fogOnFinal(){
    return !!fogEnabled && !globalLight;
  }

  function visibleForThisClient(p){
    if(master()) return true;           // mestre vê todos
    if(!fogOnFinal()) return true;      // névoa desligada: todos visíveis
    const own=ownTokenFinal();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===me?.pid || p.id===me?.pid)) return true;
    return Math.hypot(N(p.x)-N(own.x),N(p.y)-N(own.y)) <= lightRadiusFinal(own);
  }

  function drawMapFinal(){
    const ms=mapsList();
    if(ms.length){
      for(const m of ms){
        const x=N(m.x),y=N(m.y),w=N(m.w,mapWidth||1000),h=N(m.h,mapHeight||700);
        const img=getMapImgFinal(m);
        if(img && img.complete !== false) ctx.drawImage(img,(x*scale)+offsetX,(y*scale)+offsetY,w*scale,h*scale);
        else{ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect((x*scale)+offsetX,(y*scale)+offsetY,w*scale,h*scale);}
        if(master()){
          ctx.strokeStyle='rgba(201,124,61,.7)';
          ctx.lineWidth=2;
          ctx.strokeRect((x*scale)+offsetX,(y*scale)+offsetY,w*scale,h*scale);
        }
      }
    }else if(mapImg&&mapImg.complete){
      ctx.drawImage(mapImg,offsetX,offsetY,mapWidth*scale,mapHeight*scale);
    }
  }

  // Token final: sem clip, sem círculo cortando, carrega imagem para mestre também.
  window.drawToken = function(p){
    if(!p || !visibleForThisClient(p)) return;

    const img=getTokenImgFinal(p);
    const x=(N(p.x)*scale)+offsetX;
    const y=(N(p.y)*scale)+offsetY;

    ctx.save();
    ctx.translate(x,y);

    if(img && img.complete && img.naturalWidth>0){
      if(p.tokenStyle==='standee'){
        const h=N(p.spriteH,65)*scale;
        const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
      }else{
        // topdown também sem cortar: contain em caixa pequena, sem clip
        const size=N(p.spriteW,32)*scale;
        const s=Math.min(size/img.naturalWidth,size/img.naturalHeight);
        const w=img.naturalWidth*s;
        const h=img.naturalHeight*s;
        ctx.drawImage(img,-w/2,-h/2,w,h);
      }
    }else{
      const r=16*scale;
      ctx.beginPath();
      ctx.arc(0,0,r,0,Math.PI*2);
      ctx.fillStyle=p.color || (p.isNpc?'#a33':'#c97c3d');
      ctx.fill();
    }

    ctx.restore();
  };

  function drawWallsDoorsMaster(){
    if(!master()) return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    (Array.isArray(walls)?walls:[]).forEach(w=>{
      if(!w||!w[0]||!w[1])return;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]),N(w[0][1]));
      ctx.lineTo(N(w[1][0]),N(w[1][1]));
      ctx.stroke();
    });
    (Array.isArray(doors)?doors:[]).forEach(d=>{
      const w=d&&d.wall;if(!w||!w[0]||!w[1])return;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();
      ctx.moveTo(N(w[0][0]),N(w[0][1]));
      ctx.lineTo(N(w[1][0]),N(w[1][1]));
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawLightLinesMaster(){
    if(!master()) return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    playersList().forEach(p=>{
      if(!p||p.isNpc)return;
      const r=lightRadiusFinal(p);
      if(!r)return;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.lineWidth=2/scale;
      ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();
      ctx.arc(N(p.x),N(p.y),r,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  function drawFogForPlayerOnly(){
    // ERRO corrigido: mestre nunca recebe overlay preto.
    if(master()) return;
    if(!fogOnFinal()) return;

    const own=ownTokenFinal();
    if(!own) return;
    const r=lightRadiusFinal(own)*scale;
    if(r<=0)return;

    const lx=(N(own.x)*scale)+offsetX;
    const ly=(N(own.y)*scale)+offsetY;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';

    // preto sólido, cobre tudo
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // fura a névoa 100%, deixando o mapa desenhado abaixo aparecer
    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(lx,ly,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  window.draw = function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // 1 mapa sempre primeiro
    drawMapFinal();

    // mestre vê paredes, portas e círculos de luz
    drawWallsDoorsMaster();
    drawLightLinesMaster();

    // 2 névoa só jogador, furada pela luz
    drawFogForPlayerOnly();

    // 3 tokens por cima, filtrados por luz no jogador
    playersList().forEach(p=>window.drawToken(p));
  };

  // Pré-carrega imagens de todos os tokens para mestre e jogador
  playersList().forEach(p=>getTokenImgFinal(p));

  try{
    socket.on('state',s=>{
      setTimeout(()=>{
        playersList().forEach(p=>getTokenImgFinal(p));
        requestDraw&&requestDraw();
      },50);
    });
    socket.on('playerUpdated',p=>{
      if(p) getTokenImgFinal(p);
      requestDraw&&requestDraw();
    });
    socket.on('playerAdded',p=>{
      if(p) getTokenImgFinal(p);
      requestDraw&&requestDraw();
    });
    socket.on('npcAdded',p=>{
      if(p) getTokenImgFinal(p);
      requestDraw&&requestDraw();
    });
  }catch(e){}

  setTimeout(()=>requestDraw&&requestDraw(),300);
  console.log('FIX FINAL REAL fog/npc/images aplicado');
})();


// ===== DRAW LOOP FINAL ESTAVEL: MAPA -> NEVOA -> TOKENS =====
(function(){
  if(window.__TAVERNA_DRAW_LOOP_FINAL_ESTAVEL__) return;
  window.__TAVERNA_DRAW_LOOP_FINAL_ESTAVEL__ = true;

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function A(v){return Array.isArray(v)?v:[];}
  function isMaster(){return !!(window.me && window.me.isMaster);}
  function playersList(){return A(window.players);}

  function tokenLightRadius(p){
    const lr=N(p&&p.lightRadius,0);
    if(lr>0) return lr;
    const l=N(p&&p.light,0);
    if(l>0) return Math.max(80,l*12);
    if(p&&!p.isNpc) return 180;
    return 0;
  }

  function ownToken(){
    if(!window.me) return null;
    return playersList().find(p=>!p.isNpc && p.ownerId===window.me.pid) ||
           playersList().find(p=>!p.isNpc && p.id===window.me.pid) ||
           playersList().find(p=>!p.isNpc) ||
           null;
  }

  function isInOwnLight(p){
    if(isMaster()) return true;
    if(!window.fogEnabled) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===window.me?.pid || p.id===window.me?.pid)) return true;
    const dx=N(p.x)-N(own.x), dy=N(p.y)-N(own.y);
    return Math.sqrt(dx*dx+dy*dy) <= tokenLightRadius(own);
  }

  window.drawToken=function(p){
    if(!p || !isInOwnLight(p)) return;
    const img=window.tokenImages && window.tokenImages[p.id] ? window.tokenImages[p.id] : null;
    const x=(N(p.x)*scale)+offsetX;
    const y=(N(p.y)*scale)+offsetY;

    ctx.save();
    if(img && img.complete && img.naturalWidth){
      if(p.tokenStyle==='standee'){
        const h=N(p.spriteH,65)*scale;
        const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
        ctx.translate(x,y);
        ctx.scale(p.facing===-1?-1:1,1);
        ctx.drawImage(img,-w/2,-h,w,h);
      }else{
        const h=N(p.spriteW,32)*scale;
        const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));
        ctx.drawImage(img,x-w/2,y-h/2,w,h);
      }
    }else{
      ctx.beginPath();
      ctx.arc(x,y,14*scale,0,Math.PI*2);
      ctx.fillStyle=p.color || (p.isNpc?'#a33':'#c97c3d');
      ctx.fill();
    }
    ctx.restore();
  };

  function drawMapLayer(){
    if(window.mapImg && window.mapImg.complete && window.mapWidth && window.mapHeight){
      ctx.drawImage(window.mapImg,offsetX,offsetY,window.mapWidth*scale,window.mapHeight*scale);
    }

    if(Array.isArray(window.campaignMaps)){
      if(!window.__mapImgCacheFinal) window.__mapImgCacheFinal={};
      window.campaignMaps.forEach(m=>{
        if(!m || !m.src) return;
        let img=window.__mapImgCacheFinal[m.id];
        if(!img || img.__src!==m.src){
          img=new Image();
          img.__src=m.src;
          img.onload=()=>requestDraw&&requestDraw();
          img.src=m.src;
          window.__mapImgCacheFinal[m.id]=img;
        }
        const x=N(m.x),y=N(m.y),w=N(m.w,1000),h=N(m.h,700);
        if(img.complete && img.naturalWidth){
          ctx.drawImage(img,(x*scale)+offsetX,(y*scale)+offsetY,w*scale,h*scale);
        }
        if(isMaster()){
          ctx.strokeStyle='rgba(201,124,61,.7)';
          ctx.lineWidth=2;
          ctx.strokeRect((x*scale)+offsetX,(y*scale)+offsetY,w*scale,h*scale);
        }
      });
    }
  }

  function drawFogLayer(){
    if(isMaster()) return;
    if(!window.fogEnabled || window.globalLight) return;
    const own=ownToken();
    if(!own) return;

    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    const lx=(N(own.x)*scale)+offsetX;
    const ly=(N(own.y)*scale)+offsetY;
    const r=tokenLightRadius(own)*scale;

    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(lx,ly,r,0,Math.PI*2);
    ctx.fill();

    ctx.globalCompositeOperation='source-over';
    ctx.restore();
  }

  function drawMasterLightLines(){
    if(!isMaster()) return;
    ctx.save();
    playersList().forEach(p=>{
      if(!p || p.isNpc) return;
      const r=tokenLightRadius(p);
      if(r<=0) return;
      const x=(N(p.x)*scale)+offsetX;
      const y=(N(p.y)*scale)+offsetY;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.lineWidth=2;
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(x,y,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    drawMapLayer();
    drawMasterLightLines();
    drawFogLayer();
    playersList().forEach(p=>window.drawToken(p));
  };

  setTimeout(()=>requestDraw&&requestDraw(),300);
  console.log('Draw loop final estável aplicado.');
})();


// ===== RENDER UNICO AGRESSIVO FINAL =====
(function(){
  if(window.__TAVERNA_RENDER_UNICO_AGRESSIVO_FINAL__) return;
  window.__TAVERNA_RENDER_UNICO_AGRESSIVO_FINAL__ = true;

  // Mata loops antigos de requestAnimationFrame que possam estar redesenhando por cima.
  try{
    for(let i=0;i<10000;i++) cancelAnimationFrame(i);
  }catch(e){}

  function N(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function A(v){return Array.isArray(v)?v:[];}
  function isMaster(){return !!(window.me && window.me.isMaster);}
  function playersList(){return A(window.players);}

  function lightRadius(p){
    const lr=N(p&&p.lightRadius,0);
    if(lr>0) return lr;
    const l=N(p&&p.light,0);
    if(l>0) return Math.max(80,l*12);
    if(p && !p.isNpc) return 200;
    return 0;
  }

  function ownToken(){
    if(!window.me) return null;
    return playersList().find(p=>!p.isNpc && p.ownerId===window.me.pid) ||
           playersList().find(p=>!p.isNpc && p.id===window.me.pid) ||
           playersList().find(p=>!p.isNpc) ||
           null;
  }

  function tokenVisible(p){
    if(isMaster()) return true;
    if(!window.fogEnabled) return true;
    const own=ownToken();
    if(!own) return true;
    if(!p.isNpc && (p.ownerId===window.me?.pid || p.id===window.me?.pid)) return true;
    const dx=N(p.x)-N(own.x), dy=N(p.y)-N(own.y);
    return Math.sqrt(dx*dx+dy*dy) <= lightRadius(own);
  }

  function drawMaps(){
    // mapa principal
    if(window.mapImg && window.mapImg.naturalWidth > 0){
      ctx.drawImage(window.mapImg, offsetX, offsetY, window.mapWidth * scale, window.mapHeight * scale);
    }

    // mapas extras
    if(Array.isArray(window.campaignMaps)){
      if(!window.__renderMapCache) window.__renderMapCache={};
      window.campaignMaps.forEach(m=>{
        if(!m || !m.src) return;
        let img=window.__renderMapCache[m.id];
        if(!img || img.__src!==m.src){
          img=new Image();
          img.__src=m.src;
          img.onload=()=>requestDraw&&requestDraw();
          img.src=m.src;
          window.__renderMapCache[m.id]=img;
        }
        if(img.naturalWidth>0){
          ctx.drawImage(img,(N(m.x)*scale)+offsetX,(N(m.y)*scale)+offsetY,N(m.w,1000)*scale,N(m.h,700)*scale);
        }
        if(isMaster()){
          ctx.strokeStyle='rgba(201,124,61,.75)';
          ctx.lineWidth=2;
          ctx.strokeRect((N(m.x)*scale)+offsetX,(N(m.y)*scale)+offsetY,N(m.w,1000)*scale,N(m.h,700)*scale);
        }
      });
    }
  }

  function drawFog(){
    // névoa só para jogador. Mestre vê tudo.
    if(isMaster()) return;
    if(!window.fogEnabled || window.globalLight) return;

    ctx.fillStyle='#000000';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalCompositeOperation='destination-out';
    ctx.fillStyle='#000000';

    const own=ownToken();
    const sources=own ? [own] : playersList().filter(p=>p && !p.isNpc);

    sources.forEach(p=>{
      const r=lightRadius(p);
      if(r<=0) return;
      ctx.beginPath();
      ctx.arc(
        (N(p.x)*scale)+offsetX,
        (N(p.y)*scale)+offsetY,
        r*scale,
        0,
        Math.PI*2
      );
      ctx.fill();
    });

    ctx.globalCompositeOperation='source-over';
  }

  // token final sem save/arc/clip para imagem.
  window.drawToken=function(p){
    if(!p || !tokenVisible(p)) return;
    const img=window.tokenImages && window.tokenImages[p.id] ? window.tokenImages[p.id] : null;
    if(!img || !img.naturalWidth) return;

    const x=(N(p.x)*scale)+offsetX;
    const y=(N(p.y)*scale)+offsetY;

    let h;
    if(p.tokenStyle==='topdown'){
      h=N(p.spriteW,32)*scale;
    }else{
      h=N(p.spriteH,65)*scale;
    }

    const w=h*(img.naturalWidth/Math.max(1,img.naturalHeight));

    // SEM save, SEM arc, SEM clip.
    if(p.tokenStyle==='topdown'){
      ctx.drawImage(img, x-w/2, y-h/2, w, h);
    }else{
      // miniatura em pé ancorada no pé
      ctx.drawImage(img, x-w/2, y-h, w, h);
    }
  };

  function drawLightLinesForMaster(){
    if(!isMaster()) return;
    playersList().forEach(p=>{
      if(!p || p.isNpc) return;
      const r=lightRadius(p);
      if(r<=0) return;
      const x=(N(p.x)*scale)+offsetX;
      const y=(N(p.y)*scale)+offsetY;
      ctx.strokeStyle='rgba(80,180,255,.85)';
      ctx.lineWidth=2;
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.arc(x,y,r*scale,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // função final de render.
  function render(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // 1. MAPA
    drawMaps();

    // mestre vê linha de luz sem nevoa
    drawLightLinesForMaster();

    // 2. NÉVOA + FURAÇÃO - SÓ PLAYER
    drawFog();

    // 3. TOKENS SEM CLIP
    playersList().forEach(p=>window.drawToken(p));

    window.__tavernaRenderLoopId=requestAnimationFrame(render);
  }

  window.draw=render;
  window.drawLoop=render;

  try{ cancelAnimationFrame(window.__tavernaRenderLoopId); }catch(e){}
  window.__tavernaRenderLoopId=requestAnimationFrame(render);

  console.log('Render único agressivo aplicado.');
})();
