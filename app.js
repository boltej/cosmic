const express = require('express');
//const { emit } = require('process');
//const { DefaultSerializer } = require('v8');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-write-stream');
const csvReader = require('csv-parser');

/*
Note: 
a "throw" is one player rolling dice
a "round" is all players completing a throw
a "game" is a set of rounds, that finishes when a team gets an agreed upon number of points
*/

const GP_PREGAME = 0;
const GP_SUSPENDED = 1;
const GP_GAMESTARTED = 2;
const GP_GAMECOMPLETE = 6;

const RR_NOT_SET = -1;
const RR_NONROLLABLE = 0;
const RR_OPTIONAL = 1;
const RR_MANDATORY = 2;
//const RR_REROLL = -1;

class Die {
    face = -1;    // 2,3,4,5,6,10,0
    index = -1; // 0-4
    isFlash = false;
    rolled = false;
    reroll = RR_OPTIONAL;

    constructor(_index) { this.index = _index; }
}

class GameState {
    gameStarted = false;
    gamePhase = GP_PREGAME;
    currentRound = 0;
    currentPlayer = 0;
    dice = [];

    constructor() {
    }
}


class Player {
    username = '';
    role = '';    // 'player' | 'observer' | 'suspended' | 'bot'
    roomID = '';
    socketID = '';
    score = 0;
    constructor(_username, _role, _roomID, _socketID) {
        this.username = _username;
        this.role = _role;
        //this.player = _player;
        this.roomID = _roomID;
        this.socketID = _socketID;
    }
}


class Room {
    roomID = 0;
    players = [];   // array of Players
    startingPlayer = 0;

    gs = new GameState();

    constructor(roomID) {
        this.roomID = roomID;
    }
}


let rooms = [];

//app.set('view engine', 'ejs')
app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/cosmic.html');
    //res.redirect('/${uuidV4()}');
});

app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

//app.get('/:room',(req,res)=> {
//  res.render('room', { roomID: req.params.room });
//});

function GetRoom(roomID) {
    for (r of rooms)
        if (r.roomID === roomID)
            return r;

    return null;
}

