/*
Notes: 
A die is a dictionary: face:, position:, isFlash:, reroll

Dice consist of the following faces

"Normal" dice consist of the following

circle(2), triangles (3) bolts (4), five (5), stars (6), tens (T)

One 

You play by rolling the five Cosmic Wimpout cubes and get points for each 5, 10, or Flash (triplet) that you roll.
You can accumulate points towards the winning total by ending your turn or risking it all, because if you roll and don't score,
you lose all the points for that turn, and the next player goes. After certain results, a player may choose to end his turn, 
scoring the points he has accumulated. The first player to reach an agreed-upon score wins. 
Typically agreed upon scores range from 200 to 1200.

*/

let roomID = '';
let username = '';
let currentRound = 0;
let currentSocketID = '';
let currentPlayerName = '';
let gameIsActive = true;
let gameIsStarted = false;
let dice = [];
let totalScore = 0;
let turnScore = 0;

let userMsgTxt = '';
let userMsgHdr = '';
let userMsgGreen = false;

// game phase constants (must mach those in app.js)
const GP_PREGAME = 0;
const GP_SUSPENDED = 1;
const GP_GAMESTARTED = 2;
const GP_BIDDING = 3;
const GP_SELECTINGMIDDLE = 4;
const GP_PLAYINGHAND = 5;
const GP_GAMECOMPLETE = 6;

// die.reroll flags values
const RR_NOT_SET = -1;
const RR_NONROLLABLE = 0;
const RR_OPTIONAL = 1;
const RR_MANDATORY = 2;



//$(function () {
const socket = io('/');
$('#reRollBtn').hide();
$('#stopTurnBtn').hide();

//$('#gameMsgBtn').hide();


//---------------------------------------------------------
// message handlers
//---------------------------------------------------------
socket.on('user disconnected', (username, role) => {
    if (role === 'player') {
        let msgHdr = 'Player ' + username + ' has left the game.';
        let msgTxt = 'Game play will be suspended until another player joins the game';
        SetGameMsg(msgHdr, msgTxt, null, false);
        gameIsActive = false;  // suspend play if leaving user has role of 'observer'
    }
});

// a new room was added.  Update login/join screen
socket.on('room added', (_roomID) => {
    socket.emit('get rooms', (rooms) => {
        PopulateActiveRooms(rooms);
    });
});

// a play was added to a room.  Update login/join screen
socket.on('update room', () => {
    socket.emit('get rooms', (rooms) => {
        PopulateActiveRooms(rooms);
    });
});

// a player has been added to the game
socket.on('player added', (playerName, role, players) => {
    playerNames = [];
    observers = [];
    suspended = [];
    isObserver = false;

    //if (playerName === username) {
    //}

    let count = 0;

    // add username to appropriate list
    let btn = null;

    for (const p of players) {
        if (p.role === 'player' || p.role === 'bot') {
            count++;
            playerNames.push(p.username);

        } else if (p.role === 'observer') {
            observers.push(p.username);
            if (socket.id === p.socketID)
                isObserver = true;

        } else if (p.role === 'suspended') {
            suspended.push(p.username);
        }
    }

    console.log('Player added - player list is ' + playerNames + ' (' + count + ')');

    let countStr = count === 1 ? "one player" : count === 2 ? "two players" : count === 3 ? "three players" : '' + count + ' players';
    let obs = observers.length === 0 ? '' : 'and ' + observers.length + ' observer(s) ';

    let msgHdr = 'Waiting to start game...';
    let msgTxt = 'There are currently ' + countStr + ' (' + playerNames.join() + ') ' + obs + 'in this game.  Start the game when all players have joined.'
    SetGameMsg(msgHdr, msgTxt, StartGame, true);

    $("#players").text(players.join().replace(/,/g, ', '));
    $("#observers").text(observers.join().replace(/,/g, ', '));
});

socket.on('game started', () => {
    currentRound = 0;
    gameIsActive = true;
    gameIsStarted = true;

    $('#round').text('0');
    userMsgHdr = 'Starting game...';
    userMsgTxt = '';
    userMsgGreen = true;
    SetGameMsg(userMsgHdr, userMsgTxt, null, userMsgGreen);
    UpdateScores();
    UpdateLeaderboard();
    ToastMsg('The game is afoot!');
});

// called when a new round is starting
socket.on('start round', (currentRound, startingPlayerName) => {
    turnScore = 0;
    console.log('Starting round ' + currentRound + 1);
});

