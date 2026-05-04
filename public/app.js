

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
      r.onload=ev=>{try{socket.emit('importFullState',{room:me.room,state:JSON.parse(ev.target.result)});}catch(err){alert('Arquivo inválido.');}};
      r.readAsText(file);
    });
  }
})();

// ===== PATCH FINAL: IMPORTAÇÃO DE MAPAS CORRIGIDA =====
(function(){
  if(window.__tavernaImportMapsFinal)return;
  window.__tavernaImportMapsFinal=true;

  function master(){return !!(me&&me.isMaster);} 
  function room(){return me&&me.room?me.room:'mesa1';}
  function maps(){try{return Array.isArray(campaignMaps)?campaignMaps:[]}catch(e){return []}}
  function active(){try{return activeMapId||null}catch(e){return null}}
  function spawn(){try{return spawnMapId||activeMapId||null}catch(e){return null}}
  function gap(){const el=document.getElementById('mapGap');const n=Number(el&&el.value);return Number.isFinite(n)?Math.max(20,Math.min(2000,n)):160;}

  function cleanScene(state){
    if(!state||typeof state!=='object')throw new Error('JSON inválido');
    if(!Array.isArray(state.maps)||!state.maps.length){
      if(state.mapData)state.maps=[{id:state.activeMapId||'map_principal',name:'Mapa Principal',src:state.mapData,w:state.mapW||1000,h:state.mapH||700,x:0,y:0}];
      else state.maps=[];
    }
    state.maps=(state.maps||[]).map((m,i)=>({
      id:String(m.id||('map_import_'+i)),
      name:String(m.name||('Mapa Importado '+(i+1))),
      src:String(m.src||m.mapData||m.data||m.url||''),
      w:Number(m.w||m.mapW||m.width||1000)||1000,
      h:Number(m.h||m.mapH||m.height||700)||700,
      x:Number(m.x||0)||0,
      y:Number(m.y||0)||0
    })).filter(m=>m.src);
    return state;
  }

  function ensureMapGapControl(){
    const sec=document.getElementById('multiMapSection');
    if(!sec||document.getElementById('mapGap'))return;
    const div=document.createElement('div');
    div.style.margin='6px 0';
    div.innerHTML='<label>Distância entre mapas</label><input id="mapGap" type="number" min="20" max="2000" step="10" value="160" style="width:100%"><small style="opacity:.65">Usado ao adicionar novos mapas.</small>';
    const btn=sec.querySelector('button[onclick="addMapFromMaster()"]');
    if(btn)sec.insertBefore(div,btn);else sec.appendChild(div);
  }

  const oldSetCampaign=window.setCampaignMapsFixed;
  window.setCampaignMapsFixed=function(list,activeId,spawnId){
    const arr=(Array.isArray(list)?list:[]).map((m,i)=>({
      ...m,
      id:String(m.id||('map_'+i)),
      name:String(m.name||('Mapa '+(i+1))),
      src:String(m.src||m.mapData||m.data||m.url||''),
      w:Number(m.w||m.mapW||m.width||1000)||1000,
      h:Number(m.h||m.mapH||m.height||700)||700,
      x:Number(m.x||0)||0,
      y:Number(m.y||0)||0
    })).filter(m=>m.src);
    if(typeof oldSetCampaign==='function')return oldSetCampaign(arr,activeId,spawnId);
    campaignMaps=arr;activeMapId=activeId||arr[0]?.id||null;spawnMapId=spawnId||activeMapId;requestDraw();
  };

  window.addMapFromMaster=function(){
    if(!master())return alert('Só o Mestre pode adicionar mapas.');
    ensureMapGapControl();
    const name=(document.getElementById('newMapName')?.value||('Mapa '+(maps().length+1))).trim();
    const url=(document.getElementById('newMapUrl')?.value||'').trim();
    const file=document.getElementById('newMapFile')?.files?.[0];
    const side=(document.getElementById('mapSide')?.value||'right');
    const send=(src,w=1000,h=700)=>socket.emit('addMap',{room:room(),map:{name,src,w,h},side,refMapId:active(),gap:gap()});
    if(file){
      const r=new FileReader();
      r.onload=e=>{const data=e.target.result;const img=new Image();img.onload=()=>send(data,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(data,1000,700);img.src=data;};
      r.readAsDataURL(file);return;
    }
    if(url){const img=new Image();img.crossOrigin='anonymous';img.onload=()=>send(url,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>send(url,1000,700);img.src=url;return;}
    alert('Escolha imagem da galeria ou URL.');
  };

  window.exportFullMap=function(){
    const state={
      version:12,
      savedAt:new Date().toISOString(),
      players:players||[],
      walls:walls||[],
      doors:doors||[],
      maps:maps().map(m=>({...m})),
      activeMapId:active(),
      spawnMapId:spawn(),
      mapData:mapData||null,
      mapW:mapWidth||0,
      mapH:mapHeight||0,
      fog:!!fogEnabled,
      globalLight:Number(globalLight||0)||0
    };
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='taverna-cena-mapas-corrigidos-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  };

  window.importFullMapClick=function(){
    if(!master())return alert('Só o Mestre pode importar.');
    const input=document.createElement('input');
    input.type='file';input.accept='application/json,.json';
    input.onchange=function(){
      const f=input.files&&input.files[0];if(!f)return;
      const r=new FileReader();
      r.onload=function(ev){
        try{socket.emit('importFullState',{room:room(),state:cleanScene(JSON.parse(ev.target.result))});}
        catch(err){alert('Arquivo inválido: '+err.message);}
      };
      r.readAsText(f);
    };
    input.click();
  };

  socket.on('mapsUpdated',function(d){
    if(!d)return;
    window.setCampaignMapsFixed(d.maps||[],d.activeMapId,d.spawnMapId);
    setTimeout(()=>{ensureMapGapControl();try{renderMapListFixed&&renderMapListFixed();}catch(e){}},20);
  });
  socket.on('state',function(s){
    if(s&&Array.isArray(s.maps))window.setCampaignMapsFixed(s.maps,s.activeMapId,s.spawnMapId);
  });
  ensureMapGapControl();
})();

// ===== VERSÃO COMPLETA FINAL: ZOOM, MAPAS, SPAWN GLOBAL, DEMEO TOKENS =====
(function(){
  if(window.__TAVERNA_COMPLETA_FUNCOES_NOVAS__) return;
  window.__TAVERNA_COMPLETA_FUNCOES_NOVAS__ = true;
  const MIN_ZOOM = 0.05, MAX_ZOOM = 16;
  const mapCache2 = window.__mapCacheFinal || (window.__mapCacheFinal={});
  function n(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function master(){return !!(me&&me.isMaster)}
  function room(){return me&&me.room?me.room:'mesa1'}
  function maps(){try{return Array.isArray(campaignMaps)?campaignMaps:[]}catch(e){return window.campaignMaps||[]}}
  function setMaps(list,active,spawn){
    const arr=(Array.isArray(list)?list:[]).map((m,i)=>({
      id:String(m.id||('map_'+i)),name:String(m.name||('Mapa '+(i+1))),src:String(m.src||m.mapData||m.data||m.url||''),
      w:n(m.w||m.mapW||m.width,1000)||1000,h:n(m.h||m.mapH||m.height,700)||700,x:n(m.x,0),y:n(m.y,0)
    })).filter(m=>m.src);
    try{campaignMaps=arr;}catch(e){} window.campaignMaps=arr;
    try{activeMapId=active||activeMapId||arr[0]?.id||null;}catch(e){window.activeMapId=active||arr[0]?.id||null;}
    try{spawnMapId=spawn||spawnMapId||activeMapId||null;}catch(e){window.spawnMapId=spawn||window.activeMapId||null;}
    window.activeMapId = (typeof activeMapId!=='undefined'?activeMapId:window.activeMapId);
    window.spawnMapId = (typeof spawnMapId!=='undefined'?spawnMapId:window.spawnMapId);
    for(const m of arr){
      if(mapCache2[m.id]&&mapCache2[m.id].__src===m.src) continue;
      const img=new Image(); img.__src=m.src; img.onload=()=>requestDraw(); img.onerror=()=>requestDraw(); img.src=m.src; mapCache2[m.id]=img;
    }
    renderMapListFinal(); requestDraw();
  }
  function active(){try{return activeMapId||window.activeMapId||null}catch(e){return window.activeMapId||null}}
  function gap(){const el=document.getElementById('mapGap');const x=n(el&&el.value,180);return Math.max(20,Math.min(5000,x));}
  function ensureGap(){const sec=document.getElementById('multiMapSection');if(!sec||document.getElementById('mapGap'))return;const div=document.createElement('div');div.style.margin='6px 0';div.innerHTML='<label>Distância entre mapas</label><input id="mapGap" type="number" min="20" max="5000" step="10" value="180" style="width:100%"><small style="opacity:.65">Controla a distância ao adicionar mapa novo.</small>';const btn=sec.querySelector('button[onclick="addMapFromMaster()"]'); if(btn)sec.insertBefore(div,btn); else sec.appendChild(div);}
  function getGS(kind){const gs=window.globalSpawns||{};const p=gs[kind];return p&&Number.isFinite(n(p.x,NaN))&&Number.isFinite(n(p.y,NaN))?{x:n(p.x),y:n(p.y)}:null;}
  function setGS(kind,x,y){window.globalSpawns=window.globalSpawns||{}; if(Number.isFinite(n(x,NaN))&&Number.isFinite(n(y,NaN))) window.globalSpawns[kind]={x:n(x),y:n(y)}; else delete window.globalSpawns[kind];}
  function receiveSpawns(d){if(!d)return; if(d.globalSpawns){if('player' in d.globalSpawns){const p=d.globalSpawns.player;p?setGS('player',p.x,p.y):setGS('player',null,null)} if('npc' in d.globalSpawns){const p=d.globalSpawns.npc;p?setGS('npc',p.x,p.y):setGS('npc',null,null)}}}
  window.markGlobalSpawn=function(kind){if(!master())return alert('Só o Mestre pode marcar spawn.');window.__pendingGlobalSpawnKind=String(kind||'player').toLowerCase()==='npc'?'npc':'player';alert('Clique no ponto do mundo para marcar o spawn GLOBAL de '+(window.__pendingGlobalSpawnKind==='npc'?'NPC':'jogador'));};
  window.clearGlobalSpawn=function(kind){if(!master())return;const k=String(kind||'both').toLowerCase();if(k==='player'||k==='both')setGS('player',null,null);if(k==='npc'||k==='both')setGS('npc',null,null);socket.emit('clearGlobalSpawnV2',{room:room(),kind:k});requestDraw();renderMapListFinal();};
  window.markSpawnOnMap=(id,kind)=>window.markGlobalSpawn(kind||'player'); window.removeSpawnOnMap=(id,kind)=>window.clearGlobalSpawn(kind||'both');
  function handleSpawnClick(e){if(!window.__pendingGlobalSpawnKind||!master())return false;const rect=canvas.getBoundingClientRect();const x=Math.round((e.clientX-rect.left-offsetX)/scale),y=Math.round((e.clientY-rect.top-offsetY)/scale);const k=window.__pendingGlobalSpawnKind;window.__pendingGlobalSpawnKind=null;setGS(k,x,y);socket.emit('setGlobalSpawnV2',{room:room(),kind:k,x,y});requestDraw();renderMapListFinal();e.preventDefault?.();e.stopImmediatePropagation?.();e.stopPropagation?.();return true;}
  canvas.addEventListener('mousedown',handleSpawnClick,true); canvas.addEventListener('touchstart',e=>{if(window.__pendingGlobalSpawnKind&&e.touches&&e.touches[0])handleSpawnClick(e.touches[0]);},{capture:true,passive:false});
  function fmt(p){return p?Math.round(p.x)+','+Math.round(p.y):'não marcado'}
  function renderMapListFinal(){ensureGap();const box=document.getElementById('mapList');if(!box)return;const arr=maps();let html=`<div style="border:1px solid rgba(201,124,61,.45);border-radius:8px;padding:7px;margin:4px 0 8px;font-size:12px;background:rgba(201,124,61,.10)"><b>Spawn global</b><br><small>Jogador: ${fmt(getGS('player'))}<br>NPC: ${fmt(getGS('npc'))}</small><div class="row" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="markGlobalSpawn('player')">Marcar Jogador</button><button onclick="markGlobalSpawn('npc')">Marcar NPC</button><button onclick="clearGlobalSpawn('player')">Remover Jogador</button><button onclick="clearGlobalSpawn('npc')">Remover NPC</button></div></div>`; if(!arr.length){box.innerHTML=html+'<div style="opacity:.7;font-size:12px">Nenhum mapa salvo.</div>';return;} const a=active(); html+=arr.map(m=>`<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px"><b>${m.id===a?'✅ ':''}${m.name||'Mapa'}</b><br><small>x:${Math.round(n(m.x))} y:${Math.round(n(m.y))}</small><div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="focusMapFixed('${m.id}')">Ver</button><button onclick="setActiveMap&&setActiveMap('${m.id}')">Ativo</button><button onclick="setAdjustMapFinal('${m.id}')">Ajustar</button><button onclick="deleteMap('${m.id}')" class="danger">Del</button></div></div>`).join(''); box.innerHTML=html;}
  window.renderMapListFixed=renderMapListFinal; try{renderMapList=renderMapListFinal}catch(e){}
  window.focusMapFixed=function(id){const m=maps().find(x=>x.id===id); if(!m)return; try{activeMapId=m.id;window.activeMapId=m.id}catch(e){} offsetX=canvas.width/2-(n(m.x)+n(m.w,1000)/2)*scale; offsetY=canvas.height/2-(n(m.y)+n(m.h,700)/2)*scale; camTargetX=offsetX;camTargetY=offsetY; if(master())socket.emit('setActiveMap',{room:room(),id:m.id}); requestDraw();};
  window.setActiveMap=id=>window.focusMapFixed(id);
  let adjustId=null, mapDrag=null;
  window.setAdjustMapFinal=function(id){adjustId=adjustId===id?null:id; alert(adjustId?'Modo ajustar mapa: arraste o mapa no canvas.':'Ajuste desligado.');};
  function eventPos(ev){const r=canvas.getBoundingClientRect();return {x:(ev.clientX-r.left-offsetX)/scale,y:(ev.clientY-r.top-offsetY)/scale};}
  canvas.addEventListener('mousedown',e=>{if(!master()||!adjustId)return;const p=eventPos(e),m=maps().find(x=>x.id===adjustId);if(!m)return;if(p.x>=m.x&&p.y>=m.y&&p.x<=m.x+m.w&&p.y<=m.y+m.h){mapDrag={id:m.id,sx:p.x,sy:p.y,ox:m.x,oy:m.y};e.preventDefault();e.stopImmediatePropagation();}},true);
  canvas.addEventListener('mousemove',e=>{if(!mapDrag)return;const p=eventPos(e),nx=mapDrag.ox+(p.x-mapDrag.sx),ny=mapDrag.oy+(p.y-mapDrag.sy);const m=maps().find(x=>x.id===mapDrag.id);if(m){m.x=nx;m.y=ny;}socket.emit('moveMap',{room:room(),id:mapDrag.id,x:nx,y:ny,carry:true});requestDraw();e.preventDefault();e.stopImmediatePropagation();},true);
  canvas.addEventListener('mouseup',e=>{if(!mapDrag)return;const m=maps().find(x=>x.id===mapDrag.id);if(m)socket.emit('moveMap',{room:room(),id:m.id,x:m.x,y:m.y,carry:true});mapDrag=null;e.preventDefault();e.stopImmediatePropagation();},true);
  window.deleteMap=function(id){if(!master())return; if(!confirm('Apagar mapa selecionado?'))return; socket.emit('deleteMap',{room:room(),id});};
  function readImage(fileOrUrl,cb){ if(typeof fileOrUrl==='string'){const img=new Image();img.crossOrigin='anonymous';img.onload=()=>cb(fileOrUrl,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>cb(fileOrUrl,1000,700);img.src=fileOrUrl;return;} const fr=new FileReader();fr.onload=e=>{const data=e.target.result;const img=new Image();img.onload=()=>cb(data,img.naturalWidth||1000,img.naturalHeight||700);img.onerror=()=>cb(data,1000,700);img.src=data};fr.readAsDataURL(fileOrUrl);}
  window.loadMap=function(){if(!master())return;const url=(document.getElementById('mapUrl')?.value||'').trim();const file=document.getElementById('mapFile')?.files?.[0];const send=(src,w,h)=>socket.emit('setMap',{room:room(),mapData:src,mapW:w,mapH:h,name:'Mapa Principal',gap:gap()}); if(file)return readImage(file,send); if(url)return readImage(url,send); alert('Escolha imagem ou URL.');};
  window.addMapFromMaster=function(){if(!master())return;ensureGap();const name=(document.getElementById('newMapName')?.value||('Mapa '+(maps().length+1))).trim();const url=(document.getElementById('newMapUrl')?.value||'').trim();const file=document.getElementById('newMapFile')?.files?.[0];const side=(document.getElementById('mapSide')?.value||'right');const send=(src,w,h)=>socket.emit('addMap',{room:room(),map:{name,src,w,h},side,refMapId:active(),gap:gap()}); if(file)return readImage(file,send); if(url)return readImage(url,send); alert('Escolha imagem ou URL.');};
  window.importFullMapClick=function(){if(!master())return;const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.onchange=()=>{const f=input.files&&input.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{socket.emit('importFullState',{room:room(),state:JSON.parse(e.target.result)});}catch(err){alert('Arquivo inválido: '+err.message)}};r.readAsText(f)};input.click();};
  window.exportFullMap=function(){const state={version:20,savedAt:new Date().toISOString(),players:players||[],walls:walls||[],doors:doors||[],maps:maps(),activeMapId:active(),spawnMapId:(typeof spawnMapId!=='undefined'?spawnMapId:null),mapData:mapData||null,mapW:mapWidth||0,mapH:mapHeight||0,fog:!!fogEnabled,globalLight:Number(globalLight||0)||0,globalSpawns:{player:getGS('player'),npc:getGS('npc')}};const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='taverna-vtt-cena-completa.json';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);};
  socket.on('mapsUpdated',d=>{if(!d)return;receiveSpawns(d);setMaps(d.maps||[],d.activeMapId,d.spawnMapId);});
  socket.on('state',s=>{if(!s)return;receiveSpawns(s);if(Array.isArray(s.maps))setMaps(s.maps,s.activeMapId,s.spawnMapId);});
  socket.on('zoomUpdated',d=>{if(me&&me.isMaster)return;const z=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,Number(d.zoom)||scale||1));scale=z;offsetX=n(d.offsetX,offsetX);offsetY=n(d.offsetY,offsetY);camTargetX=offsetX;camTargetY=offsetY;requestDraw();});
  canvas.addEventListener('wheel',e=>{if(!master())return;e.preventDefault();e.stopImmediatePropagation();const rect=canvas.getBoundingClientRect();const mx=e.clientX-rect.left,my=e.clientY-rect.top,bx=(mx-offsetX)/scale,by=(my-offsetY)/scale;scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,scale*(e.deltaY<0?1.12:.88)));offsetX=mx-bx*scale;offsetY=my-by*scale;camTargetX=offsetX;camTargetY=offsetY;emitZoomThrottled(true);requestDraw();},{capture:true,passive:false});
  function drawStanding(img,p){const grid=50,w=n(p.spriteW||p.standW,grid*.9),h=n(p.spriteH||p.standH,grid*1.65),face=p.facing===-1?-1:1;ctx.save();ctx.beginPath();ctx.ellipse(p.x,p.y,w*.38,8,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.48)';ctx.fill();if(p.id===selectedId){ctx.beginPath();ctx.ellipse(p.x,p.y,w*.52,12,0,0,Math.PI*2);ctx.strokeStyle='rgba(255,210,80,.95)';ctx.lineWidth=3/scale;ctx.stroke();}ctx.translate(p.x,p.y);ctx.scale(face,1);if(img&&img.complete)ctx.drawImage(img,-w/2,-h,w,h);else{ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';ctx.fillRect(-w/2,-h,w,h)}ctx.restore();}
  function drawHpName(p){const hp=n(p.hp,0),max=Math.max(1,n(p.maxHp||p.hp,1)),pct=Math.max(0,Math.min(1,hp/max)),w=44,h=5,y=p.y-92;ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(p.x-w/2,y,w,h);ctx.fillStyle=pct>.5?'#2ecc71':(pct>.25?'#f1c40f':'#e74c3c');ctx.fillRect(p.x-w/2,y,w*pct,h);ctx.strokeStyle='rgba(0,0,0,.8)';ctx.lineWidth=1/scale;ctx.strokeRect(p.x-w/2,y,w,h);ctx.fillStyle='white';ctx.font=`${12/scale}px Arial`;ctx.textAlign='center';ctx.fillText(p.name||'Token',p.x,y-6);ctx.textAlign='left';}
  window.draw=function(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);const grid=50,left=(-offsetX/scale)-100,top=(-offsetY/scale)-100,right=left+canvas.width/scale+200,bottom=top+canvas.height/scale+200;ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke()}for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke()}for(const m of maps()){const img=mapCache2[m.id];if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,m.x,m.y,m.w,m.h);else{ctx.fillStyle='rgba(70,70,80,.45)';ctx.fillRect(m.x,m.y,m.w,m.h)}ctx.strokeStyle=m.id===active()?'rgba(255,210,80,.95)':'rgba(255,255,255,.2)';ctx.lineWidth=(m.id===active()?4:1.5)/scale;ctx.strokeRect(m.x,m.y,m.w,m.h);ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(m.x+8,m.y+8,Math.max(140,(m.name||'Mapa').length*8),26);ctx.fillStyle='white';ctx.font=`${13/scale}px Arial`;ctx.fillText(m.name||'Mapa',m.x+14,m.y+26)}ctx.lineCap='round';ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;for(const w of (walls||[])){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke()}ctx.lineWidth=6/scale;for(const d of (doors||[])){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#2ecc71':'#ff3030';ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke()}for(const p of (players||[])){if(!p)continue;const img=p.img?tokenImages[p.id]:null;if(p.tokenStyle==='topdown'){const r=tokenRadius(p);ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();if(img&&img.complete)ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);else{ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';ctx.fillRect(p.x-r,p.y-r,r*2,r*2)}ctx.restore();}else drawStanding(img,p);drawHpName(p)}const gp=getGS('player'),gn=getGS('npc');if(master()){if(gp){ctx.fillStyle='rgba(0,0,0,.72)';ctx.strokeStyle='rgba(80,255,140,1)';ctx.lineWidth=3/scale;ctx.beginPath();ctx.arc(gp.x,gp.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.font=`${20/scale}px Arial`;ctx.textAlign='center';ctx.fillText('🧍',gp.x,gp.y+7)}if(gn){ctx.fillStyle='rgba(0,0,0,.72)';ctx.strokeStyle='rgba(255,90,90,1)';ctx.lineWidth=3/scale;ctx.beginPath();ctx.arc(gn.x,gn.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.font=`${20/scale}px Arial`;ctx.textAlign='center';ctx.fillText('👹',gn.x,gn.y+7);ctx.textAlign='left'}}ctx.restore();};
  ensureGap();setTimeout(()=>{renderMapListFinal();requestDraw();},500);
})();

