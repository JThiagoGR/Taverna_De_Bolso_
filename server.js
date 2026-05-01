const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.get('/health',(req,res)=>res.status(200).send('ok'));

let rooms = {};

io.on('connection', (s) => {

  s.on('join', d => {
    const room = (d && d.room) || 'mesa';
    s.join(room);
    s.room = room;
    s.pid = 'p_' + Math.random().toString(36).slice(2,8);
    s.isMaster = !!(d && d.isMaster);

    if(!rooms[room]) rooms[room] = {players:[], ruler:null};

    if(!s.isMaster){
      const p = {
        id:s.pid,
        name:(d && d.name) || 'Jogador',
        x:200 + rooms[room].players.length * 30,
        y:200,
        hp:10,
        maxHp:10,
        ca:10,
        light:0,
        ownerId:s.pid,
        isNpc:false
      };
      rooms[room].players.push(p);
    }

    s.emit('joined',{pid:s.pid,isMaster:s.isMaster});
    s.emit('state',rooms[room]);
  });

  s.on('move', d=>{
    const r=rooms[s.room];
    if(!r || !d) return;
    const p=r.players.find(x=>x.id===d.id);
    if(!p) return;

    if(!s.isMaster && p.ownerId !== s.pid) return;

    p.x=Number(d.x);
    p.y=Number(d.y);

    io.to(s.room).emit('playerMoved',p);
  });

  s.on('addNpc', d=>{
    const r=rooms[s.room];
    if(!r || !s.isMaster) return;

    const p = {
      id:'npc_'+Date.now(),
      name:(d && d.name) || 'NPC',
      x:300,
      y:300,
      hp:10,
      maxHp:10,
      ca:10,
      light:0,
      ownerId:0,
      isNpc:true
    };

    r.players.push(p);
    io.to(s.room).emit('playerMoved',p);
  });

  s.on('updateToken', d=>{
    const r=rooms[s.room];
    if(!r || !d || !d.token) return;
    const p=r.players.find(x=>x.id===d.token.id);
    if(!p) return;

    if(!s.isMaster && p.ownerId !== s.pid) return;

    Object.assign(p,d.token);
    io.to(s.room).emit('playerMoved',p);
  });

  s.on('deleteToken', d=>{
    const r=rooms[s.room];
    if(!r || !d) return;
    const p=r.players.find(x=>x.id===d.id);
    if(!p) return;

    if(!s.isMaster && p.ownerId !== s.pid) return;

    r.players=r.players.filter(p=>p.id!==d.id);
    io.to(s.room).emit('removeToken',d.id);
  });

  s.on('setRuler', d=>{
    const r=rooms[s.room];
    if(!r) return;
    r.ruler = d ? d.ruler : null;
    io.to(s.room).emit('rulerUpdated',r.ruler);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT,'0.0.0.0',()=>console.log('Taverna De Bolso rodando na porta '+PORT));
