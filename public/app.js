

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
    if(!blockedMoveLocal(dragging,x,y)){const __m=(typeof mapAtWorld==='function'?mapAtWorld(x,y):null);if(__m)dragging.mapId=__m.id;if(dragging.isNpc&&dragging.showPath){dragging.path=Array.isArray(dragging.path)?dragging.path:[];dragging.pathMapId=dragging.mapId||(__m&&__m.id)||null;dragging.path.push([Math.round(dragging.x),Math.round(dragging.y)]);if(dragging.path.length>120)dragging.path=dragging.path.slice(-120);}else{dragging.path=[];}smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
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
    if(!blockedMoveLocal(dragging,x,y)){const __m=(typeof mapAtWorld==='function'?mapAtWorld(x,y):null);if(__m)dragging.mapId=__m.id;if(dragging.isNpc&&dragging.showPath){dragging.path=Array.isArray(dragging.path)?dragging.path:[];dragging.pathMapId=dragging.mapId||(__m&&__m.id)||null;dragging.path.push([Math.round(dragging.x),Math.round(dragging.y)]);if(dragging.path.length>120)dragging.path=dragging.path.slice(-120);}else{dragging.path=[];}smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
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
  r.onload=ev=>{try{const side=(document.getElementById('mapSide')?.value||'right');socket.emit('importFullState',{room:me.room,state:JSON.parse(ev.target.result),merge:true,side,refMapId:activeMapId});}catch(err){alert('Erro ao importar: '+err.message);} e.target.value='';};
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

if(typeof draw==='function'&&!window.__pathDrawWrapped){
  const __oldDraw=draw;
  window.__pathDrawWrapped=true;
  draw=function(){__oldDraw();drawTokenPaths();};
}


// ===== PATCH FINAL: MAPAS GALERIA/SALVOS + TOKENS JOGADOR/NPC =====
(function(){
  const mapCache = window.__tavernaMapCacheFinal || {};
  window.__tavernaMapCacheFinal = mapCache;

  function normMap(m,i=0){
    if(!m)return null;
    const src=String(m.src||m.mapData||m.data||m.url||'');
    if(!src)return null;
    return {
      ...m,
      id:String(m.id||('map_'+i)),
      name:String(m.name||('Mapa '+(i+1))),
      src,
      x:Number(m.x||0)||0,
      y:Number(m.y||0)||0,
      w:Number(m.w||m.mapW||m.width||1000)||1000,
      h:Number(m.h||m.mapH||m.height||700)||700
    };
  }

  window.setCampaignMapsFixed=function(list,active,spawn){
    const arr=(Array.isArray(list)?list:[]).map(normMap).filter(Boolean);
    campaignMaps=arr;
    window.campaignMaps=arr;
    activeMapId=active||activeMapId||arr[0]?.id||null;
    spawnMapId=spawn||spawnMapId||activeMapId;
    window.activeMapId=activeMapId;
    window.spawnMapId=spawnMapId;
    for(const m of arr){
      const old=mapCache[m.id];
      if(old&&old.__src===m.src)continue;
      const img=new Image();
      img.__src=m.src;
      img.onload=()=>requestDraw();
      img.onerror=()=>{console.warn('Falha ao carregar mapa:',m.name);requestDraw();};
      img.src=m.src;
      mapCache[m.id]=img;
    }
    renderMapListFixed();
    requestDraw();
  };

  window.renderMapListFixed=function(){
    const box=document.getElementById('mapList');
    if(!box)return;
    const arr=Array.isArray(campaignMaps)?campaignMaps:[];
    if(!arr.length){box.innerHTML='<div style="opacity:.7;font-size:12px">Nenhum mapa salvo.</div>';return;}
    box.innerHTML=arr.map(m=>`
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px">
        <b>${m.id===activeMapId?'✅ ':''}${m.id===spawnMapId?'🧍 ':''}${m.name||'Mapa'}</b>
        <br><small>x:${Math.round(m.x||0)} y:${Math.round(m.y||0)}</small>
        <div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
          <button onclick="focusMapFixed('${m.id}')">Ver</button>
          <button onclick="setSpawnMap('${m.id}')">Spawn</button>
          <button onclick="sendAllTokensFromActiveToMap?.('${m.id}')">Enviar Todos</button>
          <button onclick="deleteMap?.('${m.id}')" class="danger">Del</button>
        </div>
      </div>`).join('');
  };

  window.focusMapFixed=function(id){
    const m=(campaignMaps||[]).find(x=>x.id===id);
    if(!m)return;
    activeMapId=id;
    offsetX=canvas.width/2-(Number(m.x||0)+Number(m.w||1000)/2)*scale;
    offsetY=canvas.height/2-(Number(m.y||0)+Number(m.h||700)/2)*scale;
    camTargetX=offsetX;camTargetY=offsetY;
    if(me?.isMaster)socket.emit('setActiveMap',{room:me.room,id});
    requestDraw();
  };

  window.drawTavernaFinal=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);

    // Grid
    const grid=50;
    const left=(-offsetX/scale)-100, top=(-offsetY/scale)-100;
    const right=left+canvas.width/scale+200, bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}

    // Mapas
    const arr=Array.isArray(campaignMaps)?campaignMaps:[];
    if(arr.length){
      for(const raw of arr){
        const m=normMap(raw);
        const img=mapCache[m.id];
        if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,m.x,m.y,m.w,m.h);
        else{
          ctx.fillStyle='rgba(70,70,80,.45)';
          ctx.fillRect(m.x,m.y,m.w,m.h);
          ctx.fillStyle='white';
          ctx.font=`${18/scale}px Arial`;
          ctx.fillText('Carregando mapa...',m.x+20,m.y+50);
        }
        ctx.strokeStyle=m.id===activeMapId?'rgba(255,210,80,.95)':'rgba(255,255,255,.25)';
        ctx.lineWidth=(m.id===activeMapId?4:2)/scale;
        ctx.strokeRect(m.x,m.y,m.w,m.h);
        ctx.fillStyle='rgba(0,0,0,.7)';
        ctx.fillRect(m.x+8,m.y+8,Math.max(160,(m.name||'Mapa').length*8),30);
        ctx.fillStyle='white';
        ctx.font=`${14/scale}px Arial`;
        ctx.fillText((m.id===spawnMapId?'🧍 ':'')+(m.name||'Mapa'),m.x+14,m.y+28);
      }
    }else if(mapImg){
      try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}catch(e){}
    }

    // Paredes
    ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    for(const w of (walls||[])){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();}

    // Portas
    ctx.lineWidth=6/scale;
    for(const d of (doors||[])){if(!d||!d.wall||!d.wall[0]||!d.wall[1])continue;ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';ctx.beginPath();ctx.moveTo(d.wall[0][0],d.wall[0][1]);ctx.lineTo(d.wall[1][0],d.wall[1][1]);ctx.stroke();}

    // Tokens jogador/NPC
    for(const p of (players||[])){
      if(!p)continue;
      const r=(typeof tokenRadius==='function'?tokenRadius(p):16);
      const img=p.img?tokenImages[p.id]:null;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.clip();
      if(img&&img.complete)ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
      else{ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';ctx.fillRect(p.x-r,p.y-r,r*2,r*2);}
      ctx.restore();
      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.lineWidth=selectedId===p.id?3/scale:1.5/scale;
      ctx.strokeStyle=selectedId===p.id?'#ffd24d':'#111';
      ctx.stroke();
      ctx.fillStyle='white';
      ctx.font=`${12/scale}px Arial`;
      ctx.fillText(p.name||'Token',p.x-r,p.y-r-6);
    }

    // Régua
    if(window.sharedRuler&&window.sharedRuler.a&&window.sharedRuler.b){
      const a=window.sharedRuler.a,b=window.sharedRuler.b;
      ctx.strokeStyle='#ff5555';ctx.lineWidth=2/scale;
      ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
      ctx.fillStyle='white';ctx.font=`${14/scale}px Arial`;
      ctx.fillText(Math.round(Math.hypot(b[0]-a[0],b[1]-a[1]))+' px',b[0]+8,b[1]+8);
    }
    ctx.restore();
  };

  draw=drawTavernaFinal;

  socket.on('mapsUpdated',d=>setCampaignMapsFixed(d.maps||[],d.activeMapId,d.spawnMapId));
  socket.on('state',s=>{
    if(!s)return;
    if(Array.isArray(s.maps)&&s.maps.length)setCampaignMapsFixed(s.maps,s.activeMapId,s.spawnMapId);
    else if(s.mapData)setCampaignMapsFixed([{id:s.activeMapId||'map_principal',name:'Mapa Principal',src:s.mapData,w:s.mapW||1000,h:s.mapH||700,x:0,y:0}],s.activeMapId||'map_principal',s.spawnMapId||s.activeMapId||'map_principal');
  });

  window.loadMap=function(){
    if(!me?.isMaster)return;
    const url=(document.getElementById('mapUrl')?.value||'').trim();
    const file=document.getElementById('mapFile')?.files?.[0];
    const send=(src,w=1000,h=700)=>socket.emit('setMap',{room:me.room,mapData:src,mapW:w,mapH:h,name:'Mapa Principal'});
    if(file){
      const r=new FileReader();
      r.onload=e=>{const data=e.target.result;const img=new Image();img.onload=()=>send(data,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(data,1000,700);img.src=data;};
      r.readAsDataURL(file);return;
    }
    if(url){const img=new Image();img.crossOrigin='anonymous';img.onload=()=>send(url,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(url,1000,700);img.src=url;return;}
    alert('Escolha imagem da galeria ou URL.');
  };

  window.addMapFromMaster=function(){
    if(!me?.isMaster)return;
    const name=(document.getElementById('newMapName')?.value||('Mapa '+((campaignMaps||[]).length+1))).trim();
    const url=(document.getElementById('newMapUrl')?.value||'').trim();
    const file=document.getElementById('newMapFile')?.files?.[0];
    const side=(document.getElementById('mapSide')?.value||'right');
    const send=(src,w=1000,h=700)=>socket.emit('addMap',{room:me.room,map:{name,src,w,h},side,refMapId:activeMapId});
    if(file){
      const r=new FileReader();
      r.onload=e=>{const data=e.target.result;const img=new Image();img.onload=()=>send(data,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(data,1000,700);img.src=data;};
      r.readAsDataURL(file);return;
    }
    if(url){const img=new Image();img.crossOrigin='anonymous';img.onload=()=>send(url,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(url,1000,700);img.src=url;return;}
    alert('Escolha imagem da galeria ou URL.');
  };

  window.exportFullMap=function(){
    const state={players,walls,doors,maps:campaignMaps||[],activeMapId,spawnMapId,mapData,mapW:mapWidth,mapH:mapHeight,fog:fogEnabled,globalLight};
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='taverna-cena.json';a.click();URL.revokeObjectURL(a.href);
  };

  window.importFullMapClick=function(){document.getElementById('saveMapFile')?.click();};
  const imp=document.getElementById('saveMapFile');
  if(imp&&!imp.__tavernaImportFixed){
    imp.__tavernaImportFixed=true;
    imp.addEventListener('change',e=>{
      const file=e.target.files?.[0];if(!file)return;
      const r=new FileReader();
      r.onload=ev=>{try{const side=(document.getElementById('mapSide')?.value||'right');socket.emit('importFullState',{room:me.room,state:JSON.parse(ev.target.result),merge:true,side,refMapId:activeMapId});}catch(err){alert('Arquivo inválido.');}};
      r.readAsText(file);
    });
  }
})();


// ===== PATCH DEFINITIVO: MOVIMENTO/TOKENS/MAPAS =====
// Mantém o layout original e corrige: travamento de token, trocar mapa ao mover,
// deletar mapa, enviar token/todos tokens para outro mapa e escolher lado do importador.
(function(){
  if(window.__tavernaFinalMoveMapPatch)return;
  window.__tavernaFinalMoveMapPatch=true;

  function arrMaps(){ return Array.isArray(window.campaignMaps) ? window.campaignMaps : (Array.isArray(campaignMaps) ? campaignMaps : []); }
  function getActiveId(){ return window.activeMapId || (typeof activeMapId!=='undefined' ? activeMapId : null); }
  function setActiveId(id){ window.activeMapId=id; try{ activeMapId=id; }catch(e){} }
  function getSpawnId(){ return window.spawnMapId || (typeof spawnMapId!=='undefined' ? spawnMapId : null); }
  function setSpawnId(id){ window.spawnMapId=id; try{ spawnMapId=id; }catch(e){} }
  function getMap(id){ return arrMaps().find(m=>m && m.id===id) || null; }
  function mapAt(x,y){
    const maps=arrMaps();
    for(let i=maps.length-1;i>=0;i--){
      const m=maps[i]; if(!m)continue;
      const mx=Number(m.x||0), my=Number(m.y||0), mw=Number(m.w||1000), mh=Number(m.h||700);
      if(x>=mx && y>=my && x<=mx+mw && y<=my+mh)return m;
    }
    return null;
  }
  function mapForToken(p){ return getMap(p?.mapId) || getMap(getActiveId()) || arrMaps()[0] || null; }
  function clampToOwnMap(p){
    if(!p)return;
    const m=mapForToken(p);
    if(!m)return;
    const margin=Math.max(18, typeof tokenRadius==='function'?tokenRadius(p):20);
    const minX=Number(m.x||0)+margin, minY=Number(m.y||0)+margin;
    const maxX=Number(m.x||0)+Number(m.w||1000)-margin, maxY=Number(m.y||0)+Number(m.h||700)-margin;
    p.x=Math.max(minX,Math.min(maxX,Number(p.x)||minX));
    p.y=Math.max(minY,Math.min(maxY,Number(p.y)||minY));
  }
  function sameMap(a,b){ return (a?.mapId||null)===(b?.mapId||null); }

  window.clampTokenToMap = clampToOwnMap;
  try{ clampTokenToMap = clampToOwnMap; }catch(e){}

  window.smoothTokenMove=function(p,targetX,targetY){
    if(!p)return;
    const targetMap=mapAt(targetX,targetY);
    if(targetMap){ p.mapId=targetMap.id; setActiveId(targetMap.id); }
    const maxSpeed=99999; // sem atraso que causava sensação de travar
    let dx=targetX-p.x, dy=targetY-p.y;
    const dist=Math.hypot(dx,dy);
    if(dist>maxSpeed){ dx=(dx/dist)*maxSpeed; dy=(dy/dist)*maxSpeed; }
    const nx=p.x+dx, ny=p.y+dy;
    if(!blockedMoveLocal(p,nx,ny)){
      p.x=nx; p.y=ny;
      const m=mapAt(p.x,p.y); if(m)p.mapId=m.id;
      clampToOwnMap(p);
    }
  };
  try{ smoothTokenMove=window.smoothTokenMove; }catch(e){}

  window.blockedMoveLocal=function(p,nx,ny){
    if(!p)return true;
    const targetMap=mapAt(nx,ny);
    if(targetMap)p.mapId=targetMap.id;
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    for(const w of (walls||[])){
      if(!w||!w[0]||!w[1])continue;
      if(typeof lineIntersect==='function' && lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
      if(typeof blockedBySegmentLocal==='function' && blockedBySegmentLocal(nx,ny,w,r))return true;
    }
    for(const door of (doors||[])){
      if(typeof doorBlocksMoveLocal==='function' && !doorBlocksMoveLocal(door))continue;
      const w=door?.wall; if(!w||!w[0]||!w[1])continue;
      if(typeof lineIntersect==='function' && lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
      if(typeof blockedBySegmentLocal==='function' && blockedBySegmentLocal(nx,ny,w,r))return true;
    }
    // colisão só bloqueia tokens no mesmo mapa
    return (players||[]).some(o=>{
      if(!o||o.id===p.id)return false;
      if(!sameMap(o,p))return false;
      return Math.hypot((o.x||0)-nx,(o.y||0)-ny)<(r+(typeof tokenRadius==='function'?tokenRadius(o):16))*0.92;
    });
  };
  try{ blockedMoveLocal=window.blockedMoveLocal; }catch(e){}

  function ensureMapSideSelector(){
    const sel=document.getElementById('mapSide');
    if(!sel)return;
    sel.innerHTML='<option value="right">Direita do mapa ativo</option><option value="left">Esquerda do mapa ativo</option><option value="down">Baixo do mapa ativo</option><option value="up">Cima do mapa ativo</option>';
  }
  ensureMapSideSelector();

  window.deleteMap=function(id){
    if(!me?.isMaster)return alert('Só o Mestre pode deletar mapa.');
    if(!id)return;
    if(!confirm('Deletar este mapa? Os tokens dele serão enviados para outro mapa disponível.'))return;
    socket.emit('deleteMap',{room:me.room,id});
  };

  window.sendSelectedTokenToMap=function(id){
    if(!me?.isMaster)return;
    const tokenId=selectedId || (editingPlayer&&editingPlayer.id);
    if(!tokenId)return alert('Selecione um token primeiro.');
    socket.emit('sendTokenToMap',{room:me.room,id:tokenId,mapId:id});
  };

  window.sendAllTokensFromActiveToMap=function(id){
    if(!me?.isMaster)return;
    socket.emit('sendTokenToMap',{room:me.room,id:'all',all:true,fromMapId:getActiveId(),mapId:id});
  };

  window.setActiveMap=function(id){
    if(!me?.isMaster)return;
    setActiveId(id);
    socket.emit('setActiveMap',{room:me.room,id});
    if(typeof renderMapListFixed==='function')renderMapListFixed();
    else if(typeof renderMapList==='function')renderMapList();
    requestDraw();
  };

  window.setSpawnMap=function(id){
    if(!me?.isMaster)return;
    setSpawnId(id);
    socket.emit('setSpawnMap',{room:me.room,id});
    if(typeof renderMapListFixed==='function')renderMapListFixed();
    else if(typeof renderMapList==='function')renderMapList();
    requestDraw();
  };

  window.addMapFromMaster=function(){
    if(!me?.isMaster)return;
    ensureMapSideSelector();
    const name=(document.getElementById('newMapName')?.value||('Mapa '+(arrMaps().length+1))).trim();
    const url=(document.getElementById('newMapUrl')?.value||'').trim();
    const file=document.getElementById('newMapFile')?.files?.[0];
    const side=(document.getElementById('mapSide')?.value||'right');
    const send=(src,w=1000,h=700)=>{
      socket.emit('addMap',{room:me.room,map:{name,src,w,h},side,refMapId:getActiveId()});
      const nf=document.getElementById('newMapFile'); if(nf)nf.value='';
      const nu=document.getElementById('newMapUrl'); if(nu)nu.value='';
    };
    if(file){
      const r=new FileReader();
      r.onload=e=>{const data=e.target.result;const img=new Image();img.onload=()=>send(data,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(data,1000,700);img.src=data;};
      r.readAsDataURL(file); return;
    }
    if(url){
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>send(url,img.naturalWidth||1000,img.naturalHeight||700);
      img.onerror=()=>send(url,1000,700); img.src=url; return;
    }
    alert('Escolha uma imagem do mapa ou cole uma URL.');
  };

  // Re-render da lista com botões corretos.
  window.renderMapListFixed=function(){
    const box=document.getElementById('mapList'); if(!box)return;
    const maps=arrMaps();
    if(!maps.length){box.innerHTML='<div style="opacity:.7;font-size:12px">Nenhum mapa salvo.</div>';return;}
    box.innerHTML=maps.map(m=>`
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px">
        <b>${m.id===getActiveId()?'✅ ':''}${m.id===getSpawnId()?'🧍 ':''}${m.name||'Mapa'}</b>
        <br><small>x:${Math.round(m.x||0)} y:${Math.round(m.y||0)}</small>
        <div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
          <button onclick="focusMapFixed('${m.id}')">Ver</button>
          <button onclick="setSpawnMap('${m.id}')">Spawn</button>
          <button onclick="sendSelectedTokenToMap('${m.id}')">Enviar 1</button>
          <button onclick="sendAllTokensFromActiveToMap('${m.id}')">Todos</button>
          <button onclick="deleteMap('${m.id}')" class="danger">Del</button>
        </div>
      </div>`).join('');
  };
  try{ renderMapList=window.renderMapListFixed; }catch(e){}

  // Ajusta mouse/touch: não força activeMapId; usa mapa sob o ponteiro.
  function patchDragListenersInfo(){ console.log('Patch mapas/tokens carregado.'); }
  patchDragListenersInfo();

  socket.on('mapsUpdated',d=>{
    setActiveId(d?.activeMapId||getActiveId());
    setSpawnId(d?.spawnMapId||getSpawnId()||getActiveId());
    setTimeout(()=>{ if(typeof renderMapListFixed==='function')renderMapListFixed(); requestDraw(); },0);
  });
  socket.on('state',s=>{
    setTimeout(()=>{
      if(s?.activeMapId)setActiveId(s.activeMapId);
      if(s?.spawnMapId)setSpawnId(s.spawnMapId);
      if(typeof renderMapListFixed==='function')renderMapListFixed();
      requestDraw();
    },0);
  });
})();

// ===== PATCH VISÃO DO JOGADOR + RÉGUA + NÉVOA/LUZ =====
// Jogador não vê paredes/portas. Mestre continua vendo.
// Régua mede em pés considerando grid de 50px = 5ft (10px = 1ft).
// Névoa escurece a tela do jogador e a luz do token abre a área visível.
(function(){
  if(window.__tavernaVisionFogLightPatch)return;
  window.__tavernaVisionFogLightPatch=true;

  const mapCache = window.__tavernaMapCacheFinal || (window.__tavernaMapCacheFinal={});

  function mapsArr(){
    if(Array.isArray(window.campaignMaps))return window.campaignMaps;
    try{ if(Array.isArray(campaignMaps))return campaignMaps; }catch(e){}
    return [];
  }
  function activeId(){
    try{return window.activeMapId || activeMapId || null;}catch(e){return window.activeMapId||null;}
  }
  function ownToken(){
    if(!me||me.isMaster)return null;
    return (players||[]).find(p=>p && !p.isNpc && p.ownerId===me.pid) || (players||[]).find(p=>p && !p.isNpc && p.id===me.pid) || null;
  }
  function tokenMapId(p){return p && (p.mapId || activeId() || null);}
  function sameTokenMap(a,b){return !a || !b ? false : tokenMapId(a)===tokenMapId(b);}
  function mapById(id){return mapsArr().find(m=>m&&m.id===id)||null;}
  function drawOneMap(m){
    if(!m)return;
    const x=Number(m.x||0), y=Number(m.y||0), w=Number(m.w||1000), h=Number(m.h||700);
    let img=mapCache[m.id];
    if((!img || img.__src!==m.src) && m.src){
      img=new Image();
      img.__src=m.src;
      img.onload=()=>requestDraw();
      img.onerror=()=>requestDraw();
      img.src=m.src;
      mapCache[m.id]=img;
    }
    if(img && img.complete && img.naturalWidth>0){
      ctx.drawImage(img,x,y,w,h);
    }else{
      ctx.fillStyle='rgba(70,70,80,.45)';
      ctx.fillRect(x,y,w,h);
      ctx.fillStyle='rgba(255,255,255,.85)';
      ctx.font=`${16/scale}px Arial`;
      ctx.fillText('Carregando mapa...',x+18,y+42);
    }
    ctx.strokeStyle=m.id===activeId()?'rgba(255,210,80,.9)':'rgba(255,255,255,.22)';
    ctx.lineWidth=(m.id===activeId()?4:2)/scale;
    ctx.strokeRect(x,y,w,h);
    if(me&&me.isMaster){
      ctx.fillStyle='rgba(0,0,0,.68)';
      ctx.fillRect(x+8,y+8,Math.max(150,String(m.name||'Mapa').length*8),28);
      ctx.fillStyle='white';
      ctx.font=`${13/scale}px Arial`;
      let spawn='';
      try{spawn=(m.id===(window.spawnMapId||spawnMapId))?'🧍 ':'';}catch(e){}
      ctx.fillText(spawn+(m.name||'Mapa'),x+14,y+27);
    }
  }
  function drawAllMaps(){
    const arr=mapsArr();
    if(arr.length){ arr.forEach(drawOneMap); return; }
    if(mapImg){
      try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}catch(e){}
    }
  }
  function drawGrid(){
    const grid=50;
    const left=(-offsetX/scale)-100;
    const top=(-offsetY/scale)-100;
    const right=left+canvas.width/scale+200;
    const bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawWallsAndDoorsForMasterOnly(){
    if(!me||!me.isMaster)return;
    ctx.save();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    ctx.strokeStyle='#c97c3d';
    ctx.lineWidth=3/scale;
    for(const w of (walls||[])){
      if(!w||!w[0]||!w[1])continue;
      ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();
    }
    ctx.lineWidth=7/scale;
    for(const d of (doors||[])){
      const w=d&&d.wall; if(!w||!w[0]||!w[1])continue;
      ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';
      ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();
    }
    ctx.restore();
  }
  function ensureTokenImage(p){
    if(!p||!p.img)return null;
    let img=tokenImages[p.id];
    if(!img || img.__src!==p.img){
      img=new Image();
      img.__src=p.img;
      img.onload=()=>requestDraw();
      img.onerror=()=>requestDraw();
      img.src=p.img;
      tokenImages[p.id]=img;
    }
    return img;
  }
  function canPlayerSeeToken(p, viewer){
    if(!viewer)return true;
    if(p.id===viewer.id)return true;
    if(!sameTokenMap(p,viewer))return false;
    if(!fogEnabled || globalLight)return true;
    const r=visionRadiusWorld(viewer);
    return Math.hypot((p.x||0)-(viewer.x||0),(p.y||0)-(viewer.y||0))<=r;
  }
  function drawOneToken(p){
    if(!p)return;
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    const img=ensureTokenImage(p);
    ctx.save();
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();
    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
    else{ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';ctx.fillRect(p.x-r,p.y-r,r*2,r*2);}
    ctx.restore();
    ctx.strokeStyle=p.id===selectedId?'#f0b86e':'rgba(255,255,255,.45)';
    ctx.lineWidth=(p.id===selectedId?3:2)/scale;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#fff';
    ctx.font=`${12/scale}px Arial`;
    ctx.textAlign='center';
    ctx.shadowColor='#000';ctx.shadowBlur=4/scale;
    ctx.fillText(p.name||'Token',p.x,p.y-r-7/scale);
    ctx.shadowBlur=0;
  }
  function drawTokensRespectVision(){
    const viewer=ownToken();
    for(const p of (players||[])){
      if(!p)continue;
      if(!me?.isMaster && !canPlayerSeeToken(p,viewer))continue;
      drawOneToken(p);
    }
  }
  function visionRadiusWorld(p){
    const raw = Number(p&&p.light);
    if(!Number.isFinite(raw))return 50;       // padrão visível
    if(raw<=0)return 0;
    // campo da ficha está em ft: 10px = 1ft. Valores pequenos continuam úteis.
    return raw<=20 ? raw*50 : raw*10;
  }
  function drawSceneWorld(){
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    drawGrid();
    drawAllMaps();
    drawWallsAndDoorsForMasterOnly();
    drawTokensRespectVision();
    ctx.restore();
  }
  function applyFogOverlay(){
    if(!fogEnabled || globalLight || !me || me.isMaster)return;
    const viewer=ownToken();
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='rgba(0,0,0,.96)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if(viewer){
      const sx=offsetX+viewer.x*scale;
      const sy=offsetY+viewer.y*scale;
      const radius=visionRadiusWorld(viewer)*scale;
      if(radius>0){
        ctx.globalCompositeOperation='destination-out';
        const g=ctx.createRadialGradient(sx,sy,0,sx,sy,radius);
        g.addColorStop(0,'rgba(0,0,0,1)');
        g.addColorStop(.72,'rgba(0,0,0,1)');
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g;
        ctx.beginPath();ctx.arc(sx,sy,radius,0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();
    // redesenha o próprio token por cima para o jogador nunca se perder na névoa
    if(viewer){
      ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);drawOneToken(viewer);ctx.restore();
    }
  }
  function drawRulerFixed(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b)return;
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    const a=rr.a,b=rr.b;
    const px=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const ft=px/10;
    const meters=ft*0.3048;
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    ctx.fillStyle='rgba(0,0,0,.78)';
    const tx=(a[0]+b[0])/2, ty=(a[1]+b[1])/2;
    ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);
    ctx.fillStyle='#00e5ff';
    ctx.font=`${14/scale}px Arial`;
    ctx.textAlign='left';
    ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft / ${meters.toFixed(1)} m`,tx+10/scale,ty-7/scale);
    ctx.restore();
  }
  function drawTokenPathsMasterOnly(){
    if(!me||!me.isMaster)return;
    if(typeof drawTokenPaths==='function')drawTokenPaths();
  }
  window.drawTavernaVisionFinal=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    drawSceneWorld();
    drawTokenPathsMasterOnly();
    applyFogOverlay();
    drawRulerFixed();
  };
  try{ draw=window.drawTavernaVisionFinal; }catch(e){window.draw=window.drawTavernaVisionFinal;}

  // Evita parede/porta bloqueando visão visual do jogador; ainda bloqueia movimento no servidor.
  // Atualiza botões e redesenha quando névoa/luz mudam.
  socket.on('fogUpdated',f=>{fogEnabled=!!f;updateFogLightButtons?.();requestDraw();});
  socket.on('fogSet',f=>{fogEnabled=!!f;updateFogLightButtons?.();requestDraw();});
  socket.on('lightUpdated',l=>{globalLight=!!Number(l);updateFogLightButtons?.();requestDraw();});
  socket.on('lightSet',l=>{globalLight=!!Number(l);updateFogLightButtons?.();requestDraw();});

  requestDraw();
})();


// ===== PATCH FINAL: RASTRO NPC + IMPORTAR SEM SUBSTITUIR =====
(function(){
  if(window.__tavernaNpcPathImportFinal)return;
  window.__tavernaNpcPathImportFinal=true;

  window.toggleNpcPath=function(id){
    if(!me?.isMaster)return;
    const p=(players||[]).find(x=>x.id===id);
    if(!p||!p.isNpc)return;
    p.showPath=!p.showPath;
    if(!p.showPath)p.path=[];
    socket.emit('updateToken',{room:me.room,token:{...p,showPath:!!p.showPath,path:p.path||[]}});
    requestDraw();
    updatePlayerList?.();
  };

  window.clearNpcPath=function(id){
    if(!me?.isMaster)return;
    const p=(players||[]).find(x=>x.id===id);
    if(!p||!p.isNpc)return;
    p.path=[];
    socket.emit('updateToken',{room:me.room,token:{...p,path:[]}});
    requestDraw();
  };

  window.updatePlayerList=function(){
    const list=document.getElementById('playerList');
    if(!list||!me||!me.isMaster)return;
    list.innerHTML='';
    (players||[]).forEach(p=>{
      const div=document.createElement('div');
      div.className='player'+(p.isNpc?' npc':'');
      const pathBtns=p.isNpc
        ? `<button class="btn" onclick="event.stopPropagation();toggleNpcPath('${p.id}')">${p.showPath?'🟣 Rastro ON':'⚫ Rastro OFF'}</button><button class="btn" onclick="event.stopPropagation();clearNpcPath('${p.id}')">Limpar</button>`
        : '';
      div.innerHTML=`<span class="name">${p.name||'Token'}</span><span class="hp">${p.hp||0}/${p.maxHp||p.hp||0}</span>${pathBtns}<button class="btn" onclick="event.stopPropagation();openPlayerSheet('${p.id}')">📋</button>`;
      div.onclick=(e)=>{selectedId=p.id;tokenPanelHidden=false;tokenPanelOpen=false;syncTokenPanel?.();center?.();};
      list.appendChild(div);
    });
  };

  window.drawTokenPaths=function(){
    if(!me||!me.isMaster)return;
    const mid=(typeof currentVisibleMapId==='function')?currentVisibleMapId():(window.activeMapId||null);
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    for(const p of (players||[])){
      if(!p||!p.isNpc||!p.showPath)continue;
      if(mid&&p.mapId&&p.mapId!==mid)continue;
      if(!Array.isArray(p.path)||p.path.length<2)continue;
      ctx.strokeStyle='rgba(180,90,255,.85)';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(p.path[0][0],p.path[0][1]);
      for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
      ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.9)';
      for(const pt of p.path){ctx.beginPath();ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  };

  window.importFullMapClick=function(){
    if(!me||!me.isMaster)return alert('Só o Mestre pode importar.');
    document.getElementById('saveMapFile')?.click();
  };

  updatePlayerList?.();
})();

// ===== PATCH FINAL 02/05: LUZ DE TOKEN/NPC + RASTRO VISÍVEL + MESTRE MOVE QUALQUER MAPA =====
(function(){
  if(window.__tavernaLightNpcPathMasterFinal)return;
  window.__tavernaLightNpcPathMasterFinal=true;

  function mapsArr(){
    try{return Array.isArray(window.campaignMaps)?window.campaignMaps:(Array.isArray(campaignMaps)?campaignMaps:[]);}catch(e){return []}
  }
  function activeId(){
    try{return window.activeMapId || activeMapId || null;}catch(e){return window.activeMapId||null;}
  }
  function setActiveIdSafe(id){
    if(!id)return;
    window.activeMapId=id;
    try{activeMapId=id;}catch(e){}
  }
  function mapAtWorld(x,y){
    const arr=mapsArr();
    for(let i=arr.length-1;i>=0;i--){
      const m=arr[i]; if(!m)continue;
      const mx=Number(m.x||0), my=Number(m.y||0), w=Number(m.w||1000), h=Number(m.h||700);
      if(x>=mx && y>=my && x<=mx+w && y<=my+h)return m;
    }
    return null;
  }
  function mapOfToken(p){
    if(!p)return null;
    const arr=mapsArr();
    return arr.find(m=>m.id===p.mapId) || mapAtWorld(Number(p.x||0),Number(p.y||0)) || arr.find(m=>m.id===activeId()) || arr[0] || null;
  }
  function sameMap(a,b){
    const ma=mapOfToken(a), mb=mapOfToken(b);
    if(!ma||!mb)return true;
    return ma.id===mb.id;
  }
  function ownToken(){
    if(!me||me.isMaster)return null;
    return (players||[]).find(p=>p.ownerId===me.pid&&!p.isNpc) || (players||[]).find(p=>p.id===me.pid&&!p.isNpc) || null;
  }
  function lightRadiusWorld(p){
    const raw=Number(p&&p.light);
    if(!Number.isFinite(raw))return p&&p.isNpc?0:50;
    if(raw<=0)return 0;
    return raw<=20 ? raw*50 : raw*10; // ficha em ft: 10px = 1ft; valores pequenos continuam úteis
  }
  function lightSourcesForViewer(){
    const viewer=ownToken();
    if(!viewer)return [];
    return (players||[]).filter(p=>{
      if(!p)return false;
      if(!sameMap(p,viewer))return false;
      return lightRadiusWorld(p)>0;
    });
  }
  function pointInsideAnyLight(x,y,viewer){
    if(!fogEnabled || globalLight)return true;
    const sources=lightSourcesForViewer();
    if(!sources.length)return viewer ? Math.hypot(x-viewer.x,y-viewer.y)<=50 : true;
    return sources.some(s=>Math.hypot(x-Number(s.x||0),y-Number(s.y||0))<=lightRadiusWorld(s));
  }

  // Mestre consegue clicar/mover token em qualquer mapa, mesmo se o mapa ativo for outro.
  window.visiblePlayers=function(){
    if(me&&me.isMaster)return players||[];
    const mid=activeId();
    return (players||[]).filter(p=>!mid || !p.mapId || p.mapId===mid);
  };
  try{visiblePlayers=window.visiblePlayers;}catch(e){}

  window.findTokenAt=function(x,y,rad=26){
    let hit=null,best=999999;
    const list=(me&&me.isMaster)?(players||[]):((typeof visiblePlayers==='function')?visiblePlayers():(players||[]));
    list.forEach(p=>{
      if(!p)return;
      const d=Math.hypot(Number(p.x||0)-x,Number(p.y||0)-y);
      if(d<rad&&d<best){best=d;hit=p;}
    });
    if(hit&&me&&me.isMaster){
      const m=mapOfToken(hit);
      if(m)setActiveIdSafe(m.id);
    }
    return hit;
  };
  try{findTokenAt=window.findTokenAt;}catch(e){}

  // Movimento local não deve forçar token para o mapa focado; usa o mapa onde o ponteiro está.
  window.smoothTokenMove=function(p,targetX,targetY){
    if(!p)return;
    const targetMap=mapAtWorld(targetX,targetY) || mapOfToken(p);
    if(targetMap)p.mapId=targetMap.id;
    const nx=Number(targetX), ny=Number(targetY);
    if(!Number.isFinite(nx)||!Number.isFinite(ny))return;
    if(!blockedMoveLocal(p,nx,ny)){
      p.x=nx;p.y=ny;
      const m=mapAtWorld(p.x,p.y); if(m)p.mapId=m.id;
      if(typeof clampTokenToMap==='function')clampTokenToMap(p);
    }
  };
  try{smoothTokenMove=window.smoothTokenMove;}catch(e){}

  window.blockedMoveLocal=function(p,nx,ny){
    if(!p)return true;
    const targetMap=mapAtWorld(nx,ny);
    if(targetMap)p.mapId=targetMap.id;
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    for(const w of (walls||[])){
      if(!w||!w[0]||!w[1])continue;
      if(typeof lineIntersect==='function' && lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
      if(typeof blockedBySegmentLocal==='function' && blockedBySegmentLocal(nx,ny,w,r))return true;
    }
    for(const d of (doors||[])){
      if(typeof doorBlocksMoveLocal==='function' && !doorBlocksMoveLocal(d))continue;
      const w=d&&d.wall; if(!w||!w[0]||!w[1])continue;
      if(typeof lineIntersect==='function' && lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
      if(typeof blockedBySegmentLocal==='function' && blockedBySegmentLocal(nx,ny,w,r))return true;
    }
    return (players||[]).some(o=>{
      if(!o||o.id===p.id)return false;
      if(!sameMap(o,p))return false;
      return Math.hypot((o.x||0)-nx,(o.y||0)-ny)<(r+(typeof tokenRadius==='function'?tokenRadius(o):16))*0.92;
    });
  };
  try{blockedMoveLocal=window.blockedMoveLocal;}catch(e){}

  // Se rastro estiver ligado, jogadores também veem. Continua só aparecendo para NPC com showPath ON.
  window.drawTokenPaths=function(){
    const viewer=ownToken();
    ctx.save();
    ctx.translate(offsetX,offsetY);
    ctx.scale(scale,scale);
    for(const p of (players||[])){
      if(!p||!p.isNpc||!p.showPath)continue;
      if(!me?.isMaster && viewer && !sameMap(p,viewer))continue;
      if(!Array.isArray(p.path)||p.path.length<2)continue;
      ctx.strokeStyle='rgba(180,90,255,.85)';
      ctx.lineWidth=3/scale;
      ctx.beginPath();
      ctx.moveTo(p.path[0][0],p.path[0][1]);
      for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
      ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.9)';
      for(const pt of p.path){ctx.beginPath();ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  };
  try{drawTokenPaths=window.drawTokenPaths;}catch(e){}

  function ensureImg(p){
    if(!p||!p.img)return null;
    let img=tokenImages[p.id];
    if(!img||img.__src!==p.img){
      img=new Image(); img.__src=p.img;
      img.onload=()=>requestDraw(); img.onerror=()=>requestDraw(); img.src=p.img;
      tokenImages[p.id]=img;
    }
    return img;
  }
  function drawOneTokenFinal(p){
    if(!p)return;
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    const img=ensureImg(p);
    ctx.save();
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();
    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
    else{ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';ctx.fillRect(p.x-r,p.y-r,r*2,r*2);}
    ctx.restore();
    ctx.strokeStyle=p.id===selectedId?'#f0b86e':'rgba(255,255,255,.45)';
    ctx.lineWidth=(p.id===selectedId?3:2)/scale;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#fff';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4/scale;
    ctx.fillText(p.name||'Token',p.x,p.y-r-7/scale);ctx.shadowBlur=0;
  }
  function drawTokensFinal(){
    const viewer=ownToken();
    for(const p of (players||[])){
      if(!p)continue;
      if(!me?.isMaster){
        if(viewer && !sameMap(p,viewer))continue;
        if(fogEnabled && !globalLight && !pointInsideAnyLight(p.x,p.y,viewer))continue;
      }
      drawOneTokenFinal(p);
    }
  }
  function drawOneMapFinal(m){
    if(!m)return;
    const x=Number(m.x||0), y=Number(m.y||0), w=Number(m.w||1000), h=Number(m.h||700);
    let img=m.__img;
    if(m.src && (!img || img.__src!==m.src)){
      img=new Image(); img.__src=m.src; img.onload=()=>requestDraw(); img.onerror=()=>requestDraw(); img.src=m.src; m.__img=img;
    }
    if(img&&img.complete&&img.naturalWidth>0){try{ctx.drawImage(img,x,y,w,h);}catch(e){}}
    else{ctx.fillStyle='rgba(50,50,60,.65)';ctx.fillRect(x,y,w,h);ctx.fillStyle='white';ctx.font=`${16/scale}px Arial`;ctx.fillText('Carregando mapa...',x+18,y+42);}
    ctx.strokeStyle=m.id===activeId()?'rgba(255,210,80,.9)':'rgba(255,255,255,.22)';
    ctx.lineWidth=(m.id===activeId()?4:2)/scale;
    ctx.strokeRect(x,y,w,h);
    if(me&&me.isMaster){
      ctx.fillStyle='rgba(0,0,0,.68)';ctx.fillRect(x+8,y+8,Math.max(150,String(m.name||'Mapa').length*8),28);
      ctx.fillStyle='white';ctx.font=`${13/scale}px Arial`;ctx.fillText((m.name||'Mapa'),x+14,y+27);
    }
  }
  function drawGridFinal(){
    const grid=50;
    const left=(-offsetX/scale)-100, top=(-offsetY/scale)-100, right=left+canvas.width/scale+200, bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMasterWallsDoorsFinal(){
    if(!me||!me.isMaster)return;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
    for(const w of (walls||[])){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();}
    ctx.lineWidth=7/scale;
    for(const d of (doors||[])){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();}
    ctx.restore();
  }
  function drawMasterPlayerLightLines(){
    if(!me||!me.isMaster)return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const p of (players||[])){
      if(!p||p.isNpc)continue;
      const r=lightRadiusWorld(p); if(r<=0)continue;
      ctx.strokeStyle='rgba(255,230,120,.65)';ctx.lineWidth=2/scale;ctx.setLineDash([10/scale,6/scale]);
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,230,120,.9)';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';
      ctx.fillText('luz '+(p.name||'jogador'),p.x,p.y-r-8/scale);
    }
    ctx.restore();
  }
  function applyFogMultiLight(){
    if(!fogEnabled || globalLight || !me || me.isMaster)return;
    const viewer=ownToken();
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgba(0,0,0,.96)';ctx.fillRect(0,0,canvas.width,canvas.height);
    const sources=lightSourcesForViewer();
    if(viewer && !sources.includes(viewer) && lightRadiusWorld(viewer)>0)sources.push(viewer);
    for(const s of sources){
      const radius=lightRadiusWorld(s)*scale; if(radius<=0)continue;
      const sx=offsetX+Number(s.x||0)*scale, sy=offsetY+Number(s.y||0)*scale;
      ctx.globalCompositeOperation='destination-out';
      const g=ctx.createRadialGradient(sx,sy,0,sx,sy,radius);
      g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.72,'rgba(0,0,0,1)');g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(sx,sy,radius,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    // Redesenha tokens visíveis por cima da névoa; NPC também aparece se estiver dentro de alguma luz.
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);drawTokensFinal();ctx.restore();
  }
  function drawRulerFinal(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b)return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    const a=rr.a,b=rr.b,px=Math.hypot(b[0]-a[0],b[1]-a[1]),ft=px/10,meters=ft*0.3048;
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    const tx=(a[0]+b[0])/2,ty=(a[1]+b[1])/2;
    ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);
    ctx.fillStyle='#00e5ff';ctx.font=`${14/scale}px Arial`;ctx.textAlign='left';ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft / ${meters.toFixed(1)} m`,tx+10/scale,ty-7/scale);
    ctx.restore();
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGridFinal();
    const arr=mapsArr(); if(arr.length)arr.forEach(drawOneMapFinal); else if(mapImg)try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700)}catch(e){}
    drawMasterWallsDoorsFinal();
    drawTokensFinal();
    ctx.restore();
    if(typeof drawTokenPaths==='function')drawTokenPaths();
    applyFogMultiLight();
    drawMasterPlayerLightLines();
    drawRulerFinal();
  };
  try{draw=window.draw;}catch(e){}

  // Corrige handlers antigos que colocavam mapId=activeMapId no drag: o servidor/client usa o mapa sob o ponteiro.
  const oldEmitMoveThrottled=window.emitMoveThrottled || (typeof emitMoveThrottled==='function'?emitMoveThrottled:null);
  window.emitMoveThrottled=function(p){
    if(p){const m=mapAtWorld(p.x,p.y)||mapOfToken(p); if(m)p.mapId=m.id;}
    if(oldEmitMoveThrottled)return oldEmitMoveThrottled(p);
    if(!p||!me||!me.room)return; socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveThrottled=window.emitMoveThrottled;}catch(e){}
  const oldEmitMoveNow=window.emitMoveNow || (typeof emitMoveNow==='function'?emitMoveNow:null);
  window.emitMoveNow=function(p){
    if(p){const m=mapAtWorld(p.x,p.y)||mapOfToken(p); if(m)p.mapId=m.id;}
    if(oldEmitMoveNow)return oldEmitMoveNow(p);
    if(!p||!me||!me.room)return; socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveNow=window.emitMoveNow;}catch(e){}

  requestDraw();
})();

// ===== CORREÇÃO FINAL: LUZ SOBRESCREVE A NÉVOA SEM REVELAR PAREDES/PORTAS =====
(function(){
  function mapsListVision(){
    if(Array.isArray(campaignMaps) && campaignMaps.length) return campaignMaps;
    if(mapImg) return [{id:activeMapId||'map_principal',name:'Mapa',src:mapData,w:mapWidth||mapImg.width||1000,h:mapHeight||mapImg.height||700,x:0,y:0,__img:mapImg}];
    return [];
  }
  function getMapImgVision(m){
    if(!m) return null;
    if(m.__img && m.__img.__src===m.src) return m.__img;
    if(m.src){
      const im=new Image();
      im.__src=m.src;
      im.onload=()=>requestDraw();
      im.onerror=()=>requestDraw();
      im.src=m.src;
      m.__img=im;
      return im;
    }
    return null;
  }
  function tokenMapIdVision(p){return p ? (p.mapId || activeMapId || spawnMapId || null) : null;}
  function sameMapVision(a,b){
    const ma=tokenMapIdVision(a), mb=tokenMapIdVision(b);
    return !ma || !mb || ma===mb;
  }
  function ownTokenVision(){
    if(!me || me.isMaster) return null;
    return (players||[]).find(p=>p && !p.isNpc && p.ownerId===me.pid) || (players||[]).find(p=>p && !p.isNpc && p.id===me.pid) || null;
  }
  function lightRadiusVision(p){
    if(!p) return 0;
    if(typeof tokenLightRadius==='function') return tokenLightRadius(p);
    const v=Math.max(0,Number(p.light||0));
    return v<=20?v*50:v*5;
  }
  function lightSourcesVision(viewer){
    const list=[];
    for(const p of (players||[])){
      if(!p) continue;
      if(viewer && !sameMapVision(p,viewer)) continue;
      if(lightRadiusVision(p)>0) list.push(p);
    }
    return list;
  }
  function pointInLightVision(x,y,viewer){
    if(globalLight) return true;
    const sources=lightSourcesVision(viewer);
    for(const s of sources){
      if(Math.hypot(Number(s.x||0)-x,Number(s.y||0)-y)<=lightRadiusVision(s)) return true;
    }
    return false;
  }
  function drawGridVision(){
    const grid=50;
    const left=(-offsetX/scale)-100, top=(-offsetY/scale)-100, right=left+canvas.width/scale+200, bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMapVision(m){
    const x=Number(m.x||0), y=Number(m.y||0), w=Number(m.w||1000), h=Number(m.h||700);
    const im=getMapImgVision(m);
    if(im && im.complete && im.naturalWidth>0){try{ctx.drawImage(im,x,y,w,h);}catch(e){}}
    else{ctx.fillStyle='rgba(50,50,60,.65)';ctx.fillRect(x,y,w,h);}
    ctx.strokeStyle=m.id===activeMapId?'rgba(255,210,80,.28)':'rgba(255,255,255,.045)';
    ctx.lineWidth=(m.id===activeMapId?1.2:.6)/scale;
    ctx.strokeRect(x,y,w,h);
    if(me&&me.isMaster){
      ctx.fillStyle='rgba(0,0,0,.68)';ctx.fillRect(x+8,y+8,Math.max(150,String(m.name||'Mapa').length*8),28);
      ctx.fillStyle='white';ctx.font=`${13/scale}px Arial`;ctx.fillText((m.name||'Mapa'),x+14,y+27);
    }
  }
  function drawWallsDoorsMasterVision(){
    if(!me||!me.isMaster) return;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
    for(const w of (walls||[])){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();}
    ctx.lineWidth=7/scale;
    for(const d of (doors||[])){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();}
    ctx.restore();
  }
  function drawOneTokenVision(p){
    if(!p) return;
    if(p.img && !tokenImages[p.id]){
      const im=new Image(); im.onload=()=>{tokenImages[p.id]=im;requestDraw();}; im.onerror=()=>{tokenImages[p.id]=null;requestDraw();}; im.src=p.img;
    }
    const img=tokenImages[p.id];
    const r=(typeof tokenRadius==='function'?tokenRadius(p):16);
    ctx.save();
    if(img){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);ctx.restore();ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=2/scale;ctx.stroke();}
    else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r*.9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=2/scale;ctx.stroke();}
    ctx.fillStyle='#fff';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4/scale;ctx.fillText(p.name||'Token',p.x,p.y-26/scale);ctx.shadowBlur=0;
    if(!p.isNpc || (me&&me.isMaster)){
      const hp=Number(p.hp||0), max=Math.max(1,Number(p.maxHp||p.hp||1));
      ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(p.x-18/scale,p.y+20/scale,36/scale,5/scale);
      ctx.fillStyle=hp>max*.5?'#4ade80':hp>max*.25?'#facc15':'#f87171';ctx.fillRect(p.x-18/scale,p.y+20/scale,(36/scale)*Math.max(0,Math.min(1,hp/max)),5/scale);
    }
    if(p.id===selectedId){ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.arc(p.x,p.y,24/scale,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  }
  function drawTokensVision({respectFog=false}={}){
    const viewer=ownTokenVision();
    for(const p of (players||[])){
      if(!p) continue;
      if(!me?.isMaster){
        if(viewer && !sameMapVision(p,viewer)) continue;
        if(respectFog && fogEnabled && !globalLight && !pointInLightVision(Number(p.x||0),Number(p.y||0),viewer)) continue;
      }
      drawOneTokenVision(p);
    }
  }
  function drawTokenPathsVision({respectFog=false}={}){
    if(typeof drawTokenPaths!=='function') return;
    // usa a função existente; ela já respeita a configuração de rastro.
    // Quando houver névoa para jogador, os rastros só ficam visíveis pela abertura da luz.
    drawTokenPaths();
  }
  function drawMasterLightCirclesVision(){
    if(!me||!me.isMaster) return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const p of (players||[])){
      if(!p||p.isNpc) continue;
      const r=lightRadiusVision(p); if(r<=0) continue;
      ctx.strokeStyle='rgba(255,230,120,.65)';ctx.lineWidth=2/scale;ctx.setLineDash([10/scale,6/scale]);
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,230,120,.9)';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';ctx.fillText('luz '+(p.name||'jogador'),p.x,p.y-r-8/scale);
    }
    ctx.restore();
  }
  function applyFogOverwriteVision(){
    if(!fogEnabled || globalLight || !me || me.isMaster) return;
    const viewer=ownTokenVision();
    const sources=lightSourcesVision(viewer);

    // Cobre tudo primeiro.
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(0,0,0,.97)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();

    // Agora a luz sobrescreve a névoa: desenha novamente mapa/grid/tokens/rastros só dentro dos círculos de luz.
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const s of sources){
      const r=lightRadiusVision(s); if(r<=0) continue;
      ctx.save();
      ctx.beginPath();ctx.arc(Number(s.x||0),Number(s.y||0),r,0,Math.PI*2);ctx.clip();
      drawGridVision();
      for(const m of mapsListVision()) drawMapVision(m);
      drawTokenPathsVision({respectFog:true});
      drawTokensVision({respectFog:true});
      ctx.restore();
    }
    ctx.restore();
    // Importante: não desenha paredes nem portas aqui. Jogador nunca as vê pela luz.
  }
  function drawRulerVision(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b) return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    const a=rr.a,b=rr.b,px=Math.hypot(b[0]-a[0],b[1]-a[1]),ft=px/10,meters=ft*.3048;
    ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    const tx=(a[0]+b[0])/2,ty=(a[1]+b[1])/2;
    ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);
    ctx.fillStyle='#00e5ff';ctx.font=`${14/scale}px Arial`;ctx.textAlign='left';ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft / ${meters.toFixed(1)} m`,tx+10/scale,ty-7/scale);
    ctx.restore();
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGridVision();
    const maps=mapsListVision(); if(maps.length) maps.forEach(drawMapVision);
    drawWallsDoorsMasterVision();
    drawTokenPathsVision();
    drawTokensVision();
    ctx.restore();
    applyFogOverwriteVision();
    drawMasterLightCirclesVision();
    drawRulerVision();
  };
  try{draw=window.draw;}catch(e){}
  requestDraw();
})();

// ===== PATCH FINAL: MAPAS SEM SOBREPOR/DUPLICAR + RASTRO PRESO AO NPC/MAPA =====
(function(){
  function maps(){try{return Array.isArray(window.campaignMaps)?window.campaignMaps:(Array.isArray(campaignMaps)?campaignMaps:[]);}catch(e){return []}}
  function setMaps(list,active,spawn){
    const seen=new Set(), clean=[];
    for(const raw of (Array.isArray(list)?list:[])){
      if(!raw||!raw.id)continue;
      const key=String(raw.src||'')+'|'+Math.round(Number(raw.w||0))+'x'+Math.round(Number(raw.h||0));
      if(key!=='|0x0' && seen.has(key))continue;
      seen.add(key);
      clean.push({...raw,x:Number(raw.x||0),y:Number(raw.y||0),w:Number(raw.w||1000),h:Number(raw.h||700)});
    }
    window.campaignMaps=clean; try{campaignMaps=clean;}catch(e){}
    const aid=active || window.activeMapId || (typeof activeMapId!=='undefined'?activeMapId:null) || clean[0]?.id || null;
    const sid=spawn || window.spawnMapId || (typeof spawnMapId!=='undefined'?spawnMapId:null) || aid;
    window.activeMapId=aid; window.spawnMapId=sid;
    try{activeMapId=aid;spawnMapId=sid;}catch(e){}
    if(typeof renderMapList==='function')renderMapList();
    if(typeof renderMapListFixed==='function')renderMapListFixed();
    requestDraw?.();
  }
  window.setCampaignMapsFixed=function(list,active,spawn){setMaps(list,active,spawn);};
  socket.on('mapsUpdated',d=>setMaps(d&&d.maps?d.maps:[],d&&d.activeMapId,d&&d.spawnMapId));

  function mapAt(x,y){
    const arr=maps();
    for(let i=arr.length-1;i>=0;i--){const m=arr[i];if(x>=m.x&&y>=m.y&&x<=m.x+m.w&&y<=m.y+m.h)return m;}
    return null;
  }
  window.mapAtWorld=mapAt;
  function mapOfToken(p){return maps().find(m=>p&&m.id===p.mapId)||mapAt(Number(p?.x||0),Number(p?.y||0))||maps().find(m=>m.id===(window.activeMapId||activeMapId))||maps()[0]||null;}
  window.mapOfToken=mapOfToken;
  function preparePathForMove(p,newMap){
    if(!p)return;
    const old=p.mapId||null;
    if(newMap)p.mapId=newMap.id;
    if(p.isNpc&&p.showPath){
      if(p.pathMapId!==p.mapId || old!==p.mapId){
        p.path=[];
        p.pathMapId=p.mapId||null;
      }
      p.path=Array.isArray(p.path)?p.path:[];
      const last=p.path[p.path.length-1];
      if(!last||Math.hypot((last[0]||0)-Number(p.x||0),(last[1]||0)-Number(p.y||0))>7){
        p.path.push([Math.round(Number(p.x||0)),Math.round(Number(p.y||0))]);
        if(p.path.length>140)p.path=p.path.slice(-140);
      }
    }else{
      p.path=[];p.pathMapId=p.mapId||null;
    }
  }
  const oldSmooth=window.smoothTokenMove || (typeof smoothTokenMove==='function'?smoothTokenMove:null);
  window.smoothTokenMove=function(p,targetX,targetY){
    const before=mapOfToken(p);
    if(oldSmooth)oldSmooth(p,targetX,targetY);else{p.x=targetX;p.y=targetY;}
    const after=mapAt(Number(p.x||0),Number(p.y||0))||before;
    preparePathForMove(p,after);
  };
  try{smoothTokenMove=window.smoothTokenMove;}catch(e){}
  const oldEmitT=window.emitMoveThrottled || (typeof emitMoveThrottled==='function'?emitMoveThrottled:null);
  window.emitMoveThrottled=function(p){
    if(p)preparePathForMove(p,mapAt(Number(p.x||0),Number(p.y||0))||mapOfToken(p));
    if(oldEmitT)return oldEmitT(p);
    if(p&&me?.room)socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveThrottled=window.emitMoveThrottled;}catch(e){}
  const oldEmitN=window.emitMoveNow || (typeof emitMoveNow==='function'?emitMoveNow:null);
  window.emitMoveNow=function(p){
    if(p)preparePathForMove(p,mapAt(Number(p.x||0),Number(p.y||0))||mapOfToken(p));
    if(oldEmitN)return oldEmitN(p);
    if(p&&me?.room)socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveNow=window.emitMoveNow;}catch(e){}

  // Rastro: só NPC com showPath, preso ao mapId/pathMapId do próprio NPC. Visível para jogadores quando ligado.
  window.drawTokenPaths=function(){
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    const viewer=(!me||me.isMaster)?null:((players||[]).find(p=>p&&!p.isNpc&&p.ownerId===me.pid)||(players||[]).find(p=>p&&!p.isNpc&&p.id===me.pid));
    const viewerMap=viewer?(viewer.mapId||mapOfToken(viewer)?.id||null):null;
    for(const p of (players||[])){
      if(!p||!p.isNpc||!p.showPath)continue;
      const pmid=p.pathMapId||p.mapId||mapOfToken(p)?.id||null;
      if(viewerMap && pmid && pmid!==viewerMap)continue;
      if(!Array.isArray(p.path)||p.path.length<2)continue;
      ctx.strokeStyle='rgba(90,190,255,.85)';ctx.fillStyle='rgba(90,190,255,.95)';ctx.lineWidth=3/scale;ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.moveTo(p.path[0][0],p.path[0][1]);
      for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
      ctx.stroke();ctx.setLineDash([]);
      for(const pt of p.path){ctx.beginPath();ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  };
  try{drawTokenPaths=window.drawTokenPaths;}catch(e){}

  // Importar/adicionar sempre envia lado escolhido; servidor resolve espaço livre e evita duplicar.
  const oldAdd=window.addMapFromMaster;
  window.addMapFromMaster=function(){
    const name=(document.getElementById('newMapName')?.value||('Mapa '+(maps().length+1))).trim();
    const url=(document.getElementById('newMapUrl')?.value||'').trim();
    const file=document.getElementById('newMapFile')?.files?.[0];
    const side=(document.getElementById('mapSide')?.value||'right');
    const refMapId=window.activeMapId || (typeof activeMapId!=='undefined'?activeMapId:null);
    const send=(src,w=1000,h=700)=>socket.emit('addMap',{room:me.room,map:{name,src,w,h},side,refMapId});
    if(file){const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>send(e.target.result,img.naturalWidth||1000,img.naturalHeight||700);img.src=e.target.result;};r.readAsDataURL(file);return;}
    if(url){send(url,1000,700);return;}
    if(typeof oldAdd==='function')oldAdd();
  };
  requestDraw?.();
})();


// ===== PATCH FINAL DEFINITIVO: RASTRO SEGUE O NPC EM QUALQUER MAPA + DIVISÓRIA FINA =====
(function(){
  function mapsSafe(){try{return Array.isArray(window.campaignMaps)?window.campaignMaps:(Array.isArray(campaignMaps)?campaignMaps:[]);}catch(e){return [];}}
  function mapAtSafe(x,y){
    const arr=mapsSafe();
    for(let i=arr.length-1;i>=0;i--){const m=arr[i];if(x>=m.x&&y>=m.y&&x<=m.x+m.w&&y<=m.y+m.h)return m;}
    return null;
  }
  window.mapAtWorld=window.mapAtWorld||mapAtSafe;
  function normalizeNpcPathMap(p){
    if(!p||!p.isNpc)return;
    const m=(typeof window.mapAtWorld==='function'?window.mapAtWorld(Number(p.x||0),Number(p.y||0)):mapAtSafe(Number(p.x||0),Number(p.y||0)));
    if(m && p.mapId!==m.id){p.mapId=m.id;}
    if(!p.showPath){p.path=[];p.pathMapId=p.mapId||null;return;}
    p.pathMapId=p.mapId||(m&&m.id)||p.pathMapId||null;
  }
  const oldPrep=window.preparePathForMove;
  window.preparePathForMove=function(p,newMap){
    if(newMap&&p)p.mapId=newMap.id;
    normalizeNpcPathMap(p);
    if(oldPrep)return oldPrep(p,newMap);
  };
  const oldDrawPaths=window.drawTokenPaths || (typeof drawTokenPaths==='function'?drawTokenPaths:null);
  window.drawTokenPaths=function(){
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const p of (players||[])){
      normalizeNpcPathMap(p);
      if(!p||!p.isNpc||!p.showPath)continue;
      if(!Array.isArray(p.path)||p.path.length<2)continue;
      // O rastro usa coordenadas de mundo, então fica preso ao NPC em qualquer mapa.
      ctx.strokeStyle='rgba(90,190,255,.85)';ctx.fillStyle='rgba(90,190,255,.95)';ctx.lineWidth=3/scale;ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.moveTo(p.path[0][0],p.path[0][1]);
      for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
      ctx.stroke();ctx.setLineDash([]);
      for(const pt of p.path){ctx.beginPath();ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  };
  try{drawTokenPaths=window.drawTokenPaths;}catch(e){}

  // Reduz visualmente a divisão entre mapas, sem alterar o layout.
  const oldDraw=window.draw || (typeof draw==='function'?draw:null);
  window.draw=function(){
    if(oldDraw)oldDraw();
    // Sobrepõe uma borda quase invisível para suavizar divisórias antigas grossas.
    const arr=mapsSafe();
    if(!arr.length)return;
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const m of arr){
      ctx.strokeStyle=(m.id===(window.activeMapId||activeMapId))?'rgba(255,210,80,.22)':'rgba(255,255,255,.035)';
      ctx.lineWidth=.6/scale;
      ctx.strokeRect(Number(m.x||0),Number(m.y||0),Number(m.w||1000),Number(m.h||700));
    }
    ctx.restore();
  };
  try{draw=window.draw;}catch(e){}
  requestDraw?.();
})();

// ===== PATCH FINAL: GAP AJUSTÁVEL + DELETAR MAPA COM PAREDES/PORTAS + ARRASTAR MAPA + RASTRO GLOBAL DO NPC =====
(function(){
  const DEFAULT_GAP=140;
  let adjustMapId=null;
  let mapDrag=null;

  function mapsSafe(){try{return Array.isArray(window.campaignMaps)?window.campaignMaps:(Array.isArray(campaignMaps)?campaignMaps:[]);}catch(e){return [];}}
  function activeSafe(){try{return window.activeMapId||activeMapId||null;}catch(e){return window.activeMapId||null;}}
  function roomSafe(){return me&&me.room?me.room:'mesa1';}
  function getGap(){
    const el=document.getElementById('mapGap');
    const n=Number(el&&el.value);
    return Number.isFinite(n)?Math.max(0,Math.min(1200,n)):DEFAULT_GAP;
  }
  function ensureGapControl(){
    const sec=document.getElementById('multiMapSection');
    if(!sec||document.getElementById('mapGap'))return;
    const wrap=document.createElement('div');
    wrap.style.marginTop='6px';
    wrap.innerHTML='<label>Distância entre mapas</label><input id="mapGap" type="number" value="140" min="0" max="1200" step="10" style="width:100%"><small style="opacity:.65">Use 0 para quase encostar, ou aumente para separar mais.</small>';
    const btn=sec.querySelector('button[onclick="addMapFromMaster()"]');
    if(btn)sec.insertBefore(wrap,btn); else sec.appendChild(wrap);
  }
  ensureGapControl();
  setTimeout(ensureGapControl,400);

  function mapAt(x,y){
    const arr=mapsSafe();
    for(let i=arr.length-1;i>=0;i--){const m=arr[i];if(x>=Number(m.x||0)&&y>=Number(m.y||0)&&x<=Number(m.x||0)+Number(m.w||1000)&&y<=Number(m.y||0)+Number(m.h||700))return m;}
    return null;
  }
  window.mapAtWorld=mapAt;

  function normalizeNpcPath(p){
    if(!p||!p.isNpc)return;
    const m=mapAt(Number(p.x||0),Number(p.y||0));
    if(m)p.mapId=m.id;
    if(!p.showPath){p.path=[];p.pathMapId=p.mapId||null;return;}
    p.pathMapId=p.mapId||(m&&m.id)||p.pathMapId||null;
    p.path=Array.isArray(p.path)?p.path:[];
  }

  // Não reseta mais o rastro quando o NPC muda de mapa: ele acompanha as coordenadas reais do NPC.
  window.preparePathForMove=function(p,newMap){
    if(newMap&&p)p.mapId=newMap.id;
    if(!p||!p.isNpc)return;
    normalizeNpcPath(p);
    if(!p.showPath)return;
    const last=p.path[p.path.length-1];
    const x=Math.round(Number(p.x||0)), y=Math.round(Number(p.y||0));
    if(!last||Math.hypot(Number(last[0]||0)-x,Number(last[1]||0)-y)>5){
      p.path.push([x,y]);
      if(p.path.length>220)p.path=p.path.slice(-220);
    }
  };
  try{preparePathForMove=window.preparePathForMove;}catch(e){}

  const oldSmooth=window.smoothTokenMove || (typeof smoothTokenMove==='function'?smoothTokenMove:null);
  window.smoothTokenMove=function(p,targetX,targetY){
    if(oldSmooth)oldSmooth(p,targetX,targetY); else {p.x=targetX;p.y=targetY;}
    const m=mapAt(Number(p.x||0),Number(p.y||0));
    if(m)p.mapId=m.id;
    window.preparePathForMove(p,m);
  };
  try{smoothTokenMove=window.smoothTokenMove;}catch(e){}

  const oldEmitNow=window.emitMoveNow || (typeof emitMoveNow==='function'?emitMoveNow:null);
  window.emitMoveNow=function(p){
    if(p)window.preparePathForMove(p,mapAt(Number(p.x||0),Number(p.y||0)));
    if(oldEmitNow)return oldEmitNow(p);
    if(p&&socket&&me)socket.emit('move',{room:roomSafe(),id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveNow=window.emitMoveNow;}catch(e){}
  const oldEmitThr=window.emitMoveThrottled || (typeof emitMoveThrottled==='function'?emitMoveThrottled:null);
  window.emitMoveThrottled=function(p){
    if(p)window.preparePathForMove(p,mapAt(Number(p.x||0),Number(p.y||0)));
    if(oldEmitThr)return oldEmitThr(p);
    if(p&&socket&&me)socket.emit('move',{room:roomSafe(),id:p.id,x:Math.round(p.x),y:Math.round(p.y)});
  };
  try{emitMoveThrottled=window.emitMoveThrottled;}catch(e){}

  window.drawTokenPaths=function(){
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    for(const p of (players||[])){
      normalizeNpcPath(p);
      if(!p||!p.isNpc||!p.showPath)continue;
      if(!Array.isArray(p.path)||p.path.length<2)continue;
      ctx.strokeStyle='rgba(90,190,255,.85)';
      ctx.fillStyle='rgba(90,190,255,.95)';
      ctx.lineWidth=3/scale;ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath();ctx.moveTo(p.path[0][0],p.path[0][1]);
      for(const pt of p.path.slice(1))ctx.lineTo(pt[0],pt[1]);
      ctx.stroke();ctx.setLineDash([]);
      for(const pt of p.path){ctx.beginPath();ctx.arc(pt[0],pt[1],2.5/scale,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  };
  try{drawTokenPaths=window.drawTokenPaths;}catch(e){}

  window.setAdjustMap=function(id){
    adjustMapId=(adjustMapId===id)?null:id;
    if(adjustMapId){setTool('pan');alert('Modo ajustar mapa ligado. Arraste esse mapa para alinhar. Clique em Ajustar novamente para desligar.');}
    if(typeof renderMapListFixed==='function')renderMapListFixed();
  };

  window.renderMapListFixed=function(){
    const box=document.getElementById('mapList'); if(!box)return;
    ensureGapControl();
    const arr=mapsSafe();
    if(!arr.length){box.innerHTML='<div style="opacity:.7;font-size:12px">Nenhum mapa salvo.</div>';return;}
    box.innerHTML=arr.map(m=>`
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px;${adjustMapId===m.id?'box-shadow:0 0 0 2px rgba(201,124,61,.45) inset':''}">
        <b>${m.id===activeSafe()?'✅ ':''}${m.id===(window.spawnMapId||spawnMapId)?'🧍 ':''}${m.name||'Mapa'}</b>
        <br><small>x:${Math.round(m.x||0)} y:${Math.round(m.y||0)}</small>
        <div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
          <button onclick="focusMapFixed('${m.id}')">Ver</button>
          <button onclick="setSpawnMap('${m.id}')">Spawn</button>
          <button onclick="sendSelectedTokenToMap('${m.id}')">Enviar 1</button>
          <button onclick="sendAllTokensFromActiveToMap('${m.id}')">Todos</button>
          <button onclick="setAdjustMap('${m.id}')">${adjustMapId===m.id?'Parar':'Ajustar'}</button>
          <button onclick="deleteMap('${m.id}')" class="danger">Del</button>
        </div>
      </div>`).join('');
  };
  try{renderMapList=window.renderMapListFixed;}catch(e){}

  const oldAdd=window.addMapFromMaster;
  window.addMapFromMaster=function(){
    const name=(document.getElementById('newMapName')?.value||('Mapa '+(mapsSafe().length+1))).trim();
    const url=(document.getElementById('newMapUrl')?.value||'').trim();
    const file=document.getElementById('newMapFile')?.files?.[0];
    const side=(document.getElementById('mapSide')?.value||'right');
    const refMapId=activeSafe();
    const gap=getGap();
    const send=(src,w=1000,h=700)=>socket.emit('addMap',{room:roomSafe(),map:{name,src,w,h},side,refMapId,gap});
    if(file){const r=new FileReader();r.onload=e=>{const img=new Image();img.onload=()=>send(e.target.result,img.naturalWidth||1000,img.naturalHeight||700);img.src=e.target.result;};r.readAsDataURL(file);return;}
    if(url){send(url,1000,700);return;}
    if(typeof oldAdd==='function')oldAdd();
  };

  const oldImport=window.importFullMapClick;
  window.importFullMapClick=function(){
    const inp=document.getElementById('saveMapFile');
    if(!inp){if(oldImport)return oldImport();return;}
    inp.onchange=()=>{
      const f=inp.files&&inp.files[0]; if(!f)return;
      const reader=new FileReader();
      reader.onload=e=>{
        try{
          const state=JSON.parse(e.target.result);
          socket.emit('importFullState',{room:roomSafe(),state,side:(document.getElementById('mapSide')?.value||'right'),refMapId:activeSafe(),gap:getGap(),merge:true});
        }catch(err){alert('Arquivo inválido.');}
      };
      reader.readAsText(f);
      inp.value='';
    };
    inp.click();
  };

  window.deleteMap=function(id){
    if(!me?.isMaster)return;
    if(!confirm('Apagar este mapa e também as paredes/portas dele?'))return;
    socket.emit('deleteMap',{room:roomSafe(),id});
  };

  // Arrastar mapa selecionado pelo botão Ajustar. Move junto tokens, paredes, portas e rastro do mapa.
  function posFromEvent(e){const r=canvas.getBoundingClientRect();const c=e.touches?e.touches[0]:e;return [(c.clientX-r.left-offsetX)/scale,(c.clientY-r.top-offsetY)/scale,c.clientX,c.clientY];}
  canvas.addEventListener('mousedown',function(e){
    if(!me?.isMaster||!adjustMapId)return;
    const [x,y]=posFromEvent(e); const m=mapsSafe().find(mm=>mm.id===adjustMapId);
    if(!m||x<Number(m.x||0)||y<Number(m.y||0)||x>Number(m.x||0)+Number(m.w||1000)||y>Number(m.y||0)+Number(m.h||700))return;
    mapDrag={id:adjustMapId,startX:x,startY:y,mapX:Number(m.x||0),mapY:Number(m.y||0)};
    dragging=null;e.stopImmediatePropagation();e.preventDefault();
  },true);
  canvas.addEventListener('mousemove',function(e){
    if(!mapDrag)return;
    const [x,y]=posFromEvent(e);const nx=mapDrag.mapX+(x-mapDrag.startX),ny=mapDrag.mapY+(y-mapDrag.startY);
    const m=mapsSafe().find(mm=>mm.id===mapDrag.id); if(m){m.x=nx;m.y=ny;}
    if(Date.now()-(mapDrag.last||0)>60){mapDrag.last=Date.now();socket.emit('moveMap',{room:roomSafe(),id:mapDrag.id,x:nx,y:ny,carry:true});}
    requestDraw();e.stopImmediatePropagation();e.preventDefault();
  },true);
  canvas.addEventListener('mouseup',function(e){
    if(!mapDrag)return;
    const m=mapsSafe().find(mm=>mm.id===mapDrag.id);socket.emit('moveMap',{room:roomSafe(),id:mapDrag.id,x:Number(m&&m.x||0),y:Number(m&&m.y||0),carry:true});
    mapDrag=null;e.stopImmediatePropagation();e.preventDefault();
  },true);
  canvas.addEventListener('touchstart',function(e){
    if(!me?.isMaster||!adjustMapId||!e.touches||e.touches.length!==1)return;
    const [x,y]=posFromEvent(e); const m=mapsSafe().find(mm=>mm.id===adjustMapId);
    if(!m||x<Number(m.x||0)||y<Number(m.y||0)||x>Number(m.x||0)+Number(m.w||1000)||y>Number(m.y||0)+Number(m.h||700))return;
    mapDrag={id:adjustMapId,startX:x,startY:y,mapX:Number(m.x||0),mapY:Number(m.y||0)};
    dragging=null;e.stopImmediatePropagation();e.preventDefault();
  },true);
  canvas.addEventListener('touchmove',function(e){
    if(!mapDrag||!e.touches||e.touches.length!==1)return;
    const [x,y]=posFromEvent(e);const nx=mapDrag.mapX+(x-mapDrag.startX),ny=mapDrag.mapY+(y-mapDrag.startY);
    const m=mapsSafe().find(mm=>mm.id===mapDrag.id); if(m){m.x=nx;m.y=ny;}
    if(Date.now()-(mapDrag.last||0)>80){mapDrag.last=Date.now();socket.emit('moveMap',{room:roomSafe(),id:mapDrag.id,x:nx,y:ny,carry:true});}
    requestDraw();e.stopImmediatePropagation();e.preventDefault();
  },true);
  canvas.addEventListener('touchend',function(e){
    if(!mapDrag)return;
    const m=mapsSafe().find(mm=>mm.id===mapDrag.id);socket.emit('moveMap',{room:roomSafe(),id:mapDrag.id,x:Number(m&&m.x||0),y:Number(m&&m.y||0),carry:true});
    mapDrag=null;e.stopImmediatePropagation();e.preventDefault();
  },true);

  const oldMapsUpdatedHandlersNotice=true;
  socket.on('mapsUpdated',()=>setTimeout(()=>{ensureGapControl();window.renderMapListFixed&&window.renderMapListFixed();},50));
  requestDraw?.();
})();

// ===== PATCH FINAL DEFINITIVO: DELETE MAPA, EXPORTAÇÃO COMPLETA E RASTRO CORRETO =====
(function(){
  if(window.__tavernaDeleteExportPathFinal20260502) return;
  window.__tavernaDeleteExportPathFinal20260502 = true;

  function roomSafe(){ return (window.me&&me.room) || (typeof me!=='undefined'&&me&&me.room) || 'mesa1'; }
  function isMasterSafe(){ return !!(typeof me!=='undefined' && me && me.isMaster); }
  function mapsSafe(){
    try{ if(Array.isArray(campaignMaps)) return campaignMaps; }catch(e){}
    return Array.isArray(window.campaignMaps) ? window.campaignMaps : [];
  }
  function setMapsSafe(arr,active,spawn){
    arr = Array.isArray(arr) ? arr : [];
    window.campaignMaps = arr;
    try{ campaignMaps = arr; }catch(e){}
    if(active!==undefined){ window.activeMapId = active || null; try{ activeMapId = active || null; }catch(e){} }
    if(spawn!==undefined){ window.spawnMapId = spawn || null; try{ spawnMapId = spawn || null; }catch(e){} }
  }
  function activeSafe(){ try{return activeMapId || window.activeMapId || null;}catch(e){return window.activeMapId||null;} }
  function spawnSafe(){ try{return spawnMapId || window.spawnMapId || null;}catch(e){return window.spawnMapId||null;} }
  function selectedSafe(){ try{return selectedId || window.selectedId || null;}catch(e){return window.selectedId||null;} }
  function pointInMap(x,y,m,pad){
    pad = Number(pad||0);
    return !!m && x>=Number(m.x||0)-pad && y>=Number(m.y||0)-pad && x<=Number(m.x||0)+Number(m.w||1000)+pad && y<=Number(m.y||0)+Number(m.h||700)+pad;
  }
  function mapAt(x,y){
    const arr = mapsSafe();
    for(let i=arr.length-1;i>=0;i--){ if(pointInMap(Number(x)||0,Number(y)||0,arr[i],0)) return arr[i]; }
    return arr.find(m=>m.id===activeSafe()) || arr[0] || null;
  }
  window.mapAtWorld = mapAt;
  function wallMid(w){ return {x:((Number(w&&w[0]&&w[0][0])||0)+(Number(w&&w[1]&&w[1][0])||0))/2, y:((Number(w&&w[0]&&w[0][1])||0)+(Number(w&&w[1]&&w[1][1])||0))/2}; }
  function wallMapId(w){ return w && w[2] && typeof w[2]==='object' ? String(w[2].mapId||'') : ''; }
  function cloneWallWithMap(w){
    if(!Array.isArray(w) || !w[0] || !w[1]) return w;
    const out = [[Number(w[0][0])||0,Number(w[0][1])||0],[Number(w[1][0])||0,Number(w[1][1])||0]];
    const mid = wallMid(w);
    const m = mapsSafe().find(mm=>mm.id===wallMapId(w)) || mapAt(mid.x,mid.y);
    out[2] = Object.assign({}, (w[2]&&typeof w[2]==='object'?w[2]:{}), {mapId:m?m.id:wallMapId(w)||activeSafe()});
    return out;
  }
  function cloneDoorWithMap(d){
    if(!d) return d;
    const wall = cloneWallWithMap(d.wall||[]);
    const mid = wallMid(wall);
    const m = mapsSafe().find(mm=>mm.id===String(d.mapId||'')) || mapAt(mid.x,mid.y);
    return Object.assign({}, d, {id:d.id, wall, mapId:m?m.id:(d.mapId||activeSafe())});
  }
  function getGap(){
    const el=document.getElementById('mapGap');
    const n=Number(el&&el.value);
    return Number.isFinite(n)?Math.max(0,Math.min(1200,n)):140;
  }
  function imgForMap(m){
    if(!m) return null;
    if(m.__img && m.__img.__src===m.src) return m.__img;
    if(!m.src) return null;
    const im=new Image(); im.__src=m.src; im.onload=()=>requestDraw&&requestDraw(); im.onerror=()=>requestDraw&&requestDraw(); im.src=m.src; m.__img=im; return im;
  }

  // Garante que o servidor receba as paredes/portas com o mapId do mapa onde foram desenhadas.
  const rawEmit = socket.emit.bind(socket);
  socket.emit = function(event, data){
    try{
      if(event==='addWall' && data && data.wall){ data.mapId = data.mapId || (mapAt(wallMid(data.wall).x,wallMid(data.wall).y)||{}).id || activeSafe(); }
      if(event==='addWalls' && data && Array.isArray(data.walls)){ data.mapId = data.mapId || activeSafe(); }
      if(event==='addDoor' && data && data.door && data.door.wall){ data.mapId = data.mapId || (mapAt(wallMid(data.door.wall).x,wallMid(data.door.wall).y)||{}).id || activeSafe(); }
    }catch(e){}
    return rawEmit(event,data);
  };

  window.deleteMap = function(id){
    if(!isMasterSafe()) return alert('Só o Mestre pode apagar mapa.');
    const target = id || activeSafe();
    if(!target) return alert('Nenhum mapa selecionado.');
    const m = mapsSafe().find(mm=>mm.id===target);
    if(!m) return alert('Mapa não encontrado na lista atual.');
    if(!confirm('Apagar "'+(m.name||'Mapa')+'" e também as paredes/portas dele?')) return;
    socket.emit('deleteMap',{room:roomSafe(),id:target});
  };

  window.exportFullMap = function(){
    if(!isMasterSafe()) return alert('Só o Mestre pode salvar.');
    const state = {
      version: 7,
      savedAt: new Date().toISOString(),
      maps: mapsSafe().map(m=>({id:m.id,name:m.name,src:m.src,w:m.w,h:m.h,x:m.x,y:m.y})),
      activeMapId: activeSafe(),
      spawnMapId: spawnSafe(),
      mapData: (typeof mapData!=='undefined'?mapData:null),
      mapW: (typeof mapWidth!=='undefined'?mapWidth:0),
      mapH: (typeof mapHeight!=='undefined'?mapHeight:0),
      walls: (Array.isArray(walls)?walls:[]).map(cloneWallWithMap),
      doors: (Array.isArray(doors)?doors:[]).map(cloneDoorWithMap),
      players: (Array.isArray(players)?players:[]).map(p=>Object.assign({},p,{path:Array.isArray(p.path)?p.path:[],pathMapId:p.pathMapId||p.mapId||null})),
      fog: !!(typeof fogEnabled!=='undefined' && fogEnabled),
      globalLight: Number(typeof globalLight!=='undefined'?globalLight:0)||0
    };
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='taverna-cena-completa-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  };

  window.importFullMapClick = function(){
    if(!isMasterSafe()) return alert('Só o Mestre pode importar.');
    const inp=document.getElementById('saveMapFile');
    if(!inp) return alert('Input de importação não encontrado.');
    inp.onchange = function(){
      const f=inp.files && inp.files[0]; if(!f) return;
      const reader=new FileReader();
      reader.onload=function(ev){
        try{
          const state=JSON.parse(ev.target.result);
          const isFullSavedScene = Array.isArray(state.maps) && state.maps.length>1;
          // Cena salva com vários mapas deve voltar exatamente como foi salva: mesmas distâncias, paredes, portas e NPCs.
          // Mapa único/legado continua entrando como mapa adicional na posição escolhida.
          socket.emit('importFullState',{room:roomSafe(),state,merge:!isFullSavedScene,side:(document.getElementById('mapSide')?.value||'right'),refMapId:activeSafe(),gap:getGap()});
        }catch(err){ alert('Arquivo inválido: '+err.message); }
        inp.value='';
      };
      reader.readAsText(f);
    };
    inp.click();
  };

  function ensureGapControlFinal(){
    const sec=document.getElementById('multiMapSection');
    if(!sec || document.getElementById('mapGap')) return;
    const wrap=document.createElement('div');
    wrap.style.marginTop='6px';
    wrap.innerHTML='<label>Distância entre mapas</label><input id="mapGap" type="number" value="140" min="0" max="1200" step="10" style="width:100%"><small style="opacity:.65">Aumente para separar mais os mapas.</small>';
    const btn=sec.querySelector('button[onclick="addMapFromMaster()"]');
    if(btn) sec.insertBefore(wrap,btn); else sec.appendChild(wrap);
  }
  window.renderMapListFixed = function(){
    const box=document.getElementById('mapList'); if(!box) return;
    ensureGapControlFinal();
    const arr=mapsSafe();
    if(!arr.length){ box.innerHTML='<div style="opacity:.7;font-size:12px">Nenhum mapa salvo.</div>'; return; }
    box.innerHTML=arr.map(m=>`<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px">
      <b>${m.id===activeSafe()?'✅ ':''}${m.id===spawnSafe()?'🧍 ':''}${m.name||'Mapa'}</b><br>
      <small>x:${Math.round(Number(m.x)||0)} y:${Math.round(Number(m.y)||0)}</small>
      <div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">
        <button onclick="focusMapFixed&&focusMapFixed('${m.id}')">Ver</button>
        <button onclick="setSpawnMap&&setSpawnMap('${m.id}')">Spawn</button>
        <button onclick="sendSelectedTokenToMap&&sendSelectedTokenToMap('${m.id}')">Enviar 1</button>
        <button onclick="sendAllTokensFromActiveToMap&&sendAllTokensFromActiveToMap('${m.id}')">Todos</button>
        <button onclick="setAdjustMap&&setAdjustMap('${m.id}')">Ajustar</button>
        <button onclick="deleteMap('${m.id}')" class="danger">Del</button>
      </div></div>`).join('');
  };
  try{ renderMapList = window.renderMapListFixed; }catch(e){}

  socket.on('mapsUpdated',function(d){
    if(!d) return;
    setMapsSafe(d.maps||[], d.activeMapId||null, d.spawnMapId||null);
    const active = mapsSafe().find(m=>m.id===activeSafe()) || mapsSafe()[0];
    if(active){ try{ mapData=active.src; mapWidth=Number(active.w)||0; mapHeight=Number(active.h)||0; }catch(e){} }
    setTimeout(()=>{ ensureGapControlFinal(); window.renderMapListFixed(); requestDraw&&requestDraw(); },20);
  });

  // Rastro definitivo: só NPC com showPath. Desenha nas coordenadas reais do NPC, não prende no mapa principal.
  window.drawTokenPaths = function(){
    const list = Array.isArray(players) ? players : [];
    ctx.save(); ctx.translate(offsetX,offsetY); ctx.scale(scale,scale);
    for(const p of list){
      if(!p || !p.isNpc || !p.showPath) continue;
      if(!Array.isArray(p.path) || p.path.length<2) continue;
      ctx.strokeStyle='rgba(90,190,255,.9)';
      ctx.fillStyle='rgba(90,190,255,.95)';
      ctx.lineWidth=3/scale; ctx.setLineDash([8/scale,6/scale]);
      ctx.beginPath(); ctx.moveTo(Number(p.path[0][0])||0,Number(p.path[0][1])||0);
      for(const pt of p.path.slice(1)) ctx.lineTo(Number(pt[0])||0,Number(pt[1])||0);
      ctx.stroke(); ctx.setLineDash([]);
      for(const pt of p.path){ ctx.beginPath(); ctx.arc(Number(pt[0])||0,Number(pt[1])||0,2.5/scale,0,Math.PI*2); ctx.fill(); }
    }
    ctx.restore();
  };
  try{ drawTokenPaths = window.drawTokenPaths; }catch(e){}

  function preparePath(p){
    if(!p) return;
    const m=mapAt(Number(p.x)||0,Number(p.y)||0); if(m) p.mapId=m.id;
    if(!p.isNpc || !p.showPath){ p.path=[]; p.pathMapId=p.mapId||null; return; }
    p.pathMapId=p.mapId||null;
    p.path=Array.isArray(p.path)?p.path:[];
    const x=Math.round(Number(p.x)||0), y=Math.round(Number(p.y)||0);
    const last=p.path[p.path.length-1];
    if(!last || Math.hypot((Number(last[0])||0)-x,(Number(last[1])||0)-y)>5){
      p.path.push([x,y]); if(p.path.length>240) p.path=p.path.slice(-240);
    }
  }
  const prevEmitNow = window.emitMoveNow || (typeof emitMoveNow==='function'?emitMoveNow:null);
  window.emitMoveNow=function(p){ preparePath(p); if(prevEmitNow) return prevEmitNow(p); if(p) socket.emit('move',{room:roomSafe(),id:p.id,x:Math.round(p.x),y:Math.round(p.y)}); };
  try{ emitMoveNow=window.emitMoveNow; }catch(e){}
  const prevEmitTh = window.emitMoveThrottled || (typeof emitMoveThrottled==='function'?emitMoveThrottled:null);
  window.emitMoveThrottled=function(p){ preparePath(p); if(prevEmitTh) return prevEmitTh(p); if(p) socket.emit('move',{room:roomSafe(),id:p.id,x:Math.round(p.x),y:Math.round(p.y)}); };
  try{ emitMoveThrottled=window.emitMoveThrottled; }catch(e){}

  // Desenho final limpo: jogadores não veem paredes/portas; luz/fog continuam sem revelar paredes/portas.
  function drawGrid(){
    const grid=50,left=(-offsetX/scale)-100,top=(-offsetY/scale)-100,right=left+canvas.width/scale+200,bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMaps(){
    const arr=mapsSafe();
    if(arr.length){
      for(const m of arr){ const im=imgForMap(m); const x=Number(m.x)||0,y=Number(m.y)||0,w=Number(m.w)||1000,h=Number(m.h)||700; if(im&&im.complete&&im.naturalWidth>0){try{ctx.drawImage(im,x,y,w,h);}catch(e){}} else {ctx.fillStyle='rgba(50,50,60,.65)';ctx.fillRect(x,y,w,h);} ctx.strokeStyle=m.id===activeSafe()?'rgba(255,210,80,.22)':'rgba(255,255,255,.035)';ctx.lineWidth=.8/scale;ctx.strokeRect(x,y,w,h); if(isMasterSafe()){ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(x+8,y+8,Math.max(120,String(m.name||'Mapa').length*8),24);ctx.fillStyle='#fff';ctx.font=`${12/scale}px Arial`;ctx.fillText(m.name||'Mapa',x+14,y+25);} }
    } else if(typeof mapImg!=='undefined'&&mapImg){ try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}catch(e){} }
  }
  function drawMasterWallsDoors(){
    if(!isMasterSafe()) return;
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle='#c97c3d'; ctx.lineWidth=3/scale;
    for(const w of (Array.isArray(walls)?walls:[])){ if(!w||!w[0]||!w[1])continue; ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke(); }
    for(const d of (Array.isArray(doors)?doors:[])){ const w=d&&d.wall; if(!w||!w[0]||!w[1])continue; ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke(); }
    ctx.restore();
  }
  function lightRadius(p){ if(typeof tokenLightRadius==='function') return tokenLightRadius(p); const v=Math.max(0,Number(p&&p.light||0)); return v<=20?v*50:v*5; }
  function ownToken(){ if(!me||me.isMaster)return null; return (players||[]).find(p=>p&&!p.isNpc&&p.ownerId===me.pid)||(players||[]).find(p=>p&&!p.isNpc&&p.id===me.pid)||null; }
  function sameMap(a,b){ return !a||!b||!a.mapId||!b.mapId||a.mapId===b.mapId; }
  function pointLit(x,y,viewer){ if(globalLight)return true; for(const s of (players||[])){ if(!s||!sameMap(s,viewer))continue; const r=lightRadius(s); if(r>0&&Math.hypot(Number(s.x||0)-x,Number(s.y||0)-y)<=r)return true; } return false; }
  function drawOneToken(p){ if(typeof drawSingleTokenScreen==='function'){ /* not used because that draws screen transform */ } const r=(typeof tokenRadius==='function'?tokenRadius(p):16); if(p.img&&!tokenImages[p.id]){const im=new Image();im.onload=()=>{tokenImages[p.id]=im;requestDraw&&requestDraw();};im.src=p.img;} const img=tokenImages[p.id]; ctx.save(); if(img){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);ctx.restore();ctx.save();ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=2/scale;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();} else {ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r*.9,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.65)';ctx.lineWidth=2/scale;ctx.stroke();} ctx.fillStyle='#fff';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4/scale;ctx.fillText(p.name||'Token',p.x,p.y-24/scale);ctx.shadowBlur=0; if(p.id===selectedSafe()){ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.beginPath();ctx.arc(p.x,p.y,24/scale,0,Math.PI*2);ctx.stroke();} ctx.restore(); }
  function drawTokens(respectFog){ const viewer=ownToken(); for(const p of (players||[])){ if(!p)continue; if(!isMasterSafe()){ if(viewer&&!sameMap(p,viewer))continue; if(respectFog&&fogEnabled&&!globalLight&&!pointLit(p.x,p.y,viewer))continue; } drawOneToken(p); } }
  function applyFog(){ if(!fogEnabled||globalLight||isMasterSafe())return; const viewer=ownToken(); const sources=(players||[]).filter(p=>p&&sameMap(p,viewer)&&lightRadius(p)>0); ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='rgba(0,0,0,.97)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore(); ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale); for(const s of sources){ctx.save();ctx.beginPath();ctx.arc(s.x,s.y,lightRadius(s),0,Math.PI*2);ctx.clip();drawGrid();drawMaps();window.drawTokenPaths();drawTokens(true);ctx.restore();} ctx.restore(); }
  function drawLightCircles(){ if(!isMasterSafe())return; ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale); for(const p of (players||[])){ if(!p||p.isNpc)continue; const r=lightRadius(p); if(r<=0)continue; ctx.strokeStyle='rgba(255,230,120,.6)';ctx.lineWidth=2/scale;ctx.setLineDash([10/scale,6/scale]);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);} ctx.restore(); }
  function drawRuler(){ const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler; if(!rr||!rr.a||!rr.b)return; ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale); const a=rr.a,b=rr.b,px=Math.hypot(b[0]-a[0],b[1]-a[1]),ft=px/10,meters=ft*.3048; ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); const tx=(a[0]+b[0])/2,ty=(a[1]+b[1])/2; ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);ctx.fillStyle='#00e5ff';ctx.font=`${14/scale}px Arial`;ctx.fillText(`${ft.toFixed(ft<10?1:0)} ft / ${meters.toFixed(1)} m`,tx+10/scale,ty-7/scale);ctx.restore(); }
  window.draw=function(){ ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height); ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);drawGrid();drawMaps();drawMasterWallsDoors();window.drawTokenPaths();drawTokens(false);ctx.restore();applyFog();drawLightCircles();drawRuler(); };
  try{ draw=window.draw; }catch(e){}

  ensureGapControlFinal(); setTimeout(()=>{ensureGapControlFinal();window.renderMapListFixed();requestDraw&&requestDraw();},250);
})();

// ===== REVISÃO FINAL DO RASTRO DO NPC =====
// Regra: rastro só existe em NPC com Rastro ON. O rastro usa coordenadas reais de mundo
// e acompanha o NPC quando ele é enviado/teleportado para qualquer mapa.
(function(){
  if(window.__tavernaTrailReviewFinal)return;
  window.__tavernaTrailReviewFinal=true;

  function safePlayers(){ return Array.isArray(window.players)?window.players:(typeof players!=='undefined'&&Array.isArray(players)?players:[]); }
  function safeCtx(){ return (typeof ctx!=='undefined')?ctx:null; }
  function safeScale(){ return (typeof scale!=='undefined'&&Number(scale))?Number(scale):1; }
  function safeOffsetX(){ return (typeof offsetX!=='undefined'&&Number.isFinite(Number(offsetX)))?Number(offsetX):0; }
  function safeOffsetY(){ return (typeof offsetY!=='undefined'&&Number.isFinite(Number(offsetY)))?Number(offsetY):0; }

  function normalizeNpcTrail(p){
    if(!p)return;
    if(!p.isNpc || !p.showPath){
      p.path=[];
      p.pathMapId=p.mapId||null;
      return;
    }
    p.path=Array.isArray(p.path)?p.path.filter(pt=>Array.isArray(pt)&&Number.isFinite(Number(pt[0]))&&Number.isFinite(Number(pt[1]))):[];
    p.pathMapId=p.mapId||p.pathMapId||null;
  }
  window.normalizeNpcTrail=normalizeNpcTrail;

  window.drawTokenPaths=function(){
    const c=safeCtx(); if(!c)return;
    const sc=safeScale();
    c.save();
    c.translate(safeOffsetX(),safeOffsetY());
    c.scale(sc,sc);
    for(const p of safePlayers()){
      normalizeNpcTrail(p);
      if(!p||!p.isNpc||!p.showPath||!Array.isArray(p.path)||p.path.length<2)continue;
      c.strokeStyle='rgba(90,190,255,.95)';
      c.fillStyle='rgba(90,190,255,1)';
      c.lineWidth=3/sc;
      c.setLineDash([8/sc,6/sc]);
      c.beginPath();
      c.moveTo(Number(p.path[0][0])||0,Number(p.path[0][1])||0);
      for(const pt of p.path.slice(1)) c.lineTo(Number(pt[0])||0,Number(pt[1])||0);
      c.stroke();
      c.setLineDash([]);
      for(const pt of p.path){ c.beginPath(); c.arc(Number(pt[0])||0,Number(pt[1])||0,2.5/sc,0,Math.PI*2); c.fill(); }
    }
    c.restore();
  };
  try{ drawTokenPaths=window.drawTokenPaths; }catch(e){}

  // Não deixe playerMoved antigo limpar rastro recebido do servidor.
  const oldUpdateOrAdd=window.updateOrAddPlayer || (typeof updateOrAddPlayer==='function'?updateOrAddPlayer:null);
  window.updateOrAddPlayer=function(p){
    if(p) normalizeNpcTrail(p);
    if(oldUpdateOrAdd) return oldUpdateOrAdd(p);
  };
  try{ updateOrAddPlayer=window.updateOrAddPlayer; }catch(e){}

  const oldToggle=window.toggleNpcPath;
  window.toggleNpcPath=function(id){
    if(!me?.isMaster)return;
    const p=safePlayers().find(x=>x&&x.id===id);
    if(!p||!p.isNpc)return;
    p.showPath=!p.showPath;
    if(p.showPath){
      p.path=Array.isArray(p.path)?p.path:[];
      const x=Math.round(Number(p.x)||0), y=Math.round(Number(p.y)||0);
      if(!p.path.length)p.path=[[x,y]];
      p.pathMapId=p.mapId||null;
    }else{
      p.path=[];
      p.pathMapId=p.mapId||null;
    }
    socket.emit('updateToken',{room:me.room,token:{id:p.id,showPath:!!p.showPath,path:p.path,pathMapId:p.pathMapId,mapId:p.mapId}});
    requestDraw&&requestDraw();
    updatePlayerList&&updatePlayerList();
  };

  window.clearNpcPath=function(id){
    if(!me?.isMaster)return;
    const p=safePlayers().find(x=>x&&x.id===id);
    if(!p||!p.isNpc)return;
    p.path=[];
    p.pathMapId=p.mapId||null;
    socket.emit('updateToken',{room:me.room,token:{id:p.id,path:[],pathMapId:p.pathMapId,showPath:!!p.showPath,mapId:p.mapId}});
    requestDraw&&requestDraw();
  };
})();
