
function clampTokenToMapServer(p, room){
  // Sem mapa carregado = sem limite.
  if(!room || !room.mapData || !room.mapW || !room.mapH)return;

  const margin = Math.max(18, typeof tokenRadius==='function' ? tokenRadius(p) : 20);

  p.x = Math.max(margin, Math.min(room.mapW - margin, p.x));
  p.y = Math.max(margin, Math.min(room.mapH - margin, p.y));
}

const express=require('express');const http=require('http');const {Server}=require('socket.io');const path=require('path');
const app=express();const server=http.createServer(app);const io=new Server(server,{cors:{origin:'*'},maxHttpBufferSize:25e6});
app.get('/health',(req,res)=>res.status(200).send('ok'));
app.use(express.static(path.join(__dirname,'public')));
const rooms={};

function cleanRoom(room){return String(room||'mesa1').trim().replace(/[^\w\- ]/g,'').slice(0,50)||'mesa1';}
function makeRoom(room){
  const id = cleanRoom(room);
  if(!rooms[id]){
    rooms[id] = {players:[],walls:[],doors:[],mapData:null,mapW:0,mapH:0,fog:false,globalLight:0,zoom:1,offsetX:0,offsetY:0,ruler:null,history:[],maps:[],activeMapId:null,spawnMapId:null,worldMode:true,showNpcPaths:false,maps:[],activeMapId:null,spawnMapId:null,worldMode:true,showNpcPaths:false};
  }
  if(!Array.isArray(rooms[id].players)) rooms[id].players=[];
  if(!Array.isArray(rooms[id].walls)) rooms[id].walls=[];
  if(!Array.isArray(rooms[id].doors)) rooms[id].doors=[];
  if(!Array.isArray(rooms[id].history)) rooms[id].history=[];
  if(rooms[id].globalSpawnPlayerX===undefined) rooms[id].globalSpawnPlayerX=null;
  if(rooms[id].globalSpawnPlayerY===undefined) rooms[id].globalSpawnPlayerY=null;
  if(rooms[id].globalSpawnNpcX===undefined) rooms[id].globalSpawnNpcX=null;
  if(rooms[id].globalSpawnNpcY===undefined) rooms[id].globalSpawnNpcY=null;
  return rooms[id];
}

function isMaster(s){return !!(s.isMaster||(typeof s.pid==='string'&&s.pid.startsWith('master_')));}
function canControl(s,p){return !!p&&(isMaster(s)||p.ownerId===s.pid);}
function num(v,f,min,max){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
function makeId(n,r){return String(n||'p').replace(/[^\w\-]/g,'').slice(0,20)+'_'+cleanRoom(r)+'_'+Math.random().toString(36).substr(2,4);}
function lineIntersect(x1,y1,x2,y2,x3,y3,x4,y4){const d=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);if(!d)return false;const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/d;const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/d;return t>=0&&t<=1&&u>=0&&u<=1;}

function distPointToSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1;
  if(dx===0&&dy===0)return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy);
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function blockedByWallWithRadius(x,y,w,radius){
  if(!w||!Array.isArray(w)||!w[0]||!w[1])return false;
  return distPointToSeg(x,y,w[0][0],w[0][1],w[1][0],w[1][1]) < Math.max(8,radius);
}
function tokenRadius(p){return 16;}
function collidesWithToken(room,p,x,y){
  const r=tokenRadius(p);
  return room.players.some(o=>{
    if(!o||o.id===p.id)return false;
    const rr=r+tokenRadius(o);
    return Math.hypot(o.x-x,o.y-y)<rr;
  });
}

function findFreeSpawn(room, preferredX, preferredY, isNpc=false){
  const step=60;
  const spots=[
    [preferredX,preferredY],
    [preferredX+step,preferredY],
    [preferredX-step,preferredY],
    [preferredX,preferredY+step],
    [preferredX,preferredY-step],
    [preferredX+step,preferredY+step],
    [preferredX-step,preferredY+step],
    [preferredX+step,preferredY-step],
    [preferredX-step,preferredY-step],
  ];

  for(const [x,y] of spots){
    const fake={id:'__spawn__',isNpc};
    const blocked=room.players.some(o=>Math.hypot(o.x-x,o.y-y)<40);
    if(!blocked)return {x,y};
  }

  let x=preferredX,y=preferredY;
  for(let i=0;i<80;i++){
    x=preferredX+(i%10)*step;
    y=preferredY+Math.floor(i/10)*step;
    const blocked=room.players.some(o=>Math.hypot(o.x-x,o.y-y)<40);
    if(!blocked)return {x,y};
  }
  return {x:preferredX,y:preferredY};
}


function globalSpawnPoint(room,isNpc=false){
  const x = Number(isNpc ? room.globalSpawnNpcX : room.globalSpawnPlayerX);
  const y = Number(isNpc ? room.globalSpawnNpcY : room.globalSpawnPlayerY);
  if(Number.isFinite(x)&&Number.isFinite(y)) return {x,y};
  ensureMaps(room);
  const m=(room.maps||[]).find(mm=>mm.id===room.activeMapId)||(room.maps||[])[0]||null;
  if(m)return {x:Number(m.x||0)+Number(m.w||1000)/2,y:Number(m.y||0)+Number(m.h||700)/2};
  return {x:300,y:300};
}
function mapAtWorldServer(room,x,y){
  ensureMaps(room);
  const arr=Array.isArray(room.maps)?room.maps:[];
  for(let i=arr.length-1;i>=0;i--){const m=arr[i];const mx=Number(m.x||0),my=Number(m.y||0),mw=Number(m.w||1000),mh=Number(m.h||700);if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;}
  return null;
}
function placeMapNoOverlap(room,m,gap=180){
  ensureMaps(room);
  const arr=room.maps||[];
  if(!arr.length){m.x=0;m.y=0;return m;}
  let maxRight=-Infinity, baseY=0;
  for(const a of arr){maxRight=Math.max(maxRight,Number(a.x||0)+Number(a.w||1000));baseY=Math.min(baseY,Number(a.y||0));}
  m.x=maxRight+Math.max(20,Math.min(5000,Number(gap)||180));
  m.y=baseY;
  return m;
}

function sanitizeWall(w){if(!Array.isArray(w)||w.length!==2)return null;const a=w[0],b=w[1];if(!Array.isArray(a)||!Array.isArray(b))return null;return [[Math.round(Number(a[0])||0),Math.round(Number(a[1])||0)],[Math.round(Number(b[0])||0),Math.round(Number(b[1])||0)]];}


