const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:20e6,cors:{origin:"*"}});
const PORT=process.env.PORT||3000;

app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.send('ok'));

const rooms={};
function cleanRoom(r){return String(r||'mesa1').slice(0,80);}
function newRoom(){
  return {players:[],maps:[],activeMapId:null,walls:[],doors:[],drawings:[],fogEnabled:false,globalLight:false,
    globalSpawns:{player:null,npc:null},ruler:null,cam:{scale:1,offsetX:0,offsetY:0}};
}
function getRoom(r){r=cleanRoom(r);if(!rooms[r])rooms[r]=newRoom();return rooms[r];}
function isMaster(s){return !!s.data.isMaster;}
function emitState(room){io.to(room).emit('state',rooms[room]);}
function mapAt(r,x,y){
  const maps=Array.isArray(r.maps)?r.maps:[];
  for(let i=maps.length-1;i>=0;i--){
    const m=maps[i],mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
    if(x>=mx+2&&y>=my+2&&x<=mx+mw-2&&y<=my+mh-2)return m;
  }
  return null;
}
function clampToMap(r,p){
  let m=mapAt(r,Number(p.x)||0,Number(p.y)||0);
  if(!m&&p.mapId)m=(r.maps||[]).find(mm=>String(mm.id)===String(p.mapId));
  if(!m)m=(r.maps||[])[0];
  if(!m)return p;
  const mx=Number(m.x)||0,my=Number(m.y)||0,mw=Number(m.w)||1000,mh=Number(m.h)||700;
  p.x=Math.max(mx+2,Math.min(mx+mw-2,Number(p.x)||mx+50));
  p.y=Math.max(my+2,Math.min(my+mh-2,Number(p.y)||my+50));
  p.mapId=m.id;
  return p;
}
function normalizeMap(m,i){
  return {id:String(m.id||('map_'+Date.now()+'_'+i)),name:String(m.name||('Mapa '+(i+1))),
    src:m.src||m.mapData||m.data||m.url||'',x:Number(m.x)||0,y:Number(m.y)||0,
    w:Number(m.w||m.mapW||m.width||1000)||1000,h:Number(m.h||m.mapH||m.height||700)||700,z:Number(m.z||i)};
}
function dedupeMaps(maps){
  const out=[],seen=new Set();
  (Array.isArray(maps)?maps:[]).forEach((raw,i)=>{
    const m=normalizeMap(raw,i);
    const key=(m.id==='main')?'main':(m.id||m.src+'|'+Math.round(m.x)+'|'+Math.round(m.y));
    if(seen.has(key))return;
    seen.add(key);out.push(m);
  });
  out.sort((a,b)=>(a.id==='main'?-1:b.id==='main'?1:a.z-b.z));
  out.forEach((m,i)=>m.z=i);
  return out;
}

