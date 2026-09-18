/* SiCN 접합 계면 X선 시뮬레이터 — 화면 계층 v2. 계산은 physics.js(PHYS) 에만 있다. */
(function () {
  'use strict';
  const P = window.PHYS;
  const $ = (id) => document.getElementById(id);
  const DOSES = [0, 3, 10, 20, 30, 50, 70, 100, 200, 300, 600, 1000];
  const CI = [0.14, 0.18, 0.22, 0.26, 0.30, 0.34], TS = [2, 5, 10, 20, 40];
  const MEAS = [['sam_void', '초음파 보이드'], ['tds_h2o', '열탈착 물'], ['shear', '전단 시험'], ['dcb', '균열 시험']];
  const LANE_KO = { A: 'A — X선 → 열처리', B: 'B — 열처리 → X선', C: 'C — 열처리 → X선 → 2차 열처리', D1: 'D1 — 열처리만 (무조사)', D2: 'D2 — 열처리 두 번 (무조사)' };
  const S = { kvp: 100, top: 500, cut: 12, rate: 36, cb: 0.38, shell: 1, ci: 0.14, ts: 5, tdep: 350, T: 250, min: 120, doseIdx: 4, lane: 'A',
              nw: 3, nr: 4, slot: 0.15, rmin: 0.08, alpha: 0.05, worldsN: 400, seed: 7, mapMetric: 'void', panel: 'intro', pred: 3, mlw: 200, mlt: 30, mlr: 2 };
  const PINS = {};
  const dirty = {}; const allDirty = () => ['intro', 'beam', 'film', 'iface', 'cross', 'exp', 'out', 'ml'].forEach((k) => { dirty[k] = 1; }); allDirty();
  const keyRows = (title, rows, note) => `<div class="t">${title}</div>` + rows.map((r) => `<div class="r${r.show ? ' show' : ''}"><i class="${r.dot ? 'dot' : ''}" style="background:${r.c};${r.border ? 'border:1.5px solid ' + r.border + ';' : ''}"></i><span><b>${r.b}</b>${r.s ? `<small>${r.s}</small>` : ''}</span></div>`).join('') + (note ? `<div class="note">${note}</div>` : '');
  const badge = (id, label, big) => { const el = $(id); if (el) el.innerHTML = big ? `${label}<b>${big}</b>` : ''; };

  // ── 도우미 ─────────────────────────────────────────────
  const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const f = (x, d) => (isFinite(x) ? x.toFixed(d === undefined ? 2 : d) : '–');
  const pc = (x, d) => (isFinite(x) ? (100 * x).toFixed(d || 0) + ' %' : '–');
  const sup = (n) => String(n).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  const sci = (x) => { if (!isFinite(x) || x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); return f(x / Math.pow(10, e), 1) + '×10' + sup(e); };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const dose = () => DOSES[S.doseIdx];
  const rateGyS = () => (S.rate > 0 ? S.rate : 10 / 60);        // 0 = 보수적 10 Gy/min
  const filmOpt = (o) => Object.assign({ T: S.T, minutes: S.min, tdep: S.tdep, ci: S.shell ? S.ci : null, ts: S.shell ? S.ts : 0 }, o || {});
  let nFwd = 0; const fwd = (d, lane, carbon, u, o) => { nFwd++; return P.forward(d, lane, carbon, 100, u, filmOpt(o)); };
  const U0 = P.midUnknowns();
  const med = P.median, q = P.pct, mean = P.mean; const stat = (a) => ({ m: med(a), lo: q(a, 25), hi: q(a, 75) });
  const se = (p, n) => 100 * Math.sqrt(Math.max(p * (1 - p), 0) / Math.max(n, 1)); const pcse = (p, n) => `${pc(p)} ±${se(p, n).toFixed(1)}`;
  function lerpHex(a, b, t) { const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16)); return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  const filmColor = (c) => lerpHex(tok('--sicn-lo'), tok('--sicn'), Math.min(1, Math.max(0, (c - 0.14) / 0.24)));
  // 세상 (미지수 재추첨) — 못 박기 반영
  let Wc = null, quick = false; const QUICK_N = 150;
  function pinRanges(extra) { const R = {}; const pins = Object.assign({}, PINS, extra || {}); for (const k of P.UNK_KEYS) { const u = P.UNK[k]; let lo = u.lo, hi = u.hi; const p = pins[k]; if (p) { if (u.lo > 0) { lo = Math.max(u.lo, p.v * (1 - p.tol)); hi = Math.min(u.hi, p.v * (1 + p.tol)); } else { const w = (u.hi - u.lo) * p.tol; lo = Math.max(u.lo, p.v - w); hi = Math.min(u.hi, p.v + w); } if (hi <= lo) hi = lo + 1e-9; } R[k] = [lo, hi]; } return R; }
  function drawWith(rng, R) { const u = {}; for (const k of P.UNK_KEYS) { const [lo, hi] = R[k]; u[k] = (lo <= 0 || hi / lo < 20) ? rng.uniform(lo, hi) : Math.exp(rng.uniform(Math.log(lo), Math.log(hi))); } return u; }
  function worlds() { const want = quick ? Math.min(S.worldsN, QUICK_N) : S.worldsN; const pk = JSON.stringify(PINS); if (!Wc || Wc.seed !== S.seed || Wc.pk !== pk) Wc = { seed: S.seed, pk, rng: new P.RNG(S.seed), arr: [], R: pinRanges() }; while (Wc.arr.length < want) Wc.arr.push(drawWith(Wc.rng, Wc.R)); return Wc.arr.length === want ? Wc.arr : Wc.arr.slice(0, want); }
  function worldsWith(extra, n, seed) { const R = pinRanges(extra); const rng = new P.RNG(seed || 99); const a = []; for (let i = 0; i < n; i++) a.push(drawWith(rng, R)); return a; }

  // ── SVG 차트 원시 (옛 화면의 톤 — 남색 선 · 옅은 격자) ─────────────
  const T = () => ({ ink: tok('--ink'), ink2: tok('--ink2'), mute: tok('--mute'), mute2: tok('--mute2'), line: tok('--line'), line2: tok('--line2'), navy: tok('--navy'), navy2: tok('--navy2'), gold: tok('--gold'), gold2: tok('--gold2'), red: tok('--red'), blue: tok('--blue'), green: tok('--green'), grey: tok('--grey'), bg: tok('--surf'), surf2: tok('--surf2') });
  const txt = (x, y, s, o) => { o = o || {}; return `<text x="${x}" y="${y}" font-size="${o.fs || 11}" fill="${o.fill || T().mute}" text-anchor="${o.a || 'start'}" font-family="var(--sans)" font-weight="${o.w || 500}" ${o.rot ? `transform="rotate(${o.rot} ${x} ${y})"` : ''}>${esc(s)}</text>`; };
  const svgWrap = (w, h, inner, aria) => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria || '')}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  function ticksNice(lo, hi, n) { const span = hi - lo || 1; const raw = span / (n || 5); const mag = Math.pow(10, Math.floor(Math.log10(raw))); const norm = raw / mag; const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag; const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10)); return t; }
  const tw = (s) => { let w = 0; for (const ch of String(s)) w += /[가-힯一-鿿]/.test(ch) ? 11 : /[0-9]/.test(ch) ? 6.6 : /[ .·%]/.test(ch) ? 3.5 : 6.2; return w; };
  function lineChart(series, band, o) {
    o = o || {}; const c = T(); const W = o.w || 520, H = o.h || 250, ml = o.ml || 48, mr = o.mr || (series.some((s) => s.label) ? Math.max(...series.map((s) => (s.label ? tw(s.label) + 16 : 12))) : 14), mt = 14, mb = 38; const iw = W - ml - mr, ih = H - mt - mb;
    const xs = series.flatMap((s) => s.x), ys = series.flatMap((s) => s.y).concat(band ? band.hi.concat(band.lo) : []);
    const xlo = o.xlo !== undefined ? o.xlo : Math.min(...xs), xhi = o.xhi !== undefined ? o.xhi : Math.max(...xs); const ylo = o.ylo !== undefined ? o.ylo : 0, yhi = o.yhi !== undefined ? o.yhi : Math.max(...ys) * 1.08 || 1;
    const lx = (v) => Math.log10(Math.max(v, o.xmin || 1e-9)); const X = (v) => ml + (o.xlog ? (lx(v) - lx(xlo)) / (lx(xhi) - lx(xlo)) : (v - xlo) / (xhi - xlo || 1)) * iw;
    const Y = (v) => mt + ih - (o.ylog ? (Math.log10(v) - Math.log10(ylo)) / (Math.log10(yhi) - Math.log10(ylo)) : (v - ylo) / (yhi - ylo || 1)) * ih;
    let s = `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="${c.surf2}"/>`;
    const yt = o.ylog ? (() => { const t = []; for (let e = Math.floor(Math.log10(ylo)); e <= Math.ceil(Math.log10(yhi)); e++) t.push(Math.pow(10, e)); return t.filter((v) => v >= ylo && v <= yhi); })() : ticksNice(ylo, yhi, 4);
    yt.forEach((t) => { s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="${c.line}"/>` + txt(ml - 6, Y(t) + 4, o.yfmt ? o.yfmt(t) : t, { a: 'end', fs: 10.5 }); });
    (o.xticks || ticksNice(xlo, xhi, 5)).forEach((t) => { s += `<line x1="${X(t)}" x2="${X(t)}" y1="${mt}" y2="${mt + ih}" stroke="${c.line}"/>` + txt(X(t), H - mb + 15, o.xfmt ? o.xfmt(t) : t, { a: 'middle', fs: 10.5 }); });
    if (band) { let d = ''; band.x.forEach((x, i) => { d += (i ? 'L' : 'M') + X(x) + ',' + Y(band.hi[i]); }); for (let i = band.x.length - 1; i >= 0; i--) d += 'L' + X(band.x[i]) + ',' + Y(band.lo[i]); s += `<path d="${d}Z" fill="${band.color}" opacity=".18"/>`; }
    const labels = [];
    series.forEach((sr) => { let d = ''; sr.x.forEach((x, i) => { d += (i ? 'L' : 'M') + X(x) + ',' + Y(sr.y[i]); }); if (sr.fill) s += `<path d="${d}L${X(sr.x[sr.x.length - 1])},${Y(ylo)}L${X(sr.x[0])},${Y(ylo)}Z" fill="${sr.color}" opacity=".12"/>`; s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 2}" stroke-linejoin="round" ${sr.dash ? 'stroke-dasharray="5 4"' : ''} opacity="${sr.dim ? .55 : 1}"/>`; if (sr.label) { const n = sr.x.length - 1; labels.push({ y: Y(sr.y[n]) + 4, t: sr.label, c: sr.color }); } });
    labels.sort((a, b) => a.y - b.y); for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    labels.forEach((l) => { s += txt(W - mr + 5, l.y, l.t, { fs: 11, fill: l.c, w: 700 }); });
    (o.marks || []).forEach((m) => { s += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="5" fill="${m.color}" stroke="${c.bg}" stroke-width="2"/>`; if (m.label) s += txt(X(m.x) + (m.left ? -9 : 9), Y(m.y) - 8, m.label, { a: m.left ? 'end' : 'start', fs: 11.5, fill: m.color, w: 700 }); });
    (o.vlines || []).forEach((v) => { s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${mt}" y2="${mt + ih}" stroke="${v.color || c.ink}" stroke-width="1.4" ${v.dash ? 'stroke-dasharray="4 3"' : ''}/>`; if (v.label) s += txt(X(v.x) + 5, mt + 12, v.label, { fs: 11, fill: v.color || c.ink, w: 700 }); });
    (o.hlines || []).forEach((v) => { s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v.y)}" y2="${Y(v.y)}" stroke="${v.color || c.mute}" stroke-dasharray="4 3"/>`; if (v.label) s += txt(ml + 6, Y(v.y) - 4, v.label, { fs: 10.5, fill: v.color || c.mute }); });
    s += `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="none" stroke="${c.line2}"/>`;
    if (o.xlabel) s += txt(ml + iw / 2, H - 5, o.xlabel, { a: 'middle', fs: 11, fill: c.ink2 }); if (o.ylabel) s += txt(12, mt + ih / 2, o.ylabel, { a: 'middle', fs: 11, fill: c.ink2, rot: -90 });
    return svgWrap(W, H, s, o.aria);
  }
  function groupedBars(groups, o) {
    o = o || {}; const W = o.w || 520, H = o.h || 220, ml = 46, mr = 10, mt = 16, mb = 38; const c = T();
    let vmax = 0; groups.forEach((g) => g.bars.forEach((b) => { vmax = Math.max(vmax, b.hi || b.v || 0); })); vmax = o.vmax || vmax * 1.15 || 1;
    const iw = W - ml - mr, ih = H - mt - mb, gw = iw / groups.length; const y = (v) => mt + ih - (v / vmax) * ih;
    let s = `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="${c.surf2}"/>`;
    ticksNice(0, vmax, 4).forEach((t) => { s += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="${c.line}"/>` + txt(ml - 6, y(t) + 4, o.fmt ? o.fmt(t) : t, { a: 'end', fs: 10.5 }); });
    groups.forEach((g, gi) => { const n = g.bars.length, bw = Math.min(40, (gw - 18) / n), x0 = ml + gw * gi + (gw - bw * n) / 2;
      g.bars.forEach((b, bi) => { const x = x0 + bw * bi; const v = b.v || 0; s += `<rect x="${x + 2}" y="${y(v)}" width="${bw - 4}" height="${Math.max(0, y(0) - y(v))}" fill="${b.color}" opacity="${b.dim ? .45 : 1}"/>`;
        if (isFinite(b.lo) && isFinite(b.hi)) s += `<line x1="${x + bw / 2}" x2="${x + bw / 2}" y1="${y(b.lo)}" y2="${y(b.hi)}" stroke="${c.ink}" stroke-width="1.3"/><line x1="${x + bw / 2 - 5}" x2="${x + bw / 2 + 5}" y1="${y(b.hi)}" y2="${y(b.hi)}" stroke="${c.ink}" stroke-width="1.3"/><line x1="${x + bw / 2 - 5}" x2="${x + bw / 2 + 5}" y1="${y(b.lo)}" y2="${y(b.lo)}" stroke="${c.ink}" stroke-width="1.3"/>`;
        if (b.label) s += txt(x + bw / 2, y(Math.max(v, b.hi || 0)) - 6, b.label, { a: 'middle', fs: 11, fill: c.ink, w: 700 }); });
      s += txt(ml + gw * gi + gw / 2, H - 18, g.label, { a: 'middle', fs: 11.5, fill: c.ink2, w: 700 }); if (g.sub) s += txt(ml + gw * gi + gw / 2, H - 5, g.sub, { a: 'middle', fs: 10.5 }); });
    s += `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="none" stroke="${c.line2}"/>`;
    if (o.ylabel) s += txt(12, mt + ih / 2, o.ylabel, { a: 'middle', fs: 11, fill: c.ink2, rot: -90 });
    return svgWrap(W, H, s, o.aria);
  }
  function heatmap(rows, cols, Z, o) {
    o = o || {}; const c = T(); const W = o.w || 520, ml = 54, mt = o.ylabel ? 22 : 8, mr = 10, mb = 36; const cw = (W - ml - mr) / cols.length, ch = o.ch || 30, H = mt + ch * rows.length + mb;
    const vals = Z.flat().filter(isFinite); const lo = o.vmin !== undefined ? o.vmin : Math.min(...vals), hi = o.vmax !== undefined ? o.vmax : Math.max(...vals); const base = o.base || c.navy; let s = '';
    rows.forEach((r, i) => cols.forEach((col, j) => { const v = Z[i][j]; const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0; const fill = lerpHex(c.surf2, base, 0.05 + 0.95 * t); const x = ml + cw * j, y = mt + ch * i;
      s += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" fill="${fill}"/>` + txt(x + cw / 2, y + ch / 2 + 4, o.fmt ? o.fmt(v) : f(v, 2), { a: 'middle', fs: 11.5, fill: t > 0.5 ? '#fff' : c.ink, w: 700 });
      if (o.mark && o.mark(i, j)) s += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${cw - 3}" height="${ch - 3}" fill="none" stroke="${c.gold}" stroke-width="3"/>`; }));
    rows.forEach((r, i) => { s += txt(ml - 8, mt + ch * i + ch / 2 + 4, r, { a: 'end', fs: 11, fill: c.ink2, w: 700 }); });
    cols.forEach((col, j) => { s += txt(ml + cw * j + cw / 2, mt + ch * rows.length + 14, col, { a: 'middle', fs: 11, fill: c.ink2, w: 700 }); });
    if (o.xlabel) s += txt(W - mr, H - 3, o.xlabel, { a: 'end', fs: 10.5 }); if (o.ylabel) s += txt(ml - 8, 12, o.ylabel, { a: 'end', fs: 10.5 });
    return svgWrap(W, H, s, o.aria);
  }
  function hbars(items, o) {
    o = o || {}; const c = T(); const W = o.w || 520, ml = o.ml || 120, mr = 70, rh = o.rh || 24, H = items.length * rh + 10; const vmax = o.vmax || Math.max(...items.map((i) => Math.max(i.v, i.ref || 0))) * 1.05 || 1; const iw = W - ml - mr;
    let s = ''; items.forEach((it, i) => { const y = 5 + rh * i; s += txt(ml - 8, y + rh / 2 + 4, it.label, { a: 'end', fs: 11.5, fill: c.ink2 });
      if (isFinite(it.ref)) s += `<rect x="${ml}" y="${y + 3}" width="${Math.max(0, (it.ref / vmax) * iw)}" height="${rh - 6}" fill="${it.color || c.navy}" opacity=".25"/>`;
      s += `<rect x="${ml}" y="${y + 6}" width="${Math.max(0, (it.v / vmax) * iw)}" height="${rh - 12}" fill="${it.color || c.navy}"/>`; if (isFinite(it.mark)) s += `<line x1="${ml + (it.mark / vmax) * iw}" x2="${ml + (it.mark / vmax) * iw}" y1="${y + 1}" y2="${y + rh - 1}" stroke="${c.ink}" stroke-width="2"/>`; s += txt(ml + (Math.max(it.v, it.ref || 0, it.mark || 0) / vmax) * iw + 6, y + rh / 2 + 4, it.text || f(it.v), { fs: 11, fill: c.ink, w: 700 }); });
    return svgWrap(W, H, s, o.aria);
  }
  function scatter(pts, o) {
    o = o || {}; const c = T(); const W = o.w || 520, H = o.h || 250, ml = 50, mr = 14, mt = 16, mb = 38; const iw = W - ml - mr, ih = H - mt - mb;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); const xlo = o.xlo !== undefined ? o.xlo : Math.min(...xs), xhi = o.xhi !== undefined ? o.xhi : Math.max(...xs); const ylo = o.ylo !== undefined ? o.ylo : Math.min(...ys), yhi = o.yhi !== undefined ? o.yhi : Math.max(...ys);
    const X = (v) => ml + (o.xlog ? (Math.log10(v) - Math.log10(xlo)) / (Math.log10(xhi) - Math.log10(xlo)) : (v - xlo) / (xhi - xlo || 1)) * iw; const Y = (v) => mt + ih - (o.ylog ? (Math.log10(v) - Math.log10(ylo)) / (Math.log10(yhi) - Math.log10(ylo)) : (v - ylo) / (yhi - ylo || 1)) * ih;
    let s = `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="${c.surf2}"/>`;
    (o.yticks || ticksNice(ylo, yhi, 4)).forEach((t) => { if (t < ylo || t > yhi) return; s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(t)}" y2="${Y(t)}" stroke="${c.line}"/>` + txt(ml - 6, Y(t) + 4, o.yfmt ? o.yfmt(t) : t, { a: 'end', fs: 10.5 }); });
    (o.xticks || ticksNice(xlo, xhi, 5)).forEach((t) => { if (t < xlo || t > xhi) return; s += `<line x1="${X(t)}" x2="${X(t)}" y1="${mt}" y2="${mt + ih}" stroke="${c.line}"/>` + txt(X(t), H - mb + 15, o.xfmt ? o.xfmt(t) : t, { a: 'middle', fs: 10.5 }); });
    if (o.hline !== undefined) s += `<line x1="${ml}" x2="${W - mr}" y1="${Y(o.hline)}" y2="${Y(o.hline)}" stroke="${c.ink2}" stroke-dasharray="4 3"/>`;
    pts.forEach((p) => { s += `<circle cx="${X(p.x)}" cy="${Y(Math.min(Math.max(p.y, ylo), yhi))}" r="${o.r || 2.8}" fill="${o.color ? o.color(p.c) : c.navy}" opacity=".7"/>`; });
    (o.vlines || []).forEach((v) => { s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${mt}" y2="${mt + ih}" stroke="${v.color || c.gold}" stroke-width="2"/>`; if (v.label) s += txt(X(v.x) + 5, mt + 12, v.label, { fs: 11, fill: v.color || c.gold2, w: 700 }); });
    if (o.trend) { let d = ''; o.trend.forEach((pt, i) => { d += (i ? 'L' : 'M') + X(pt[0]) + ',' + Y(pt[1]); }); s += `<path d="${d}" fill="none" stroke="${c.bg}" stroke-width="5"/><path d="${d}" fill="none" stroke="${c.ink}" stroke-width="2.2"/>`; o.trend.forEach((pt) => { s += `<circle cx="${X(pt[0])}" cy="${Y(pt[1])}" r="4" fill="${c.ink}" stroke="${c.bg}" stroke-width="2"/>`; }); }
    s += `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="none" stroke="${c.line2}"/>`;
    if (o.xlabel) s += txt(ml + iw / 2, H - 5, o.xlabel, { a: 'middle', fs: 11, fill: c.ink2 }); if (o.ylabel) s += txt(12, mt + ih / 2, o.ylabel, { a: 'middle', fs: 11, fill: c.ink2, rot: -90 });
    if (o.cbar) { const x0 = W - mr - 130; for (let i = 0; i < 24; i++) s += `<rect x="${x0 + i * 4}" y="${mt + 5}" width="4" height="7" fill="${o.color(i / 23)}"/>`; s += txt(x0 - 4, mt + 12, o.cbar[0], { a: 'end', fs: 10 }) + txt(x0 + 100, mt + 12, o.cbar[1], { fs: 10 }); }
    return svgWrap(W, H, s, o.aria);
  }
  function histogram(edges, counts, o) {
    o = o || {}; const c = T(); const W = o.w || 520, H = o.h || 230, ml = 44, mr = 12, mt = 16, mb = 38; const iw = W - ml - mr, ih = H - mt - mb; const cmax = Math.max(...counts, 1);
    const X = (v) => ml + (v - edges[0]) / (edges[edges.length - 1] - edges[0]) * iw; const Y = (v) => mt + ih - (v / cmax) * ih;
    let s = `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="${c.surf2}"/>`;
    counts.forEach((n, i) => { s += `<rect x="${X(edges[i]) + 1}" y="${Y(Math.max(n, 0))}" width="${Math.max(0, X(edges[i + 1]) - X(edges[i]) - 2)}" height="${Math.max(0, Y(0) - Y(Math.max(n, 0)))}" fill="${o.color || c.navy}"/>`; });
    ticksNice(edges[0], edges[edges.length - 1], 6).forEach((t) => { s += txt(X(t), H - mb + 15, o.xfmt ? o.xfmt(t) : t, { a: 'middle', fs: 10.5 }); });
    (o.vlines || []).forEach((v) => { s += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${mt}" y2="${mt + ih}" stroke="${v.color || c.ink}" stroke-width="${v.w || 1.6}" ${v.dash ? 'stroke-dasharray="4 3"' : ''}/>`; if (v.label) s += txt(X(v.x) + 5, mt + 12 + (v.dy || 0), v.label, { fs: 11, fill: v.color || c.ink, w: 700 }); });
    s += `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="none" stroke="${c.line2}"/>`;
    if (o.xlabel) s += txt(ml + iw / 2, H - 5, o.xlabel, { a: 'middle', fs: 11, fill: c.ink2 }); if (o.ylabel) s += txt(12, mt + ih / 2, o.ylabel, { a: 'middle', fs: 11, fill: c.ink2, rot: -90 });
    return svgWrap(W, H, s, o.aria);
  }
  const hist = (vals, lo, hi, n) => { const edges = []; for (let i = 0; i <= n; i++) edges.push(lo + (hi - lo) * i / n); const counts = new Array(n).fill(0); vals.forEach((v) => { counts[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / (hi - lo) * n)))]++; }); return { edges, counts }; };
  const rampNavy = (t) => lerpHex(tok('--navybg'), tok('--navy'), 0.15 + 0.85 * Math.min(1, Math.max(0, t)));
  const rampGold = (t) => lerpHex(tok('--goldbg'), tok('--gold2'), 0.15 + 0.85 * Math.min(1, Math.max(0, t)));
  const KEYS = [['siloxane', '실록산 — 붙은 결합', '--m-sio', 'bar'], ['silanol', '실라놀 — 붙기 직전', '--m-oh', 'bar'], ['si_h', '규소–수소 — 막혀 버림', '--m-h', 'bar'], ['db_left', '미결합손 — 빈자리', '--m-db', 'ring'], ['water_left', '물 분자', '--m-h2o', ''], ['h2', '수소 분자', '--m-h2', ''], ['sam_void', '보이드', '--m-void', '']];
  function keyRow(r) { return KEYS.map(([k, ko, col, kind]) => { const v = k === 'sam_void' ? pc(r.sam_void, 1) : Math.round((k === 'silanol' ? Math.max(r.silanol - r.siloxane, 0) : r[k]) / 6e12) + '개'; return `<span class="key"><i class="${kind}" style="${kind === 'ring' ? '' : 'background:var(' + col + ')'}"></i>${ko} <b>${v}</b></span>`; }).join(''); }

  // ── 몬테카를로 캐시 ───────────────────────────────────────
  let mcCache = {};
  function mc() { const k = `${S.kvp}|${S.top}|${S.cut}`; if (!mcCache[k]) { const d = P.depthDose(S.kvp, S.top, 2500, S.cut, 1, true); let tr = 0, ab = 0; const dep = []; d.paths.forEach((p) => { const last = p[p.length - 1]; if (last[0] >= d.total - 1) tr++; else if (last[2] === 2) { ab++; if (last[0] < S.top) dep.push(last[0] / S.top); } }); d.transmit = tr / d.paths.length; d.absorbed = ab / d.paths.length; d.absorbDepths = dep; d.eMean = 1000 * mean(d.energies); mcCache[k] = d; } return mcCache[k]; }
  let v3dBeam = null, v3dBeamFailed = false;
  const tHours = (D, frac) => D * 1000 / (rateGyS() * frac) / 3600;
  const tStr = (h) => (h < 1 ? `${Math.round(h * 60)}분` : h < 48 ? `${f(h, 1)}시간` : `${f(h / 24, 1)}일`);

  // ── 2 광자 수송 ──────────────────────────────────────────
  function drawBlock(d) {
    const c = T(); const W = 560, H = 240; let s = '';
    const ox = 150, oy = 118, w = 260, dep = 120, hSi = Math.max(28, Math.min(70, S.top / 11)), hB = 44; const sk = 0.5;
    const face = (x, y, wd, h, fill) => `<rect x="${x}" y="${y}" width="${wd}" height="${h}" fill="${fill}"/>`;
    const topFace = (x, y, wd, fill) => `<polygon points="${x},${y} ${x + wd},${y} ${x + wd + dep * sk},${y - dep * sk} ${x + dep * sk},${y - dep * sk}" fill="${fill}"/>`;
    const sideFace = (x, y, h, fill) => `<polygon points="${x},${y} ${x + dep * sk},${y - dep * sk} ${x + dep * sk},${y - dep * sk + h} ${x},${y + h}" fill="${fill}"/>`;
    const yB = oy + hSi, yI = yB, yBot = yB + 6;
    s += face(ox, yBot, w, hB, tok('--si')) + sideFace(ox + w, yBot, hB, lerpHex(tok('--si'), '#000000', 0.25));
    s += face(ox, yI, w, 6, c.gold) + sideFace(ox + w, yI, 6, c.gold2);
    s += face(ox, oy, w, hSi, lerpHex(tok('--si'), '#ffffff', 0.35)) + sideFace(ox + w, oy, hSi, lerpHex(tok('--si'), '#000000', 0.15)) + topFace(ox, oy, w, lerpHex(tok('--si'), '#ffffff', 0.55));
    const nB = 14; for (let i = 0; i < nB; i++) { const x = ox + 14 + i * (w - 28) / (nB - 1); s += `<line x1="${x}" y1="${22}" x2="${x}" y2="${oy}" stroke="${c.blue}" stroke-width="1.6" class="beam" stroke-dasharray="6 5" opacity=".9"/><line x1="${x}" y1="${oy}" x2="${x}" y2="${yI}" stroke="${c.blue}" stroke-width="1.6" opacity="${0.15 + 0.85 * d.frac}"/>`; }
    s += `<polygon points="${ox - 6},${30} ${ox + w + 6},${30} ${ox + w / 2},${8}" fill="${c.blue}" opacity=".12"/>`;
    s += txt(ox + w / 2, 18, `${S.kvp} kVp · 여과 ${S.cut} keV`, { a: 'middle', fs: 12.5, fill: c.navy, w: 700 });
    s += txt(ox + 10, oy + hSi / 2 + 4, `실리콘 ${S.top} µm`, { fs: 12.5, fill: c.ink, w: 700 });
    s += txt(ox + w - 8, yI - 6, `계면 도달 ${pc(d.frac)}`, { a: 'end', fs: 14, fill: c.gold2, w: 900 });
    s += txt(ox + 10, yBot + hB / 2 + 4, '아래 웨이퍼 725 µm', { fs: 11.5, fill: c.ink2 });
    s += txt(W / 2, H - 6, `평균 광자 에너지 ${d.eMean.toFixed(0)} keV · 통과 ${pc(d.transmit)} · 광전흡수 ${pc(d.absorbed)}`, { a: 'middle', fs: 11 });
    return svgWrap(W, H, s, '시료와 X선');
  }
  function drawPaths(d) {
    const c = T(); const W = 560, H = 330, ml = 40, mr = 20; const iw = W - ml - mr; let s = '';
    s += `<defs><linearGradient id="gSi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9EDF2"/><stop offset="1" stop-color="#CBD3DC"/></linearGradient><linearGradient id="gSi2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D5DCE4"/><stop offset="1" stop-color="#C0C9D3"/></linearGradient><linearGradient id="gAu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3DFA2"/><stop offset=".5" stop-color="#C99A2E"/><stop offset="1" stop-color="#E9CF7E"/></linearGradient><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><radialGradient id="gDot"><stop offset="0" stop-color="${c.red}"/><stop offset=".55" stop-color="${c.red}"/><stop offset="1" stop-color="${c.red}" stop-opacity="0"/></radialGradient></defs>`;
    const hb = hist(d.energies.map((e) => 1000 * e), 0, S.kvp, 40); const hmax = Math.max(...hb.counts, 1); const sy0 = 14, sh = 40;
    hb.counts.forEach((n, i) => { const e = (hb.edges[i] + hb.edges[i + 1]) / 2; const col = e < 25 ? c.red : e < 45 ? c.gold : c.blue; s += `<rect x="${ml + i * iw / 40 + 0.5}" y="${sy0 + sh - n / hmax * sh}" width="${iw / 40 - 1}" height="${n / hmax * sh}" fill="${col}" opacity=".85"/>`; });
    s += txt(ml, sy0 - 3, '들어오는 광자의 에너지 분포', { fs: 10.5, fill: c.ink2, w: 700 }) + txt(W - mr, sy0 - 3, `0 → ${S.kvp} keV`, { a: 'end', fs: 10.5 });
    const y0 = sy0 + sh + 14, yI = y0 + 170, yEnd = H - 14; const Z = (z) => y0 + (z / S.top) * (yI - y0);
    s += `<rect x="${ml}" y="${y0}" width="${iw}" height="${yI - y0}" fill="url(#gSi)"/><rect x="${ml}" y="${yI}" width="${iw}" height="10" fill="url(#gAu)"/><rect x="${ml}" y="${yI + 10}" width="${iw}" height="${yEnd - yI - 10}" fill="url(#gSi2)"/><rect x="${ml}" y="${y0}" width="${iw}" height="${yEnd - y0}" fill="none" stroke="${c.line2}"/>`;
    s += `<g filter="url(#glow)">`;
    s += `<line x1="${ml - 10}" x2="${ml - 10}" y1="${y0}" y2="${yI}" stroke="${c.navy}" stroke-width="1.2"/><line x1="${ml - 14}" x2="${ml - 6}" y1="${y0}" y2="${y0}" stroke="${c.navy}"/><line x1="${ml - 14}" x2="${ml - 6}" y1="${yI}" y2="${yI}" stroke="${c.navy}"/>` + txt(ml - 14, (y0 + yI) / 2 + 4, `실리콘 ${S.top} µm`, { a: 'middle', fs: 11, fill: c.navy, w: 700, rot: -90 }) + txt(ml + iw - 6, yI + 8, 'SiCN 접합 계면 200 nm', { a: 'end', fs: 10.5, fill: c.gold2, w: 700 }) + txt(ml + 6, yEnd - 5, '아래 웨이퍼', { fs: 10.5, fill: c.ink2 });
    const N = 70; const paths = d.paths.slice(0, N); const rng = new P.RNG(3);
    paths.forEach((p, i) => { const e0 = p[0][1] * 1000; const col = e0 < 25 ? c.red : e0 < 45 ? c.gold : c.blue; let x = ml + 6 + (i + 0.5) * (iw - 12) / N; let py = y0; let last = null;
      for (let k = 1; k < p.length; k++) { const z = p[k][0], e = p[k - 1][1] * 1000; const y = z >= S.top ? (z >= d.total - 1 ? yEnd : yI + 10 + (z - S.top - 0.2) / 725 * (yEnd - yI - 10)) : Z(z); const wdt = 0.6 + 1.6 * (e / e0); s += `<line x1="${x}" y1="${py}" x2="${x}" y2="${y}" stroke="${col}" stroke-width="${wdt.toFixed(2)}" opacity=".8"/>`; py = y; last = p[k]; if (p[k][2] === 1) { const nx = x + (rng.u() - 0.5) * 14; s += `<line x1="${x}" y1="${y}" x2="${nx}" y2="${y + 3}" stroke="${col}" stroke-width="1"/>`; x = nx; } if (y >= yEnd) break; }
      if (last && last[2] === 2) s += `<circle cx="${x}" cy="${py}" r="6" fill="url(#gDot)"/><circle cx="${x}" cy="${py}" r="2.4" fill="${c.red}" stroke="#fff" stroke-width="1"/>`; });
    s += `</g>`;
    s += txt(W - mr, yEnd + 10, `${pc(d.transmit)} 통과`, { a: 'end', fs: 11, fill: c.ink2, w: 700 });
    return svgWrap(W, H, s, '적층 단면과 광자 궤적');
  }
  function renderBeam() {
    const d = mc(); const c = T(); const D = dose() || 100;
    $('beam-live').textContent = `계면 도달률 ${pc(d.frac)} · 광자 ${d.energies.length.toLocaleString()}개`;
    if (!v3dBeam && !v3dBeamFailed && window.VIZ3D) { try { v3dBeam = window.VIZ3D.createBeam($('v3d-beam')); if (!v3dBeam) v3dBeamFailed = true; } catch (e) { v3dBeamFailed = true; } }
    if (v3dBeam) { v3dBeam.update({ kvp: S.kvp, cut: S.cut, topUm: S.top, frac: d.frac, transmit: d.transmit, absorbDepths: d.absorbDepths, colors: { si: tok('--si'), gold: c.gold, blue: c.blue, red: c.red } }); v3dBeam.start(); $('beam-block').innerHTML = ''; $('beam-block-hint').textContent = `드래그 회전 · 휠 줌 · 더블클릭 원위치`;
      $('v3d-beam-key').innerHTML = keyRows('장면 읽기', [{ c: '#1D5FCC', dot: 1, b: `X선 광자 ${S.kvp} kVp`, s: `여과 ${S.cut} keV · 파란 점 = 광자, 붉은 섬광 = 광전흡수` }, { c: '#7D8B9C', b: `실리콘 ${S.top} µm`, s: '유리질 블록 — 이 안에서 저에너지 광자가 먹힌다' }, { c: '#C99A2E', b: 'SiCN 접합 계면', s: `평균 광자 에너지 ${d.eMean.toFixed(0)} keV` }, { c: '#5E6B7A', b: '아래 웨이퍼 725 µm', s: `통과 ${pc(d.transmit)} · 흡수 ${pc(d.absorbed)}`, show: 1 }], ''); badge('v3d-beam-badge', '계면 도달', pc(d.frac)); }
    else { $('v3d-beam').style.display = 'none'; $('beam-block').innerHTML = drawBlock(d); }
    $('beam-paths').innerHTML = drawPaths(d);
    const xs = d.centers.slice(0, 40).concat([S.top]); const ys = d.dose.slice(0, 40).concat([d.dose[40]]).map((v) => v / d.dose[0]);
    $('beam-depth').innerHTML = lineChart([{ x: xs, y: ys, color: c.navy, width: 2.4, fill: 1 }], null, { h: 230, xlo: 0, xhi: S.top, ylo: 0, yhi: 1.05, xlabel: '입사면에서의 깊이 (µm)', ylabel: '단위질량 선량 (입사면 = 1)', marks: [{ x: S.top, y: d.frac, color: c.gold, label: `계면 ${pc(d.frac)}`, left: 1 }], vlines: [{ x: S.top, color: c.mute, dash: 1 }], aria: '깊이 선량' });
    const rates = [0.1, 1, 10, 100, 1000, 10000]; const rMin = rateGyS() * 60; const series = [[1, c.green], [10, c.blue], [100, c.gold], [1000, c.red]].map(([Dk, col]) => ({ x: rates, y: rates.map((r) => Dk * 1000 / (r * d.frac) / 60), color: col, label: `계면 ${Dk} kGy`, width: 2 }));
    const hNow = tHours(D, d.frac);
    $('beam-time').innerHTML = lineChart(series, null, { h: 240, xlog: 1, xmin: 0.1, xlo: 0.1, xhi: 10000, xticks: [0.1, 1, 10, 100, 1000, 10000], ylog: 1, ylo: 0.01, yhi: 1e5, yfmt: (v) => (v >= 1 ? v.toLocaleString() : v), xlabel: '입사면 선량률 (Gy/min)', ylabel: '필요한 연속 조사 시간 (시간)', vlines: [{ x: rMin, label: `지금 ${rMin >= 60 ? (rMin / 60).toFixed(0) + ' Gy/s' : rMin.toFixed(0) + ' Gy/min'}`, color: c.ink }], hlines: [{ y: 720, label: '한 달' }, { y: 72, label: '사흘' }, { y: 8, label: '하루 8시간' }], marks: [{ x: rMin, y: hNow, color: c.ink, label: `${D} kGy → ${tStr(hNow)}` }], aria: '조사 시간표' });
    $('beam-verdict').innerHTML = `<b>${S.kvp} kVp · 실리콘 ${S.top} µm · 여과 ${S.cut} keV</b> → 광자의 <b>${pc(d.frac)}</b>가 계면에 닿는다(입사면 대비 단위질량 선량). 지금 선량률(${S.rate > 0 ? S.rate + ' Gy/s' : '10 Gy/min'})이면 계면 ${D} kGy에 <b>${tStr(hNow)}</b>, 1000 kGy는 ${tStr(tHours(1000, d.frac))}. ${S.cut < 25 ? '여과판(Al·Cu)을 끼우면 저에너지 광자가 입사면에서 먹히지 않아 도달률이 오른다 — 관전압을 올리는 것보다 싸다.' : '여과판이 저에너지 광자를 걸러 도달률이 올라 있다.'}`;
  }

  // ── 3 막 구조 ───────────────────────────────────────────
  function drawXsec(r) {
    const c = T(); const W = 560, H = 360; const cx = 40, cw = 300; let s = ''; const labels = [];
    const bulk = filmColor(S.cb), shell = S.shell ? filmColor(S.ci) : bulk; const ox = Math.min(24, r.oxide_nm * 2.0), tsPx = S.shell ? Math.max(10, Math.min(44, S.ts * 1.7)) : 0; const mid = H / 2 + 4;
    s += `<defs><pattern id="pSi" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${tok('--si')}"/><line x1="0" y1="0" x2="0" y2="8" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/></pattern>
      <pattern id="pBulk" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${bulk}"/><circle cx="1.5" cy="1.5" r=".9" fill="#fff" fill-opacity=".12"/><circle cx="4.5" cy="4" r=".7" fill="#000" fill-opacity=".18"/></pattern>
      <pattern id="pShell" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${shell}"/><circle cx="2" cy="2" r=".8" fill="#fff" fill-opacity=".35"/><circle cx="4.8" cy="4.5" r=".6" fill="#000" fill-opacity=".12"/></pattern>
      <linearGradient id="gOx" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDEFF4"/><stop offset=".5" stop-color="${tok('--oxide')}"/><stop offset="1" stop-color="#DDEFF4"/></linearGradient>
      <linearGradient id="gEdge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".16"/><stop offset=".08" stop-color="#000" stop-opacity="0"/><stop offset=".92" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient>
      <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".18"/></filter></defs>`;
    const fillOf = (f2) => (f2 === tok('--si') ? 'url(#pSi)' : f2 === bulk ? 'url(#pBulk)' : f2 === shell ? 'url(#pShell)' : f2);
    const layer = (y0, h, fill, label, sub) => { s += `<rect x="${cx}" y="${y0}" width="${cw}" height="${h}" fill="${fillOf(fill)}"/><rect x="${cx}" y="${y0}" width="${cw}" height="${h}" fill="url(#gEdge)"/><line x1="${cx}" x2="${cx + cw}" y1="${y0}" y2="${y0}" stroke="#000" stroke-opacity=".18"/>`; if (label) labels.push({ y: y0 + h / 2, label, sub }); };
    s += `<rect x="${cx - 2}" y="${14}" width="${cw + 4}" height="${H - 28}" fill="#fff" filter="url(#sh)"/>`;
    const gap = Math.max(ox, 34), top = mid - gap / 2;
    layer(16, 34, tok('--si'), 'Si 웨이퍼', '상부 500 µm'); layer(50, top - 50 - tsPx, bulk, `SiCN 벌크 · 탄소 ${Math.round(S.cb * 100)} %`, S.tdep === 180 ? '증착 180 ℃ — 성긴 막, 산소 침투' : '증착 350 ℃');
    if (S.shell) layer(top - tsPx, tsPx, shell, `껍질 · 탄소 ${Math.round(S.ci * 100)} % · ${S.ts} nm`, `계면 반응이 보는 탄소 ${Math.round(r.c_iface * 100)} %`);
    s += `<rect x="${cx}" y="${top}" width="${cw}" height="${gap}" fill="#FBFCFD"/>`; if (ox > 0.5) { s += `<rect x="${cx}" y="${top}" width="${cw}" height="${ox / 2}" fill="url(#gOx)"/><rect x="${cx}" y="${top + gap - ox / 2}" width="${cw}" height="${ox / 2}" fill="url(#gOx)"/>`; }
    labels.push({ y: mid, label: `접합 계면 · SiO₂ ${f(r.oxide_nm, 1)} nm`, sub: `축합수 흡수 ${pc(r.absorb)} · 보이드 ${pc(r.sam_void, 1)}` });
    const bot = mid + gap / 2; if (S.shell) layer(bot, tsPx, shell); layer(bot + tsPx, H - 50 - bot - tsPx, bulk); layer(H - 50, 34, tok('--si'), 'Si 웨이퍼', '하부 725 µm');
    const rng = new P.RNG(11); const nb = Math.min(40, Math.round(r.siloxane / 6e12)), ns = Math.min(30, Math.round(Math.max(r.silanol - r.siloxane, 0) / 6e12)); const g2 = gap; const k2 = 1.5;
    const yA = mid - g2 / 2 + 2, yBt = mid + g2 / 2 - 2;
    for (let i = 0; i < nb; i++) { const x = cx + 8 + rng.u() * (cw - 16); s += `<line x1="${x}" x2="${x}" y1="${yA}" y2="${yBt}" stroke="${tok('--m-sio')}" stroke-width="${3 * k2}" stroke-linecap="round"/><circle cx="${x}" cy="${yA}" r="${2.6 * k2}" fill="#D9B27C" stroke="#7a5a2a" stroke-width=".5"/><circle cx="${x}" cy="${yBt}" r="${2.6 * k2}" fill="#D9B27C" stroke="#7a5a2a" stroke-width=".5"/><circle cx="${x}" cy="${mid}" r="${2.4 * k2}" fill="#D64545"/>`; }
    for (let i = 0; i < ns; i++) { const x = cx + 8 + rng.u() * (cw - 16); const up = rng.u() < 0.5; const y0 = up ? yA : yBt, dir = up ? 1 : -1; s += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + dir * 10}" stroke="${tok('--m-oh')}" stroke-width="${3 * k2}" stroke-linecap="round"/><circle cx="${x}" cy="${y0}" r="${2.6 * k2}" fill="#D9B27C" stroke="#7a5a2a" stroke-width=".5"/><circle cx="${x}" cy="${y0 + dir * 10}" r="${2.2 * k2}" fill="#D64545"/><circle cx="${x + 4.5}" cy="${y0 + dir * 13}" r="${1.4 * k2}" fill="#fff" stroke="#999" stroke-width=".5"/>`; }
    for (let i = 0, N = Math.min(24, Math.round((r.water_left + r.water_trap) / 2.5e13)); i < N; i++) { const x = cx + 8 + rng.u() * (cw - 16), y = mid + (rng.u() - .5) * Math.max(g2 - 14, 2), a = rng.u() * 6.28; s += `<circle cx="${x}" cy="${y}" r="${2.4 * k2}" fill="#D64545"/><circle cx="${x + 4.5 * Math.cos(a)}" cy="${y + 4.5 * Math.sin(a)}" r="${1.4 * k2}" fill="#fff" stroke="#999" stroke-width=".5"/><circle cx="${x + 4.5 * Math.cos(a + 1.8)}" cy="${y + 4.5 * Math.sin(a + 1.8)}" r="${1.4 * k2}" fill="#fff" stroke="#999" stroke-width=".5"/>`; }
    for (let i = 0, N = Math.min(8, Math.round(r.sam_void * 50)); i < N; i++) { const x = cx + 12 + rng.u() * (cw - 24), w = 12 + rng.u() * 20; s += `<ellipse cx="${x}" cy="${mid}" rx="${w / 2}" ry="${g2 / 2 - 2}" fill="${tok('--m-void')}" opacity=".8" stroke="#3F9068" stroke-width=".8"/><ellipse cx="${x - w * 0.15}" cy="${mid - g2 * 0.2}" rx="${w * 0.18}" ry="${g2 * 0.12 + 1}" fill="#fff" opacity=".55"/>`; }
    labels.sort((a, b) => a.y - b.y); labels.forEach((l) => { l.ly = l.y; }); for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 34) labels[i].ly = labels[i - 1].ly + 34; const over = labels[labels.length - 1].ly - (H - 12); if (over > 0) labels.forEach((l) => { l.ly -= over; });
    labels.forEach((l) => { s += `<line x1="${cx + cw + 2}" x2="${cx + cw + 12}" y1="${l.y}" y2="${l.ly}" stroke="${c.mute}" stroke-width=".8"/>` + txt(cx + cw + 16, l.ly + 4, l.label, { fs: 12, fill: c.ink, w: 700 }); if (l.sub) s += txt(cx + cw + 16, l.ly + 18, l.sub, { fs: 10.5, fill: c.mute }); });
    return svgWrap(W, H, s, '접합 뒤 계면 단면');
  }
  let v3dFilm = null, v3dFilmFailed = false, v3dIntro = null, v3dIntroFailed = false;
  function filmKey(r) { return keyRows('층 읽기 (위 → 아래)', [{ c: '#8C99A8', b: 'Si 웨이퍼', s: '상부 500 µm' }, { c: filmColor(S.cb), b: `SiCN 벌크 · 탄소 ${Math.round(S.cb * 100)} %`, s: S.tdep === 180 ? '증착 180 ℃ — 성긴 막' : '증착 350 ℃' }, ...(S.shell ? [{ c: filmColor(S.ci), b: `껍질 · 탄소 ${Math.round(S.ci * 100)} % · ${S.ts} nm`, s: `계면 반응이 보는 탄소 ${Math.round(r.c_iface * 100)} %` }] : []), { c: '#C99A2E', b: '접합 계면', s: `SiO₂ ${f(r.oxide_nm, 1)} nm · 흡수 ${pc(r.absorb)}`, show: 1 }, { c: '#1F3A6E', dot: 1, b: '남색 기둥 = 실록산 다리', s: '금색 = 실라놀 · 붉은 공 = O · 흰 공 = H' }, { c: '#8FBF8F', dot: 1, b: '초록 덩어리 = 보이드' }], '층 두께는 축척이 아니다 — 막 200 nm, 껍질·계면은 수 nm'); }
  function filmState(r) { return { shell: S.shell, ts: S.ts, cb: S.cb, ci: S.ci, oxide_nm: r.oxide_nm, siloxane: r.siloxane, silanol: r.silanol, water: r.water_left + r.water_trap, voidF: r.sam_void, colors: { si: '#8C99A8', bulk: filmColor(S.cb), shell: S.shell ? filmColor(S.ci) : filmColor(S.cb), oxide: tok('--oxide'), sio: tok('--m-sio'), oh: tok('--m-oh'), voidc: tok('--m-void') } }; }
  function renderFilm() {
    const Wd = worlds(); const c = T(); const cur = fwd(0, 'D1', S.cb, U0);
    $('film-live').textContent = `접합에너지 ${f(cur.dcb)} J/m² · 보이드 ${pc(cur.sam_void, 1)}`;
    if (!v3dFilm && !v3dFilmFailed && window.VIZ3D) { try { v3dFilm = window.VIZ3D.createFilm($('v3d-film')); if (!v3dFilm) v3dFilmFailed = true; } catch (e) { v3dFilmFailed = true; } }
    if (v3dFilm) { v3dFilm.update(filmState(cur)); v3dFilm.start(); $('film-xsec').innerHTML = ''; $('v3d-film-key').innerHTML = filmKey(cur); badge('v3d-film-badge', '보이드', pc(cur.sam_void, 1)); } else { $('v3d-film').style.display = 'none'; $('film-xsec').innerHTML = drawXsec(cur); }
    $('film-key').innerHTML = keyRow(cur);
    const specs = [{ key: 'bi', label: S.shell ? '이중층' : '설정 막', sub: S.shell ? `${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)} · ${S.ts} nm` : `${Math.round(S.cb * 100)} %`, o: {}, carbon: S.cb, color: c.navy }, { key: 's38', label: '벌크만 단층', sub: `${Math.round(S.cb * 100)} %`, o: { ci: null, ts: 0 }, carbon: S.cb, color: tok('--sicn') }, { key: 'sci', label: '껍질만 단층', sub: `${Math.round(S.ci * 100)} %`, o: { ci: null, ts: 0 }, carbon: S.ci, color: c.gold }];
    const R = {}; specs.forEach((sp) => { R[sp.key] = { u0: fwd(0, 'D1', sp.carbon, U0, sp.o), w: Wd.map((u) => fwd(0, 'D1', sp.carbon, u, sp.o)) }; });
    const st = (k, m) => stat(R[k].w.map((r) => r[m]));
    const mk = (m, scale, fmt) => ({ label: m[1], bars: specs.map((sp) => { const s2 = st(sp.key, m[0]); return { v: R[sp.key].u0[m[0]] * scale, lo: s2.lo * scale, hi: s2.hi * scale, color: sp.color, label: fmt(R[sp.key].u0[m[0]]) }; }) });
    $('film-cmp').innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${groupedBars([mk(['dcb', '접합에너지 J/m²'], 1, (v) => f(v))], { w: 260, h: 200, aria: '접합에너지' })}${groupedBars([mk(['sam_void', '보이드 %'], 100, (v) => pc(v, 1).replace(' %', ''))], { w: 260, h: 200, aria: '보이드' })}</div><div class="keyrow">${specs.map((sp) => `<span class="key"><i style="background:${sp.color}"></i>${sp.label} ${sp.sub}</span>`).join('')}</div>`;
    const xs = S.shell ? [0.5, 1, 2, 3, 4, 5, 7, 10, 14, 20, 28, 40] : [0.14, 0.18, 0.22, 0.26, 0.30, 0.34, 0.38];
    const at = (x, u) => (S.shell ? fwd(0, 'D1', S.cb, u, { ts: x }) : fwd(0, 'D1', x, u, { ci: null, ts: 0 })); const cw = xs.map((x) => Wd.map((u) => at(x, u)));
    const E0 = xs.map((x) => at(x, U0).dcb), V0 = xs.map((x) => 100 * at(x, U0).sam_void); const EL = cw.map((a) => q(a.map((r) => r.dcb), 25)), EH = cw.map((a) => q(a.map((r) => r.dcb), 75)), VL = cw.map((a) => 100 * q(a.map((r) => r.sam_void), 25)), VH = cw.map((a) => 100 * q(a.map((r) => r.sam_void), 75));
    const xNow = S.shell ? S.ts : S.cb; const iNow = xs.reduce((bi, x, i) => (Math.abs(x - xNow) < Math.abs(xs[bi] - xNow) ? i : bi), 0);
    const xo = S.shell ? { xlog: 1, xmin: 0.5, xticks: [0.5, 1, 2, 5, 10, 20, 40], xlo: 0.5, xhi: 40, xlabel: '껍질 두께 (nm, 로그)' } : { xfmt: (v) => Math.round(v * 100), xlo: 0.14, xhi: 0.38, xlabel: '벌크 탄소 (%)' };
    const refs = (a, b) => (S.shell ? [{ x: xs, y: xs.map(() => a), color: tok('--sicn'), dash: 1, label: '벌크 단층' }, { x: xs, y: xs.map(() => b), color: c.gold, dash: 1, label: '껍질 단층' }] : []);
    $('film-curve').innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">` + lineChart([{ x: xs, y: E0, color: c.navy, width: 2.4 }, ...refs(R.s38.u0.dcb, R.sci.u0.dcb)], { x: xs, lo: EL, hi: EH, color: c.navy }, Object.assign({ w: 270, h: 200, ylo: Math.max(0, Math.min(...EL) * 0.85), yhi: Math.max(...EH, R.s38.u0.dcb) * 1.08, ylabel: '접합에너지 J/m²', marks: [{ x: xs[iNow], y: E0[iNow], color: c.navy, label: f(E0[iNow]) }], aria: '접합에너지 곡선' }, xo)) + lineChart([{ x: xs, y: V0, color: c.red, width: 2.4 }, ...refs(100 * R.s38.u0.sam_void, 100 * R.sci.u0.sam_void)], { x: xs, lo: VL, hi: VH, color: c.red }, Object.assign({ w: 270, h: 200, ylo: 0, yhi: Math.max(...VH, 100 * R.s38.u0.sam_void, 5) * 1.1, ylabel: '보이드 %', marks: [{ x: xs[iNow], y: V0[iNow], color: c.red, label: V0[iNow].toFixed(1) + ' %' }], aria: '보이드 곡선' }, xo)) + `</div>`;
    const Z = CI.map((ci) => TS.map((ts) => { const arr = Wd.map((u) => { const r = fwd(0, 'D1', S.cb, u, { ci, ts }); if (S.mapMetric === 'win') return fwd(0, 'D1', ci, u, { ci: null, ts: 0 }).dcb * 1.02 < r.dcb ? 1 : 0; return S.mapMetric === 'void' ? 100 * r.sam_void : r.dcb; }); return S.mapMetric === 'win' ? 100 * mean(arr) : med(arr); }));
    const single = stat(Wd.map((u) => fwd(0, 'D1', S.cb, u, { ci: null, ts: 0 })[S.mapMetric === 'void' ? 'sam_void' : 'dcb']));
    $('film-map-sub').textContent = S.mapMetric === 'void' ? `보이드 % (세상 중앙) — 단층 ${Math.round(S.cb * 100)} %는 ${pc(single.m, 1)}` : S.mapMetric === 'dcb' ? `접합에너지 J/m² — 단층 ${Math.round(S.cb * 100)} %는 ${f(single.m)}` : '같은 탄소의 단층을 2 % 이상 이기는 세상 비율 (%)';
    $('film-map').innerHTML = heatmap(CI.map((x) => Math.round(x * 100) + ' %'), TS.map((t) => t + ' nm'), Z, { fmt: (v) => (S.mapMetric === 'dcb' ? f(v, 2) : Math.round(v) + ''), base: S.mapMetric === 'void' ? c.red : c.navy, vmin: S.mapMetric === 'void' ? 0 : undefined, xlabel: '껍질 두께', ylabel: '껍질 탄소', mark: (i, j) => S.shell && CI[i] === S.ci && TS[j] === S.ts, ch: 30, aria: '껍질 지도' });
    const ciNow = S.shell ? S.ci : S.cb, tsNow = S.shell ? S.ts : 10;
    const pts = Wd.map((u) => ({ x: u.L_w, y: fwd(0, 'D1', S.cb, u, { ci: ciNow, ts: tsNow }).dcb - fwd(0, 'D1', ciNow, u, { ci: null, ts: 0 }).dcb, c: (Math.log(u.abs_c) - Math.log(0.03)) / (Math.log(0.30) - Math.log(0.03)) }));
    const winci = mean(pts.map((p) => (p.y > 0 ? 1 : 0)));
    $('film-lw').innerHTML = scatter(pts, { h: 250, xlog: 1, xlo: 2, xhi: 40, xticks: [2, 5, 10, 20, 40], ylo: -0.6, yhi: 0.9, hline: 0, xlabel: '물 침투 길이 L_w (nm, 로그)', ylabel: '이중층 − 껍질 단층 (J/m²)', vlines: [{ x: tsNow, label: `껍질 ${tsNow} nm` }], color: rampGold, cbar: ['흡수 잘함', '흡수 못함'], aria: '세상 산점도' }) + `<div class="cap">0 위(이중층이 이김) <b>${pc(winci)}</b> · 색 = 막이 물을 빨아들이는 특성 탄소(abs_c)</div>`;
    const win38 = mean(R.bi.w.map((r, i) => (r.dcb > R.s38.w[i].dcb * 1.02 ? 1 : 0))), winci2 = mean(R.bi.w.map((r, i) => (r.dcb > R.sci.w[i].dcb * 1.02 ? 1 : 0)));
    $('film-verdict').innerHTML = S.shell ? `<b>이중층 ${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)} · ${S.ts} nm</b> — ${S.T} ℃·${S.min}분에서 보이드 <b>${pc(cur.sam_void, 1)}</b>(벌크만 단층의 ${pc(cur.sam_void / Math.max(R.s38.u0.sam_void, 1e-9))}), 접합에너지 <b>${f(cur.dcb)}</b> 대 단층 ${f(R.s38.u0.dcb)} / ${f(R.sci.u0.dcb)} J/m². 벌크 단층을 이기는 세상 <b>${pcse(win38, Wd.length)}</b>, 껍질 단층을 이기는 세상 <b>${pcse(winci2, Wd.length)}</b>. ${S.T < 230 || S.min < 60 ? '<b>이 열처리에서는 산화막·축합수 보이드가 아직 작아 셋이 잘 안 갈린다 — 「하이닉스 공정」 버튼으로 250 ℃·2 h를 보라.</b>' : '벌크 단층을 이기냐는 탄소 기울기의 부호가, 껍질 단층을 이기냐는 물 침투 길이(L_w)가 가른다.'}` : `<b>단층 ${Math.round(S.cb * 100)} %</b> — ${S.T} ℃·${S.min}분에서 접합에너지 <b>${f(cur.dcb)}</b> J/m², 보이드 <b>${pc(cur.sam_void, 1)}</b>, 계면 SiO₂ ${f(cur.oxide_nm, 1)} nm. 「이중층」을 켜면 같은 벌크 위에 저탄소 껍질을 얹어 견준다.`;
  }

  // ── 4 계면 반응 ──────────────────────────────────────────
  let v3d = null, v3dFailed = false;
  function renderIface() {
    const Wd = worlds(); const c = T(); const D = dose(), L = S.lane; const cur = fwd(D, L, S.cb, U0), ref = fwd(0, 'D1', S.cb, U0), pre = fwd(0, 'D1', S.cb, U0, { minutes: 0.0001 }), mid = fwd(D, L, S.cb, U0, { minutes: 0.0001 });
    $('iface-live').textContent = `접합에너지 ${f(cur.dcb)} J/m² · 보이드 ${pc(cur.sam_void, 1)}`;
    const st3 = { oxide_nm: cur.oxide_nm, siloxane: cur.siloxane, silanol: cur.silanol, si_h: cur.si_h, db_left: cur.db_left, water: cur.water_left + cur.water_trap, h2: cur.h2, voidF: cur.sam_void, colors: { si: '#D9B27C', o: '#D64545', h: '#F4F4F4', sio: tok('--m-sio'), oh: tok('--m-oh'), hbond: '#9AA0A6', film: S.shell ? tok('--shell') : filmColor(S.cb), oxide: tok('--oxide'), voidc: tok('--m-void') } };
    if (!v3d && !v3dFailed && window.VIZ3D) { try { v3d = window.VIZ3D.create($('v3d')); if (!v3d) v3dFailed = true; } catch (e) { v3dFailed = true; } }
    if (v3d) { v3d.update(st3); v3d.start(); $('v3d-key').innerHTML = keyRows('장면 읽기', [{ c: S.shell ? tok('--shell') : filmColor(S.cb), b: '위 SiCN 막 — 반투명', s: '계면이 보이게 들어 올렸다' }, { c: '#1F3A6E', dot: 1, b: '남색 기둥 + 붉은 O', s: '실록산 Si–O–Si — 위아래를 이은 결합' }, { c: '#D4A017', dot: 1, b: '금색 기둥 + O–H', s: '실라놀 — 마주 보고만 있는 것' }, { c: '#9AA0A6', dot: 1, b: '회색 짧은 기둥 + H', s: 'Si–H — 수소로 막힌 자리' }, { c: '#1B1F25', dot: 1, b: '검은 점', s: '전자가 남은 미결합손' }, { c: '#D64545', dot: 1, b: '붉은 O + 흰 H 둘', s: '물 분자 · H–H = 수소 분자' }, { c: '#8FBF8F', dot: 1, b: '초록 덩어리', s: '보이드' }], ''); badge('v3d-badge', `${LANE_KO[L]} · ${D} kGy`, `${f(cur.dcb, 2)} J/m²`); } else { $('v3d').innerHTML = drawXsec(cur); }
    $('iface-key').innerHTML = keyRow(cur);
    // 아레니우스 가속계수 — 신뢰성공학 문법
    const Ea = P.LIT.ea_cond, kB = P.KB; const AF = (T1, T2) => Math.exp(Ea / kB * (1 / (T1 + 273.15) - 1 / (T2 + 273.15))); const kT = (Tc) => U0.a0 * Math.exp(-Ea / (kB * (Tc + 273.15)));
    const Ts = [150, 175, 200, 225, 250, 275, 300]; const t95 = Ts.map((t) => Math.log(20) / kT(t) / 60); const afRef = 200;
    $('iface-arr').innerHTML = `<div class="grid g11" style="align-items:start"><div><div class="stat3" style="grid-template-columns:1fr"><div><div class="l">가속계수 ${S.T} ℃ 대 ${afRef} ℃</div><div class="v">×${f(AF(afRef, S.T), 1)}</div><div class="s">같은 축합률에 ${f(AF(afRef, S.T), 1)}배 빠르다</div></div><div><div class="l">95 % 축합까지 (${S.T} ℃)</div><div class="v">${f(Math.log(20) / kT(S.T) / 60, 0)}분</div><div class="s">기준 미지수 a0 · 1차 반응 가정</div></div><div><div class="l">지금 열처리의 축합률</div><div class="v">${pc(cur.anneal)}</div><div class="s">${S.T} ℃ · ${S.min}분</div></div></div><div class="cap" style="text-align:left">가속수명시험(ALT)의 아레니우스 모형과 같은 식이다 — 접합의 「수명」이 아니라 「형성」 속도에 쓴 것. Eₐ = 0.85 eV(Nagano 인용 Batyrev 계산), 앞자리 상수 a0는 Kitagawa 250 ℃·2 h 완료에 맞춘 미지수. 온도가 선량보다 큰 레버인 이유가 이 지수식이다. 같은 식으로 「200 ℃에서 2시간」이 250 ℃의 몇 분과 같은지를 바로 읽는다.</div></div><div>` +
      lineChart([{ x: Ts, y: t95, color: c.red, width: 2.4 }], null, { h: 200, ylog: 1, ylo: 1, yhi: 10000, yfmt: (v) => v.toLocaleString(), xticks: Ts, xlabel: '열처리 온도 (℃)', ylabel: '95 % 축합까지 분 (로그)', vlines: [{ x: S.T, label: `${S.T} ℃`, dash: 1 }], hlines: [{ y: 120, label: '2 시간' }, { y: 30, label: '30분' }], aria: '아레니우스' }) + `<div class="cap">온도별 95 % 축합 도달 시간 — 세로선 = 지금 열처리 온도</div></div></div>`; $('iface-cap').innerHTML = `남색 기둥(가운데 붉은 O)이 위아래를 이으면 붙은 것(Si–O–Si) · 금색 기둥은 O–H를 달고 마주 보고만 있는 것(실라놀) · 회색 짧은 것은 H로 막힌 자리 · 검은 점은 전자가 남은 미결합손 — <b>${LANE_KO[L]}</b>`;
    const cols = { A: c.red, B: c.blue, C: c.green, D1: c.grey, D2: c.mute2 };
    const xs = DOSES.map((x) => Math.max(x, 0.5)); const bw = DOSES.map((dd) => Wd.map((u) => fwd(dd, L, S.cb, u).dcb));
    $('iface-dose').innerHTML = lineChart(P.LANES.map((ln) => ({ x: xs, y: DOSES.map((dd) => fwd(dd, ln, S.cb, U0).dcb), color: cols[ln], label: ln, width: ln === L ? 2.6 : 1.5, dim: ln !== L, dash: ln.startsWith('D') })), { x: xs, lo: bw.map((a) => q(a, 25)), hi: bw.map((a) => q(a, 75)), color: cols[L] }, { h: 250, xlog: 1, xmin: 0.5, xlo: 0.5, xhi: 1000, xticks: [0.5, 1, 10, 100, 1000], xfmt: (v) => (v === 0.5 ? '0' : v), xlabel: 'X선 흡수선량 (kGy) — 0은 왼쪽 끝', ylabel: '접합에너지 (J/m²)', marks: [{ x: Math.max(D, 0.5), y: cur.dcb, color: cols[L], label: `${D} kGy · ${f(cur.dcb)}` }], hlines: [{ y: 2.2, label: '문헌 250 ℃ 실측 2.2~5.2 J/m²', color: c.gold }], aria: '선량 곡선' });
    const items = [['siloxane', '실록산', tok('--m-sio')], ['silanol', '실라놀', tok('--m-oh')], ['si_h', '규소–수소', tok('--m-h')], ['db_left', '미결합손', tok('--m-db')], ['water_left', '남은 물', tok('--m-h2o')], ['h2', '수소 분자', tok('--m-h2')]];
    $('iface-state').innerHTML = hbars(items.map((it) => ({ label: it[1], v: cur[it[0]], ref: pre[it[0]], mark: (L === 'D1' || L === 'D2') ? undefined : mid[it[0]], text: sci(cur[it[0]]), color: it[2] })), { ml: 90, aria: '계면 상태' }) + `<div class="cap">연한 막대 = 조사·열처리 전(접합 직후, 선량과 무관) · <b>검은 눈금</b> = 조사 뒤 열처리 직전 · 진한 막대 = 지금</div>`;
    const gain = Wd.map((u) => fwd(D, L, S.cb, u).dcb / fwd(0, 'D1', S.cb, u).dcb - 1); const sg = stat(gain); const hg = hist(gain.map((g) => Math.min(100 * g, 139)), -10, 140, 30);
    $('iface-hist').innerHTML = histogram(hg.edges, hg.counts, { h: 230, color: cols[L], xlabel: `X선 이득 % (${D} kGy 갈래 ${L} 대 무조사) — 세상 ${Wd.length}벌`, ylabel: '세상 수', vlines: [{ x: 100 * sg.m, label: `중앙 ${sg.m >= 0 ? '+' : ''}${(100 * sg.m).toFixed(0)} %` }, { x: 100 * P.LIT.noise_shear, label: `전단 잡음 ${100 * P.LIT.noise_shear} %`, color: c.mute, dash: 1, dy: 14 }], aria: '이득 분포' }) + `<div class="cap">잡음선 오른쪽 세상 <b>${pc(mean(gain.map((g) => (g > P.LIT.noise_shear ? 1 : 0))))}</b> — 전단 시험 한 번으로 보이는 비율</div>`;
    const opt = Wd.map((u) => { const e = DOSES.map((dd) => fwd(dd, 'A', S.cb, u).dcb); return { x: u.db0, y: Math.max(DOSES[e.indexOf(Math.max(...e))], 1), c: (Math.log(u.g_corr) - Math.log(0.5)) / (Math.log(5) - Math.log(0.5)) }; });
    const jit = (v, i) => v * (1 + 0.06 * (((i * 7919) % 100) / 100 - 0.5)); const tr = [[5e13, 1e14], [1e14, 2e14], [2e14, 4e14]].map(([a, b]) => { const m = opt.filter((o) => o.x >= a && o.x < b).map((o) => o.y); return [Math.sqrt(a * b), med(m)]; });
    $('iface-best').innerHTML = scatter(opt.map((o, i) => ({ x: o.x, y: jit(o.y, i), c: o.c })), { h: 250, xlog: 1, xlo: 5e13, xhi: 4e14, xticks: [5e13, 1e14, 2e14, 4e14], xfmt: (v) => (v / 1e14).toFixed(1), ylog: 1, ylo: 1, yhi: 1000, yticks: [1, 10, 100, 1000], yfmt: (v) => (v === 1 ? '0' : v), xlabel: '미결합손 면밀도 db0 (×10¹⁴ /cm²) — ESR로 잰다', ylabel: '접합에너지가 최고인 선량 (kGy)', color: rampNavy, cbar: ['라디칼 수율 낮음', '높음'], trend: tr, aria: '최적 선량' });
    const allOpt = opt.map((o) => o.y);
    $('iface-verdict').innerHTML = `<b>${D} kGy · ${LANE_KO[L]}</b> — 접합에너지 <b>${f(cur.dcb)}</b> J/m²(무조사 ${f(ref.dcb)}), X선 이득 <b>${sg.m >= 0 ? '+' : ''}${pc(sg.m)}</b>(세상 25~75 % ${pc(sg.lo)}~${pc(sg.hi)}). 접합에너지가 가장 높아지는 선량은 세상 중앙 <b>${Math.round(med(allOpt))} kGy</b>(25~75 % ${Math.round(q(allOpt, 25))}~${Math.round(q(allOpt, 75))}) — 폭이 넓은 이유는 미결합손 면밀도 하나다. ${L === 'A' ? '조사한 뒤 열처리하는 갈래 — 조사가 만든 실라놀과 원래 있던 몫이 함께 이어 붙는다. 다섯 갈래 중 이 순서가 가장 유리하다.' : L === 'B' ? '열처리 뒤 조사하는 갈래 — 새로 생긴 실라놀이 축합될 기회가 없어 무조사와 거의 같다.' : L === 'C' ? '열처리 뒤 조사하고 다시 열처리 — 굳은 계면이라 조사 효율이 떨어진다.' : '조사 없는 대조군이다.'}`;
  }

  // ── 5 교차 ─────────────────────────────────────────────
  function lstsqShares(Wd, y) {
    const keys = P.UNK_KEYS.filter((k) => P.UNK[k].hi > P.UNK[k].lo); const n = Wd.length, p = keys.length;
    const X = Wd.map((u) => keys.map((k) => (P.UNK[k].lo > 0 ? Math.log(u[k]) : u[k]))); const mu = keys.map((_, j) => mean(X.map((r) => r[j]))), sd = keys.map((_, j) => Math.sqrt(mean(X.map((r) => (r[j] - mu[j]) ** 2))) || 1);
    const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])); const ym = mean(y), ys = Math.sqrt(mean(y.map((v) => (v - ym) ** 2))) || 1; const yy = y.map((v) => (v - ym) / ys);
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { b[j] += Z[i][j] * yy[i]; for (let k = 0; k < p; k++) A[j][k] += Z[i][j] * Z[i][k]; }
    for (let j = 0; j < p; j++) A[j][j] += 1e-3 * n;
    for (let j = 0; j < p; j++) { let piv = j; for (let k = j + 1; k < p; k++) if (Math.abs(A[k][j]) > Math.abs(A[piv][j])) piv = k; [A[j], A[piv]] = [A[piv], A[j]]; [b[j], b[piv]] = [b[piv], b[j]]; for (let k = j + 1; k < p; k++) { const m = A[k][j] / A[j][j]; for (let l = j; l < p; l++) A[k][l] -= m * A[j][l]; b[k] -= m * b[j]; } }
    const beta = new Array(p).fill(0); for (let j = p - 1; j >= 0; j--) { let s = b[j]; for (let l = j + 1; l < p; l++) s -= A[j][l] * beta[l]; beta[j] = s / A[j][j]; }
    const tot = beta.reduce((s, v) => s + v * v, 0) || 1; let ss = 0; for (let i = 0; i < n; i++) { let pr = 0; for (let j = 0; j < p; j++) pr += Z[i][j] * beta[j]; ss += (yy[i] - pr) ** 2; }
    return { items: keys.map((k, j) => ({ k, share: beta[j] * beta[j] / tot, beta: beta[j] })).sort((a, b2) => b2.share - a.share), r2: 1 - ss / n };
  }
  function renderCross() {
    const Wd = worlds(); const c = T(); const D = dose() || 30;
    const specs = [{ label: '벌크만 단층', carbon: S.cb, o: { ci: null, ts: 0 }, color: tok('--sicn') }, { label: '껍질만 단층', carbon: S.ci, o: { ci: null, ts: 0 }, color: c.gold }, { label: S.shell ? '이중층' : '설정 막', carbon: S.cb, o: {}, color: c.navy }];
    const R = specs.map((sp) => ({ d1: Wd.map((u) => fwd(0, 'D1', sp.carbon, u, sp.o).dcb), a: Wd.map((u) => fwd(D, 'A', sp.carbon, u, sp.o).dcb), d10: fwd(0, 'D1', sp.carbon, U0, sp.o).dcb, a0: fwd(D, 'A', sp.carbon, U0, sp.o).dcb }));
    $('cross-live').textContent = `${S.T} ℃·${S.min}분 · 증착 ${S.tdep} ℃ · X선 ${D} kGy 갈래 A`;
    $('cross-bars').innerHTML = groupedBars(specs.map((sp, i) => { const s1 = stat(R[i].d1), s2 = stat(R[i].a); const g = med(R[i].a.map((v, k) => v / R[i].d1[k] - 1)); return { label: sp.label, sub: `X선 ${g >= 0 ? '+' : ''}${pc(g)}`, bars: [{ v: R[i].d10, lo: s1.lo, hi: s1.hi, color: sp.color, dim: 1, label: f(R[i].d10) }, { v: R[i].a0, lo: s2.lo, hi: s2.hi, color: sp.color, label: f(R[i].a0) }] }; }), { h: 250, ylabel: '접합에너지 J/m²', aria: '세 시편 조사 유무' });
    const bixWin = mean(R[2].a.map((v, k) => (v > R[0].d1[k] * 1.02 ? 1 : 0))), bixRatio = med(R[2].a.map((v, k) => v / R[0].d1[k]));
    const d180 = Wd.map((u) => fwd(0, 'D1', S.cb, u, { tdep: 180 }).dcb), d350 = Wd.map((u) => fwd(0, 'D1', S.cb, u, { tdep: 350 }).dcb), a180 = Wd.map((u) => fwd(D, 'A', S.cb, u, { tdep: 180 }).dcb), a180b = Wd.map((u) => Math.max(...DOSES.map((dd) => fwd(dd, 'A', S.cb, u, { tdep: 180 }).dcb)));
    const reach = mean(a180b.map((v, k) => (v >= d350[k] ? 1 : 0))), reachD = mean(a180.map((v, k) => (v >= d350[k] ? 1 : 0)));
    const gb = (lab, arr, col) => { const s = stat(arr); return { label: lab, bars: [{ v: s.m, lo: s.lo, hi: s.hi, color: col, label: f(s.m) }] }; };
    $('cross-recover').innerHTML = groupedBars([gb('180 ℃ 막 무조사', d180, c.grey), gb(`180 ℃ 막 + ${D} kGy`, a180, c.blue), gb('180 ℃ 막 + 최적 선량', a180b, c.navy), gb('350 ℃ 막 무조사', d350, c.grey)], { h: 250, ylabel: '접합에너지 J/m²', aria: '저온막 회복' }) + `<div class="cap">350 ℃ 무조사 수준에 닿는 세상: ${D} kGy에서 <b>${pc(reachD)}</b>, 최적 선량이면 <b>${pc(reach)}</b> — 「X선이 증착 온도 대신」이 될 수 있는지는 22 % × 2온도 × 조사 유무 8쿠폰이면 갈린다</div>`;
    const DS = [0, 10, 30, 100, 300, 1000]; const ts = S.shell ? S.ts : 5; const Z = CI.map((ci) => DS.map((dd) => med(Wd.map((u) => fwd(dd, 'A', S.cb, u, { ci, ts }).dcb))));
    $('cross-map').innerHTML = heatmap(CI.map((x) => Math.round(x * 100) + ' %'), DS.map((d) => d + ''), Z, { fmt: (v) => f(v, 2), xlabel: 'kGy', ylabel: `껍질 탄소 (${ts} nm)`, mark: (i, j) => CI[i] === S.ci && DS[j] === D, aria: '선량 × 껍질' });
    const sres = lstsqShares(Wd, R[2].a.map((v, k) => v - R[0].d1[k]));
    $('cross-sens').innerHTML = hbars(sres.items.slice(0, 7).map((it) => ({ label: `${it.k} · ${P.UNK[it.k].ko}`, v: 100 * it.share, text: `${Math.round(100 * it.share)} % (${it.beta >= 0 ? '+' : '−'})`, color: it.beta >= 0 ? c.navy : c.red })), { vmax: 100, ml: 210, aria: '민감도' }) + `<div class="cap">R² ${f(sres.r2, 2)} · (+)는 그 미지수가 클수록 차이가 커진다는 뜻 — 위에 있는 값을 먼저 재야 한다</div>`;
    $('cross-verdict').innerHTML = `<b>${specs[2].label} + X선 ${D} kGy</b>는 벌크 단층 무조사의 <b>${f(bixRatio)}배</b>, <b>${pcse(bixWin, Wd.length)}</b> 세상에서 이긴다. X선 이득은 벌크 단층 ${pc(med(R[0].a.map((v, k) => v / R[0].d1[k] - 1)))} · 껍질 단층 ${pc(med(R[1].a.map((v, k) => v / R[1].d1[k] - 1)))} · 이중층 ${pc(med(R[2].a.map((v, k) => v / R[2].d1[k] - 1)))} — 껍질이 산화막 통로를 열어 두어 라디칼이 만든 실록산이 보이드에 덜 갉힌다. 저온(180 ℃) 막은 X선으로 고온 막 수준에 <b>${pc(reach)}</b> 세상에서 닿는다.`;
  }

  // ── 6 실험 설계 ─────────────────────────────────────────
  function preds() { const c = P.cond; const o = S.shell ? { ci: S.ci, ts: S.ts } : { ci: null, ts: 0 }; const mk = (carbon, over) => Object.assign(c(carbon, S.T, S.tdep, o.ci, o.ts, S.min), over || {});
    return [
      { name: `P1 탄소 ${Math.round(S.cb * 100)} − 22 % (단층)`, conds: [c(0.22, S.T, S.tdep, null, 0, S.min), c(S.cb, S.T, S.tdep, null, 0, S.min)], k: [-1, 1], note: '조성이 웨이퍼 단위 — 웨이퍼 평균끼리' },
      { name: 'P2 온도 × 탄소 (200/250 ℃ × 14/34 %)', conds: [c(0.14, 200, S.tdep, null, 0, S.min), c(0.14, 250, S.tdep, null, 0, S.min), c(0.34, 200, S.tdep, null, 0, S.min), c(0.34, 250, S.tdep, null, 0, S.min)], k: [1, -1, -1, 1], note: '온도는 웨이퍼 안, 탄소는 웨이퍼 간' },
      { name: 'P4 증착 350 − 180 ℃ (22 %)', conds: [c(0.22, S.T, 180, null, 0, S.min), c(0.22, S.T, 350, null, 0, S.min)], k: [-1, 1], note: 'Nagano 2020: 저온 막 61 %' },
      { name: `P5 X선 ${dose() || 30} kGy − 무조사 (설정 막)`, conds: [mk(S.cb, { lane: 'D1', dose: 0 }), mk(S.cb, { lane: 'A', dose: dose() || 30 })], k: [-1, 1], note: '같은 웨이퍼 안 짝쿠폰 — 로트 편차가 지워진다' },
      { name: `P6 이중층 − 벌크 단층 (${Math.round(S.cb * 100)} %)`, conds: [c(S.cb, S.T, S.tdep, null, 0, S.min), c(S.cb, S.T, S.tdep, S.ci, S.ts, S.min)], k: [-1, 1], note: '250 ℃·2 h 가 아니면 잘 안 갈린다' },
      { name: `P7 이중층 − 껍질 단층 (${Math.round(S.ci * 100)} %)`, conds: [c(S.ci, S.T, S.tdep, null, 0, S.min), c(S.cb, S.T, S.tdep, S.ci, S.ts, S.min)], k: [-1, 1], note: '효과가 작다 — 차이가 없다는 것도 답' }]; }
  let powerCache = {};
  function pw(pred, nw, nr, meas, n, detail) { const key = JSON.stringify([pred.conds, pred.k, nw, nr, meas, S.slot, S.rmin, n, S.seed, PINS, S.alpha, !!detail]); if (!powerCache[key]) powerCache[key] = P.power(pred.conds, pred.k, nw, nr, meas, n, S.slot, S.seed + 1, S.rmin, dose() || 30, 'A', S.alpha, (rng) => drawWith(rng, pinRanges()), !!detail); return powerCache[key]; }
  function renderExp() {
    const PR = preds(); const wn = quick ? 80 : Math.min(S.worldsN, 400); const c = T();
    let h = `<table><thead><tr><th>예측 (대비)</th>${MEAS.map((m) => `<th class="num">${m[1]}</th>`).join('')}<th class="num">웨이퍼</th><th>비고</th></tr></thead><tbody>`;
    PR.forEach((p, i) => { h += `<tr data-i="${i}" style="cursor:pointer;${i === S.pred ? 'background:var(--navybg)' : ''}"><td><b>${esc(p.name)}</b></td>`; MEAS.forEach((m) => { const r = pw(p, S.nw, S.nr, m[0], wn); const v = 100 * r.power; h += `<td class="num"><span class="pw ${v >= 80 ? 'hi' : v >= 50 ? 'mid' : 'lo'}">${r.n_eff ? Math.round(v) + ' %' : '—'}</span></td>`; }); const wafers = new Set(p.conds.map((cc) => [cc.carbon, cc.tdep, cc.ci, cc.ts].join('|'))).size * S.nw; h += `<td class="num">${wafers}장</td><td style="color:var(--mute)">${esc(p.note)}</td></tr>`; });
    $('power-table').innerHTML = h + '</tbody></table>'; $('exp-hint').textContent = `α ${S.alpha} (양측 t) · 미지수 ${wn}세상 · 효과 ${Math.round(S.rmin * 100)} % 미만인 세상은 「효과 없는 세상」 · 행을 누르면 아래가 바뀐다`;
    $('power-table').querySelectorAll('tr[data-i]').forEach((tr) => tr.addEventListener('click', () => { S.pred = +tr.dataset.i; dirty.exp = 1; render(); }));
    const p = PR[S.pred]; const ws = [1, 2, 3, 4, 5, 6];
    // 오류 분해 — 선택 예측 · 가장 좋은 측정
    const bestM = MEAS.reduce((b, m) => (pw(p, S.nw, S.nr, m[0], wn).power > pw(p, S.nw, S.nr, b[0], wn).power ? m : b), MEAS[0]); const rd = pw(p, S.nw, S.nr, bestM[0], wn, true);
    $('exp-errs').innerHTML = `<div><div class="l">검정력 1 − β (맞게 기각)</div><div class="v">${Math.round(100 * rd.power)} %</div><div class="s">${bestM[1]} · 효과 있는 세상 ${rd.n_eff}</div></div><div><div class="l">2종 오류 β (놓침)</div><div class="v" style="color:var(--red)">${Math.round(100 * rd.miss)} %</div><div class="s">부호 반대로 기각(오판) ${Math.round(100 * rd.wrong)} %</div></div><div><div class="l">1종 오류 (위양성)</div><div class="v" style="color:var(--gold2)">${rd.n_null ? Math.round(100 * rd.fp) + ' %' : '—'}</div><div class="s">효과 없는 세상 ${rd.n_null}에서 기각한 비율 (목표 ≤ α ${S.alpha})</div></div>`;
    const bins = [[0, 0.04], [0.04, 0.08], [0.08, 0.15], [0.15, 0.25], [0.25, 0.4], [0.4, 1e9]]; const oc = bins.map(([a, b]) => { const m = rd.rows.filter((r) => r.eff >= a && r.eff < b); return { x: a === 0 ? 0.02 : Math.min(a * 1.4, 0.6), y: m.length ? 100 * mean(m.map((r) => (r.ok ? 1 : 0))) : NaN, n: m.length }; }).filter((o) => isFinite(o.y));
    $('exp-oc').innerHTML = lineChart([{ x: oc.map((o) => o.x), y: oc.map((o) => o.y), color: c.navy, width: 2.4 }], null, { h: 190, xlo: 0, xhi: 0.62, yhi: 105, xfmt: (v) => Math.round(100 * v) + ' %', xlabel: '참 효과 크기 (평균 대비 %) — 세상마다 다르다', ylabel: '검출 확률 %', hlines: [{ y: 80, label: '80 %' }, { y: 100 * S.alpha, label: `α ${S.alpha}` }], vlines: [{ x: S.rmin, label: '효과 문턱', dash: 1 }], marks: oc.map((o) => ({ x: o.x, y: o.y, color: c.navy })), aria: '검정력 곡선' }) + `<div class="cap">검정력 곡선(OC 곡선의 보수) — 효과가 클수록 잡힌다. 문턱 왼쪽은 「효과 없음」으로 세어 1종 오류에 들어간다</div>`;
    // 분할구 설계
    const groups = new Set(p.conds.map((cc) => [cc.carbon, cc.tdep, cc.ci, cc.ts].join('|'))).size; const wpDf = groups * (S.nw - 1); const spDf = groups * S.nw * (S.nr - 1) * (p.conds.length / groups);
    $('exp-split').innerHTML = `<table><thead><tr><th>인자</th><th>단위 (구)</th><th>오차항</th><th class="num">자유도 (지금 설정)</th><th>검정에 쓰는 비교</th></tr></thead><tbody><tr><td><b>탄소 · 증착 온도 · 껍질</b></td><td>웨이퍼 (주구, whole-plot)</td><td>로트 편차 σ_lot ${Math.round(S.slot * 100)} % + 쿠폰 잡음</td><td class="num">${wpDf}</td><td>웨이퍼 평균끼리 (조성당 ${S.nw}장)</td></tr><tr><td><b>열처리 온도 · X선 조사</b></td><td>쿠폰 (세구, sub-plot)</td><td>쿠폰 잡음만 — 로트 편차는 웨이퍼 안에서 지워짐</td><td class="num">${spDf}</td><td>같은 웨이퍼 안 짝쿠폰 차이</td></tr></tbody></table><div class="cap">한 증착 = 한 조성이라 탄소는 쿠폰마다 바꿀 수 없다 — <b>바꾸기 어려운 인자</b>가 있는 전형적 분할구. 주구 인자의 검정력은 <b>웨이퍼 장수</b>가, 세구 인자의 검정력은 쿠폰 수가 올린다. 이 시뮬레이터의 검정력은 이 두 오차항을 따로 뽑아 센다.</div>`;
    $('power-curve').innerHTML = lineChart([['sam_void', c.red, '보이드'], ['tds_h2o', c.gold, '열탈착 물'], ['shear', c.navy, '전단'], ['dcb', c.blue, '균열']].map(([m, col, lab]) => ({ x: ws, y: ws.map((w) => 100 * pw(p, w, S.nr, m, Math.min(wn, 200)).power), color: col, label: lab, width: 2.2 })), null, { h: 240, yhi: 105, xticks: ws, xlabel: '조성당 웨이퍼 장수', ylabel: '검정력 %', vlines: [{ x: S.nw, label: '지금', dash: 1 }], hlines: [{ y: 80, label: '80 %' }], aria: '검정력 곡선' }) + `<div class="cap"><b>${esc(p.name)}</b> · 쿠폰 ${S.nr}개 — 쿠폰을 늘려도 조성 간 비교는 거의 안 오른다. 로트 편차는 웨이퍼를 늘려야 지워진다</div>`;
    const ff = 4 * 2 * 2; $('pilot').innerHTML = `<div class="cap" style="text-align:left;margin:0 0 6px">완전요인 탄소 4 × 증착 2 × 조사 2 = ${ff}런 × ${S.nw}장 = <b>${ff * S.nw / 2}장</b>(조사는 반쪽 쿠폰이라 웨이퍼는 절반) — 아래 파일럿은 <b>${S.nw * 3 + 3}장</b>으로 주효과와 핵심 교호작용(껍질×조사, 증착×조사)만 먼저 본다. 스크리닝 뒤 완전요인으로 간다.</div><table><thead><tr><th>시편</th><th class="num">장수</th><th>열처리</th><th>조사</th><th>측정</th></tr></thead><tbody><tr><td>단층 ${Math.round(S.cb * 100)} %</td><td class="num">${S.nw}</td><td>250 ℃ · 2 h</td><td>반쪽 ${dose() || 30} kGy</td><td>SAM 보이드 · TDS 물 · 전단</td></tr><tr><td>단층 ${Math.round(S.ci * 100)} %</td><td class="num">${S.nw}</td><td>250 ℃ · 2 h</td><td>반쪽</td><td>같음</td></tr><tr><td>이중층 ${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)} · ${S.ts} nm</td><td class="num">${S.nw}</td><td>250 ℃ · 2 h</td><td>반쪽</td><td>같음 + TEM 산화막 1장</td></tr><tr><td>22 % · 증착 180 ℃</td><td class="num">2~3</td><td>250 ℃ · 2 h</td><td>반쪽</td><td>「X선이 증착 온도 대신」 · σ_lot</td></tr></tbody></table><div class="cap">이 격자 한 번으로 P4~P7과 L_w(TDS)·A×B가 다 나온다. ESR(미결합손)은 조사 전 막에서 따로 — 선량 격자를 정하는 값</div>`;
    const best = PR.map((p2) => ({ p: p2, v: Math.max(...MEAS.map((m) => pw(p2, S.nw, S.nr, m[0], wn).power)) })); const weak = best.filter((b) => b.v < 0.5).map((b) => b.p.name.split(' ')[0]);
    $('exp-verdict').innerHTML = `조성당 <b>${S.nw}장</b>·쿠폰 <b>${S.nr}개</b>면 ${best.filter((b) => b.v >= 0.8).map((b) => b.p.name.split(' ')[0]).join('·') || '없음'}은 80 % 넘게 잡히고, ${weak.length ? weak.join('·') + '은(는) 어느 측정으로도 절반을 못 넘는다' : '가장 잘 맞는 측정으로 보면 전부 절반은 넘는다'}. 접합 강도(전단·균열)보다 <b>보이드·열탈착 물</b>이 거의 언제나 먼저 갈린다 — 탄소 축은 강도가 아니라 물로 읽어야 한다.`;
  }

  // ── 7 결론 · 근거 ───────────────────────────────────────
  const MEASURE_OF = { db0: 'ESR (조사 전 막)', w0: 'TDS 물 (접합 직후)', db_slope: '조성별 ESR·XPS', g_corr: '갈래 A 조사 후 ESR 감소량', kgy_to_ev: '갈래 A 조사 후 ESR 감소량', a0: '온도별 DCB', sil0: 'XPS · 접촉각', c_pen: '갈래 C vs A', ub_base: '접합 직후 DCB', ub_gain: '250 ℃ 파일럿 DCB', void_ref: 'SAM + TDS 같은 쿠폰', shear_k: '전단 + DCB 같은 쿠폰', tdep_k: '증착 2온도 ESR·TDS', tdep_ub: '증착 2온도 DCB', ox_cth: 'TEM 산화막 (조성별)', ox0: 'TEM 산화막 두께', ox_T: 'TEM (온도별)', ox_block: 'TEM + SAM 같은 쿠폰', abs_c: 'TDS (조성별)', L_w: 'TDS (껍질 두께별)' };
  function outputs(Wd) { const D = dose() || 30; const g = [], bd = [], e = [], bi = []; for (const u of Wd) { const d1 = fwd(0, 'D1', S.cb, u); g.push(fwd(D, 'A', S.cb, u).dcb / d1.dcb - 1); const es = DOSES.map((dd) => fwd(dd, 'A', S.cb, u).dcb); bd.push(Math.log10(Math.max(DOSES[es.indexOf(Math.max(...es))], 1))); e.push(fwd(0, 'D1', S.cb, u, { T: 250, minutes: 120, tdep: 350 }).dcb); bi.push(fwd(0, 'D1', S.cb, u, { ci: S.shell ? S.ci : 0.14, ts: S.shell ? S.ts : 5, T: 250, minutes: 120 }).dcb - fwd(0, 'D1', S.cb, u, { ci: null, ts: 0, T: 250, minutes: 120 }).dcb); }
    const iqr = (a) => q(a, 75) - q(a, 25); return { g: iqr(g), bd: iqr(bd), e: iqr(e), bi: iqr(bi), glo: q(g, 25), ghi: q(g, 75), bdlo: Math.pow(10, q(bd, 25)), bdhi: Math.pow(10, q(bd, 75)), elo: q(e, 25), ehi: q(e, 75), bilo: q(bi, 25), bihi: q(bi, 75) }; }
  let rankCache = null;
  function renderOut() {
    const Wd = worlds(); const c = T(); const d = mc(); const D = dose();
    const opt = Wd.map((u) => { const e = DOSES.map((dd) => fwd(dd, 'A', S.cb, u).dcb); return [u.db0, DOSES[e.indexOf(Math.max(...e))]]; }); const oLo = opt.filter((o) => o[0] < 1e14).map((o) => o[1]), oHi = opt.filter((o) => o[0] > 2e14).map((o) => o[1]);
    const d350 = Wd.map((u) => fwd(0, 'D1', S.cb, u, { tdep: 350 }).dcb), a180b = Wd.map((u) => Math.max(...DOSES.map((dd) => fwd(dd, 'A', S.cb, u, { tdep: 180 }).dcb))), d180 = Wd.map((u) => fwd(0, 'D1', S.cb, u, { tdep: 180 }).dcb);
    const reach = mean(a180b.map((v, k) => (v >= d350[k] ? 1 : 0))); const lever = stat(Wd.map((u) => fwd(0, 'D1', S.cb, u, { T: 250, minutes: 120 }).dcb / fwd(0, 'D1', S.cb, u, { T: 200, minutes: 120 }).dcb));
    const bi = Wd.map((u) => fwd(0, 'D1', S.cb, u, { ci: 0.14, ts: 5, T: 250, minutes: 120 })), s38 = Wd.map((u) => fwd(0, 'D1', S.cb, u, { ci: null, ts: 0, T: 250, minutes: 120 })), s14 = Wd.map((u) => fwd(0, 'D1', 0.14, u, { ci: null, ts: 0, T: 250, minutes: 120 }));
    const win38 = mean(bi.map((r, i) => (r.dcb > s38[i].dcb * 1.02 ? 1 : 0))), win14 = mean(bi.map((r, i) => (r.dcb > s14[i].dcb * 1.02 ? 1 : 0)));
    const D_ = [
      ['최적 선량은 미결합손 면밀도(ESR)가 정한다', 'red', `접합에너지가 가장 높아지는 선량은 세상 중앙 ${Math.round(med(opt.map((o) => o[1])))} kGy(25~75 % ${Math.round(q(opt.map((o) => o[1]), 25))}~${Math.round(q(opt.map((o) => o[1]), 75))}). 폭이 넓은 이유는 하나 — 계면 미결합손 면밀도가 1e14 아래면 ${Math.round(med(oLo))} kGy, 2e14 위면 ${Math.round(med(oHi))} kGy. 그래서 ESR이 먼저다. 계면 도달률 ${pc(d.frac)}이라 ${S.rate > 0 ? S.rate + ' Gy/s' : '10 Gy/min'}면 100 kGy에 ${tStr(tHours(100, d.frac))}, 1000 kGy만 외부 감마선에 맡긴다.`],
      ['여과판(Al·Cu) 장착 여부를 먼저 확인한다', 'gold', `저에너지 차단을 12 → 40 keV로 올리면 계면 도달률이 오른다. 관전압을 올리는 것보다 이쪽이 싸고 효과가 크다 — 2번 화면 여과판 버튼으로 바로 본다.`],
      ['짝쿠폰을 반드시 자른다', 'navy', `같은 웨이퍼의 무조사 조각(D1)과의 차이로 봐야 로트 편차가 지워진다. X선 효과(P5)는 짝쿠폰이라 ${S.nw}장으로도 잡히지만, 조성 비교(P1·P6)는 웨이퍼를 늘려야 한다.`],
      ['탄소 축은 강도가 아니라 보이드·물로 읽는다', 'green', `검정력이 거의 언제나 초음파 보이드·열탈착 물이 먼저다(6번 화면). 균열 시험(DCB)은 접합에너지 절대값을 주는 유일한 측정이라 빼지 않되, 조성 차이를 가르는 입력으로는 뒤다.`],
      ['열처리 온도가 선량보다 큰 레버다', 'red', `200 → 250 ℃(2 h)가 접합에너지 ×${f(lever.m)}(세상 25~75 % ${f(lever.lo)}~${f(lever.hi)}) — Kitagawa 실측과 같은 이야기라 이건 예측이 아니라 문헌 재현이다. 다른 공정이 견디는 상한을 확인해야 한다.`],
      ['탄소는 방향부터 실험이 정한다 — 문헌이 갈린다', 'gold', `탄소를 올리면 붙을 자리가 느나 주나부터 UNIST 계산(↓)과 Inoue 실측(↑)이 반대다. 이 부호를 열어 두면 「낮은 탄소가 최고」와 「높은 탄소가 최고」가 반반이다 — 탄소 4점 × 증착 2온도에 TEM 산화막 두께를 붙여 가른다.`],
      ['180 ℃ 막의 손실을 X선이 메우는가 — 가장 실용적인 질문', 'red', `Nagano 2020 실측으로 저온 증착막은 고온 막의 61 %. 모형에서 350 ℃ 막이 180 ℃ 막의 ${f(med(d350) / med(d180))}배인데, 180 ℃ 막에 최적 선량을 쬐면 ${pc(reach)} 세상에서 350 ℃ 무조사 수준에 닿는다. 「X선이 증착 온도 대신」 — 22 % × 2온도 × 조사 유무 8쿠폰이면 갈린다.`],
      ['이중층은 고탄소 단층의 보이드를 절반으로 — 두 축은 서로 돕는다', 'navy', `벌크 ${Math.round(S.cb * 100)} % 위에 14 % 껍질 5 nm를 얹고 250 ℃·2 h를 돌리면 보이드 ${pc(med(bi.map((r) => r.sam_void)), 1)}(단층 ${pc(med(s38.map((r) => r.sam_void)), 1)}), 접합에너지는 벌크 단층을 이기는 세상 ${pc(win38)}, 껍질 단층을 이기는 세상 ${pc(win14)}. X선 이득은 이중층에서 더 크다(5번 화면). 이중층 시편은 반드시 250 ℃·2 h로 — 200 ℃·30 min에서는 셋이 안 갈린다. 전제: IST가 이중층을 한 증착으로 낼 수 있어야 한다.`],
    ];
    $('decisions').innerHTML = D_.map(([t, col, body], i) => `<div class="decision ${col}"><h4>${i + 1}. ${t}</h4><p>${body}</p></div>`).join('');
    const key = JSON.stringify([S.cb, S.ci, S.ts, S.shell, S.tdep, S.T, S.min, D, S.seed, PINS]);
    if (!rankCache || rankCache.key !== key) { const base = outputs(worldsWith({}, 250, 5)); const rows = []; for (const k of P.UNK_KEYS) { if (PINS[k]) continue; const u = P.UNK[k]; const mid = u.lo > 0 && u.hi / u.lo >= 20 ? Math.sqrt(u.lo * u.hi) : 0.5 * (u.lo + u.hi); const o = outputs(worldsWith({ [k]: { v: mid, tol: 0.1 } }, 250, 5)); const parts = [1 - o.g / base.g, 1 - o.bd / base.bd, 1 - o.e / base.e, 1 - o.bi / base.bi].map((x) => Math.max(0, x)); rows.push({ k, sh: (parts[0] + parts[1] + parts[2] + parts[3]) / 4 }); } rows.sort((a, b) => b.sh - a.sh); rankCache = { key, base, rows, now: Object.keys(PINS).length ? outputs(Wd) : base }; }
    const { base, rows, now } = rankCache;
    $('rank').innerHTML = hbars(rows.slice(0, 8).map((r) => ({ label: r.k, v: Math.max(0, 100 * r.sh), text: `${Math.round(100 * r.sh)} % — ${MEASURE_OF[r.k] || ''}`, color: r.sh > 0.15 ? c.gold : c.grey })), { vmax: Math.max(40, 100 * rows[0].sh * 1.1), ml: 80, w: 520, rh: 24, aria: '측정의 값어치' }) + `<div class="cap">막대 옆 = 그 값을 재는 방법. 1위가 「갈래 A 조사 후 ESR 감소량」이면 X선 실험 자체가 가장 값진 측정이라는 뜻</div>`;
    const row = (l, b0, b1, fmt, lg) => { const w = (b) => (lg ? Math.log10(b[1]) - Math.log10(b[0]) : b[1] - b[0]); const sh = 1 - w(b1) / Math.max(w(b0), 1e-9); return `<tr><td>${l}</td><td class="num">${fmt(b0[0])} ~ ${fmt(b0[1])}</td><td class="num">${fmt(b1[0])} ~ ${fmt(b1[1])}</td><td class="num"><span class="pw ${sh > 0.3 ? 'hi' : sh > 0 ? 'mid' : 'lo'}">${Math.round(100 * Math.abs(sh))} %${sh < 0 ? ' 넓어짐' : ''}</span></td></tr>`; };
    const pinned = Object.keys(PINS); $('shrink-hint').textContent = pinned.length ? `고정: ${pinned.join(', ')}` : '아직 고정한 값 없음 — 아래 표에서 「잰 값」을 켜라';
    $('shrink').innerHTML = `<table><thead><tr><th>예측 (25~75 %)</th><th class="num">고정 전</th><th class="num">고정 후</th><th class="num">폭 감소</th></tr></thead><tbody>${row('X선 이득', [base.glo, base.ghi], [now.glo, now.ghi], (v) => (100 * v).toFixed(0) + ' %')}${row('최적 선량 (kGy)', [base.bdlo, base.bdhi], [now.bdlo, now.bdhi], (v) => v.toFixed(0), true)}${row('250 ℃·2 h 접합E', [base.elo, base.ehi], [now.elo, now.ehi], (v) => v.toFixed(2))}${row('이중층 − 벌크 단층', [base.bilo, base.bihi], [now.bilo, now.bihi], (v) => (v >= 0 ? '+' : '') + v.toFixed(2))}</tbody></table>`;
    let h = `<table><thead><tr><th>잰 값</th><th>미지수</th><th>어떻게 재나</th><th class="ctl2">값 (범위 안)</th><th>허용 폭</th><th class="num">범위</th><th>근거</th></tr></thead><tbody>`;
    P.UNK_KEYS.forEach((k) => { const u = P.UNK[k]; const p = PINS[k]; const log = u.lo > 0 && u.hi / u.lo >= 20; const mid = log ? Math.sqrt(u.lo * u.hi) : 0.5 * (u.lo + u.hi); const v = p ? p.v : mid; const pos = log ? 100 * (Math.log(v) - Math.log(u.lo)) / (Math.log(u.hi) - Math.log(u.lo)) : 100 * (v - u.lo) / (u.hi - u.lo); const fmtv = (x) => (Math.abs(x) >= 1e4 ? sci(x) : f(x, Math.abs(x) < 1 ? 2 : 1)); const lit = u.src.startsWith('[문헌') || u.src.startsWith('[유도');
      h += `<tr class="${p ? 'on' : ''}" data-k="${k}"><td><input type="checkbox" class="pin-on" ${p ? 'checked' : ''} aria-label="${k} 고정"></td><td><b>${k}</b> <span class="tag ${lit ? 'lit' : 'unk'}">${lit ? '문헌' : '미지'}</span><br><span style="color:var(--mute);font-size:11.5px">${esc(u.ko)}</span></td><td style="color:var(--mute);font-size:12px">${esc(MEASURE_OF[k] || '')}</td><td class="ctl2"><input type="range" class="pin-v" min="0" max="100" step="1" value="${Math.round(pos)}" ${p ? '' : 'disabled'} aria-label="${k} 값"><div style="font-size:11.5px"><b>${fmtv(v)}</b> ${esc(u.unit)}</div></td><td><span class="seg pin-tol">${[0.1, 0.25, 0.5].map((t) => `<button data-t="${t}" aria-pressed="${(p ? p.tol : 0.1) === t}">±${Math.round(t * 100)}</button>`).join('')}</span></td><td class="num" style="color:var(--mute)">${fmtv(u.lo)} ~ ${fmtv(u.hi)}</td><td style="color:var(--mute);font-size:11.5px;max-width:320px">${esc(u.src)}</td></tr>`; });
    $('pins-table').innerHTML = h + '</tbody></table>';
    const apply = () => { powerCache = {}; rankCache = null; allDirty(); render(); };
    $('pins-table').querySelectorAll('tr[data-k]').forEach((tr) => { const k = tr.dataset.k, u = P.UNK[k]; const log = u.lo > 0 && u.hi / u.lo >= 20; const valOf = () => { const pos = +tr.querySelector('.pin-v').value / 100; return log ? Math.exp(Math.log(u.lo) + pos * (Math.log(u.hi) - Math.log(u.lo))) : u.lo + pos * (u.hi - u.lo); };
      tr.querySelector('.pin-on').addEventListener('change', (e) => { if (e.target.checked) PINS[k] = { v: valOf(), tol: PINS[k] ? PINS[k].tol : 0.1 }; else delete PINS[k]; apply(); });
      tr.querySelector('.pin-v').addEventListener('change', () => { if (PINS[k]) { PINS[k].v = valOf(); apply(); } });
      tr.querySelectorAll('.pin-tol button').forEach((b) => b.addEventListener('click', () => { if (!PINS[k]) PINS[k] = { v: valOf(), tol: +b.dataset.t }; else PINS[k].tol = +b.dataset.t; apply(); })); });
    $('lit').innerHTML = `<ul style="padding-left:18px;margin:4px 0;font-size:12.5px;line-height:1.6"><li><b>Nagano 2023</b> (논문 1) — ESR 미결합손 4.4→6.8e14 cm⁻², RBS 수산기 2.3e14, SiCN이 SiO₂보다 물을 흡수</li><li><b>Nagano 2020</b> ECS JSST — 200 vs 370 ℃ 막: 밀도 1.32/1.85, 산소 12.7 at%, 접합E 1.4/2.3 J/m²</li><li><b>Kitagawa 2025</b> ACS Omega — 250 ℃·2 h 물 소모 완료, 성긴 막이 이김, 계면 SiCO 수 nm</li><li><b>Inoue 2019</b> ECS JSS — 조성 3종(C 25~32 %), 산화물 계면 ~10 nm, SAM 보이드 없음</li><li><b>UNIST 2025</b> arXiv 2511.03476 ReaxFF — Si–OH 1.08→0.64e14 (33→60 % C)</li><li><b>Chidambaram 2021</b> IEEE ECTC — 유전체 전단 >10 MPa, 고분자 ≥50 MPa at >2.5 J/m²</li><li><b>Ebiko 2024</b> · <b>Tong & Gösele</b> · <b>Milekhin</b> · <b>Le Caër 2011</b> — 계면 물 1~4 층, SiCN 물 방출 SiO₂의 1/10, 나노공극 수율 2~10배</li><li><b>NIST</b> 질량감쇠계수 (Si·C·N) · Klein–Nishina · Kramers 스펙트럼</li></ul>`;
    $('honest').innerHTML = `<ul style="padding-left:18px;margin:4px 0;font-size:12.5px;line-height:1.6"><li>고탄소 벌크의 접합 밖 이점(Cu 확산 장벽·경도)은 없다 — 이중층이 접합에서 비겨도 그 논리는 남는다.</li><li>L_w(물 침투 길이)와 abs_c(흡수 특성)는 문헌이 없다 — 이중층 결론의 절반이 여기 달렸다. TDS가 답.</li><li>단층 38 %의 보이드는 Inoue(32 %, SAM 보이드 없음)보다 세게 나온다 — TEM 산화막 두께로 검증.</li><li>시간의존 감쇠(접합 후 며칠 뒤 약해짐)는 없다.</li><li>X선 스펙트럼은 크라머스 근사(특성선 없음), 1차원 평판 기하, 2차 전자 국소 축적.</li><li>「IST가 이중층을 한 증착으로 낼 수 있다」는 전제다.</li><li>모든 숫자는 예측이다 — 실측이 들어오면 미지수 범위부터 다시 좁힌다(위 표).</li></ul>`;
  }

  // ── 8 기계학습 판독 ─────────────────────────────────────
  let mlCache = null;
  function renderML(force) {
    const c = T(); const key = JSON.stringify([S.cb, S.ci, S.ts, S.shell, S.tdep, S.T, S.min, dose(), S.mlw, S.mlt, S.mlr, S.seed, PINS]);
    if (mlCache && mlCache.key === key && !force) { paintML(); return; }
    $('ml-live').textContent = '학습 중…'; document.body.style.cursor = 'progress';
    setTimeout(() => { const t0 = performance.now(); const Wd = worldsWith({}, S.mlw, S.seed + 3); const rows = window.ML.dataset(Wd, { dose: dose() || 30, carbon: S.cb, o: filmOpt(), nRep: S.mlr, sigmaLot: S.slot, seed: S.seed });
      const y = rows.map((r) => r.lane); const fa = window.ML.forest(rows.map((r) => r.abs), y, 5, { nTree: S.mlt, seed: S.seed + 11 }); const fd = window.ML.forest(rows.map((r) => r.dif), y, 5, { nTree: S.mlt, seed: S.seed + 11 });
      const sub = rows.filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 1500)) === 0); const kw = window.ML.knnCV(sub.map((r) => r.abs), sub.map((r) => r.water), 10); const kwo = window.ML.knnCV(sub.map((r) => r.abs.filter((_, i) => i !== 3 && i !== 4)), sub.map((r) => r.water), 10);
      mlCache = { key, rows, fa, fd, kw, kwo, sub, ms: performance.now() - t0 }; document.body.style.cursor = ''; paintML(); }, 20);
  }
  function paintML() {
    const c = T(); const { rows, fa, fd, kw, kwo, sub, ms } = mlCache; const MK = ['균열', '전단', 'ESR', '열탈착 물', '열탈착 H₂', '보이드'];
    $('ml-live').textContent = `표본 ${rows.length.toLocaleString()}행 · 학습 ${Math.round(ms)} ms`;
    $('ml-acc').innerHTML = `<div><div class="l">절대값 6개</div><div class="v">${Math.round(100 * fa.acc)} %</div><div class="s">웨이퍼마다 재료가 달라 헷갈린다</div></div><div><div class="l">짝쿠폰 차이 6개</div><div class="v" style="color:var(--green)">${Math.round(100 * fd.acc)} %</div><div class="s">같은 웨이퍼 무조사와의 차이 (+${Math.round(100 * (fd.acc - fa.acc))} %p)</div></div><div><div class="l">우연</div><div class="v" style="color:var(--mute)">20 %</div><div class="s">갈래 5개 중 하나</div></div>`;
    $('ml-accbar').innerHTML = hbars([{ label: '우연', v: 20, text: '20 %', color: c.grey }, { label: '절대값', v: 100 * fa.acc, text: Math.round(100 * fa.acc) + ' %', color: c.navy2 }, { label: '짝쿠폰 차이', v: 100 * fd.acc, text: Math.round(100 * fd.acc) + ' %', color: c.navy }], { vmax: 100, ml: 100, aria: '정확도' }) + `<div class="cap">랜덤포레스트 ${fd.nTree}그루 · 깊이 8 · OOB 정확도 — 학습에 안 쓴 표본으로 센 값이라 낙관이 아니다</div>`;
    $('ml-imp').innerHTML = hbars(MK.map((k, i) => ({ label: k, v: Math.max(0, 100 * fd.imp[i]), text: (100 * fd.imp[i]).toFixed(1) + ' %p', color: fd.imp[i] > 0.05 ? c.gold : c.grey })).sort((a, b) => b.v - a.v), { vmax: Math.max(20, 100 * Math.max(...fd.imp) * 1.15), ml: 90, aria: '중요도' }) + `<div class="cap">ESR(남은 미결합손)과 보이드가 갈래를 가른다 — X선은 미결합손을 채우고, 순서가 다르면 남는 수소·보이드가 다르기 때문. 열탈착은 갈래 판별엔 약하지만 아래 「물 역산」엔 필수다</div>`;
    const LN = P.LANES; const tot = fd.conf.map((r) => r.reduce((s, v) => s + v, 0)); $('ml-conf').innerHTML = heatmap(LN.map((l) => '참 ' + l), LN.map((l) => '예측 ' + l), fd.conf.map((r, i) => r.map((v) => 100 * v / Math.max(tot[i], 1))), { fmt: (v) => Math.round(v) + '', base: c.navy, vmin: 0, vmax: 100, ch: 34, aria: '혼동행렬' }) + `<div class="cap">행 합 100 %. D1·D2(무조사 둘)와 B(열처리 뒤 조사)는 계면이 거의 같아 서로 섞인다 — 모형이 말하는 「B는 무조사와 같다」의 기계학습 판</div>`;
    $('ml-water').innerHTML = `<div><div class="l">열탈착 포함 · RMSE</div><div class="v">${kw.rmse.toFixed(2)} dex</div><div class="s">R² ${kw.r2.toFixed(2)} · ×${Math.pow(10, kw.rmse).toFixed(1)}배 오차</div></div><div><div class="l">열탈착 제외 · RMSE</div><div class="v" style="color:var(--red)">${kwo.rmse.toFixed(2)} dex</div><div class="s">R² ${kwo.r2.toFixed(2)} · ×${Math.pow(10, kwo.rmse).toFixed(1)}배</div></div><div><div class="l">이웃 수 k</div><div class="v">10</div><div class="s">5겹 교차검증 · 표본 ${sub.length}</div></div>`;
    const pts = sub.map((r, i) => ({ x: Math.pow(10, r.water), y: Math.pow(10, kw.pred[i]), c: r.lane / 4 })); $('ml-wsc').innerHTML = scatter(pts, { h: 230, xlog: 1, ylog: 1, xlo: 1e12, xhi: 3e15, ylo: 1e12, yhi: 3e15, xticks: [1e12, 1e13, 1e14, 1e15], yticks: [1e12, 1e13, 1e14, 1e15], xfmt: (v) => '10' + sup(Math.round(Math.log10(v))), yfmt: (v) => '10' + sup(Math.round(Math.log10(v))), xlabel: '참 남은 물 (개/cm²)', ylabel: '되찾은 값', color: rampNavy, trend: [[1e12, 1e12], [3e15, 3e15]], r: 2.4, aria: '물 역산' }) + `<div class="cap">대각선 위 = 정확. 열탈착(TDS)을 빼면 물은 되찾을 수 없다 — 열탈착 분석을 뺄 수 없는 이유</div>`;
    $('ml-verdict').innerHTML = `측정 여섯 개만으로 갈래를 <b>${Math.round(100 * fd.acc)} %</b> 맞힌다(우연 20 %) — 단, <b>같은 웨이퍼의 무조사 짝쿠폰과의 차이</b>로 넣었을 때다. 절대값으로는 ${Math.round(100 * fa.acc)} %: 로트마다 재료가 달라 웨이퍼를 넘어가면 절대값은 못 쓴다. 갈래를 가르는 건 ESR·보이드, 계면 물을 되찾는 건 열탈착이다(RMSE ${kw.rmse.toFixed(2)} dex ↔ 빼면 ${kwo.rmse.toFixed(2)}). 이 두 문장이 「짝쿠폰을 자른다」와 「열탈착은 뺄 수 없다」(7번 결론)의 근거다. 실측이 오면 같은 파이프라인에 실측 행을 넣는다.`;
  }
  $('ml-train').addEventListener('click', () => renderML(true));

  // ── 1 개요 ─────────────────────────────────────────────
  function renderIntro() {
    $('chain').innerHTML = [['X선', '광자 수송', '500 µm Si를 지나 계면에 닿는 몫 — 몬테카를로'], ['물', '방사분해', '계면에 갇힌 물이 쪼개져 OH·H 라디칼'], ['미결합손', '실라놀·Si–H', 'OH는 자리를 실라놀로, H는 Si–H로 막는다'], ['열처리', '축합', '실라놀 둘 → 실록산 다리 + 물 (0.85 eV)'], ['탄소', '산화막 · 흡수', '고탄소는 계면 SiO₂를 키우고, 벌크는 물을 빨아들인다'], ['껍질', '이중층', '계면 화학은 껍질이, 흡수는 벌크가 — 물 침투 길이 L_w'], ['측정', '여섯 가지', '균열·전단·ESR·열탈착 물/수소·보이드 + 장비 잡음']].map(([k, b, d]) => `<div><span class="k">${k}</span><b>${b}</b>${d}</div>`).join('');
    $('intro-axes').innerHTML = `<table><thead><tr><th>축</th><th>조절하는 것</th><th>보는 것</th><th>화면</th></tr></thead><tbody><tr><td><b>A 이중층 탄소</b></td><td>벌크 탄소 · 껍질 탄소 · 껍질 두께 · 증착 온도 · 열처리</td><td>접합에너지 · 보이드 · 계면 SiO₂ · 열탈착 물</td><td>3</td></tr><tr><td><b>B 계면 X선 반응</b></td><td>관전압 · 여과판 · 선량 · 갈래(순서) · 선량률</td><td>계면 도달률 · 조사 시간 · 결합 상태 · X선 이득</td><td>2 · 4</td></tr><tr><td><b>A × B</b></td><td>둘을 겹친다</td><td>이중층에 X선 · 저온 막의 회복</td><td>5</td></tr><tr><td><b>실험</b></td><td>웨이퍼 · 쿠폰 · 로트 편차</td><td>검정력 · 파일럿 격자 · 측정 값어치</td><td>6 · 7</td></tr></tbody></table><div class="cap">미지수 20개는 하나로 박지 않고 범위 안에서 <b>수백 벌 다시 뽑아</b> 띠(25~75 %)로 같이 낸다 — 띠가 좁으면 문헌이 정한 것, 넓으면 실험이 정할 것</div>`;
    $('intro-flow').innerHTML = `<table><tbody><tr><td class="num">2</td><td><b>광자 수송</b> — X선이 계면에 얼마나 닿나, 얼마나 오래 쬐나</td></tr><tr><td class="num">3</td><td><b>막 구조</b> — 탄소와 껍질이 계면 화학을 어떻게 바꾸나</td></tr><tr><td class="num">4</td><td><b>계면 반응</b> — 선량·순서·열처리가 결합을 어떻게 만드나 (분자 3D)</td></tr><tr><td class="num">5</td><td><b>교차</b> — 이중층에 X선을 쏘면, 저온 막을 X선이 살리나</td></tr><tr><td class="num">6</td><td><b>실험 설계</b> — 몇 장이면 갈리나</td></tr><tr><td class="num">7</td><td><b>결론</b> — 정한 것 8가지 · 실측이 들어오면 예측이 얼마나 좁아지나</td></tr></tbody></table><div class="cap">각 화면 위의 <b>바로 가기</b> 버튼이 의미 있는 조건으로 슬라이더를 한 번에 옮긴다</div>`;
    const d = mc(); const cur = fwd(dose(), S.lane, S.cb, U0);
    if (!v3dIntro && !v3dIntroFailed && window.VIZ3D) { try { v3dIntro = window.VIZ3D.createFilm($('v3d-intro'), { rain: true, ratio: 0.5, dist: 22, title: 'SiCN 접합 계면 — 이중층 탄소 × 계면 X선 반응' }); if (!v3dIntro) v3dIntroFailed = true; } catch (e) { v3dIntroFailed = true; } }
    if (v3dIntro) { v3dIntro.update(filmState(cur)); v3dIntro.start(); $('v3d-intro-key').innerHTML = filmKey(cur).replace('층 읽기 (위 → 아래)', '장면 읽기') + `<div class="r"><i class="dot" style="background:#1D5FCC"></i><span><b>파란 점 = X선 광자</b><small>위 실리콘에서 대부분 먹히고 일부만 계면에 닿는다 (2번 화면)</small></span></div>`; badge('v3d-intro-badge', '접합에너지', `${f(cur.dcb, 2)} J/m²`); } else { $('v3d-intro').style.display = 'none'; }
    $('intro-verdict').innerHTML = `지금 설정: ${S.kvp} kVp · 여과 ${S.cut} keV → 계면 도달률 <b>${pc(d.frac)}</b> · ${S.shell ? `이중층 ${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)} · ${S.ts} nm` : `단층 ${Math.round(S.cb * 100)} %`} · 증착 ${S.tdep} ℃ · ${S.T} ℃ ${S.min}분 · X선 ${dose()} kGy 갈래 ${S.lane} → 접합에너지 <b>${f(cur.dcb)} J/m²</b> · 보이드 <b>${pc(cur.sam_void, 1)}</b>. 오른쪽 수치 레일이 화면을 옮겨도 따라간다.`;
  }

  // ── 오른쪽 실시간 수치 · 상단 텔레메트리 ─────────────────────
  function renderSide() {
    const d = mc(); const cur = fwd(dose(), S.lane, S.cb, U0); const rng = new P.RNG(5); const m = P.measure(cur, rng); const hNow = tHours(dose() || 100, d.frac);
    const row = (l, v, u) => `<div class="row"><span>${l}</span><span>${v}${u ? `<small>${u}</small>` : ''}</span></div>`;
    $('side-body').innerHTML = `<div class="grp">조사 조건</div>${row('관전압', S.kvp, 'kVp')}${row('실리콘 두께', S.top, 'µm')}${row('여과 차단', S.cut, 'keV')}${row('입사면 선량률', S.rate > 0 ? S.rate + ' Gy/s' : '10 Gy/min')}
      <div class="grp">몬테카를로 결과</div>${row('광자 수', d.energies.length.toLocaleString(), '개')}${row('계면 도달률', pc(d.frac, 1))}${row('통과', pc(d.transmit))}${row('광전흡수', pc(d.absorbed))}${row('평균 에너지', d.eMean.toFixed(1), 'keV')}${row(`조사 시간 (${dose() || 100} kGy)`, tStr(hNow))}
      <div class="grp">막 · 열처리</div>${row('구조', S.shell ? `이중층 ${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)}·${S.ts} nm` : `단층 ${Math.round(S.cb * 100)} %`)}${row('증착 온도', S.tdep, '℃')}${row('열처리', `${S.T} ℃ · ${S.min}분`)}${row('축합 진행', pc(cur.anneal))}${row('계면 SiO₂', f(cur.oxide_nm, 1), 'nm')}
      <div class="grp">계면 상태 (개/cm²)</div>${row('남은 물', sci(cur.water_left))}${row('미결합손', sci(cur.db_left))}${row('실라놀', sci(cur.silanol))}${row('실록산', sci(cur.siloxane))}${row('규소–수소', sci(cur.si_h))}${row('수소 분자', sci(cur.h2))}
      <div class="grp">여섯 측정 (참값)</div>${row('균열 시험', f(cur.dcb), 'J/m²')}${row('전단 시험', f(cur.shear, 1), 'MPa')}${row('전자스핀공명', sci(cur.esr))}${row('열탈착 물', sci(cur.tds_h2o))}${row('열탈착 수소', sci(cur.tds_h2))}${row('초음파 보이드', pc(cur.sam_void, 1))}
      <div class="grp">잡음 얹은 한 번 측정</div>${row('균열', f(m.dcb), 'J/m²')}${row('전단', f(m.shear, 1), 'MPa')}${row('보이드', pc(m.sam_void, 1))}`;
    $('foot-l').textContent = `${S.kvp} kVp · Si ${S.top} µm · 여과 ${S.cut} keV → 도달률 ${pc(d.frac, 1)} · ${S.shell ? `이중층 ${Math.round(S.cb * 100)}/${Math.round(S.ci * 100)}` : `단층 ${Math.round(S.cb * 100)} %`} · ${S.T} ℃ ${S.min}′ · ${dose()} kGy ${S.lane} → ${f(cur.dcb)} J/m² · 보이드 ${pc(cur.sam_void, 1)}`;
  }

  // ── 바로 가기 ───────────────────────────────────────────
  const PRESETS = {
    beam: [['교내 X선 (100 kVp · 500 µm · 36 Gy/s)', { kvp: 100, top: 500, cut: 12, rate: 36 }], ['여과판 Cu', { cut: 40 }], ['여과판 Al', { cut: 25 }], ['얇은 웨이퍼 200 µm', { top: 200 }], ['보수적 선량률 10 Gy/min', { rate: 0 }], ['고관전압 160 kVp', { kvp: 160 }]],
    film: [['하이닉스 공정 250 ℃ · 2 h', { T: 250, min: 120, tdep: 350 }], ['교내 열처리 200 ℃ · 30분', { T: 200, min: 30 }], ['이중층 추천 38/14 · 5 nm', { shell: 1, cb: 0.38, ci: 0.14, ts: 5 }], ['단층 38 %', { shell: 0, cb: 0.38 }], ['단층 14 %', { shell: 0, cb: 0.14 }], ['저온 증착 180 ℃', { tdep: 180 }], ['두꺼운 껍질 20 nm', { shell: 1, ts: 20 }]],
    iface: [['최적 선량 (지금 막)', 'best'], ['무조사 D1', { doseIdx: 0, lane: 'D1' }], ['30 kGy · A', { doseIdx: 4, lane: 'A' }], ['100 kGy · A', { doseIdx: 7, lane: 'A' }], ['300 kGy · A (과다)', { doseIdx: 9, lane: 'A' }], ['갈래 B (열처리 → X선)', { lane: 'B' }], ['하이닉스 공정 250 ℃ · 2 h', { T: 250, min: 120 }]],
    cross: [['이중층 추천 + 최적 선량', 'bestbi'], ['저온 180 ℃ 막', { tdep: 180 }], ['고온 350 ℃ 막', { tdep: 350 }], ['단층 38 % + 30 kGy', { shell: 0, cb: 0.38, doseIdx: 4 }]],
    exp: [['3장 · 4쿠폰 (권장)', { nw: 3, nr: 4 }], ['4장 · 4쿠폰', { nw: 4, nr: 4 }], ['6장 · 2쿠폰', { nw: 6, nr: 2 }], ['2장 · 8쿠폰 (쿠폰만 늘림)', { nw: 2, nr: 8 }], ['엄격 α 0.01', { alpha: 0.01 }], ['탐색 α 0.10', { alpha: 0.10 }]],
    ml: [['빠르게 (세상 120 · 나무 20)', { mlw: 120, mlt: 20 }], ['정밀 (세상 320 · 나무 60)', { mlw: 320, mlt: 60 }], ['쿠폰 4개', { mlr: 4 }]],
  };
  function bestDoseIdx() { const Wd = worlds(); const picks = Wd.map((u) => { const e = DOSES.map((dd) => fwd(dd, 'A', S.cb, u).dcb); return e.indexOf(Math.max(...e)); }); return Math.round(med(picks)); }
  function applyPreset(v) { if (v === 'best') { S.lane = 'A'; S.doseIdx = bestDoseIdx(); } else if (v === 'bestbi') { Object.assign(S, { shell: 1, cb: 0.38, ci: 0.14, ts: 5, T: 250, min: 120, lane: 'A' }); S.doseIdx = bestDoseIdx(); } else Object.assign(S, v); syncControls(); allDirty(); render(); }
  function renderPresets() { for (const [pid, list] of Object.entries(PRESETS)) { const el = $('pre-' + pid); if (!el) continue; el.innerHTML = `<span class="lbl">바로 가기</span>` + list.map((p, i) => `<button data-i="${i}">${p[0]}</button>`).join(''); el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => applyPreset(list[+b.dataset.i][1]))); } }

  // ── 렌더 · 이벤트 ─────────────────────────────────────
  function render() {
    const p = S.panel; const t0 = performance.now(); nFwd = 0;
    if (p === 'intro' && dirty.intro) { renderIntro(); dirty.intro = 0; }
    if (p === 'beam' && dirty.beam) { renderBeam(); dirty.beam = 0; }
    if (p === 'film' && dirty.film) { renderFilm(); dirty.film = 0; }
    if (p === 'iface' && dirty.iface) { renderIface(); dirty.iface = 0; }
    if (p === 'cross' && dirty.cross) { renderCross(); dirty.cross = 0; }
    if (p === 'exp' && dirty.exp) { renderExp(); dirty.exp = 0; }
    if (p === 'out' && dirty.out) { renderOut(); dirty.out = 0; }
    if (p === 'ml' && dirty.ml) { renderML(); dirty.ml = 0; }
    renderSide();
    const ms = performance.now() - t0; if (nFwd > 0) $('telem').innerHTML = `${quick ? '미리보기 · ' : ''}미지수 <b>${worlds().length.toLocaleString()}</b>세상 · 계산 <b>${nFwd.toLocaleString()}</b>회 · <b>${Math.max(1, Math.round(ms))}</b> ms`;
  }
  function sliderFill() { document.querySelectorAll('input[type=range]').forEach((el) => { const lo = +el.min, hi = +el.max, v = +el.value; el.style.setProperty('--p', (100 * (v - lo) / (hi - lo || 1)).toFixed(1) + '%'); }); }
  function readouts() {
    $('v-kvp').textContent = S.kvp + ' kVp'; $('v-top').textContent = S.top + ' µm'; $('v-cut').textContent = (S.cut === 12 ? '없음' : S.cut === 25 ? 'Al' : 'Cu') + ' · ' + S.cut + ' keV'; $('v-rate').textContent = S.rate > 0 ? S.rate + ' Gy/s' : '10 Gy/min (보수)';
    $('v-cb').textContent = Math.round(S.cb * 100) + ' %'; $('v-ci').textContent = Math.round(S.ci * 100) + ' %'; $('v-ts').textContent = S.ts + ' nm'; $('v-shell').textContent = S.shell ? '이중층' : '단층'; $('v-tdep').textContent = S.tdep + ' ℃'; $('v-T').textContent = S.T + ' ℃'; $('v-min').textContent = S.min + ' 분'; $('v-T2').textContent = S.T + ' ℃'; $('v-min2').textContent = S.min + ' 분';
    $('v-dose').textContent = dose() + ' kGy'; $('v-lane').textContent = LANE_KO[S.lane]; $('v-nw').textContent = S.nw + ' 장'; $('v-nr').textContent = S.nr + ' 개'; $('v-slot').textContent = Math.round(S.slot * 100) + ' %'; $('v-rmin').textContent = Math.round(S.rmin * 100) + ' %'; $('v-alpha').textContent = S.alpha; $('v-mlw').textContent = S.mlw; $('v-mlt').textContent = S.mlt; $('v-mlr').textContent = S.mlr;
    $('ctl-ci').classList.toggle('off', !S.shell); $('ctl-ts').classList.toggle('off', !S.shell); sliderFill();
  }
  function syncControls() { $('kvp').value = S.kvp; $('top').value = S.top; $('rate').value = S.rate; $('cb').value = Math.round(S.cb * 100); $('ci').value = Math.round(S.ci * 100); $('ts').value = S.ts; $('T').value = S.T; $('min').value = S.min; $('T2').value = S.T; $('min2').value = S.min; $('dose').value = S.doseIdx; $('nw').value = S.nw; $('nr').value = S.nr; $('slot').value = Math.round(S.slot * 100); $('rmin').value = Math.round(S.rmin * 100);
    const seg = (id, v) => $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v) === String(v) ? 'true' : 'false')); seg('shellSeg', S.shell); seg('tdepSeg', S.tdep); seg('cutSeg', S.cut); seg('laneSeg', S.lane); seg('mapMetric', S.mapMetric); seg('alphaSeg', S.alpha); $('mlw').value = S.mlw; $('mlt').value = S.mlt; $('mlr').value = S.mlr; readouts(); }
  let fullTimer = null; function renderFull() { clearTimeout(fullTimer); fullTimer = setTimeout(() => { quick = false; allDirty(); document.body.style.cursor = 'progress'; setTimeout(() => { render(); document.body.style.cursor = ''; }, 10); }, 80); }
  const bindRange = (id, fn) => { $(id).addEventListener('input', () => { fn(+$(id).value); readouts(); quick = S.worldsN > QUICK_N; allDirty(); render(); if (quick) renderFull(); }); };
  bindRange('kvp', (v) => { S.kvp = v; }); bindRange('top', (v) => { S.top = v; }); bindRange('rate', (v) => { S.rate = v; }); bindRange('cb', (v) => { S.cb = v / 100; }); bindRange('ci', (v) => { S.ci = v / 100; }); bindRange('ts', (v) => { S.ts = v; });
  bindRange('T', (v) => { S.T = v; $('T2').value = v; }); bindRange('min', (v) => { S.min = v; $('min2').value = v; }); bindRange('T2', (v) => { S.T = v; $('T').value = v; }); bindRange('min2', (v) => { S.min = v; $('min').value = v; });
  bindRange('dose', (v) => { S.doseIdx = v; }); bindRange('nw', (v) => { S.nw = v; }); bindRange('nr', (v) => { S.nr = v; }); bindRange('slot', (v) => { S.slot = v / 100; }); bindRange('rmin', (v) => { S.rmin = v / 100; });
  const bindSeg = (id, fn) => { const seg = $(id); seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); fn(b.dataset.v !== undefined ? b.dataset.v : b.dataset.n); readouts(); quick = false; allDirty(); document.body.style.cursor = 'progress'; setTimeout(() => { render(); document.body.style.cursor = ''; }, 10); })); };
  bindSeg('alphaSeg', (v) => { S.alpha = +v; powerCache = {}; }); bindRange('mlw', (v) => { S.mlw = v; }); bindRange('mlt', (v) => { S.mlt = v; }); bindRange('mlr', (v) => { S.mlr = v; });
  bindSeg('shellSeg', (v) => { S.shell = +v; }); bindSeg('tdepSeg', (v) => { S.tdep = +v; }); bindSeg('cutSeg', (v) => { S.cut = +v; }); bindSeg('laneSeg', (v) => { S.lane = v; }); bindSeg('mapMetric', (v) => { S.mapMetric = v; }); bindSeg('worldsSeg', (v) => { S.worldsN = +v; powerCache = {}; rankCache = null; });
  $('reseed').addEventListener('click', () => { S.seed = (S.seed * 7 + 13) % 100003; powerCache = {}; rankCache = null; allDirty(); render(); });
  document.querySelectorAll('.rail button[data-p]').forEach((b) => b.addEventListener('click', () => { S.panel = b.dataset.p; document.querySelectorAll('.rail button[data-p]').forEach((x) => x.setAttribute('aria-current', x === b ? 'true' : 'false')); document.querySelectorAll('.panel').forEach((p) => { p.dataset.active = p.id === 'p-' + S.panel ? 'true' : 'false'; }); try { localStorage.setItem('sicn2.panel', S.panel); } catch (e) {} render(); window.scrollTo({ top: 0 }); }));
  new MutationObserver(() => { mcCache = {}; allDirty(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  renderPresets(); syncControls();
  try { const p = localStorage.getItem('sicn2.panel'); if (p && $('p-' + p)) document.querySelector(`.rail button[data-p="${p}"]`).click(); else render(); } catch (e) { render(); }
})();
