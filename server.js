const express=require('express');const http=require('http');const {Server}=require('socket.io');const path=require('path');
const app=express();const server=http.createServer(app);const io=new Server(server,{cors:{origin:'*'},maxHttpBufferSize:10e6});
app.use(express.static(path.join(__dirname,'public')));
const rooms={};

function cleanRoom(room){return String(room||'mesa1').trim().replace(/[^\w\- ]/g,'').slice(0,50)||'mesa1';}
function makeRoom(room){const id=cleanRoom(room);rooms[id]=rooms[id]||{players:[],walls:[],mapData:null,fog:false,globalLight:0,zoom:1,offsetX:0,offsetY:0,ruler:null};return rooms[id];}
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
  return distPointToSeg(x,y,w[0][0],w[0][1],w[1][0],w[1][1])<radius;
}
function tokenRadius(p){return 14;}
function collidesWithToken(room,p,x,y){
  const r=tokenRadius(p);
  return room.players.some(o=>{
    if(!o||o.id===p.id)return false;
    const rr=r+tokenRadius(o);
    return Math.hypot(o.x-x,o.y-y)<rr;
  });
}
function sanitizeWall(w){if(!Array.isArray(w)||w.length!==2)return null;const a=w[0],b=w[1];if(!Array.isArray(a)||!Array.isArray(b))return null;return [[Math.round(Number(a[0])||0),Math.round(Number(a[1])||0)],[Math.round(Number(b[0])||0),Math.round(Number(b[1])||0)]];}

