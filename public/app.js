
let camTargetX = 0;
let camTargetY = 0;
let followMode = true;

function smoothCamera(){
  offsetX += (camTargetX - offsetX) * 0.15;
  offsetY += (camTargetY - offsetY) * 0.15;
}

function centerOnToken(t){
  if(!t) return;
  camTargetX = (canvas.width/2) - (t.x * scale);
  camTargetY = (canvas.height/2) - (t.y * scale);
}

function toggleFollow(){
  followMode = !followMode;
}

function clampCamera(){
  if(!mapWidth || !mapHeight) return;
  const maxX = 0;
  const maxY = 0;
  const minX = canvas.width - mapWidth * scale;
  const minY = canvas.height - mapHeight * scale;

  offsetX = Math.min(maxX, Math.max(minX, offsetX));
  offsetY = Math.min(maxY, Math.max(minY, offsetY));
}

const socket=io();const canvas=document.getElementById('canvas');const ctx=canvas.getContext('2d');
let lastPinchDist=0,lastPinchScale=1;
let me=null,players=[],walls=[],dragging=null,offsetX=0,offsetY=0,scale=1,tool='move',editingPlayer=null,tokenImages={},fogEnabled=false,mapImg=null,mapData=null,wallStart=null,rulerStart=null,rulerEnd=null,selectedId=null,globalLight=0,lastTap=0,lastX=0,lastY=0;let tokenPanelHidden=false;let tokenPanelOpen=false;
let drawPending=false,lastEmitMove=0,lastEmitZoom=0;
function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}
function emitMoveThrottled(token){const now=Date.now();if(now-lastEmitMove<45)return;lastEmitMove=now;socket.emit('move',{room:me.room,id:token.id,x:token.x,y:token.y});}
function emitZoomThrottled(force=false){if(!me||!me.isMaster)return;const now=Date.now();if(!force&&now-lastEmitZoom<180)return;lastEmitZoom=now;socket.emit('setZoom',{room:me.room,zoom:scale,offsetX,offsetY});}
function resize(){canvas.width=window.innerWidth;canvas.height=window.innerHeight;canvas.style.width=window.innerWidth+'px';canvas.style.height=window.innerHeight+'px';ctx.setTransform(1,0,0,1,0,0);if(me&&me.isMaster&&window.sharedRuler)try{socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});}catch(e){}requestDraw();}window.addEventListener('resize',resize);resize();
function join(isMaster){const nameEl=document.getElementById('name');const roomEl=document.getElementById('room');const tokenEl=document.getElementById('tokenId');me={name:nameEl.value||'Jogador',room:roomEl.value||'mesa1',isMaster:!!isMaster,pid:null};try{enterFullscreen();}catch(e){}socket.emit('join',{room:me.room,name:me.name,isMaster:me.isMaster,tokenId:tokenEl.value.trim()||undefined});document.getElementById('login').style.display='none';document.getElementById('toolbar').style.display='flex';if(me.isMaster){const isMobile=window.innerWidth<768;document.getElementById('master').style.display=isMobile?'none':'block';document.getElementById('masterToggle').style.display=isMobile?'block':'none';}else{document.getElementById('master').style.display='none';document.getElementById('masterToggle').style.display='none';}setTimeout(()=>{if(!me.isMaster){offsetX=window.innerWidth/2-400;offsetY=window.innerHeight/2-300;}requestDraw();if(me.isMaster)emitZoomThrottled(true);},100);}
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
socket.on('joined',d=>{me.pid=d.pid;syncTokenPanel();});
socket.on('state',s=>{players=(s.players||[]).filter(p=>p.isNpc||!(p.isMaster===true||String(p.id||'').startsWith('master_')||String(p.ownerId||'').startsWith('master_')));if(me&&!me.isMaster&&!selectedId){const own=players.find(p=>p.ownerId===me.pid&&!p.isNpc)||players.find(p=>p.id===me.pid);if(own)selectedId=own.id;}walls=s.walls||[];fogEnabled=!!s.fog;globalLight=!!Number(s.globalLight||0);preloadTokenImages();syncTokenPanel();if(s.mapData&&s.mapData!==mapData){mapData=s.mapData;mapImg=new Image();mapImg.onload=requestDraw;mapImg.src=mapData;}updateFogLightButtons();requestDraw();updatePlayerList();focusOwnTokenOnce();});
  socket.on('zoomUpdated',d=>{if(me&&me.isMaster)return;scale=d.zoom;requestDraw();});
  socket.on('rulerUpdated',d=>{window.sharedRuler=d;requestDraw();});