// receive a new set of dice
socket.on('dice rolled', function (round, socketID, _username, _dice) {
    dice = _dice;

    //////////////////////
    //dice[0].face = 6;
    //dice[1].face = 5;
    //dice[2].face = 6;
    //dice[3].face = 6;
    //dice[4].face = 6;
    //////////////////////
    userMsgHdr = 'Round ' + (round + 1) + ': It is ' + _username + "'s turn to play.";
    userMsgTxt = '';
    userMsgGreen = (_username === username) ? true : false;
    SetGameMsg(userMsgHdr, userMsgTxt, null, userMsgGreen);
    $('.rerollCB').checkbox("set unchecked");
    $('.rerollCB').hide();
    $('.isFlash').removeClass('isFlash');
    //reroll = [];

    // if this browser is active, enable action buttons
    if (socketID === socket.id) {
        $('#reRollBtn').show();
        $('#stopTurnBtn').show();
        $('.rerollCB').checkbox('set enabled');
    } else {
        $('#reRollBtn').hide();
        $('#stopTurnBtn').hide();
        $('.rerollCB').checkbox('set disabled');
    }

    let faces = [];
    // at start of turn, show die and initialize die reroll flag to 
    for (let d of dice) {
        ShowDie(d);
        faces.push(d.face);
        d.rolled = true;
        d.isFlash = false;         // initially, no flash set, updated below
    }
    console.log("dice rolled: " + faces.join());
    turnScore = 0;
    let score = ScoreDice(false);
    console.log('Score: ' + score);
});

socket.on('update reroll', (socketID, index, state) => {
    //if (socketID !== socket.ID) {  // already checked in initiator
        let _state = state === 1 ? 'set checked' : 'set unchecked';
        $('#rr-dice-' + index).checkbox(_state);
    //}
    EnableRerollBtn();
});

socket.on('dice rerolled', (_dice, currentScore) => {
    dice = _dice;

    let faces = [];
    for (let d of dice) {
        if (d.rolled) {
            ShowDie(d);
        }
        faces.push(d.face);
    }
    console.log('Dice Re-rolled: ' + faces.join());

    let score = ScoreDice(true);
    turnScore += score;
    console.log('Score: ' + score);
});

socket.on('game complete', (winningTeam, teamAscore, teamBscore, teamAplayers, teamBplayers) => {
    let players = '';
    switch (winningTeam) {
        case 0:
            players = teamAplayers.join().replace(/,/g, ', ');
            $('#winner').html('Team A (' + players + ') won the game with <span style="font-size:large">' + teamAScore + '</span> points!');
            $('#loser').html('Team B finished with ' + teamBscore + ' points - better luck next time...');
            break;
        case 1:
            players = teamBplayers.join().replace(/,/g, ', ');
            $('#winner').html('Team B (' + players + ') won the game with <span style="font-size:large">' + teamBScore + '</span> points!');
            $('#loser').html('Team A finished with ' + teamAscore + ' points - better luck next time...');
            break;
        case 2:
            $('#winner').text('The game ended in a tie!');
            $('#loser').text('The final scores was ' + teamAscore + ' to ' + teamBscore);
            break;
    }
    gameIsStarted = false;
    UpdateLeaderboard();
    $("#gameCompleted").modal('show');
});

///////////////////////////////////
function StartGame() {
    socket.emit('start game', roomID, false);
}


function ShowDie(die) {
    let special = die.index === 4 ? true : false;
    let img = GetDieImage(die.face, special);
    $('#dice-' + die.index).hide();
    $('#dice-' + die.index).html("<img id='dimg-" + die.index + "' class='diceImg' src='Images/" + img + "' />");
    $('#dice-' + die.index).fadeIn(2000);
}

function GetDieImage(face, special) {
    switch (face) {
        case 2: return special ? 'stars-2-black.svg' : 'stars-2.svg';
        case 3: return special ? 'triangles-3-black.svg' : 'triangles-3.svg';
        case 4: return special ? 'bolts-4-black.svg' : 'bolts-4.svg';
        case 5: return special ? 'five-black.svg' : 'five.svg';
        case 6: return special ? 'stars-6-black.svg' : 'stars-6.svg';
        case 10: return special ? 'ten-black.svg' : 'ten.svg';
        case 0: return special ? 'sun-black.svg' : 'sun.svg';
    }
}

