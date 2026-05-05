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
function newRoom(){return{players:[],maps:[],activeMapId:null,walls:[],doors:[],drawings:[],globalSpawns:{player:null,npc:null},ruler:null,dynamicVision:true,history:[]};}
function getRoom(r){r=cleanRoom(r);if(!rooms[r])rooms[r]=newRoom();return rooms[r];}
function isMaster(s){return !!s.data.isMaster;}
function emitState(room){io.to(room).emit('state',rooms[room]);}
function normMap(m,i){return{id:String(m.id||('map_'+Date.now()+'_'+i)),name:String(m.name||('Mapa '+(i+1))),src:m.src||'',x:Number(m.x)||0,y:Number(m.y)||0,w:Number(m.w)||1000,h:Number(m.h)||700,z:Number(m.z)||i};}
function mapAt(r,x,y){for(let i=r.maps.length-1;i>=0;i--){const m=r.maps[i];if(x>=m.x+2&&y>=m.y+2&&x<=m.x+m.w-2&&y<=m.y+m.h-2)return m;}return null;}
function clamp(r,p){let m=mapAt(r,Number(p.x)||0,Number(p.y)||0)||r.maps.find(mm=>mm.id===p.mapId)||r.maps[0];if(!m)return p;p.x=Math.max(m.x+2,Math.min(m.x+m.w-2,Number(p.x)||m.x+50));p.y=Math.max(m.y+2,Math.min(m.y+m.h-2,Number(p.y)||m.y+50));p.mapId=m.id;return p;}

