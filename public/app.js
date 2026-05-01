let socket = io();
let me=null;
let players=[];
let dragging=null;
let tool='move';
let ruler=null;
let current=null;

function join(master){
  me={room:'mesa',name:'Player',isMaster:master};
  socket.emit('join',me);
  login.style.display='none';
}

socket.on('joined', d=> me.pid=d.pid);

socket.on('playerMoved', p=>{
  let t=players.find(x=>x.id===p.id);
  if(t){Object.assign(t,p);}
  else players.push(p);
  draw();
});

socket.on('removeToken', id=>{
  players=players.filter(p=>p.id!==id);
});

socket.on('rulerUpdated', r=>{
  ruler=r;
  draw();
});

function draw(){
  let c=canvas;
  let ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);

  players.forEach(p=>{
    ctx.fillStyle='green';
    ctx.fillRect(p.x,p.y,20,20);
  });

  if(ruler){
    ctx.strokeStyle='red';
    ctx.beginPath();
    ctx.moveTo(ruler.a[0],ruler.a[1]);
    ctx.lineTo(ruler.b[0],ruler.b[1]);
    ctx.stroke();
  }
}

canvas.onmousedown=e=>{
  let x=e.offsetX,y=e.offsetY;

  if(tool==='ruler'){
    ruler={a:[x,y],b:[x,y]};
    return;
  }

  let t=players.find(p=>Math.abs(p.x-x)<20 && Math.abs(p.y-y)<20);
  if(t){dragging=t;}
};

canvas.onmousemove=e=>{
  let x=e.offsetX,y=e.offsetY;

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
  }
};

canvas.onmouseup=e=>{
  if(tool==='ruler'){
    socket.emit('setRuler',{ruler:null});
    ruler=null;
  }
  dragging=null;
};

function openPlayerSheet(t){
  current=t;
  sheet.style.display='block';
  f_name.value=t.name;
}

function saveSheet(){
  current.name=f_name.value;
  socket.emit('updateToken',{token:current});
  sheet.style.display='none';
}

function deleteToken(){
  socket.emit('deleteToken',{id:current.id});
  sheet.style.display='none';
}