function ScoreDice(rerollFlag) {
    $('.scoringTile').removeClass('scoringTile');   // visually indicates die is a scoring die 
    $('.actionButton').hide();   // disable user options (will be enabled as needed below)

    // get a count of each face and check for wildcard
    let counts = [0, 0, 0, 0, 0, 0];   // number of cards in each class (e.g. 2's, 3's, 4's, 5's)
    let wildCard = false;
    let scoringCubes = 0;
    let rolledCount = 0;
    let html = '';
    for (let d of dice) {
        if (d.rolled)
            rolledCount++;

        if (d.face > 0) { // non-wildcard
            let index = GetIndexFromFace(d.face);
            counts[index]++;
        }
        else
            wildCard = true;
    }

    let score = 0;
    console.log('  Counts: ' + counts);

    // was there a flash in the prior play?
    // if all dice rolled, clear flash flags
    let wasFlash = -1;
    for (let d of dice) {
        if (rolledCount === 5)
            d.isFlash = false;
        else {
            if (d.isFlash && d.face > 0)
                wasFlash = d.face;
        }
    }    

    // if there was a prior flash, preserve it.

    // The Flaming Sun is WILD. It can be used to score 5 or 10 points 
    // (you must if it is the only scoring cube in that roll), as part 
    // of a flash or as a non-scoring cube and then it can be re-rolled. 
    // The Flaming Sun Rule says that you must make a flash with the sun if
    // you roll it with a pair.

    // check for Flash, FreightTrain
    let flashFace = -1;  // set to face comprising the flash, -1=no flash
    if (wasFlash > 0) {   // if the prior hand had a flash, preserve the prior flash face
        flashFace = wasFlash;
    }
    else {  // prior throw didn't have a flash, so see if we have one resulting from this trhow
        let flashFaces = [];
        for (let i = 0; i < 6; i++) {  // i is the face (2,3,4,5,6,10)
            if ((counts[i] >= 3) || (counts[i] === 2 && wildCard))
                flashFaces.push(GetFaceFromIndex(i));
        }

        if (flashFaces.length > 0)
            flashFace = flashFaces[0];  // ALLOW USER CHOICE

        if (flashFace >= 0) {
            console.log('  Flash found - face=' + flashFace);
        }
    }

    // check for freight train
    let ftFace = -1;     // set to index of face comprising the FreightTrain
    if (rolledCount === 5) {
        for (let i = 0; i < 6; i++) {  // i is the face (2,3,4,5,6,10)
            if ((counts[i] === 5) || (counts[i] === 4 && wildCard))
                ftFace = GetFaceFromIndex(i);
        }
    }
    if (ftFace > 0)
        console.log('Freight Train! ' + ftFace);

    // is there a flash? (three of a kind)
    if (flashFace > 0) {
        console.log('  reroll count=' + rolledCount + ', wasFlash=' + wasFlash);
        if (wasFlash <= 0) {  // hasn't already counted?
            score = flashFace * 10;
            html += 'Flash: ' + score + 'pts<br/>';

            // tag die that are part of the flash
            let count = 0;
            for (d of dice) {
                if (d.isFlash === false) {
                    if (flashFace === d.face && count < 3) {
                        d.isFlash = true;
                        //d.reroll = RR_NONROLLABLE;
                        $('#dice-' + d.index).addClass('isFlash');
                        count++;
                    } else {
                        d.isFlash = false;
                        $('#dice-' + d.index).removeClass('isFlash');
                    }
                }
            }

            if (count === 2) { // wildcard needed?
                // last die better be face=0 (flaming sun)
                console.log('  Flaming Sun used to complete flash (' + dice[4].face + ')');
                dice[4].isFlash = true;
                $('#dice-4').addClass('isFlash');
            }
        }
    }
    else if (ftFace >= 0) {
        if (ftFace === 6) { // instant winner
            score = 10000;
            html = 'Instant Winner!<br/>';
        }
        else if (ftFace === 10) {
            score === -10000;
            html = 'Supernova! (you are out!)<br/>';
        }
        else {
            score = ftFace * 100;
            html += 'Freight Train! - ' + score + 'pts<br/>';
        }
    }
    else if (wildCard === true && scoringCubes === 0) {
        score = 10;
        html += 'Wildcard - 10pts<br/>';
    }

    // add in scoring cubes (Fives, Tens)
    let nFives = 0;
    for (d of dice) {
        if (d.rolled && d.face === 5 && d.isFlash === false)
            nFives++;
    }
    if (nFives > 0) {
        score += 5 * nFives;
        html += 'Fives: ' + (5 * nFives) + 'pts<br/>';
    }
    let nTens = 0;
    for (d of dice) {
        if (d.rolled && d.face === 10 && d.isFlash === false)
            nTens++;
    }
    if (nTens > 0) {
        score += 10 * nTens;
        html += 'Tens: ' + (10 * nTens) + 'pts<br/>';
    }

    // Wimping out with all five cubes is called a Train Wreck.
    let wimpout = true;
    for (d of dice) {
        if (d.rolled) {
            if (d.face === 5 || d.face === 10 || d.face === flashFace || d.face === ftFace || d.face === 0)
                wimpout = false;
        }
    }
    if (wimpout) {
        score = 0;
        turnScore = 0;
        if ( rolledCount === 5)
            html = "Train Wreck!<br/>";
        else
            html = "Wimpout!<br/>";
    }

    turnScore += score;
    html += 'Score This Roll: ' + score + '<br/>';
    html += 'Score This Turn: ' + turnScore + '<br/>';
    $('#roll-score').html(html);

    SetActions(counts, flashFace, ftFace, wimpout, wasFlash);
    UpdateRerollCBs();

    return score;
}