io.on('connection',s=>{
  s.on('join',d=>{
    const room=cleanRoom(d&&d.room);const r=getRoom(room);
    s.join(room);s.data.room=room;s.data.isMaster=!!d.isMaster;s.data.name=String(d.name||'Jogador').slice(0,60);s.data.pid=String(d.tokenId||s.id);
    if(!s.data.isMaster){
      let p=r.players.find(x=>x.ownerId===s.data.pid||x.id===s.data.pid);
      if(!p){
        const spawn=r.globalSpawns.player||null;
        const m=r.maps[0]||null;
        p={id:s.data.pid,ownerId:s.data.pid,name:s.data.name,isNpc:false,x:spawn?spawn.x:(m?(m.x+80):100),y:spawn?spawn.y:(m?(m.y+80):100),mapId:m?m.id:null,hp:10,hpmax:10,ca:10,light:20,tokenStyle:'topdown',spriteW:32,spriteH:65,facing:1,color:'#c97c3d',img:''};
        r.players.push(p);
      }
      s.emit('you',{pid:s.data.pid,isMaster:false});
    } else {
      s.emit('you',{pid:s.data.pid,isMaster:true});
    }
    emitState(room);
  });

  s.on('setMap',d=>{
    const r=getRoom(d.room); if(!isMaster(s))return;
    const m=normalizeMap({id:'main',name:'Mapa Principal',src:d.src,x:0,y:0,w:d.w||1000,h:d.h||700,z:0},0);
    r.maps=r.maps.filter(x=>x.id!=='main'); r.maps.unshift(m); r.activeMapId='main';
    emitState(s.data.room);
  });

  s.on('addMap',d=>{
    const r=getRoom(d.room); if(!isMaster(s))return;
    r.maps=dedupeMaps(r.maps);
    const active=r.maps.find(m=>m.id===r.activeMapId)||r.maps[0]||{x:0,y:0,w:1000,h:700};
    const w=Number(d.w)||1000,h=Number(d.h)||700;let x=active.x,y=active.y;
    if(d.side==='left')x=active.x-w-80;else if(d.side==='up')y=active.y-h-80;else if(d.side==='down')y=active.y+active.h+80;else x=active.x+active.w+80;
    const m=normalizeMap({id:'map_'+Date.now(),name:d.name||'Mapa',src:d.src,x,y,w,h,z:r.maps.length},r.maps.length);
    r.maps.push(m);r.maps=dedupeMaps(r.maps);r.activeMapId=m.id;emitState(s.data.room);
  });

  s.on('mapsUpdated',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.maps=dedupeMaps(d.maps);if(d.activeMapId!==undefined)r.activeMapId=d.activeMapId;emitState(s.data.room);});
  s.on('deleteMap',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const id=String(d.id);r.maps=r.maps.filter(m=>String(m.id)!==id);if(r.activeMapId===id)r.activeMapId=r.maps[0]?.id||null;emitState(s.data.room);});

  s.on('move',d=>{
    const r=getRoom(d.room);const p=r.players.find(x=>x.id===d.id);if(!p)return;
    if(!isMaster(s) && (p.isNpc || p.ownerId!==s.data.pid))return;
    const oldX=Number(p.x)||0;
    Object.assign(p,{x:Number(d.x),y:Number(d.y)});
    if(Math.abs(p.x-oldX)>1)p.facing=p.x-oldX>=0?-1:1;
    if(d.tokenStyle)p.tokenStyle=d.tokenStyle;if(d.spriteW!==undefined)p.spriteW=Number(d.spriteW);if(d.spriteH!==undefined)p.spriteH=Number(d.spriteH);if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;
    clampToMap(r,p);
    io.to(s.data.room).emit('playerMoved',p);
  });

  s.on('updatePlayer',d=>{
    const r=getRoom(d.room);let p=r.players.find(x=>x.id===d.id);if(!p)return;
    if(!isMaster(s) && p.ownerId!==s.data.pid)return;
    ['name','hp','hpmax','ca','light','img','tokenStyle','spriteW','spriteH','facing','color'].forEach(k=>{if(d[k]!==undefined)p[k]=d[k];});
    io.to(s.data.room).emit('playerUpdated',p);emitState(s.data.room);
  });

  s.on('addNpc',d=>{
    const r=getRoom(d.room);if(!isMaster(s))return;
    const spawn=r.globalSpawns.npc;const m=r.maps.find(x=>x.id===r.activeMapId)||r.maps[0];
    const npc=d.npc||{};npc.id=npc.id||('npc_'+Date.now());npc.isNpc=true; npc.ownerId='master';
    npc.x=Number(npc.x??(spawn?spawn.x:(m?m.x+80:120)));npc.y=Number(npc.y??(spawn?spawn.y:(m?m.y+80:120)));npc.mapId=npc.mapId||(m?m.id:null);
    npc.tokenStyle=npc.tokenStyle||'topdown';npc.spriteW=Number(npc.spriteW)||32;npc.spriteH=Number(npc.spriteH)||65;npc.facing=1;
    r.players.push(npc);io.to(s.data.room).emit('playerUpdated',npc);emitState(s.data.room);
  });

  s.on('deleteToken',d=>{const r=getRoom(d.room);const p=r.players.find(x=>x.id===d.id);if(!p)return;if(!isMaster(s)&&p.ownerId!==s.data.pid)return;r.players=r.players.filter(x=>x.id!==d.id);emitState(s.data.room);});
  s.on('addWall',d=>{const r=getRoom(d.room);if(!isMaster(s))return;if(d.wall)r.walls.push(d.wall);io.to(s.data.room).emit('wallsUpdated',r.walls);emitState(s.data.room);});
  s.on('addDoor',d=>{const r=getRoom(d.room);if(!isMaster(s))return;if(d.door)r.doors.push(d.door);io.to(s.data.room).emit('doorsUpdated',r.doors);emitState(s.data.room);});
  s.on('undoWall',d=>{const r=getRoom(d.room);if(!isMaster(s))return;if(r.doors.length)r.doors.pop();else r.walls.pop();io.to(s.data.room).emit('wallsUpdated',r.walls);io.to(s.data.room).emit('doorsUpdated',r.doors);emitState(s.data.room);});
  s.on('setRuler',d=>{const r=getRoom(d.room);r.ruler=d.ruler||null;io.to(s.data.room).emit('rulerUpdated',r.ruler);});
  s.on('setFog',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.fogEnabled=false;emitState(s.data.room);});
  s.on('setGlobalLight',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.globalLight=false;emitState(s.data.room);});
  s.on('setGlobalSpawn',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const k=d.kind==='npc'?'npc':'player';r.globalSpawns[k]={x:Number(d.x),y:Number(d.y)};emitState(s.data.room);});
  s.on('clearGlobalSpawn',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const k=d.kind;if(k==='both'){r.globalSpawns={player:null,npc:null};}else r.globalSpawns[k]=null;emitState(s.data.room);});
  s.on('importFullState',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const st=d.state||{};r.maps=dedupeMaps(st.maps||[]);r.activeMapId=st.activeMapId||r.maps[0]?.id||null;r.players=Array.isArray(st.players)?st.players:[];r.walls=Array.isArray(st.walls)?st.walls:[];r.doors=Array.isArray(st.doors)?st.doors:[];r.fogEnabled=!!st.fogEnabled;r.globalLight=!!st.globalLight;r.globalSpawns=st.globalSpawns||{player:null,npc:null};emitState(s.data.room);});

s.on('setDoors',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;
  r.doors=Array.isArray(d.doors)?d.doors:[];
  io.to(s.data.room).emit('doorsUpdated',r.doors);
  emitState(s.data.room);
});


s.on('diceRoll',d=>{
  const r=getRoom(d.room);
  if(!d||!d.result)return;
  s.broadcast.to(s.data.room).emit('diceRolled',d.result);
});


s.on('addWallsBatch',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;
  const batch=Array.isArray(d.walls)?d.walls:[];
  batch.forEach(w=>{if(w&&w[0]&&w[1])r.walls.push(w);});
  io.to(s.data.room).emit('wallsUpdated',r.walls);
  emitState(s.data.room);
});

});

server.listen(PORT,()=>console.log('Taverna VTT limpo na porta '+PORT));