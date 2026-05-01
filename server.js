const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection',(s)=>{

  s.on('join',d=>{
    s.join(d.room);
    s.room = d.room;
    s.pid = 'p_'+Math.random().toString(36).slice(2,8);
    s.isMaster = d.isMaster;

    if(!rooms[d.room]) rooms[d.room]={players:[]};

    const player = {
      id:s.pid,
      name:d.name,
      x:100,
      y:100,
      hp:10,
      maxHp:10,
      ca:10,
      light:0,
      ownerId:s.pid,
      isNpc:false
    };

    rooms[d.room].players.push(player);

    s.emit('joined',{pid:s.pid,isMaster:s.isMaster});
    io.to(d.room).emit('playerMoved',player);
  });

  s.on('move',d=>{
    const r = rooms[s.room];
    if(!r) return;

    const p = r.players.find(x=>x.id===d.id);
    if(!p) return;

    p.x = d.x;
    p.y = d.y;

    io.to(s.room).emit('playerMoved',p);
  });

  s.on('updateToken',d=>{
    const r=rooms[s.room];
    if(!r)return;
    const p=r.players.find(x=>x.id===d.token.id);
    if(p){
      Object.assign(p,d.token);
      io.to(s.room).emit('playerMoved',p);
    }
  });

  s.on('deleteToken',d=>{
    const r=rooms[s.room];
    if(!r)return;
    r.players=r.players.filter(p=>p.id!==d.id);
    io.to(s.room).emit('removeToken',d.id);
  });

  s.on('setRuler',d=>{
    io.to(s.room).emit('rulerUpdated',d.ruler);
  });

});

server.listen(process.env.PORT || 3000,()=>console.log('OK'));