function SetActions(counts, flashFace, ftFace, wimpout, wasFlash) {
    // basic idea - set die.reroll as appropriate.  If there is anything to reroll,
    // enable "Re-Roll" btn.  If the player can legally stop the turn, enable the stop turn button
    // Enable the "re-roll" check boxes as approporiate

    $('#roll-actions').html('');
    $('#reRollBtn').show();
    $('#stopTurnBtn').show();

    let rolledCount = 0;
    for (d of dice) {
        d.reroll = RR_NOT_SET;
        if (d.rolled) {
            $('#dice-' + d.index).addClass('rolled');
            rolledCount++;
        }
        else
            $('#dice-' + d.index).removeClass('rolled');
    }
    // default cb state is 
    $('.rerollCB').checkbox('set unchecked');
    $('.rerollCB').show();

    // did we wimpout?
    if (wimpout) {
        $('#reRollBtn').hide();
        $('#stopTurnBtn').show();
        $('.rerollCB').show();
        $('#roll-actions').html('');
        for (d of dice)  // all dice are rollable
            d.reroll = RR_MANDATORY;
        console.log('Action = Wimpout');
        return;
    }

    // Apply rules

    // The Futtless Rule - States that all flashes must be cleared. To clear a flash, you must
    // score additional points by continuing to roll the non-scoring cubes (or all 5 if you've
    // scores with five cubes) or you wimp out. The reroll clause states that you cannot match
    // any one of the flash faces when clearing. If you match a flash face when clearing, you must
    // reroll all those cubes just rolled until you can keep 'em or Wimp out.

    let html = '';
    let futtless = [];
    let rerollRule = false;
    // do we currently have a flash?
    if (flashFace >= 0 ) {
        // yes, so we want to mark any non-flash, just-rolled die as rerollable.
        // if all the remaining die are scoring, we've cleared the flash.
        for (let d of dice) {
            if (d.isFlash)
                d.reroll = RR_NONROLLABLE;
            else if (d.rolled) {
                if (d.face === 5 || d.face === 10)  // scoring die?
                    d.reroll = RR_NONROLLABLE;
                else { // non-scoring die
                    d.reroll = RR_MANDATORY;
                    futtless.push(d.index);
                }
            }
            else // wasn't rolled, isn't flash
                ;
        }
        // if you've scored with all five die, you have to reroll all five
        if (futtless.length === 0) {  // non noscoring die?
            html += 'Futtless Rule Invoked (' + futtless.join() + ')<br/>';
            console.log('Futtless Rule Invoked (no non-scoring die)');
            // must reroll all die
            for (let d of dice)
                d.reroll = RR_MANDATORY;
        }

        // the Re-Roll rule comes into play on the roll after the Futtless Rule, 
        // which requires that all non-scoring dice be rolled again. The Re-Roll Clause comes 
        // into play if any one of the cubes rolled matches the Flash. If so, all the dice just 
        // thrown must be rolled again.
        if (wasFlash > 0) {
            let reroll = false;
            for (let d of dice) {
                if (d.rolled && d.isFlash === false && d.face === flashFace) {
                    reroll = true;
                    break;
                }
            }
            if (reroll) {
                html += 'Reroll Rule Invoked (' + d.index + ')<br/>';
                for (let d of dice) {
                    if (d.rolled)
                        d.reroll = RR_MANDATORY;
                }
            }
        }
    }

    // You May Not Want To But You Must Rule - If after any series of rolls you score 
    // with all 5 dice, you must continue your turn, rolling all five cubes.
    let ymnwt = true;
    for (let d of dice) {
        let isScore = false;
        if (d.face === 5 || d.face === 10)
            isScore = true;
        if (d.isFlash)
            isScore = true;
        if (d.face === ftFace)
            isScore = true;

        if (!isScore)
            ymnwt = false;
    }
    if (ymnwt) {
        for (d of dice)
            d.reroll = RR_MANDATORY;  // must reroll all dice

        $('.rerollCB').checkbox("set disabled");
        $('.rerollCB').show();
        html += 'YMNWTBYM Rule Invoked!<br/>';
        console.log('YMNWTBYM rule invoked');
    }

    // if none of the above rules were invoked, then all the rolled die should be 
    //if (ymnwt === false &&)


    // if there are any mandatory check boxes, make sure the stop turn button is hidden
    let rerollCount = 0;
    $('#stopTurnBtn').show(); //removeClass('disabled'); //prop("disabled", true);
    for (let d of dice) {
        if (d.reroll === RR_MANDATORY) 
            $('#stopTurnBtn').hide(); //removeClass('disabled'); //prop("disabled", true);
        if (d.reroll === RR_MANDATORY || d.reroll === RR_OPTIONAL || d.reroll === RR_NOT_SET)
            rerollCount++;
    }
    if (rerollCount === 0)
        $('#reRollBtn').hide(); //addClass('disabled'); //prop("disabled", false);  // you MUST reroll
    else
        $('#reRollBtn').show(); //addClass('disabled'); //prop("disabled", false);  // you MUST reroll

    $('#roll-actions').html(html);
    return;
}