function sanitizeDoor(d){
  if(!d || !Array.isArray(d.wall))return null;
  const w=sanitizeWall(d.wall);
  if(!w)return null;
  return {id:String(d.id||('door_'+Date.now()+'_'+Math.random().toString(36).slice(2,6))).slice(0,80),wall:w,open:!!d.open};
}
function doorBlocksMove(d){return d && d.open!==true && Array.isArray(d.wall);}


function makeMapId(){return 'map_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);}
function sanitizeMapData(d){
  if(!d)return null;
  const src=String(d.src||d.mapData||d.data||d.url||'');
  if(!src)return null;
  if(!(src.startsWith('data:image/')||src.startsWith('http://')||src.startsWith('https://')))return null;
  return {
    id:String(d.id||makeMapId()).slice(0,80),
    name:String(d.name||'Mapa').slice(0,60),
    src:src.slice(0,24000000),
    w:Number(d.w||d.mapW||d.width||1000)||1000,
    h:Number(d.h||d.mapH||d.height||700)||700,
    x:Number(d.x||0)||0,
    y:Number(d.y||0)||0
  };
}
function ensureMaps(r){
  if(!r)return;
  r.maps=Array.isArray(r.maps)?r.maps:[];
  r.worldMode=true;
  if(r.mapData && !r.maps.find(m=>m.src===r.mapData)){
    const id=r.activeMapId||'map_principal';
    r.maps.unshift({id,name:'Mapa Principal',src:r.mapData,w:Number(r.mapW||1000)||1000,h:Number(r.mapH||700)||700,x:0,y:0});
    r.activeMapId=id;
    if(!r.spawnMapId)r.spawnMapId=id;
  }
  r.maps=r.maps.map((m,i)=>sanitizeMapData({
    id:m.id||('map_'+i),
    name:m.name||('Mapa '+(i+1)),
    src:m.src||m.mapData||m.data||m.url,
    w:m.w||m.mapW||m.width||1000,
    h:m.h||m.mapH||m.height||700,
    x:m.x||0,
    y:m.y||0
  })).filter(Boolean);
  if(r.maps.length && !r.activeMapId)r.activeMapId=r.maps[0].id;
  if(r.maps.length && !r.spawnMapId)r.spawnMapId=r.activeMapId;
  const active=r.maps.find(m=>m.id===r.activeMapId)||r.maps[0];
  if(active){r.activeMapId=active.id;r.mapData=active.src;r.mapW=active.w;r.mapH=active.h;}
}


function placeMapBeside(r,m,side,refId,gapValue){
  r.maps=r.maps||[];
  const gap=Math.max(20,Math.min(2000,Number(gapValue)||140));
  const ref=r.maps.find(x=>x.id===refId)||r.maps.find(x=>x.id===r.activeMapId)||r.maps[r.maps.length-1];
  if(!ref){m.x=0;m.y=0;return m;}
  const rw=Number(ref.w)||1000,rh=Number(ref.h)||700;
  const mw=Number(m.w)||1000,mh=Number(m.h)||700;
  const rx=Number(ref.x)||0,ry=Number(ref.y)||0;
  if(side==='left'){m.x=rx-mw-gap;m.y=ry;}
  else if(side==='up'){m.x=rx;m.y=ry-mh-gap;}
  else if(side==='down'){m.x=rx;m.y=ry+rh+gap;}
  else {m.x=rx+rw+gap;m.y=ry;}
  return m;
}


function autoLayoutImportedMapsIfNeeded(maps){
  if(!Array.isArray(maps)||maps.length<2)return maps;
  const allAtOrigin = maps.every(m => Math.abs(Number(m.x||0))<1 && Math.abs(Number(m.y||0))<1);
  if(!allAtOrigin)return maps;
  let x=0,y=0,rowH=0;
  const gap=160;
  const maxRowW=3600;
  for(const m of maps){
    const w=Number(m.w||1000)||1000;
    const h=Number(m.h||700)||700;
    if(x>0 && x+w>maxRowW){x=0;y+=rowH+gap;rowH=0;}
    m.x=x;m.y=y;
    x+=w+gap;
    rowH=Math.max(rowH,h);
  }
  return maps;
}
function normalizeSceneMaps(data){
  const raw = Array.isArray(data&&data.maps) && data.maps.length ? data.maps : (data&&data.mapData ? [{id:data.activeMapId||'map_principal',name:'Mapa Principal',src:data.mapData,w:data.mapW||1000,h:data.mapH||700,x:0,y:0}] : []);
  const seen=new Set();
  const out=[];
  for(let i=0;i<raw.length;i++){
    const m=sanitizeMapData({
      id:raw[i].id||('map_import_'+i),
      name:raw[i].name||('Mapa Importado '+(i+1)),
      src:raw[i].src||raw[i].mapData||raw[i].data||raw[i].url,
      w:raw[i].w||raw[i].mapW||raw[i].width||1000,
      h:raw[i].h||raw[i].mapH||raw[i].height||700,
      x:raw[i].x||0,
      y:raw[i].y||0
    });
    if(!m)continue;
    if(seen.has(m.id))m.id=m.id+'_'+i;
    seen.add(m.id);
    out.push(m);
  }
  return autoLayoutImportedMapsIfNeeded(out);
}

function emitMapsState(roomName,r){
  ensureMaps(r);
  io.to(roomName).emit('mapsUpdated',{maps:r.maps||[],activeMapId:r.activeMapId,spawnMapId:r.spawnMapId,showNpcPaths:!!r.showNpcPaths,worldMode:true,globalSpawns:{player:(Number.isFinite(Number(r.globalSpawnPlayerX))&&Number.isFinite(Number(r.globalSpawnPlayerY))?{x:r.globalSpawnPlayerX,y:r.globalSpawnPlayerY}:null),npc:(Number.isFinite(Number(r.globalSpawnNpcX))&&Number.isFinite(Number(r.globalSpawnNpcY))?{x:r.globalSpawnNpcX,y:r.globalSpawnNpcY}:null)}});
}
io.on('connection',s=>{
 s.on('join',d=>{
  if(!d||!d.room)return;
  const roomName=cleanRoom(d.room),r=makeRoom(roomName);r.doors=r.doors||[];ensureMaps(r);
  s.room=roomName;
  s.isMaster=!!d.isMaster;
  s.pid=s.isMaster?'master_'+roomName:(d.tokenId?String(d.tokenId).slice(0,60):makeId(d.name,roomName));
  s.room=roomName;s.join(roomName);

  // Mestre NÃO cria token automático.
  // Também remove qualquer token antigo de Mestre que tenha ficado na sala.
  r.players=r.players.filter(p=>p.isNpc||!(p.isMaster===true||String(p.id||'').startsWith('master_')||String(p.ownerId||'').startsWith('master_')));

  // Só jogador cria token automático ao entrar.
  if(!s.isMaster){
    let p=r.players.find(x=>x.id===s.pid);
    if(!p){
      const gp=globalSpawnPoint(r,false); const spawn=findFreeSpawn(r,gp.x,gp.y,false);
      p={
        id:s.pid,
        name:String(d.name||'Jogador').slice(0,40),
        x:spawn.x,
        y:spawn.y,
        hp:10,
        maxHp:10,
        ca:10,
        light:1,
        ownerId:s.pid,
        isNpc:false,
        isMaster:false,
        img:'',tokenStyle:'topdown',facing:1,spriteW:44,spriteH:82,mapId:(mapAtWorldServer(r,spawn.x,spawn.y)||{}).id||r.activeMapId||null,path:[],tokenStyle:'standee',facing:1
      };
      r.players.push(p);
    }else{
      p.name=String(d.name||p.name||'Jogador').slice(0,40);
      p.isMaster=false;
      if(p.light===undefined||p.light===null||p.light==='')p.light=1;if(!p.mapId)p.mapId=r.spawnMapId||r.activeMapId||null;if(!Array.isArray(p.path))p.path=[];
    }
  }

  s.emit('joined',{pid:s.pid,isMaster:s.isMaster});
  s.emit('zoomUpdated',{zoom:r.zoom,offsetX:r.offsetX,offsetY:r.offsetY});
  s.emit('rulerUpdated',r.ruler);
  s.emit('mapsUpdated',{maps:r.maps||[],activeMapId:r.activeMapId,spawnMapId:r.spawnMapId,showNpcPaths:!!r.showNpcPaths,worldMode:true,globalSpawns:{player:(Number.isFinite(Number(r.globalSpawnPlayerX))&&Number.isFinite(Number(r.globalSpawnPlayerY))?{x:r.globalSpawnPlayerX,y:r.globalSpawnPlayerY}:null),npc:(Number.isFinite(Number(r.globalSpawnNpcX))&&Number.isFinite(Number(r.globalSpawnNpcY))?{x:r.globalSpawnNpcX,y:r.globalSpawnNpcY}:null)}});
  io.to(roomName).emit('state',r);
 });

 s.on('move',d=>{
  const roomName = cleanRoom((d&&d.room) || s.room);
  const r = rooms[roomName] || rooms[s.room];
  if(!r || !d) return;

  const p = r.players.find(x=>x.id===d.id);
  if(!p) return;

  const isOwner = !s.isMaster && !p.isNpc && (p.ownerId===s.pid || p.id===s.pid);
  const isMasterControl = s.isMaster === true || isMaster(s);
  if(!isOwner && !isMasterControl) return;

  const nx = Number(d.x);
  const ny = Number(d.y);
  if(d.seq && p.lastSeq && Number(d.seq)<=Number(p.lastSeq)) return;
  if(d.seq)p.lastSeq=Number(d.seq);
  if(!Number.isFinite(nx) || !Number.isFinite(ny)) return;

  const radius = tokenRadius(p);

  const reject=()=>{
    s.emit('playerMoved',{...p,seq:d.seq||0,rejected:true});
  };

  for(const w of (r.walls||[])){
    if(!w||!w[0]||!w[1])continue;
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1])) return reject();
    if(blockedByWallWithRadius(nx,ny,w,radius)) return reject();
  }

  for(const door of (r.doors||[])){
    if(!doorBlocksMove(door)) continue;
    const w = door.wall;
    if(!w||!w[0]||!w[1])continue;
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1])) return reject();
    if(blockedByWallWithRadius(nx,ny,w,radius)) return reject();
  }

  if(collidesWithTokenFree(r,p,nx,ny)) return reject();

  p.x = nx;
  p.y = ny;
  const __targetMapLock=mapAtServerV4Clean(r,p.x,p.y); if(!__targetMapLock) return reject ? reject() : undefined; p.mapId=__targetMapLock.id;
  if(d.mapId)p.mapId=String(d.mapId);
  if(d.facing!==undefined)p.facing=Number(d.facing)<0?-1:1;
  if(d.tokenStyle!==undefined)p.tokenStyle=String(d.tokenStyle)==='standee'?'standee':'topdown';
  if(d.spriteW!==undefined)p.spriteW=num(d.spriteW,p.spriteW||32,20,120);
  if(d.spriteH!==undefined)p.spriteH=num(d.spriteH,p.spriteH||65,25,180);
  normalizeTokenDemeoServer(p);
  if(d.mapId)p.mapId=String(d.mapId);
  if(d.facing!==undefined)p.facing=Number(d.facing)<0?-1:1;
  normalizeTokenTopdownPatch2(p);
  if(d.mapId)p.mapId=String(d.mapId);
  if(d.facing!==undefined)p.facing=Number(d.facing)<0?-1:1;
  normalizeTokenFinalServer(p);
  p.mapId=p.mapId||r.activeMapId||r.spawnMapId||null;
  p.path=Array.isArray(p.path)?p.path:[];
  const lastPath=p.path[p.path.length-1];
  if(!lastPath||Math.hypot((lastPath[0]||0)-p.x,(lastPath[1]||0)-p.y)>5){p.path.push([Math.round(p.x),Math.round(p.y)]);if(p.path.length>120)p.path=p.path.slice(-120);}
  // livre entre mapas: não prende token no mapa ativo
  const __mFree=mapAtServerV4Clean(r,p.x,p.y); if(!__mFree) return reject ? reject() : undefined; p.mapId=__mFree.id;

  io.to(roomName).emit('playerMoved',{...p,seq:d.seq||0});
});

 s.on('updatePlayer',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!d)return;
  const p=r.players.find(x=>x.id===d.id);if(!p||!canControl(s,p))return;
  if(d.name!==undefined)p.name=String(d.name||p.name||'Token').slice(0,40);
  if(d.hp!==undefined)p.hp=num(d.hp,p.hp||0,0,9999);
  if(d.maxHp!==undefined)p.maxHp=num(d.maxHp,p.maxHp||1,1,9999);
  if(d.ca!==undefined)p.ca=num(d.ca,p.ca||10,1,99);
  if(d.light!==undefined)p.light=num(d.light,p.light||0,0,500);
  if(d.img!==undefined){const img=String(d.img||'');if(img===''||img.startsWith('data:image/')||img.startsWith('http://')||img.startsWith('https://'))p.img=img.slice(0,2000000);}if(d.tokenStyle!==undefined){const st=String(d.tokenStyle||'topdown');p.tokenStyle=(st==='standee')?'standee':'topdown';}if(d.facing!==undefined)p.facing=Number(d.facing)<0?-1:1;if(d.spriteW!==undefined)p.spriteW=num(d.spriteW,p.spriteW||32,20,120);if(d.spriteH!==undefined)p.spriteH=num(d.spriteH,p.spriteH||65,25,180);normalizeTokenVisualFields(p);
  if(p.hp>p.maxHp)p.hp=p.maxHp;io.to(s.room).emit('playerUpdated',p);io.to(s.room).emit('playerMoved',p);
 });

 s.on('addNpc',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  ensureMaps(r);
  const c=(r.players||[]).filter(p=>p.isNpc).length;
  const hp=Math.max(1,parseInt(d&&d.hp)||10), ca=Math.max(1,parseInt(d&&d.ca)||10);
  const base=spawnPointFinalServer(r,true);
  const sp=freeSpawnFinalServer(r,base,true);
  const npc=normalizeTokenFinalServer({
    id:'npc_'+Date.now()+'_'+Math.random().toString(36).substr(2,5),
    name:String((d&&d.name)||'NPC').slice(0,35)+' '+(c+1),
    x:sp.x,y:sp.y,hp,maxHp:hp,ca,light:0,ownerId:0,isNpc:true,img:'',
    mapId:sp.mapId||r.activeMapId||null,path:[],pathMapId:sp.mapId||r.activeMapId||null,showPath:false,tokenStyle:'topdown'
  });
  r.players.push(npc);
  io.to(s.room).emit('npcAdded',npc);
  io.to(s.room).emit('state',r);
});

 s.on('removePlayer',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!d)return;
  const p=r.players.find(x=>x.id===d.id);if(!canControl(s,p))return;
  r.players=r.players.filter(x=>x.id!==d.id);io.to(s.room).emit('playerRemoved',d.id);io.to(s.room).emit('state',r);
 });

 s.on('addWall',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const w=sanitizeWall(d.wall);if(!w)return;r.walls.push(w);if(r.walls.length>500)r.walls=r.walls.slice(-500);io.to(s.room).emit('wallAdded',w);
 });
 s.on('addWalls',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const arr=Array.isArray(d.walls)?d.walls:[];
  const added=[];
  for(const raw of arr.slice(0,200)){
    const w=sanitizeWall(raw);
    if(w){r.walls.push(w);added.push(w);}
  }
  if(r.walls.length>1000)r.walls=r.walls.slice(-1000);
  if(added.length){r.history=r.history||[];r.history.push({type:'wall',count:added.length});io.to(s.room).emit('wallsAdded',added);}
 });
 s.on('replaceWalls',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.walls=[];r.history=[];const arr=Array.isArray(d.walls)?d.walls:[];for(const raw of arr.slice(0,1200)){const w=sanitizeWall(raw);if(w)r.walls.push(w);}io.to(s.room).emit('wallsCleared');if(r.walls.length)io.to(s.room).emit('wallsAdded',r.walls);io.to(s.room).emit('state',r);});
 s.on('replaceNpcs',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.players=r.players.filter(p=>!p.isNpc);const arr=Array.isArray(d.npcs)?d.npcs:[];for(const n of arr.slice(0,200)){r.players.push({id:String(n.id||('npc_'+Date.now()+'_'+Math.random().toString(36).slice(2,6))).slice(0,80),name:String(n.name||'NPC').slice(0,40),x:num(n.x,400,-100000,100000),y:num(n.y,300,-100000,100000),hp:num(n.hp,10,0,9999),maxHp:num(n.maxHp,10,1,9999),ca:num(n.ca,10,1,99),light:num(n.light,0,0,500),ownerId:0,isNpc:true,img:String(n.img||'').slice(0,2000000)});}io.to(s.room).emit('state',r);});
 s.on('addDoor',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  const door=sanitizeDoor(d.door);
  if(!door)return;
  r.doors=r.doors||[];
  r.doors.push(door);
  io.to(s.room).emit('doorAdded',door);
  io.to(s.room).emit('state',r);
});
 s.on('toggleDoor',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  r.doors=r.doors||[];
  const door=r.doors.find(x=>x.id===d.id);
  if(!door)return;
  door.open=!door.open;
  io.to(s.room).emit('doorUpdated',door);
 });
 s.on('undoDoor',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  r.doors=r.doors||[];
  if(r.doors.length){r.doors.pop();io.to(s.room).emit('doorRemoved');}
 });
 s.on('replaceDoors',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  r.doors=[];
  const arr=Array.isArray(d.doors)?d.doors:[];
  for(const raw of arr.slice(0,500)){
    const door=sanitizeDoor(raw);
    if(door)r.doors.push(door);
  }
  io.to(s.room).emit('doorsCleared');
  if(r.doors.length){r.history=r.history||[];r.history.push({type:'door',count:r.doors.length});io.to(s.room).emit('doorsAdded',r.doors);}
  io.to(s.room).emit('state',r);
 });
 s.on('undoWall',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;

  r.history=r.history||[];
  const last=r.history.pop();

  if(last&&last.type==='door'){
    if((r.doors||[]).length){
      r.doors.pop();
      io.to(s.room).emit('doorRemoved');
    }
    return;
  }

  if(last&&last.type==='wall'){
    const count=Math.max(1,Number(last.count)||1);
    for(let i=0;i<count;i++){
      if(r.walls.length)r.walls.pop();
    }
    io.to(s.room).emit('wallsUpdated',r.walls);
    return;
  }

  // fallback para cenas antigas sem histórico
  if((r.doors||[]).length){
    r.doors.pop();
    io.to(s.room).emit('doorRemoved');
    return;
  }
  if(r.walls.length){
    r.walls.pop();
    io.to(s.room).emit('wallRemoved');
  }
 });

 s.on('clearWalls',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.walls=[];r.doors=[];r.history=[];io.to(s.room).emit('wallsCleared');io.to(s.room).emit('doorsCleared');});
 s.on('clearAll',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.walls=[];r.doors=[];r.players=r.players.filter(p=>!p.isNpc);r.mapData=null;r.mapW=0;r.mapH=0;r.ruler=null;io.to(s.room).emit('allCleared');io.to(s.room).emit('mapCleared');io.to(s.room).emit('mapUpdated',{src:null,w:0,h:0});io.to(s.room).emit('state',r);});
 s.on('clearMap',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.mapData=null;r.mapW=0;r.mapH=0;io.to(s.room).emit('mapCleared');io.to(s.room).emit('mapUpdated',{src:null,w:0,h:0});io.to(s.room).emit('state',r);});
 s.on('setMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const m=sanitizeMapData({name:(d&&d.name)||'Mapa Principal',src:(d&&d.mapData)||'',w:(d&&d.mapW)||(d&&d.w)||1000,h:(d&&d.mapH)||(d&&d.h)||700,x:0,y:0});
  if(!m)return;
  const duplicate=(r.maps||[]).find(mm=>mm.src===m.src);
  if(duplicate){r.activeMapId=duplicate.id;r.mapData=duplicate.src;r.mapW=duplicate.w;r.mapH=duplicate.h;emitMapsState(s.room,r);io.to(s.room).emit('mapUpdated',{src:duplicate.src,w:duplicate.w,h:duplicate.h,id:duplicate.id});io.to(s.room).emit('state',r);return;}
  if((r.maps||[]).length)placeMapNoOverlap(r,m,d&&d.gap);
  r.maps.push(m);
  r.activeMapId=m.id;
  if(!r.spawnMapId)r.spawnMapId=m.id;
  r.worldMode=true;
  r.mapData=m.src;r.mapW=m.w;r.mapH=m.h;
  emitMapsState(s.room,r);
  io.to(s.room).emit('mapUpdated',{src:m.src,w:m.w,h:m.h,id:m.id});
  io.to(s.room).emit('state',r);
});
 s.on('setFog',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.fog=!!d.fog;io.to(s.room).emit('fogUpdated',r.fog);io.to(s.room).emit('fogSet',r.fog);});
 s.on('setLight',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.globalLight=Number(d.light)?1:0;io.to(s.room).emit('lightUpdated',r.globalLight);io.to(s.room).emit('lightSet',r.globalLight);});
 s.on('setGlobalLight',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.globalLight=Number(d.light)?1:0;io.to(s.room).emit('lightUpdated',r.globalLight);io.to(s.room).emit('lightSet',r.globalLight);});
 s.on('setZoom',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s)||!d)return;r.zoom=num(d.zoom,1,.03,24);r.offsetX=num(d.offsetX,0,-100000,100000);r.offsetY=num(d.offsetY,0,-100000,100000);s.to(s.room).emit('zoomUpdated',{zoom:r.zoom,offsetX:r.offsetX,offsetY:r.offsetY});});
 s.on('setRuler',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r)return;
  r.ruler=d&&d.ruler?d.ruler:null;
  io.to(s.room).emit('rulerUpdated',r.ruler);
});
 s.on('roll',d=>{const room=cleanRoom(d&&d.room)||s.room;io.to(room).emit('rollResult',d);if(d&&d.roll)io.to(room).emit('diceRolled',{player:String(d.name||'Jogador'),notation:'1d20',rolls:[d.roll],total:d.roll,mod:0});});
 s.on('rollDice',d=>{
  const roomName=cleanRoom(d&&d.room)||s.room;
  const r=rooms[roomName]||rooms[s.room];
  if(!r||!d)return;
  const m=String(d.notation||'1d20').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if(!m)return;
  const count=Math.max(1,Math.min(30,parseInt(m[1]||1)));
  const sides=Math.max(2,Math.min(1000,parseInt(m[2])));
  const mod=parseInt(m[3]||0);
  const rolls=Array.from({length:count},()=>1+Math.floor(Math.random()*sides));
  const total=rolls.reduce((a,b)=>a+b,0)+mod;
  io.to(roomName).emit('diceRolled',{player:String(d.player||'Jogador').slice(0,40),notation:String(d.notation).slice(0,40),rolls,total,mod});
 });
 s.on('updateToken',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!d||!d.token)return;
  const p=r.players.find(x=>x.id===d.token.id);
  if(!p)return;
  if(!canControl(s,p))return;
  Object.assign(p,d.token);
  io.to(s.room).emit('playerUpdated',p);io.to(s.room).emit('playerMoved',p);
  io.to(s.room).emit('playerMoved',p);
});
 s.on('deleteToken',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!d)return;
  const p=r.players.find(x=>x.id===d.id);
  if(!p||!canControl(s,p))return;
  r.players=r.players.filter(x=>x.id!==d.id);
  io.to(s.room).emit('playerRemoved',d.id);
  io.to(s.room).emit('removeToken',d.id);
});
 s.on('addMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const m=sanitizeMapData(d&&d.map);
  if(!m)return;
  placeMapBeside(r,m,String((d&&d.side)||'right'),String((d&&d.refMapId)||r.activeMapId||''),d&&d.gap);
  r.maps.push(m);
  r.activeMapId=m.id;
  if(!r.spawnMapId)r.spawnMapId=m.id;
  r.worldMode=true;
  r.mapData=m.src;r.mapW=m.w;r.mapH=m.h;
  emitMapsState(s.room,r);
  io.to(s.room).emit('mapUpdated',{src:m.src,w:m.w,h:m.h,id:m.id});
  io.to(s.room).emit('state',r);
});
s.on('setActiveMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const m=r.maps.find(x=>x.id===String(d&&d.id||''));
  if(!m)return;
  r.activeMapId=m.id;
  r.mapData=m.src;r.mapW=m.w||0;r.mapH=m.h||0;
  io.to(s.room).emit('mapsUpdated',{maps:r.maps,activeMapId:r.activeMapId,spawnMapId:r.spawnMapId});
  io.to(s.room).emit('mapUpdated',{src:m.src,w:m.w||0,h:m.h||0,id:m.id});
  io.to(s.room).emit('state',r);
});
s.on('setSpawnMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const id=String(d&&d.id||'');
  if(!r.maps.find(x=>x.id===id))return;
  r.spawnMapId=id;
  io.to(s.room).emit('mapsUpdated',{maps:r.maps,activeMapId:r.activeMapId,spawnMapId:r.spawnMapId});
});
s.on('sendTokenToMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const p=r.players.find(x=>x.id===d.id);
  if(!p)return;
  const id=String(d&&d.mapId||'');
  if(!r.maps.find(x=>x.id===id))return;
  const m=(r.maps||[]).find(x=>x.id===id);p.mapId=id;p.x=Number(m&&m.x||0)+80;p.y=Number(m&&m.y||0)+80;p.path=[];
  io.to(s.room).emit('playerMoved',p);
  io.to(s.room).emit('state',r);
});

