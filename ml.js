/* 기계학습 판독 — 랜덤포레스트 분류(갈래) · kNN 회귀(계면 물 역산). 외부 라이브러리 없이 JS 로.
   데이터는 physics.js 가 미지수를 다시 뽑아 만들고 장비 잡음을 얹은 것 — 실측이 아니다.                */
window.ML = (function () {
  'use strict';
  const P = window.PHYS;

  // ── 결정나무 (지니) ─────────────────────────────────────
  function gini(counts, n) { let g = 1; for (const c of counts) { const p = c / n; g -= p * p; } return g; }
  function buildTree(X, y, idx, nClass, depth, maxDepth, nFeat, rng, minLeaf) {
    const n = idx.length; const counts = new Array(nClass).fill(0); idx.forEach((i) => { counts[y[i]]++; });
    const leaf = () => ({ leaf: true, cls: counts.indexOf(Math.max(...counts)), p: counts.map((c) => c / n) });
    if (depth >= maxDepth || n < 2 * minLeaf || counts.filter((c) => c > 0).length === 1) return leaf();
    const nF = X[0].length; const feats = []; while (feats.length < nFeat) { const f = Math.floor(rng.u() * nF); if (!feats.includes(f)) feats.push(f); }
    let best = { g: Infinity }; const gParent = gini(counts, n);
    for (const f of feats) {
      const vals = idx.map((i) => X[i][f]).sort((a, b) => a - b); const cand = [];
      for (let q = 1; q < 8; q++) cand.push(vals[Math.floor(vals.length * q / 8)]);
      for (const thr of [...new Set(cand)]) {
        const L = new Array(nClass).fill(0), R = new Array(nClass).fill(0); let nl = 0;
        idx.forEach((i) => { if (X[i][f] <= thr) { L[y[i]]++; nl++; } else R[y[i]]++; });
        if (nl < minLeaf || n - nl < minLeaf) continue;
        const g = (nl * gini(L, nl) + (n - nl) * gini(R, n - nl)) / n;
        if (g < best.g) best = { g, f, thr };
      }
    }
    if (!isFinite(best.g) || best.g >= gParent - 1e-9) return leaf();
    const li = [], ri = []; idx.forEach((i) => { (X[i][best.f] <= best.thr ? li : ri).push(i); });
    return { leaf: false, f: best.f, thr: best.thr, L: buildTree(X, y, li, nClass, depth + 1, maxDepth, nFeat, rng, minLeaf), R: buildTree(X, y, ri, nClass, depth + 1, maxDepth, nFeat, rng, minLeaf) };
  }
  function predictTree(t, x) { while (!t.leaf) t = x[t.f] <= t.thr ? t.L : t.R; return t.p; }

  /** 랜덤포레스트 — OOB 정확도 · 혼동행렬 · 순열 중요도 */
  function forest(X, y, nClass, o) {
    o = o || {}; const nTree = o.nTree || 30, maxDepth = o.maxDepth || 8, minLeaf = o.minLeaf || 4; const rng = new P.RNG(o.seed || 11); const n = X.length; const nFeat = o.nFeat || Math.max(1, Math.round(Math.sqrt(X[0].length)));
    const trees = [], bags = [], oob = Array.from({ length: n }, () => new Array(nClass).fill(0));
    for (let t = 0; t < nTree; t++) { const inBag = new Set(); const idx = []; for (let i = 0; i < n; i++) { const j = Math.floor(rng.u() * n); idx.push(j); inBag.add(j); }
      const tree = buildTree(X, y, idx, nClass, 0, maxDepth, nFeat, rng, minLeaf); trees.push(tree); bags.push(inBag);
      for (let i = 0; i < n; i++) if (!inBag.has(i)) { const p = predictTree(tree, X[i]); for (let c = 0; c < nClass; c++) oob[i][c] += p[c]; } }
    const oobPredictRow = (x, i) => { const acc = new Array(nClass).fill(0); let any = false; trees.forEach((t, k) => { if (bags[k].has(i)) return; any = true; const p = predictTree(t, x); for (let c = 0; c < nClass; c++) acc[c] += p[c]; }); return any ? acc.indexOf(Math.max(...acc)) : -1; };
    const predict = (x) => { const acc = new Array(nClass).fill(0); trees.forEach((t) => { const p = predictTree(t, x); for (let c = 0; c < nClass; c++) acc[c] += p[c]; }); return acc.indexOf(Math.max(...acc)); };
    const conf = Array.from({ length: nClass }, () => new Array(nClass).fill(0)); let ok = 0, tot = 0;
    const oobPred = oob.map((p) => (p.some((v) => v > 0) ? p.indexOf(Math.max(...p)) : -1));
    oobPred.forEach((pr, i) => { if (pr < 0) return; tot++; conf[y[i]][pr]++; if (pr === y[i]) ok++; });
    const acc = ok / Math.max(tot, 1);
    // 순열 중요도 — 특징 하나를 섞어 OOB 정확도가 얼마나 떨어지나
    const imp = X[0].map((_, f) => { const Xp = X.map((r) => r.slice()); const perm = X.map((r) => r[f]); for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rng.u() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } Xp.forEach((r, i) => { r[f] = perm[i]; });
      let ok2 = 0, tot2 = 0; for (let i = 0; i < n; i++) { if (oobPred[i] < 0) continue; tot2++; if (oobPredictRow(Xp[i], i) === y[i]) ok2++; } return acc - ok2 / Math.max(tot2, 1); });
    return { acc, conf, imp, predict, nTree, n };
  }

  /** kNN 회귀 — 표준화 특징, k 이웃 평균. 교차검증(5겹) RMSE */
  function knnCV(X, y, k, folds) {
    k = k || 10; folds = folds || 5; const n = X.length, nF = X[0].length;
    const mu = Array.from({ length: nF }, (_, f) => X.reduce((s, r) => s + r[f], 0) / n), sd = Array.from({ length: nF }, (_, f) => Math.sqrt(X.reduce((s, r) => s + (r[f] - mu[f]) ** 2, 0) / n) || 1);
    const Z = X.map((r) => r.map((v, f) => (v - mu[f]) / sd[f]));
    const rng = new P.RNG(5); const fold = Array.from({ length: n }, () => Math.floor(rng.u() * folds));
    const pred = new Array(n).fill(0);
    for (let fo = 0; fo < folds; fo++) { const tr = []; for (let i = 0; i < n; i++) if (fold[i] !== fo) tr.push(i);
      for (let i = 0; i < n; i++) { if (fold[i] !== fo) continue; const d = tr.map((j) => { let s = 0; for (let f = 0; f < nF; f++) s += (Z[i][f] - Z[j][f]) ** 2; return [s, j]; }); d.sort((a, b) => a[0] - b[0]); let s = 0; for (let m = 0; m < k; m++) s += y[d[m][1]]; pred[i] = s / k; } }
    const rmse = Math.sqrt(pred.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / n);
    const ym = y.reduce((s, v) => s + v, 0) / n; const r2 = 1 - pred.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / Math.max(y.reduce((s, v) => s + (v - ym) ** 2, 0), 1e-12);
    return { pred, rmse, r2 };
  }

  /** 학습 데이터 — 세상 × 갈래 × 쿠폰. 같은 세상의 D1 짝쿠폰 차이도 만든다 */
  const MEAS = ['dcb', 'shear', 'esr', 'tds_h2o', 'tds_h2', 'sam_void'];
  function dataset(worldsArr, opts) {
    const dose = opts.dose, carbon = opts.carbon, o = opts.o, nRep = opts.nRep || 2, sigmaLot = opts.sigmaLot || 0.15; const rng = new P.RNG(opts.seed || 3);
    const rows = [];
    worldsArr.forEach((u0) => { const u = Object.assign({}, u0); ['db0', 'w0', 'sil0'].forEach((k) => { u[k] = u0[k] * Math.exp(rng.normal(0, sigmaLot)); });
      const ref = P.forward(0, 'D1', carbon, 100, u, o); const refM = []; for (let r = 0; r < nRep; r++) refM.push(P.measure(ref, rng)); const refMean = {}; MEAS.forEach((m) => { refMean[m] = refM.reduce((s, x) => s + x[m], 0) / nRep; });
      P.LANES.forEach((ln, li) => { const tr = P.forward(dose, ln, carbon, 100, u, o); for (let r = 0; r < nRep; r++) { const m = P.measure(tr, rng); rows.push({ lane: li, abs: MEAS.map((k) => Math.log10(Math.max(m[k], 1e-3))), dif: MEAS.map((k) => Math.log10(Math.max(m[k], 1e-3)) - Math.log10(Math.max(refMean[k], 1e-3))), water: Math.log10(Math.max(tr.water_left, 1e10)), m }); } }); });
    return rows;
  }
  return { forest, knnCV, dataset, MEAS };
})();