// 0 = no reroll (hides)
// 1 = optional reroll (checks, enables)
// 2 = mandatory reroll (checks, disables)


function UpdateRerollCBs() {
    for (d of dice) {
        console.log('  Dice ' + d.index + ': reroll=' + d.reroll);

        switch (d.reroll) {
            case RR_NONROLLABLE:
                $('#rr-dice-' + d.index).hide();
                break;

            case RR_OPTIONAL:
            case RR_NOT_SET:
                $('#rr-dice-' + d.index).show();
                $('#rr-dice-' + d.index).checkbox('set enabled');
                $('#rr-dice-' + d.index).checkbox('set unchecked');
                break;

            case RR_MANDATORY:
                $('#rr-dice-' + d.index).show();
                $('#rr-dice-' + d.index).checkbox('set disabled');
                $('#rr-dice-' + d.index).checkbox('set checked');
                break;
        }
    }
    EnableRerollBtn();
}

function GetFaceFromIndex(index, special) {
    switch (index) {
        case 0: return 2;
        case 1: return special ? 0 : 3;
        case 2: return 4;
        case 3: return 5;
        case 4: return 6;
        case 5: return 10;
        default: alert('Bad Index');
    }
}

function GetIndexFromFace(face) {
    switch (face) {
        case 2: return 0;
        case 3: return 1;
        case 4: return 2;
        case 5: return 3;
        case 6: return 4;
        case 10: return 5;
        case 0: return 1; // wild card
        default: return -1; //alert('Bad Tile ' + face);
    }
}

function ReRoll() {
    // check for "checked" reroll checkboxes
    for (let d of dice) {
        if ($('#rr-dice-' + d.index).is(':visible') && $('#rr-dice-' + d.index).checkbox('is checked'))
            d.rolled = true;
        else
            d.rolled = false;
    }
    socket.emit('reroll dice', roomID, dice, turnScore);
}

function EnableRerollBtn() {
    let enabled = false;
    let scoringDieCount = 0;
    // enable the 'reRollBtn' if 
    //   1) at least one checkbox is checked, and
    //   2)  
    for (let i = 0; i < 5; i++) {
        if ($('#rr-dice-' + i).is(':visible') && $('#rr-dice-' + i).checkbox('is checked')) {
            $('#dimg-' + i).addClass('isRerollImg');
            // count the number of scoring die that aren't part of a flash
            if (dice[i].isFlash === false && (dice[i].face === 5 || dice[i].face === 10))
                scoringDieCount++;
            enabled = true;
        }
        else
            $('#dimg-' + i).removeClass('isRerollImg');
    }

    // enforce the rule that if you are rerolling, you have to leave at least one 
    // scoring die if possible
    //scoringDieCount = 0;
    //for (let d of dice) {
    //    if (d.isFlash === false && (d.face === 5 || d.face === 10))
    //}



    if (enabled)
        $('#reRollBtn').removeClass('disabled');
    else
        $('#reRollBtn').addClass('disabled');
}

function StopTurn() {
    socket.emit('stop turn', roomID, turnScore);

    UpdateScores();
}


function PopulateActiveRooms(rooms) {
    let $list = $('#joinRoomsList');
    $list.empty();

    if (rooms.length === 0) {
        $('#noActiveGames').show();
        $('#activeGames').hide();
    }
    else {
        $('#noActiveGames').hide();
        $('#activeGames').show();
    }

    let i = 1;
    for (r of rooms) {
        let players = [];
        let playerCount = 0;
        for (p of r.players) {
            if (p.role === 'player' || p.role === 'bot') {
                players.push(p.username);
                playerCount++;
            }
        }
        let pStr = players.join();
        pStr = pStr.replace(',', ', ');
        let button = "ui teal button";
        let roomLabel = 'Table ' + i + ': Waiting for more players';

        if (playerCount >= 4) {
            button = "ui disabled button";
            roomLabel = 'Table ' + i + ': This game is full';
        }
        i++;

        $list.append('<div class="item" >'
            + '<div class="right floated content">'
            + '  <div class="ui teal button" onclick="JoinRoom(\'' + r.roomID + '\',\'observer\'); return false;">Join as Observer</div>'
            + '</div>'
            + '<div class="right floated content">'
            + '  <div class="' + button + '" onclick="JoinRoom(\'' + r.roomID + '\',\'player\'); return false;">Join as Player</div>'
            + '</div>'
            + '<i class="large middle aligned user friends icon"></i>'
            + '<div class="content">'
            + '  <div class="header">' + roomLabel + '</div>'
            + '  <div class="description">Players: ' + pStr + '</div>'
            + '</div></div>');
    }
}


