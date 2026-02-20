// ESG Equity Calculator — Vercel Serverless Function
// POST /api/solve → accepts JSON config, runs Monte Carlo sim, returns JSON result

'use strict';

// --- PRNG (xorshift128+) ---
let s0 = 0x12345678, s1 = 0x9ABCDEF0;
function seed(a, b) { s0 = a | 0 || 1; s1 = b | 0 || 2; }
function rand() {
  let a = s0, b = s1; s0 = b;
  a ^= a << 23; a ^= a >>> 17; a ^= b; a ^= b >>> 26;
  s1 = a; return (a + b) >>> 0;
}
function randInt(n) { return rand() % n; }

// --- 5-card evaluator with lookup table ---
const MULT = 371294;
const rankTable = new Int32Array(371294);

function buildRankTable() {
  for (let r0 = 12; r0 >= 0; r0--)
    for (let r1 = r0; r1 >= 0; r1--)
      for (let r2 = r1; r2 >= 0; r2--)
        for (let r3 = r2; r3 >= 0; r3--)
          for (let r4 = r3; r4 >= 0; r4--) {
            const idx = r0 * 28561 + r1 * 2197 + r2 * 169 + r3 * 13 + r4;
            const allUq = r0 > r1 && r1 > r2 && r2 > r3 && r3 > r4;
            if (allUq) {
              if (r0 - r4 === 4) {
                rankTable[idx] = 4 * MULT + r0;
              } else if (r0 === 12 && r1 === 3 && r2 === 2 && r3 === 1 && r4 === 0) {
                rankTable[idx] = 4 * MULT + 3;
              } else {
                rankTable[idx] = r0 * 28561 + r1 * 2197 + r2 * 169 + r3 * 13 + r4;
              }
            } else {
              const rr = [r0, r1, r2, r3, r4];
              const gr = []; let i = 0;
              while (i < 5) { let j = i + 1; while (j < 5 && rr[j] === rr[i]) j++; gr.push([rr[i], j - i]); i = j; }
              gr.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
              const p = gr.map(g => g[1]).join('');
              if (p === '5') {
                rankTable[idx] = 0;
              } else if (p[0] === '4') {
                rankTable[idx] = 7 * MULT + gr[0][0] * 13 + gr[1][0];
              } else if (p === '32') {
                rankTable[idx] = 6 * MULT + gr[0][0] * 13 + gr[1][0];
              } else if (p === '311') {
                rankTable[idx] = 3 * MULT + gr[0][0] * 169 + gr[1][0] * 13 + gr[2][0];
              } else if (p === '221') {
                rankTable[idx] = 2 * MULT + gr[0][0] * 169 + gr[1][0] * 13 + gr[2][0];
              } else {
                rankTable[idx] = 1 * MULT + gr[0][0] * 2197 + gr[1][0] * 169 + gr[2][0] * 13 + gr[3][0];
              }
            }
          }
}

// Build once on cold start
buildRankTable();

function eval5(c0, c1, c2, c3, c4) {
  let r0 = c0 >> 2, r1 = c1 >> 2, r2 = c2 >> 2, r3 = c3 >> 2, r4 = c4 >> 2, t;
  if (r0 < r3) { t = r0; r0 = r3; r3 = t; }
  if (r1 < r4) { t = r1; r1 = r4; r4 = t; }
  if (r0 < r2) { t = r0; r0 = r2; r2 = t; }
  if (r1 < r3) { t = r1; r1 = r3; r3 = t; }
  if (r0 < r1) { t = r0; r0 = r1; r1 = t; }
  if (r2 < r4) { t = r2; r2 = r4; r4 = t; }
  if (r1 < r2) { t = r1; r1 = r2; r2 = t; }
  if (r3 < r4) { t = r3; r3 = r4; r4 = t; }
  if (r2 < r3) { t = r2; r2 = r3; r3 = t; }

  let sc = rankTable[r0 * 28561 + r1 * 2197 + r2 * 169 + r3 * 13 + r4];

  if (r0 > r1 && r1 > r2 && r2 > r3 && r3 > r4) {
    const s = c0 & 3;
    if (s === (c1 & 3) && s === (c2 & 3) && s === (c3 & 3) && s === (c4 & 3)) {
      if (sc >= 4 * MULT) sc += 4 * MULT;
      else sc += 5 * MULT;
    }
  }
  return sc;
}

