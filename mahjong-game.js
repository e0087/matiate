// 麻雀待ち当て練習アプリ - メインロジック

// 牌の定義
const TILE_TYPES = {
    'm': 'マンズ',
    'p': 'ピンズ',  
    's': 'ソーズ',
    'z': '字牌'
};

// 字牌の名前
const JIHAI_NAMES = ['', '東', '南', '西', '北', '白', '發', '中'];
const WIND_NAMES = ['東', '南', '西', '北'];

// majiang-coreが読み込まれるのを待つ
function waitForMajiang() {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // 10秒間待つ（延長）
        
        const checkInterval = setInterval(() => {
            attempts++;
            
            // 詳細ログ（最初と最後のみ、途中は5回ごと）
            if (attempts === 1 || attempts % 5 === 0 || attempts >= maxAttempts) {
                console.log(`Checking Majiang... attempt ${attempts}/${maxAttempts}`);
            }
            
            if (typeof Majiang !== 'undefined') {
                console.log('✅ Majiang library found!');
                console.log('Majiang.Shoupai:', typeof Majiang.Shoupai);
                console.log('Majiang.Util:', typeof Majiang.Util);
                clearInterval(checkInterval);
                resolve();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.error('❌ Majiang library failed to load after 10 seconds');
                console.error('Please check:');
                console.error('1. Internet connection');
                console.error('2. Browser console for errors');
                console.error('3. Try a different browser');
                reject(new Error('Majiang library not loaded'));
            }
        }, 100);
    });
}

// ゲーム状態
class MahjongGame {
    constructor() {
        this.initialized = false;
    }

    async init() {
        console.log('Initializing game...');
        await waitForMajiang();
        console.log('Majiang library loaded');
        this.initialized = true;
        this.reset();
        console.log('Game initialized successfully');
    }

    reset() {
        if (!this.initialized) return;

        // 問題データ
        this.zhuangfeng = Math.floor(Math.random() * 4); // 場風 0-3
        this.menfeng = Math.floor(Math.random() * 4); // 自風 0-3
        this.honba = Math.floor(Math.random() * 3); // 本場 0-2
        this.kyotaku = Math.floor(Math.random() * 3); // 供託 0-2
        this.isRiichi = Math.random() < 0.5; // リーチかダマか
        
        // カン回数を決定(0-4)
        this.kanCount = Math.random() < 0.2 ? Math.floor(Math.random() * 4) + 1 : 0;
        
        // ドラ
        this.baopai = this.generateDoraIndicators(1 + this.kanCount); // 通常ドラ + カンドラ
        this.fubaopai = []; // 裏ドラ(リーチ時のみ)
        
        // テンパイ手牌生成
        this.generateCompleteHand();
        
        // 捨て牌
        this.discards = {
            shimocha: [],
            toimen: [],
            kamicha: [],
            jibun: []
        };
        
        // 自分の過去の捨て牌(フリテン判定用)
        this.myDiscardHistory = [];
        
        // ゲーム進行
        this.currentPlayer = 'shimocha'; // 下家から開始
        this.turnCount = 0;
        this.yamaCount = 24; // 残り山を24枚固定
        this.maxDiscards = 6; // 各プレイヤーの捨て牌最大数(1段目のみ)
        this.totalTurns = 24; // 合計24ターン
        this.furiten = false; // フリテン状態
        this.douzyunFuriten = false; // 同順フリテン
        this.missedTiles = []; // 見逃した牌
        this.currentAgariTile = null; // 現在のアガリ牌
        this.currentAgariPlayer = null; // アガリ牌を出したプレイヤー
        this.agariTileScheduled = false; // アガリ牌を出す予定があるか
        this.waitingForAction = false; // アガリアクション待ち
        this.lastWaitingCheck = null; // 前回のアガリ判定時の牌
        
        // アガリ牌を捨て牌に必ず含めるスケジュール
        this.scheduleAgariTile();
        
        this.updateDisplay();
    }