function JoinRoom(_roomID, role) {
    username = $("#username1").val();
    // strip out illegal characters
    username = username.replace(/[<,>,&,=\,]/gi, '');
    if (username.length === 0) {
        $('#joinMsg').removeClass('green').addClass('red');
        return false;
    }

    roomID = _roomID;

    $("#player").text("Player: " + username);

    socket.emit("new player", roomID, username, role);

    $('#join').modal('hide');
    return true;
}

function Observe(team, player) {
    // let server know this observer is changing teams
    socket.emit('update team', roomID, socket.id, team, player);
    $('#myHandAll').hide();
    $('#myHand').show();

    if (team !== -1) {
        socket.emit('get hand', roomID, team, player, (hand) => {
            hand.sort(SortCards);
            DistributeHand(hand, '', 90);
            console.log('Receiving hand: ' + hand.join());
            CountCards();
        });
    }
}

function ObserveAll() {
    // let server know this observer is changing teams
    socket.emit('update team', roomID, socket.id, -1, -1);
    $('#myHand').hide();
    $('#myHandAll').show();

    // get hands
    for (let team of [0, 1]) {
        for (let player of [0, 1]) {
            socket.emit('get hand', roomID, team, player, (hand) => {
                hand.sort(SortCards);
                let pre = 'obs-T' + team + 'P' + player + '-';
                DistributeHand(hand, pre, 65);
            });
        }
    }
}


function ResumeGame(team, player) {
    socket.emit('get state', roomID, (gs, teams, players) => {
        // we are resuming a game because a player or observer joined.  If that player is 
        // this player, update their state - otherwise, ignore.

        gameIsActive = true;

        let sender = false;

        // narrow to "this" player only, while collecting other player names
        for (let p of players) {
            if (p.socketID === socket.id) { // is this player me?
                if (p.team === team && p.player === player)
                    sender = true;
                break;
            }
        }

        // if I'm not the player added, don't update my state
        if (sender === false)
            return;

        for (p of players) {
            if (p.role === 'player' || p.role === 'bot')
                playerNames.push(p.username);
        }

        let msg = 'Current players are ' + playerNames.join().replace('/,/g', ', ');
        SetGameMsg('Resuming Game', msg, null, true);

        //let roomID = '';
        //let username = "";
        // team info set in'add player' 
        //let team = 0;
        //let teamA = [];
        //let teamB = [];
        //let observers = [];
        teamAScore = teams[0].score;
        teamBScore = teams[1].score;
        //let $selectedCard = null;
        //let discardsRemaining = 0;
        firstCardPlayedInRound = gs.firstCardPlayed; // card ID
        trumpSuit = gs.trumpSuit;
        currentRound = gs.currentRound;
        //let currentSocketID = '';
        //let currentPlayerName = '';
        //let observeeSocketID = '';

        // update UI

        // update scoreboard
        let teamAtricks = teams[0].tricks;
        let teamBtricks = teams[1].tricks;
        $('#teamAscore').html(teamA.join() + ': <span class="score">' + teamAScore + '</span>  (' + teamAtricks + ')');
        $('#teamBscore').html(teamB.join() + ': <span class="score">' + teamBScore + '</span>  (' + teamBtricks + ')');

        // bid summary    
        SetBidInScoreboard(gs.winningBidder, gs.currentBid);

        // update bid options
        AddBidOptions();

        // are we currently bidding? then cycle through options, removing as needed
        if (gs.gamePhase === GP_BIDDING) { // not first bid or prior pass?
            $('#ddlBids option').each(function () {
                let value = $(this).val();  // e.g. "RS"
                if (CompareBids(value, gs.currentBid) <= 0)  // + if a>b, - if a<b
                    $(this).remove();
            });
            // select top value
            $('#ddlBids')[0].selectedIndex = 0;
        }

        // put the current hand in the My Hand window
        for (let p of players) {
            if (socket.id === p.socketID) { /// is this us?
                let hand = p.hand;
                hand.sort(SortCards);
                DistributeHand(hand, '', 90);
                console.log('Resuming hand: ' + hand.join());
                break;
            }
        }
        CountCards();

        // depending on game state
        SetGameMsg(userMsgHdr, userMsgTxt, null, userMsgGreen);
    });

}