// ===== PATCH: PAINEL TOKEN DEMEO/TOPDOWN + DIREÇÃO =====
(function(){
  function current(){try{return currentEditableToken&&currentEditableToken()}catch(e){return null}}
  function room(){return me&&me.room?me.room:'mesa1'}
  function ensureTokenStyleButtons(){
    const panel=document.getElementById('tokenImagePanel'); if(!panel||document.getElementById('tokenStyleDemeo'))return;
    const div=document.createElement('div');div.className='section';div.innerHTML='<label>Estilo do token</label><div class="row"><button id="tokenStyleDemeo" onclick="setTokenVisualStyle(\'standee\')">Miniatura em pé</button><button onclick="setTokenVisualStyle(\'topdown\')">Top-down</button></div><div class="row"><input id="spriteW" type="number" placeholder="Largura"><input id="spriteH" type="number" placeholder="Altura"></div><button onclick="saveTokenVisualSize()">Salvar tamanho</button>';panel.appendChild(div);
  }
  window.setTokenVisualStyle=function(style){const p=current();if(!p)return alert('Selecione seu token.');p.tokenStyle=style==='topdown'?'topdown':'standee';socket.emit('updateToken',{room:room(),token:{id:p.id,tokenStyle:p.tokenStyle}});requestDraw();};
  window.saveTokenVisualSize=function(){const p=current();if(!p)return;const w=Number(document.getElementById('spriteW')?.value)||p.spriteW||45;const h=Number(document.getElementById('spriteH')?.value)||p.spriteH||82;p.spriteW=w;p.spriteH=h;socket.emit('updateToken',{room:room(),token:{id:p.id,spriteW:w,spriteH:h,standW:w,standH:h}});requestDraw();};
  const oldSync=window.syncTokenPanel||syncTokenPanel; window.syncTokenPanel=function(){try{oldSync&&oldSync()}catch(e){} ensureTokenStyleButtons(); const p=current(); if(p){const w=document.getElementById('spriteW'),h=document.getElementById('spriteH'); if(w)w.value=p.spriteW||p.standW||45;if(h)h.value=p.spriteH||p.standH||82;}}; try{syncTokenPanel=window.syncTokenPanel}catch(e){}
  const oldSmooth=window.smoothTokenMove||smoothTokenMove; window.smoothTokenMove=function(p,x,y){if(p){const dx=Number(x)-Number(p.x||0);if(Math.abs(dx)>2)p.facing=dx>=0?1:-1;}return oldSmooth?oldSmooth(p,x,y):undefined;}; try{smoothTokenMove=window.smoothTokenMove}catch(e){}
  const oldEmitNow=window.emitMoveNow||emitMoveNow; window.emitMoveNow=function(p){if(p)socket.emit('updateToken',{room:room(),token:{id:p.id,facing:p.facing||1,tokenStyle:p.tokenStyle||'standee'}});return oldEmitNow?oldEmitNow(p):undefined;}; try{emitMoveNow=window.emitMoveNow}catch(e){}
  setTimeout(ensureTokenStyleButtons,700);
})();