    // 完全な手牌(アガリ形)を生成してからランダムに1枚抜いてテンパイにする
    generateCompleteHand() {
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            try {
                // ランダムなアガリ形を生成
                const handStr = this.generateRandomAgariHand();
                const shoupai = Majiang.Shoupai.from_string(handStr);
                
                // 手牌から1枚抜いてテンパイにする
                const tiles = shoupai.get_dapai();
                if (tiles.length === 0) {
                    attempts++;
                    continue;
                }
                
                // ランダムに1枚選んで抜く
                const removeIndex = Math.floor(Math.random() * tiles.length);
                const removeTile = tiles[removeIndex];
                
                // 新しい手牌文字列を作成
                let newHandStr = this.removeTileFromString(handStr, removeTile);
                
                // テンパイであることを確認
                const tenpaiShoupai = Majiang.Shoupai.from_string(newHandStr);
                const tingpai = tenpaiShoupai.tingpai();
                
                if (tingpai && tingpai.length > 0) {
                    this.shoupai = tenpaiShoupai;
                    this.waitingTiles = tingpai.map(t => this.convertToTileCode(t));
                    
                    console.log('Generated tenpai hand:', {
                        handStr: newHandStr,
                        waiting: this.waitingTiles
                    });
                    
                    // 裏ドラを生成(リーチの場合)
                    if (this.isRiichi) {
                        this.fubaopai = this.generateDoraIndicators(this.baopai.length);
                    }
                    
                    return;
                }
                
                attempts++;
            } catch (e) {
                attempts++;
                console.error('Hand generation error:', e);
            }
        }
        