socket.on('playerRemoved',id=>{players=players.filter(p=>p.id!==id);requestDraw();updatePlayerList();});
socket.on('playerAdded',p=>updateOrAddPlayer(p));
socket.on('npcAdded',p=>updateOrAddPlayer(p));
  socket.on('playerMoved',p=>{const i=players.findIndex(x=>x.id===p.id);if(i>=0){players[i].x=p.x;players[i].y=p.y;}requestDraw();});
socket.on('moved',d=>{const p=players.find(x=>x.id===d.id);if(p){p.x=d.x;p.y=d.y;requestDraw();}});
socket.on('playerUpdated',p=>updateOrAddPlayer(p));
socket.on('wallAdded',w=>{walls.push(w);draw();});
socket.on('wallsCleared',()=>{walls=[];draw();});
  socket.on('allCleared',()=>{walls=[];players=players.filter(p=>!p.isNpc);mapData=null;draw();});
socket.on('mapSet',data=>{mapData=data;mapImg=new Image();mapImg.onload=requestDraw;mapImg.src=data;});
socket.on('mapUpdated',data=>{mapData=data;mapImg=new Image();mapImg.onload=requestDraw;mapImg.src=data;});
socket.on('fogSet',f=>{fogEnabled=!!f;updateFogLightButtons();draw();});
socket.on('fogUpdated',f=>{fogEnabled=!!f;updateFogLightButtons();draw();});
socket.on('lightSet',l=>{globalLight=!!Number(l);updateFogLightButtons();draw();});
socket.on('lightUpdated',l=>{globalLight=!!Number(l);updateFogLightButtons();draw();});
function setTool(t){tool=t;document.querySelectorAll('#toolbar button').forEach(b=>b.classList.remove('active'));if(t==='move')document.getElementById('tMove').classList.add('active');if(t==='ruler')document.getElementById('tRuler').classList.add('active');if(t==='draw')document.getElementById('tDraw').classList.add('active');if(t==='pan')document.getElementById('tPan').classList.add('active');if(t==='clear')clearWalls();}
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
  const raw=p?p.light:0;
  // Se não tiver valor salvo ainda, usa 6 quadrados. Se for 0, fica sem visão.
  const v=(raw===undefined||raw===null||raw==='')?6:Math.max(0,Number(raw)||0);
  if(v<=0)return 0;
  return v<=20?v*50:v*5;
}
canvas.addEventListener('mousedown',e=>{const[x,y]=getPos(e);if(tool==='draw'){wallStart=[Math.round(x/50)*50,Math.round(y/50)*50];}else if(tool==='ruler'){rulerStart=[x,y];rulerEnd=[x,y];}else if(tool==='pan'){dragging='pan';canvas.dataset.px=e.clientX;canvas.dataset.py=e.clientY;}else{let hit=null,best=999999;players.forEach(p=>{const d=Math.hypot(p.x-x,p.y-y);if(d<24&&d<best){best=d;hit=p;}});if(hit&&!me.isMaster&&(hit.isNpc||hit.ownerId!==me.pid))return;if(hit&&tool==='move'){dragging=hit;selectedId=hit.id;tokenPanelHidden=false;tokenPanelOpen=false;syncTokenPanel();}}});
canvas.addEventListener('mousemove',e=>{if(tool==='pan'&&dragging==='pan'){offsetX+=e.clientX-canvas.dataset.px;offsetY+=e.clientY-canvas.dataset.py;canvas.dataset.px=e.clientX;canvas.dataset.py=e.clientY;requestDraw();}else if(dragging&&dragging!=='pan'){if(!me.isMaster&&dragging.isNpc){dragging=null;return;}const[x,y]=getPos(e);if(!blockedMoveLocal(dragging,x,y)){dragging.x=x;dragging.y=y;if(!me.isMaster&&dragging.ownerId===me.pid)if(!me.isMaster && followMode && dragging.ownerId===me.pid){centerOnToken(dragging);}emitMoveThrottled(dragging);requestDraw();}}else if(wallStart){const[x,y]=getPos(e);draw();ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);ctx.strokeStyle='#c97c3d';ctx.lineWidth=2/scale;ctx.beginPath();ctx.moveTo(wallStart[0],wallStart[1]);ctx.lineTo(Math.round(x/50)*50,Math.round(y/50)*50);ctx.stroke();ctx.restore();}else if(rulerStart){rulerEnd=getPos(e);window.sharedRuler={a:rulerStart,b:rulerEnd};socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});draw();}});
canvas.addEventListener('mouseup',e=>{if(wallStart){const[x,y]=getPos(e);const end=[Math.round(x/50)*50,Math.round(y/50)*50];if(wallStart[0]!==end[0]||wallStart[1]!==end[1])socket.emit('addWall',{room:me.room,wall:[wallStart,end]});wallStart=null;}if(rulerStart){socket.emit('setRuler',{room:me.room,ruler:null});window.sharedRuler=null;}if(rulerStart){socket.emit('setRuler',{room:me.room,ruler:null});window.sharedRuler=null;}if(dragging==='pan')emitZoomThrottled(true);if(dragging==='pan')emitZoomThrottled(true);rulerStart=null;dragging=null;});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(!me||!me.isMaster)return;
  scale=Math.max(0.5,Math.min(3,scale*(e.deltaY<0?1.1:0.9)));
  emitZoomThrottled();
  requestDraw();
});
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
  if(e.touches.length===1){
    const t=e.touches[0];
    const [x,y]=getPos(t);
    if(tool==='draw'){
      if(!me?.isMaster)return;
      wallStart=[Math.round(x/50)*50,Math.round(y/50)*50];
    }else if(tool==='ruler'){
      rulerStart=[x,y];rulerEnd=[x,y];
      window.sharedRuler={a:rulerStart,b:rulerEnd};
      socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});
    }else if(tool==='pan'){
      if(!me?.isMaster)return;
      dragging='pan';canvas.dataset.px=t.clientX;canvas.dataset.py=t.clientY;
    }else{
      let hit=null;
      players.forEach(p=>{if(Math.hypot(p.x-x,p.y-y)<30)hit=p;});
      if(hit&&!me.isMaster&&(hit.isNpc||hit.ownerId!==me.pid))return;
      if(hit&&tool==='move'){
        dragging=hit;selectedId=hit.id;tokenPanelHidden=false;tokenPanelOpen=false;syncTokenPanel();
      }
    }
  }
},{passive:false});