s.on('deleteMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  ensureMaps(r);
  const id=String(d&&d.id||'');
  const m=(r.maps||[]).find(x=>x.id===id); if(!m)return;
  function inMapPoint(x,y){return x>=Number(m.x||0)&&y>=Number(m.y||0)&&x<=Number(m.x||0)+Number(m.w||1000)&&y<=Number(m.y||0)+Number(m.h||700);}
  function wallInMap(w){if(!w||!w[0]||!w[1])return false;const mx=(Number(w[0][0])+Number(w[1][0]))/2,my=(Number(w[0][1])+Number(w[1][1]))/2;return inMapPoint(mx,my);}
  r.maps=(r.maps||[]).filter(x=>x.id!==id);
  r.walls=(r.walls||[]).filter(w=>!wallInMap(w));
  r.doors=(r.doors||[]).filter(dr=>!wallInMap(dr&&dr.wall));
  r.players=(r.players||[]).map(p=>{if(p.mapId===id){const nm=r.maps[0];if(nm){p.mapId=nm.id;p.x=Number(nm.x||0)+80;p.y=Number(nm.y||0)+80;}else{p.mapId=null;}}return p;});
  r.activeMapId=r.maps[0]?.id||null; r.spawnMapId=r.spawnMapId===id?(r.activeMapId||null):r.spawnMapId;
  const a=r.maps.find(x=>x.id===r.activeMapId)||null; r.mapData=a?a.src:null;r.mapW=a?a.w:0;r.mapH=a?a.h:0;
  emitMapsState(s.room,r);io.to(s.room).emit('wallsUpdated',r.walls);io.to(s.room).emit('doorsCleared');if(r.doors.length)io.to(s.room).emit('doorsAdded',r.doors);io.to(s.room).emit('mapUpdated',{src:r.mapData,w:r.mapW,h:r.mapH,id:r.activeMapId});io.to(s.room).emit('state',r);
});
s.on('moveMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  ensureMaps(r);const id=String(d&&d.id||'');const m=(r.maps||[]).find(x=>x.id===id);if(!m)return;
  const oldX=Number(m.x||0),oldY=Number(m.y||0),nx=Number(d.x),ny=Number(d.y);if(!Number.isFinite(nx)||!Number.isFinite(ny))return;
  const dx=nx-oldX,dy=ny-oldY;m.x=nx;m.y=ny;
  if(d.carry!==false){
    function inOld(x,y){return x>=oldX&&y>=oldY&&x<=oldX+Number(m.w||1000)&&y<=oldY+Number(m.h||700);}
    for(const w of (r.walls||[])){const mx=(Number(w[0][0])+Number(w[1][0]))/2,my=(Number(w[0][1])+Number(w[1][1]))/2;if(inOld(mx,my)){w[0][0]+=dx;w[0][1]+=dy;w[1][0]+=dx;w[1][1]+=dy;}}
    for(const dr of (r.doors||[])){const w=dr.wall;if(!w)continue;const mx=(Number(w[0][0])+Number(w[1][0]))/2,my=(Number(w[0][1])+Number(w[1][1]))/2;if(inOld(mx,my)){w[0][0]+=dx;w[0][1]+=dy;w[1][0]+=dx;w[1][1]+=dy;}}
    for(const p of (r.players||[])){if(p.mapId===id||inOld(Number(p.x||0),Number(p.y||0))){p.x+=dx;p.y+=dy;p.mapId=id;}}
  }
  emitMapsState(s.room,r);io.to(s.room).emit('wallsUpdated',r.walls);io.to(s.room).emit('doorsCleared');if(r.doors.length)io.to(s.room).emit('doorsAdded',r.doors);io.to(s.room).emit('state',r);
});
s.on('importFullState',d=>{
  if(!isMaster(s))return;
  const roomName=cleanRoom((d&&d.room)||s.room);
  const r=makeRoom(roomName);
  const data=d&&d.state;
  if(!data||typeof data!=='object')return;
  ensureMaps(r);

  const importedMaps=normalizeSceneMapsFix3(data);
  const merge=!!(d&&d.merge);

  if(merge){
    const side=String((d&&d.side)||'right');
    const gap=Number((d&&d.gap)||180)||180;
    const added=[];
    for(const raw of importedMaps){
      const m={...raw,id:makeMapId()};
      if(typeof placeMapBeside==='function')placeMapBeside(r,m,side,String((d&&d.refMapId)||r.activeMapId||''),gap);
      else{const last=r.maps[r.maps.length-1];m.x=last?Number(last.x||0)+Number(last.w||1000)+gap:0;m.y=last?Number(last.y||0):0;}
      r.maps.push(m);added.push(m);
    }
    if(added[0])r.activeMapId=added[0].id;
    if(Array.isArray(data.walls))r.walls=(r.walls||[]).concat(data.walls);
    if(Array.isArray(data.doors))r.doors=(r.doors||[]).concat(data.doors);
  }else{
    r.maps=importedMaps;
    r.activeMapId=(data.activeMapId&&importedMaps.find(m=>m.id===data.activeMapId))?data.activeMapId:(importedMaps[0]?.id||null);
    r.walls=Array.isArray(data.walls)?data.walls:[];
    r.doors=Array.isArray(data.doors)?data.doors:[];
    const rawPlayers=(Array.isArray(data.players)?data.players:[]).concat(Array.isArray(data.npcs)?data.npcs.map(n=>({...n,isNpc:true})):[]);
    r.players=rawPlayers.map((p,i)=>({
      ...p,
      id:String(p.id||((p.isNpc?'npc_':'token_')+i)).slice(0,100),
      x:Number(p.x)||300,y:Number(p.y)||300,
      mapId:(p.mapId&&importedMaps.find(m=>m.id===p.mapId))?p.mapId:r.activeMapId,
      tokenStyle:p.tokenStyle==='standee'?'standee':'topdown',
      facing:p.facing===-1?-1:1,
      spriteW:Number(p.spriteW)||44,
      spriteH:Number(p.spriteH)||82,
      path:Array.isArray(p.path)?p.path:[]
    }));
  }
  r.spawnMapId=null;
  const active=(r.maps||[]).find(m=>m.id===r.activeMapId)||(r.maps||[])[0]||null;
  r.mapData=active?active.src:null;r.mapW=active?active.w:0;r.mapH=active?active.h:0;
  r.fog=!!data.fog;r.globalLight=Number(data.globalLight||r.globalLight||0)||0;
  ensureMaps(r);
  emitMapsState(roomName,r);
  if(active)io.to(roomName).emit('mapUpdated',{src:active.src,w:active.w,h:active.h,id:active.id});
  else io.to(roomName).emit('mapUpdated',{src:null,w:0,h:0,id:null});
  io.to(roomName).emit('wallsUpdated',r.walls||[]);
  io.to(roomName).emit('doorsCleared');if((r.doors||[]).length)io.to(roomName).emit('doorsAdded',r.doors);
  io.to(roomName).emit('state',r);
});

