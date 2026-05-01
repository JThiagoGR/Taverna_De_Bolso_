

function smoothTokenMove(p,targetX,targetY){
  if(!p)return;
  p.x = targetX;
  p.y = targetY;
  clampTokenToMap(p);
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

function setRemoteTarget(id,x,y){
  if(!id)return;
  remoteTargets[id]={x:Number(x),y:Number(y),time:performance.now()};
}

function tickRemoteTargets(){
  const now=performance.now();
  const dt=Math.min(0.08,(now-lastRemoteSmoothTime)/1000);
  lastRemoteSmoothTime=now;

  let changed=false;
  const alpha=1-Math.exp(-REMOTE_SMOOTH_SPEED*dt);

  Object.keys(remoteTargets).forEach(id=>{
    const p=players.find(t=>t.id===id);
    const t=remoteTargets[id];

    if(!p||!t){delete remoteTargets[id];return;}
    if(dragging&&dragging.id===id)return;

    const dx=t.x-p.x;
    const dy=t.y-p.y;
    const d=Math.hypot(dx,dy);

    if(d>REMOTE_SNAP_DIST){
      p.x=t.x;
      p.y=t.y;
      delete remoteTargets[id];
      changed=true;
      return;
    }

    if(d<0.35){
      p.x=t.x;
      p.y=t.y;
      delete remoteTargets[id];
      changed=true;
      return;
    }

    p.x+=dx*alpha;
    p.y+=dy*alpha;
    changed=true;
  });

  if(changed)requestDraw();
}
setInterval(tickRemoteTargets,16);

function emitMoveThrottled(p){
  if(!p||!me||!me.room)return;
  const now=Date.now();
  const prev=lastNetMoveById[p.id]||{t:0,x:p.x,y:p.y};
  const dist=Math.hypot((p.x||0)-(prev.x||0),(p.y||0)-(prev.y||0));
  if(now-prev.t<35 && dist<1)return;
  lastNetMoveById[p.id]={t:now,x:p.x,y:p.y};
  socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10});
}

function emitMoveNow(p){
  if(!p||!me||!me.room)return;
  lastNetMoveById[p.id]={t:Date.now(),x:p.x,y:p.y};
  socket.emit('move',{room:me.room,id:p.id,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10});
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
  centerOnToken($1);
  offsetY=(canvas.height/2) - ($1.y * scale);
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
  socket.on('rulerUpdated',d=>{window.sharedRuler=d;requestDraw();});
socket.on('playerRemoved',id=>{players=players.filter(p=>p.id!==id);requestDraw();updatePlayerList();});
socket.on('playerAdded',p=>updateOrAddPlayer(p));
socket.on('npcAdded',p=>updateOrAddPlayer(p));
  socket.on('playerMoved',p=>{
  const i=players.findIndex(x=>x.id===p.id);
  if(i>=0){
    players[i]={...players[i],...p};
  }else{
    players.push(p);
  }
  if(p.id===selectedId)syncTokenPanel();
  requestDraw();
});
socket.on('mapUpdated',data=>{
  const src=(typeof data==='object'&&data)?data.src:data;
  if(!src){clearLocalMap();return;}
  mapData=src;
  mapWidth=(typeof data==='object'&&data)?Number(data.w)||0:0;
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

function tokenRadius(p){return 14;}
function distPointToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy);
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function blockedMoveLocal(p,nx,ny){
  const r=tokenRadius(p);
  for(const w of walls){
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return true;
    if(distPointToSeg(nx,ny,w[0][0],w[0][1],w[1][0],w[1][1])<r)return true;
  }
  return players.some(o=>{
    if(!o||o.id===p.id)return false;
    return Math.hypot(o.x-nx,o.y-ny)<(r+tokenRadius(o));
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
  players.forEach(p=>{
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
  if(rulerStart){
    socket.emit('setRuler',{room:me.room,ruler:null});
    window.sharedRuler=null;
  }
  rulerStart=null;
  rulerEnd=null;
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
    if(!blockedMoveLocal(dragging,x,y)){smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
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
    dragging='pan';
    canvas.dataset.px=t.clientX;
    canvas.dataset.py=t.clientY;
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
    if(!blockedMoveLocal(dragging,x,y)){smoothTokenMove(dragging,x,y);if(!me.isMaster&&followMode&&dragging.ownerId===me.pid)centerOnToken(dragging);emitMoveThrottled(dragging);requestDraw();}
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

canvas.addEventListener('dblclick',e=>{const[x,y]=getPos(e);let c=null;players.forEach(p=>{if(Math.hypot(p.x-x,p.y-y)<20)c=p;});if(c&&((me.pid&&c.ownerId===me.pid)||me.isMaster)&&!c.isNpc){openPlayerSheet(c.id);}});
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
function saveSheet(){if(!editingPlayer)return;socket.emit('updatePlayer',{room:me.room,id:editingPlayer.id,name:document.getElementById('sName').value,hp:Number(document.getElementById('sHp').value),maxHp:Number(document.getElementById('sMax').value),ca:Number(document.getElementById('sCa').value),light:Number(document.getElementById('sLight').value)});closeSheet();}
function delToken(){if(editingPlayer){socket.emit('removePlayer',{room:me.room,id:editingPlayer.id});closeSheet();}}
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
function openPlayerSheet(id){const p=players.find(x=>x.id===id);if(!p)return;editingPlayer=p;document.getElementById('sheet').style.display='block';document.getElementById('sName').value=p.name;document.getElementById('sHp').value=p.hp;document.getElementById('sMax').value=p.maxHp;document.getElementById('sCa').value=p.ca;document.getElementById('sLight').value=p.light;}
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
