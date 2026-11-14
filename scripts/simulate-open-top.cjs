// Paired experiment on the first white-stake small blind, using ordinary, unenhanced cards.
// node scripts/simulate-open-top.cjs [seeds] [draw samples] [starting seed]
const assert = require('node:assert/strict');
const {harness} = require('../tests/game-harness.cjs');

const game = harness(1).game;
const {HANDS} = game.getDefinitions();
const codeOf = c => c.suit * 13 + c.rank - 2;
const chip = Array.from({length:13}, (_, r) => r === 12 ? 11 : Math.min(10, r + 2));
const cardName = id => '♠♥♣♦'[Math.floor(id / 13)] + ['2','3','4','5','6','7','8','9','10','J','Q','K','A'][id % 13];
const rankBits = Array.from({length:52}, (_, id) => 1 << (id % 13));
const suits = Array.from({length:52}, (_, id) => Math.floor(id / 13));
const fullDeck = Array.from({length:52}, (_, id) => id);
const rankSets = 1 << 13;
const high = Array.from({length:rankSets}, (_, ranks) => 31 - Math.clz32(ranks));
const flushChips = new Uint8Array(rankSets);
const straightChips = new Uint8Array(rankSets);
const straightMasks = [0x100f, ...Array.from({length:9}, (_, n) => 31 << n)];
for (let mask = 1; mask < rankSets; mask++) {
  let ranks = mask, sum = 0, count = 0;
  while (ranks && count < 5) {
    const r = high[ranks];
    sum += chip[r];
    ranks ^= 1 << r;
    count++;
  }
  if (count === 5) flushChips[mask] = sum;
}
for (let ranks = 1; ranks < rankSets; ranks++) {
  for (const straight of straightMasks) {
    if ((ranks & straight) === straight) straightChips[ranks] = Math.max(straightChips[ranks], flushChips[straight]);
  }
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let x = Math.imul(state ^ state >>> 15, state | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

// Evaluate all achievable categories in one pass. A high flush can outscore a low full house.
// This fast path is only valid for level-one, jokerless, unenhanced, non-Boss hands.
const suitRanks = new Uint16Array(4);
const points = (h, chips) => (h.chips + chips) * h.mult;
function bestScore(kept, drawn = [], count = 0) {
  let ranks = 0, pairs = 0, trips = 0, quads = 0;
  suitRanks.fill(0);
  for (let i = 0; i < kept.length + count; i++) {
    const id = i < kept.length ? kept[i] : drawn[i - kept.length];
    const bit = rankBits[id];
    quads |= trips & bit;
    trips |= pairs & bit;
    pairs |= ranks & bit;
    ranks |= bit;
    suitRanks[suits[id]] |= bit;
  }
  let best = points(HANDS.high, chip[high[ranks]]);
  if (pairs) {
    const p = high[pairs], remainingPairs = pairs ^ (1 << p);
    best = Math.max(best, points(HANDS.pair, 2 * chip[p]));
    if (remainingPairs) best = Math.max(best, points(HANDS.twopair, 2 * (chip[p] + chip[high[remainingPairs]])));
  }
  if (trips) {
    const t = high[trips], otherPair = pairs ^ (1 << t);
    best = Math.max(best, points(HANDS.trips, 3 * chip[t]));
    if (otherPair) best = Math.max(best, points(HANDS.fh, 3 * chip[t] + 2 * chip[high[otherPair]]));
  }
  if (quads) best = Math.max(best, points(HANDS.four, 4 * chip[high[quads]]));
  if (straightChips[ranks]) best = Math.max(best, points(HANDS.straight, straightChips[ranks]));
  for (let suit = 0; suit < 4; suit++) {
    const suited = suitRanks[suit];
    if (flushChips[suited]) best = Math.max(best, points(HANDS.flush, flushChips[suited]));
    if (straightChips[suited]) best = Math.max(best, points(HANDS.sf, straightChips[suited]));
  }
  return best;
}

const masksBySize = Array.from({length:6}, () => []);
for (let mask = 1; mask < 256; mask++) {
  const picked = Array.from({length:8}, (_, i) => i).filter(i => mask & (1 << i));
  if (picked.length <= 5) masksBySize[picked.length].push({mask, picked});
}
const masks = masksBySize.flat();
const select = (hand, mask) => hand.filter((_, i) => mask & (1 << i));

function strongestPlay(hand) {
  const total = bestScore(hand);
  // Within score ties, preserve cards by playing the shortest valid subset.
  for (const {mask, picked} of masks) {
    if (bestScore(picked.map(i => hand[i])) === total) return {type:'play', mask, total};
  }
  throw Error('No matching play');
}

// The policy only receives a sorted public card set, never the actual draw order.
// The sample permutations are shared across all discard sizes and both information conditions.
// Swapping the visible card into position zero conditions the same uniform permutation.
function drawSamples(hand, pool, top, sampleCount) {
  let hash = 0x31415926;
  for (const card of pool.concat(hand)) hash = Math.imul(hash ^ (card + 1), 16777619);
  const random = seeded(hash);
  return Array.from({length:sampleCount}, () => {
    const scratch = pool.slice();
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(random() * (scratch.length - i));
      [scratch[i],scratch[j]] = [scratch[j],scratch[i]];
    }
    const draw = scratch.slice(0, 5);
    if (top !== null) {
      const where = draw.indexOf(top);
      if (where >= 0) draw[where] = draw[0];
      draw[0] = top;
    }
    return draw;
  });
}

function decide(hand, pool, top, remaining, discards, sampleCount) {
  const play = strongestPlay(hand);
  if (play.total >= remaining || !discards) return play;
  const samples = drawSamples(hand, pool, top, sampleCount);
  // Use the existing balance bot's 12% improvement hurdle for spending a discard.
  // Only forecast the next playable hand, with utility capped at the points still needed.
  let choice = play, bestUtility = play.total * 1.12;
  for (const {mask,picked} of masks) {
    const keep = hand.filter((_, i) => !(mask & (1 << i)));
    let sum = 0;
    for (const draw of samples) sum += Math.min(remaining, bestScore(keep, draw, picked.length));
    const utility = sum / sampleCount;
    if (utility > bestUtility) {
      bestUtility = utility;
      choice = {type:'discard', mask};
    }
  }
  return choice;
}

function crossCheckExamples() {
  game.Math.random = seeded(1);
  game.newGame(false, 'open', 'white');
  game.startBlind();
  const s = game.getState();
  const byName = new Map(s.deckAll.map(c => [cardName(codeOf(c)), c]));
  const fixtures = [
    ['straight', '♠A ♥2 ♣3 ♦4 ♣5 ♠9 ♥J ♦K'],
    ['sf', '♥A ♥2 ♥3 ♥4 ♥5 ♠10 ♦Q ♣K'],
    ['four', '♠3 ♥3 ♣3 ♦3 ♣A ♦A ♥K ♠4'],
    ['fh', '♠3 ♥3 ♣3 ♠A ♥A ♣A ♦K ♠4'],
    ['flush', '♥3 ♥9 ♥10 ♥J ♥Q ♥A ♠4 ♦7'],
    ['flush', '♥2 ♥3 ♥9 ♥J ♥A ♠2 ♣2 ♣3'],
    ['straight', '♥2 ♥3 ♠4 ♦5 ♣6 ♣7 ♥8 ♦9'],
    ['trips', '♠3 ♥3 ♣3 ♦A ♣K ♦9 ♥4 ♠7'],
    ['twopair', '♠3 ♥3 ♣4 ♦4 ♠K ♥K ♣A ♦7'],
    ['pair', '♠3 ♥3 ♣8 ♦4 ♠K ♥Q ♣A ♦7'],
    ['high', '♠3 ♥9 ♣8 ♦4 ♠K ♥Q ♣A ♦6'],
  ];
  for (const [category, names] of fixtures) {
    const hand = names.split(' ').map(name => byName.get(name));
    const oracle = game.bestSelection({...s, hand});
    assert.equal(oracle.key, category, names);
    assert.equal(bestScore(hand.map(codeOf)), oracle.total, names);
  }
  return fixtures.length;
}

async function trial(seed, visible, sampleCount, checkOracle) {
  game.Math.random = seeded(seed);
  game.newGame(false, 'open', 'white');
  game.startBlind();
  const s = game.getState();
  assert.deepEqual([s.deckId,s.target,s.handsLeft,s.discLeft,s.hand.length,s.jokers.length], ['open',300,4,3,8,0]);
  const deal = s.hand.map(codeOf).sort((a,b) => a-b).concat(s.drawPile.map(codeOf)).join(',');
  const seen = new Set(), actions = [];
  let initial;
  while (s.screen === 'play') {
    const hand = s.hand.map(codeOf).sort((a,b) => a-b);
    for (const card of hand) seen.add(card);
    const pool = fullDeck.filter(card => !seen.has(card));
    assert.equal(pool.length, s.drawPile.length);
    const advertisedTop = visible ? game.openTopCard(s) : null;
    const top = advertisedTop ? codeOf(advertisedTop) : null;
    if (visible) assert.equal(advertisedTop, s.drawPile.at(-1), 'reveal must match the card that production draws next');
    const action = decide(hand, pool, top, s.target - s.score, s.discLeft, sampleCount);
    if (checkOracle) assert.equal(bestScore(hand), game.bestSelection(s).total, 'fast evaluator and production optimum differ');
    if (!initial) initial = {hand:hand.map(cardName),top:visible ? cardName(top) : null};
    const cards = select(hand, action.mask);
    game.selectCards(s.hand.filter(c => cards.includes(codeOf(c))).map(c => c.id));
    actions.push({action:action.type,cards:cards.map(cardName)});
    if (action.type === 'discard') game.doDiscard();
    else {
      const before = s.score;
      await game.doPlay();
      assert.equal(s.score - before, action.total, 'actual score and fast plan differ');
    }
  }
  return {won:s.screen === 'cash', hands:4 - s.handsLeft, discards:3 - s.discLeft, score:s.score, actions, deal, initial, deck:s.deckId};
}

async function main() {
  const count = Number(process.argv[2] || 256), samples = Number(process.argv[3] || 24), start = Number(process.argv[4] || 1);
  if (![count,samples,start].every(x => Number.isSafeInteger(x) && x > 0)) throw Error('Use positive integers for seeds, samples and starting seed');
  const metrics = {
    count, samples, start, firstActionChanged:0, firstActionTypeChanged:0, onlyOpenWon:0, onlyHiddenWon:0,
    fixtureChecks:crossCheckExamples(), playedScoreChecks:0, optimumChecks:0, hidden:{wins:0, oneHandWins:0, hands:0, discards:0},
    open:{wins:0, oneHandWins:0, hands:0, discards:0}, bestExample:null, counterExample:null,
  };
  let greatestGain = 0, greatestLoss = 0;
  for (let seed = start; seed < start + count; seed++) {
    const checkOracle = (seed % 97 === 1);
    const hidden = await trial(seed, false, samples, checkOracle);
    const open = await trial(seed, true, samples, checkOracle);
    assert.equal(open.deal, hidden.deal, 'paired deal mismatch');
    metrics.deck = open.deck;
    for (const [group,run] of [[metrics.hidden,hidden],[metrics.open,open]]) {
      group.wins += Number(run.won);
      group.oneHandWins += Number(run.won && run.hands === 1);
      group.hands += run.hands;
      group.discards += run.discards;
      metrics.playedScoreChecks += run.hands;
      if (checkOracle) metrics.optimumChecks += run.actions.length;
    }
    metrics.firstActionChanged += Number(JSON.stringify(hidden.actions[0]) !== JSON.stringify(open.actions[0]));
    metrics.firstActionTypeChanged += Number(hidden.actions[0].action !== open.actions[0].action);
    metrics.onlyOpenWon += Number(open.won && !hidden.won);
    metrics.onlyHiddenWon += Number(hidden.won && !open.won);
    const gain = (Number(open.won) - Number(hidden.won)) * 10 + hidden.hands - open.hands;
    if (gain > greatestGain || gain < greatestLoss) {
      const brief = run => ({won:run.won, hands:run.hands, discards:run.discards, first:run.actions[0], score:run.score});
      const example = {seed, ...open.initial, hidden:brief(hidden), open:brief(open)};
      if (gain > greatestGain) {metrics.bestExample = example; greatestGain = gain;}
      if (gain < greatestLoss) {metrics.counterExample = example; greatestLoss = gain;}
    }
  }
  console.log(JSON.stringify(metrics, null, 2));
}
main().catch(error => {console.error(error); process.exitCode = 1;});
