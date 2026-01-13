const express = require('express');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

let db = JSON.parse(fs.readFileSync('db.json'));

function saveDB() {
    fs.writeFileSync('db.json', JSON.stringify(db, null, 2));
}

function randCode(len = 5) {
    return Math.floor(Math.random() * Math.pow(10, len)).toString().padStart(len, '0');
}

/* ================= QUIZ API ================= */

app.post('/api/create', (req, res) => {
    const id = 'quiz_' + Date.now();
    const hostCode = 'db' + randCode();
    db.quizzes[id] = {
        id,
        name: req.body.name,
        hostCode,
        questions: req.body.questions
    };
    saveDB();
    res.json({ hostCode });
});

app.get('/api/quizzes', (req, res) => {
    res.json(Object.values(db.quizzes));
});

app.post('/api/host', (req, res) => {
    const quiz = Object.values(db.quizzes).find(q => q.hostCode === req.body.hostCode);
    if (!quiz) return res.json({ success: false });

    const joinCode = randCode();
    db.sessions[joinCode] = {
        quizId: quiz.id,
        currentQ: 0,
        players: {},
        maxPowerUps: Math.floor(quiz.questions.length / 3)
    };
    res.json({ success: true, joinCode });
});

app.post('/api/join', (req, res) => {
    const s = db.sessions[req.body.joinCode];
    if (!s) return res.json({ success: false });

    const playerId = 'p' + Date.now();
    s.players[playerId] = {
        id: playerId,
        name: req.body.username,
        score: 0,
        answered: false,
        powerUsed: 0
    };
    res.json({ success: true, playerId, joinCode: req.body.joinCode });
});

/* ================= SOCKET.IO ================= */

io.on('connection', socket => {

    socket.on('host-join', joinCode => {
        if (!db.sessions[joinCode]) return;
        socket.join(joinCode);
        sendQuestion(joinCode);
        updateLeaderboard(joinCode);
    });

    socket.on('player-join', ({ joinCode, playerId }) => {
        if (!db.sessions[joinCode]) return;
        socket.join(joinCode);
        sendQuestion(joinCode);
        updateLeaderboard(joinCode);
    });

    socket.on('answer', ({ joinCode, playerId, answer }) => {
        const s = db.sessions[joinCode];
        if (!s) return;
        const p = s.players[playerId];
        if (!p || p.answered) return;

        p.answered = true;
        const q = db.quizzes[s.quizId].questions[s.currentQ];

        if (answer == q.correct) {
            p.score += 300;
            socket.emit('feedback', { correct: true });
        } else {
            socket.emit('feedback', { correct: false, correctAnswer: q.correct });
        }
        updateLeaderboard(joinCode);
    });

    socket.on('powerup', ({ joinCode, playerId }) => {
        const s = db.sessions[joinCode];
        if (!s) return;
        const p = s.players[playerId];
        if (!p) return;

        if (p.powerUsed >= s.maxPowerUps) return;

        p.powerUsed++;
        p.score += 100;
        updateLeaderboard(joinCode);
    });

    socket.on('next', joinCode => {
        const s = db.sessions[joinCode];
        if (!s) return;

        s.currentQ++;
        Object.values(s.players).forEach(p => p.answered = false);

        if (s.currentQ >= db.quizzes[s.quizId].questions.length) {
            io.to(joinCode).emit('end');
            delete db.sessions[joinCode];
            return;
        }
        sendQuestion(joinCode);
    });
});

/* ================= HELPERS ================= */

function sendQuestion(joinCode) {
    const s = db.sessions[joinCode];
    if (!s) return;
    const q = db.quizzes[s.quizId].questions[s.currentQ];
    io.to(joinCode).emit('question', {
        question: q.question,
        answers: q.answers,
        totalQuestions: db.quizzes[s.quizId].questions.length
    });
}

function updateLeaderboard(joinCode) {
    const s = db.sessions[joinCode];
    if (!s) return;
    const board = Object.values(s.players)
        .sort((a, b) => b.score - a.score)
        .map((p, i) => ({ place: i + 1, name: p.name, score: p.score }));
    io.to(joinCode).emit('leaderboard', board);
}

server.listen(3000, () => console.log('http://localhost:3000'));
