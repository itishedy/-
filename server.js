const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

const TILE_COUNTS = {
  '我':3,'你':3,'他':2,'她':2,'的':4,'了':3,'是':2,'不':3,'在':2,'把':2,'被':2,'又':2,'还':1,'都':1,'就':1,'只':1,'要':1,'给':2,'和':1,'跟':1,'敢':1,'竟':1,'真':1,'别':1,'没':1,'吗':1,'啊':1,
  '老':3,'板':3,'店':2,'长':2,'前':2,'任':2,'陪':3,'玩':3,'哥':2,'姐':2,'客':1,'人':1,'主':1,'播':1,'粉':1,'友':1,'鸡':2,'鸭':2,'宝':1,'贝':1,'富':1,'婆':1,
  '游':1,'戏':1,'局':2,'排':1,'位':1,'分':1,'段':1,'上':2,'下':1,'输':1,'赢':1,'开':1,'黑':2,'组':1,'队':1,'野':1,'王':1,'者':1,'号':1,'服':1,'区':1,'麦':2,'语':1,'音':1,'房':2,'间':1,'单':3,'双':1,'坑':2,'带':2,
  '接':2,'点':2,'包':1,'时':1,'钟':1,'钱':3,'付':1,'款':1,'退':2,'续':1,'加':2,'价':1,'免':1,'费':1,'礼':2,'物':2,'刷':2,'榜':1,
  '爱':2,'亲':1,'抱':1,'哄':2,'骗':2,'绿':1,'追':1,'删':2,'拉':2,'吃':1,'醋':1,'哭':1,'舔':1,'跪':1,'跑':1,'找':1,'换':1,'选':1,'抢':1,
  '菜':2,'猛':1,'强':1,'弱':1,'疯':2,'傻':1,'急':1,'惨':1,'穷':1,'帅':1,'丑':1,'甜':1,'凶':1,'冷':1,'热':1,'气':1,'酸':1,'爽':1,'麻':1,'挂':1,'夜':1,'躺':1,'飞':1,'掉':1,'炸':1
};

function buildDeck(){
  const deck=[];
  for(const [ch,n] of Object.entries(TILE_COUNTS)) for(let i=0;i<n;i++) deck.push(ch);
  for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s='';
  do { s=''; for(let i=0;i<5;i++) s+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(s));
  return s;
}
function pendingVoteView(room, socketId){
  const pd=room.pendingDiscard;
  if(!pd) return null;
  const eligible=room.players.filter(p=>p.id!==pd.playerId).length;
  const votes=Object.values(pd.votes);
  const yes=votes.filter(Boolean).length;
  const no=votes.filter(v=>v===false).length;
  return {
    playerId:pd.playerId,
    playerName:pd.playerName,
    tiles:pd.tiles,
    yes,
    no,
    eligible,
    needed:Math.floor(eligible/2)+1,
    myVote:Object.prototype.hasOwnProperty.call(pd.votes,socketId) ? pd.votes[socketId] : null
  };
}
function roomView(room, socketId){
  const me=room.players.find(p=>p.id===socketId);
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    currentPlayerId: room.started ? room.players[room.turn]?.id : null,
    players: room.players.map(p=>({id:p.id,name:p.name,handCount:p.hand.length,hasDrawn:p.hasDrawn})),
    hand: me ? me.hand : [],
    discardGroups: room.discardGroups,
    pendingDiscard: pendingVoteView(room,socketId),
    lastWin: room.lastWin,
    deckCount: room.deck.length
  };
}
function broadcast(room){ room.players.forEach(p=>io.to(p.id).emit('state', roomView(room,p.id))); }
function addLog(room, text){ io.to(room.code).emit('log', text); }
function startRound(room, isRestart=false){
  room.deck=buildDeck();
  room.discardGroups=[];
  room.pendingDiscard=null;
  room.turn=0;
  room.started=true;
  room.lastWin=null;
  room.players.forEach(p=>{ p.hand=[]; p.hasDrawn=false; });
  for(let r=0;r<13;r++) for(const p of room.players) p.hand.push(room.deck.pop());
  addLog(room, isRestart ? '🔄 房主已重开本局，重新发牌。' : '游戏开始！每人13张；轮到你时先摸牌，再打出至少3个字，其他玩家投票过半才算成功。');
  broadcast(room);
}
function advanceTurn(room, playerId){
  const idx=room.players.findIndex(x=>x.id===playerId);
  room.turn=room.players.length ? (idx+1)%room.players.length : 0;
}