io.on('connection', (socket) => {
    console.log('a user connected');

    // handle a use disconnecting (done)
    socket.on('disconnect', () => {
        // get the player's room based on their socketID
        let room = null;
        let dp = null;
        for (r of rooms) {
            for (dp of r.players) {
                if (dp.socketID === socket.id) {
                    room = r;
                    break;
                }
            }
            if (room !== null)
                break;
        }

        // did we find the room/socket?  If not, nothing else to do
        // disconnecting
        if (room === null)
            return;

        const role = dp.role;
        dp.role = 'suspended';
        dp.player = -1;

        let remaining = [];
        for (p of room.players)
            if (p.role === 'player')
                remaining.push(p.username);

        if (remaining.length < 2)
            room.gs.gamePhase = GP_SUSPENDED;

        socket.to(room.roomID).emit('user disconnected', dp.username, role);
        console.log('player ' + dp.username + ' disconnected.  Remaining players: ' + remaining.join());

        if (remaining.length === 0) {
            for (let i = 0; i < rooms.length; i++) {
                if (rooms[i] === room) {
                    console.log('Room ' + room.roomID + ' has been closed');
                    rooms.splice(i, 1);
                    break;
                }
            }
            io.emit('update rooms');
        }
    });

    // start a new room, done)
    socket.on('add room', (fn) => {
        let roomID = uuidv4();        // generate unique identifier
        let room = new Room(roomID);  // make the room 
        rooms.push(room);             // add to list of rooms open on the server
        console.log('adding room ' + roomID);
        io.emit('room added', roomID);   // let everyone know a new room was created
        fn(roomID);                   // callback for sender

    });

    // a new player has joined - send the current teams list (done)
    socket.on('new player', (roomID, username, role) => {
        // get next open player slot for this room
        let room = GetRoom(roomID);
        if (room === null) {
            console.log('Unable to find room ' + roomID);
            return;
        }

        //if (role === 'bot') {
        //    room.botCount++;
        //    username = GetRandomBotName();
        //}
        //
        // get count of current players in this room
        // and whether the new player is on the suspended list for this room
        let playerCount = 0;
        let wasSuspended = false;
        let newPlayer = null;
        for (p of room.players) {
            if (p.role === 'player')
                playerCount++;
            else if (p.role === 'suspended' && p.username === username) {
                wasSuspended = true;
                newPlayer = p;
                //newPlayer.role = playerInfo.role;
            }
        }

        if (wasSuspended === false) {
            console.log('Adding Player ' + username + ', Role: ' + role);
            newPlayer = new Player(username, role, -1, -1, roomID, socket.id);
            room.players.push(newPlayer);
        }
        else {  // WAS  suspended previously
            console.log('Resuming Player ' + username + ', Role: ' + role);
            newPlayer.role = role;
        }

        if (role === 'player' || role === 'bot') {
            if (playerCount > 7) {
                console.log('Error: player count exceeds 7!!!!');
                return;
            }

        } else  // playerInfo.role != 'player'
            console.log('Observer ' + username + ' has joined a game');

        //newPlayer.username = username;

        socket.join(roomID);  // connect socket to room 
        newPlayer.socketID = socket.id;

        // player added === user-connected
        io.to(roomID).emit('player added', username, role, room.players);
        //io.to(roomID).emit('players', room.players);
        io.emit('update rooms');
    });

    socket.on('get rooms', (fn) => {
        //console.log('get rooms called');
        let _rooms = [];

        for (r of rooms) {
            roomInfo = {
                roomID: r.roomID,
                players: r.players
            };
            _rooms.push(roomInfo);
        }

        fn(_rooms);
    });


    // get the current game state
    socket.on('get state', (roomID, fn) => {
        let room = GetRoom(roomID);
        fn(room.gs, room.players);
    });

    // request to start a game (done)
    socket.on('start game', (roomID, restart) => {
        let room = GetRoom(roomID);

        if (restart)
            room.gs.gameStarted = false;

        if (room.gs.gameStarted)
            return;

        for (let p of room.players) {
            p.score = 0;
        }
        // to start a game, 
        // 1) reset round counter to 0 and team scores to 0
        // 2) run rounds until score of 500 achieved
        room.gs.currentRound = 0;
        room.gs.gamePhase = GP_GAMESTARTED;
        //room.gs.dice = [];
        //for (let i = 0; i < 5; i++)
        //    room.gs.dice.push(new Die(i));

        room.startingPlayer = Math.floor(Math.random() * room.players.length);

        io.to(roomID).emit('game started');
        room.gs.gameStarted = true;

        console.log('starting game in room ' + roomID);

        StartRound(room);
    });

    socket.on('reroll clicked', (roomID, socketID, index, state) => {
        console.log('reroll clicked: socket=' + socketID + ', index=' + index + ', state=' + state);
        io.to(roomID).emit('update reroll', socketID, index, state);
    });

    socket.on('reroll dice', (roomID, dice, currentScore) => {
        //console.log('Rerolling dice ' + reroll.join());
        let room = GetRoom(roomID);

        if (room === null) {
            console.error("Room ID:  " + roomID + " not found");
            return;
        }
        
        let newDice = RollDice(room);

        for (let d of dice) {
            if (d.rolled)
                d.face = newDice[d.index].face;
        }
        //let rerollDice = [];
        //for (let i of reroll) {
        //    rerollDice.push(newDice[i]);
        //}
        io.to(roomID).emit('dice rerolled', dice, currentScore );
    });

    socket.on('stop turn', (roomID, turnScore) => {
        let room = GetRoom(roomID);

        // update current player's score
        room.players[room.gs.currentPlayer].score += turnScore;

        let p = GetNextPlayer(room);

        // are we at the end of a round?
        if (room.gs.currentPlayer === room.startingPlayer) {
            room.gs.currentRound++;
        }
        let dice = RollDice(room);
        io.to(room.roomID).emit('dice rolled', room.gs.currentRound, p.socketID, p.username, dice);
    });

    socket.on('get scores', (roomID, fn) => {
        let room = GetRoom(roomID);
        let scores = [];
        for (let p of room.players) {
            if (p.role === 'player') {
                scores.push({ name: p.username, score: p.score});
                console.log('get scores: ' + p.username + ', ' + p.score);
            }
        }
        fn(scores);
    });


    socket.on('get leaderboard', (fn) => {
        //let userStats = { '# Games':0, 'Games Won':0, '% Won':0, 'AHS':0 };   // 'user' :
        /////let users = {};
        /////fs.createReadStream('data/games.csv')
        /////    .pipe(csvReader())
        /////    .on('data', (row) => {
        /////        // have a game record, update the users stats
        /////        let username = row['Username'];
        /////        if (username !== undefined) {
        /////            //console.log(username);
        /////            //console.log(row);
        /////
        /////            // find current record for this user (key = username, value=dictionary of stats)
        /////            if (users[username]) {
        /////                let user = users[username];
        /////                user['Games']++;
        /////                if (parseInt(row['Won']) > 0)
        /////                    user['Games Won'] += 1;
        /////                user['AHS'] += parseInt(row['HandStrength']);
        /////            }
        /////            else {  // user not found, so add them
        /////                users[username] = {
        /////                    'Games': 1,
        /////                    'Games Won': parseInt(row['Won']),
        /////                    '% Won': 0,
        /////                    'AHS': parseInt(row['HandStrength'])
        /////                };
        /////            }
        /////        }
        /////    })
        /////    .on('end', () => {
        /////        // at this point, the 'users' dictionary contains entries for each user
        /////        // in the database.  Clean up are return
        /////        for (let username in users) {
        /////            let user = users[username];
        /////            //console.log(username);
        /////            //console.log(user);
        /////            user['% Won'] = user['Games Won'] / user['Games'];
        /////            user['AHS'] = user['AHS'] / user['Games'];
        /////            //console.log(user);
        /////        }
        /////        fn(users);
        /////    });
    });

    socket.on('error', (err) => {
        console.error('Socket Error Encountered: ', err);
    });
});