        // 失敗した場合はシンプルな手牌を使用
        console.log('Using fallback simple hand');
        this.createSimpleTenpaiHand();
    }

    // シンプルなテンパイ手牌を作成(フォールバック)
    createSimpleTenpaiHand() {
        try {
            // 123m 456p 789s 1122z (両面待ち 2-3z)
            const handStr = 'm123p456s789z112';
            this.shoupai = Majiang.Shoupai.from_string(handStr);
            this.waitingTiles = ['z2', 'z3'];
            
            console.log('Created fallback hand:', {
                handStr,
                waiting: this.waitingTiles
            });
            
            // 裏ドラを生成(リーチの場合)
            if (this.isRiichi) {
                this.fubaopai = this.generateDoraIndicators(this.baopai.length);
            }
        } catch (e) {
            console.error('Fallback hand creation error:', e);
            // 最後の手段: 超シンプルな手牌
            this.shoupai = Majiang.Shoupai.from_string('m123456789p1122');
            this.waitingTiles = ['p1', 'p2'];
        }
    }

    // ランダムなアガリ形を生成
    generateRandomAgariHand() {
        const patterns = [
            // 一般形(4面子1雀頭)
            () => this.generateNormalHand(),
            // 七対子
            () => this.generateChiitoitsuHand(),
            // 国士無双
            () => this.generateKokushiHand()
        ];
        
        // 90%で一般形、8%で七対子、2%で国士
        const rand = Math.random();
        if (rand < 0.9) {
            return patterns[0]();
        } else if (rand < 0.98) {
            return patterns[1]();
        } else {
            return patterns[2]();
        }
    }

    // 一般形の手牌を生成
    generateNormalHand() {
        const suits = ['m', 'p', 's'];
        let hand = [];
        
        // 雀頭(対子)
        const headSuit = this.randomChoice(suits.concat(['z']));
        const headNum = headSuit === 'z' ? this.randomInt(1, 7) : this.randomInt(1, 9);
        hand.push(`${headSuit}${headNum}${headNum}`);
        
        // 4面子
        const meldCount = 4 - this.kanCount; // 副露がある場合は面子数を減らす
        for (let i = 0; i < meldCount; i++) {
            hand.push(this.generateMentsu());
        }
        
        return hand.join('');
    }

    // 面子を生成
    generateMentsu() {
        const suits = ['m', 'p', 's'];
        const suit = this.randomChoice(suits.concat(['z']));
        
        if (suit === 'z') {
            // 字牌は刻子のみ
            const num = this.randomInt(1, 7);
            return `${suit}${num}${num}${num}`;
        }
        
        // 数牌は順子または刻子
        if (Math.random() < 0.6) {
            // 順子
            const start = this.randomInt(1, 7);
            return `${suit}${start}${start + 1}${start + 2}`;
        } else {
            // 刻子
            const num = this.randomInt(1, 9);
            // 赤ドラを含める可能性
            if (num === 5 && Math.random() < 0.1) {
                return `${suit}055`; // 赤5を含む
            }
            return `${suit}${num}${num}${num}`;
        }
    }

    // 七対子の手牌を生成
    generateChiitoitsuHand() {
        const suits = ['m', 'p', 's', 'z'];
        let pairs = [];
        
        for (let i = 0; i < 7; i++) {
            const suit = this.randomChoice(suits);
            const num = suit === 'z' ? this.randomInt(1, 7) : this.randomInt(1, 9);
            pairs.push(`${suit}${num}${num}`);
        }
        
        return pairs.join('');
    }

    // 国士無双の手牌を生成
    generateKokushiHand() {
        return 'm19p19s19z1234567';
    }

    // 文字列から牌を1枚削除
    removeTileFromString(handStr, tile) {
        // tile形式: m1, p5など
        const suit = tile[0];
        const num = tile[1];
        
        // 手牌文字列から該当する牌を1枚削除
        const regex = new RegExp(suit + '[0-9]+');
        const match = handStr.match(regex);
        
        if (match) {
            const suitTiles = match[0];
            const nums = suitTiles.substring(1);
            const index = nums.indexOf(num);
            
            if (index !== -1) {
                const newNums = nums.slice(0, index) + nums.slice(index + 1);
                return handStr.replace(match[0], suit + newNums);
            }
        }
        
        return handStr;
    }

    // 和了計算
    calculateHule(shoupai, rongpai) {
        try {
            const param = {
                zhuangfeng: this.zhuangfeng,
                menfeng: this.menfeng,
                baopai: this.baopai.map(t => this.convertToMajiangFormat(t)),
                fubaopai: this.fubaopai.map(t => this.convertToMajiangFormat(t)),
                jicun: { changbang: this.honba, lizhibang: this.kyotaku }
            };
            
            return Majiang.Util.hule(shoupai, this.convertToMajiangFormat(rongpai), param);
        } catch (e) {
            console.error('Hule calculation error:', e);
            return null;
        }
    }

    // 牌コードをmajiang形式に変換 (m1 -> m_1)
    convertToMajiangFormat(tile) {
        if (!tile) return null;
        if (tile.length < 2) return null;
        
        const suit = tile[0];
        const num = tile[1];
        
        if (num === '0') {
            return suit + '_0'; // 赤ドラ
        }
        
        return suit + '_' + num;
    }

    // majiang形式を牌コードに変換 (m_1 -> m1)
    convertToTileCode(majiangTile) {
        if (!majiangTile) return null;
        return majiangTile.replace('_', '');
    }

    // ランダムな風を取得
    randomWind() {
        return WIND_NAMES[Math.floor(Math.random() * 4)];
    }

    // ドラ表示牌を生成
    generateDoraIndicators(count) {
        const indicators = [];
        for (let i = 0; i < count; i++) {
            indicators.push(this.randomTileCode());
        }
        return indicators;
    }

    // ランダムな牌コードを生成
    randomTileCode() {
        const types = ['m', 'p', 's', 'z'];
        const type = types[Math.floor(Math.random() * types.length)];
        let num;
        
        if (type === 'z') {
            num = Math.floor(Math.random() * 7) + 1;
        } else {
            num = Math.floor(Math.random() * 9) + 1;
            // 赤ドラの可能性
            if (num === 5 && Math.random() < 0.05) {
                num = 0;
            }
        }
        
        return type + num;
    }

    // ユーティリティ関数
    randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }


    // アガリ牌を出すスケジュールを設定
    scheduleAgariTile() {
        if (this.waitingTiles.length === 0) return;
        
        // 待ち牌の中からランダムに1つ選ぶ
        const agariTile = this.randomChoice(this.waitingTiles);
        
        // 3-20ターン目のどこかでアガリ牌を出す(24ターン以内)
        this.scheduledTurn = this.randomInt(3, 20);
        this.scheduledPlayer = this.randomChoice(['shimocha', 'toimen', 'kamicha', 'jibun']);
        this.scheduledAgariTile = agariTile;
        this.agariTileScheduled = true;
        
        console.log(`Scheduled agari tile: ${agariTile} at turn ${this.scheduledTurn} by ${this.scheduledPlayer}`);
    }

    // 表示を更新
    updateDisplay() {
        // ゲーム情報
        document.getElementById('bakaze').textContent = WIND_NAMES[this.zhuangfeng];
        document.getElementById('jikaze').textContent = WIND_NAMES[this.menfeng];
        document.getElementById('honba').textContent = this.honba;
        document.getElementById('kyotaku').textContent = this.kyotaku;
        document.getElementById('yama-count').textContent = this.yamaCount;

        // ドラ表示
        const doraDisplay = document.getElementById('dora-display');
        doraDisplay.innerHTML = '';
        this.baopai.forEach(tile => {
            const img = document.createElement('img');
            img.src = this.getTileImagePath(tile);
            img.className = 'pai-img small';
            img.alt = tile;
            doraDisplay.appendChild(img);
        });

        // 自分の手牌
        this.displayPlayerHand();

        // 捨て牌
        this.displayDiscards();

        // ボタン状態
        this.updateButtons();
    }

    // 牌画像のパスを取得
    getTileImagePath(tile) {
        if (!tile) return 'images/ura.png';
        
        // 赤ドラ(0)の処理
        if (tile.endsWith('0')) {
            // m0, p0, s0 -> m0.png, p0.png, s0.png
            return `images/${tile}.png`;
        }
        
        return `images/${tile}.png`;
    }

    // 自分の手牌を表示
    displayPlayerHand() {
        const handDiv = document.getElementById('player-hand');
        handDiv.innerHTML = '';

        if (!this.shoupai) return;

        // 手牌を表示用に変換
        const handStr = this.shoupai.toString();
        const tiles = this.parseHandString(handStr);

        tiles.forEach(tile => {
            const img = document.createElement('img');
            img.src = this.getTileImagePath(tile);
            img.className = 'pai-img';
            img.alt = tile;
            handDiv.appendChild(img);
        });

        // リーチ/ダマ表示
        const label = document.createElement('span');
        label.className = this.isRiichi ? 'label label-riichi' : 'label label-dama';
        label.textContent = this.isRiichi ? 'リーチ' : 'ダマ';
        handDiv.appendChild(label);
    }

    // 手牌文字列をパース
    parseHandString(handStr) {
        const tiles = [];
        const regex = /([mpsz])([0-9_]+)/g;
        let match;
        
        while ((match = regex.exec(handStr)) !== null) {
            const suit = match[1];
            const nums = match[2].replace(/_/g, '');
            
            for (let i = 0; i < nums.length; i++) {
                tiles.push(suit + nums[i]);
            }
        }
        
        return tiles;
    }

    // 捨て牌を表示
    displayDiscards() {
        ['shimocha', 'toimen', 'kamicha', 'jibun'].forEach(player => {
            const discardDiv = document.getElementById(`discard-${player}`);
            discardDiv.innerHTML = '';
            
            this.discards[player].forEach((tile, index) => {
                const img = document.createElement('img');
                img.src = this.getTileImagePath(tile);
                img.className = 'pai-img small';
                img.alt = tile;
                
                // 最新の捨て牌を強調(アガリ牌の場合)
                if (index === this.discards[player].length - 1 && 
                    player === this.currentAgariPlayer &&
                    this.waitingForAction) {
                    img.classList.add('highlighted');
                }
                
                discardDiv.appendChild(img);
            });
        });
    }

    // ボタン状態を更新
    updateButtons() {
        const btnAdvance = document.getElementById('btn-advance');
        const btnRon = document.getElementById('btn-ron');
        const btnTsumo = document.getElementById('btn-tsumo');

        // デフォルトは非表示
        btnRon.style.display = 'none';
        btnTsumo.style.display = 'none';
        btnAdvance.disabled = false;

        // アガリ判定待ち状態の場合
        if (this.waitingForAction) {
            btnAdvance.disabled = false; // 見逃しを可能にする
            
            if (this.currentAgariPlayer === 'jibun') {
                // 自分のツモ
                btnTsumo.style.display = 'block';
                btnTsumo.disabled = false;
            } else {
                // 他家の捨て牌でロン可能
                btnRon.style.display = 'block';
                
                // フリテンチェック
                if (this.checkFuriten(this.currentAgariTile)) {
                    btnRon.disabled = true;
                    btnRon.title = 'フリテン';
                } else {
                    btnRon.disabled = false;
                    btnRon.title = '';
                }
            }
        }
    }

    // フリテンをチェック
    checkFuriten(tile) {
        // 同順フリテン
        if (this.douzyunFuriten) {
            return true;
        }
        
        // 捨て牌フリテン
        if (this.myDiscardHistory.includes(tile)) {
            return true;
        }
        
        // リーチ後フリテン
        if (this.isRiichi) {
            // リーチ後に待ち牌を捨てた場合
            for (const waitTile of this.waitingTiles) {
                if (this.myDiscardHistory.includes(waitTile)) {
                    return true;
                }
            }
        }
        
        return false;
    }


    // 進むボタンが押された
    advance() {
        console.log('Advance button clicked', {
            waitingForAction: this.waitingForAction,
            yamaCount: this.yamaCount,
            turnCount: this.turnCount
        });

        // アガリ判定待ち状態の場合は見逃しとみなす
        if (this.waitingForAction) {
            this.handleMissingAgari();
            return;
        }

        // 流局チェック
        if (this.yamaCount <= 0 || this.turnCount >= this.totalTurns) {
            this.showRyukyoku();
            return;
        }

        // 現在のプレイヤーの捨て牌が6枚以上なら次のプレイヤーへ
        if (this.discards[this.currentPlayer].length >= this.maxDiscards) {
            this.moveToNextPlayer();
            // まだ捨てられるプレイヤーがいるかチェック
            let allFull = true;
            for (const player of ['shimocha', 'toimen', 'kamicha', 'jibun']) {
                if (this.discards[player].length < this.maxDiscards) {
                    allFull = false;
                    break;
                }
            }
            if (allFull) {
                this.showRyukyoku();
                return;
            }
        }

        // 捨て牌を生成
        const tile = this.generateDiscard();
        this.discards[this.currentPlayer].push(tile);
        this.yamaCount--;
        this.turnCount++;

        console.log(`Player ${this.currentPlayer} discarded ${tile}`, {
            yamaCount: this.yamaCount,
            turnCount: this.turnCount
        });

        // 自分の捨て牌の場合は履歴に追加
        if (this.currentPlayer === 'jibun') {
            this.myDiscardHistory.push(tile);
        }

        // アガリ牌かチェック
        if (this.waitingTiles.includes(tile)) {
            console.log(`Agari tile detected: ${tile}`);
            this.currentAgariTile = tile;
            this.currentAgariPlayer = this.currentPlayer;
            this.waitingForAction = true;
            this.lastWaitingCheck = tile;
        } else {
            this.currentAgariTile = null;
            this.currentAgariPlayer = null;
            this.waitingForAction = false;
            
            // 同順フリテンは次巡で解消
            this.douzyunFuriten = false;
        }

        // 次のプレイヤーへ(アガリ判定待ちでない場合のみ)
        if (!this.waitingForAction) {
            this.moveToNextPlayer();
        }

        this.updateDisplay();
    }

    // 次のプレイヤーに進む
    moveToNextPlayer() {
        const players = ['shimocha', 'toimen', 'kamicha', 'jibun'];
        const currentIndex = players.indexOf(this.currentPlayer);
        this.currentPlayer = players[(currentIndex + 1) % 4];
    }

    // アガリ見逃し処理
    handleMissingAgari() {
        // 同順フリテン成立
        this.douzyunFuriten = true;
        this.missedTiles.push(this.currentAgariTile);
        
        // アガリ判定待ち解除
        this.waitingForAction = false;
        this.currentAgariTile = null;
        this.currentAgariPlayer = null;
        
        // 次のプレイヤーへ
        this.moveToNextPlayer();
        this.updateDisplay();
    }

    // 捨て牌を生成
    generateDiscard() {
        // スケジュールされたアガリ牌を出すタイミングか
        if (this.agariTileScheduled && 
            this.turnCount === this.scheduledTurn && 
            this.currentPlayer === this.scheduledPlayer) {
            this.agariTileScheduled = false;
            return this.scheduledAgariTile;
        }

        // それ以外はランダム
        return this.randomTileCode();
    }

    // ロンボタンが押された
    ron() {
        // フリテンチェック
        if (this.checkFuriten(this.currentAgariTile)) {
            this.showChombo('フリテン中はロンできません', {
                furiten: true,
                furitenReason: this.getFuritenReason()
            });
            return;
        }

        // アガリ牌チェック
        if (!this.currentAgariTile || !this.waitingTiles.includes(this.currentAgariTile)) {
            this.showChombo('アガリ牌ではありません');
            return;
        }

        // 他家の捨て牌でない場合
        if (this.currentAgariPlayer === 'jibun') {
            this.showChombo('自分のツモでロンはできません。ツモボタンを押してください。');
            return;
        }

        // 正しいアガリ
        this.showWin('ron', this.currentAgariTile);
    }

    // ツモボタンが押された
    tsumo() {
        // アガリ牌チェック
        if (!this.currentAgariTile || !this.waitingTiles.includes(this.currentAgariTile)) {
            this.showChombo('アガリ牌ではありません');
            return;
        }

        // 自分のツモでない場合
        if (this.currentAgariPlayer !== 'jibun') {
            this.showChombo('他家の捨て牌です。ロンボタンを押してください。');
            return;
        }

        // 正しいアガリ
        this.showWin('tsumo', this.currentAgariTile);
    }

    // フリテン理由を取得
    getFuritenReason() {
        if (this.douzyunFuriten) {
            return '同順フリテン(アガリ牌を見逃しました)';
        }
        
        if (this.myDiscardHistory.includes(this.currentAgariTile)) {
            return '捨て牌フリテン(過去に待ち牌を捨てています)';
        }
        
        if (this.isRiichi) {
            for (const waitTile of this.waitingTiles) {
                if (this.myDiscardHistory.includes(waitTile)) {
                    return 'リーチ後フリテン(リーチ後に待ち牌を捨てています)';
                }
            }
        }
        
        return 'フリテン';
    }


    // アガリダイアログを表示
    showWin(type, agariTile) {
        try {
            // 和了計算
            const hule = this.calculateHule(this.shoupai, agariTile);
            
            if (!hule || hule.length === 0) {
                this.showChombo('和了形が見つかりません');
                return;
            }

            // 最高点の和了を選択
            let bestHule = hule[0];
            for (const h of hule) {
                if (h.defen > bestHule.defen) {
                    bestHule = h;
                }
            }

            const modal = document.getElementById('modal-win');
            
            // 手牌表示
            const handDisplay = document.getElementById('win-hand');
            handDisplay.innerHTML = '';
            const handTiles = this.parseHandString(this.shoupai.toString());
            handTiles.forEach(tile => {
                const img = document.createElement('img');
                img.src = this.getTileImagePath(tile);
                img.className = 'pai-img';
                img.alt = tile;
                handDisplay.appendChild(img);
            });
            
            // アガリ牌を追加
            const agariImg = document.createElement('img');
            agariImg.src = this.getTileImagePath(agariTile);
            agariImg.className = 'pai-img';
            agariImg.style.border = '3px solid #f44336';
            agariImg.alt = agariTile;
            handDisplay.appendChild(agariImg);

            // 役一覧
            const yakuList = document.getElementById('yaku-list');
            yakuList.innerHTML = '';
            if (bestHule.hupai) {
                bestHule.hupai.forEach(yaku => {
                    const li = document.createElement('li');
                    li.className = 'yaku-item';
                    li.innerHTML = `<span>${yaku.name}</span><span>${yaku.fanshu}翻</span>`;
                    yakuList.appendChild(li);
                });
            }

            // 点数表示
            const pointDisplay = document.getElementById('point-display');
            pointDisplay.textContent = `${bestHule.defen}点`;

            // 支払い情報
            const paymentInfo = document.getElementById('payment-info');
            if (type === 'ron') {
                paymentInfo.innerHTML = `
                    <div style="font-size: 18px; margin-top: 15px;">
                        <strong>放銃者から: ${bestHule.defen + this.honba * 300 + this.kyotaku * 1000}点</strong><br>
                        <small>(本場: +${this.honba * 300}点, 供託: +${this.kyotaku * 1000}点)</small>
                    </div>
                `;
            } else {
                const fenpei = bestHule.fenpei;
                paymentInfo.innerHTML = `
                    <div style="font-size: 18px; margin-top: 15px;">
                        <strong>ツモアガリ</strong><br>
                        親: ${fenpei[0]}点 / 子: ${fenpei[1]}点<br>
                        <small>(本場: 各+${this.honba * 100}点, 供託: +${this.kyotaku * 1000}点)</small>
                    </div>
                `;
            }

            modal.classList.add('show');
        } catch (e) {
            console.error('Win display error:', e);
            this.showChombo('点数計算エラーが発生しました');
        }
    }

    // チョンボダイアログを表示
    showChombo(reason, options = {}) {
        const modal = document.getElementById('modal-chombo');
        
        // 理由
        document.getElementById('chombo-reason').innerHTML = 
            `<p style="color: #f44336; font-weight: bold; font-size: 18px;">${reason}</p>`;

        // フリテン情報
        const furitenInfo = document.getElementById('furiten-info');
        if (options.furiten) {
            furitenInfo.innerHTML = `
                <div class="furiten-warning">
                    <strong>フリテン状態</strong><br>
                    理由: ${options.furitenReason}<br>
                    ${this.missedTiles.length > 0 ? `見逃した牌: ${this.missedTiles.join(', ')}` : ''}
                    ${this.myDiscardHistory.length > 0 ? `<br>あなたの捨て牌: ${this.myDiscardHistory.slice(-10).join(', ')}` : ''}
                </div>
            `;
        } else {
            furitenInfo.innerHTML = '';
        }

        // 正しい待ち牌
        const waitingDiv = document.getElementById('correct-waiting');
        waitingDiv.innerHTML = '';
        this.waitingTiles.forEach(tile => {
            const img = document.createElement('img');
            img.src = this.getTileImagePath(tile);
            img.className = 'pai-img';
            img.alt = tile;
            waitingDiv.appendChild(img);
        });

        // 各待ちでの点数を計算
        const correctPoints = document.getElementById('correct-points');
        let pointsHtml = '<h3>各待ちでアガった場合の点数:</h3><ul class="yaku-list">';
        
        this.waitingTiles.forEach(tile => {
            try {
                const ronHule = this.calculateHule(this.shoupai, tile);
                if (ronHule && ronHule.length > 0) {
                    const points = ronHule[0].defen;
                    const yakuNames = ronHule[0].hupai ? ronHule[0].hupai.map(y => y.name).join(', ') : '';
                    pointsHtml += `
                        <li class="yaku-item">
                            <span>${tile} ロン (${yakuNames})</span>
                            <span>${points}点</span>
                        </li>
                    `;
                }
            } catch (e) {
                console.error('Point calculation error:', e);
            }
        });
        
        pointsHtml += '</ul>';
        correctPoints.innerHTML = pointsHtml;

        modal.classList.add('show');
    }

    // 流局ダイアログを表示
    showRyukyoku() {
        const modal = document.getElementById('modal-ryukyoku');
        
        // 見落とした待ち牌
        const missedDiv = document.getElementById('missed-waiting');
        missedDiv.innerHTML = '';
        this.waitingTiles.forEach(tile => {
            const img = document.createElement('img');
            img.src = this.getTileImagePath(tile);
            img.className = 'pai-img';
            img.alt = tile;
            missedDiv.appendChild(img);
        });

        modal.classList.add('show');
    }
}