canvas.addEventListener('touchmove',e=>{
  e.preventDefault();
  if(e.touches.length===2&&lastPinchDist&&me?.isMaster){
    const a=e.touches[0],b=e.touches[1];
    const dist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    const oldScale=scale;
    scale=Math.max(0.5,Math.min(3,lastPinchScale*(dist/lastPinchDist)));
    const cx=Number(canvas.dataset.pinchX)||window.innerWidth/2;
    const cy=Number(canvas.dataset.pinchY)||window.innerHeight/2;
    const pox=Number(canvas.dataset.pinchOffsetX)||offsetX;
    const poy=Number(canvas.dataset.pinchOffsetY)||offsetY;
    const ratio=scale/lastPinchScale;
    offsetX=cx-(cx-pox)*ratio;
    offsetY=cy-(cy-poy)*ratio;
    emitZoomThrottled();
    requestDraw();
    return;
  }
  if(e.touches.length===1){
    const t=e.touches[0];
    if(tool==='pan'&&dragging==='pan'){
      offsetX+=t.clientX-canvas.dataset.px;
      offsetY+=t.clientY-canvas.dataset.py;
      canvas.dataset.px=t.clientX;canvas.dataset.py=t.clientY;
      emitZoomThrottled();
      requestDraw();
    }else if(dragging&&dragging!=='pan'){
      if(!me.isMaster&&dragging.isNpc){dragging=null;return;}
      const [x,y]=getPos(t);
      if(!blockedMoveLocal(dragging,x,y)){dragging.x=x;dragging.y=y;if(!me.isMaster&&dragging.ownerId===me.pid)if(!me.isMaster && followMode && dragging.ownerId===me.pid){centerOnToken(dragging);}emitMoveThrottled(dragging);requestDraw();}
    }else if(wallStart&&me?.isMaster){
      const [x,y]=getPos(t);
      requestDraw();
      ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);
      ctx.strokeStyle='#c97c3d';ctx.lineWidth=2/scale;ctx.beginPath();
      ctx.moveTo(wallStart[0],wallStart[1]);
      ctx.lineTo(Math.round(x/50)*50,Math.round(y/50)*50);
      ctx.stroke();ctx.restore();
    }else if(rulerStart){
      rulerEnd=getPos(t);
      window.sharedRuler={a:rulerStart,b:rulerEnd};
      socket.emit('setRuler',{room:me.room,ruler:window.sharedRuler});
      requestDraw();
    }
  }
},{passive:false});