function best5(hand, n) {
  let best = 0;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = eval5(hand[a], hand[b], hand[c], hand[d], hand[e]);
            if (s > best) best = s;
          }
  return best;
}

const B3 = [[0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4], [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]];

function bestPLO(hand, n, board) {
  let best = 0;
  for (let a = 0; a < n - 1; a++)
    for (let b = a + 1; b < n; b++) {
      const h0 = hand[a], h1 = hand[b];
      for (let i = 0; i < 10; i++) {
        const s = eval5(h0, h1, board[B3[i][0]], board[B3[i][1]], board[B3[i][2]]);
        if (s > best) best = s;
      }
    }
  return best;
}

// --- Monte Carlo simulation ---
function runSimulation({ playerHands, numPlayers, startingCards, totalDraws, numTrials, knownBoard1, knownBoard2 }) {
  const totalDrawsPerPlayer = totalDraws;
  const fullSize = startingCards + totalDrawsPerPlayer;

  const kb1 = knownBoard1 || [];
  const kb2 = knownBoard2 || [];
  const unknownB1 = 5 - kb1.length;
  const unknownB2 = 5 - kb2.length;

  seed(Date.now() ^ 0xDEAD, (Date.now() >>> 4) ^ 0xBEEF);

  // remaining deck (exclude known hands + known boards)
  const known = new Set();
  for (let p = 0; p < numPlayers; p++) for (const c of playerHands[p]) known.add(c);
  for (const c of kb1) known.add(c);
  for (const c of kb2) known.add(c);
  const remaining = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) remaining.push(c);
  const R = remaining.length;
  const cardsNeeded = numPlayers * totalDrawsPerPlayer + unknownB1 + unknownB2;

  const pts = [];
  const potEq = [];
  const scoops = [];
  for (let p = 0; p < numPlayers; p++) { pts.push([0, 0, 0]); potEq.push(0); scoops.push(0); }

  const trialPts = new Float64Array(numPlayers);

  const hands = [];
  for (let p = 0; p < numPlayers; p++) {
    const h = new Array(fullSize);
    for (let i = 0; i < startingCards; i++) h[i] = playerHands[p][i];
    hands.push(h);
  }
  const board1 = new Array(5);
  const board2 = new Array(5);
  for (let i = 0; i < kb1.length; i++) board1[i] = kb1[i];
  for (let i = 0; i < kb2.length; i++) board2[i] = kb2[i];

  for (let trial = 0; trial < numTrials; trial++) {
    // partial Fisher-Yates
    for (let i = 0; i < cardsNeeded; i++) {
      const j = i + randInt(R - i);
      const tmp = remaining[i]; remaining[i] = remaining[j]; remaining[j] = tmp;
    }

    let idx = 0;
    for (let p = 0; p < numPlayers; p++)
      for (let d = 0; d < totalDrawsPerPlayer; d++)
        hands[p][startingCards + d] = remaining[idx++];

    for (let i = kb1.length; i < 5; i++) board1[i] = remaining[idx++];
    for (let i = kb2.length; i < 5; i++) board2[i] = remaining[idx++];

    let bestSc0 = -1, bestSc1 = -1, bestSc2 = -1;
    const sc0 = new Array(numPlayers);
    const sc1 = new Array(numPlayers);
    const sc2 = new Array(numPlayers);

    for (let p = 0; p < numPlayers; p++) {
      const h = hands[p];
      sc0[p] = bestPLO(h, fullSize, board1);
      sc1[p] = bestPLO(h, fullSize, board2);
      sc2[p] = best5(h, fullSize);
      if (sc0[p] > bestSc0) bestSc0 = sc0[p];
      if (sc1[p] > bestSc1) bestSc1 = sc1[p];
      if (sc2[p] > bestSc2) bestSc2 = sc2[p];
    }

    for (let p = 0; p < numPlayers; p++) trialPts[p] = 0;
    for (let comp = 0; comp < 3; comp++) {
      const best = comp === 0 ? bestSc0 : comp === 1 ? bestSc1 : bestSc2;
      const sc = comp === 0 ? sc0 : comp === 1 ? sc1 : sc2;
      let winners = 0;
      for (let p = 0; p < numPlayers; p++) if (sc[p] === best) winners++;
      const share = 1 / winners;
      for (let p = 0; p < numPlayers; p++) if (sc[p] === best) {
        pts[p][comp] += share;
        trialPts[p] += share;
      }
    }

    let maxPts = -1;
    for (let p = 0; p < numPlayers; p++) if (trialPts[p] > maxPts) maxPts = trialPts[p];
    let potWinners = 0;
    for (let p = 0; p < numPlayers; p++) if (trialPts[p] === maxPts) potWinners++;
    const potShare = 1 / potWinners;
    for (let p = 0; p < numPlayers; p++) if (trialPts[p] === maxPts) {
      potEq[p] += potShare;
      if (potWinners === 1) scoops[p] += 1;
    }
  }

  return {
    type: 'done',
    trial: numTrials,
    numPlayers,
    points: pts.map(a => [...a]),
    potEq: [...potEq],
    scoops: [...scoops]
  };
}

