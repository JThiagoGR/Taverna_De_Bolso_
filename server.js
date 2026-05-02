
function getMapById(room,id){
  if(!room||!Array.isArray(room.maps))return null;
  return room.maps.find(m=>String(m.id)===String(id||''))||null;
}

function findMapAtPoint(room,x,y){
  if(!room||!Array.isArray(room.maps))return null;
  // usa o último primeiro porque mapas adicionados por cima devem ganhar prioridade
  for(let i=room.maps.length-1;i>=0;i--){
    const m=room.maps[i];
    const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||0,mh=Number(m.h)||0;
    if(x>=mx && y>=my && x<=mx+mw && y<=my+mh)return m;
  }
  return null;
}

function clampTokenToMapServer(p, room){
  if(!room)return;
  const margin = Math.max(18, typeof tokenRadius==='function' ? tokenRadius(p) : 20);
  let m = getMapById(room,p&&p.mapId);
  if(!m && room.activeMapId)m=getMapById(room,room.activeMapId);
  if(!m && Array.isArray(room.maps) && room.maps.length)m=room.maps[0];

  // compatibilidade com mapa único antigo
  if(!m && room.mapData && room.mapW && room.mapH){
    p.x = Math.max(margin, Math.min(room.mapW - margin, p.x));
    p.y = Math.max(margin, Math.min(room.mapH - margin, p.y));
    return;
  }
  if(!m)return;
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  p.x = Math.max(mx+margin, Math.min(mx+mw-margin, Number(p.x)||mx+margin));
  p.y = Math.max(my+margin, Math.min(my+mh-margin, Number(p.y)||my+margin));
  p.mapId=m.id;
}