s.on('setGlobalSpawnV2',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const x=Number(d&&d.x),y=Number(d&&d.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const kind=String((d&&d.kind)||'player').toLowerCase();
  if(kind==='player'||kind==='jogador'||kind==='both'){r.globalSpawnPlayerX=x;r.globalSpawnPlayerY=y;}
  if(kind==='npc'||kind==='both'){r.globalSpawnNpcX=x;r.globalSpawnNpcY=y;}
  emitMapsState(s.room,r);io.to(s.room).emit('state',r);
});
s.on('clearGlobalSpawnV2',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const kind=String((d&&d.kind)||'both').toLowerCase();
  if(kind==='player'||kind==='jogador'||kind==='both'){r.globalSpawnPlayerX=null;r.globalSpawnPlayerY=null;}
  if(kind==='npc'||kind==='both'){r.globalSpawnNpcX=null;r.globalSpawnNpcY=null;}
  emitMapsState(s.room,r);io.to(s.room).emit('state',r);
});
s.on('disconnect' ,()=>{if(!s.room)return;setTimeout(()=>{const live=io.sockets.adapter.rooms.get(s.room);if(!live||live.size===0)delete rooms[s.room];},5*60*1000);});
});
const PORT = process.env.PORT || 8080;server.listen(PORT,'0.0.0.0',()=>console.log('🍺 Taverna De Bolso - layout antigo na porta '+PORT));