function SetGameMsg(hdr, text, buttonFn, green) {
    let $gmHdr = $('#gameMsgHdr');
    let $gmTxt = $('#gameMsgText');

    if (green)
        $('#gameMsgPanel').removeClass('red').addClass('green');
    else
        $('#gameMsgPanel').removeClass('green').addClass('red');

    if (buttonFn !== null) {
        $('#gameMsgBtn').click(buttonFn);
        $('#gameMsgBtn').show();
    }
    else {
        $('#gameMsgBtn').hide();
    }

    if (hdr === null)
        $gmHdr.hide();
    else {
        $gmHdr.html(hdr);
        $gmHdr.show();
    }

    if (text === null)
        $gmTxt.hide();
    else {
        $gmTxt.html(text);
        $gmTxt.show();
    }

}

function ToastMsg(msg) {
    $('#mainPanel').toast({ message: msg, displayTime: 5000, class: 'grey' });
}


function HighlightCurrentPlayer(currentPlayer) {
    for (let player of ['T0P0', 'T0P1', 'T1P0', 'T1P1']) {
        let $name = $('#' + player + 'name');
        if ($name.text() === currentPlayer)
            $name.addClass('currentPlayer');
        else if ($name.hasClass('currentPlayer'))
            $name.removeClass('currentPlayer').addClass('pastPlayer');

        if (isObserver) {
            $name = $('#obs-' + player + 'name');
            let $hand = $('#obs-' + player + 'hand');
            if ($name.text().trim() === currentPlayer)
                $hand.addClass('currentPlayer');
            else if ($hand.hasClass('currentPlayer'))
                $hand.removeClass('currentPlayer').addClass('pastPlayer');
        }
    }
}


// user clicked the "start game" button
function StartNewRoom() {
    username = $("#username1").val();
    // strip out illegal characters
    username = username.replace(/[<,>,&,=]/gi, '');
    if (username.length === 0) {
        $('#joinMsg').removeClass('green').addClass('red');
        return false;
    }

    socket.emit('add room', (newRoomID) => {
        roomID = newRoomID;
        $("#player").text("Player: " + username);

        socket.emit("new player", roomID, username, "player");
        //socket.emit("chat message", roomID, "Player " + username + " has joined the game");

        $('#obsPanel').hide();
        $('#join').modal('hide');
    });
}

function UpdateScores() {
    socket.emit('get scores', roomID, (playerScores) => {
        let table = '';
        for (ps of playerScores) {
            table += '<tr><td>' + ps.name + '</td><td>' + ps.score + '</td></tr>';
        }
        $('#scoreTable').html(table);
    });
}

function UpdateLeaderboard() {
    socket.emit('get leaderboard', (playerStats) => {
        let table = [];
        for (player in playerStats) {
            let ps = playerStats[player];
            let row = [];
            row.push(player);
            row.push(ps['Games']);
            row.push(ps['Games Won']);
            row.push(ps['% Won'].toFixed(2));

            if (ps['AHS'] === null)
                row.push('--');
            else
                row.push(ps['AHS'].toFixed(2));
            table.push(row);
        }

        $('#leaderboard').DataTable({
            data: table,
            columns: [
                { title: 'Name' },
                { title: 'Games' },
                { title: 'Games Won' },
                { title: '% Won' },
                { title: 'Avg Hand Strength' }
            ],
            destroy: true,
            'paging': false,
            'scrollY': '12em',
            'scrollCollapse': true,
            'searching': false,
            'info': false
        });

    });
}

let hsChart = null;
let hsCount = 0;
function UpdateHSChart(hsArray) {
    // get player names

    if (hsChart === null) {
        hsCount = 0;

        let ctx = document.getElementById('myChart').getContext('2d');
        hsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [], // x-axis
                datasets: [{
                    label: teamA[0],
                    backgroundColor: 'red',
                    borderColor: 'red',
                    fill: false,
                    data: []
                }, {
                    label: teamA[1],
                    backgroundColor: 'blue',
                    borderColor: 'blue',
                    fill: false,
                    data: []
                }, {
                    label: teamB[0],
                    backgroundColor: 'green',
                    borderColor: 'green',
                    fill: false,
                    data: []
                }, {
                    label: teamB[1],
                    backgroundColor: 'yellow',
                    borderColor: 'yellow',
                    fill: false,
                    data: []
                }]
            },
            options: {
                //title: { display: true, text: 'Hand Strengths this Game' }
                legend: {
                    labels: {
                        fontColor: 'white'
                    }
                }
            }
        });     // end of:  new Chart(...)
    }   // end of: if (hsChart === null)

    // update chart data with latest counts     
    hsChart.data.labels.push(hsCount.toString());
    hsChart.data.datasets.forEach((dataset, index) => {
        dataset.data.push(hsArray[index]);
    });
    hsChart.update();
    hsCount += 1;
}