io.on('error', (err) => {
    console.error('io Error Encountered: ', err);
});

process.on('uncaughtException', (err) => {
    console.error('Process Error Encountered: ', err);
});

server.listen(8878, () => {
    console.log('listening on *:8878');
});

/////////////////////////////////////////////
// helper functions
////////////////////////////////////////////

function GetSocketID(room, team, player, roles) {
    for (const p of room.players) {
        if (roles.includes(p.role) && p.team === team && p.player === player)
            return p.socketID;
    }
    return null;
}

///function GetUsername(room, player, role) {
///    for (const p of room.players) {
///        if (p.role === role && player === player)
///            return p.username;
///    }
///}

function GetPlayer(room, playerIndex) {
    let index = -1;
    for (const p of room.players) {
        if (p.role === 'player')
            index++;

        if( index === playerIndex)
            return p;
    }
    return null;
}

function GetNextPlayer(room) {
    while (true) {
        if (room.gs.currentPlayer === room.players.length - 1) //wrap?
            room.gs.currentPlayer = 0;
        else
            room.gs.currentPlayer++;

        if (room.players[room.gs.currentPlayer].role === 'player')
            break;
    }

    console.log("next player: " + room.gs.currentPlayer);
    return room.players[room.gs.currentPlayer];
}

// start a round of four cards to be played (done)
function StartRound(room) {
    // starts a new round (play four cards), currentTeam/gs.currentPlayer start
    room.gs.currentPlayer = 0;
    //room.gs.gamePhase = GP_PLAYINGHAND;
    //console.log("emitting 'start round' " + room.gs.currentRound);
    let p = GetPlayer(room, room.gs.currentPlayer);
    io.to(room.roomID).emit('start round', room.gs.currentRound, p.username);

    // send a "play card" message to the room, indicating current 
    RollDice(room);
    io.to(room.roomID).emit('dice rolled', room.gs.currentRound, p.socketID, p.username, room.gs.dice);
}