canvas.addEventListener('touchend',e=>{
  e.preventDefault();
  if(e.touches.length<2)lastPinchDist=0;
  if(e.touches.length>0)return;
  const t=e.changedTouches&&e.changedTouches[0];
  if(t){
    const n=Date.now();
    const [x,y]=getPos(t);
    if(n-lastTap<300&&Math.abs(x-lastX)<30&&Math.abs(y-lastY)<30){
      let c=null;players.forEach(p=>{if(Math.hypot(p.x-x,p.y-y)<25)c=p;});
      if(c&&((me.pid&&c.ownerId===me.pid)||me.isMaster)&&!c.isNpc)openPlayerSheet(c.id);
    }
    lastTap=n;lastX=x;lastY=y;
    if(wallStart&&me?.isMaster){
      const end=[Math.round(x/50)*50,Math.round(y/50)*50];
      if(wallStart[0]!==end[0]||wallStart[1]!==end[1])socket.emit('addWall',{room:me.room,wall:[wallStart,end]});
      wallStart=null;
    }
  }
  if(rulerStart){socket.emit('setRuler',{room:me.room,ruler:null});window.sharedRuler=null;}
  if(dragging==='pan')emitZoomThrottled(true);
  if(dragging==='pan')emitZoomThrottled(true);rulerStart=null;rulerEnd=null;dragging=null;
});

canvas.addEventListener('dblclick',e=>{const[x,y]=getPos(e);let c=null;players.forEach(p=>{if(Math.hypot(p.x-x,p.y-y)<20)c=p;});if(c&&((me.pid&&c.ownerId===me.pid)||me.isMaster)&&!c.isNpc){openPlayerSheet(c.id);}});
function isVisible(px,py,tx,ty){for(const w of walls){if(lineIntersect(px,py,tx,ty,w[0][0],w[0][1],w[1][0],w[1][1]))return false;}return true;}
function lineIntersect(x1,y1,x2,y2,x3,y3,x4,y4){const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);if(!d)return false;const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/d;return t>0&&t<1&&u>0&&u<1;}
function toggleDice(){const d=document.getElementById('dice');d.style.display=d.style.display==='none'?'block':'none';}
function roll(notation){if(!notation)return;const m=notation.match(/(\d*)d(\d+)([+-]\d+)?/i);if(!m)return;const count=parseInt(m[1]||1);const sides=parseInt(m[2]);const mod=parseInt(m[3]||0);socket.emit('rollDice',{room:me.room,player:me.name,notation,count,sides,mod});}
socket.on('diceRolled',d=>{const log=document.getElementById('diceLog');const div=document.createElement('div');div.style.marginBottom='4px';div.style.padding='4px';div.style.background='rgba(255,255,255,0.05)';div.style.borderRadius='4px';const rollsStr=d.rolls.join('+');const modStr=d.mod?`${d.mod>0?'+':''}${d.mod}`:'';div.innerHTML=`<strong style="color:#c97c3d">${d.player}</strong>: ${d.notation} = [${rollsStr}]${modStr} = <strong style="color:#fff">${d.total}</strong>`;log.insertBefore(div,log.firstChild);while(log.children.length>10)log.removeChild(log.lastChild);document.getElementById('dice').style.display='block';});