// モーダルを閉じる
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
    // 新しい問題を開始
    if (game) {
        game.reset();
    }
}

// ゲームインスタンス
let game;

// 初期化
window.addEventListener('DOMContentLoaded', async () => {
    console.log('=== Mahjong Trainer Initialization ===');
    console.log('DOM Content Loaded');
    console.log('Protocol:', window.location.protocol);
    console.log('URL:', window.location.href);
    console.log('User Agent:', navigator.userAgent);
    console.log('Online:', navigator.onLine);
    
    // オンライン状態をチェック
    if (!navigator.onLine) {
        alert('⚠️ インターネットに接続されていません。\n\nオンラインになってから再度お試しください。');
        return;
    }
    
    // Majiangが既に読み込まれているかチェック
    console.log('Checking if Majiang is already loaded...');
    console.log('typeof Majiang:', typeof Majiang);
    
    game = new MahjongGame();
    
    try {
        console.log('Starting game initialization...');
        await game.init();
        console.log('✅ Game initialization complete');
    } catch (error) {
        console.error('❌ Failed to initialize game:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
        
        // エラーメッセージ
        let message = '❌ 麻雀ライブラリの読み込みに失敗しました。\n\n';
        
        if (window.location.protocol === 'file:') {
            message += '⚠️ ローカルファイルから実行しています。\n\n' +
                      '【推奨】以下のいずれかの方法で実行してください:\n\n' +
                      '1. ローカルサーバーを使用:\n' +
                      '   python -m http.server 8000\n' +
                      '   → http://localhost:8000/\n\n' +
                      '2. GitHub Pagesで公開:\n' +
                      '   → GITHUB_PAGES_SETUP.md を参照';
        } else {
            message += '以下を確認してください:\n' +
                      '1. インターネットに接続されているか\n' +
                      '2. F12キーを押してコンソールを確認\n' +
                      '3. 別のブラウザで試してみる\n' +
                      '4. 数分待ってから再度アクセス\n\n' +
                      'コンソールに詳細なエラー情報が表示されています。';
        }
        
        alert(message);
        return;
    }

    // イベントリスナー
    document.getElementById('btn-advance').addEventListener('click', () => {
        if (game.initialized) {
            game.advance();
        } else {
            console.error('Game not initialized');
            alert('ゲームが初期化されていません。ページをリロードしてください。');
        }
    });

    document.getElementById('btn-ron').addEventListener('click', () => {
        if (game.initialized) {
            game.ron();
        } else {
            console.error('Game not initialized');
        }
    });

    document.getElementById('btn-tsumo').addEventListener('click', () => {
        if (game.initialized) {
            game.tsumo();
        } else {
            console.error('Game not initialized');
        }
    });
    
    console.log('=== Initialization Complete ===');
});
