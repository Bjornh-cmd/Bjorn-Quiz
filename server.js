const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static('public'));

const DB_FILE = './db.json';
let db = { quizzes: {}, sessions: {} };

// Load database
if(fs.existsSync(DB_FILE)){
    db = JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(){
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function randCode(len){
    return Math.floor(Math.pow(10,len-1)+Math.random()*Math.pow(10,len-1)).toString();
}

/* ===== QUIZ MAKEN ===== */
app.post('/api/create', (req,res)=>{
    const quizId = Date.now().toString();
    const hostCode = randCode(6);

    db.quizzes[quizId] = {
        quizId,
        name: req.body.name,
        hostCode,
        questions: req.body.questions
    };

    saveDB();
    res.json({ quizId, hostCode });
});

/* ===== ALLE QUIZZES OPHALEN ===== */
app.get('/api/quizzes', (req,res)=>{
    res.json(Object.values(db.quizzes));
});

/* ===== HOST START GAME ===== */
app.post('/api/host', (req,res)=>{
    const quiz = Object.values(db.quizzes)
        .find(q => q.hostCode === req.body.hostCode);
    if(!quiz) return res.json({ success:false });

    const joinCode = randCode(5);

    db.sessions[joinCode] = {
        quizId: quiz.quizId,
        joinCode,
        currentQ: 0,
        players: {},
        answeredOrder: []
    };
    saveDB();
    res.json({ success:true, joinCode });
});

/* ===== JOIN GAME ===== */
app.post('/api/join', (req,res)=>{
    const joinCodeInput = req.body.joinCode;
    const session = db.sessions[joinCodeInput];
    if(!session) return res.json({ success:false });

    const playerId = randCode(4);
    session.players[playerId] = {
        name: req.body.username,
        score: 0,
        answered: false,
        last: null
    };
    saveDB();
    res.json({ success:true, playerId, joinCode: joinCodeInput });
});

/* ===== SOCKET.IO ===== */
io.on('connection', socket => {
    socket.on('host-join', joinCode => {
        socket.join(joinCode);
        updateLeaderboard(joinCode);
    });

    socket.on('player-join', data=>{
        socket.join(data.joinCode);
        sendQuestion(data.joinCode, socket);
        updateLeaderboard(data.joinCode);
    });

    socket.on('answer', data=>{
        const session = db.sessions[data.joinCode];
        const player = session.players[data.playerId];
        if(player.answered) return;

        player.answered = true;
        player.last = data.answer;
        session.answeredOrder.push({ id:data.playerId, time:Date.now() });

        const quiz = db.quizzes[session.quizId];
        const correct = quiz.questions[session.currentQ].correct;

        socket.emit('feedback',{
            correct: data.answer == correct,
            correctAnswer: correct
        });

        updateLeaderboard(data.joinCode);
    });

    socket.on('next', joinCode=>{
        const session = db.sessions[joinCode];
        const quiz = db.quizzes[session.quizId];

        // punten op basis van snelheid
        session.answeredOrder
            .sort((a,b)=>a.time-b.time)
            .forEach((e,i)=>{
                const p = session.players[e.id];
                if(p.last == quiz.questions[session.currentQ].correct)
                    p.score += Math.max(500-i*50,50);
            });

        Object.values(session.players).forEach(p=>{
            p.answered=false;
            p.last=null;
        });
        session.currentQ++;
        session.answeredOrder=[];

        if(session.currentQ >= quiz.questions.length){
            io.to(joinCode).emit('end');
        }else{
            io.to(joinCode).emit('question',quiz.questions[session.currentQ]);
            updateLeaderboard(joinCode);
        }
    });
});

function sendQuestion(joinCode, socket){
    const s = db.sessions[joinCode];
    const q = db.quizzes[s.quizId].questions[s.currentQ];
    socket.emit('question', q);
}

function updateLeaderboard(joinCode){
    const s = db.sessions[joinCode];
    const board = Object.values(s.players)
        .sort((a,b)=>b.score-a.score)
        .map((p,i)=>({ place:i+1, name:p.name, score:p.score }));

    io.to(joinCode).emit('leaderboard', board);
}

// Realtime leaderboard update elke seconde
setInterval(() => {
    Object.keys(db.sessions).forEach(joinCode => {
        updateLeaderboard(joinCode);
    });
}, 1000);

server.listen(3000, ()=>console.log('http://localhost:3000'));