/*
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
 
async function FadeMiddle() {
    let $middle = $('#hand-middle');  // first car
 
    await sleep(1000);
 
    while ($middle.children().length > 0) {
        let $last = $middle.children().last();
        let card = cards.cid($last);
        // make a new card element
        let $card = $("<img class='card' style='width:100px' src='cards/" + card + ".svg' />");
 
        [r, s] = GetRankAndSuit(card);
        switch (s) {
            case 'S': $('#hand-spades').append($card.hide().fadeIn(800)); break;
            case 'C': $('#hand-clubs').append($card.hide().fadeIn(800)); break;
            case 'D': $('#hand-diamonds').append($card.hide().fadeIn(800)); break;
            case 'H': $('#hand-hearts').append($card.hide().fadeIn(800)); break;
            case 'N': $('#hand-extras').append($card.hide().fadeIn(800)); break;
        }
        $last.fadeOut(800, function () {
            $(this).remove();
 
            CountCards();
 
        });
        await sleep(1000);
    }
 
    hand = GetCurrentHand();
    hand.sort(SortCards);
    DistributeHand(hand);
}
*/


let looper;
let loops = 0;
let degrees = 0;
function Rotate(el, speed, _loops) {
    if (loops > 360 * 2 - 20) {
        clearTimeout(looper);
        return;
    }
    loops = loops + 1;

    let elem = document.getElementById(el);
    if (navigator.userAgent.match("Chrome")) {
        elem.style.WebkitTransform = "rotate(" + degrees + "deg)";
    } else if (navigator.userAgent.match("Firefox")) {
        elem.style.MozTransform = "rotate(" + degrees + "deg)";
    } else if (navigator.userAgent.match("MSIE")) {
        elem.style.msTransform = "rotate(" + degrees + "deg)";
    } else if (navigator.userAgent.match("Opera")) {
        elem.style.OTransform = "rotate(" + degrees + "deg)";
    } else {
        elem.style.transform = "rotate(" + degrees + "deg)";
    }
    looper = setTimeout('Rotate(\'' + el + '\',' + speed + ',' + _loops + ')', speed);
    degrees++;
    if (degrees > 359) {
        degrees = 1;
    }
    return;
}
/////////////////////////////
// Start local code
/////////////////////////////
$("#join")
    .modal({
        closeable: false,
        onShow: function () {
            socket.emit('get rooms', (rooms) => {
                PopulateActiveRooms(rooms);
            });
        }
    })
    .modal('show');


$('#rr-dice-0').checkbox({
    onChecked: () => { socket.emit('reroll clicked', roomID, socket.id, 0, 1); return false; },
    onUnchecked: () => { socket.emit('reroll clicked', roomID, socket.id, 0, 0); return false; }
});

$('#rr-dice-1').checkbox({
    onChecked: () => { socket.emit('reroll clicked', roomID, socket.id, 1, 1); return false; },
    onUnchecked: () => { socket.emit('reroll clicked', roomID, socket.id, 1, 0); return false; }
});

$('#rr-dice-2').checkbox({
    onChecked: () => { socket.emit('reroll clicked', roomID, socket.id, 2, 1); return false; },
    onUnchecked: () => { socket.emit('reroll clicked', roomID, socket.id, 2, 0); return false; }
});

$('#rr-dice-3').checkbox({
    onChecked: () => { socket.emit('reroll clicked', roomID, socket.id, 3, 1); return false; },
    onUnchecked: () => { socket.emit('reroll clicked', roomID, socket.id, 3, 0); return false; }
});

$('#rr-dice-4').checkbox({
    onChecked: () => { socket.emit('reroll clicked', roomID, socket.id, 4, 1); return false; },
    onUnchecked: () => { socket.emit('reroll clicked', roomID, socket.id, 4, 0); return false; }
});


$('#dice-0').click(() => { $('#rr-dice-1').checkbox('toggle'); });
$('#dice-1').click(() => { $('#rr-dice-1').checkbox('toggle'); });
$('#dice-2').click(() => { $('#rr-dice-2').checkbox('toggle'); });
$('#dice-3').click(() => { $('#rr-dice-3').checkbox('toggle'); });
$('#dice-4').click(() => { $('#rr-dice-4').checkbox('toggle'); });
