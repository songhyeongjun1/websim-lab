/* SiCN 계면 시뮬레이터 — 물리 계층 (ml/model.py v5 · ml/mc.py · ml/nist.py 를 그대로 옮김)
   여기 숫자는 파이썬 원본과 같아야 한다. test_physics.mjs 가 대조한다.               */
(function (root) {
  'use strict';

  // ── 난수 (mulberry32 + Box–Muller) ─────────────────────────────
  function RNG(seed) { this.s = (seed >>> 0) || 1; this.spare = null; }
  RNG.prototype.u = function () {
    let t = (this.s += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.uniform = function (a, b) { return a + (b - a) * this.u(); };
  RNG.prototype.normal = function (m, s) {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return m + s * v; }
    let u1 = this.u(), u2 = this.u(); if (u1 < 1e-12) u1 = 1e-12;
    const r = Math.sqrt(-2 * Math.log(u1)); this.spare = r * Math.sin(2 * Math.PI * u2);
    return m + s * r * Math.cos(2 * Math.PI * u2);
  };
  RNG.prototype.exponential = function (mean) { return -mean * Math.log(1 - this.u()); };

  // ── 문헌값 ──────────────────────────────────────────────
  const LIT = {
    g_oh: 2.7, g_h: 0.6, ea_cond: 0.85, ub_min: 1.2, ub_max: 6.0,
    oh_sio2: 2.6e14, oh_sicn: 2.3e14,
    noise_esr: 0.10, noise_len: 0.04, noise_tds: 0.15, noise_sam: 0.12, noise_shear: 0.15,
  };
  const KB = 8.617e-5;
  const LANES = ['A', 'B', 'C', 'D1', 'D2'];
  const LANE_DESC = { A: 'X선 → 열처리', B: '열처리 → X선', C: '열처리 → X선 → 2차 열처리', D1: '열처리만 (조사 없음)', D2: '열처리 → 2차 열처리 (조사 없음)' };
  const C0 = 0.20, C_MIN = 0.14, C_MAX = 0.38, T_DEP_LOW = 180.0, L_REACT = 3.0;

  // ── 미지수 (v5) — 범위 + 출처 ──────────────────────────
  const UNK = {
    w0:        { lo: 3e14, hi: 2e15, ko: '계면에 갇힌 물', unit: 'cm⁻²', src: '[문헌] 친수 표면 물 1~4 분자층 (Tong&Gösele 1999 · Milekhin 2006), SiCN 물 방출은 SiO₂의 1/10 (Ebiko 2024) → 0.3~2 층' },
    db0:       { lo: 5e13, hi: 4e14, ko: '계면 미결합손 면밀도', unit: 'cm⁻²', src: '[문헌] Nagano 2023 ESR: 4.4e14 → 6.8e14 (N₂ 플라즈마), 증가분의 60 %+ 가 250 ℃에서 소모 → 계면이 쓰는 몫 1e14 대' },
    db_slope:  { lo: -0.30, hi: 0.60, ko: '탄소 10 %당 자리 변화', unit: '', src: '[문헌·부호 열림] UNIST 2025 MD −13 %/10 % vs Inoue 2019 실측 + · Kitagawa B(15.6 %) > A(16.9 %)' },
    g_corr:    { lo: 0.5, hi: 5.0, ko: '갇힌 물의 방사분해 수율 보정', unit: '×', src: '[문헌 방향] Le Caër 2011·Rotureau 2005: 나노공극 물의 H₂ 수율 2~10배 — OH 자료 없음' },
    kgy_to_ev: { lo: 2e11, hi: 7.5e11, ko: '1 kGy가 계면 단위면적에 넣는 에너지', unit: 'eV/cm²', src: '[유도] 6.24e11 eV/cm² per nm(물) × 물 0.3~1.2 nm' },
    a0:        { lo: 1.25e5, hi: 2.38e5, ko: '축합 반응 앞자리 상수', unit: 's⁻¹', src: '[문헌] Kitagawa 2025: 250 ℃·2 h 물 소모 완료, 200 ℃는 250의 55~78 % → 아레니우스로 좁힘' },
    sil0:      { lo: 0.8e14, hi: 2.3e14, ko: '접합 직후 기준 실라놀', unit: 'cm⁻²', src: '[문헌] 표면 수산기 — Nagano 2023 RBS 2.3e14 · UNIST MD 0.64~1.25e14' },
    c_pen:     { lo: 0.4, hi: 1.0, ko: '굳은 계면의 조사 효율', unit: '', src: '[미지] 문헌 없음' },
    ub_base:   { lo: 0.5, hi: 1.5, ko: '접합 직후 접합에너지', unit: 'J/m²', src: '[문헌] 플라즈마 활성 SiO₂ 0.5~1.5 · SiCN 0.67 J/m²' },
    ub_gain:   { lo: 0.10, hi: 0.25, ko: '실록산 1e13당 접합에너지', unit: 'J/m²', src: '[문헌 수준] 250 ℃·2 h 무조사가 2.2~5.2 J/m² (Inoue·Peng·Kitagawa·Nagano)에 들도록' },
    void_ref:  { lo: 2e14, hi: 1.2e15, ko: '보이드 기준 면밀도', unit: 'cm⁻²', src: '[미지·눈금] 단분자층 1e15 눈금 — 직접 잰 값 없음' },
    shear_k:   { lo: 6.0, hi: 20.0, ko: '접합에너지 → 다이 전단', unit: 'MPa per J/m²', src: '[문헌] Chidambaram 2021 (A*STAR): 유전체 >10 MPa, 고분자 ≥50 MPa at >2.5 J/m²' },
    tdep_k:    { lo: 0.2, hi: 0.8, ko: '저온 막의 미결합손·물 증가분', unit: '', src: '[문헌] Nagano 2020: 200 ℃ 막 밀도 −29 %, 산소 12.7 at% 흡수' },
    tdep_ub:   { lo: 0.20, hi: 0.45, ko: '저온 증착막의 접합에너지 손실', unit: '', src: '[문헌] Nagano 2020: 2.3 → 1.4 J/m² (−39 %) 한 점' },
    ox_cth:    { lo: 0.10, hi: 0.26, ko: '계면 SiO₂가 자라는 탄소 문턱', unit: '', src: '[미지] Kitagawa는 16 %에서도 SiCO 수 nm — 낮을 수 있다' },
    ox0:       { lo: 2.0, hi: 10.0, ko: '문턱 위 10 %당 산화막 두께', unit: 'nm', src: '[문헌] Inoue 2019 TEM: 250 ℃·2 h, C 25~32 %에서 ~10 nm · Kitagawa 수 nm' },
    ox_T:      { lo: 40.0, hi: 120.0, ko: '산화막 성장이 켜지는 온도 폭', unit: '℃', src: '[미지] 문헌 없음' },
    ox_block:  { lo: 1.5, hi: 20.0, ko: '물 통로를 63 % 막는 산화막 두께', unit: 'nm', src: '[문헌] Inoue: 10 nm 산화막에도 SAM 보이드 없음 vs 접합E는 낮음 — 두 읽기를 품는 폭' },
    abs_c:     { lo: 0.03, hi: 0.30, ko: '막이 축합수를 빨아들이는 특성 탄소', unit: '', src: '[미지] 논문 1은 SiCN(27 %) ≫ SiO₂(0 %)만 — 0~27 % 사이는 모름' },
    L_w:       { lo: 2.0, hi: 40.0, ko: '축합수가 SiCN을 파고드는 길이', unit: 'nm', src: '[미지] 문헌 없음 — Nagano 2023 막의 물 흡수 · Kitagawa PAS 계면 S값이 수십 nm에 걸침. 이중층의 생사' },
  };
  const UNK_KEYS = Object.keys(UNK);

  function drawUnknowns(rng) {
    const u = {};
    for (const k of UNK_KEYS) {
      const { lo, hi } = UNK[k];
      u[k] = (lo <= 0 || hi / lo < 20) ? rng.uniform(lo, hi) : Math.exp(rng.uniform(Math.log(lo), Math.log(hi)));
    }
    return u;
  }
  function midUnknowns() {
    const u = {};
    for (const k of UNK_KEYS) {
      const { lo, hi } = UNK[k];
      u[k] = (lo > 0 && hi / lo >= 20) ? Math.exp(0.5 * (Math.log(lo) + Math.log(hi))) : 0.5 * (lo + hi);
    }
    return u;
  }

  // ── 물리 ─────────────────────────────────────────────
  const isLow = (t) => t < 260.0 ? 1.0 : 0.0;
  const lowDep = (t, u) => 1.0 + u.tdep_k * isLow(t);
  const lowDepLoss = (t, u) => 1.0 - u.tdep_ub * isLow(t);
  function dbDensity(carbon, tnm, u, tdep) {
    return u.db0 * lowDep(tdep, u) * (1.0 + u.db_slope * (carbon - C0) / 0.10) * (1.0 + 0.15 * (tnm - 100) / 100);
  }
  function waterAreal(carbon, u, tdep) {
    return u.w0 * lowDep(tdep, u) * Math.max(1.0 - 0.35 * (carbon - C0) / 0.10, 0.15);
  }
  function ifaceCarbon(cb, ci, ts) {
    if (ci === null || ci === undefined || ts <= 0) return cb;
    return cb + (ci - cb) * (1.0 - Math.exp(-ts / L_REACT));
  }
  function absorbFrac(ceff, cb, ts, u) {
    const ai = 1.0 - Math.exp(-ceff / u.abs_c);
    if (ts <= 0 || cb === ceff) return ai;
    const ab = 1.0 - Math.exp(-cb / u.abs_c);
    return ai + (1.0 - ai) * Math.exp(-ts / u.L_w) * ab;
  }
  function oxideNm(carbon, Tc, u) {
    const excess = Math.max(carbon - u.ox_cth, 0) / 0.10;
    const warm = 1.0 - Math.exp(-Math.max(Tc - 100.0, 0) / u.ox_T);
    return u.ox0 * excess * warm;
  }
  function waterTrapped(siloxane, absorb, tox, u) {
    const block = 1.0 - Math.exp(-tox / u.ox_block);
    return siloxane * (block + (1.0 - block) * (1.0 - absorb));
  }
  function radicals(dose, carbon, u, tdep) {
    const w = waterAreal(carbon, u, tdep);
    const made = LIT.g_oh * u.g_corr * u.kgy_to_ev * dose;
    const frac = 1.0 - Math.exp(-made / Math.max(w, 1.0));
    const noh = w * frac;
    return [noh, noh * (LIT.g_h / LIT.g_oh)];
  }
  function annealFrac(Tc, minutes, u) {
    const k = u.a0 * Math.exp(-LIT.ea_cond / (KB * (Tc + 273.15)));
    return 1.0 - Math.exp(-k * minutes * 60.0);
  }
  const clip = (v, a, b) => Math.min(Math.max(v, a), b);

  /** 조건 하나 → 계면 상태 + 여섯 측정. o = {T:200, minutes:30, tdep:180, ci:null, ts:0} */
  function forward(dose, lane, carbon, tnm, u, o) {
    o = o || {};
    const T = o.T === undefined ? 200.0 : o.T, minutes = o.minutes === undefined ? 30.0 : o.minutes;
    const tdep = o.tdep === undefined ? T_DEP_LOW : o.tdep, ci = o.ci === undefined ? null : o.ci, ts = o.ts || 0.0;
    const cb = carbon;
    carbon = ifaceCarbon(cb, ci, ts);
    const absorb = absorbFrac(carbon, cb, ts, u);
    const db = dbDensity(carbon, tnm, u, tdep);
    const w = waterAreal(carbon, u, tdep);
    const baseSil = u.sil0 * Math.max(1.0 + u.db_slope * (carbon - C0) / 0.10, 0.2);
    let noh = 0, nh = 0;
    if (lane !== 'D1' && lane !== 'D2') [noh, nh] = radicals(dose, carbon, u, tdep);
    const want = noh + nh, take = Math.min(want, db);
    const silanol = baseSil + take * (noh / Math.max(want, 1.0));
    const sih = take * (nh / Math.max(want, 1.0));
    const dbLeft = db - take;
    const h2 = Math.max(nh - sih, 0) * 0.5;
    const fa = annealFrac(T, minutes, u), fb = fa;
    const made = silanol - baseSil;
    let siloxane, f;
    if (lane === 'A') { siloxane = (baseSil + made) * fa; f = fa; }
    else if (lane === 'B') { siloxane = baseSil * fa; f = fa; }
    else if (lane === 'C') { siloxane = baseSil * fa + made * fb * u.c_pen; f = 1 - (1 - fa) * (1 - fb); }
    else if (lane === 'D1') { siloxane = baseSil * fa; f = fa; }
    else { siloxane = baseSil * (1 - (1 - fa) * (1 - fb)); f = 1 - (1 - fa) * (1 - fb); }
    const h2Left = h2 * (1.0 - 0.6 * f);
    const tox = oxideNm(carbon, T, u) * (f > 0 ? 1 : 0);
    const wTrap = waterTrapped(siloxane, absorb, tox, u);
    const voidF = clip((h2Left + wTrap) / u.void_ref, 0, 0.95);
    const wLeft = Math.max(w - noh, 0) * (1.0 - f * absorb);
    let ub = (u.ub_base + u.ub_gain * siloxane / 1e13) * (1.0 - voidF);
    ub = clip(ub * lowDepLoss(tdep, u), 0.02, 12.0);
    return {
      db_left: dbLeft, silanol, siloxane, si_h: sih, h2: h2Left, water_left: wLeft,
      oxide_nm: tox, water_trap: wTrap, c_iface: carbon, absorb, base_silanol: baseSil, db, water0: w, anneal: f,
      dcb: ub, shear: ub * u.shear_k, esr: Math.max(dbLeft, db * 0.03), tds_h2o: wLeft, tds_h2: h2Left * 2.0, sam_void: voidF,
    };
  }
  function measure(t, rng) {
    const n = (v, s) => v * (1.0 + rng.normal(0, s));
    return { dcb: n(t.dcb, 4 * LIT.noise_len), shear: n(t.shear, LIT.noise_shear), esr: n(t.esr, LIT.noise_esr),
             tds_h2o: n(t.tds_h2o, LIT.noise_tds), tds_h2: n(t.tds_h2, LIT.noise_tds), sam_void: clip(n(t.sam_void, LIT.noise_sam), 0, 1) };
  }

  // ── 통계 도우미 ────────────────────────────────────────
  function median(a) { const s = Array.from(a).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; }
  function pct(a, q) { const s = Array.from(a).sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q / 100, i = Math.floor(p), r = p - i; return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * r; }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);

  // ── 광자 수송 (nist.py + mc.py) ─────────────────────────
  const SI = [[1e-3,1.570e3,1.567e3],[1.5e-3,5.355e2,5.331e2],[1.8389e-3,3.192e3,3.059e3],[2e-3,2.777e3,2.669e3],[3e-3,9.784e2,9.516e2],[4e-3,4.529e2,4.427e2],[5e-3,2.450e2,2.400e2],[6e-3,1.470e2,1.439e2],[8e-3,6.468e1,6.313e1],[1e-2,3.389e1,3.289e1],[1.5e-2,1.034e1,9.794],[2e-2,4.464,4.076],[3e-2,1.436,1.164],[4e-2,7.012e-1,4.782e-1],[5e-2,4.385e-1,2.430e-1],[6e-2,3.207e-1,1.434e-1],[8e-2,2.228e-1,6.896e-2],[1e-1,1.835e-1,4.513e-2],[1.5e-1,1.448e-1,3.086e-2],[2e-1,1.275e-1,2.905e-2],[3e-1,1.082e-1,2.932e-2],[4e-1,9.614e-2,2.968e-2],[5e-1,8.748e-2,2.971e-2],[6e-1,8.077e-2,2.951e-2],[8e-1,7.082e-2,2.875e-2],[1,6.361e-2,2.778e-2],[1.25,5.688e-2,2.652e-2],[1.5,5.183e-2,2.535e-2],[2,4.480e-2,2.345e-2]];
  const CT = [[1e-3,2.211e3,2.209e3],[1.5e-3,7.002e2,6.990e2],[2e-3,3.026e2,3.016e2],[3e-3,9.033e1,8.963e1],[4e-3,3.778e1,3.723e1],[5e-3,1.912e1,1.866e1],[6e-3,1.095e1,1.054e1],[8e-3,4.576,4.242],[1e-2,2.373,2.078],[1.5e-2,8.071e-1,5.627e-1],[2e-2,4.420e-1,2.238e-1],[3e-2,2.562e-1,6.614e-2],[4e-2,2.076e-1,3.343e-2],[5e-2,1.871e-1,2.397e-2],[6e-2,1.753e-1,2.098e-2],[8e-2,1.610e-1,2.037e-2],[1e-1,1.514e-1,2.147e-2],[1.5e-1,1.347e-1,2.449e-2],[2e-1,1.229e-1,2.655e-2],[3e-1,1.066e-1,2.870e-2],[4e-1,9.546e-2,2.950e-2],[5e-1,8.715e-2,2.969e-2],[6e-1,8.058e-2,2.956e-2],[8e-1,7.076e-2,2.885e-2],[1,6.361e-2,2.792e-2],[1.25,5.690e-2,2.669e-2],[1.5,5.179e-2,2.551e-2],[2,4.442e-2,2.345e-2]];
  const NT = [[1e-3,3.311e3,3.306e3],[1.5e-3,1.083e3,1.080e3],[2e-3,4.769e2,4.755e2],[3e-3,1.456e2,1.447e2],[4e-3,6.166e1,6.094e1],[5e-3,3.144e1,3.086e1],[6e-3,1.809e1,1.759e1],[8e-3,7.562,7.170],[1e-2,3.879,3.545],[1.5e-2,1.236,9.715e-1],[2e-2,6.178e-1,3.867e-1],[3e-2,3.066e-1,1.099e-1],[4e-2,2.288e-1,5.051e-2],[5e-2,1.980e-1,3.217e-2],[6e-2,1.817e-1,2.548e-2],[8e-2,1.639e-1,2.211e-2],[1e-1,1.529e-1,2.231e-2],[1.5e-1,1.353e-1,2.472e-2],[2e-1,1.233e-1,2.665e-2]];
  const RHO_SI = 2.33, RHO_SICN = 2.40, ME = 0.511, R0 = 2.818e-13, NA = 6.022e23;
  function interpTab(tab, e) {
    e = clip(e, tab[0][0], tab[tab.length - 1][0]);
    const le = Math.log(e);
    let i = 0; while (i < tab.length - 2 && Math.log(tab[i + 1][0]) < le) i++;
    const x0 = Math.log(tab[i][0]), x1 = Math.log(tab[i + 1][0]), t = x1 > x0 ? (le - x0) / (x1 - x0) : 0;
    const f = (c) => Math.exp(Math.log(tab[i][c]) + t * (Math.log(tab[i + 1][c]) - Math.log(tab[i][c])));
    return [f(1), f(2)];
  }
  function sicnMu(e, wsi, wc, wn) {
    wsi = wsi === undefined ? 0.55 : wsi; wc = wc === undefined ? 0.15 : wc; wn = wn === undefined ? 0.30 : wn;
    const a = interpTab(SI, e), b = interpTab(CT, e), c = interpTab(NT, e);
    return [wsi * a[0] + wc * b[0] + wn * c[0], wsi * a[1] + wc * b[1] + wn * c[1]];
  }
  function knTotal(e) {
    const k = e / ME;
    const t1 = (1 + k) / (k * k) * (2 * (1 + k) / (1 + 2 * k) - Math.log(1 + 2 * k) / k);
    const t2 = Math.log(1 + 2 * k) / (2 * k), t3 = -(1 + 3 * k) / ((1 + 2 * k) * (1 + 2 * k));
    return 2 * Math.PI * R0 * R0 * (t1 + t2 + t3);
  }
  function muSet(e, mat) {
    const rho = mat === 'si' ? RHO_SI : RHO_SICN, za = mat === 'si' ? 14.0 / 28.086 : 0.50;
    const [mr, mer] = mat === 'si' ? interpTab(SI, e) : sicnMu(e);
    const mt = mr * rho, men = mer * rho, mc = Math.min(knTotal(e) * (za * rho * NA), mt * 0.999);
    return [mt, mc, mt - mc, men];
  }
  function knSample(e, rng) {
    const k = e / ME;
    for (;;) {
      const ct = rng.uniform(-1, 1), ratio = 1.0 / (1.0 + k * (1 - ct));
      const p = ratio * ratio * (ratio + 1.0 / ratio - (1 - ct * ct));
      if (rng.uniform(0, 2.0) < p) return [ct, e * ratio];
    }
  }
  function kramers(kvp, rng, n, cutoff) {
    cutoff = cutoff === undefined ? 12.0 : cutoff;
    const m = 400, es = [], ws = []; let tot = 0;
    for (let i = 0; i < m; i++) { const e = cutoff + (kvp - cutoff) * i / (m - 1); const w = Math.max((kvp - e) / e, 0); es.push(e); ws.push(w); tot += w; }
    const cdf = []; let acc = 0; for (let i = 0; i < m; i++) { acc += ws[i] / tot; cdf.push(acc); }
    const out = [];
    for (let j = 0; j < n; j++) { const r = rng.u(); let i = 0; while (i < m - 1 && cdf[i] < r) i++; out.push(es[i] / 1000.0); }
    return out;
  }
  function transport(energies, layers, rng, edges, keepPaths) {
    // layers: [['si', 500], ['sicn', 0.2], ['si', 725]] (µm)
    const ledges = [0]; for (const l of layers) ledges.push(ledges[ledges.length - 1] + l[1]);
    const total = ledges[ledges.length - 1];
    const tally = new Array(edges.length - 1).fill(0);
    const paths = [];
    const matAt = (z) => { for (let i = 0; i < layers.length; i++) if (z >= ledges[i] && z < ledges[i + 1]) return [layers[i][0], ledges[i], ledges[i + 1]]; return [null, null, null]; };
    const score = (z0, z1, e, muen, invc) => {
      const a = Math.min(z0, z1), b = Math.max(z0, z1);
      let i0 = 0; while (i0 < edges.length - 1 && edges[i0 + 1] <= a) i0++;
      for (let i = i0; i < tally.length; i++) { if (edges[i] >= b) break; const ov = Math.min(b, edges[i + 1]) - Math.max(a, edges[i]); if (ov > 0) tally[i] += e * muen * (ov * 1e-4) * invc; }
    };
    for (let p = 0; p < energies.length; p++) {
      let z = 1e-9, cosd = 1.0, e = energies[p];
      const path = keepPaths ? [[z, e, 0]] : null;
      for (let step = 0; step < 80; step++) {
        const [m, lo, hi] = matAt(cosd > 0 ? z : z - 1e-9);
        if (m === null || e < 0.002) break;
        const [mt, mc, mpe, men] = muSet(e, m);
        const s = rng.exponential(1.0 / mt), dz = cosd * s * 1e4, zhit = z + dz;
        const zedge = cosd > 0 ? hi : lo;
        if ((cosd > 0 && zhit > zedge) || (cosd < 0 && zhit < zedge)) {
          score(z, zedge, e, men, 1.0 / Math.abs(cosd));
          z = zedge + (cosd > 0 ? 1e-9 : -1e-9);
          if (path) path.push([z, e, 0]);
          if (z <= 0 || z >= total) break;
          continue;
        }
        score(z, zhit, e, men, 1.0 / Math.abs(cosd));
        z = zhit;
        if (rng.u() < mpe / mt) { if (path) path.push([z, e, 2]); break; }
        const [ct, e2] = knSample(e, rng); e = e2;
        const phi = rng.uniform(0, 2 * Math.PI), st = Math.sqrt(Math.max(0, 1 - ct * ct)), sd = Math.sqrt(Math.max(0, 1 - cosd * cosd));
        cosd = clip(cosd * ct + sd * st * Math.cos(phi), -1, 1);
        if (Math.abs(cosd) < 1e-3) cosd = 1e-3 * (cosd < 0 ? -1 : 1);
        if (path) path.push([z, e, 1]);
      }
      if (path) paths.push(path);
    }
    const mass = new Array(tally.length).fill(0);
    for (let i = 0; i < tally.length; i++) for (let j = 0; j < layers.length; j++) {
      const ov = Math.max(0, Math.min(edges[i + 1], ledges[j + 1]) - Math.max(edges[i], ledges[j]));
      if (ov > 0) mass[i] += ov * 1e-4 * (layers[j][0] === 'si' ? RHO_SI : RHO_SICN);
    }
    return { tally, mass, paths };
  }
  /** 관전압·상부 Si 두께·차단 에너지 → 깊이–선량, 계면 도달률 */
  function depthDose(kvp, topUm, n, cutoff, seed, keepPaths) {
    n = n || 3000; cutoff = cutoff === undefined ? 12.0 : cutoff;
    const rng = new RNG(seed === undefined ? 1 : seed);
    const es = kramers(kvp, rng, n, cutoff);
    const nb = 40, film = 0.2, edges = [];
    for (let i = 0; i <= nb; i++) edges.push(topUm * i / nb);
    edges.push(topUm + film); edges.push(topUm + film + 725.0);
    const layers = [['si', topUm], ['sicn', film], ['si', 725.0]];
    const r = transport(es, layers, rng, edges, keepPaths);
    const dose = r.tally.map((t, i) => t / Math.max(r.mass[i], 1e-15));
    const centers = []; for (let i = 0; i < edges.length - 1; i++) centers.push(0.5 * (edges[i] + edges[i + 1]));
    const frac = dose[nb] / Math.max(dose[0], 1e-15);
    return { centers, dose, frac, edges, paths: r.paths, energies: es, total: topUm + film + 725.0 };
  }

  // ── 검정력 (power.py) ───────────────────────────────────
  const TT = { 0.05: [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042],
    0.01: [null, 63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.250, 3.169, 3.106, 3.055, 3.012, 2.977, 2.947, 2.921, 2.898, 2.878, 2.861, 2.845, 2.831, 2.819, 2.807, 2.797, 2.787, 2.779, 2.771, 2.763, 2.756, 2.750],
    0.10: [null, 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697] };
  const ZINF = { 0.05: 1.96, 0.01: 2.576, 0.10: 1.645 };
  const tCrit = (df, alpha) => { const a = alpha || 0.05; const tab = TT[a] || TT[0.05]; return df >= 30 ? ZINF[a] + 2.5 / df : tab[Math.max(1, Math.round(df))]; };
  const LOT_KEYS = ['db0', 'w0', 'sil0'];
  function lot(u, rng, sigma) { const v = Object.assign({}, u); for (const k of LOT_KEYS) v[k] = u[k] * Math.exp(rng.normal(0, sigma)); return v; }
  function cond(carbon, T, tdep, ci, ts, minutes) { return { carbon, T: T === undefined ? 200 : T, tdep: tdep === undefined ? 180 : tdep, ci: ci === undefined ? null : ci, ts: ts || 0, minutes: minutes === undefined ? 30 : minutes }; }
  const fwdC = (dose, lane, c, tnm, u) => forward(c.dose === undefined ? dose : c.dose, c.lane || lane, c.carbon, tnm, u, { T: c.T, minutes: c.minutes, tdep: c.tdep, ci: c.ci, ts: c.ts });
  function runOnce(conds, contrast, nWafer, nRep, meas, u, rng, sigmaLot, dose, lane) {
    const key = (c) => [c.carbon, c.tdep, c.ci, c.ts].join('|');
    const groups = new Map();
    conds.forEach((c, i) => { const k = key(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    let est = 0, vr = 0, df = 0;
    for (const [, cis] of groups) {
      if (cis.every((ci) => contrast[ci] === 0)) continue;
      const v = [];
      for (let w = 0; w < nWafer; w++) {
        const lu = lot(u, rng, sigmaLot); let s = 0;
        for (const ci of cis) { const tr = fwdC(dose, lane, conds[ci], 100, lu); let acc = 0; for (let r = 0; r < nRep; r++) acc += measure(tr, rng)[meas]; s += contrast[ci] * acc / nRep; }
        v.push(s);
      }
      const m = mean(v); est += m;
      if (nWafer >= 2) { let ss = 0; for (const x of v) ss += (x - m) * (x - m); vr += ss / (nWafer - 1) / nWafer; df += nWafer - 1; }
    }
    if (df <= 0) return null;
    const tv = conds.map((c) => fwdC(dose, lane, c, 100, u)[meas]);
    let tru = 0; for (let i = 0; i < tv.length; i++) tru += contrast[i] * tv[i];
    return { tru, est, t: est / Math.max(Math.sqrt(vr), 1e-30), df, level: mean(tv) };
  }
  function power(conds, contrast, nWafer, nRep, meas, worlds, sigmaLot, seed, relMin, dose, lane, alpha, drawFn, detail) {
    const rng = new RNG(seed || 2); let hit = 0, miss = 0, wrong = 0, fp = 0, nul = 0; const rows = [];
    for (let w = 0; w < worlds; w++) {
      const u = drawFn ? drawFn(rng) : drawUnknowns(rng);
      const r = runOnce(conds, contrast, nWafer, nRep, meas, u, rng, sigmaLot, dose === undefined ? 30 : dose, lane || 'A');
      if (!r || !isFinite(r.t)) continue;
      const rej = Math.abs(r.t) > tCrit(r.df, alpha);
      const eff = Math.abs(r.tru) / Math.max(Math.abs(r.level), 1e-12); const isNull = Math.abs(r.tru) < relMin * r.level;
      if (detail) rows.push({ eff, rej, ok: rej && Math.sign(r.est) === Math.sign(r.tru), isNull, df: r.df, t: r.t });
      if (isNull) { nul++; if (rej) fp++; continue; }
      if (!rej) miss++; else if (Math.sign(r.est) === Math.sign(r.tru)) hit++; else wrong++;
    }
    const n = hit + miss + wrong;
    return { power: hit / Math.max(n, 1), wrong: wrong / Math.max(n, 1), miss: miss / Math.max(n, 1), fp: fp / Math.max(nul, 1), n_eff: n, n_null: nul, rows };
  }

  root.PHYS = { RNG, LIT, KB, LANES, LANE_DESC, C0, C_MIN, C_MAX, T_DEP_LOW, L_REACT, UNK, UNK_KEYS, drawUnknowns, midUnknowns,
    forward, measure, annealFrac, oxideNm, ifaceCarbon, absorbFrac, median, pct, mean,
    depthDose, kramers, sicnMu, interpTab, SI, CT, NT, muSet,
    cond, power, tCrit };
})(typeof window !== 'undefined' ? window : globalThis);