function RollDice(room) {
    // iterate through the six possible ranks (faces)
    room.gs.dice = [];
    for (let i = 0; i < 5; i++) {
        let d = new Die(i);
        
        let face = Math.floor(Math.random() * 6);   // 0-5
        switch (face) {
            case 0: d.face = 2; break;
            case 1: d.face = (i===4 ? 0 : 3); break;   // on special die?return flaming sun
            case 2: d.face = 4; break;
            case 3: d.face = 5; break;
            case 4: d.face = 6; break;
            case 5: d.face = 10; break;
        } 
        room.gs.dice.push(d);
    }
    return room.gs.dice;
}


function CardPlayed(room, cardID) {
    console.log('card played: ' + cardID);

    // remove card from players hand in server representation
    RemoveCardFromHand(room, room.gs.currentTeam, room.gs.currentPlayer, cardID);
    room.gs.currentCardsPlayed.push(cardID);

    // first play of round?
    if (room.gs.currentPlay === 0) {
        room.gs.firstCardPlayed = cardID;
        room.gs.highCard = cardID;
        room.gs.winningPlayTeam = room.gs.currentTeam;
        room.gs.winningPlayPlayer = room.gs.currentPlayer;
    }
    // or card played is current the high card?
    else if (IsHighCard(cardID, room.gs.highCard, room.gs.firstCardPlayed[1], room.gs.winningBid[1])) {
        room.gs.highCard = cardID;
        room.gs.winningPlayTeam = room.gs.currentTeam;
        room.gs.winningPlayPlayer = room.gs.currentPlayer;
    }
    // tell clients to transfer card to play area
    console.log("emitting 'card played' (" + cardID + ' by ' + GetUsername(room, room.gs.currentTeam, room.gs.currentPlayer, 'player') + ', play=' + room.gs.currentPlay + ')');
    io.to(room.roomID).emit('card played', room.gs.currentTeam, room.gs.currentPlayer, cardID);

    // indicate hand has been played
    room.gs.currentPlay++;

    if (room.gs.currentPlay < 4) { // still playing this play (i.e. hasn't gone all the way around)? 
        // get next player
        [room.gs.currentTeam, room.gs.currentPlayer] = GetNextPlayer(room.gs.currentTeam, room.gs.currentPlayer);

        // if playing nello and next player is non-active nello player, skip
        if (room.gs.winningBid === 'NL' && room.gs.currentTeam === room.gs.winningBidderTeam && room.gs.currentPlayer !== room.gs.winningBidderPlayer) {
            room.gs.currentPlay++;
            [room.gs.currentTeam, room.gs.currentPlayer] = GetNextPlayer(room.gs.currentTeam, room.gs.currentPlayer);
        }
    }
    if (room.gs.currentPlay < 4) { // still playing this play? 
        const p = GetPlayer(room, room.gs.currentPlayer);
        console.log("emitting 'play card' to " + p.username);
        if (p.role === 'player')
            io.to(room.roomID).emit('play card', room.gs.currentRound, p.socketID, p.username);
        else if (p.role === 'bot')
            BotPlayCard(p);
    }
    else {  // four cards played, move to next round
        RoundComplete(room);
    }
}


function RoundComplete(room) {
    console.log('Completed Round ' + room.gs.currentRound);

    // find winner of this round (high card played)
    room.teams[room.gs.winningPlayTeam].tricks += 1;

    let winningUser = GetUsername(room, room.gs.winningPlayTeam, room.gs.winningPlayPlayer, 'player');
    console.log("emitting 'round complete' msg, winner is " + winningUser);
    io.to(room.roomID).emit('round complete', room.gs.currentRound, winningUser, room.teams[0].tricks, room.teams[1].tricks);

    // update game state to start new round (of four plays)
    room.gs.currentRound++;
    room.gs.currentPlay = 0;

    // do we need to do more rounds (i.e. any cards left to play?)
    // if so, start another round, starting with the winning player
    if (room.gs.currentRound < 10) {
        room.gs.currentTeam = room.gs.winningPlayTeam;
        room.gs.currentPlayer = room.gs.winningPlayPlayer;
        room.gs.currentPlay = 0;
        console.log("Starting Round " + room.gs.currentRound);
        StartRound(room);
    }
    else {
        HandComplete(room);
    }
}