function resolvePendingDiscard(room, approved){
  const pd=room.pendingDiscard;
  if(!pd) return;
  const p=room.players.find(x=>x.id===pd.playerId);
  room.pendingDiscard=null;

  if(!p){ broadcast(room); return; }

  if(approved){
    room.discardGroups.push({player:p.name,tiles:pd.tiles});
    let replenished=0;
    while(p.hand.length<13 && room.deck.length){ p.hand.push(room.deck.pop()); replenished++; }
    p.hasDrawn=false;
    addLog(room,`✅ 「${pd.tiles.join('')}」获得过半认可，${p.name} 出牌成功${replenished?`，并补了${replenished}张`:''}`);
    advanceTurn(room,p.id);
  }else{
    p.hand.push(...pd.tiles);
    p.hasDrawn=true;
    addLog(room,`❌ 「${pd.tiles.join('')}」未获过半认可，牌已退回 ${p.name}，请重新出牌或选择跳过`);
  }
  broadcast(room);
}

function checkPendingVote(room){
  const pd=room.pendingDiscard;
  if(!pd) return;
  const eligibleIds=room.players.filter(p=>p.id!==pd.playerId).map(p=>p.id);
  for(const id of Object.keys(pd.votes)) if(!eligibleIds.includes(id)) delete pd.votes[id];
  const eligible=eligibleIds.length;
  if(eligible===0){ resolvePendingDiscard(room,true); return; }
  const needed=Math.floor(eligible/2)+1;
  const votes=Object.values(pd.votes);
  const yes=votes.filter(Boolean).length;
  const no=votes.filter(v=>v===false).length;
  if(yes>=needed) return resolvePendingDiscard(room,true);
  const remaining=eligible-yes-no;
  if(yes+remaining<needed) return resolvePendingDiscard(room,false);
  broadcast(room);
}

