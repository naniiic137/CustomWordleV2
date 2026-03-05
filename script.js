document.addEventListener('DOMContentLoaded', function () {

    /* ═══════════════════════════════════════════════════════
       LOCAL DEV FLAG
       Set to true to bypass all Netlify serverless calls so
       the game runs fully in-browser without a backend.
       ⚠️  REVERT TO false BEFORE DEPLOYING TO NETLIFY.
    ════════════════════════════════════════════════════════ */
    var LOCAL_DEV = false;


    /* ═══════════════════════════════════════════════════════
       CRYPTO — AES-128-GCM with key derivation
       Fragment in URL is a TOKEN, not the key. Key is derived via PBKDF2 so
       copying d + fragment into a script does not reveal the key without this code.
       URL: ?d=[iv(8)+ct+tag]base64url  #[token(16)]base64url
    ════════════════════════════════════════════════════════ */

    var B64={
        enc:function(buf){var b='',u=new Uint8Array(buf);for(var i=0;i<u.length;i++)b+=String.fromCharCode(u[i]);return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');},
        dec:function(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u.buffer;}
    };

    /* Hash the URL fragment to a hex ID we send to the server.
       The actual fragment (decryption token) never leaves the browser. */
    async function hashId(frag){
        var enc=new TextEncoder().encode(frag);
        var buf=await crypto.subtle.digest('SHA-256',enc);
        return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    }

    /* Derive 16-byte AES key from token using PBKDF2. Salt is app-specific so URL token alone is not the key. */
    async function deriveKey(tokenBuf){
        var salt=new Uint8Array([0x87,0x9a,0x2e,0x41,0x63,0x77,0x64,0x6c,0x65,0x5f,0x73,0x31,0x74,0x33,0x9c,0x4f]);
        var keyMaterial=await crypto.subtle.importKey('raw',tokenBuf,{name:'PBKDF2'},false,['deriveBits']);
        var bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:salt,iterations:100000,hash:'SHA-256'},keyMaterial,128);
        return new Uint8Array(bits);
    }

    function importKey(keyBuf){
        return crypto.subtle.importKey('raw',keyBuf,{name:'AES-GCM',length:128},false,['encrypt','decrypt']);
    }

    /* Encrypt: returns base64url of [iv(8)][ciphertext+tag] */
    async function seal(plain,keyBuf){
        var iv=crypto.getRandomValues(new Uint8Array(8));
        var key=await importKey(keyBuf);
        var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv,tagLength:128},key,plain);
        var out=new Uint8Array(8+ct.byteLength);
        out.set(iv,0);out.set(new Uint8Array(ct),8);
        return B64.enc(out.buffer);
    }

    /* Decrypt: base64url → Uint8Array */
    async function unseal(b64,keyBuf){
        var packed=new Uint8Array(B64.dec(b64));
        var iv=packed.slice(0,8),ct=packed.slice(8);
        var key=await importKey(keyBuf);
        var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv,tagLength:128},key,ct);
        return new Uint8Array(plain);
    }

    /* Pack config to binary. */
    function pack(cfg){
        var w=cfg.word.toUpperCase(),w2=(cfg.word2||'').toUpperCase(),mw=w2.length>0;
        var flags=(cfg.hide?1:0)|(cfg.nocol?2:0)|(cfg.nobk?4:0)|(cfg.one?8:0)|(cfg.rf?16:0)|(cfg.sd?32:0)|(mw?64:0)|(cfg.timed?128:0);
        var flags2=(cfg.fibble?1:0)|(cfg.absurdle?2:0)|(cfg.mirror?4:0)|(cfg.fakenews?8:0)|(cfg.gaslight?16:0)|(cfg.schrodinger?32:0)|(cfg.falsehope?64:0)|(cfg.mimic?128:0);
        var mp=cfg.maxPlayers||0;
        /* flags3 bit layout: 1=showModes, 2=dictRestrict, 4=glitch, 8=hasMaxPlayers */
        var flags3=(cfg.showModes?1:0)|(cfg.dictRestrict?2:0)|(cfg.glitch?4:0)|(mp>0?8:0);
        var t=cfg.timer||0;
        var header=[];
        header.push(w.length);
        for(var c=0;c<w.length;c++)header.push(w.charCodeAt(c));
        header.push(flags,cfg.hints||0,cfg.guesses||6,cfg.plays||0,cfg.used||0,(t>>8)&0xff,t&0xff);
        if(mw){header.push(w2.length);for(var c=0;c<w2.length;c++)header.push(w2.charCodeAt(c));}
        header.push(0x01,flags2,cfg.hintUnlock||0,flags3);
        /* Append maxPlayers as 2 bytes only when non-zero (flag bit 8 signals presence) */
        if(mp>0)header.push((mp>>8)&0xff,mp&0xff);
        return new Uint8Array(header);
    }

    /* Unpack binary to config. */
    function unpack(u){
        var i=0,wl=u[i++],w='';
        for(var c=0;c<wl;c++)w+=String.fromCharCode(u[i++]);
        var f=u[i++],hints=u[i++],guesses=u[i++],plays=u[i++],used=u[i++];
        var timer=(u[i++]<<8)|u[i++],w2='';
        if(f&64){var w2l=u[i++];for(var c=0;c<w2l;c++)w2+=String.fromCharCode(u[i++]);}
        var f2=0,hintUnlock=0,f3=0,maxPlayers=0;
        var savedGuesses=[],savedGuesses2=[];
        /* New links start this section with magic byte 0x01.
           Old links go straight to 0x00 (progress marker) or end of buffer. */
        if(i<u.length&&u[i]===0x01){
            i++; /* skip magic marker */
            f2=u[i++]||0;
            hintUnlock=u[i++]||0;
            f3=u[i++]||0;
            /* flags3 bit 8 signals two maxPlayers bytes follow (backward-compatible) */
            if((f3&8)&&i+1<u.length)maxPlayers=(u[i++]<<8)|u[i++];
        }
        if(i<u.length&&u[i]===0){
            i++;
            try{var jsonStr=new TextDecoder().decode(u.slice(i));var parsed=JSON.parse(jsonStr);savedGuesses=parsed.g||[];savedGuesses2=parsed.g2||[];}catch(e){}
        }
        return{word:w,word2:w2,hide:!!(f&1),nocol:!!(f&2),nobk:!!(f&4),one:!!(f&8),rf:!!(f&16),sd:!!(f&32),timed:!!(f&128),
               fibble:!!(f2&1),absurdle:!!(f2&2),mirror:!!(f2&4),fakenews:!!(f2&8),gaslight:!!(f2&16),schrodinger:!!(f2&32),falsehope:!!(f2&64),mimic:!!(f2&128),
               showModes:!!(f3&1),dictRestrict:!!(f3&2),glitch:!!(f3&4),
               hints:hints,guesses:guesses,plays:plays,used:used,timer:timer,hintUnlock:hintUnlock,maxPlayers:maxPlayers,savedGuesses:savedGuesses,savedGuesses2:savedGuesses2};
    }

    /* Generate 16-byte key → 22-char base64url secret */
    function genSecret(){return B64.enc(crypto.getRandomValues(new Uint8Array(16)).buffer);}

    /* ─────────────────────────────────────────────────────────
       PLAYER FINGERPRINT
       Returns a 64-hex SHA-256 of stable browser properties.
       Identical between normal and private tabs in the same
       browser (Chrome/Edge/Safari), so private-tab replays are
       correctly identified as the same player and get blocked
       once their personal attempt quota is exhausted.
    ───────────────────────────────────────────────────────── */
    async function getPlayerFingerprint(){
        var parts=[];
        /* Canvas fingerprint — most distinctive signal */
        try{
            var cv=document.createElement('canvas');cv.width=200;cv.height=50;
            var cx=cv.getContext('2d');
            cx.textBaseline='top';
            cx.font='14px Arial';
            cx.fillStyle='#f60';
            cx.fillRect(125,1,62,20);
            cx.fillStyle='#069';
            cx.fillText('Wordle\uD83C\uDFAE',2,15);
            cx.fillStyle='rgba(102,204,0,0.7)';
            cx.fillText('Wordle\uD83C\uDFAE',4,17);
            parts.push(cv.toDataURL());
        }catch(e){parts.push('nc');}
        /* Local Session ID — differentiates tabs so multiple tabs don't occupy a single lobby slot */
        var sid=sessionStorage.getItem('wordle_session_id');
        if(!sid){sid=Math.random().toString(36).slice(2,10);try{sessionStorage.setItem('wordle_session_id',sid);}catch(e){}}
        parts.push(sid);

        /* Stable navigator & screen properties */
        parts.push(navigator.userAgent||'');
        parts.push(navigator.language||'');
        parts.push(String(navigator.hardwareConcurrency||0));
        parts.push(navigator.platform||'');
        parts.push(screen.width+'x'+screen.height);
        parts.push(String(screen.colorDepth||0));
        parts.push(String(new Date().getTimezoneOffset()));
        var combined=parts.join('\x01');
        var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(combined));
        return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    }

    /* ═══════════════════════════════════════════════════════
       ABSURDLE WORD LIST (common 5-letter words)
    ════════════════════════════════════════════════════════ */
    var WORDS5='abbey abhor abide abode abort about above abuse abyss acres acute admit adobe adopt adult after again agate agile agony agree ahead aided aimer aired aisle alarm album alert alike alien align alike allay alley allot allow aloft alone along aloof aloud alpen altar alter angel anger angle angry anime ankle annex anvil apart aphid apple apply apron aptly arbor arcane ardor arena argue arise arose array arson aside asked aspen asset atone attic audio audit augur avail avid avoid awake award aware awful babel baker baked balmy banjo banter baron batch beach braid brand brave bread break breed brine brisk broad broke brood brook brown brunt brute budge bulge bulky bully bunch bunny burly burnt burst cabin camel candy cargo carry camel cards caste cedar chalk champ chant charm chart chase cheap cheat check cheek chess chest chide child chime chirp chive chore chose civic clamp clank clash cling cloak clock clone close cloth cloud clown clump comet comet coral could count crave crawl crisp cross crowd crown crush curve daily dairy daisy dance dandy dated daylight dazes dealt decay deck decor delay dense depot depth deter diced digit dirge dirty disco ditty dodge dogma doubt dough dowdy dowry draft drain drama drape drawl dread dried drift drill drink droop drove drown drugs dryer duchy dully dumpy dunce dusty dwarf dwell dying eager early earns earth easel ebony efface eight elite ember emcee endow enjoy ennui envoy epoch erase erect erode erupt essay evade event every evict exist expel extol fable faced fails faint fairy faith false fancy fated fatty feast ferry fetch fetal fetch fever flair flame flank flare flash flask flaunt flesh flung flute foamy focus folly forge forth found frank fraud freak froth frost fudge fussy fuzzy games garb gauge gauze gavel glare glean glide gliph globe gloom gloss glove glyph goofy gorge gouge grace grade grain grasp graze greed greedy grill groan grope gross grove grove growl gruel guess guest guile gulch gusto gypsy habit hairy handy harsh haven havoc hazel heady heart hearth heist herbal herbs herds hinge hippo hippy hoist holly homer honey honor horse hound house hovels humid humus hurry hyena ideal idiot image impact inbox inept inert infer ingot inker input inter irked irate ivory jaunt jazzy jelly jewel jiffy jolly joust juicy jumpy keyed kiddo knack knave kneel knelt knobs knoll known kudos laden lager lapse larch laser latch later latte laugh layer leaky leapt ledge legal lemma lemon lethal level liege light lingo liner liner lingo lingo liner lisps liter liver lodge logic loopy lorry lotus lover lower lucid lurid lusty maker manic manor manly maple march masse mayor mealy meant messy metal minty mocha moody moose morph mossy mourn muddy mulch munch murky musty nasal needy nerve newsy nifty nippy noble nodal noise nonce noisy notch novel nymph occur ocean ochre offer often olive onion onset optic orbit order other otter ought outdo outdo outer oven ovoid oxide ozone paddy pansy papaw papal paper parka parse party pasta paste patio patsy paved payer peach pedal penny perky pesky petal petty phony pilot pinch piney pixel pizza place placid plaid plait plank plant plaza plead pleat pluck plumb plume plump plunk poach podgy poker polar polka poppy posse potty pouch prawn presto prima prime primp prism privy probe prone prong prone proof proud prove prowl proxy prune psalm psalm pubic pudgy pulse punch pupil purple quaff qualm qualm quaff rainy rally ramen ranch rapid raspy raven rawer reach reach realm realm reedy reign regal relax relay renal repay repel repay reset retch reuse revel rhyme rider ridge risky rivet roach rocky rouge rover rowdy rugged ruler rumba rupee rural sadly saint sauce saute saucy scale scald scant scoff scold scone scope score scout scowl scram scrap scrub scuff sedan seedy seize sense serum setup seven sewer shaky shale shame shank shard share shark sheen sheep sheer shelf shell shied shift shire shirk shirt shoal shred shrine shrug shuck sight silky since siren sixth sixty skate skimp skirt skull slain slang slant slash slick slide slime slimy slink slope slosh sloth slunk slurp small smear smite smoky snare sneak sneer snide sniff snipe snoop snout snowy soapy soggy solar solemn solid solve sonic sorry spare spark spawn speak speck spicy spill spire spoke spore spout spray spree sprig spunk squad squat squid stale stall stamp stand stank stark stark stash stave steam steel stern stiff sting stink stock stomp stone stool storm story stout stove strap straw strut stuck stump stung stunt suave sugar suave suite sulky sunny surge swab swam swamp swath swear sweat sweet swept swift swine swoop swore table tacky taffy taken tapir tardy taunt tawny tepid terse theme there thick thief thigh thing think thorn those three throe threw throw thrum tidal tiger tilts tithe topaz toxic track trade trail train tramp traps trash trawl tread treat trend trial trice trick tried tripe trite troll troop trove truce truly trump trump truss tryst tuber tunic twerp twill twirl twitch ulcer umber unwed upend usurp utter vapor viper viral vodka vogue voter wacky waltz warty waste watch water weary wedge weird whack whiff whirl while whirl whisk white whole whose wield windy witch witty wrath wrist wrote xenon yacht yummy zesty zippy';

    var WORDS5_ARR=null;
    function getAbsurdleList(len){
        if(len===5){
            if(!WORDS5_ARR)WORDS5_ARR=WORDS5.split(' ').filter(function(w){return w.length===5;});
            return WORDS5_ARR;
        }
        /* For non-5-letter words, generate plausible fakes by permuting the target */
        return [targetWord];
    }

    /* Score guess against a potential target (pure, no side effects) */
    function scoreAgainst(guess,target){
        var ta=target.split(''),ga=guess.split(''),res=new Array(ga.length);
        for(var i=0;i<ga.length;i++)if(ga[i]===ta[i]){res[i]='C';ta[i]=null;}
        for(var i=0;i<ga.length;i++){
            if(res[i])continue;
            var idx=ta.indexOf(ga[i]);
            if(idx>-1){res[i]='P';ta[idx]=null;}else res[i]='A';
        }
        return res.join('');
    }

    /* After a guess, pick adversarial target from remaining candidates */
    function absurdlePickTarget(guess,candidates){
        var groups={};
        for(var i=0;i<candidates.length;i++){
            var key=scoreAgainst(guess,candidates[i]);
            if(!groups[key])groups[key]=[];
            groups[key].push(candidates[i]);
        }
        var best=null,bestKey='';
        for(var k in groups){if(!best||groups[k].length>best.length){best=groups[k];bestKey=k;}}
        /* If the "win" bucket is the largest, prefer the next largest to avoid accidental easy win */
        var allCorrect=guess.split('').map(function(){return'C';}).join('');
        if(bestKey===allCorrect&&Object.keys(groups).length>1){
            var second=null;
            for(var k in groups){if(k!==allCorrect&&(!second||groups[k].length>second.length))second=groups[k];}
            if(second&&second.length>0)best=second;
        }
        return best;
    }

    /* Check if a candidate word is consistent with all previous scored rows */
    function isConsistent(word,history){
        for(var h=0;h<history.length;h++){
            var row=history[h];
            if(scoreAgainst(row.guess,word)!==row.key)return false;
        }
        return true;
    }

    /* ═══════════════════════════════════════════════════════
       GAME STATE
    ════════════════════════════════════════════════════════ */

    var gameContainer=document.getElementById('game-container');
    var creatorContainer=document.getElementById('creator-container');
    var gameBoard=document.getElementById('game-board');
    var keyboardContainer=document.getElementById('keyboard-container');

    var targetWord='',wordLength=5,currentRow=0,currentCol=0;
    var isGameOver=false,hideWordOnLoss=false,hintsRemaining=0;
    var maxGuesses=6,maxPlays=0,playsUsed=0,maxPlayersLimit=0;
    var noColorFeedback=false,noBackspace=false,oneStrike=false;
    var revealFirst=false,shareDist=false,multiWord=false;
    var timedMode=false,timerSeconds=0,timerInterval=null;
    var targetWord2='',currentCol2=0,word2Solved=false;
    var guessGrid=[],guessGrid2=[];
    var masterKeyBuf=null;
    var currentPlayId=null,currentLinkId=null;

    /* ── New mode flags ── */
    var fibbleMode=false,absurdleMode=false,mirrorMode=false,fakeNewsMode=false;
    var gaslightMode=false,schrodingerMode=false,falseHopeMode=false,mimicMode=false;
    var dictRestrictMode=false,glitchMode=false;
    var hintUnlockAfter=0,showModesFlag=false;
    var glitchInterval=null;
    /* Absurdle: surviving word candidates */
    var absurdleCandidates=[];
    /* Schrödinger: which position is unstable, and the alternate letter */
    var schrodingerPos=-1,schrodingerAlt='';
    /* False Hope: first guess fake yellows, cleared after row 1 */
    var falseHopeFired=false,falseHopeFakes=[];
    /* Mimic: set once first guess submitted */
    var mimicReady=false;

    /* ═══════════════════════════════════════════════════════
       INIT
    ════════════════════════════════════════════════════════ */

    var STORAGE_PLAYS_PREFIX = 'wordle_plays_';
    var STORAGE_PROGRESS_PREFIX = 'wordle_progress_';

    async function init(){
        var p=new URLSearchParams(window.location.search),d=p.get('d');
        if(d){
            var frag=window.location.hash.replace(/^#/,'');
            if(!frag){showCreatorWithMessage('Invalid link (missing key.)');return;}
            var tokenBuf;
            try{tokenBuf=new Uint8Array(B64.dec(frag));}
            catch(e){showCreatorWithMessage('Invalid link.');return;}
            masterKeyBuf=await deriveKey(tokenBuf);
            var cfg;
            try{cfg=unpack(await unseal(d,masterKeyBuf));}
            catch(e){
                try{masterKeyBuf=tokenBuf;cfg=unpack(await unseal(d,masterKeyBuf));}
                catch(e2){showCreatorWithMessage('This link is invalid or has been tampered with.');return;}
            }

            var word=cfg.word.toUpperCase();
            if(!word||!/^[A-Z]+$/.test(word)){showCreatorWithMessage('Invalid link.');return;}

            targetWord=word;wordLength=word.length;hideWordOnLoss=cfg.hide;
            hintsRemaining=cfg.hints;maxGuesses=cfg.guesses||6;
            maxPlays=cfg.plays;playsUsed=cfg.used;maxPlayersLimit=cfg.maxPlayers||0;
            noColorFeedback=cfg.nocol;noBackspace=cfg.nobk;oneStrike=cfg.one;
            revealFirst=cfg.rf;shareDist=cfg.sd;timerSeconds=cfg.timer;timedMode=timerSeconds>=10;

            /* New mode flags */
            fibbleMode=cfg.fibble;absurdleMode=cfg.absurdle;mirrorMode=cfg.mirror;fakeNewsMode=cfg.fakenews;
            gaslightMode=cfg.gaslight;schrodingerMode=cfg.schrodinger;falseHopeMode=cfg.falsehope;mimicMode=cfg.mimic;
            dictRestrictMode=cfg.dictRestrict;glitchMode=cfg.glitch;
            hintUnlockAfter=cfg.hintUnlock||0;showModesFlag=cfg.showModes;

            /* Absurdle: init candidates to full word list, ensure creator's word is included */
            if(absurdleMode){
                absurdleCandidates=getAbsurdleList(wordLength).slice();
                if(absurdleCandidates.indexOf(targetWord.toLowerCase())===-1)absurdleCandidates.push(targetWord.toLowerCase());
            }
            /* Schrödinger: pick a random position and a random alternate letter */
            if(schrodingerMode){
                schrodingerPos=Math.floor(Math.random()*wordLength);
                var alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                do{schrodingerAlt=alpha[Math.floor(Math.random()*26)];}while(schrodingerAlt===targetWord[schrodingerPos]);
            }

            var w2=cfg.word2.toUpperCase();
            if(w2&&w2.length===wordLength&&/^[A-Z]+$/.test(w2)){targetWord2=w2;multiWord=true;}

            /* ── Server-side attempt tracking ─────────────────────────────
               Only active when creator set a max-plays limit.
               We hash the fragment so the real decryption token never reaches the server.
               The server stores { used, max } per link and is the single source of truth.
               If the server is unreachable the link is blocked (fail closed = secure). */
            if(maxPlays>0||maxPlayersLimit>0){
                /* Fingerprint this browser so each person gets their own attempt quota.
                   Same fingerprint in normal + private tabs (Chrome/Edge/Safari) means
                   a private-tab replay is detected and blocked once quota is exhausted. */
                var playerFp=await getPlayerFingerprint();
                var pingInterval=10000;

                if(LOCAL_DEV){
                    /* ── LOCAL DEV: simulate lobby pinging and per-player caps ──
                       devKey     = per-player attempt counter
                       playersKey = map of { fingerprint: lastPingTime } */
                    var devKey='wordle_dev_'+d.slice(0,16)+'_'+playerFp.slice(0,16);
                    var devUsed=parseInt(localStorage.getItem(devKey)||'0',10);

                    var playersKey='wordle_dev_pl_'+d.slice(0,16);
                    var seenPlayers=JSON.parse(localStorage.getItem(playersKey)||'{}');
                    var now=Date.now();
                    var fpShort=playerFp.slice(0,16);

                    /* Check total-player lobby cap first */
                    if(devUsed===0&&maxPlayersLimit>0){
                        if(!seenPlayers[fpShort]){
                            /* Clean up expired pings (>20s old) to find active count */
                            var activeCount=0;
                            for(var k in seenPlayers){if(now-seenPlayers[k]<20000)activeCount++;}
                            if(activeCount>=maxPlayersLimit){showBlockedScreen();return;}
                        }
                    }

                    /* Mark this player as active right now */
                    seenPlayers[fpShort]=now;
                    localStorage.setItem(playersKey,JSON.stringify(seenPlayers));

                    /* Check per-player attempt cap */
                    if(maxPlays>0&&devUsed>=maxPlays){showBlockedScreen();return;}
                    if(maxPlays>0){devUsed++;localStorage.setItem(devKey,devUsed);}
                    playsUsed=devUsed;
                    currentLinkId=null;
                    currentPlayId='dev-'+Date.now();

                    /* Start local Ping loop */
                    setInterval(function(){
                        var p=JSON.parse(localStorage.getItem(playersKey)||'{}');
                        p[fpShort]=Date.now();
                        localStorage.setItem(playersKey,JSON.stringify(p));
                    },pingInterval);

                } else {
                    /* ── PRODUCTION: server tracks players and handles ping ──────────────── */
                    var linkId=await hashId(frag);
                    var serverBlocked=false;
                    var serverReachable=false;
                    try{
                        var res=await fetch('/.netlify/functions/play',{
                            method:'POST',
                            headers:{'Content-Type':'application/json'},
                            body:JSON.stringify({id:linkId,playerId:playerFp,max:maxPlays,maxPlayers:maxPlayersLimit})
                        });
                        if(res.ok){
                            var data=await res.json();
                            playsUsed=data.used;
                            serverBlocked=data.blocked;
                            serverReachable=true;
                            currentLinkId=linkId;
                            currentPlayId=data.playId||null;
                        }
                    }catch(e){}

                    if(!serverReachable||serverBlocked){showBlockedScreen();return;}

                    /* Start production Ping loop */
                    setInterval(function(){
                        fetch('/.netlify/functions/play',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:linkId,playerId:playerFp,ping:true})}).catch(function(){});
                    },pingInterval);
                }
            }

            /* Board state is intentionally NOT cleared on load for max-plays links.
               Mid-game guesses (submitted, coloured tiles) survive a page refresh.
               Completed-game state IS still cleared by clearProgress() inside
               showWinOverlay / showLossOverlay / showGameOverScreen, so a new
               attempt after a finished game always starts with a clean board. */

            /* Progress restore */
            var savedProgress=null;
            try{
                var prog=localStorage.getItem(STORAGE_PROGRESS_PREFIX+frag);
                if(prog){var parsed=JSON.parse(prog);var hasG=parsed.g&&parsed.g.length>0,hasG2=parsed.g2&&parsed.g2.length>0;if(hasG||hasG2)savedProgress={savedGuesses:parsed.g||[],savedGuesses2:parsed.g2||[],partial:parsed.partial};}
            }catch(e){}
            if(!savedProgress&&(cfg.savedGuesses&&cfg.savedGuesses.length>0||cfg.savedGuesses2&&cfg.savedGuesses2.length>0))savedProgress={savedGuesses:cfg.savedGuesses||[],savedGuesses2:cfg.savedGuesses2||[]};

            creatorContainer.classList.add('hidden');gameContainer.classList.remove('hidden');
            var col=document.getElementById('create-own-link');if(col)col.classList.remove('hidden');
            initializeGame(savedProgress);
        }else{
            gameContainer.classList.add('hidden');creatorContainer.classList.remove('hidden');setupCreator();
        }
    }

    // Save progress to localStorage only (URL stays stable). Includes partial row (typed-but-not-submitted).
    function getPartialRow(){
        var cells=[],cells2=[];
        for(var c=0;c<wordLength;c++){
            var t=document.getElementById('tile-'+currentRow+'-'+c);cells.push(t?t.textContent.trim():'');
            if(multiWord){var t2=document.getElementById('tile2-'+currentRow+'-'+c);cells2.push(t2?t2.textContent.trim():'');}
        }
        return{row:currentRow,cells:cells,cells2:multiWord?cells2:[]};
    }
    function saveProgress(){
        try{
            var frag=window.location.hash.replace(/^#/,'');
            if(!frag)return;
            // When game is over, don't re-save (e.g. beforeunload on "Play Again") so next load gets clear board
            if(isGameOver){clearProgress();return;}
            var partial=getPartialRow();
            var hasAny=partial.cells.some(function(l){return l!=='';})||(multiWord&&partial.cells2.some(function(l){return l!=='';}));
            localStorage.setItem(STORAGE_PROGRESS_PREFIX+frag,JSON.stringify({g:guessGrid,g2:guessGrid2,partial:hasAny?partial:null}));
        }catch(e){if(typeof showToast==='function')showToast('Could not save progress.',2000);}
    }

    // Clear saved progress from localStorage on game end
    function clearProgress(){
        try{
            var frag=window.location.hash.replace(/^#/,'');
            if(!frag)return;
            localStorage.removeItem(STORAGE_PROGRESS_PREFIX+frag);
        }catch(e){}
    }

    /* ═══════════════════════════════════════════════════════
       SCREENS
    ════════════════════════════════════════════════════════ */

    function showBlockedScreen(){
        document.body.innerHTML='';
        var o=buildOverlay({icon:'🔒',title:'No Attempts Left',body:"You\u2019ve used all your allowed attempts.",sub:'Ask the creator to send you a fresh link.',btnText:null});
        o.classList.add('visible');document.body.appendChild(o);
    }

    function reportResult(won,guesses){
        if(LOCAL_DEV)return; /* LOCAL DEV: skip result reporting */
        if(!currentLinkId||!currentPlayId)return;
        try{fetch('/.netlify/functions/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:currentLinkId,playId:currentPlayId,won:won,guesses:guesses})});}catch(e){}
    }

    async function showGameOverScreen(isWin){
        clearProgress();
        reportResult(isWin, isWin ? currentRow+1 : maxGuesses);
        var left=maxPlays-playsUsed,icon,title,body,sub;
        if(isWin){icon='🎉';title='Well done!';body='You found the word in '+(currentRow+1)+' guess'+(currentRow+1!==1?'es':'')+'!';}
        else{icon='😔';title='Better luck next time';body=!hideWordOnLoss?'The word was <strong>'+targetWord+'</strong>.': "You didn\u2019t find the word this time.";}
        sub=left>0?'You have '+left+' attempt'+(left!==1?'s':'')+' remaining.':(isWin?"You\u2019ve used all your attempts.":"This link is now locked.");
        var dist=shareDist?buildEmojiGrid(isWin):null;
        setTimeout(function(){
            var o=buildOverlay({icon:icon,title:title,body:body,sub:sub,dist:dist,winCard:isWin,btnText:left>0?'Play Again ('+left+' left)':null,onBtn:function(){location.reload();}});
            document.body.appendChild(o);requestAnimationFrame(function(){o.classList.add('visible');});
        },800);
    }

    function buildEmojiGrid(isWin){
        function rs(grid){return grid.map(function(row){return row.map(function(e){var s=e.s||e;return s==='correct'?(noColorFeedback?'⬜':'🟩'):s==='present'?(noColorFeedback?'⬜':'🟨'):'⬛';}).join('');}).join('\n');}
        var cnt=isWin?(currentRow+1)+'/'+maxGuesses:'X/'+maxGuesses;
        var out='Wordle '+cnt+'\n'+rs(guessGrid);
        if(multiWord&&guessGrid2.length)out+='\n\nWord 2\n'+rs(guessGrid2);
        return out;
    }

    function buildOverlay(opts){
        var el=document.createElement('div');el.className='end-overlay';
        var dh=opts.dist?'<div class="dist-grid"><pre class="dist-emoji">'+opts.dist+'</pre><button class="dist-copy-btn">Copy Result</button></div>':'';
        el.innerHTML='<div class="end-card'+(opts.winCard?' win-card':'')+'"><div class="end-icon">'+opts.icon+'</div><h2 class="end-title">'+opts.title+'</h2><p class="end-body">'+opts.body+'</p><p class="end-sub">'+(opts.sub||'')+'</p>'+dh+(opts.btnText?'<button class="end-btn">'+opts.btnText+'</button>':'')+' </div>';
        if(opts.btnText&&opts.onBtn)el.querySelector('.end-btn').addEventListener('click',opts.onBtn);
        if(opts.dist)el.querySelector('.dist-copy-btn').addEventListener('click',function(){navigator.clipboard.writeText(opts.dist).catch(function(){});showToast('Copied! \uD83D\uDCCB',1500);});
        return el;
    }

    function showCreatorWithMessage(msg){gameContainer.classList.add('hidden');creatorContainer.classList.remove('hidden');showToast(msg);setupCreator();}

    /* ═══════════════════════════════════════════════════════
       GAME INIT
    ════════════════════════════════════════════════════════ */

    var saveProgressTimeout=null;
    function scheduleSaveProgress(){
        if(saveProgressTimeout)clearTimeout(saveProgressTimeout);
        saveProgressTimeout=setTimeout(function(){saveProgress();saveProgressTimeout=null;},600);
    }

    function initializeGame(savedProgress){
        applyDynamicSizing();createBoard();createKeyboard();
        updateHintButton();updatePlaysCounter();showActiveModes();
        document.getElementById('hint-button').addEventListener('click',useHint);
        document.addEventListener('keydown',handleKeyPress);
        window.addEventListener('beforeunload',function(){saveProgress();});

        if(savedProgress&&(savedProgress.savedGuesses&&savedProgress.savedGuesses.length>0||savedProgress.savedGuesses2&&savedProgress.savedGuesses2.length>0)){
            restoreProgress(savedProgress.savedGuesses,savedProgress.savedGuesses2,savedProgress.partial);
        } else {
            if(revealFirst){
                var ft=document.getElementById('tile-0-0');
                if(ft){ft.textContent=targetWord[0];ft.classList.add('filled','tile-locked');currentCol=1;}
                if(multiWord){var ft2=document.getElementById('tile2-0-0');if(ft2){ft2.textContent=targetWord2[0];ft2.classList.add('filled','tile-locked');currentCol2=1;}}
            }
        }
        if(timedMode)startTimer();
        if(glitchMode)startGlitch();
    }

    function restoreProgress(savedG, savedG2, partial){
        guessGrid=savedG||[];
        guessGrid2=savedG2||[];

        function renderGrid(grid, prefix){
            for(var r=0;r<grid.length;r++){
                var row=grid[r];
                for(var c=0;c<row.length;c++){
                    var entry=row[c];
                    if(!entry)continue;
                    var tile=document.getElementById(prefix+'-'+r+'-'+c);
                    if(tile){
                        tile.textContent=entry.l||'';
                        tile.classList.add('filled');
                        var cls=entry.s==='correct'?'correct':entry.s==='present'?'present':'absent';
                        tile.classList.add(noColorFeedback?(entry.s==='correct'?'correct':'absent-silent'):cls);
                    }
                    if(entry.l&&!noColorFeedback){
                        var kEl=document.getElementById('key-'+entry.l);
                        if(kEl){
                            var rank=function(s){return s==='correct'?2:s==='present'?1:0;};
                            if(rank(entry.s)>rank(kEl.dataset.status||'')){
                                kEl.classList.remove('present','absent','correct');
                                kEl.classList.add(entry.s);kEl.dataset.status=entry.s;
                            }
                        }
                    }
                }
            }
        }

        renderGrid(guessGrid,'tile');
        if(multiWord)renderGrid(guessGrid2,'tile2');

        currentRow=guessGrid.length;
        currentCol=revealFirst?1:0;
        currentCol2=revealFirst?1:0;

        if(revealFirst){
            var ft=document.getElementById('tile-'+currentRow+'-0');
            if(ft&&!ft.textContent){ft.textContent=targetWord[0];ft.classList.add('filled','tile-locked');currentCol=1;}
            if(multiWord){var ft2=document.getElementById('tile2-'+currentRow+'-0');if(ft2&&!ft2.textContent){ft2.textContent=targetWord2[0];ft2.classList.add('filled','tile-locked');currentCol2=1;}}
        }

        // Restore partial row (typed but not submitted) so refresh doesn't lose letters
        if(partial&&partial.row===currentRow&&partial.cells&&Array.isArray(partial.cells)){
            for(var c=0;c<wordLength&&c<partial.cells.length;c++){
                var letter=(partial.cells[c]||'').toUpperCase();
                if(letter&&letter.length===1&&letter>='A'&&letter<='Z'){
                    var tile=document.getElementById('tile-'+currentRow+'-'+c);
                    if(tile){tile.textContent=letter;tile.classList.add('filled');}
                    currentCol=c+1;
                }
            }
            if(multiWord&&partial.cells2&&Array.isArray(partial.cells2)){
                for(var c=0;c<wordLength&&c<partial.cells2.length;c++){
                    var letter=(partial.cells2[c]||'').toUpperCase();
                    if(letter&&letter.length===1&&letter>='A'&&letter<='Z'){
                        var tile2=document.getElementById('tile2-'+currentRow+'-'+c);
                        if(tile2){tile2.textContent=letter;tile2.classList.add('filled');}
                        currentCol2=c+1;
                    }
                }
            }
        }
    }

    function applyDynamicSizing(){
        var len=wordLength;
        var vw=window.innerWidth;
        var style=document.getElementById('ds');
        if(!style){style=document.createElement('style');style.id='ds';document.head.appendChild(style);}

        if(multiWord){
            // Each board: fit two side by side with a gap, within the viewport
            var gap=56, sidePad=16;
            var totalAvail=Math.min(vw - sidePad*2, 680);
            var perBoard=Math.floor((totalAvail - gap) / 2);
            var ts=Math.max(24,Math.min(52,Math.floor((perBoard - 6*(len-1)) / len)));
            var bw=ts*len + 6*(len-1);
            var totalBoardW=bw*2 + gap;
            var tfs=Math.max(0.8,Math.min(1.45, ts/36));
            // Keyboard: same width as total boards
            var kba=totalBoardW;
            var kw=Math.max(18,Math.min(38,Math.floor((kba - 9*5) / 10)));
            var kh=Math.max(34,Math.min(48,Math.round(kw*1.3)));
            var kf=Math.max(0.56,Math.min(0.78, kw/44));
            var lkw=Math.round(kw*1.5);
            style.textContent=[
                '.tile{width:'+ts+'px;height:'+ts+'px;font-size:'+tfs+'rem;min-width:0;}',
                '.tile::before{display:none;}',
                '.row{display:grid;grid-template-columns:repeat('+len+','+ts+'px);gap:6px;justify-content:center;}',
                '.key{height:'+kh+'px;min-width:'+kw+'px;max-width:'+(kw+10)+'px;font-size:'+kf+'rem;}',
                '.key.large{min-width:'+lkw+'px;max-width:'+(lkw+10)+'px;font-size:'+(kf*0.9)+'rem;}',
                '#keyboard-container{width:'+kba+'px;max-width:100%;margin:1.25rem auto 0;}',
                '.keyboard-row{gap:4px;}',
                '.dual-board-wrap{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;gap:'+gap+'px!important;width:'+totalBoardW+'px;max-width:100%;}',
                '.board-half{flex:0 0 '+bw+'px!important;width:'+bw+'px!important;min-width:0;display:flex;flex-direction:column;gap:0.4rem;}',
                '.board-grid{width:'+bw+'px;display:grid;grid-template-rows:repeat('+maxGuesses+',1fr);gap:6px;}',
                '#hint-button{width:'+totalBoardW+'px;max-width:100%;}',
            ].join('\n');
        } else {
            var avail=Math.min(vw-32, 370);
            var ts=Math.max(30,Math.min(62,Math.floor((avail - 6*(len-1)) / len)));
            var bw=ts*len + 6*(len-1);
            var tfs=Math.max(1.0,Math.min(1.7, ts/36));
            var kba=Math.min(vw-20, 500);
            var kw=Math.max(22,Math.min(42,Math.floor((kba - 9*5) / 10)));
            var kh=Math.max(38,Math.min(54,Math.round(kw*1.35)));
            var kf=Math.max(0.62,Math.min(0.85, kw/44));
            var lkw=Math.round(kw*1.5);
            style.textContent=[
                '.tile{width:'+ts+'px;height:'+ts+'px;font-size:'+tfs+'rem;min-width:0;}',
                '.tile::before{display:none;}',
                '.row{display:grid;grid-template-columns:repeat('+len+','+ts+'px);gap:6px;justify-content:center;}',
                '.key{height:'+kh+'px;min-width:'+kw+'px;max-width:'+(kw+10)+'px;font-size:'+kf+'rem;}',
                '.key.large{min-width:'+lkw+'px;max-width:'+(lkw+10)+'px;font-size:'+(kf*0.9)+'rem;}',
                '#keyboard-container{width:100%;max-width:'+kba+'px;margin:1.25rem auto 0;}',
                '.keyboard-row{gap:4px;}',
                '#game-board{max-width:'+bw+'px;margin:0 auto;}',
            ].join('\n');
        }
    }

    function showActiveModes(){
        if(!showModesFlag)return;
        var modes=[];
        if(noColorFeedback)modes.push('🔇 No feedback');if(noBackspace)modes.push('🚫 No backspace');
        if(oneStrike)modes.push('💀 One strike');if(revealFirst)modes.push('🔤 First letter');
        if(shareDist)modes.push('📊 Share result');if(multiWord)modes.push('🧩 Multi-word');
        if(timedMode)modes.push('⏱ '+timerSeconds+'s');
        if(fibbleMode)modes.push('🤥 Fibble');
        if(absurdleMode)modes.push('👾 Absurdle');
        if(mirrorMode)modes.push('🪞 Mirror');
        if(fakeNewsMode)modes.push('📰 Fake News');
        if(gaslightMode)modes.push('😵 Gaslighting');
        if(schrodingerMode)modes.push('🐱 Schrödinger');
        if(falseHopeMode)modes.push('🌝 False Hope');
        if(mimicMode)modes.push('🎭 Mimic');
        if(dictRestrictMode)modes.push('📖 Dict Restrict');
        if(glitchMode)modes.push('👾 Glitch');
        if(hintUnlockAfter>0)modes.push('🔒 Hint after '+hintUnlockAfter);
        if(!modes.length)return;
        var bar=document.createElement('div');bar.className='mode-bar';
        bar.innerHTML=modes.map(function(m){return'<span class="mode-pill">'+m+'</span>';}).join('');
        gameContainer.insertBefore(bar,gameContainer.firstChild);
    }

    function startTimer(){
        var rem=timerSeconds;
        var wrap=document.createElement('div');wrap.id='timer-bar-wrap';
        wrap.innerHTML='<div id="timer-bar-inner"></div><span id="timer-label">'+rem+'s</span>';
        var mb=gameContainer.querySelector('.mode-bar');
        gameContainer.insertBefore(wrap,mb?mb.nextSibling:gameBoard);
        var inner=document.getElementById('timer-bar-inner'),label=document.getElementById('timer-label');
        requestAnimationFrame(function(){requestAnimationFrame(function(){inner.style.transition='width '+timerSeconds+'s linear';inner.style.width='0%';});});
        timerInterval=setInterval(function(){
            rem--;label.textContent=rem+'s';
            if(rem<=5)wrap.classList.add('timer-danger');
            if(rem<=0){clearInterval(timerInterval);timerInterval=null;if(!isGameOver){isGameOver=true;if(maxPlays>0)showGameOverScreen(false);else showTimeUpOverlay();}}
        },1000);
    }

    function stopTimer(){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}var inner=document.getElementById('timer-bar-inner');if(inner)inner.style.transition='none';}

    function startGlitch(){
        if(!glitchMode)return;
        var alpha='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        glitchInterval=setInterval(function(){
            if(isGameOver){stopGlitch();return;}
            /* Pick 1-2 random tiles from the CURRENT unfilled row */
            var picks=Math.random()<0.5?1:2;
            for(var p=0;p<picks;p++){
                var col=Math.floor(Math.random()*wordLength);
                var tile=document.getElementById('tile-'+currentRow+'-'+col);
                if(!tile||!tile.textContent)continue;
                var real=tile.textContent;
                var fake=alpha[Math.floor(Math.random()*26)];
                tile.textContent=fake;
                tile.classList.add('glitch-flash');
                /* Restore after 80-150ms */
                var delay=80+Math.floor(Math.random()*70);
                (function(t,r){setTimeout(function(){t.textContent=r;t.classList.remove('glitch-flash');},delay);})(tile,real);
            }
        },600+Math.floor(Math.random()*800));
    }

    function stopGlitch(){if(glitchInterval){clearInterval(glitchInterval);glitchInterval=null;}}

    function showTimeUpOverlay(){
        var words=multiWord?targetWord+' & '+targetWord2:targetWord;
        var o=buildOverlay({icon:'⏱',title:"Time's up!",body:hideWordOnLoss?'You ran out of time.':'The word'+(multiWord?'s were':'was')+' <strong>'+words+'</strong>.',sub:''});
        document.body.appendChild(o);requestAnimationFrame(function(){o.classList.add('visible');});
    }

    /* ═══════════════════════════════════════════════════════
       BOARD & KEYBOARD
    ════════════════════════════════════════════════════════ */

    function createBoard(){
        if(multiWord)createDualBoards();
        else{gameBoard.innerHTML='';gameBoard.className='';gameBoard.style.cssText='display:grid;grid-template-rows:repeat('+maxGuesses+',1fr);gap:6px;';createSingleBoard(gameBoard,'tile');}
    }
    function createSingleBoard(container,prefix){
        for(var i=0;i<maxGuesses;i++){
            var row=document.createElement('div');row.className='row';row.id=prefix+'-row-'+i;
            for(var j=0;j<wordLength;j++){var tile=document.createElement('div');tile.className='tile';tile.id=prefix+'-'+i+'-'+j;row.appendChild(tile);}
            container.appendChild(row);
        }
    }
    function createDualBoards(){
        gameBoard.innerHTML='';gameBoard.className='dual-board-wrap';
        function makeHalf(lbl,pfx){
            var half=document.createElement('div');half.className='board-half';
            var l=document.createElement('div');l.className='board-label';l.textContent=lbl;
            var grid=document.createElement('div');grid.className='board-grid';grid.style.cssText='display:grid;grid-template-rows:repeat('+maxGuesses+',1fr);gap:6px;';
            half.appendChild(l);half.appendChild(grid);createSingleBoard(grid,pfx);return half;
        }
        gameBoard.appendChild(makeHalf('Word 1','tile'));gameBoard.appendChild(makeHalf('Word 2','tile2'));
    }

    function createKeyboard(){
        keyboardContainer.innerHTML='';
        ['QWERTYUIOP','ASDFGHJKL','ENTER ZXCVBNM \u232b'].forEach(function(rowStr){
            var rowEl=document.createElement('div');rowEl.className='keyboard-row';
            var keys=rowStr==='ENTER ZXCVBNM \u232b'?['ENTER','Z','X','C','V','B','N','M','\u232b']:rowStr.split('');
            keys.forEach(function(key){
                var k=document.createElement('button');k.className='key';k.textContent=key;k.id='key-'+key;
                if(key==='ENTER'||key==='\u232b')k.classList.add('large');
                k.addEventListener('click',function(){handleKeyPress({key:key});});
                rowEl.appendChild(k);
            });
            keyboardContainer.appendChild(rowEl);
        });
    }

    function updatePlaysCounter(){
        if(maxPlays<=0)return;
        var badge=document.getElementById('plays-counter');
        if(!badge){badge=document.createElement('div');badge.id='plays-counter';document.querySelector('.header-content').appendChild(badge);}
        /* playsUsed includes the current open, so remaining = maxPlays - playsUsed + 1
           e.g. max=3, first open: playsUsed=1, shows "3 attempts left"
                second open: playsUsed=2, shows "2 attempts left"
                third open:  playsUsed=3, shows "1 attempt left"  ← last one
                fourth open: server blocks before we get here      */
        var left=maxPlays-playsUsed+1;
        badge.className='plays-counter'+(left<=1?' plays-danger':'');
        badge.innerHTML='<span class="plays-icon">\uD83C\uDFAF</span><span class="plays-text">'+left+' attempt'+(left!==1?'s':'')+' left</span>';
    }

    function updateHintButton(){
        var btn=document.getElementById('hint-button');
        var cnt=document.getElementById('hint-count');
        cnt.textContent=hintsRemaining;
        if(hintUnlockAfter>0&&currentRow<hintUnlockAfter){
            btn.disabled=true;
            var remaining=hintUnlockAfter-currentRow;
            btn.title='Unlocks after '+hintUnlockAfter+' guesses';
            cnt.textContent='🔒';
        } else {
            btn.disabled=hintsRemaining<=0;
            btn.title='';
        }
    }

    /* ═══════════════════════════════════════════════════════
       INPUT
    ════════════════════════════════════════════════════════ */

    function useHint(){
        if(hintsRemaining<=0||isGameOver)return;

        /* Build candidate list: letters in the target word(s) the player has
           NO knowledge of yet — key must have no status, or status 'absent'
           (absent can appear if a duplicate letter was scored absent elsewhere).
           Exclude anything already 'correct' or 'present' on the keyboard. */
        var candidates=[];
        function addCandidates(word){
            for(var i=0;i<word.length;i++){
                var l=word[i];
                if(candidates.indexOf(l)!==-1)continue;
                var k=document.getElementById('key-'+l);
                var status=k?k.dataset.status||'':'';
                if(status!=='correct'&&status!=='present')candidates.push(l);
            }
        }
        addCandidates(targetWord);
        if(multiWord&&targetWord2)addCandidates(targetWord2);

        if(!candidates.length){showToast('No new letters to reveal!');return;}

        var pick=candidates[Math.floor(Math.random()*candidates.length)];
        var hk=document.getElementById('key-'+pick);
        if(hk){
            hk.classList.remove('present','absent','correct');
            /* Mark yellow (present) — letter is in the word but position not given */
            hk.classList.add('present','hint-flash');
            hk.dataset.status='present';
            hk.addEventListener('animationend',function(){hk.classList.remove('hint-flash');},{once:true});
        }
        showToast('\u2728 "'+pick+'" is in the word!',2200);
        hintsRemaining--;updateHintButton();
    }

    function handleKeyPress(e){
        if(isGameOver)return;
        var key=e.key.toUpperCase();
        if(key==='ENTER')submitGuess();
        else if((key==='BACKSPACE'||key==='\u232b')&&!noBackspace)deleteLetter();
        else if(key.length===1&&key>='A'&&key<='Z')addLetter(key);
    }

    function addLetter(letter){
        if(multiWord){
            var minC=(revealFirst&&currentRow===0)?1:0,b1Done=isWord1Solved();
            if(!b1Done&&currentCol<wordLength){if(currentCol<minC)currentCol=minC;var t1=document.getElementById('tile-'+currentRow+'-'+currentCol);if(t1){t1.textContent=letter;t1.classList.add('filled');currentCol++;}}
            if(!word2Solved&&currentCol2<wordLength){if(currentCol2<minC)currentCol2=minC;var t2=document.getElementById('tile2-'+currentRow+'-'+currentCol2);if(t2){t2.textContent=letter;t2.classList.add('filled');currentCol2++;}}
            scheduleSaveProgress();return;
        }
        if(revealFirst&&currentRow===0&&currentCol<1)currentCol=1;
        if(currentCol<wordLength){var t=document.getElementById('tile-'+currentRow+'-'+currentCol);t.textContent=letter;t.classList.add('filled');currentCol++;scheduleSaveProgress();}
    }

    function deleteLetter(){
        if(multiWord){
            var minC=(revealFirst&&currentRow===0)?1:0;
            if(!isWord1Solved()&&currentCol>minC){currentCol--;var t1=document.getElementById('tile-'+currentRow+'-'+currentCol);if(t1){t1.textContent='';t1.classList.remove('filled');}}
            if(!word2Solved&&currentCol2>minC){currentCol2--;var t2=document.getElementById('tile2-'+currentRow+'-'+currentCol2);if(t2){t2.textContent='';t2.classList.remove('filled');}}
            scheduleSaveProgress();return;
        }
        var minC=(revealFirst&&currentRow===0)?1:0;
        if(currentCol>minC){currentCol--;var t=document.getElementById('tile-'+currentRow+'-'+currentCol);t.textContent='';t.classList.remove('filled');scheduleSaveProgress();}
    }

    function isWord1Solved(){
        for(var r=0;r<currentRow;r++){var ok=true;for(var c=0;c<wordLength;c++){var t=document.getElementById('tile-'+r+'-'+c);if(!t||!t.classList.contains('correct')){ok=false;break;}}if(ok)return true;}
        return false;
    }

    /* ═══════════════════════════════════════════════════════
       GUESS LOGIC
    ════════════════════════════════════════════════════════ */

    function submitGuess(){
        if(isGameOver)return;
        if(multiWord){submitMultiGuess();return;}
        if(currentCol!==wordLength){shakeRow('Not enough letters');return;}
        var guess='';for(var i=0;i<wordLength;i++)guess+=document.getElementById('tile-'+currentRow+'-'+i).textContent;

        /* ── Dict Restrict: guess must start with same letter as previous guess ── */
        if(dictRestrictMode&&currentRow>0){
            var prevFirstTile=document.getElementById('tile-'+(currentRow-1)+'-0');
            var prevFirst=prevFirstTile?prevFirstTile.textContent.toUpperCase():'';
            if(prevFirst&&guess[0]!==prevFirst){
                shakeRow('Must start with "'+prevFirst+'"!');return;
            }
        }

        var result=scoreGuess(guess,targetWord);result=applyModeScore(result,guess,currentRow);guessGrid.push(result.slice());
        saveProgress();
        revealTiles('tile',guess.split(''),result,function(w){checkSingleState(w);});
    }

    function submitMultiGuess(){
        var b1Done=isWord1Solved();
        if(!b1Done&&currentCol<wordLength){shakeRow('Not enough letters');return;}
        if(!word2Solved&&currentCol2<wordLength){shakeRow('Not enough letters');return;}
        var win1=b1Done,win2=word2Solved,pending=0;
        if(!b1Done){
            var g1='';for(var i=0;i<wordLength;i++)g1+=document.getElementById('tile-'+currentRow+'-'+i).textContent;
            var r1=scoreGuess(g1,targetWord);r1=applyModeScore(r1,g1,currentRow);guessGrid.push(r1.slice());pending++;
            revealTiles('tile',g1.split(''),r1,function(w){if(w)win1=true;pending--;if(!pending){saveProgress();afterMultiReveal(win1,win2,b1Done);}});
        }
        if(!word2Solved){
            var g2='';for(var i=0;i<wordLength;i++)g2+=document.getElementById('tile2-'+currentRow+'-'+i).textContent;
            var r2=scoreGuess(g2,targetWord2);r2=applyModeScore(r2,g2,currentRow);guessGrid2.push(r2.slice());pending++;
            revealTiles('tile2',g2.split(''),r2,function(w){if(w){win2=true;word2Solved=true;showBoardBadge(2);}pending--;if(!pending){saveProgress();afterMultiReveal(win1,win2,b1Done);}});
        }
        if(pending===0){saveProgress();afterMultiReveal(win1,win2,b1Done);}
    }

    function showBoardBadge(num){var halves=document.querySelectorAll('.board-half');if(halves[num-1]){var b=document.createElement('div');b.className='board-solved-badge';b.textContent='✓ Solved!';halves[num-1].appendChild(b);}}

    function afterMultiReveal(win1,win2,b1Done){
        setTimeout(function(){
            if(win1&&win2){
                for(var i=0;i<wordLength;i++)(function(idx){setTimeout(function(){var t1=document.getElementById('tile-'+currentRow+'-'+idx),t2=document.getElementById('tile2-'+currentRow+'-'+idx);if(t1)t1.classList.add('jump');if(t2)t2.classList.add('jump');},idx*100);})(i);
                isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(true);else showWinOverlay();
            }else if(oneStrike&&(!win1||!win2)){isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(false);else showLossOverlay();}
            else if(currentRow===maxGuesses-1){isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(false);else showLossOverlay();}
            else{isGameOver=false;currentRow++;currentCol=(win1||isWord1Solved())?wordLength:0;currentCol2=word2Solved?wordLength:0;}
        },wordLength*300+200);
    }

    function scoreGuess(guess,target){
        var ta=target.split(''),ga=guess.split(''),result=new Array(wordLength);
        for(var i=0;i<wordLength;i++)if(ga[i]===ta[i]){result[i]={l:ga[i],s:'correct'};ta[i]=null;}
        for(var i=0;i<wordLength;i++){
            if(result[i])continue;
            var idx=ta.indexOf(ga[i]);
            if(idx>-1){result[i]={l:ga[i],s:'present'};ta[idx]=null;}
            else result[i]={l:ga[i],s:'absent'};
        }
        return result;
    }

    /* Apply all mode transformations to a scored result before revealing */
    function applyModeScore(result,guess,rowIdx){
        /* ── Absurdle: adversarially pick new target each guess ── */
        if(absurdleMode&&absurdleCandidates.length>1){
            var history=[];
            for(var r=0;r<guessGrid.length;r++){
                var row=guessGrid[r];
                var g='';for(var c=0;c<row.length;c++)g+=row[c].l;
                var key=row.map(function(e){return e.s==='correct'?'C':e.s==='present'?'P':'A';}).join('');
                history.push({guess:g,key:key});
            }
            var newCandidates=absurdleCandidates.filter(function(w){return isConsistent(w.toUpperCase(),history);});
            if(newCandidates.length===0)newCandidates=absurdleCandidates;
            var bestGroup=absurdlePickTarget(guess,newCandidates.map(function(w){return w.toUpperCase();}));
            if(bestGroup&&bestGroup.length>0){
                var newTarget=bestGroup[Math.floor(Math.random()*bestGroup.length)];
                targetWord=newTarget.toUpperCase();
                absurdleCandidates=newCandidates;
                result=scoreGuess(guess,targetWord);
            }
        }

        /* ── Mimic: first guess becomes the secret word ── */
        if(mimicMode&&!mimicReady&&rowIdx===0){
            targetWord=guess.toUpperCase();
            mimicReady=true;
            result=result.map(function(e){return{l:e.l,s:'absent'};});
            showToast('🎭 Your word is now the target! Guess it again.',3000);
        }

        /* ── Schrödinger: unstable slot counts green for alt letter until attempt 5 ── */
        if(schrodingerMode&&schrodingerPos>=0&&rowIdx<4){
            if(guess[schrodingerPos]===schrodingerAlt||guess[schrodingerPos]===targetWord[schrodingerPos]){
                result[schrodingerPos]={l:guess[schrodingerPos],s:'correct'};
            }
        }

        /* ── Gaslight: every 3rd row (rows 2,5,…), secretly swap two positions in targetWord ── */
        if(gaslightMode&&rowIdx>0&&(rowIdx+1)%3===0){
            var p1=Math.floor(Math.random()*wordLength);
            var p2;do{p2=Math.floor(Math.random()*wordLength);}while(p2===p1);
            var arr=targetWord.split('');
            var tmp=arr[p1];arr[p1]=arr[p2];arr[p2]=tmp;
            targetWord=arr.join('');
            showToast('😵 Something shifted…',1800);
        }

        /* ── False Hope: first row forces ≥2 yellows ── */
        if(falseHopeMode&&rowIdx===0&&!falseHopeFired){
            falseHopeFired=true;
            var absentIdxs=[];
            for(var i=0;i<result.length;i++)if(result[i].s==='absent')absentIdxs.push(i);
            for(var i=absentIdxs.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var tmp2=absentIdxs[i];absentIdxs[i]=absentIdxs[j];absentIdxs[j]=tmp2;}
            var realYellows=result.filter(function(e){return e.s==='present';}).length;
            var toFake=Math.max(0,2-realYellows);
            falseHopeFakes=[];
            for(var i=0;i<Math.min(toFake,absentIdxs.length);i++){
                result[absentIdxs[i]]={l:result[absentIdxs[i]].l,s:'present'};
                falseHopeFakes.push(absentIdxs[i]);
            }
        }

        /* ── Fibble: one non-absent tile per row is a lie ── */
        if(fibbleMode){
            var nonAbsent=[];
            for(var i=0;i<result.length;i++)if(result[i].s!=='absent')nonAbsent.push(i);
            if(nonAbsent.length>0){
                var liePick=nonAbsent[Math.floor(Math.random()*nonAbsent.length)];
                var oldS=result[liePick].s;
                var others=(oldS==='correct')?['present','absent']:['correct','absent'];
                result[liePick]={l:result[liePick].l,s:others[Math.floor(Math.random()*others.length)]};
            }
        }

        /* ── Fake News: one completely random tile gets a wrong color ── */
        if(fakeNewsMode){
            var liePick2=Math.floor(Math.random()*result.length);
            var oldS2=result[liePick2].s;
            var all2=['correct','present','absent'].filter(function(s){return s!==oldS2;});
            result[liePick2]={l:result[liePick2].l,s:all2[Math.floor(Math.random()*all2.length)]};
        }

        /* ── Mirror: swap correct↔present ── */
        if(mirrorMode){
            result=result.map(function(e){
                var s=e.s==='correct'?'present':e.s==='present'?'correct':e.s;
                return{l:e.l,s:s};
            });
        }

        return result;
    }

    function revealTiles(prefix,guessLetters,result,callback){
        var isWin=result.every(function(e){return e.s==='correct';});
        result.forEach(function(entry,i){
            var status=entry.s, letter=entry.l;
            setTimeout(function(){
                var tile=document.getElementById(prefix+'-'+currentRow+'-'+i);
                if(tile){tile.classList.add('flip');setTimeout(function(){tile.classList.add(noColorFeedback?(status==='correct'?'correct':'absent-silent'):status);},250);}
                var kEl=document.getElementById('key-'+letter);
                if(kEl){var rank=function(s){return s==='correct'?2:s==='present'?1:0;};if(!noColorFeedback){if(rank(status)>rank(kEl.dataset.status||'')){kEl.classList.remove('present','absent','correct');kEl.classList.add(status);kEl.dataset.status=status;}}else if(status==='correct'){kEl.classList.remove('present','absent','correct');kEl.classList.add('correct');kEl.dataset.status='correct';}}
                if(i===wordLength-1)setTimeout(function(){if(callback)callback(isWin);},50);
            },i*300);
        });
    }

    function checkSingleState(isWin){
        setTimeout(function(){
            if(isWin){var tiles=document.querySelectorAll('[id^="tile-'+currentRow+'-"]');tiles.forEach(function(t,i){setTimeout(function(){t.classList.add('jump');},i*100);});isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(true);else showWinOverlay();}
            else if(oneStrike){isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(false);else showLossOverlay();}
            else if(currentRow===maxGuesses-1){isGameOver=true;stopTimer();if(maxPlays>0)showGameOverScreen(false);else showLossOverlay();}
            else{isGameOver=false;currentRow++;currentCol=0;updateHintButton();}
        },wordLength*300);
    }

    function showWinOverlay(){clearProgress();
        reportResult(true,currentRow+1);stopGlitch();
        var n=currentRow+1,dist=shareDist?buildEmojiGrid(true):null;
        var msgs=['Genius! 🧠','Magnificent! ✨','Splendid! 🎉','Great! 👏','Good job! 😊','Phew! 😅'];
        var praise=n<=msgs.length?msgs[n-1]:'Got it! 🎊';
        setTimeout(function(){var o=buildOverlay({icon:'🎉',title:'You got it!',body:praise+' Found in <strong>'+n+'</strong> guess'+(n!==1?'es':'')+'.',sub:'',dist:dist,winCard:true,btnText:null});document.body.appendChild(o);requestAnimationFrame(function(){o.classList.add('visible');});},900);
    }

    function showLossOverlay(){clearProgress();
        reportResult(false,maxGuesses);stopGlitch();
        var dist=shareDist?buildEmojiGrid(false):null;
        var body=hideWordOnLoss?'':(multiWord?'The words were <strong>'+targetWord+'</strong> &amp; <strong>'+targetWord2+'</strong>.':'The word was <strong>'+targetWord+'</strong>.');
        setTimeout(function(){var o=buildOverlay({icon:'😔',title:'Better luck next time',body:body||"You didn\u2019t find the word.",sub:'',dist:dist,btnText:null});document.body.appendChild(o);requestAnimationFrame(function(){o.classList.add('visible');});},600);
    }

    function shakeRow(message){
        if(message)showToast(message);
        function shake(prefix){var t0=document.getElementById(prefix+'-'+currentRow+'-0');if(t0&&t0.parentNode){var r=t0.parentNode;r.classList.add('invalid');r.addEventListener('animationend',function(){r.classList.remove('invalid');},{once:true});}}
        shake('tile');if(multiWord)shake('tile2');
    }

    /* ═══════════════════════════════════════════════════════
       CREATOR
    ════════════════════════════════════════════════════════ */

    function setupCreator(){
        if(!document.getElementById('generate-link-button'))return;
        var allCards=[
            {check:'hide-word-toggle',label:'hide-toggle-label'},{check:'nofeedback-toggle',label:'nofeedback-toggle-label'},
            {check:'nobackspace-toggle',label:'nobackspace-toggle-label'},{check:'onestrike-toggle',label:'onestrike-toggle-label'},
            {check:'revealfirst-toggle',label:'revealfirst-toggle-label'},{check:'sharedist-toggle',label:'sharedist-toggle-label'},
            {check:'multiword-toggle',label:'multiword-toggle-label'},{check:'timed-toggle',label:'timed-toggle-label'},
            {check:'fibble-toggle',label:'fibble-toggle-label'},{check:'absurdle-toggle',label:'absurdle-toggle-label'},
            {check:'mirror-toggle',label:'mirror-toggle-label'},{check:'fakenews-toggle',label:'fakenews-toggle-label'},
            {check:'gaslight-toggle',label:'gaslight-toggle-label'},{check:'schrodinger-toggle',label:'schrodinger-toggle-label'},
            {check:'falsehope-toggle',label:'falsehope-toggle-label'},{check:'mimic-toggle',label:'mimic-toggle-label'},
            {check:'dictrestrict-toggle',label:'dictrestrict-toggle-label'},{check:'glitch-toggle',label:'glitch-toggle-label'},
            {check:'showmodes-toggle',label:'showmodes-toggle-label'},
            {check:'hiddenhint-toggle',label:'hiddenhint-toggle-label'}
        ];
        allCards.forEach(function(c){
            var label=document.getElementById(c.label),check=document.getElementById(c.check);
            if(!label||!check)return;
            check.addEventListener('change',function(){label.classList.toggle('checked',check.checked);});
        });
        var mwC=document.getElementById('multiword-toggle'),tmC=document.getElementById('timed-toggle');
        var mwE=document.getElementById('multiword-extra'),tmE=document.getElementById('timed-extra');
        var hhC=document.getElementById('hiddenhint-toggle'),hhE=document.getElementById('hiddenhint-extra');
        if(mwC&&mwE)mwC.addEventListener('change',function(){mwE.classList.toggle('hidden',!mwC.checked);});
        if(tmC&&tmE)tmC.addEventListener('change',function(){tmE.classList.toggle('hidden',!tmC.checked);});
        if(hhC&&hhE)hhC.addEventListener('change',function(){hhE.classList.toggle('hidden',!hhC.checked);});

        /* Show hint-unlock sub-input whenever hints > 0 */
        var hintsInput=document.getElementById('custom-hints-input');
        var hintUnlockWrap=document.getElementById('hint-unlock-wrap');
        if(hintsInput&&hintUnlockWrap){
            hintsInput.addEventListener('input',function(){
                var v=parseInt(hintsInput.value,10);
                hintUnlockWrap.classList.toggle('hidden',!(v>0));
            });
        }

        document.getElementById('generate-link-button').addEventListener('click',async function(){
            var word=document.getElementById('custom-word-input').value.toUpperCase().trim();
            var label=(document.getElementById('puzzle-label-input')||{}).value||'Untitled';
            label=label.trim().slice(0,80)||'Untitled';
            var hints=parseInt(document.getElementById('custom-hints-input').value)||0;
            var guesses=parseInt(document.getElementById('custom-guesses-input').value)||6;
            var plays=parseInt(document.getElementById('custom-plays-input').value)||0;
            var hideW=document.getElementById('hide-word-toggle').checked;
            var noCol=document.getElementById('nofeedback-toggle').checked;
            var noBk=document.getElementById('nobackspace-toggle').checked;
            var oneStr=document.getElementById('onestrike-toggle').checked;
            var rfirst=document.getElementById('revealfirst-toggle').checked;
            var shareDst=document.getElementById('sharedist-toggle').checked;
            var mw=document.getElementById('multiword-toggle').checked;
            var timed=document.getElementById('timed-toggle').checked;
            var timerV=parseInt(document.getElementById('custom-timer-input').value)||60;
            var word2=mw?document.getElementById('custom-word2-input').value.toUpperCase().trim():'';
            if(!word||!/^[A-Z]+$/.test(word)){showToast('Word must only contain letters A-Z.');return;}
            if(mw&&(!word2||!/^[A-Z]+$/.test(word2))){showToast('Second word must only contain letters A-Z.');return;}
            if(mw&&word2.length!==word.length){showToast('Both words must be the same length.');return;}
            if(timed&&timerV<10){showToast('Timer must be at least 10 seconds.');return;}
            var btn=document.getElementById('generate-link-button');
            btn.textContent='Encrypting…';btn.disabled=true;
            try{
                var secret=genSecret();
                var tokenBuf=new Uint8Array(B64.dec(secret));
                var keyBuf=await deriveKey(tokenBuf);
                var cfg={word:word,word2:word2,hints:hints,guesses:guesses,plays:plays,used:0,
                         hide:hideW,nocol:noCol,nobk:noBk,one:oneStr,rf:rfirst,sd:shareDst,timed:timed,timer:timed?timerV:0,
                          maxPlayers:parseInt((document.getElementById('custom-maxplayers-input')||{}).value,10)||0,
                         fibble:document.getElementById('fibble-toggle')&&document.getElementById('fibble-toggle').checked,
                         absurdle:document.getElementById('absurdle-toggle')&&document.getElementById('absurdle-toggle').checked,
                         mirror:document.getElementById('mirror-toggle')&&document.getElementById('mirror-toggle').checked,
                         fakenews:document.getElementById('fakenews-toggle')&&document.getElementById('fakenews-toggle').checked,
                         gaslight:document.getElementById('gaslight-toggle')&&document.getElementById('gaslight-toggle').checked,
                         schrodinger:document.getElementById('schrodinger-toggle')&&document.getElementById('schrodinger-toggle').checked,
                         falsehope:document.getElementById('falsehope-toggle')&&document.getElementById('falsehope-toggle').checked,
                         mimic:document.getElementById('mimic-toggle')&&document.getElementById('mimic-toggle').checked,
                         dictRestrict:document.getElementById('dictrestrict-toggle')&&document.getElementById('dictrestrict-toggle').checked,
                         glitch:document.getElementById('glitch-toggle')&&document.getElementById('glitch-toggle').checked,
                         showModes:document.getElementById('showmodes-toggle')&&document.getElementById('showmodes-toggle').checked,
                         hintUnlock:(function(){var v=parseInt((document.getElementById('hiddenhint-after-input')||{}).value,10);return(v>0&&parseInt(document.getElementById('custom-hints-input').value,10)>0)?v:0;})()};
                var d=await seal(pack(cfg),keyBuf);
                /* Always link back to the root (index.html), never to creator.html */
                var link=window.location.origin+'/?d='+d+'#'+secret;
                /* Register the puzzle server-side for dashboard tracking */
                if(!LOCAL_DEV){
                    /* PRODUCTION: register puzzle with server dashboard */
                    try{
                        var regId=await hashId(secret);
                        var regPw=sessionStorage.getItem('creator_pw')||'';
                        fetch('/.netlify/functions/register',{method:'POST',
                            headers:{'Content-Type':'application/json','x-dashboard-password':regPw},
                            body:JSON.stringify({id:regId,max:plays,label:label})});
                    }catch(re){}
                }
                var sc=document.getElementById('share-link-container'),si=document.getElementById('share-link-input');
                si.value=link;sc.classList.remove('hidden');
                var cb=document.getElementById('copy-link-button'),nb=cb.cloneNode(true);
                cb.parentNode.replaceChild(nb,cb);
                nb.addEventListener('click',function(){navigator.clipboard.writeText(link).catch(function(){si.select();document.execCommand('copy');});showToast('Link copied!');});
            }catch(e){showToast('Encryption failed. Try again.');}
            btn.textContent='Generate Link';btn.disabled=false;
        });
    }

    function showToast(message,duration){
        duration=duration||1500;
        var c=document.getElementById('toast-container'),t=document.createElement('div');
        t.innerHTML=message;t.className='toast';c.appendChild(t);
        setTimeout(function(){t.classList.add('show');},10);
        setTimeout(function(){t.classList.remove('show');t.addEventListener('transitionend',function(){t.remove();});},duration);
    }

    init();
});