function safeMapSpawn(room,mapId,preferredX,preferredY,p){
  let m=getMapById(room,mapId)||getMapById(room,room.activeMapId)||(room.maps||[])[0];
  const margin=Math.max(30, typeof tokenRadius==='function'?tokenRadius(p||{}):20);
  if(!m)return findFreeSpawn(room,preferredX||300,preferredY||300,!!(p&&p.isNpc));
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  const x=Number.isFinite(Number(preferredX))?Number(preferredX):mx+Math.min(300,Math.max(margin,mw/2));
  const y=Number.isFinite(Number(preferredY))?Number(preferredY):my+Math.min(300,Math.max(margin,mh/2));
  return findFreeSpawn(room,Math.max(mx+margin,Math.min(mx+mw-margin,x)),Math.max(my+margin,Math.min(my+mh-margin,y)),!!(p&&p.isNpc));
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
    rooms[id] = {players:[],walls:[],doors:[],mapData:null,mapW:0,mapH:0,fog:false,globalLight:0,zoom:1,offsetX:0,offsetY:0,ruler:null,history:[],maps:[],activeMapId:null,spawnMapId:null,worldMode:true,showNpcPaths:false};
  }
  if(!Array.isArray(rooms[id].players)) rooms[id].players=[];
  if(!Array.isArray(rooms[id].walls)) rooms[id].walls=[];
  if(!Array.isArray(rooms[id].doors)) rooms[id].doors=[];
  if(!Array.isArray(rooms[id].history)) rooms[id].history=[];
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
  const nextMap=(findMapAtPoint(room,x,y)||getMapById(room,p&&p.mapId)||{}).id || p.mapId || null;
  return room.players.some(o=>{
    if(!o||o.id===p.id)return false;
    // token em outro mapa não trava movimento
    if((o.mapId||null)!==(nextMap||null))return false;
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


function placeMapBeside(r,m,side,refId){
  r.maps=r.maps||[];
  const gap=40;
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

function emitMapsState(roomName,r){
  ensureMaps(r);
  io.to(roomName).emit('mapsUpdated',{maps:r.maps||[],activeMapId:r.activeMapId,spawnMapId:r.spawnMapId,showNpcPaths:!!r.showNpcPaths,worldMode:true});
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
      const spawn=findFreeSpawn(r,300,300,false);
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
        img:'',mapId:r.spawnMapId||r.activeMapId||null,path:[]
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
  s.emit('mapsUpdated',{maps:r.maps||[],activeMapId:r.activeMapId,spawnMapId:r.spawnMapId,showNpcPaths:!!r.showNpcPaths,worldMode:true});
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
  if(!Number.isFinite(nx) || !Number.isFinite(ny)) return;

  const radius = tokenRadius(p);
  const nextMap = findMapAtPoint(r,nx,ny) || getMapById(r,d.mapId) || getMapById(r,p.mapId);

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

  if(collidesWithToken(r,p,nx,ny)) return reject();

  p.x = nx;
  p.y = ny;
  if(nextMap)p.mapId=nextMap.id;
  p.mapId=p.mapId||r.activeMapId||r.spawnMapId||null;
  p.path=Array.isArray(p.path)?p.path:[];
  const lastPath=p.path[p.path.length-1];
  if(!lastPath||Math.hypot((lastPath[0]||0)-p.x,(lastPath[1]||0)-p.y)>5){p.path.push([Math.round(p.x),Math.round(p.y)]);if(p.path.length>120)p.path=p.path.slice(-120);}
  clampTokenToMapServer(p,r);

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
  if(d.img!==undefined){const img=String(d.img||'');if(img===''||img.startsWith('data:image/')||img.startsWith('http://')||img.startsWith('https://'))p.img=img.slice(0,2000000);}
  if(p.hp>p.maxHp)p.hp=p.maxHp;io.to(s.room).emit('playerUpdated',p);io.to(s.room).emit('playerMoved',p);
 });

 s.on('addNpc',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const c=r.players.filter(p=>p.isNpc).length,hp=Math.max(1,parseInt(d&&d.hp)||10),maxHp=Math.max(1,parseInt(d&&d.maxHp)||hp),ca=Math.max(1,parseInt(d&&d.ca)||10);
  const spawn=findFreeSpawn(r,520+(c%5)*60,300+Math.floor(c/5)*60,true);const npc={id:'npc_'+Date.now()+'_'+Math.random().toString(36).substr(2,5),name:String((d&&d.name)||'NPC').slice(0,35)+' '+(c+1),x:spawn.x,y:spawn.y,hp,maxHp,ca,light:0,ownerId:0,isNpc:true,img:'',mapId:r.spawnMapId||r.activeMapId||null,path:[],mapId:r.spawnMapId||r.activeMapId||null,path:[]};
  r.players.push(npc);io.to(s.room).emit('playerAdded',npc);io.to(s.room).emit('npcAdded',npc);io.to(s.room).emit('state',r);
 });

 s.on('updateNpc',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const p=r.players.find(x=>x.id===d.id);if(!p||!p.isNpc)return;
  if(d.updates)Object.assign(p,d.updates);
  if(d.hp!==undefined)p.hp=num(d.hp,p.hp||0,0,9999);
  if(d.maxHp!==undefined)p.maxHp=num(d.maxHp,p.maxHp||1,1,9999);
  if(d.ca!==undefined)p.ca=num(d.ca,p.ca||10,1,99);
  io.to(s.room).emit('playerUpdated',p);io.to(s.room).emit('playerMoved',p);
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
  const m=sanitizeMapData({name:(d&&d.name)||'Mapa Principal',src:(d&&d.mapData)||'',w:(d&&d.mapW)||(d&&d.w)||1000,h:(d&&d.mapH)||(d&&d.h)||700,x:(d&&d.x)||0,y:(d&&d.y)||0});
  if(!m)return;
  ensureMaps(r);
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
 s.on('setZoom',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s)||!d)return;r.zoom=num(d.zoom,1,.5,3);r.offsetX=num(d.offsetX,0,-100000,100000);r.offsetY=num(d.offsetY,0,-100000,100000);s.to(s.room).emit('zoomUpdated',{zoom:r.zoom,offsetX:r.offsetX,offsetY:r.offsetY});});
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
  if(d && (Number.isFinite(Number(d.x)) || Number.isFinite(Number(d.y)))){
    m.x=Number(d.x)||0;
    m.y=Number(d.y)||0;
  }else{
    placeMapBeside(r,m,String((d&&d.side)||'right'),String((d&&d.refMapId)||r.activeMapId||''));
  }
  r.maps.push(m);
  r.activeMapId=m.id;
  if(!r.spawnMapId)r.spawnMapId=m.id;
  r.worldMode=true;
  r.mapData=m.src;r.mapW=m.w;r.mapH=m.h;
  emitMapsState(s.room,r);
  io.to(s.room).emit('mapUpdated',{src:m.src,w:m.w,h:m.h,id:m.id});
  io.to(s.room).emit('state',r);
});

s.on('moveMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const m=getMapById(r,d&&d.id);
  if(!m)return;
  const oldX=Number(m.x)||0,oldY=Number(m.y)||0;
  const nx=Number(d&&d.x),ny=Number(d&&d.y);
  if(!Number.isFinite(nx)||!Number.isFinite(ny))return;
  const dx=nx-oldX,dy=ny-oldY;
  m.x=nx;m.y=ny;
  if(d&&d.moveTokens){
    for(const p of r.players){
      if(String(p.mapId||'')===String(m.id)){p.x=(Number(p.x)||0)+dx;p.y=(Number(p.y)||0)+dy;}
    }
  }
  emitMapsState(s.room,r);
  io.to(s.room).emit('state',r);
});