// a hand has finished - check for game over, and start new hand if not 
function HandComplete(room) {
    console.log("Hand Complete: " + room.gs.currentRound);
    // check to see if there is a winner.  If so, finish game; 
    // otherwise, do another round.

    // did the winning bidder make the bid?
    let biddingTeam = room.gs.winningBidderTeam;
    let biddingTeamTricks = room.teams[biddingTeam].tricks;
    let biddingTeamPts = GetScoreFromBid(room.gs.winningBid);
    let bidMade = false;
    let bidRank = room.gs.currentBid[0];

    // did the bidder get enough tricks to make bid?
    // nello-> no tricks; otherwise, cover bid
    if ((bidRank === 'N' && biddingTeamTricks === 0) || (bidRank !== 'N' && biddingTeamTricks >= bidRank)) {
        bidMade = true;
    }
    else {
        biddingTeamPts *= -1;  // flip sign of bid value
        bidMade = false;
    }
    room.teams[room.gs.winningBidderTeam].score += biddingTeamPts;

    if (biddingTeam === 0)
        room.teams[1].score += 10 * room.teams[1].tricks;
    else
        room.teams[0].score += 10 * room.teams[0].tricks;

    const imgURLWinner = GetRandomImage(0);
    const imgURLLoser = GetRandomImage(1);
    //console.log("imgURL= " + imgURLWinner);
    //io.to(room.roomID).emit('hand complete', room.gs.currentHand, biddingTeam, bidMade,
    //    biddingTeamTricks, biddingTeamPts, room.teams[0].score, room.teams[1].score, imgURLWinner);

    let imgURL = null; // = imgURLWinner;
    let msg = null;

    for (let p of room.players) {
        if (p.role === 'player' || p.role === 'observer') {

            if (p.team === room.gs.winningBidderTeam) {
                if (bidMade) {
                    imgURL = imgURLWinner;
                    msg = "Congratulations! You made your bid!";
                } else {
                    imgURL = imgURLLoser;
                    msg = "Bad News! You got set!";
                }
            } else {  // non-bidding team
                if (bidMade) {
                    imgURL = imgURLLoser;
                    msg = "Well, you tried, but they got their bid.";
                } else {
                    imgURL = imgURLWinner;
                    msg = "Congratulation, you set the other team!";
                }
            }

            console.log("emitting 'hand complete' msg");
            io.to(p.socketID).emit('hand complete', room.gs.currentHand, biddingTeam, bidMade,
                biddingTeamTricks, biddingTeamPts, room.teams[0].score, room.teams[1].score, msg, imgURL);
        }
    }

    SaveHandData(room, biddingTeamTricks);

    let gameWinner = -1;
    if (room.teams[0].score >= 500 && room.teams[0].score > room.teams[1].score)
        gameWinner = 0;
    else if (room.teams[1].score >= 500 && room.teams[1].score > room.teams[0].score)
        gameWinner = 1;
    else if (room.teams[0].score >= 500 && (room.teams[0].score === room.teams[1].score))
        gameWinner = 2;  // tie!

    console.log("Game Winner: " + gameWinner + "  " + room.teams[0].score + " to " + room.teams[1].score);

    // end of game reached?
    if (gameWinner >= 0) {
        [teamA, teamB] = GetTeams(room);
        room.gs.gamePhase = GP_GAMECOMPLETE;
        GameComplete(room);
        io.to(room.roomID).emit('game complete', gameWinner, room.teams[0].score, room.teams[1].score, teamA, teamB);
    }
    else {
        room.gs.currentHand++;
        [room.gs.currentDealerTeam, room.gs.currentDealerPlayer] = GetNextPlayer(room.gs.currentDealerTeam, room.gs.currentDealerPlayer);
        //StartHand(room);
    }
}