// ===== PATCH FINAL: MINIATURA EM PÉ + PORTAS + ZOOM + FOTO SEM TRAVAR =====
(function(){
  if(window.__TAVERNA_FINAL_MINIATURA_PORTAS_ZOOM__) return;
  window.__TAVERNA_FINAL_MINIATURA_PORTAS_ZOOM__ = true;

  const MIN_ZOOM_FINAL = 0.03;
  const MAX_ZOOM_FINAL = 24;

  function n(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function isMaster(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function playerList(){ try{return Array.isArray(players)?players:[];}catch(e){return [];} }
  function doorList(){ try{return Array.isArray(doors)?doors:[];}catch(e){return [];} }
  function wallList(){ try{return Array.isArray(walls)?walls:[];}catch(e){return [];} }

  // ----------------------------
  // ZOOM MAIOR E ESTÁVEL
  // ----------------------------
  window.MIN_ZOOM = MIN_ZOOM_FINAL;
  window.MAX_ZOOM = MAX_ZOOM_FINAL;

  const oldEmitZoom = typeof emitZoomThrottled === 'function' ? emitZoomThrottled : null;
  window.emitZoomThrottled = function(force=false){
    try{ scale = Math.max(MIN_ZOOM_FINAL, Math.min(MAX_ZOOM_FINAL, n(scale,1))); }catch(e){}
    if(oldEmitZoom) return oldEmitZoom(force);
    try{ if(me&&me.isMaster) socket.emit('setZoom',{room:me.room,zoom:scale,offsetX,offsetY}); }catch(e){}
  };
  try{ emitZoomThrottled = window.emitZoomThrottled; }catch(e){}

  // Recebe zoom do mestre sem clamp antigo 3x/8x
  try{
    socket.on('zoomUpdated', function(d){
      if(me && me.isMaster) return;
      const oldScale = scale || 1;
      const newScale = Math.max(MIN_ZOOM_FINAL, Math.min(MAX_ZOOM_FINAL, Number(d&&d.zoom)||oldScale));
      const centerX = (canvas.width/2 - offsetX) / oldScale;
      const centerY = (canvas.height/2 - offsetY) / oldScale;
      scale = newScale;
      offsetX = canvas.width/2 - centerX * scale;
      offsetY = canvas.height/2 - centerY * scale;
      camTargetX = offsetX; camTargetY = offsetY;
      requestDraw && requestDraw();
    });
  }catch(e){}

  // Intercepta wheel com limite maior
  try{
    canvas.addEventListener('wheel', function(e){
      if(!me || !me.isMaster) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const beforeX=(mx-offsetX)/scale, beforeY=(my-offsetY)/scale;
      const factor=e.deltaY<0?1.12:0.88;
      scale=Math.max(MIN_ZOOM_FINAL,Math.min(MAX_ZOOM_FINAL,scale*factor));
      offsetX=mx-beforeX*scale; offsetY=my-beforeY*scale;
      camTargetX=offsetX; camTargetY=offsetY;
      emitZoomThrottled(true);
      requestDraw&&requestDraw();
    }, {capture:true, passive:false});
  }catch(e){}

  // ----------------------------
  // TOKEN COMEÇA TOP-DOWN
  // ----------------------------
  function ensureTokenDefaults(p){
    if(!p) return p;
    if(!p.tokenStyle) p.tokenStyle = 'topdown';
    if(p.facing !== -1) p.facing = 1;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW = 44;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH = 82;
    return p;
  }
  playerList().forEach(ensureTokenDefaults);

  const oldUpdateOrAdd = typeof updateOrAddPlayer === 'function' ? updateOrAddPlayer : null;
  window.updateOrAddPlayer = function(p){
    ensureTokenDefaults(p);
    if(oldUpdateOrAdd) return oldUpdateOrAdd(p);
  };
  try{ updateOrAddPlayer = window.updateOrAddPlayer; }catch(e){}

  try{
    socket.on('playerAdded',p=>ensureTokenDefaults(p));
    socket.on('npcAdded',p=>ensureTokenDefaults(p));
    socket.on('playerUpdated',p=>ensureTokenDefaults(p));
    socket.on('playerMoved',p=>ensureTokenDefaults(p));
    socket.on('state',s=>{
      if(s&&Array.isArray(s.players)) s.players.forEach(ensureTokenDefaults);
    });
  }catch(e){}

  // ----------------------------
  // FOTO DO TOKEN SEM TRAVAR
  // ----------------------------
  window.safeLoadTokenImage = function(id, src){
    if(!id) return;
    if(!src){ tokenImages[id]=null; requestDraw&&requestDraw(); return; }
    const im = new Image();
    im.decoding = 'async';
    im.loading = 'eager';
    im.onload = ()=>{ tokenImages[id]=im; requestDraw&&requestDraw(); };
    im.onerror = ()=>{ tokenImages[id]=null; requestDraw&&requestDraw(); };
    // evita travar ao reusar dataURL gigante repetido
    setTimeout(()=>{ try{ im.src = src; }catch(e){ tokenImages[id]=null; } },0);
  };

  const oldApplyTokenImageToPlayer = typeof applyTokenImageToPlayer === 'function' ? applyTokenImageToPlayer : null;
  window.applyTokenImageToPlayer = function(p,img){
    if(!p) return;
    try{ if(typeof canEditToken==='function' && !canEditToken(p)) return; }catch(e){}
    ensureTokenDefaults(p);
    p.img = img || '';
    safeLoadTokenImage(p.id, p.img);
    try{ socket.emit('updatePlayer',{room:room(),id:p.id,img:p.img,tokenStyle:p.tokenStyle||'topdown',spriteW:p.spriteW||44,spriteH:p.spriteH||82,facing:p.facing||1}); }catch(e){}
    requestDraw&&requestDraw();
  };
  try{ applyTokenImageToPlayer = window.applyTokenImageToPlayer; }catch(e){}

  // ----------------------------
  // PAINEL: BOTÃO TOP-DOWN / MINIATURA EM PÉ
  // ----------------------------
  function currentToken(){
    try{
      if(typeof currentEditableToken==='function') return currentEditableToken();
      if(selectedId) return playerList().find(p=>p.id===selectedId)||null;
    }catch(e){}
    return null;
  }

  window.toggleTokenStyle = function(){
    const p = currentToken();
    if(!p) return alert('Selecione seu token primeiro.');
    try{ if(typeof canEditToken==='function' && !canEditToken(p)) return alert('Você só pode alterar seu próprio token.'); }catch(e){}
    ensureTokenDefaults(p);
    p.tokenStyle = p.tokenStyle === 'standee' ? 'topdown' : 'standee';
    try{ socket.emit('updatePlayer',{room:room(),id:p.id,tokenStyle:p.tokenStyle,spriteW:p.spriteW||44,spriteH:p.spriteH||82,facing:p.facing||1}); }catch(e){}
    updateStyleButton();
    requestDraw&&requestDraw();
  };

  function updateStyleButton(){
    const btn = document.getElementById('tokenStyleToggle');
    if(!btn) return;
    const p = currentToken();
    btn.style.display = p ? 'block' : 'none';
    btn.textContent = p && p.tokenStyle === 'standee' ? 'Modo: Miniatura em pé' : 'Modo: Top-down';
  }
  window.updateStyleButton = updateStyleButton;

  function ensureStyleButton(){
    let panel = document.getElementById('tokenImagePanel') || document.getElementById('tokenImageToggle')?.parentElement;
    if(!panel || document.getElementById('tokenStyleToggle')) return;
    const btn = document.createElement('button');
    btn.id='tokenStyleToggle';
    btn.type='button';
    btn.textContent='Modo: Top-down';
    btn.onclick=window.toggleTokenStyle;
    btn.style.marginTop='6px';
    panel.appendChild(btn);

    const row = document.createElement('div');
    row.id='standeeSizeControls';
    row.innerHTML = '<div style="display:flex;gap:6px;margin-top:6px"><input id="spriteWInput" type="number" placeholder="Largura" style="width:50%"><input id="spriteHInput" type="number" placeholder="Altura" style="width:50%"></div><button id="applySpriteSizeBtn" type="button" style="margin-top:6px">Aplicar tamanho miniatura</button>';
    panel.appendChild(row);
    document.getElementById('applySpriteSizeBtn').onclick=function(){
      const p=currentToken(); if(!p) return;
      p.spriteW=Math.max(20,Math.min(180,n(document.getElementById('spriteWInput').value,p.spriteW||44)));
      p.spriteH=Math.max(30,Math.min(260,n(document.getElementById('spriteHInput').value,p.spriteH||82)));
      try{ socket.emit('updatePlayer',{room:room(),id:p.id,spriteW:p.spriteW,spriteH:p.spriteH,tokenStyle:p.tokenStyle||'topdown'}); }catch(e){}
      requestDraw&&requestDraw();
    };
  }
  setTimeout(()=>{ensureStyleButton(); updateStyleButton();},500);

  const oldSyncPanel = typeof syncTokenPanel === 'function' ? syncTokenPanel : null;
  window.syncTokenPanel=function(){
    if(oldSyncPanel) oldSyncPanel();
    ensureStyleButton();
    const p=currentToken();
    if(p){
      ensureTokenDefaults(p);
      const wi=document.getElementById('spriteWInput'), hi=document.getElementById('spriteHInput');
      if(wi) wi.value = Math.round(n(p.spriteW,44));
      if(hi) hi.value = Math.round(n(p.spriteH,82));
    }
    updateStyleButton();
  };
  try{ syncTokenPanel = window.syncTokenPanel; }catch(e){}

  // ----------------------------
  // MOVIMENTO: MINIATURA EM PÉ NÃO TRAVA E VIRA NO MOVIMENTO
  // ----------------------------
  function updateFacing(p,nx,ny){
    if(!p) return;
    const dx = n(nx)-n(p.x), dy = n(ny)-n(p.y);
    if(Math.abs(dx) > Math.max(2, Math.abs(dy)*0.25)) p.facing = dx >= 0 ? 1 : -1;
  }
  window.updateTokenFacing = updateFacing;

  const oldSmoothTokenMove = typeof smoothTokenMove === 'function' ? smoothTokenMove : null;
  window.smoothTokenMove=function(p,targetX,targetY){
    ensureTokenDefaults(p);
    updateFacing(p,targetX,targetY);
    if(oldSmoothTokenMove) oldSmoothTokenMove(p,targetX,targetY);
    else { p.x=targetX; p.y=targetY; }
    if(p&&me&&me.room){
      try{ socket.emit('updatePlayer',{room:me.room,id:p.id,facing:p.facing,tokenStyle:p.tokenStyle||'topdown',spriteW:p.spriteW||44,spriteH:p.spriteH||82}); }catch(e){}
    }
  };
  try{ smoothTokenMove=window.smoothTokenMove; }catch(e){}

  // ----------------------------
  // PORTAS: TOQUE/CLIQUE NO MESTRE ABRE/FECHA E SINCRONIZA
  // ----------------------------
  function distToSeg(px,py,x1,y1,x2,y2){
    const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy;
    if(len<=0) return Math.hypot(px-x1,py-y1);
    let t=((px-x1)*dx+(py-y1)*dy)/len; t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
  }
  function canvasPos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  window.findDoorAtFinal=function(x,y){
    let best=null,bd=9999;
    for(const d of doorList()){
      const w=d&&d.wall; if(!w||!w[0]||!w[1]) continue;
      const dd=distToSeg(x,y,n(w[0][0]),n(w[0][1]),n(w[1][0]),n(w[1][1]));
      if(dd<Math.max(14,18/scale) && dd<bd){ best=d; bd=dd; }
    }
    return best;
  };
  window.tryToggleDoorAt=function(x,y){
    if(!isMaster()) return false;
    const d = window.findDoorAtFinal(x,y);
    if(!d) return false;
    d.open = !d.open;
    try{ socket.emit('toggleDoor',{room:room(),id:d.id,open:d.open}); }catch(e){}
    requestDraw&&requestDraw();
    return true;
  };

  canvas.addEventListener('dblclick',function(e){
    if(!isMaster()) return;
    const [x,y]=canvasPos(e);
    if(window.tryToggleDoorAt(x,y)){
      e.preventDefault(); e.stopImmediatePropagation();
    }
  },true);

  // ----------------------------
  // DESENHO FINAL DOS TOKENS
  // ----------------------------
  function drawNameHp(p, topY){
    const hp=n(p.hp,0), max=n(p.maxHp||p.hp||1,1);
    const barW=42, barH=5;
    ctx.save();
    ctx.textAlign='center';
    ctx.font=(11/scale)+'px Arial';
    ctx.fillStyle='rgba(0,0,0,.75)';
    ctx.fillRect(p.x-barW/2, topY-18/scale, barW, 13/scale);
    ctx.fillStyle='#fff';
    ctx.fillText(p.name||'Token',p.x,topY-8/scale);
    ctx.fillStyle='rgba(0,0,0,.75)';
    ctx.fillRect(p.x-barW/2,topY-5/scale,barW,barH/scale);
    ctx.fillStyle='#d33';
    ctx.fillRect(p.x-barW/2,topY-5/scale,barW*Math.max(0,Math.min(1,hp/max)),barH/scale);
    ctx.strokeStyle='rgba(255,255,255,.45)';
    ctx.lineWidth=1/scale;
    ctx.strokeRect(p.x-barW/2,topY-5/scale,barW,barH/scale);
    ctx.restore();
  }
  function drawStandee(img,p){
    ensureTokenDefaults(p);
    const w=n(p.spriteW,44), h=n(p.spriteH,82), facing=p.facing===-1?-1:1;
    ctx.save();
    // base/sombra
    ctx.beginPath();
    ctx.ellipse(p.x,p.y,w*.42,8,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,.50)';
    ctx.fill();

    if(p.id===selectedId){
      ctx.beginPath();
      ctx.ellipse(p.x,p.y,w*.58,12,0,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,210,80,.95)';
      ctx.lineWidth=3/scale;
      ctx.stroke();
    }

    ctx.translate(p.x,p.y);
    ctx.scale(facing,1);
    if(img) ctx.drawImage(img,-w/2,-h,w,h);
    else {
      ctx.fillStyle=p.isNpc?'#a33':'#3a6';
      ctx.fillRect(-w/2,-h,w,h);
    }
    ctx.restore();
    drawNameHp(p,p.y-h-6/scale);
  }
  function drawTopdown(img,p){
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    ctx.save();
    if(img){
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.clip();
      ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
      ctx.restore(); ctx.save();
      ctx.strokeStyle=p.id===selectedId?'rgba(255,210,80,.95)':'rgba(255,255,255,.55)';
      ctx.lineWidth=(p.id===selectedId?3:2)/scale;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
    }else{
      ctx.fillStyle=p.isNpc?'#a33':'#3a6';
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.7)'; ctx.lineWidth=2/scale; ctx.stroke();
    }
    ctx.restore();
    drawNameHp(p,p.y-r-8/scale);
  }

  window.drawTokenFinal=function(p){
    ensureTokenDefaults(p);
    let img=null;
    try{ img=tokenImages[p.id]||null; }catch(e){}
    if(p.img && !img) safeLoadTokenImage(p.id,p.img);
    if(p.tokenStyle==='standee') drawStandee(img,p);
    else drawTopdown(img,p);
  };

  // Substitui funções comuns quando existirem
  window.drawOneToken = window.drawTokenFinal;
  try{ drawOneToken = window.drawTokenFinal; }catch(e){}
  window.drawSingleToken = window.drawTokenFinal;
  try{ drawSingleToken = window.drawTokenFinal; }catch(e){}

  const oldDraw = typeof draw === 'function' ? draw : null;
  if(oldDraw){
    window.draw=function(){
      // Deixa o desenho antigo cuidar de mapa/grid/parede/porta/fog.
      oldDraw();
      // Em muitas versões antigas o token já foi desenhado, mas aqui redesenhamos a camada final por cima.
      try{
        ctx.save(); ctx.translate(offsetX,offsetY); ctx.scale(scale,scale);
        for(const p of playerList()) window.drawTokenFinal(p);
        ctx.restore();
      }catch(e){}
    };
    try{ draw=window.draw; }catch(e){}
  }

  console.log('Patch final miniatura/portas/zoom carregado.');
})();


// ===== PATCH DEFINITIVO: IMPORTAÇÃO MAPA + TOKEN SEM DUPLICAR + TOP-DOWN PADRÃO =====
(function(){
  if(window.__TAVERNA_IMPORT_TOKEN_CLEAN_FINAL__) return;
  window.__TAVERNA_IMPORT_TOKEN_CLEAN_FINAL__ = true;

  function n(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function isMaster(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function arr(v){ return Array.isArray(v)?v:[]; }
  function playersSafe(){ try{return arr(players);}catch(e){return [];} }
  function mapsSafe(){ try{return arr(campaignMaps);}catch(e){return arr(window.campaignMaps);} }
  function wallsSafe(){ try{return arr(walls);}catch(e){return [];} }
  function doorsSafe(){ try{return arr(doors);}catch(e){return [];} }

  function ensureToken(p){
    if(!p)return p;
    // Padrão agora sempre é TOP-DOWN, só muda para standee se o usuário escolher.
    if(p.tokenStyle !== 'standee') p.tokenStyle = 'topdown';
    if(p.facing !== -1) p.facing = 1;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW=44;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH=82;
    return p;
  }
  window.ensureTokenTopdownDefault = ensureToken;
  playersSafe().forEach(ensureToken);

  // ----------------------------
  // IMPORTAÇÃO FINAL DE CENA/MAPAS
  // Usa importFullState no servidor e remove listeners antigos clonando o input.
  // ----------------------------
  window.importFullMapClick = function(){
    if(!isMaster()) return alert('Só o Mestre pode importar.');
    let input = document.getElementById('saveMapFile');
    if(!input){
      input=document.createElement('input');
      input.type='file'; input.id='saveMapFile'; input.accept='application/json,.json'; input.style.display='none';
      document.body.appendChild(input);
    }else{
      const clone=input.cloneNode(true);
      input.parentNode.replaceChild(clone,input);
      input=clone;
    }
    input.onchange=function(e){
      const file=e.target.files && e.target.files[0];
      if(!file)return;
      const reader=new FileReader();
      reader.onload=function(ev){
        try{
          const state=JSON.parse(ev.target.result);
          if(Array.isArray(state.players)) state.players.forEach(ensureToken);
          if(Array.isArray(state.npcs)){
            state.players = (state.players||[]).concat(state.npcs.map(npc=>Object.assign({},npc,{isNpc:true,tokenStyle:npc.tokenStyle||'topdown'})));
          }
          // Envia para servidor reconstruir mapas de campanha corretamente.
          socket.emit('importFullState',{
            room:room(),
            state,
            merge:false,
            side:(document.getElementById('mapSide')&&document.getElementById('mapSide').value)||'right',
            refMapId:(window.activeMapId||null),
            gap:Number((document.getElementById('mapGap')||{}).value)||160
          });
        }catch(err){
          alert('Erro ao importar mapa/cena: '+err.message);
        }
        e.target.value='';
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ----------------------------
  // Exportação final de cena
  // ----------------------------
  window.exportFullMap = function(){
    if(!isMaster()) return alert('Só o Mestre pode salvar.');
    const state={
      version:20,
      savedAt:new Date().toISOString(),
      maps:mapsSafe().map(m=>Object.assign({},m)),
      activeMapId:window.activeMapId||null,
      spawnMapId:null,
      mapData:typeof mapData!=='undefined'?mapData:null,
      mapW:typeof mapWidth!=='undefined'?mapWidth:0,
      mapH:typeof mapHeight!=='undefined'?mapHeight:0,
      walls:wallsSafe().map(w=>JSON.parse(JSON.stringify(w))),
      doors:doorsSafe().map(d=>JSON.parse(JSON.stringify(d))),
      players:playersSafe().map(p=>{
        const c=Object.assign({},p);
        ensureToken(c);
        return c;
      }),
      fog:!!(typeof fogEnabled!=='undefined'&&fogEnabled),
      globalLight:n(typeof globalLight!=='undefined'?globalLight:0),
      globalSpawns:window.globalSpawns||{}
    };
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='taverna-cena-completa-final-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
  };

  // ----------------------------
  // Estado recebido: normaliza mapas e tokens
  // ----------------------------
  try{
    socket.on('state',function(s){
      if(!s)return;
      if(Array.isArray(s.players)) s.players.forEach(ensureToken);
      if(Array.isArray(s.maps)){
        try{ campaignMaps=s.maps; }catch(e){ window.campaignMaps=s.maps; }
      }
      if(s.activeMapId!==undefined){ try{activeMapId=s.activeMapId||null;}catch(e){window.activeMapId=s.activeMapId||null;} }
      setTimeout(()=>{ requestDraw&&requestDraw(); },20);
    });
    socket.on('mapsUpdated',function(d){
      if(!d)return;
      if(Array.isArray(d.maps)){ try{campaignMaps=d.maps;}catch(e){window.campaignMaps=d.maps;} }
      if(d.activeMapId!==undefined){ try{activeMapId=d.activeMapId||null;}catch(e){window.activeMapId=d.activeMapId||null;} }
      setTimeout(()=>{ requestDraw&&requestDraw(); if(window.renderMapListFixed)window.renderMapListFixed(); },20);
    });
    socket.on('playerAdded',ensureToken);
    socket.on('npcAdded',ensureToken);
    socket.on('playerUpdated',ensureToken);
    socket.on('playerMoved',ensureToken);
  }catch(e){}

  // ----------------------------
  // Imagens de token sem travar
  // ----------------------------
  window.safeLoadTokenImage=function(id,src){
    if(!id)return;
    if(!src){ tokenImages[id]=null; return requestDraw&&requestDraw(); }
    if(tokenImages[id] && tokenImages[id].__src===src)return;
    const im=new Image();
    im.__src=src;
    im.onload=()=>{tokenImages[id]=im;requestDraw&&requestDraw();};
    im.onerror=()=>{tokenImages[id]=null;requestDraw&&requestDraw();};
    setTimeout(()=>{try{im.src=src;}catch(e){}},0);
  };

  const oldApply = typeof applyTokenImageToPlayer==='function'?applyTokenImageToPlayer:null;
  window.applyTokenImageToPlayer=function(p,img){
    if(!p)return;
    try{ if(typeof canEditToken==='function' && !canEditToken(p))return; }catch(e){}
    ensureToken(p);
    p.img=img||'';
    // Não muda para miniatura sozinho ao colocar foto.
    p.tokenStyle = p.tokenStyle==='standee' ? 'standee' : 'topdown';
    safeLoadTokenImage(p.id,p.img);
    try{socket.emit('updatePlayer',{room:room(),id:p.id,img:p.img,tokenStyle:p.tokenStyle,facing:p.facing||1,spriteW:p.spriteW||44,spriteH:p.spriteH||82});}catch(e){}
    requestDraw&&requestDraw();
  };
  try{applyTokenImageToPlayer=window.applyTokenImageToPlayer;}catch(e){}

  // ----------------------------
  // Renderizador LIMPO: não chama draw antigo, então token não duplica.
  // ----------------------------
  const mapImgs={};
  function getMapImg(m){
    if(!m||!m.src)return null;
    if(mapImgs[m.id] && mapImgs[m.id].__src===m.src)return mapImgs[m.id];
    const im=new Image();
    im.__src=m.src;
    im.onload=()=>requestDraw&&requestDraw();
    im.src=m.src;
    mapImgs[m.id]=im;
    return im;
  }
  function drawGrid(){
    const grid=50;
    const left=(-offsetX/scale)-100, top=(-offsetY/scale)-100;
    const right=left+canvas.width/scale+200, bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';
    ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMaps(){
    const maps=mapsSafe();
    if(maps.length){
      for(const m of maps){
        const x=n(m.x),y=n(m.y),w=n(m.w,1000),h=n(m.h,700);
        const im=getMapImg(m);
        if(im&&im.complete&&im.naturalWidth>0){try{ctx.drawImage(im,x,y,w,h);}catch(e){}}
        else {ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect(x,y,w,h);}
        if(isMaster()){
          ctx.strokeStyle=(String(m.id)===String(window.activeMapId||activeMapId))?'rgba(255,210,80,.35)':'rgba(255,255,255,.08)';
          ctx.lineWidth=1/scale; ctx.strokeRect(x,y,w,h);
          ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(x+8,y+8,140,22);
          ctx.fillStyle='#fff'; ctx.font=(12/scale)+'px Arial'; ctx.fillText(m.name||'Mapa',x+14,y+24);
        }
      }
    }else if(mapImg&&mapData){
      try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}catch(e){}
    }
  }
  function drawWallsDoors(){
    if(!isMaster())return;
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle='#c97c3d'; ctx.lineWidth=3/scale;
    for(const w of wallsSafe()){
      if(!w||!w[0]||!w[1])continue;
      ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();
    }
    for(const d of doorsSafe()){
      const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;
      ctx.strokeStyle=d.open?'#22cc66':'#ff3333';
      ctx.lineWidth=7/scale;
      ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();
    }
    ctx.restore();
  }
  function drawNameHp(p,topY){
    const hp=n(p.hp,0), max=Math.max(1,n(p.maxHp||p.hp,1));
    const bw=42,bh=5;
    ctx.save();ctx.textAlign='center';ctx.font=(11/scale)+'px Arial';
    ctx.fillStyle='rgba(0,0,0,.70)';ctx.fillRect(p.x-bw/2,topY-18/scale,bw,13/scale);
    ctx.fillStyle='#fff';ctx.fillText(p.name||'Token',p.x,topY-8/scale);
    ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(p.x-bw/2,topY-5/scale,bw,bh/scale);
    ctx.fillStyle='#d33';ctx.fillRect(p.x-bw/2,topY-5/scale,bw*Math.max(0,Math.min(1,hp/max)),bh/scale);
    ctx.restore();
  }
  function drawTopdown(p,img){
    const r=typeof tokenRadius==='function'?tokenRadius(p):16;
    ctx.save();
    if(img&&img.complete&&img.naturalWidth>0){
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();
      ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);
      ctx.restore();ctx.save();
    }else{
      ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle=p.id===selectedId?'rgba(255,210,80,.95)':'rgba(255,255,255,.55)';
    ctx.lineWidth=(p.id===selectedId?3:2)/scale;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
    ctx.restore();drawNameHp(p,p.y-r-8/scale);
  }
  function drawStandee(p,img){
    const w=n(p.spriteW,44),h=n(p.spriteH,82),f=p.facing===-1?-1:1;
    ctx.save();ctx.beginPath();ctx.ellipse(p.x,p.y,w*.42,8,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.50)';ctx.fill();
    if(p.id===selectedId){ctx.beginPath();ctx.ellipse(p.x,p.y,w*.58,12,0,0,Math.PI*2);ctx.strokeStyle='rgba(255,210,80,.95)';ctx.lineWidth=3/scale;ctx.stroke();}
    ctx.translate(p.x,p.y);ctx.scale(f,1);
    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-w/2,-h,w,h);
    else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fillRect(-w/2,-h,w,h);}
    ctx.restore();drawNameHp(p,p.y-h-6/scale);
  }
  function drawTokens(){
    for(const p of playersSafe()){
      ensureToken(p);
      let img=null;try{img=tokenImages[p.id]||null;}catch(e){}
      if(p.img&&!img)safeLoadTokenImage(p.id,p.img);
      if(p.tokenStyle==='standee')drawStandee(p,img);
      else drawTopdown(p,img);
    }
  }
  function drawRulerFinal(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b)return;
    const a=rr.a,b=rr.b,px=Math.hypot(b[0]-a[0],b[1]-a[1]),ft=px/10,meters=ft*.3048;
    ctx.save();ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    const tx=(a[0]+b[0])/2,ty=(a[1]+b[1])/2;
    ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);
    ctx.fillStyle='#00e5ff';ctx.font=(14/scale)+'px Arial';ctx.fillText(ft.toFixed(ft<10?1:0)+' ft / '+meters.toFixed(1)+' m',tx+10/scale,ty-7/scale);
    ctx.restore();
  }

  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGrid();drawMaps();drawWallsDoors();drawTokens();drawRulerFinal();
    ctx.restore();
  };
  try{draw=window.draw;}catch(e){}
  console.log('Patch definitivo import/token topdown render limpo carregado.');
})();


// ===== REVISÃO GERAL FINAL: MAPAS/SPAWN/FOG/SYNC/TOKENS =====
(function(){
  if(window.__TAVERNA_REVISAO_GERAL_FINAL__) return;
  window.__TAVERNA_REVISAO_GERAL_FINAL__ = true;

  function n(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function isMaster(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function A(v){ return Array.isArray(v)?v:[]; }
  function P(){ try{return A(players);}catch(e){return [];} }
  function W(){ try{return A(walls);}catch(e){return [];} }
  function D(){ try{return A(doors);}catch(e){return [];} }
  function M(){ try{return A(campaignMaps);}catch(e){return A(window.campaignMaps);} }
  function activeId(){ try{return activeMapId||window.activeMapId||null;}catch(e){return window.activeMapId||null;} }

  // -------------------------
  // TOKENS: default top-down, sync e facing corrigido
  // -------------------------
  function normalizeToken(p){
    if(!p)return p;
    if(p.tokenStyle!=='standee') p.tokenStyle='topdown';
    if(p.facing!==-1) p.facing=1;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW=44;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH=82;
    return p;
  }
  window.normalizeTokenFinal = normalizeToken;

  function canSeeToken(p){
    if(!p)return false;
    if(isMaster())return true;
    // jogador não vê NPC fora da luz/névoa? Por enquanto vê token, mas não vê vida.
    return true;
  }

  // Correção: antes estava virando invertido. Agora se anda para direita, facing=-1 se a arte original olha para esquerda.
  // Na prática visual do sprite em pé comum: inverter quando anda para direita.
  function updateFacingFixed(p,nx,ny){
    if(!p)return;
    const dx=n(nx)-n(p.x), dy=n(ny)-n(p.y);
    if(Math.abs(dx)>Math.max(2,Math.abs(dy)*0.25)){
      p.facing = dx>=0 ? -1 : 1;
    }
  }
  window.updateTokenFacing = updateFacingFixed;

  // Sync forte de movimentação
  window.emitMoveNow=function(p){
    if(!p||!me||!me.room)return;
    normalizeToken(p);
    try{socket.emit('move',{room:me.room,id:p.id,x:Math.round(n(p.x)),y:Math.round(n(p.y)),mapId:p.mapId||activeId(),facing:p.facing||1,tokenStyle:p.tokenStyle||'topdown',seq:Date.now()});}catch(e){}
  };
  window.emitMoveThrottled=function(p){
    if(!p||!me||!me.room)return;
    const now=Date.now();
    if(window.__lastMoveEmitFinal&&now-window.__lastMoveEmitFinal<35)return;
    window.__lastMoveEmitFinal=now;
    window.emitMoveNow(p);
  };
  try{emitMoveNow=window.emitMoveNow; emitMoveThrottled=window.emitMoveThrottled;}catch(e){}

  // -------------------------
  // MAPAS: importação deve ADICIONAR se for mapa único; só substitui cena completa
  // -------------------------
  window.importFullMapClick=function(){
    if(!isMaster())return alert('Só o Mestre pode importar.');
    let input=document.getElementById('saveMapFile');
    if(!input){
      input=document.createElement('input'); input.type='file'; input.id='saveMapFile'; input.accept='application/json,.json'; input.style.display='none'; document.body.appendChild(input);
    }else{
      const clone=input.cloneNode(true); input.parentNode.replaceChild(clone,input); input=clone;
    }
    input.onchange=function(e){
      const file=e.target.files&&e.target.files[0]; if(!file)return;
      const reader=new FileReader();
      reader.onload=function(ev){
        try{
          const state=JSON.parse(ev.target.result);
          if(Array.isArray(state.players)) state.players.forEach(normalizeToken);
          const hasManyMaps = Array.isArray(state.maps)&&state.maps.length>1;
          const hasCampaignScene = hasManyMaps || state.version>=20 || state.spawnMode || Array.isArray(state.players);
          // Se for 1 mapa/arquivo legado: adiciona como mapa novo, não substitui a campanha.
          // Se for cena completa: substitui cena, preservando posições.
          socket.emit('importFullState',{
            room:room(),
            state,
            merge:!hasCampaignScene,
            side:(document.getElementById('mapSide')&&document.getElementById('mapSide').value)||'right',
            refMapId:activeId(),
            gap:Number((document.getElementById('mapGap')||{}).value)||180
          });
        }catch(err){ alert('Erro ao importar: '+err.message); }
        e.target.value='';
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // -------------------------
  // SPAWN VISÍVEL PARA O MESTRE
  // -------------------------
  window.globalSpawns = window.globalSpawns || {};
  function setSpawn(kind,x,y){
    kind=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    if(Number.isFinite(Number(x))&&Number.isFinite(Number(y))) window.globalSpawns[kind]={x:Number(x),y:Number(y)};
    else delete window.globalSpawns[kind];
  }
  function getSpawn(kind){
    const p=(window.globalSpawns||{})[kind]; 
    return p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))?{x:Number(p.x),y:Number(p.y)}:null;
  }
  function receiveSpawns(d){
    if(!d)return;
    if(d.globalSpawns){
      if('player' in d.globalSpawns){ const p=d.globalSpawns.player; p?setSpawn('player',p.x,p.y):setSpawn('player',null,null); }
      if('npc' in d.globalSpawns){ const p=d.globalSpawns.npc; p?setSpawn('npc',p.x,p.y):setSpawn('npc',null,null); }
    }
    if(d.globalSpawnPlayerX!==undefined||d.universalPlayerSpawnX!==undefined){
      const x=d.globalSpawnPlayerX??d.universalPlayerSpawnX, y=d.globalSpawnPlayerY??d.universalPlayerSpawnY;
      if(Number.isFinite(Number(x))&&Number.isFinite(Number(y)))setSpawn('player',x,y);
    }
    if(d.globalSpawnNpcX!==undefined||d.universalNpcSpawnX!==undefined){
      const x=d.globalSpawnNpcX??d.universalNpcSpawnX, y=d.globalSpawnNpcY??d.universalNpcSpawnY;
      if(Number.isFinite(Number(x))&&Number.isFinite(Number(y)))setSpawn('npc',x,y);
    }
  }
  window.markGlobalSpawn=function(kind){
    if(!isMaster())return alert('Só o Mestre pode marcar spawn.');
    window.__pendingSpawnFinal=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    alert('Clique/toque no mapa onde vai ser o spawn global de '+(window.__pendingSpawnFinal==='npc'?'NPC':'jogador'));
  };
  window.clearGlobalSpawn=function(kind){
    if(!isMaster())return;
    const k=String(kind||'both').toLowerCase();
    if(k==='player'||k==='both')setSpawn('player',null,null);
    if(k==='npc'||k==='both')setSpawn('npc',null,null);
    socket.emit('clearGlobalSpawnV2',{room:room(),kind:k});
    requestDraw&&requestDraw(); window.renderMapListFixed&&window.renderMapListFixed();
  };
  function clickSpawn(ev){
    if(!window.__pendingSpawnFinal||!isMaster())return false;
    const r=canvas.getBoundingClientRect();
    const x=Math.round((ev.clientX-r.left-offsetX)/scale), y=Math.round((ev.clientY-r.top-offsetY)/scale);
    const k=window.__pendingSpawnFinal; window.__pendingSpawnFinal=null;
    setSpawn(k,x,y);
    socket.emit('setGlobalSpawnV2',{room:room(),kind:k,x,y});
    ev.preventDefault&&ev.preventDefault(); ev.stopPropagation&&ev.stopPropagation(); ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw(); window.renderMapListFixed&&window.renderMapListFixed();
    return true;
  }
  try{
    canvas.addEventListener('mousedown',clickSpawn,true);
    canvas.addEventListener('touchstart',e=>{if(window.__pendingSpawnFinal&&e.touches&&e.touches[0])clickSpawn(e.touches[0]);},{capture:true,passive:false});
  }catch(e){}

  // -------------------------
  // FOG/NUVEM: máscara escura para jogador, luz revela
  // -------------------------
  window.drawFogFinal=function(){
    if(isMaster())return; // mestre vê tudo
    try{ if(!fogEnabled)return; }catch(e){ return; }
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='rgba(0,0,0,.82)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='destination-out';

    const reveal = [];
    const own = P().find(p=>!p.isNpc && (p.ownerId===me?.pid||p.id===me?.pid));
    if(own) reveal.push(own);
    // Se luz global ligada, revela mais
    if(globalLight) P().forEach(p=>{if(!p.isNpc)reveal.push(p);});
    for(const p of reveal){
      const sx=offsetX+n(p.x)*scale, sy=offsetY+n(p.y)*scale;
      const rad=(p.light?Math.max(80,n(p.light)*5):160)*scale;
      const g=ctx.createRadialGradient(sx,sy,0,sx,sy,rad);
      g.addColorStop(0,'rgba(0,0,0,1)');
      g.addColorStop(.75,'rgba(0,0,0,.85)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(sx,sy,rad,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  };

  // -------------------------
  // Renderizador limpo com vida NPC oculta para jogador
  // -------------------------
  const mapImgs={};
  function getMapImg(m){
    if(!m||!m.src)return null;
    if(mapImgs[m.id]&&mapImgs[m.id].__src===m.src)return mapImgs[m.id];
    const im=new Image(); im.__src=m.src; im.onload=()=>requestDraw&&requestDraw(); im.src=m.src; mapImgs[m.id]=im; return im;
  }
  function drawGrid(){
    const grid=50, left=(-offsetX/scale)-100, top=(-offsetY/scale)-100, right=left+canvas.width/scale+200, bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)'; ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMaps(){
    const maps=M();
    if(maps.length){
      for(const m of maps){
        const x=n(m.x),y=n(m.y),w=n(m.w,1000),h=n(m.h,700),im=getMapImg(m);
        if(im&&im.complete&&im.naturalWidth>0){try{ctx.drawImage(im,x,y,w,h);}catch(e){}}
        else{ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect(x,y,w,h);}
        if(isMaster()){
          ctx.strokeStyle=String(m.id)===String(activeId())?'rgba(255,210,80,.45)':'rgba(255,255,255,.08)';
          ctx.lineWidth=1/scale; ctx.strokeRect(x,y,w,h);
          ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(x+8,y+8,150,22);
          ctx.fillStyle='#fff'; ctx.font=(12/scale)+'px Arial'; ctx.fillText(m.name||'Mapa',x+14,y+24);
        }
      }
    }else if(mapImg&&mapData){try{ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}catch(e){}}
  }
  function drawWallsDoors(){
    if(!isMaster())return;
    ctx.save(); ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d'; ctx.lineWidth=3/scale;
    for(const w of W()){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    for(const d of D()){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    ctx.restore();
  }
  function drawSpawnMarks(){
    if(!isMaster())return;
    const marks=[];
    const p=getSpawn('player'), npc=getSpawn('npc');
    if(p)marks.push({x:p.x,y:p.y,icon:'🧍',label:'Spawn Jogador',color:'rgba(80,255,140,1)'});
    if(npc)marks.push({x:npc.x,y:npc.y,icon:'👹',label:'Spawn NPC',color:'rgba(255,90,90,1)'});
    for(const m of marks){
      ctx.save(); ctx.strokeStyle=m.color; ctx.fillStyle='rgba(0,0,0,.70)'; ctx.lineWidth=3/scale;
      ctx.beginPath();ctx.arc(m.x,m.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.font=(20/scale)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(m.icon,m.x,m.y+1);
      ctx.font=(11/scale)+'px Arial';ctx.fillStyle=m.color;ctx.fillText(m.label,m.x,m.y+32);
      ctx.restore();
    }
  }
  function drawNameHp(p,topY){
    const showHp = isMaster() || !p.isNpc;
    ctx.save(); ctx.textAlign='center'; ctx.font=(11/scale)+'px Arial';
    ctx.fillStyle='rgba(0,0,0,.70)'; ctx.fillRect(p.x-42/2,topY-18/scale,42,13/scale);
    ctx.fillStyle='#fff'; ctx.fillText(p.name||'Token',p.x,topY-8/scale);
    if(showHp){
      const hp=n(p.hp,0), max=Math.max(1,n(p.maxHp||p.hp,1));
      ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(p.x-21,topY-5/scale,42,5/scale);
      ctx.fillStyle='#d33';ctx.fillRect(p.x-21,topY-5/scale,42*Math.max(0,Math.min(1,hp/max)),5/scale);
    }
    ctx.restore();
  }
  function drawToken(p){
    if(!canSeeToken(p))return;
    normalizeToken(p);
    let img=null;try{img=tokenImages[p.id]||null;}catch(e){}
    if(p.img&&!img&&window.safeLoadTokenImage)window.safeLoadTokenImage(p.id,p.img);
    if(p.tokenStyle==='standee'){
      const w=n(p.spriteW,44),h=n(p.spriteH,82),f=p.facing===-1?-1:1;
      ctx.save();ctx.beginPath();ctx.ellipse(p.x,p.y,w*.42,8,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.50)';ctx.fill();
      if(p.id===selectedId){ctx.beginPath();ctx.ellipse(p.x,p.y,w*.58,12,0,0,Math.PI*2);ctx.strokeStyle='rgba(255,210,80,.95)';ctx.lineWidth=3/scale;ctx.stroke();}
      ctx.translate(p.x,p.y);ctx.scale(f,1);
      if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-w/2,-h,w,h);else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fillRect(-w/2,-h,w,h);}
      ctx.restore(); drawNameHp(p,p.y-h-6/scale);
    }else{
      const r=typeof tokenRadius==='function'?tokenRadius(p):16;
      ctx.save();
      if(img&&img.complete&&img.naturalWidth>0){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);ctx.restore();ctx.save();}
      else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}
      ctx.strokeStyle=p.id===selectedId?'rgba(255,210,80,.95)':'rgba(255,255,255,.55)';ctx.lineWidth=(p.id===selectedId?3:2)/scale;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.restore();
      drawNameHp(p,p.y-r-8/scale);
    }
  }
  function drawRuler(){
    const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;
    if(!rr||!rr.a||!rr.b)return;
    const a=rr.a,b=rr.b,px=Math.hypot(b[0]-a[0],b[1]-a[1]),ft=px/10,meters=ft*.3048;
    ctx.save();ctx.strokeStyle='#00e5ff';ctx.lineWidth=3/scale;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    const tx=(a[0]+b[0])/2,ty=(a[1]+b[1])/2;ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(tx+6/scale,ty-24/scale,125/scale,23/scale);ctx.fillStyle='#00e5ff';ctx.font=(14/scale)+'px Arial';ctx.fillText(ft.toFixed(ft<10?1:0)+' ft / '+meters.toFixed(1)+' m',tx+10/scale,ty-7/scale);ctx.restore();
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGrid();drawMaps();drawWallsDoors();drawSpawnMarks();for(const p of P())drawToken(p);drawRuler();
    ctx.restore();
    window.drawFogFinal&&window.drawFogFinal();
  };
  try{draw=window.draw;}catch(e){}

  // Render lista com spawn visível
  window.renderMapListFixed=function(){
    const box=document.getElementById('mapList');if(!box)return;
    const fmt=p=>p?Math.round(p.x)+','+Math.round(p.y):'não marcado';
    let html='<div style="border:1px solid rgba(201,124,61,.45);border-radius:8px;padding:7px;margin:4px 0 8px;font-size:12px;background:rgba(201,124,61,.10)"><b>Spawn global</b><br><small>Jogador: '+fmt(getSpawn('player'))+'<br>NPC: '+fmt(getSpawn('npc'))+'</small><div class="row" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="markGlobalSpawn(\'player\')">Marcar Jogador</button><button onclick="markGlobalSpawn(\'npc\')">Marcar NPC</button><button onclick="clearGlobalSpawn(\'player\')">Remover Jogador</button><button onclick="clearGlobalSpawn(\'npc\')">Remover NPC</button></div></div>';
    html += M().map(m=>'<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px"><b>'+(String(m.id)===String(activeId())?'✅ ':'')+(m.name||'Mapa')+'</b><br><small>x:'+Math.round(n(m.x))+' y:'+Math.round(n(m.y))+'</small><div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="focusMapFixed&&focusMapFixed(\''+m.id+'\')">Ver</button><button onclick="setActiveMap&&setActiveMap(\''+m.id+'\')">Ativo</button><button onclick="sendSelectedTokenToMap&&sendSelectedTokenToMap(\''+m.id+'\')">Enviar 1</button><button onclick="sendAllTokensFromActiveToMap&&sendAllTokensFromActiveToMap(\''+m.id+'\')">Todos</button><button onclick="setAdjustMap&&setAdjustMap(\''+m.id+'\')">Ajustar</button><button onclick="deleteMap(\''+m.id+'\')" class="danger">Del</button></div></div>').join('');
    box.innerHTML=html;
  };

  try{
    socket.on('state',s=>{receiveSpawns(s); if(s&&Array.isArray(s.players))s.players.forEach(normalizeToken); setTimeout(()=>{window.renderMapListFixed&&window.renderMapListFixed();requestDraw&&requestDraw();},30);});
    socket.on('mapsUpdated',d=>{receiveSpawns(d); setTimeout(()=>{window.renderMapListFixed&&window.renderMapListFixed();requestDraw&&requestDraw();},30);});
    socket.on('playerMoved',p=>{normalizeToken(p);});
  }catch(e){}

  setTimeout(()=>{window.renderMapListFixed&&window.renderMapListFixed();requestDraw&&requestDraw();},600);
  console.log('Revisão geral final carregada.');
})();


// ===== PATCH FINAL 2: PAREDES IMPORTADAS + MOVIMENTO JOGADOR + TOP-DOWN INICIAL =====
(function(){
  if(window.__TAVERNA_FIX_PAREDES_MOVIMENTO_TOPDOWN__) return;
  window.__TAVERNA_FIX_PAREDES_MOVIMENTO_TOPDOWN__ = true;

  function n(v,f=0){v=Number(v);return Number.isFinite(v)?v:f;}
  function isMaster(){try{return !!(me&&me.isMaster);}catch(e){return false;}}
  function room(){try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';}}
  function arr(v){return Array.isArray(v)?v:[];}
  function P(){try{return arr(players);}catch(e){return [];}}
  function W(){try{return arr(walls);}catch(e){return [];}}
  function D(){try{return arr(doors);}catch(e){return [];}}
  function M(){try{return arr(campaignMaps);}catch(e){return arr(window.campaignMaps);}}
  function activeId(){try{return activeMapId||window.activeMapId||null;}catch(e){return window.activeMapId||null;}}
  function normalizeToken(p){
    if(!p)return p;
    if(p.tokenStyle !== 'standee') p.tokenStyle='topdown';
    if(p.facing!==-1)p.facing=1;
    if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
    if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
    return p;
  }
  window.normalizeTokenFinal=normalizeToken;

  // Todos os tokens existentes começam em top-down, exceto se já estavam explicitamente em standee.
  P().forEach(normalizeToken);

  // -------------------------------
  // IMPORTAÇÃO: garante paredes/portas do arquivo no cliente e no servidor
  // -------------------------------
  window.importFullMapClick=function(){
    if(!isMaster())return alert('Só o Mestre pode importar.');
    let input=document.getElementById('saveMapFile');
    if(!input){
      input=document.createElement('input');
      input.id='saveMapFile'; input.type='file'; input.accept='application/json,.json'; input.style.display='none';
      document.body.appendChild(input);
    }else{
      const c=input.cloneNode(true); input.parentNode.replaceChild(c,input); input=c;
    }
    input.onchange=function(e){
      const file=e.target.files&&e.target.files[0]; if(!file)return;
      const r=new FileReader();
      r.onload=function(ev){
        try{
          const state=JSON.parse(ev.target.result);
          if(Array.isArray(state.players))state.players.forEach(normalizeToken);
          if(Array.isArray(state.npcs)){
            state.players=(state.players||[]).concat(state.npcs.map(x=>Object.assign({},x,{isNpc:true,tokenStyle:'topdown'})));
          }

          // Atualiza cliente imediatamente para as paredes aparecerem sem esperar roundtrip.
          if(Array.isArray(state.walls)) walls=state.walls;
          if(Array.isArray(state.doors)) doors=state.doors;
          if(Array.isArray(state.maps)){
            try{campaignMaps=state.maps;}catch(err){window.campaignMaps=state.maps;}
          }

          const isScene = (Array.isArray(state.maps)&&state.maps.length>1) || Array.isArray(state.players) || state.version>=20;
          socket.emit('importFullState',{
            room:room(),
            state,
            merge:!isScene,
            side:(document.getElementById('mapSide')&&document.getElementById('mapSide').value)||'right',
            refMapId:activeId(),
            gap:Number((document.getElementById('mapGap')||{}).value)||180
          });
          requestDraw&&requestDraw();
        }catch(err){alert('Erro ao importar: '+err.message);}
        e.target.value='';
      };
      r.readAsText(file);
    };
    input.click();
  };

  try{
    socket.on('wallsUpdated',function(w){walls=Array.isArray(w)?w:[];requestDraw&&requestDraw();});
    socket.on('doorsAdded',function(ds){doors=Array.isArray(ds)?ds:[];requestDraw&&requestDraw();});
    socket.on('doorsCleared',function(){doors=[];requestDraw&&requestDraw();});
    socket.on('state',function(s){
      if(!s)return;
      if(Array.isArray(s.walls))walls=s.walls;
      if(Array.isArray(s.doors))doors=s.doors;
      if(Array.isArray(s.players)){
        s.players.forEach(normalizeToken);
        players=s.players;
      }
      if(Array.isArray(s.maps)){try{campaignMaps=s.maps;}catch(e){window.campaignMaps=s.maps;}}
      requestDraw&&requestDraw();
    });
    socket.on('playerMoved',function(p){
      if(!p||!p.id)return;
      normalizeToken(p);
      const i=P().findIndex(x=>x.id===p.id);
      if(i>=0)players[i]=Object.assign({},players[i],p);
      else players.push(p);
      requestDraw&&requestDraw();
    });
    socket.on('playerUpdated',function(p){
      if(!p||!p.id)return;
      normalizeToken(p);
      const i=P().findIndex(x=>x.id===p.id);
      if(i>=0)players[i]=Object.assign({},players[i],p);
      requestDraw&&requestDraw();
    });
  }catch(e){}

  // -------------------------------
  // MOVIMENTO DO JOGADOR: sem travar, sincroniza com mestre, respeita dono
  // -------------------------------
  function canMoveToken(p){
    if(!p||!me)return false;
    if(me.isMaster)return true;
    return !p.isNpc && (p.ownerId===me.pid || p.id===me.pid);
  }
  function pos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function hitToken(x,y){
    let best=null,bd=999999;
    for(const p of P()){
      if(!canMoveToken(p))continue;
      const d=Math.hypot(n(p.x)-x,n(p.y)-y);
      if(d<36&&d<bd){best=p;bd=d;}
    }
    return best;
  }
  function mapAt(x,y){
    const ms=M();
    for(let i=ms.length-1;i>=0;i--){
      const m=ms[i],mx=n(m.x),my=n(m.y),mw=n(m.w,1000),mh=n(m.h,700);
      if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
    }
    return null;
  }
  function updateFacing(p,x,y){
    const dx=x-n(p.x),dy=y-n(p.y);
    if(Math.abs(dx)>Math.max(2,Math.abs(dy)*.25))p.facing=dx>=0?-1:1;
  }
  function emitMove(p,force=false){
    const now=Date.now();
    if(!force&&window.__lastPlayerMoveEmit&&now-window.__lastPlayerMoveEmit<30)return;
    window.__lastPlayerMoveEmit=now;
    try{socket.emit('move',{room:room(),id:p.id,x:Math.round(n(p.x)),y:Math.round(n(p.y)),mapId:p.mapId||activeId(),facing:p.facing||1,tokenStyle:p.tokenStyle||'topdown',seq:now});}catch(e){}
  }

  let dragFinal=null;
  function startDrag(ev){
    if(!me)return;
    const [x,y]=pos(ev);
    const h=hitToken(x,y);
    if(!h)return;
    dragFinal=h; selectedId=h.id;
    normalizeToken(dragFinal);
    ev.preventDefault&&ev.preventDefault();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
  }
  function moveDrag(ev){
    if(!dragFinal)return;
    const [x,y]=pos(ev);
    const m=mapAt(x,y);
    updateFacing(dragFinal,x,y);
    dragFinal.x=x; dragFinal.y=y;
    if(m)dragFinal.mapId=m.id;
    emitMove(dragFinal,false);
    requestDraw&&requestDraw();
    ev.preventDefault&&ev.preventDefault();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
  }
  function endDrag(ev){
    if(!dragFinal)return;
    emitMove(dragFinal,true);
    dragFinal=null;
    ev&&ev.preventDefault&&ev.preventDefault();
  }
  try{
    canvas.addEventListener('mousedown',function(e){ if((tool||'move')==='move')startDrag(e); },true);
    window.addEventListener('mousemove',moveDrag,true);
    window.addEventListener('mouseup',endDrag,true);
    canvas.addEventListener('touchstart',function(e){ if((tool||'move')==='move'&&e.touches&&e.touches[0])startDrag(e.touches[0]); },{capture:true,passive:false});
    window.addEventListener('touchmove',function(e){ if(dragFinal&&e.touches&&e.touches[0])moveDrag(e.touches[0]); },{capture:true,passive:false});
    window.addEventListener('touchend',endDrag,true);
  }catch(e){}

  // -------------------------------
  // Render limpo de paredes/portas/tokens
  // -------------------------------
  const mapImgsFix={};
  function getMapImg(m){
    if(!m||!m.src)return null;
    if(mapImgsFix[m.id]&&mapImgsFix[m.id].__src===m.src)return mapImgsFix[m.id];
    const im=new Image(); im.__src=m.src; im.onload=()=>requestDraw&&requestDraw(); im.src=m.src; mapImgsFix[m.id]=im; return im;
  }
  function drawGridFix(){
    const grid=50,left=(-offsetX/scale)-100,top=(-offsetY/scale)-100,right=left+canvas.width/scale+200,bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMapsFix(){
    const ms=M();
    if(ms.length){
      for(const m of ms){
        const x=n(m.x),y=n(m.y),w=n(m.w,1000),h=n(m.h,700),im=getMapImg(m);
        if(im&&im.complete&&im.naturalWidth>0)ctx.drawImage(im,x,y,w,h);else{ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect(x,y,w,h);}
      }
    }else if(mapImg&&mapData){ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}
  }
  function drawWallsDoorsFix(){
    // Mestre vê paredes/portas; jogador não vê a física.
    if(!isMaster())return;
    ctx.save();ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
    for(const w of W()){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    for(const d of D()){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    ctx.restore();
  }
  function loadImg(p){
    try{
      if(p.img&&!tokenImages[p.id]){
        const im=new Image(); im.onload=()=>{tokenImages[p.id]=im;requestDraw&&requestDraw();}; im.onerror=()=>{tokenImages[p.id]=null;}; im.src=p.img;
      }
      return tokenImages[p.id]||null;
    }catch(e){return null;}
  }
  function drawHpName(p,top){
    ctx.save();ctx.textAlign='center';ctx.font=(11/scale)+'px Arial';
    ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(p.x-24,top-18/scale,48,13/scale);
    ctx.fillStyle='#fff';ctx.fillText(p.name||'Token',p.x,top-8/scale);
    if(isMaster()||!p.isNpc){
      const hp=n(p.hp,0),max=Math.max(1,n(p.maxHp||p.hp,1));
      ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(p.x-21,top-5/scale,42,5/scale);
      ctx.fillStyle='#d33';ctx.fillRect(p.x-21,top-5/scale,42*Math.max(0,Math.min(1,hp/max)),5/scale);
    }
    ctx.restore();
  }
  function drawTok(p){
    normalizeToken(p);
    const img=loadImg(p);
    if(p.tokenStyle==='standee'){
      const w=n(p.spriteW,44),h=n(p.spriteH,82),f=p.facing===-1?-1:1;
      ctx.save();ctx.beginPath();ctx.ellipse(p.x,p.y,w*.42,8,0,0,Math.PI*2);ctx.fillStyle='rgba(0,0,0,.5)';ctx.fill();
      ctx.translate(p.x,p.y);ctx.scale(f,1);
      if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-w/2,-h,w,h);else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fillRect(-w/2,-h,w,h);}
      ctx.restore();drawHpName(p,p.y-h-6/scale);
    }else{
      const r=16;
      ctx.save();
      if(img&&img.complete&&img.naturalWidth>0){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);ctx.restore();ctx.save();}
      else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}
      ctx.strokeStyle=p.id===selectedId?'rgba(255,210,80,.95)':'rgba(255,255,255,.55)';ctx.lineWidth=(p.id===selectedId?3:2)/scale;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.restore();
      drawHpName(p,p.y-r-8/scale);
    }
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGridFix();drawMapsFix();drawWallsDoorsFix();for(const p of P())drawTok(p);
    ctx.restore();
    if(window.drawFogFinal)window.drawFogFinal();
  };
  try{draw=window.draw;}catch(e){}
  setTimeout(()=>requestDraw&&requestDraw(),300);
  console.log('Patch paredes/movimento/topdown final carregado.');
})();



// ===== MOVIMENTO NÍVEL DEMEO REAL: MINIATURA COM BASE + ANTI-ECO + SPAWN VISÍVEL =====
(function(){
  if(window.__TAVERNA_DEMEO_REAL_FINAL__) return;
  window.__TAVERNA_DEMEO_REAL_FINAL__ = true;

  const MIN_ZOOM_DEMEO = 0.03;
  const MAX_ZOOM_DEMEO = 24;

  function n(v,f=0){ v=Number(v); return Number.isFinite(v)?v:f; }
  function A(v){ return Array.isArray(v)?v:[]; }
  function isMaster(){ try{return !!(me&&me.isMaster);}catch(e){return false;} }
  function room(){ try{return me&&me.room?me.room:'mesa1';}catch(e){return 'mesa1';} }
  function P(){ try{return A(players);}catch(e){return [];} }
  function W(){ try{return A(walls);}catch(e){return [];} }
  function D(){ try{return A(doors);}catch(e){return [];} }
  function M(){ try{return A(campaignMaps);}catch(e){return A(window.campaignMaps);} }
  function activeId(){ try{return activeMapId||window.activeMapId||null;}catch(e){return window.activeMapId||null;} }

  // -------------------------
  // Token padrão e estilo
  // -------------------------
  function normalizeToken(p){
    if(!p) return p;
    if(p.tokenStyle !== 'standee') p.tokenStyle = 'topdown';
    if(p.facing !== -1) p.facing = 1;
    if(!Number.isFinite(Number(p.spriteW))) p.spriteW = 44;
    if(!Number.isFinite(Number(p.spriteH))) p.spriteH = 82;
    if(!Number.isFinite(Number(p.vx))) p.vx = 0;
    if(!Number.isFinite(Number(p.vy))) p.vy = 0;
    return p;
  }
  window.normalizeTokenFinal = normalizeToken;
  P().forEach(normalizeToken);

  // -------------------------
  // Zoom maior
  // -------------------------
  window.MIN_ZOOM = MIN_ZOOM_DEMEO;
  window.MAX_ZOOM = MAX_ZOOM_DEMEO;
  try{
    canvas.addEventListener('wheel',function(e){
      if(!me||!me.isMaster)return;
      e.preventDefault(); e.stopImmediatePropagation();
      const r=canvas.getBoundingClientRect();
      const mx=e.clientX-r.left, my=e.clientY-r.top;
      const bx=(mx-offsetX)/scale, by=(my-offsetY)/scale;
      scale=Math.max(MIN_ZOOM_DEMEO,Math.min(MAX_ZOOM_DEMEO,scale*(e.deltaY<0?1.12:.88)));
      offsetX=mx-bx*scale; offsetY=my-by*scale;
      camTargetX=offsetX; camTargetY=offsetY;
      try{socket.emit('setZoom',{room:room(),zoom:scale,offsetX,offsetY});}catch(err){}
      requestDraw&&requestDraw();
    },{capture:true,passive:false});
  }catch(e){}

  // -------------------------
  // Imagem token sem travar
  // -------------------------
  window.safeLoadTokenImage=function(id,src){
    if(!id)return;
    if(!src){ try{tokenImages[id]=null;}catch(e){}; requestDraw&&requestDraw(); return; }
    try{
      if(tokenImages[id] && tokenImages[id].__src === src) return;
      const im=new Image();
      im.__src=src;
      im.decoding='async';
      im.onload=function(){ tokenImages[id]=im; requestDraw&&requestDraw(); };
      im.onerror=function(){ tokenImages[id]=null; requestDraw&&requestDraw(); };
      setTimeout(function(){ try{im.src=src;}catch(e){} },0);
    }catch(e){}
  };

  window.applyTokenImageToPlayer=function(p,img){
    if(!p)return;
    try{ if(typeof canEditToken==='function' && !canEditToken(p))return; }catch(e){}
    normalizeToken(p);
    p.img=img||'';
    // Colocar foto NÃO muda modo automaticamente; continua top-down até o jogador trocar.
    p.tokenStyle = p.tokenStyle==='standee' ? 'standee' : 'topdown';
    safeLoadTokenImage(p.id,p.img);
    try{socket.emit('updatePlayer',{room:room(),id:p.id,img:p.img,tokenStyle:p.tokenStyle,facing:p.facing,spriteW:p.spriteW,spriteH:p.spriteH});}catch(e){}
    requestDraw&&requestDraw();
  };
  try{applyTokenImageToPlayer=window.applyTokenImageToPlayer;}catch(e){}

  // -------------------------
  // Movimento anti-delay / anti-eco
  // -------------------------
  let dragToken=null;
  let dragOffsetX=0, dragOffsetY=0;
  const localSeq={};
  const ignoreEchoUntil={};
  let lastEmitAt=0;
  let lastForcedEmitAt=0;

  function nextSeq(id){
    localSeq[id]=(localSeq[id]||0)+1;
    return localSeq[id];
  }
  function canMove(p){
    if(!p||!me)return false;
    if(me.isMaster)return true;
    return !p.isNpc && (p.ownerId===me.pid || p.id===me.pid);
  }
  function pos(ev){
    const r=canvas.getBoundingClientRect();
    return [(ev.clientX-r.left-offsetX)/scale,(ev.clientY-r.top-offsetY)/scale];
  }
  function mapAt(x,y){
    const maps=M();
    for(let i=maps.length-1;i>=0;i--){
      const m=maps[i], mx=n(m.x), my=n(m.y), mw=n(m.w,1000), mh=n(m.h,700);
      if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
    }
    return null;
  }
  function hitToken(x,y){
    let best=null, bd=999999;
    for(const p of P()){
      if(!canMove(p))continue;
      const r=p.tokenStyle==='standee'?Math.max(24,n(p.spriteW,44)*.55):24;
      const d=Math.hypot(n(p.x)-x,n(p.y)-y);
      if(d<r&&d<bd){best=p;bd=d;}
    }
    return best;
  }
  function updateFacing(p,nx,ny){
    if(!p)return;
    const dx=n(nx)-n(p.x), dy=n(ny)-n(p.y);
    if(Math.abs(dx)>Math.max(2,Math.abs(dy)*.25)){
      // Corrigido para a arte do Goblint: direita/ esquerda ficam naturais.
      p.facing = dx>=0 ? -1 : 1;
    }
  }
  window.updateTokenFacing = updateFacing;

  function emitMove(p,force=false){
    if(!p||!me||!me.room)return;
    const now=Date.now();
    if(!force && now-lastEmitAt<45)return;
    if(force && now-lastForcedEmitAt<25)return;
    if(force)lastForcedEmitAt=now;
    lastEmitAt=now;

    normalizeToken(p);
    const seq=nextSeq(p.id);
    ignoreEchoUntil[p.id]=Date.now()+180;
    try{
      socket.emit('move',{
        room:me.room,
        id:p.id,
        x:Math.round(n(p.x)),
        y:Math.round(n(p.y)),
        mapId:p.mapId||activeId(),
        facing:p.facing,
        tokenStyle:p.tokenStyle||'topdown',
        spriteW:p.spriteW||44,
        spriteH:p.spriteH||82,
        seq
      });
    }catch(e){}
  }
  window.emitMoveNow=function(p){emitMove(p,true);};
  window.emitMoveThrottled=function(p){emitMove(p,false);};
  try{emitMoveNow=window.emitMoveNow;emitMoveThrottled=window.emitMoveThrottled;}catch(e){}

  function startDrag(ev){
    if(!me || (tool&&tool!=='move'))return false;
    const [x,y]=pos(ev);
    const h=hitToken(x,y);
    if(!h)return false;
    normalizeToken(h);
    dragToken=h;
    selectedId=h.id;
    dragOffsetX=n(h.x)-x;
    dragOffsetY=n(h.y)-y;
    try{syncTokenPanel&&syncTokenPanel();}catch(e){}
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  function moveDrag(ev){
    if(!dragToken)return false;
    const [x,y]=pos(ev);
    const nx=x+dragOffsetX, ny=y+dragOffsetY;
    updateFacing(dragToken,nx,ny);
    dragToken.vx=nx-n(dragToken.x); dragToken.vy=ny-n(dragToken.y);
    dragToken.x=nx; dragToken.y=ny;
    const m=mapAt(nx,ny);
    if(m)dragToken.mapId=m.id;
    emitMove(dragToken,false);
    if(!isMaster() && typeof followMode!=='undefined' && followMode && (dragToken.ownerId===me.pid||dragToken.id===me.pid)){
      try{centerOnToken(dragToken);}catch(e){}
    }
    requestDraw&&requestDraw();
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    return true;
  }
  function endDrag(ev){
    if(!dragToken)return false;
    emitMove(dragToken,true);
    dragToken=null;
    ev&&ev.preventDefault&&ev.preventDefault();
    requestDraw&&requestDraw();
    return true;
  }

  try{
    canvas.addEventListener('mousedown',startDrag,true);
    window.addEventListener('mousemove',moveDrag,true);
    window.addEventListener('mouseup',endDrag,true);
    canvas.addEventListener('touchstart',function(e){ if(e.touches&&e.touches[0])startDrag(e.touches[0]); },{capture:true,passive:false});
    window.addEventListener('touchmove',function(e){ if(dragToken&&e.touches&&e.touches[0])moveDrag(e.touches[0]); },{capture:true,passive:false});
    window.addEventListener('touchend',endDrag,true);
  }catch(e){}

  try{
    socket.on('playerMoved',function(p){
      if(!p||!p.id)return;
      normalizeToken(p);
      const i=P().findIndex(x=>x.id===p.id);
      if(dragToken && dragToken.id===p.id && Date.now()<(ignoreEchoUntil[p.id]||0) && !p.rejected){
        // ignora eco do próprio movimento enquanto arrasta
        return;
      }
      if(i>=0)players[i]=Object.assign({},players[i],p);
      else players.push(p);
      requestDraw&&requestDraw();
    });
    socket.on('playerUpdated',function(p){
      if(!p||!p.id)return;
      normalizeToken(p);
      const i=P().findIndex(x=>x.id===p.id);
      if(i>=0)players[i]=Object.assign({},players[i],p);
      requestDraw&&requestDraw();
    });
    socket.on('state',function(s){
      if(!s)return;
      if(Array.isArray(s.players)){s.players.forEach(normalizeToken); if(!dragToken)players=s.players;}
      receiveSpawns(s);
      requestDraw&&requestDraw();
    });
  }catch(e){}

  // -------------------------
  // Spawn visível para mestre
  // -------------------------
  window.globalSpawns=window.globalSpawns||{};
  function setSpawn(kind,x,y){
    kind=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    if(Number.isFinite(Number(x))&&Number.isFinite(Number(y)))window.globalSpawns[kind]={x:Number(x),y:Number(y)};
    else delete window.globalSpawns[kind];
  }
  function getSpawn(kind){
    const p=(window.globalSpawns||{})[kind];
    return p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))?{x:Number(p.x),y:Number(p.y)}:null;
  }
  function receiveSpawns(d){
    if(!d)return;
    if(d.globalSpawns){
      if('player' in d.globalSpawns){const p=d.globalSpawns.player;p?setSpawn('player',p.x,p.y):setSpawn('player',null,null);}
      if('npc' in d.globalSpawns){const p=d.globalSpawns.npc;p?setSpawn('npc',p.x,p.y):setSpawn('npc',null,null);}
    }
    const px=d.globalSpawnPlayerX??d.universalPlayerSpawnX, py=d.globalSpawnPlayerY??d.universalPlayerSpawnY;
    const nx=d.globalSpawnNpcX??d.universalNpcSpawnX, ny=d.globalSpawnNpcY??d.universalNpcSpawnY;
    if(Number.isFinite(Number(px))&&Number.isFinite(Number(py)))setSpawn('player',px,py);
    if(Number.isFinite(Number(nx))&&Number.isFinite(Number(ny)))setSpawn('npc',nx,ny);
  }
  window.markGlobalSpawn=function(kind){
    if(!isMaster())return alert('Só o Mestre pode marcar spawn.');
    window.__pendingSpawnDemeo=String(kind||'player').toLowerCase()==='npc'?'npc':'player';
    alert('Clique/toque no mapa onde vai ser o spawn global de '+(window.__pendingSpawnDemeo==='npc'?'NPC':'jogador'));
  };
  window.clearGlobalSpawn=function(kind){
    if(!isMaster())return;
    const k=String(kind||'both').toLowerCase();
    if(k==='player'||k==='both')setSpawn('player',null,null);
    if(k==='npc'||k==='both')setSpawn('npc',null,null);
    try{socket.emit('clearGlobalSpawnV2',{room:room(),kind:k});}catch(e){}
    requestDraw&&requestDraw();
  };
  function clickSpawn(ev){
    if(!window.__pendingSpawnDemeo||!isMaster())return false;
    const [x,y]=pos(ev);
    const k=window.__pendingSpawnDemeo;
    window.__pendingSpawnDemeo=null;
    setSpawn(k,Math.round(x),Math.round(y));
    try{socket.emit('setGlobalSpawnV2',{room:room(),kind:k,x:Math.round(x),y:Math.round(y)});}catch(e){}
    ev.preventDefault&&ev.preventDefault();
    ev.stopPropagation&&ev.stopPropagation();
    ev.stopImmediatePropagation&&ev.stopImmediatePropagation();
    requestDraw&&requestDraw();
    return true;
  }
  try{
    canvas.addEventListener('mousedown',clickSpawn,true);
    canvas.addEventListener('touchstart',function(e){if(window.__pendingSpawnDemeo&&e.touches&&e.touches[0])clickSpawn(e.touches[0]);},{capture:true,passive:false});
  }catch(e){}

  // -------------------------
  // Render Demeo limpo
  // -------------------------
  const mapImgs={};
  function getMapImg(m){
    if(!m||!m.src)return null;
    if(mapImgs[m.id]&&mapImgs[m.id].__src===m.src)return mapImgs[m.id];
    const im=new Image(); im.__src=m.src; im.onload=function(){requestDraw&&requestDraw();}; im.src=m.src; mapImgs[m.id]=im; return im;
  }
  function drawGrid(){
    const grid=50,left=(-offsetX/scale)-100,top=(-offsetY/scale)-100,right=left+canvas.width/scale+200,bottom=top+canvas.height/scale+200;
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1/scale;
    for(let x=Math.floor(left/grid)*grid;x<right;x+=grid){ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
    for(let y=Math.floor(top/grid)*grid;y<bottom;y+=grid){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  }
  function drawMaps(){
    const maps=M();
    if(maps.length){
      for(const m of maps){
        const x=n(m.x),y=n(m.y),w=n(m.w,1000),h=n(m.h,700),im=getMapImg(m);
        if(im&&im.complete&&im.naturalWidth>0)ctx.drawImage(im,x,y,w,h);else{ctx.fillStyle='rgba(60,60,70,.7)';ctx.fillRect(x,y,w,h);}
        if(isMaster()){
          ctx.strokeStyle=String(m.id)===String(activeId())?'rgba(255,210,80,.45)':'rgba(255,255,255,.08)';
          ctx.lineWidth=1/scale;ctx.strokeRect(x,y,w,h);
        }
      }
    }else if(mapImg&&mapData){ctx.drawImage(mapImg,0,0,mapWidth||mapImg.width||1000,mapHeight||mapImg.height||700);}
  }
  function drawWallsDoors(){
    if(!isMaster())return;
    ctx.save();ctx.lineCap='round';
    ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;
    for(const w of W()){if(!w||!w[0]||!w[1])continue;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    for(const d of D()){const w=d&&d.wall;if(!w||!w[0]||!w[1])continue;ctx.strokeStyle=d.open?'#22cc66':'#ff3333';ctx.lineWidth=7/scale;ctx.beginPath();ctx.moveTo(n(w[0][0]),n(w[0][1]));ctx.lineTo(n(w[1][0]),n(w[1][1]));ctx.stroke();}
    ctx.restore();
  }
  function drawSpawnMarks(){
    if(!isMaster())return;
    const marks=[];
    const p=getSpawn('player'), npc=getSpawn('npc');
    if(p)marks.push({x:p.x,y:p.y,icon:'🧍',label:'Spawn Jogador',color:'rgba(80,255,140,1)'});
    if(npc)marks.push({x:npc.x,y:npc.y,icon:'👹',label:'Spawn NPC',color:'rgba(255,90,90,1)'});
    for(const m of marks){
      ctx.save();ctx.strokeStyle=m.color;ctx.fillStyle='rgba(0,0,0,.72)';ctx.lineWidth=3/scale;
      ctx.beginPath();ctx.arc(m.x,m.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.font=(20/scale)+'px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(m.icon,m.x,m.y+1);
      ctx.font=(11/scale)+'px Arial';ctx.fillStyle=m.color;ctx.fillText(m.label,m.x,m.y+32);
      ctx.restore();
    }
  }
  function loadImg(p){
    try{
      if(p.img&&!tokenImages[p.id])safeLoadTokenImage(p.id,p.img);
      return tokenImages[p.id]||null;
    }catch(e){return null;}
  }
  function drawBaseShadow(p,w){
    // base/chão juntado com a miniatura
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x,p.y,w*.48,10,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,.62)';
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.18)';
    ctx.lineWidth=1.5/scale;
    ctx.stroke();
    if(p.id===selectedId){
      ctx.beginPath();
      ctx.ellipse(p.x,p.y,w*.62,13,0,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,210,80,.95)';
      ctx.lineWidth=3/scale;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawHpName(p,top){
    const showHp=isMaster()||!p.isNpc;
    ctx.save();ctx.textAlign='center';ctx.font=(11/scale)+'px Arial';
    ctx.fillStyle='rgba(0,0,0,.70)';ctx.fillRect(p.x-26,top-18/scale,52,13/scale);
    ctx.fillStyle='#fff';ctx.fillText(p.name||'Token',p.x,top-8/scale);
    if(showHp){
      const hp=n(p.hp,0),max=Math.max(1,n(p.maxHp||p.hp,1));
      ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(p.x-21,top-5/scale,42,5/scale);
      ctx.fillStyle='#d33';ctx.fillRect(p.x-21,top-5/scale,42*Math.max(0,Math.min(1,hp/max)),5/scale);
    }
    ctx.restore();
  }
  function drawToken(p){
    normalizeToken(p);
    const img=loadImg(p);
    if(p.tokenStyle==='standee'){
      const w=n(p.spriteW,44),h=n(p.spriteH,82),f=p.facing===-1?-1:1;
      drawBaseShadow(p,w);
      ctx.save();ctx.translate(p.x,p.y);ctx.scale(f,1);
      if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-w/2,-h,w,h);
      else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.fillRect(-w/2,-h,w,h);}
      ctx.restore();
      drawHpName(p,p.y-h-6/scale);
    }else{
      const r=16;
      ctx.save();
      if(img&&img.complete&&img.naturalWidth>0){ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(img,p.x-r,p.y-r,r*2,r*2);ctx.restore();ctx.save();}
      else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();}
      ctx.strokeStyle=p.id===selectedId?'rgba(255,210,80,.95)':'rgba(255,255,255,.55)';
      ctx.lineWidth=(p.id===selectedId?3:2)/scale;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();ctx.restore();
      drawHpName(p,p.y-r-8/scale);
    }
  }
  function drawFog(){
    if(isMaster())return;
    try{if(!fogEnabled)return;}catch(e){return;}
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='rgba(0,0,0,.82)';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='destination-out';
    const own=P().find(p=>!p.isNpc&&(p.ownerId===me?.pid||p.id===me?.pid));
    if(own){
      const sx=offsetX+n(own.x)*scale,sy=offsetY+n(own.y)*scale,rad=(own.light?Math.max(80,n(own.light)*5):160)*scale;
      const g=ctx.createRadialGradient(sx,sy,0,sx,sy,rad);
      g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.78,'rgba(0,0,0,.85)');g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(sx,sy,rad,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
  window.draw=function(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
    drawGrid();drawMaps();drawWallsDoors();drawSpawnMarks();for(const p of P())drawToken(p);
    ctx.restore();
    drawFog();
  };
  try{draw=window.draw;}catch(e){}

  // Lista de mapa com spawn
  window.renderMapListFixed=function(){
    const box=document.getElementById('mapList');if(!box)return;
    const fmt=p=>p?Math.round(p.x)+','+Math.round(p.y):'não marcado';
    let html='<div style="border:1px solid rgba(201,124,61,.45);border-radius:8px;padding:7px;margin:4px 0 8px;font-size:12px;background:rgba(201,124,61,.10)"><b>Spawn global</b><br><small>Jogador: '+fmt(getSpawn('player'))+'<br>NPC: '+fmt(getSpawn('npc'))+'</small><div class="row" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="markGlobalSpawn(\'player\')">Marcar Jogador</button><button onclick="markGlobalSpawn(\'npc\')">Marcar NPC</button><button onclick="clearGlobalSpawn(\'player\')">Remover Jogador</button><button onclick="clearGlobalSpawn(\'npc\')">Remover NPC</button></div></div>';
    html+=M().map(m=>'<div style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;margin:4px 0;font-size:12px"><b>'+(String(m.id)===String(activeId())?'✅ ':'')+(m.name||'Mapa')+'</b><br><small>x:'+Math.round(n(m.x))+' y:'+Math.round(n(m.y))+'</small><div class="row" style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap"><button onclick="focusMapFixed&&focusMapFixed(\''+m.id+'\')">Ver</button><button onclick="setActiveMap&&setActiveMap(\''+m.id+'\')">Ativo</button><button onclick="sendSelectedTokenToMap&&sendSelectedTokenToMap(\''+m.id+'\')">Enviar 1</button><button onclick="sendAllTokensFromActiveToMap&&sendAllTokensFromActiveToMap(\''+m.id+'\')">Todos</button><button onclick="setAdjustMap&&setAdjustMap(\''+m.id+'\')">Ajustar</button><button onclick="deleteMap(\''+m.id+'\')" class="danger">Del</button></div></div>').join('');
    box.innerHTML=html;
  };

  setTimeout(function(){try{window.renderMapListFixed&&window.renderMapListFixed();}catch(e){};requestDraw&&requestDraw();},600);
  console.log('Movimento Demeo real final carregado.');
})();