function applyFinalFog(){
  if(!(fogEnabled&&!globalLight&&me&&!me.isMaster))return;

  const mePlayer=players.find(p=>p.ownerId===me.pid&&!p.isNpc)||players.find(p=>p.id===me.pid&&!p.isNpc);

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='rgba(0,0,0,0.97)';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // Só a luz do próprio token do jogador abre a névoa.
  if(mePlayer){
    const lightRadius=tokenLightRadius(mePlayer)*scale;
    if(lightRadius>0){
      const sx=offsetX+(mePlayer.x*scale);
      const sy=offsetY+(mePlayer.y*scale);

      ctx.globalCompositeOperation='destination-out';
      const grad=ctx.createRadialGradient(sx,sy,0,sx,sy,lightRadius);
      grad.addColorStop(0,'rgba(0,0,0,1)');
      grad.addColorStop(0.72,'rgba(0,0,0,0.95)');
      grad.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(sx,sy,lightRadius,0,Math.PI*2);
      ctx.fill();
    }
  }

  ctx.restore();
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
function draw(){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#050507';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(scale,scale);if(mapImg)ctx.drawImage(mapImg,0,0);ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1/scale;for(let i=-2000;i<4000;i+=50){ctx.beginPath();ctx.moveTo(i,-2000);ctx.lineTo(i,4000);ctx.stroke();ctx.beginPath();ctx.moveTo(-2000,i);ctx.lineTo(4000,i);ctx.stroke();}ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.shadowColor='rgba(201,124,61,0.5)';ctx.shadowBlur=8/scale;walls.forEach(w=>{ctx.beginPath();ctx.moveTo(w[0][0],w[0][1]);ctx.lineTo(w[1][0],w[1][1]);ctx.stroke();});ctx.shadowBlur=0;players.forEach(p=>{if(p.img && !tokenImages[p.id]){const im=new Image();im.onload=()=>{tokenImages[p.id]=im;requestDraw();};im.src=p.img;}const img=tokenImages[p.id];ctx.save();const tokenR=tokenRadius(p);if(img){ctx.beginPath();ctx.arc(p.x,p.y,tokenR,0,7);ctx.clip();ctx.drawImage(img,p.x-tokenR,p.y-tokenR,tokenR*2,tokenR*2);ctx.restore();ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,tokenR,0,7);ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=2/scale;ctx.stroke();}else{ctx.fillStyle=p.isNpc?'#a33':'#3a6';ctx.shadowColor=p.isNpc?'#a33':'#3a6';ctx.shadowBlur=12/scale;ctx.beginPath();ctx.arc(p.x,p.y,tokenR*0.9,0,7);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=2/scale;ctx.stroke();}ctx.fillStyle='#fff';ctx.font=`${12/scale}px sans-serif`;ctx.textAlign='center';ctx.shadowColor='#000';ctx.shadowBlur=4/scale;ctx.fillText(p.name,p.x,p.y-26/scale);ctx.shadowBlur=0;ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(p.x-18/scale,p.y+20/scale,36/scale,5/scale);ctx.fillStyle=p.hp>p.maxHp*0.5?'#4ade80':p.hp>p.maxHp*0.25?'#facc15':'#f87171';ctx.fillRect(p.x-18/scale,p.y+20/scale,36/scale*Math.max(0,p.hp/p.maxHp),5/scale);if(p.id===selectedId){ctx.strokeStyle='#c97c3d';ctx.lineWidth=3/scale;ctx.shadowColor='#c97c3d';ctx.shadowBlur=12/scale;ctx.beginPath();ctx.arc(p.x,p.y,24/scale,0,7);ctx.stroke();}ctx.restore();});applyFinalFog();const rr=(rulerStart&&rulerEnd)?{a:rulerStart,b:rulerEnd}:window.sharedRuler;if(rr&&rr.a&&rr.b){ctx.strokeStyle='#0ff';ctx.lineWidth=2/scale;ctx.beginPath();ctx.moveTo(rr.a[0],rr.a[1]);ctx.lineTo(rr.b[0],rr.b[1]);ctx.stroke();const dist=Math.hypot(rr.b[0]-rr.a[0],rr.b[1]-rr.a[1]);ctx.fillStyle='#0ff';ctx.font=`${14/scale}px sans-serif`;ctx.fillText(Math.round(dist/10)+' ft',(rr.a[0]+rr.b[0])/2,(rr.a[1]+rr.b[1])/2);}ctx.restore();}
function addNpc(){if(!me||!me.isMaster){alert('Entre como Mestre para criar NPC');return;}socket.emit('addNpc',{room:me.room,name:document.getElementById('npcName').value||'NPC',hp:Number(document.getElementById('npcHp').value)||10,maxHp:Number(document.getElementById('npcHp').value)||Number(document.getElementById('npcHp').value)||10,ca:Number(document.getElementById('npcCa').value)||10});}
function loadMap(){socket.emit('setMap',{room:me.room,mapData:document.getElementById('mapUrl').value});}
function toggleFog(){fogEnabled=!fogEnabled;socket.emit('setFog',{room:me.room,fog:fogEnabled});updateFogLightButtons();draw();}
function toggleLight(){globalLight=!globalLight;socket.emit('setLight',{room:me.room,light:globalLight?1:0});updateFogLightButtons();draw();}
function setTokenImg(){const p=currentEditableToken();if(!p)return alert('Selecione um token primeiro.');const url=(document.getElementById('tokenUrl')?.value||'').trim();if(url){applyTokenImageToPlayer(p,url);return;}const f=document.getElementById('tokenFile')?.files?.[0];if(!f)return alert('Escolha uma imagem ou cole uma URL.');const r=new FileReader();r.onload=ev=>applyTokenImageToPlayer(p,ev.target.result);r.readAsDataURL(f);}
function saveSheet(){if(!editingPlayer)return;socket.emit('updatePlayer',{room:me.room,id:editingPlayer.id,name:document.getElementById('sName').value,hp:Number(document.getElementById('sHp').value),maxHp:Number(document.getElementById('sMax').value),ca:Number(document.getElementById('sCa').value),light:Number(document.getElementById('sLight').value)});closeSheet();}
function delToken(){if(editingPlayer){socket.emit('removePlayer',{room:me.room,id:editingPlayer.id});closeSheet();}}
function closeSheet(){document.getElementById('sheet').style.display='none';editingPlayer=null;}
function clearWalls(){socket.emit('clearWalls',{room:me.room});}
function updatePlayerList(){const list=document.getElementById('playerList');if(!list||!me||!me.isMaster)return;list.innerHTML='';players.forEach(p=>{const div=document.createElement('div');div.className='player'+(p.isNpc?' npc':'');div.innerHTML=`<span class="name">${p.name}</span><span class="hp">${p.hp}/${p.maxHp}</span><button class="btn" onclick="openPlayerSheet('${p.id}')">📋</button>`;div.onclick=(e)=>{if(e.target.tagName!=='BUTTON'){selectedId=p.id;tokenPanelHidden=false;tokenPanelOpen=false;syncTokenPanel();center();}};list.appendChild(div);});}
function openPlayerSheet(id){const p=players.find(x=>x.id===id);if(!p)return;editingPlayer=p;document.getElementById('sheet').style.display='block';document.getElementById('sName').value=p.name;document.getElementById('sHp').value=p.hp;document.getElementById('sMax').value=p.maxHp;document.getElementById('sCa').value=p.ca;document.getElementById('sLight').value=p.light;}
function openSelectedSheet(){if(selectedId)openPlayerSheet(selectedId);}
document.getElementById('mapFile')?.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;console.log('Carregando mapa:',f.name);const r=new FileReader();r.onload=ev=>{const data=ev.target.result;console.log('Mapa lido, tamanho:',data.length);document.getElementById('mapUrl').value=data;mapData=data;mapImg=new Image();mapImg.onload=()=>{console.log('Imagem criada, desenhando');draw();};mapImg.onerror=()=>{console.error('Erro ao carregar imagem');};mapImg.src=data;socket.emit('setMap',{room:me.room,mapData:data});};r.readAsDataURL(f);});
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
