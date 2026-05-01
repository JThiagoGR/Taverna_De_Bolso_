let socket = io();
let me=null;
let players=[];
let dragging=null;
let tool='move';
let ruler=null;
let current=null;

const canvas=document.getElementById('canvas');
const ctx=canvas.getContext('2d');

function join(master){
  const name=document.getElementById('name').value || 'Jogador';
  const room=document.getElementById('room').value || 'mesa';

  me={room,name,isMaster:master,pid:null};
  socket.emit('join',me);

  document.getElementById('login').style.display='none';
  document.getElementById('toolbar').style.display='block';
  if(master) document.getElementById('masterPanel').style.display='block';
}

socket.on('joined', d=>{
  me.pid=d.pid;
  me.isMaster=d.isMaster;
});

socket.on('state', state=>{
  players=state.players || [];
  ruler=state.ruler || null;
  draw();
});

socket.on('playerMoved', p=>{
  let t=players.find(x=>x.id===p.id);
  if(t) Object.assign(t,p);
  else players.push(p);
  draw();
});

socket.on('removeToken', id=>{
  players=players.filter(p=>p.id!==id);
  draw();
});

socket.on('rulerUpdated', r=>{
  ruler=r;
  draw();
});

function setTool(t){
  tool=t;
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle='#202020';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  players.forEach(p=>{
    ctx.fillStyle=p.isNpc?'#9b59b6':'#2ecc71';
    ctx.beginPath();
    ctx.arc(p.x,p.y,15,0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle='white';
    ctx.font='12px Arial';
    ctx.fillText(p.name,p.x-15,p.y-20);
  });

  if(ruler){
    ctx.strokeStyle='red';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(ruler.a[0],ruler.a[1]);
    ctx.lineTo(ruler.b[0],ruler.b[1]);
    ctx.stroke();

    const dist=Math.round(Math.hypot(ruler.b[0]-ruler.a[0],ruler.b[1]-ruler.a[1]));
    ctx.fillStyle='white';
    ctx.fillText(dist+' px',ruler.b[0]+5,ruler.b[1]+5);
  }
}

function findToken(x,y){
  return players.find(p=>Math.hypot(p.x-x,p.y-y)<20);
}

canvas.onmousedown=e=>{
  const x=e.offsetX;
  const y=e.offsetY;

  if(tool==='ruler'){
    ruler={a:[x,y],b:[x,y]};
    return;
  }

  if(tool==='move'){
    const t=findToken(x,y);
    if(!t) return;
    if(!me.isMaster && t.ownerId!==me.pid) return;
    dragging=t;
  }
};

canvas.onmousemove=e=>{
  const x=e.offsetX;
  const y=e.offsetY;

  if(tool==='ruler' && ruler){
    ruler.b=[x,y];
    socket.emit('setRuler',{ruler});
    draw();
    return;
  }

  if(dragging){
    dragging.x=x;
    dragging.y=y;
    socket.emit('move',{id:dragging.id,x,y});
    draw();
  }
};

canvas.onmouseup=e=>{
  if(tool==='ruler'){
    socket.emit('setRuler',{ruler:null});
    ruler=null;
    draw();
  }
  dragging=null;
};

canvas.ondblclick=e=>{
  const t=findToken(e.offsetX,e.offsetY);
  if(t) openPlayerSheet(t);
};

function openPlayerSheet(t){
  if(!me.isMaster && t.ownerId!==me.pid) return;

  current=t;
  document.getElementById('sheet').style.display='block';

  document.getElementById('f_name').value=t.name || '';
  document.getElementById('f_hp').value=t.hp || 0;
  document.getElementById('f_max').value=t.maxHp || 10;
  document.getElementById('f_ca').value=t.ca || 10;

  document.getElementById('deleteBtn').style.display=me.isMaster?'inline-block':'none';
}

function saveSheet(){
  if(!current) return;

  current.name=document.getElementById('f_name').value;
  current.hp=Number(document.getElementById('f_hp').value);
  current.maxHp=Number(document.getElementById('f_max').value);
  current.ca=Number(document.getElementById('f_ca').value);

  socket.emit('updateToken',{token:current});
  closeSheet();
}

function closeSheet(){
  document.getElementById('sheet').style.display='none';
  current=null;
}

function deleteToken(){
  if(!current) return;
  socket.emit('deleteToken',{id:current.id});
  closeSheet();
}

function addNpc(){
  socket.emit('addNpc',{name:document.getElementById('npcName').value || 'NPC'});
}