// ===== PATCH SERVER FINAL: CAMPOS DO TOKEN, ZOOM E PORTAS =====
(function(){
  const oldRooms = rooms;
})();

// Monkey patch seguro por eventos adicionais não é possível aqui sem acessar socket anterior,
// então os handlers são adicionados no fluxo principal quando o arquivo carrega.
// As funções abaixo ficam disponíveis para os handlers existentes usarem quando updatePlayer chegar.
function normalizeTokenVisualFields(p){
  if(!p)return p;
  if(!p.tokenStyle)p.tokenStyle='topdown';
  if(p.facing!==-1)p.facing=1;
  if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
  if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
  return p;
}


// ===== PATCH SERVER DEFINITIVO: IMPORTAÇÃO MAPAS + TOKEN TOP-DOWN =====
function normalizeTokenTopdownServer(p){
  if(!p)return p;
  if(p.tokenStyle!=='standee')p.tokenStyle='topdown';
  if(p.facing!==-1)p.facing=1;
  if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
  if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
  return p;
}
function normalizeSceneMapsFinal(data){
  const arr=Array.isArray(data&&data.maps)?data.maps:[];
  const legacy=(data&&(data.mapData||(data.map&&data.map.data)))?[{
    id:'map_principal',
    name:'Mapa Principal',
    src:data.mapData||(data.map&&data.map.data),
    w:data.mapW||(data.map&&data.map.w)||1000,
    h:data.mapH||(data.map&&data.map.h)||700,
    x:0,y:0
  }]:[];
  const srcs=arr.length?arr:legacy;
  return srcs.map((m,i)=>sanitizeMapData({
    id:m.id||('map_'+i),
    name:m.name||('Mapa '+(i+1)),
    src:m.src||m.mapData||m.data||m.url,
    w:m.w||m.mapW||m.width||1000,
    h:m.h||m.mapH||m.height||700,
    x:Number.isFinite(Number(m.x))?Number(m.x):i*1200,
    y:Number.isFinite(Number(m.y))?Number(m.y):0
  })).filter(Boolean);
}


