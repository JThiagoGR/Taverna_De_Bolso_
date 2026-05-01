let socket = io();
let me=null;
let players=[];
let dragging=null;
let inputMode=null;

function join(master){
  me={room:'mesa',name:'Jogador',isMaster:master};
  socket.emit('join',me);
  document.getElementById('login').style.display='none';
}

socket.on('joined',d=>{
  me.pid=d.pid;
});

socket.on('playerMoved',p=>{
  let t=players.find(x=>x.id===p.id);
  if(t){
    t.x=p.x; t.y=p.y;
  }else{
    players.push(p);
  }
  draw();
});

socket.on('removeToken',id=>{
  players=players.filter(p=>p.id!==id);
});

function draw(){
  const c=document.getElementById('c');
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);

  players.forEach(p=>{
    ctx.fillStyle='green';
    ctx.fillRect(p.x,p.y,20,20);
  });
}

function openPlayerSheet(token){
  document.getElementById('sheetUI').style.display='block';
  f_name.value=token.name;
  current=token;
}

function saveSheet(){
  current.name=f_name.value;
  socket.emit('updateToken',{token:current});
}

let current=null;