io.on('connection',s=>{
  s.on('join',d=>{
    const room=cleanRoom(d.room);const r=getRoom(room);
    s.join(room);s.data.room=room;s.data.isMaster=!!d.isMaster;s.data.name=String(d.name||'Jogador');s.data.pid=String(d.tokenId||s.id);
    if(!s.data.isMaster){
      let p=r.players.find(x=>x.ownerId===s.data.pid||x.id===s.data.pid);
      if(!p){
        const sp=r.globalSpawns.player,m=r.maps[0];
        p={id:s.data.pid,ownerId:s.data.pid,name:s.data.name,isNpc:false,x:sp?sp.x:(m?m.x+80:100),y:sp?sp.y:(m?m.y+80:100),mapId:m?m.id:null,hp:10,hpmax:10,ca:10,light:20,tokenStyle:'topdown',spriteW:32,spriteH:65,facing:1,color:'#c97c3d',img:''};
        r.players.push(p);
      }
    }
    s.emit('you',{pid:s.data.pid,isMaster:s.data.isMaster});
    emitState(room);
  });
  s.on('setMap',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const m=normMap({id:'main',name:'Mapa Principal',src:d.src,x:0,y:0,w:d.w,h:d.h,z:0},0);r.maps=r.maps.filter(x=>x.id!=='main');r.maps.unshift(m);r.activeMapId='main';emitState(s.data.room);});
  s.on('addMap',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const a=r.maps.find(m=>m.id===r.activeMapId)||r.maps[0]||{x:0,y:0,w:1000,h:700};const w=Number(d.w)||1000,h=Number(d.h)||700;let x=a.x+a.w+80,y=a.y;if(d.side==='left')x=a.x-w-80;if(d.side==='up'){x=a.x;y=a.y-h-80}if(d.side==='down'){x=a.x;y=a.y+a.h+80}const m=normMap({id:'map_'+Date.now(),name:d.name||'Mapa',src:d.src,x,y,w,h,z:r.maps.length},r.maps.length);r.maps.push(m);r.activeMapId=m.id;emitState(s.data.room);});
  s.on('mapsUpdated',d=>{const r=getRoom(d.room);if(!isMaster(s))return;if(Array.isArray(d.maps))r.maps=d.maps.map(normMap);if(d.activeMapId!==undefined)r.activeMapId=d.activeMapId;emitState(s.data.room);});
  s.on('deleteMap',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.maps=r.maps.filter(m=>String(m.id)!==String(d.id));if(r.activeMapId===d.id)r.activeMapId=r.maps[0]?.id||null;emitState(s.data.room);});
  s.on('move',d=>{const r=getRoom(d.room);const p=r.players.find(x=>x.id===d.id);if(!p)return;if(!isMaster(s)&&(p.isNpc||p.ownerId!==s.data.pid))return;Object.assign(p,{x:Number(d.x),y:Number(d.y)});if(d.facing!==undefined)p.facing=Number(d.facing)||p.facing;if(d.tokenStyle)p.tokenStyle=d.tokenStyle;if(d.spriteW!==undefined)p.spriteW=Number(d.spriteW);if(d.spriteH!==undefined)p.spriteH=Number(d.spriteH);clamp(r,p);io.to(s.data.room).emit('playerMoved',p);});
  s.on('updatePlayer',d=>{const r=getRoom(d.room);const p=r.players.find(x=>x.id===d.id);if(!p)return;if(!isMaster(s)&&p.ownerId!==s.data.pid)return;['name','hp','hpmax','ca','light','img','tokenStyle','spriteW','spriteH','facing','color'].forEach(k=>{if(d[k]!==undefined)p[k]=d[k]});io.to(s.data.room).emit('playerUpdated',p);emitState(s.data.room);});
  s.on('addNpc',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const npc=d.npc||{};npc.id=npc.id||('npc_'+Date.now());npc.isNpc=true;npc.ownerId='master';r.players.push(npc);io.to(s.data.room).emit('playerUpdated',npc);emitState(s.data.room);});
  s.on('deleteToken',d=>{const r=getRoom(d.room);const p=r.players.find(x=>x.id===d.id);if(!p)return;if(!isMaster(s)&&p.ownerId!==s.data.pid)return;r.players=r.players.filter(x=>x.id!==d.id);emitState(s.data.room);});
  s.on('addWall',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;
  if(d.wall){r.walls.push(d.wall);r.history.push({type:'walls',count:1});}
  io.to(s.data.room).emit('wallsUpdated',r.walls);
  emitState(s.data.room);
});
  s.on('addWallsBatch',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;
  const batch=Array.isArray(d.walls)?d.walls:[];
  let count=0;
  batch.forEach(w=>{if(w&&w[0]&&w[1]){r.walls.push(w);count++;}});
  if(count>0) r.history.push({type:'walls',count});
  io.to(s.data.room).emit('wallsUpdated',r.walls);
  emitState(s.data.room);
});
  s.on('addDoor',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;
  if(d.door){r.doors.push(d.door);r.history.push({type:'door',count:1});}
  io.to(s.data.room).emit('doorsUpdated',r.doors);
  emitState(s.data.room);
});
  s.on('setDoors',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.doors=Array.isArray(d.doors)?d.doors:[];io.to(s.data.room).emit('doorsUpdated',r.doors);emitState(s.data.room);});
  s.on('undoWall',d=>{
  const r=getRoom(d.room); if(!isMaster(s))return;

  const last = Array.isArray(r.history) ? r.history.pop() : null;

  if(last && last.type === 'door'){
    if(r.doors.length) r.doors.pop();
  } else if(last && last.type === 'walls'){
    const count = Math.max(1, Number(last.count)||1);
    r.walls.splice(Math.max(0, r.walls.length-count), count);
  } else {
    // fallback para cenas antigas sem histórico
    if(r.walls.length) r.walls.pop();
    else if(r.doors.length) r.doors.pop();
  }

  io.to(s.data.room).emit('wallsUpdated',r.walls);
  io.to(s.data.room).emit('doorsUpdated',r.doors);
  emitState(s.data.room);
});
  s.on('setRuler',d=>{const r=getRoom(d.room);r.ruler=d.ruler||null;io.to(s.data.room).emit('rulerUpdated',r.ruler);});
  s.on('setGlobalSpawn',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.globalSpawns[d.kind==='npc'?'npc':'player']={x:Number(d.x),y:Number(d.y)};emitState(s.data.room);});
  s.on('clearGlobalSpawn',d=>{const r=getRoom(d.room);if(!isMaster(s))return;if(d.kind==='both')r.globalSpawns={player:null,npc:null};else r.globalSpawns[d.kind]=null;emitState(s.data.room);});
  s.on('diceRoll',d=>{if(d&&d.result)s.broadcast.to(s.data.room).emit('diceRolled',d.result);});
  s.on('setDynamicVision',d=>{const r=getRoom(d.room);if(!isMaster(s))return;r.dynamicVision=!!d.value;io.to(s.data.room).emit('dynamicVisionUpdated',r.dynamicVision);emitState(s.data.room);});
  s.on('importFullState',d=>{const r=getRoom(d.room);if(!isMaster(s))return;const st=d.state||{};r.maps=Array.isArray(st.maps)?st.maps:[];r.activeMapId=st.activeMapId||r.maps[0]?.id||null;r.players=Array.isArray(st.players)?st.players:[];r.walls=Array.isArray(st.walls)?st.walls:[];r.doors=Array.isArray(st.doors)?st.doors:[];r.globalSpawns=st.globalSpawns||{player:null,npc:null};r.dynamicVision=st.dynamicVision!==undefined?!!st.dynamicVision:r.dynamicVision;emitState(s.data.room);});
});
server.listen(PORT,()=>console.log('Taverna VTT na porta '+PORT));