// ===== REVISÃO SERVER FINAL: IMPORT MERGE, SPAWN, NPC DROP, SYNC =====
function normalizeTokenFinalServer(p){
  if(!p)return p;
  if(p.tokenStyle!=='standee')p.tokenStyle='topdown';
  if(p.facing!==-1)p.facing=1;
  if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
  if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
  return p;
}
function mapAtPointFinalServer(r,x,y){
  ensureMaps(r);
  for(let i=(r.maps||[]).length-1;i>=0;i--){
    const m=r.maps[i], mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null;
}
function spawnPointFinalServer(r,isNpc){
  const x = isNpc ? r.globalSpawnNpcX : r.globalSpawnPlayerX;
  const y = isNpc ? r.globalSpawnNpcY : r.globalSpawnPlayerY;
  if(Number.isFinite(Number(x))&&Number.isFinite(Number(y))){
    const m=mapAtPointFinalServer(r,Number(x),Number(y)) || (r.maps||[])[0] || null;
    return {x:Number(x),y:Number(y),mapId:m?m.id:null};
  }
  ensureMaps(r);
  const m=(r.maps||[]).find(mm=>mm.id===r.activeMapId)||(r.maps||[])[0]||null;
  if(m)return {x:Number(m.x||0)+80,y:Number(m.y||0)+80,mapId:m.id};
  return {x:300,y:300,mapId:null};
}
function freeSpawnFinalServer(r,base,isNpc){
  const step=48;
  const offsets=[[0,0],[step,0],[-step,0],[0,step],[0,-step],[step,step],[-step,step],[step,-step],[-step,-step],[step*2,0],[-step*2,0]];
  for(const o of offsets){
    const x=base.x+o[0], y=base.y+o[1];
    const blocked=(r.players||[]).some(p=>(!base.mapId||p.mapId===base.mapId)&&Math.hypot((Number(p.x)||0)-x,(Number(p.y)||0)-y)<38);
    if(!blocked)return {x,y,mapId:base.mapId};
  }
  return base;
}


// ===== PATCH SERVER 2: PAREDES IMPORTADAS + MOVIMENTO TOPDOWN =====
function normalizeTokenTopdownPatch2(p){
  if(!p)return p;
  if(p.tokenStyle!=='standee')p.tokenStyle='topdown';
  if(p.facing!==-1)p.facing=1;
  if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
  if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
  return p;
}
function normalizeSceneMapsPatch2(data){
  const maps=Array.isArray(data&&data.maps)?data.maps:[];
  if(maps.length){
    return maps.map((m,i)=>sanitizeMapData({
      id:m.id||('map_'+i),
      name:m.name||('Mapa '+(i+1)),
      src:m.src||m.mapData||m.data||m.url,
      w:m.w||m.mapW||m.width||1000,
      h:m.h||m.mapH||m.height||700,
      x:Number.isFinite(Number(m.x))?Number(m.x):i*1200,
      y:Number.isFinite(Number(m.y))?Number(m.y):0
    })).filter(Boolean);
  }
  const src=(data&&(data.mapData||(data.map&&data.map.data)))||'';
  if(src)return [sanitizeMapData({id:'map_importado_'+Date.now(),name:'Mapa Importado',src,w:(data.mapW||(data.map&&data.map.w)||1000),h:(data.mapH||(data.map&&data.map.h)||700),x:0,y:0})].filter(Boolean);
  return [];
}


// ===== SERVER MOVIMENTO DEMEO REAL FINAL =====
function normalizeTokenDemeoServer(p){
  if(!p)return p;
  if(p.tokenStyle!=='standee')p.tokenStyle='topdown';
  if(p.facing!==-1)p.facing=1;
  if(!Number.isFinite(Number(p.spriteW)))p.spriteW=44;
  if(!Number.isFinite(Number(p.spriteH)))p.spriteH=82;
  return p;
}


// ===== SERVER PATCH FINAL 3: REGUA MAPA IMPORT LUZ =====
function normalizeSceneMapsFix3(data){
  const maps=Array.isArray(data&&data.maps)?data.maps:[];
  if(maps.length){
    return maps.map((m,i)=>sanitizeMapData({
      id:m.id||('map_'+i),
      name:m.name||('Mapa '+(i+1)),
      src:m.src||m.mapData||m.data||m.url,
      w:m.w||m.mapW||m.width||1000,
      h:m.h||m.mapH||m.height||700,
      x:Number.isFinite(Number(m.x))?Number(m.x):i*1200,
      y:Number.isFinite(Number(m.y))?Number(m.y):0
    })).filter(Boolean);
  }
  const src=(data&&(data.mapData||(data.map&&data.map.data)))||'';
  if(src)return [sanitizeMapData({id:'map_importado_'+Date.now(),name:'Mapa Importado',src,w:(data.mapW||(data.map&&data.map.w)||1000),h:(data.mapH||(data.map&&data.map.h)||700),x:0,y:0})].filter(Boolean);
  return [];
}


// ===== SERVER PATCH FINAL 5: MOVIMENTO LIVRE ENTRE MAPAS =====
function mapAtServerFreeMove(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i], mx=Number(m.x)||0, my=Number(m.y)||0, mw=Number(m.w)||1000, mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null;
}