io.on('connection',s=>{
 s.on('join',d=>{
  if(!d||!d.room)return;
  const roomName=cleanRoom(d.room),r=makeRoom(roomName);
  s.room=roomName;
  s.isMaster=!!d.isMaster;
  s.pid=s.isMaster?'master_'+roomName:(d.tokenId?String(d.tokenId).slice(0,60):makeId(d.name,roomName));
  s.join(roomName);

  // Mestre NÃO cria token automático.
  // Também remove qualquer token antigo de Mestre que tenha ficado na sala.
  r.players=r.players.filter(p=>p.isNpc||!(p.isMaster===true||String(p.id||'').startsWith('master_')||String(p.ownerId||'').startsWith('master_')));

  // Só jogador cria token automático ao entrar.
  if(!s.isMaster){
    let p=r.players.find(x=>x.id===s.pid);
    if(!p){
      p={
        id:s.pid,
        name:String(d.name||'Jogador').slice(0,40),
        x:400,
        y:300,
        hp:10,
        maxHp:10,
        ca:10,
        light:6,
        ownerId:s.pid,
        isNpc:false,
        isMaster:false,
        img:''
      };
      r.players.push(p);
    }else{
      p.name=String(d.name||p.name||'Jogador').slice(0,40);
      p.isMaster=false;
      if(p.light===undefined||p.light===null||p.light==='')p.light=6;
    }
  }

  s.emit('joined',{pid:s.pid,isMaster:s.isMaster});
  s.emit('zoomUpdated',{zoom:r.zoom,offsetX:r.offsetX,offsetY:r.offsetY});
  s.emit('rulerUpdated',r.ruler);
  io.to(roomName).emit('state',r);
 });

 s.on('move',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!d)return;
  const p=r.players.find(x=>x.id===d.id);if(!p||!canControl(s,p))return;
  const nx=Number(d.x),ny=Number(d.y);if(!Number.isFinite(nx)||!Number.isFinite(ny))return;
  const radius=tokenRadius(p);
  for(const w of r.walls){
    if(lineIntersect(p.x,p.y,nx,ny,w[0][0],w[0][1],w[1][0],w[1][1]))return;
    if(blockedByWallWithRadius(nx,ny,w,radius))return;
  }
  if(collidesWithToken(r,p,nx,ny))return;
  p.x=nx;p.y=ny;io.to(s.room).emit('playerMoved',p);io.to(s.room).emit('moved',{id:p.id,x:nx,y:ny});
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
  if(p.hp>p.maxHp)p.hp=p.maxHp;io.to(s.room).emit('playerUpdated',p);
 });

 s.on('addNpc',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const c=r.players.filter(p=>p.isNpc).length,hp=Math.max(1,parseInt(d&&d.hp)||10),maxHp=Math.max(1,parseInt(d&&d.maxHp)||hp),ca=Math.max(1,parseInt(d&&d.ca)||10);
  const npc={id:'npc_'+Date.now()+'_'+Math.random().toString(36).substr(2,5),name:String((d&&d.name)||'NPC').slice(0,35)+' '+(c+1),x:400+(c%5)*60,y:300+Math.floor(c/5)*60,hp,maxHp,ca,light:0,ownerId:s.pid,isNpc:true,img:''};
  r.players.push(npc);io.to(s.room).emit('playerAdded',npc);io.to(s.room).emit('npcAdded',npc);io.to(s.room).emit('state',r);
 });

 s.on('updateNpc',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;
  const p=r.players.find(x=>x.id===d.id);if(!p||!p.isNpc)return;
  if(d.updates)Object.assign(p,d.updates);
  if(d.hp!==undefined)p.hp=num(d.hp,p.hp||0,0,9999);
  if(d.maxHp!==undefined)p.maxHp=num(d.maxHp,p.maxHp||1,1,9999);
  if(d.ca!==undefined)p.ca=num(d.ca,p.ca||10,1,99);
  io.to(s.room).emit('playerUpdated',p);
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
 s.on('clearWalls',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.walls=[];io.to(s.room).emit('wallsCleared');});
 s.on('clearAll',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.walls=[];r.players=r.players.filter(p=>!p.isNpc);r.mapData=null;r.ruler=null;io.to(s.room).emit('allCleared');io.to(s.room).emit('state',r);});
 s.on('setMap',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.mapData=String(d.mapData||'').slice(0,9000000);io.to(s.room).emit('mapUpdated',r.mapData);io.to(s.room).emit('mapSet',r.mapData);});
 s.on('setFog',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.fog=!!d.fog;io.to(s.room).emit('fogUpdated',r.fog);io.to(s.room).emit('fogSet',r.fog);});
 s.on('setLight',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.globalLight=Number(d.light)?1:0;io.to(s.room).emit('lightUpdated',r.globalLight);io.to(s.room).emit('lightSet',r.globalLight);});
 s.on('setGlobalLight',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s))return;r.globalLight=Number(d.light)?1:0;io.to(s.room).emit('lightUpdated',r.globalLight);io.to(s.room).emit('lightSet',r.globalLight);});
 s.on('setZoom',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!isMaster(s)||!d)return;r.zoom=num(d.zoom,1,.5,3);r.offsetX=num(d.offsetX,0,-100000,100000);r.offsetY=num(d.offsetY,0,-100000,100000);s.to(s.room).emit('zoomUpdated',{zoom:r.zoom,offsetX:r.offsetX,offsetY:r.offsetY});});
 s.on('setRuler',d=>{const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r)return;r.ruler=d.ruler||null;io.to(s.room).emit('rulerUpdated',r.ruler);});
 s.on('roll',d=>{const room=cleanRoom(d&&d.room)||s.room;io.to(room).emit('rollResult',d);if(d&&d.roll)io.to(room).emit('diceRolled',{player:String(d.name||'Jogador'),notation:'1d20',rolls:[d.roll],total:d.roll,mod:0});});
 s.on('rollDice',d=>{
  const r=rooms[cleanRoom(d&&d.room)]||rooms[s.room];if(!r||!d)return;
  const m=String(d.notation||'1d20').match(/(\d*)d(\d+)([+-]\d+)?/i);if(!m)return;
  const count=Math.max(1,Math.min(30,parseInt(m[1]||1))),sides=Math.max(2,Math.min(1000,parseInt(m[2]))),mod=parseInt(m[3]||0);
  const rolls=Array.from({length:count},()=>1+Math.floor(Math.random()*sides)),total=rolls.reduce((a,b)=>a+b,0)+mod;
  io.to(s.room).emit('diceRolled',{player:String(d.player||'Jogador').slice(0,40),notation:String(d.notation).slice(0,40),rolls,total,mod});
 });
 s.on('disconnect',()=>{if(!s.room)return;setTimeout(()=>{const live=io.sockets.adapter.rooms.get(s.room);if(!live||live.size===0)delete rooms[s.room];},5*60*1000);});
});
const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log('🍺 Taverna De Bolso - layout antigo na porta '+PORT));