io.on('connection', socket=>{
  socket.on('createRoom', ({name})=>{
    name=String(name||'玩家').trim().slice(0,16)||'玩家';
    const code=roomCode();
    const room={code,hostId:socket.id,players:[{id:socket.id,name,hand:[],hasDrawn:false}],deck:[],discardGroups:[],pendingDiscard:null,turn:0,started:false,lastWin:null};
    rooms.set(code,room); socket.join(code); socket.data.room=code;
    broadcast(room);
  });
  socket.on('joinRoom', ({code,name})=>{
    code=String(code||'').trim().toUpperCase(); name=String(name||'玩家').trim().slice(0,16)||'玩家';
    const room=rooms.get(code); if(!room) return socket.emit('errorMsg','房间不存在');
    if(room.started) return socket.emit('errorMsg','游戏已经开始');
    if(room.players.length>=8) return socket.emit('errorMsg','房间已满（最多8人）');
    room.players.push({id:socket.id,name,hand:[],hasDrawn:false}); socket.join(code); socket.data.room=code;
    addLog(room, `${name} 加入了房间`); broadcast(room);
  });
  socket.on('startGame', ()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    if(room.hostId!==socket.id) return socket.emit('errorMsg','只有房主可以开始');
    if(room.players.length<2) return socket.emit('errorMsg','至少需要2名玩家');
    startRound(room,false);
  });
  socket.on('restartGame', ()=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    if(room.hostId!==socket.id) return socket.emit('errorMsg','只有房主可以重开');
    if(room.players.length<2) return socket.emit('errorMsg','至少需要2名玩家');
    startRound(room,true);
  });
  socket.on('draw', ()=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','正在等待大家投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(p.hasDrawn || p.hand.length>=14) return socket.emit('errorMsg','你已经有14张牌了，请出牌、胡牌或跳过');
    if(!room.deck.length) return socket.emit('errorMsg','牌堆已经空了');
    p.hand.push(room.deck.pop()); p.hasDrawn=true; addLog(room,`${p.name} 摸了一张牌`); broadcast(room);
  });
  socket.on('skipTurn', ()=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','正在等待大家投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(!p.hasDrawn && p.hand.length<14) return socket.emit('errorMsg','请先摸牌再跳过');
    p.hasDrawn=true;
    addLog(room,`⏭️ ${p.name} 选择跳过，本轮不出牌`);
    advanceTurn(room,p.id);
    broadcast(room);
  });
  socket.on('discard', ({indices})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','上一组出牌还在等待投票');
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('errorMsg','还没轮到你');
    if(!p.hasDrawn && p.hand.length<14) return socket.emit('errorMsg','请先摸牌');

    if(!Array.isArray(indices)) return socket.emit('errorMsg','请选择至少3张牌');
    const clean=[];
    const seen=new Set();
    for(const raw of indices){
      const i=Number(raw);
      if(!Number.isInteger(i)||i<0||i>=p.hand.length) return socket.emit('errorMsg','选中的牌无效');
      if(seen.has(i)) continue;
      seen.add(i);
      clean.push(i);
    }
    if(clean.length<3) return socket.emit('errorMsg','每次出牌至少需要3个字');

    // 保留玩家点击牌面的先后顺序，用这个顺序展示出牌。
    const tiles=clean.map(i=>p.hand[i]);
    for(const i of [...clean].sort((a,b)=>b-a)) p.hand.splice(i,1);
    room.pendingDiscard={playerId:p.id,playerName:p.name,tiles,votes:{}};
    addLog(room,`🗳️ ${p.name} 提交「${tiles.join('')}」，等待其他玩家认可`);
    checkPendingVote(room);
  });
  socket.on('voteDiscard', ({approve})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started||!room.pendingDiscard) return;
    const pd=room.pendingDiscard;
    if(socket.id===pd.playerId) return socket.emit('errorMsg','不能给自己的出牌投票');
    if(!room.players.some(p=>p.id===socket.id)) return;
    if(Object.prototype.hasOwnProperty.call(pd.votes,socket.id)) return socket.emit('errorMsg','你已经投过票了');
    pd.votes[socket.id]=approve===true;
    const voter=room.players.find(p=>p.id===socket.id);
    addLog(room,`${voter?.name||'玩家'} 已投票`);
    checkPendingVote(room);
  });
  socket.on('declareWin', ({sentence})=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started) return;
    if(room.pendingDiscard) return socket.emit('errorMsg','请先完成当前出牌投票');
    const p=room.players.find(x=>x.id===socket.id); if(!p) return;
    sentence=String(sentence||'').trim().slice(0,80);
    if(p.hand.length!==14) return socket.emit('errorMsg','必须持有14张牌时胡牌');
    const chars=[...sentence.replace(/[，。！？、,.!?\s]/g,'')];
    const a=[...p.hand].sort().join(''), b=[...chars].sort().join('');
    if(a!==b) return socket.emit('errorMsg','句子必须只使用你手里的14个字，并且每张牌都要用到');
    room.lastWin={player:p.name,sentence,tiles:[...p.hand]}; room.started=false; room.pendingDiscard=null;
    addLog(room,`🎉 ${p.name} 胡了：${sentence}`); broadcast(room);
  });
  socket.on('chat', ({text})=>{
    const room=rooms.get(socket.data.room); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id); text=String(text||'').trim().slice(0,120);
    if(p&&text) io.to(room.code).emit('chatMsg',{name:p.name,text});
  });
  socket.on('disconnect', ()=>{
    const code=socket.data.room, room=rooms.get(code); if(!room) return;
    const idx=room.players.findIndex(p=>p.id===socket.id); if(idx<0) return;
    const [left]=room.players.splice(idx,1);
    if(!room.players.length){ rooms.delete(code); return; }
    if(room.hostId===socket.id) room.hostId=room.players[0].id;

    if(room.pendingDiscard?.playerId===socket.id){
      room.pendingDiscard=null;
      if(room.turn>=room.players.length) room.turn=0;
    }else if(room.pendingDiscard){
      checkPendingVote(room);
    }else{
      if(idx<room.turn) room.turn--;
      if(room.turn>=room.players.length) room.turn=0;
    }
    addLog(room,`${left.name} 离开了房间`); broadcast(room);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Listening on http://localhost:${PORT}`));