function collidesWithTokenFree(room,p,x,y){
  const m=mapAtServerFreeMove(room,x,y);
  const mid=m?m.id:null;
  const r=typeof tokenRadius==='function'?tokenRadius(p):16;
  return (room.players||[]).some(o=>{
    if(!o||o.id===p.id)return false;
    const om=mapAtServerFreeMove(room,Number(o.x)||0,Number(o.y)||0);
    const oid=om?om.id:(o.mapId||null);
    if((mid||null)!==(oid||null))return false;
    return Math.hypot((Number(o.x)||0)-x,(Number(o.y)||0)-y)<(r+(typeof tokenRadius==='function'?tokenRadius(o):16));
  
s.on('mapsUpdated',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  if(Array.isArray(d.maps))r.maps=d.maps;
  if(d.activeMapId)r.activeMapId=d.activeMapId;
  io.to(s.room).emit('mapsUpdated',{maps:r.maps||[],activeMapId:r.activeMapId||null});
  io.to(s.room).emit('state',r);
});

});
}


// ===== SERVER PATCH FINAL 6: SPAWN GLOBAL + GRID VAZIO =====
function mapAtServerGridEmpty(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null; // grid vazio permitido
}


// ===== SERVER CONSOLIDADO FINAL: GRID VAZIO, SPAWN, REGUA =====
function mapAtServerConsolidado(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null;
}