s.on('deleteMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const id=String(d&&d.id||d&&d.mapId||'');
  const idx=r.maps.findIndex(m=>String(m.id)===id);
  if(idx<0)return;
  const removed=r.maps[idx];
  r.maps.splice(idx,1);
  const fallback=r.maps[idx]||r.maps[idx-1]||r.maps[0]||null;
  if(r.activeMapId===id)r.activeMapId=fallback?fallback.id:null;
  if(r.spawnMapId===id)r.spawnMapId=r.activeMapId;
  // tokens do mapa deletado vão para o mapa que sobrou; se não sobrou mapa, ficam sem mapId mas não são apagados.
  for(const p of r.players){
    if(String(p.mapId||'')===id){
      if(fallback){
        const spawn=safeMapSpawn(r,fallback.id,(Number(fallback.x)||0)+80,(Number(fallback.y)||0)+80,p);
        p.mapId=fallback.id;p.x=spawn.x;p.y=spawn.y;p.path=[];
      }else{p.mapId=null;p.path=[];}
    }
  }
  if(fallback){r.mapData=fallback.src;r.mapW=fallback.w||0;r.mapH=fallback.h||0;}else{r.mapData=null;r.mapW=0;r.mapH=0;}
  io.to(s.room).emit('mapDeleted',{id,removed});
  emitMapsState(s.room,r);
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
  emitMapsState(s.room,r);
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
  emitMapsState(s.room,r);
});
s.on('sendTokenToMap',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];
  if(!r||!isMaster(s))return;
  ensureMaps(r);
  const id=String(d&&d.mapId||'');
  const target=getMapById(r,id);
  if(!target)return;
  const fromMapId=String((d&&d.fromMapId)||r.activeMapId||'');
  const all=!!(d&&d.all) || String(d&&d.id||'')==='all';
  const list=all ? r.players.filter(p=>!fromMapId || String(p.mapId||'')===fromMapId) : r.players.filter(p=>String(p.id)===String(d&&d.id));
  let i=0;
  for(const p of list){
    const baseX=Number.isFinite(Number(d&&d.x))?Number(d.x):(Number(target.x)||0)+80+(i%5)*55;
    const baseY=Number.isFinite(Number(d&&d.y))?Number(d.y):(Number(target.y)||0)+80+Math.floor(i/5)*55;
    const spawn=safeMapSpawn(r,id,baseX,baseY,p);
    p.mapId=id;p.x=spawn.x;p.y=spawn.y;p.path=[];
    io.to(s.room).emit('playerMoved',p);
    i++;
  }
  io.to(s.room).emit('state',r);
});
s.on('importFullState',d=>{
  if(!isMaster(s))return;
  const roomName=cleanRoom((d&&d.room)||s.room);
  const r=makeRoom(roomName);
  const data=d&&d.state;
  if(!data)return;
  r.players=Array.isArray(data.players)?data.players:[];
  r.walls=Array.isArray(data.walls)?data.walls:[];
  r.doors=Array.isArray(data.doors)?data.doors:[];
  r.maps=Array.isArray(data.maps)?data.maps:[];
  r.activeMapId=data.activeMapId||null;
  r.spawnMapId=data.spawnMapId||null;
  r.mapData=data.mapData||null;
  r.mapW=Number(data.mapW||0)||0;
  r.mapH=Number(data.mapH||0)||0;
  r.fog=!!data.fog;
  r.globalLight=Number(data.globalLight||0)||0;
  if(Array.isArray(r.maps) && d && (Number.isFinite(Number(d.x)) || Number.isFinite(Number(d.dropX)))){
    const dx=Number.isFinite(Number(d.dropX))?Number(d.dropX):Number(d.x);
    const dy=Number.isFinite(Number(d.dropY))?Number(d.dropY):Number(d.y)||0;
    const minX=Math.min(...r.maps.map(m=>Number(m.x)||0));
    const minY=Math.min(...r.maps.map(m=>Number(m.y)||0));
    for(const m of r.maps){m.x=(Number(m.x)||0)-minX+dx;m.y=(Number(m.y)||0)-minY+dy;}
  }
  ensureMaps(r);
  emitMapsState(roomName,r);
  io.to(roomName).emit('state',r);
});
s.on('disconnect',()=>{if(!s.room)return;setTimeout(()=>{const live=io.sockets.adapter.rooms.get(s.room);if(!live||live.size===0)delete rooms[s.room];},5*60*1000);});
});
const PORT = process.env.PORT || 8080;server.listen(PORT,'0.0.0.0',()=>console.log('🍺 Taverna De Bolso - layout antigo na porta '+PORT));