function GameComplete(room) {
    room.gs.gameStarted = false;

    for (p of room.players) {
        if (room.gs.currentHand > 0 && p.hsThisGame.length > 0)
            p.handStrength /= p.hsThisGame.length; // average hand strength for game
    }
    SaveGameData(room);
}


function GetRandomImage(flag) {
    if (flag === 0) {
        const directoryPath = path.join(__dirname, '/public/Animations/Winners');
        const files = fs.readdirSync(directoryPath);
        const file = files[Math.floor(Math.random() * files.length)];
        console.log('Getting random file: ' + file);
        return 'Animations/Winners/' + file;
    }
    else {
        const directoryPath = path.join(__dirname, '/public/Animations/Losers');
        const files = fs.readdirSync(directoryPath);
        const file = files[Math.floor(Math.random() * files.length)];
        console.log('Getting random file: ' + file);

        return 'Animations/Losers/' + file;
    }
}


// Fisher-Yates verion
function _ShuffleArray(array) {
    let m = array.length;
    let i = 0;

    while (m) {
        i = Math.floor(Math.random() * m--);

        [array[m], array[i]] = [array[i], array[m]];
    }

    return array;
}



function SaveHandData(room, biddingTeamTricks) {
    var writer = csvWriter({ sendHeaders: false }); //Instantiate var
    var csvFilename = "data/hands.csv";

    // If CSV file does not exist, create it and add the headers
    if (!fs.existsSync(csvFilename)) {
        writer = csvWriter({ sendHeaders: false });
        writer.pipe(fs.createWriteStream(csvFilename));
        writer.write({
            header1: 'C1',
            header2: 'C2',
            header3: 'C3',
            header4: 'C4',
            header5: 'C5',
            header6: 'C6',
            header7: 'C7',
            header8: 'C8',
            header9: 'C9',
            header10: 'C10',
            header11: 'Username',
            header12: 'Bid',
            header13: 'Tricks'
        });
        writer.end();
    }

    // Append some data to CSV the file    
    writer = csvWriter({ sendHeaders: false });
    writer.pipe(fs.createWriteStream(csvFilename, { flags: 'a' }));

    let hand = '';
    let username = '';
    for (const p of room.players) {
        if (p.role === 'player' && p.team === room.gs.winningBidderTeam && p.player === room.gs.winningBidderPlayer) {
            hand = p.startingHand;
            username = GetUsername(room, p.team, p.player, 'player');
            break;
        }
    }

    writer.write({
        header1: hand[0],
        header2: hand[1],
        header3: hand[2],
        header4: hand[3],
        header5: hand[4],
        header6: hand[5],
        header7: hand[6],
        header8: hand[7],
        header9: hand[8],
        header10: hand[9],
        header11: username,
        header12: room.gs.winningBid,
        header13: biddingTeamTricks
    });
    writer.end();
}

function SaveGameData(room) {
    var writer = csvWriter({ sendHeaders: false }); //Instantiate var
    var csvFilename = "data/games.csv";

    // If CSV file does not exist, create it and add the headers
    if (!fs.existsSync(csvFilename)) {
        writer = csvWriter({ sendHeaders: false });
        writer.pipe(fs.createWriteStream(csvFilename));
        writer.write({
            header1: 'Date',
            header2: 'Username',
            header3: 'Won',
            header4: 'Margin',
            header5: 'HandStrength'
        });
        writer.end();
    }

    // Append some data to CSV the file    
    writer = csvWriter({ sendHeaders: false });
    writer.pipe(fs.createWriteStream(csvFilename, { flags: 'a' }));

    const today = new Date();
    const date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();

    let winningTeam = 0;
    if (room.teams[1].score > room.teams[0].score)
        winningTeam = 1;
    let margin = winningTeam === 0 ? room.teams[0].score - room.teams[1].score : room.teams[1].score - room.teams[0].score;

    for (p of room.players) {
        if (p.role === 'player') {

            writer.write({
                header1: date,
                header2: p.username,
                header3: winningTeam === p.team ? 1 : 0,
                header4: winningTeam === p.team ? margin : -margin,
                header5: p.handstrength
            });
            //writer.write('\n');
        }
    }
    writer.end();
}