// ===== SERVER PATCH FINAL 9: SOMENTE MAPAS CONECTADOS =====
const MAP_EDGE_TOLERANCE_SERVER = 10;

function serverMapContainsReal(m,x,y){
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  return x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh;
}
function serverMapContainsExpanded(m,x,y){
  const t=MAP_EDGE_TOLERANCE_SERVER;
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  return x>=mx-t&&y>=my-t&&x<=mx+mw+t&&y<=my+mh+t;
}
function mapAtServerConnectedOnly(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    if(serverMapContainsReal(maps[i],x,y))return maps[i];
  }
  for(let i=maps.length-1;i>=0;i--){
    if(serverMapContainsExpanded(maps[i],x,y))return maps[i];
  }
  return null;
}


// ===== SERVER PATCH FINAL 10: TRAVA DURA NO MAPA =====
function mapAtServerHardLock(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null;
}
function clampToServerMap(m,x,y){
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  return {x:Math.max(mx+1,Math.min(mx+mw-1,x)),y:Math.max(my+1,Math.min(my+mh-1,y))};
}


// ===== SERVER PATCH FINAL 12: TRAVA TOTAL NO MAPA =====
function mapAtServerStrictFinal(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx&&y>=my&&x<=mx+mw&&y<=my+mh)return m;
  }
  return null;
}

// ===== SERVER PATCH LIMPO FINAL REAL =====
function mapAtServerCleanFinal(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i], mx=Number(m.x)||0, my=Number(m.y)||0, mw=Number(m.w)||1000, mh=Number(m.h)||700;
    if(x>=mx+2 && y>=my+2 && x<=mx+mw-2 && y<=my+mh-2) return m;
  }
  return null;
}

// ===== SERVER RESTAURADO FINAL: trava fora do mapa =====
function mapAtServerRestauradoFinal(room,x,y){
  ensureMaps(room);
  const maps=Array.isArray(room.maps)?room.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
  }
  return null;
}


// ===== SERVER v4 LIMPO: trava movimento dentro do mapa =====
function mapAtServerV4Clean(room,x,y){
  if(typeof ensureMaps==='function') ensureMaps(room);
  const maps = Array.isArray(room.maps)&&room.maps.length
    ? room.maps
    : (room.mapData&&room.mapW&&room.mapH ? [{id:'main',x:0,y:0,w:room.mapW,h:room.mapH}] : []);
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i], mx=Number(m.x)||0, my=Number(m.y)||0, mw=Number(m.w)||1000, mh=Number(m.h)||700;
    if(x>=mx+2 && y>=my+2 && x<=mx+mw-2 && y<=my+mh-2) return m;
  }
  return null;
}


// ===== RESTAURAÇÃO v4 SERVER: SPAWN E IMPORT =====
if (typeof io !== 'undefined') {
  // handlers são registrados dentro do connection se ainda não existirem em algumas bases;
  // este bloco não substitui os existentes, só deixa funções auxiliares globais disponíveis.
}
function normalizeImportMapV4(m,i){
  return {
    id: String(m.id || ('map_'+Date.now()+'_'+i)),
    name: String(m.name || ('Mapa '+(i+1))),
    src: m.src || m.mapData || m.data || m.url || '',
    x: Number.isFinite(Number(m.x)) ? Number(m.x) : i*1100,
    y: Number.isFinite(Number(m.y)) ? Number(m.y) : 0,
    w: Number(m.w || m.mapW || m.width || 1000) || 1000,
    h: Number(m.h || m.mapH || m.height || 700) || 700
  };
}