// === VERCEL HANDLER ===
const { verifyGoogleToken } = require('./_lib/auth');
const { checkSubscription } = require('./_lib/stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth: require Google sign-in ---
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Sign in with Google to use the calculator' });
  }
  const user = await verifyGoogleToken(auth.slice(7));
  if (!user || user.error) {
    return res.status(401).json({ error: 'Auth failed: ' + (user ? user.error : 'no result') });
  }

  // --- Stripe: require active subscription ---
  try {
    const subscribed = await checkSubscription(user.email);
    if (!subscribed) {
      return res.status(403).json({ error: 'Subscription required' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Stripe error: ' + err.message });
  }

  // --- Validate input ---
  const cfg = req.body;
  if (!cfg || typeof cfg !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { playerHands, numPlayers, startingCards, totalDraws, numTrials, knownBoard1, knownBoard2 } = cfg;

  if (typeof numPlayers !== 'number' || numPlayers < 2 || numPlayers > 5) {
    return res.status(400).json({ error: 'Players must be between 2 and 5' });
  }
  if (typeof startingCards !== 'number' || startingCards < 1 || startingCards > 14) {
    return res.status(400).json({ error: 'Starting cards must be between 1 and 14' });
  }
  if (typeof totalDraws !== 'number' || totalDraws < 0 || totalDraws > 15) {
    return res.status(400).json({ error: 'Total draws must be between 0 and 15' });
  }
  if (typeof numTrials !== 'number' || numTrials < 1) {
    return res.status(400).json({ error: 'Trials must be at least 1' });
  }

  // Cap trials at 100K to stay within Vercel 10s timeout
  const cappedTrials = Math.min(numTrials, 100000);

  if (!Array.isArray(playerHands) || playerHands.length !== numPlayers) {
    return res.status(400).json({ error: 'playerHands must match numPlayers' });
  }
  for (let p = 0; p < numPlayers; p++) {
    if (!Array.isArray(playerHands[p]) || playerHands[p].length !== startingCards) {
      return res.status(400).json({ error: `Player ${p + 1} must have exactly ${startingCards} cards` });
    }
  }

  // --- Run simulation ---
  try {
    const result = runSimulation({
      playerHands,
      numPlayers,
      startingCards,
      totalDraws,
      numTrials: cappedTrials,
      knownBoard1: knownBoard1 || [],
      knownBoard2: knownBoard2 || []
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Solver error: ' + err.message });
  }
};
