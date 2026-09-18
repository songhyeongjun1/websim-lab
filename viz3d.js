/* WebGL 장면 둘 — (1) 계면 확대: 두 SiCN 막 사이의 결합을 공-막대로 · (2) 시료와 X선: 실리콘 적층에 광자가 박힌다.
   그림자 · 환경광 반사 · ACES 톤매핑. THREE r128 전역.                                                     */
window.VIZ3D = (function () {
  'use strict';
  function mulberry(a) { return function () { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ── 공통: 렌더러 · 카메라 · 궤도 · 환경광 · 라벨 ──────────────
  function base(container, o) {
    const T3 = window.THREE; if (!T3) return null; o = o || {};
    const renderer = new T3.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T3.PCFSoftShadowMap;
    renderer.outputEncoding = T3.sRGBEncoding; renderer.toneMapping = T3.NoToneMapping;
    container.insertBefore(renderer.domElement, container.firstChild); renderer.domElement.style.display = 'block'; renderer.domElement.style.width = '100%';
    const scene = new T3.Scene(); const camera = new T3.PerspectiveCamera(o.fov || 30, 1.6, 0.1, 200);
    // 환경광 — 흰 스튜디오 (PMREM)
    try { const pm = new T3.PMREMGenerator(renderer); const env = new T3.Scene(); const mk = (w, h, x, y, z, c, i) => { const m = new T3.Mesh(new T3.PlaneGeometry(w, h), new T3.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
      env.add(new T3.Mesh(new T3.SphereGeometry(40, 16, 8), new T3.MeshBasicMaterial({ color: 0x9AA8B8, side: T3.BackSide }))); mk(30, 30, 0, 30, 0, 0xFFFFFF); mk(20, 12, 25, 12, 10, 0xFFF4E0); mk(20, 12, -25, 8, -10, 0xE6F0FF); mk(40, 40, 0, -30, 0, 0x30363D);
      scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose(); } catch (e) { /* 환경광 없이 진행 */ }
    scene.add(new T3.HemisphereLight(0xFFFFFF, 0x6B7A8A, 0.7));
    const sun = new T3.DirectionalLight(0xFFFFFF, o.sun || 0.9); sun.position.set(6, 12, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -10; sun.shadow.camera.right = 10; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10; sun.shadow.camera.near = 1; sun.shadow.camera.far = 40; sun.shadow.bias = -0.0008; sun.shadow.radius = 4; scene.add(sun);
    const fill = new T3.DirectionalLight(0xDCE8FF, 0.35); fill.position.set(-8, 5, -6); scene.add(fill);
    const orbit = Object.assign({ az: 0.6, el: 0.42, dist: 17, auto: true, drag: null, min: 8, max: 30 }, o.orbit || {});
    const el = renderer.domElement; el.style.cursor = 'grab'; el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { orbit.drag = { x: e.clientX, y: e.clientY, az: orbit.az, el: orbit.el }; orbit.auto = false; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', (e) => { if (!orbit.drag) return; orbit.az = orbit.drag.az - (e.clientX - orbit.drag.x) * 0.008; orbit.el = Math.min(1.3, Math.max(0.06, orbit.drag.el + (e.clientY - orbit.drag.y) * 0.006)); });
    const stop = () => { orbit.drag = null; el.style.cursor = 'grab'; }; el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    el.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(orbit.max, Math.max(orbit.min, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08))); orbit.auto = false; }, { passive: false });
    const home = orbit.dist; el.addEventListener('dblclick', () => { orbit.auto = true; orbit.dist = home; });
    function label(text, o2) { o2 = o2 || {}; const cv = document.createElement('canvas'); const ctx = cv.getContext('2d'); const fs = o2.fs || 30; ctx.font = `700 ${fs}px "Noto Sans KR", sans-serif`; const w = Math.ceil(ctx.measureText(text).width) + 36, h = fs + 24; cv.width = w * 2; cv.height = h * 2; ctx.scale(2, 2); ctx.font = `700 ${fs}px "Noto Sans KR", sans-serif`;
      ctx.fillStyle = o2.bg || 'rgba(255,255,255,0.88)'; const r = 10; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.quadraticCurveTo(w, 0, w, r); ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h); ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h - r); ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.fill();
      ctx.fillStyle = o2.color || '#00447C'; ctx.textBaseline = 'middle'; ctx.fillText(text, 18, h / 2);
      const tex = new T3.CanvasTexture(cv); tex.encoding = T3.sRGBEncoding; const sp = new T3.Sprite(new T3.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); const sc = o2.scale || 0.0095; sp.scale.set(w * sc, h * sc, 1); sp.renderOrder = 10; return sp; }
    let running = false; const hooks = { frame: null, target: () => [0, 0, 0] };
    function resize() { const w = container.clientWidth || 600, h = Math.max(300, Math.round(w * (o.ratio || 0.62))); renderer.setSize(w, h, false); renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
    window.addEventListener('resize', resize); resize();
    function frame() { if (!running) return; requestAnimationFrame(frame); if (container.offsetParent === null) return; if (orbit.auto && !orbit.drag) orbit.az += 0.0018; const [tx, ty, tz] = hooks.target(); const r = orbit.dist; camera.position.set(tx + r * Math.cos(orbit.el) * Math.sin(orbit.az), ty + r * Math.sin(orbit.el), tz + r * Math.cos(orbit.el) * Math.cos(orbit.az)); camera.lookAt(tx, ty, tz); if (hooks.frame) hooks.frame(); renderer.render(scene, camera); }
    return { T3, renderer, scene, camera, orbit, label, hooks, start() { if (!running) { running = true; resize(); frame(); } }, stop() { running = false; }, resize };
  }

  // ═══ (1) 계면 확대 — 공-막대 ═══════════════════════════════
  const W = 9, D = 6, GAP = 1.5, H_FILM = 1.1;
  function create(container) {
    const B = base(container, { fov: 30, orbit: { az: 0.6, el: 0.42, dist: 17 } }); if (!B) return null; const { T3, scene } = B;
    const G = { atom: new T3.SphereGeometry(1, 28, 20), bond: new T3.CylinderGeometry(1, 1, 1, 14, 1), voidG: new T3.SphereGeometry(1, 24, 16) };
    const phys = (hex, o) => new T3.MeshPhysicalMaterial(Object.assign({ color: new T3.Color(hex), roughness: 0.42, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.3, envMapIntensity: 0.35 }, o || {}));
    const std = (hex, o) => new T3.MeshStandardMaterial(Object.assign({ color: new T3.Color(hex), roughness: 0.6, metalness: 0.05, envMapIntensity: 0.3 }, o || {}));
    const world = new T3.Group(); scene.add(world); let lastKey = ''; const lift = GAP; B.hooks.target = () => [0, lift * 0.5, 0];
    const shadowed = (m, cast, recv) => { m.castShadow = !!cast; m.receiveShadow = !!recv; return m; };
    function atom(parent, x, y, z, r, mat) { const m = new T3.Mesh(G.atom, mat); m.position.set(x, y, z); m.scale.setScalar(r); shadowed(m, true, false); parent.add(m); return m; }
    function bond(parent, a, b, r, mat) { const va = new T3.Vector3(...a), vb = new T3.Vector3(...b); const mid = va.clone().add(vb).multiplyScalar(0.5); const dir = vb.clone().sub(va); const len = dir.length(); const m = new T3.Mesh(G.bond, mat); m.position.copy(mid); m.scale.set(r, len, r); m.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), dir.normalize()); shadowed(m, true, false); parent.add(m); return m; }
    function build(st) {
      while (world.children.length) world.remove(world.children[0]);
      const c = st.colors;
      const M = { si: phys(c.si), o: phys(c.o), h: phys(c.h, { roughness: 0.3 }), bSio: std(c.sio, { roughness: 0.45 }), bOh: std(c.oh, { roughness: 0.45 }), bH: std(c.hbond), e: std('#1B1F25'),
        film: new T3.MeshPhysicalMaterial({ color: new T3.Color(c.film), roughness: 0.75, metalness: 0.0, envMapIntensity: 0.25 }), filmTop: new T3.MeshPhysicalMaterial({ color: new T3.Color(c.film), transparent: true, opacity: 0.42, roughness: 0.35, metalness: 0.0, clearcoat: 0.5, envMapIntensity: 0.3, depthWrite: false }),
        ox: new T3.MeshPhysicalMaterial({ color: new T3.Color(c.oxide), transparent: true, opacity: 0.85, roughness: 0.2, clearcoat: 1 }), voidM: new T3.MeshPhysicalMaterial({ color: new T3.Color(c.voidc), transparent: true, opacity: 0.5, roughness: 0.15, clearcoat: 1, transmission: 0.2 }) };
      const hox = Math.min(0.25, st.oxide_nm * 0.02);
      const bottom = shadowed(new T3.Mesh(new T3.BoxGeometry(W, H_FILM, D), M.film), false, true); bottom.position.set(0, -H_FILM / 2 - hox, 0); world.add(bottom);
      const ground = new T3.Mesh(new T3.PlaneGeometry(40, 40), new T3.ShadowMaterial({ opacity: 0.18 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -H_FILM - hox - 0.01; ground.receiveShadow = true; world.add(ground);
      if (hox > 0.005) { const ob = shadowed(new T3.Mesh(new T3.BoxGeometry(W, hox, D), M.ox), false, true); ob.position.set(0, -hox / 2, 0); world.add(ob); const ot = new T3.Mesh(new T3.BoxGeometry(W, hox, D), M.ox); ot.position.set(0, lift + hox / 2, 0); world.add(ot); }
      const topM = new T3.Mesh(new T3.BoxGeometry(W, H_FILM, D), M.filmTop); topM.position.set(0, lift + hox + H_FILM / 2, 0); world.add(topM);
      const edge = new T3.LineSegments(new T3.EdgesGeometry(new T3.BoxGeometry(W, H_FILM, D)), new T3.LineBasicMaterial({ color: 0x8A94A0, transparent: true, opacity: 0.6 })); edge.position.copy(topM.position); world.add(edge);

      const rng = mulberry(31); const slots = []; const nx = 12, nz = 8;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) slots.push([-W / 2 + (i + 0.5) * W / nx + (rng() - 0.5) * 0.35, -D / 2 + (j + 0.5) * D / nz + (rng() - 0.5) * 0.3]);
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
      let k = 0; const take = () => slots[(k++) % slots.length]; const per = 6e12, n = (v, cap) => Math.min(cap, Math.round(v / per)); const yB = 0, yT = lift;
      for (let i = 0, N = n(st.siloxane, 40); i < N; i++) { const [x, z] = take(); const g = new T3.Group(); bond(g, [x, yB, z], [x, yT, z], 0.055, M.bSio); atom(g, x, yB + 0.08, z, 0.17, M.si); atom(g, x, (yB + yT) / 2, z, 0.15, M.o); atom(g, x, yT - 0.08, z, 0.17, M.si); world.add(g); }
      for (let i = 0, N = n(Math.max(st.silanol - st.siloxane, 0), 40); i < N; i++) { const [x, z] = take(); const up = rng() < 0.5; const y0 = up ? yT : yB, dir = up ? -1 : 1; const g = new T3.Group(); const yO = y0 + dir * 0.55; bond(g, [x, y0, z], [x, yO, z], 0.048, M.bOh); atom(g, x, y0 + dir * 0.06, z, 0.17, M.si); atom(g, x, yO, z, 0.14, M.o); const hx = x + 0.2, hy = yO + dir * 0.14; bond(g, [x, yO, z], [hx, hy, z], 0.03, M.bH); atom(g, hx, hy, z, 0.09, M.h); world.add(g); }
      for (let i = 0, N = n(st.si_h, 20); i < N; i++) { const [x, z] = take(); const up = rng() < 0.5; const y0 = up ? yT : yB, dir = up ? -1 : 1; const g = new T3.Group(); atom(g, x, y0 + dir * 0.06, z, 0.17, M.si); bond(g, [x, y0, z], [x, y0 + dir * 0.4, z], 0.03, M.bH); atom(g, x, y0 + dir * 0.42, z, 0.09, M.h); world.add(g); }
      for (let i = 0, N = n(st.db_left, 24); i < N; i++) { const [x, z] = take(); const up = rng() < 0.5; const y0 = up ? yT : yB, dir = up ? -1 : 1; const g = new T3.Group(); atom(g, x, y0 + dir * 0.06, z, 0.17, M.si); atom(g, x, y0 + dir * 0.3, z, 0.055, M.e); world.add(g); }
      for (let i = 0, N = n(st.water, 20); i < N; i++) { const [x, z] = take(); const y = yB + 0.35 + rng() * (yT - yB - 0.7); const a = rng() * Math.PI * 2; const g = new T3.Group(); atom(g, x, y, z, 0.15, M.o); [a, a + 1.82].forEach((t) => { const hx = x + 0.24 * Math.cos(t), hz = z + 0.24 * Math.sin(t); bond(g, [x, y, z], [hx, y + 0.06, hz], 0.03, M.bH); atom(g, hx, y + 0.06, hz, 0.09, M.h); }); world.add(g); }
      for (let i = 0, N = n(st.h2, 12); i < N; i++) { const [x, z] = take(); const y = yB + 0.3 + rng() * (yT - yB - 0.6); const g = new T3.Group(); bond(g, [x - 0.11, y, z], [x + 0.11, y, z], 0.03, M.bH); atom(g, x - 0.11, y, z, 0.09, M.h); atom(g, x + 0.11, y, z, 0.09, M.h); world.add(g); }
      for (let i = 0, N = Math.min(6, Math.round(st.voidF * 40)); i < N; i++) { const [x, z] = take(); const r = 0.45 + rng() * 0.5; const m = new T3.Mesh(G.voidG, M.voidM); m.position.set(x, (yB + yT) / 2, z); m.scale.set(r, (yT - yB) * 0.42, r * 0.8); m.castShadow = true; world.add(m); }
    }
    return { update(st) { const key = JSON.stringify([Math.round(st.oxide_nm * 10), Math.round(st.siloxane / 6e12), Math.round(st.silanol / 6e12), Math.round(st.water / 6e12), Math.round(st.h2 / 6e12), Math.round(st.si_h / 6e12), Math.round(st.db_left / 6e12), Math.round(st.voidF * 40), st.colors.film]); if (key !== lastKey) { lastKey = key; build(st); } }, start: B.start, stop: B.stop, resize: B.resize };
  }

  // ═══ (2) 시료와 X선 — 실리콘 적층에 광자가 박힌다 ═══════════════
  function createBeam(container) {
    const B = base(container, { fov: 28, ratio: 0.55, orbit: { az: 0.55, el: 0.3, dist: 22, min: 12, max: 40 }, exposure: 0.8 }); if (!B) return null; const { T3, scene } = B;
    const BW = 10, BD = 7; const world = new T3.Group(); scene.add(world); let lastKey = ''; let hSi = 3;
    const photons = { pts: null, data: [], depths: [0.5], pTrans: 0.3, rate: 1, cT: null, cA: null };
    B.hooks.target = () => [0, hSi * 0.35, 0];
    function build(st) {
      while (world.children.length) world.remove(world.children[0]);
      hSi = Math.max(1.6, Math.min(4.2, st.topUm / 160)); const hB = 2.0, hI = 0.26;
      const si = new T3.MeshPhysicalMaterial({ color: new T3.Color('#7D8B9C'), transparent: true, opacity: 0.62, roughness: 0.25, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 0.55, depthWrite: false });
      const siB = new T3.MeshPhysicalMaterial({ color: new T3.Color('#5E6B7A'), roughness: 0.4, metalness: 0.3, clearcoat: 0.5, envMapIntensity: 0.5 });
      const gold = new T3.MeshStandardMaterial({ color: new T3.Color('#B8860B'), emissive: new T3.Color('#E0A82E'), emissiveIntensity: 0.25 + 0.6 * st.frac, roughness: 0.3, metalness: 0.7, envMapIntensity: 0.6 });
      const bottom = new T3.Mesh(new T3.BoxGeometry(BW, hB, BD), siB); bottom.position.set(0, -hB / 2 - hI, 0); bottom.receiveShadow = true; bottom.castShadow = true; world.add(bottom);
      const iface = new T3.Mesh(new T3.BoxGeometry(BW, hI, BD), gold); iface.position.set(0, -hI / 2, 0); world.add(iface);
      const top = new T3.Mesh(new T3.BoxGeometry(BW, hSi, BD), si); top.position.set(0, hSi / 2, 0); world.add(top);
      const edge = new T3.LineSegments(new T3.EdgesGeometry(new T3.BoxGeometry(BW, hSi, BD)), new T3.LineBasicMaterial({ color: 0x5A6B80, transparent: true, opacity: 0.55 })); edge.position.copy(top.position); world.add(edge);
      const ground = new T3.Mesh(new T3.PlaneGeometry(50, 50), new T3.ShadowMaterial({ opacity: 0.32 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -hB - hI - 0.01; ground.receiveShadow = true; world.add(ground);
      // 광원 원뿔 (X선관)
      const cone = new T3.Mesh(new T3.CylinderGeometry(BW * 0.62, 0.6, 5.5, 32, 1, true), new T3.MeshBasicMaterial({ color: new T3.Color(st.colors.blue), transparent: true, opacity: 0.07, side: T3.DoubleSide, depthWrite: false, blending: T3.AdditiveBlending })); cone.position.set(0, hSi + 2.9, 0); world.add(cone);
      const tube = new T3.Mesh(new T3.CylinderGeometry(0.7, 0.7, 0.8, 24), new T3.MeshStandardMaterial({ color: 0x2C3542, metalness: 0.7, roughness: 0.3 })); tube.position.set(0, hSi + 5.9, 0); world.add(tube);
      // 광자 입자
      photons.depths = st.absorbDepths && st.absorbDepths.length ? st.absorbDepths : [0.5]; photons.pTrans = st.transmit; photons.cT = new T3.Color('#1D5FCC'); photons.cA = new T3.Color('#E03A2F');
      if (photons.pts) scene.remove(photons.pts);
      const N = 520; const pos = new Float32Array(N * 3), col = new Float32Array(N * 3); photons.data = [];
      const spawn = (first) => { const x = (Math.random() - 0.5) * BW * 0.9, z = (Math.random() - 0.5) * BD * 0.9; const trans = Math.random() < photons.pTrans; const dfrac = photons.depths[Math.floor(Math.random() * photons.depths.length)]; return { x, z, y: hSi + 2.5 + (first ? Math.random() * 6 : 0), v: 0.05 + Math.random() * 0.04, trans, ystop: trans ? -hB - hI - 0.6 : hSi * (1 - dfrac), flash: 0 }; };
      photons.spawn = spawn; for (let i = 0; i < N; i++) { photons.data.push(spawn(true)); }
      const geo = new T3.BufferGeometry(); geo.setAttribute('position', new T3.BufferAttribute(pos, 3)); geo.setAttribute('color', new T3.BufferAttribute(col, 3));
      const pm2 = new T3.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, depthWrite: false }); pm2.toneMapped = false; photons.pts = new T3.Points(geo, pm2); scene.add(photons.pts);
    }
    B.hooks.frame = () => { if (!photons.pts) return; const pos = photons.pts.geometry.attributes.position.array, col = photons.pts.geometry.attributes.color.array; const hB = 2.0;
      photons.data.forEach((p, i) => { if (p.flash > 0) { p.flash--; if (!p.flash) Object.assign(p, photons.spawn(false)); } else { p.y -= p.v; if (p.y <= p.ystop) { if (p.trans) Object.assign(p, photons.spawn(false)); else p.flash = 16; } }
        const cc = p.flash ? photons.cA : photons.cT; const k = p.flash ? 1.3 : 1; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; col[i * 3] = cc.r * k; col[i * 3 + 1] = cc.g * k; col[i * 3 + 2] = cc.b * k; });
      photons.pts.geometry.attributes.position.needsUpdate = true; photons.pts.geometry.attributes.color.needsUpdate = true; };
    return { update(st) { const key = JSON.stringify([st.kvp, st.cut, st.topUm, Math.round(st.frac * 100), st.colors.si]); if (key !== lastKey) { lastKey = key; build(st); } }, start: B.start, stop: B.stop, resize: B.resize };
  }

  // ═══ (3) 막 구조 — 층 블록을 잘라 벌린 단면 ═══════════════════════
  function createFilm(container, opts) {
    opts = opts || {}; const B = base(container, { fov: 28, ratio: opts.ratio || 0.62, orbit: { az: 0.7, el: 0.38, dist: opts.dist || 20, min: 10, max: 36 } }); if (!B) return null; const { T3, scene } = B;
    const BW = 10, BD = 6.5; const world = new T3.Group(); scene.add(world); let lastKey = ''; let gapY = 1.15;
    const G = { atom: new T3.SphereGeometry(1, 20, 14), bond: new T3.CylinderGeometry(1, 1, 1, 12, 1) };
    B.hooks.target = () => [0, gapY * 0.5, 0];
    const photons = { pts: null, data: [], on: !!opts.rain, yTop: 4, hSi: 0.9 };
    function slab(y0, h, mat) {
      const a = new T3.Mesh(new T3.BoxGeometry(BW / 2, h, BD), mat); a.position.set(-BW / 4, y0 + h / 2, 0); a.castShadow = true; a.receiveShadow = true; world.add(a);
      const b = new T3.Mesh(new T3.BoxGeometry(BW / 2, h, BD / 2), mat); b.position.set(BW / 4, y0 + h / 2, -BD / 4); b.castShadow = true; b.receiveShadow = true; world.add(b);
    }
    function build(st) {
      while (world.children.length) world.remove(world.children[0]);
      const c = st.colors; const std = (hex, o) => new T3.MeshPhysicalMaterial(Object.assign({ color: new T3.Color(hex), roughness: 0.7, metalness: 0.05, envMapIntensity: 0.3 }, o || {}));
      const M = { si: std(c.si, { roughness: 0.3, metalness: 0.35, clearcoat: 0.6 }), bulk: std(new T3.Color(c.bulk).multiplyScalar(0.72).getStyle(), { roughness: 0.9, envMapIntensity: 0.15 }), shell: std(c.shell, { roughness: 0.6 }), ox: std(c.oxide, { roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.9 }),
        atomSi: std('#D9B27C', { clearcoat: 0.8, roughness: 0.4 }), atomO: std('#D64545', { clearcoat: 0.8, roughness: 0.4 }), atomH: std('#F4F4F4', { roughness: 0.3 }), bSio: std(c.sio, { roughness: 0.5 }), bOh: std(c.oh, { roughness: 0.5 }), bH: std('#9AA0A6'), voidM: std(c.voidc, { transparent: true, opacity: 0.55, clearcoat: 1, roughness: 0.15 }) };
      const hSi = 0.9, hBulk = 1.4, hShell = st.shell ? Math.max(0.16, Math.min(0.7, st.ts * 0.03)) : 0, hOx = Math.min(0.22, st.oxide_nm * 0.02);
      let y = 0; if (hOx > 0.005) { slab(y - hOx, hOx, M.ox); y -= hOx; } if (hShell) { slab(y - hShell, hShell, M.shell); y -= hShell; } slab(y - hBulk, hBulk, M.bulk); y -= hBulk; slab(y - hSi, hSi, M.si); const yBot = y - hSi;
      y = gapY; if (hOx > 0.005) { slab(y, hOx, M.ox); y += hOx; } if (hShell) { slab(y, hShell, M.shell); y += hShell; } slab(y, hBulk, M.bulk); y += hBulk; slab(y, hSi, M.si); const yTop = y + hSi;
      const ground = new T3.Mesh(new T3.PlaneGeometry(50, 50), new T3.ShadowMaterial({ opacity: 0.28 })); ground.rotation.x = -Math.PI / 2; ground.position.y = yBot - 0.01; ground.receiveShadow = true; world.add(ground);
      const rng = mulberry(17); const per = 6e12, n = (v, cap) => Math.min(cap, Math.round(v / per));
      const atom = (x, yy, z, r, m) => { const a = new T3.Mesh(G.atom, m); a.position.set(x, yy, z); a.scale.setScalar(r); a.castShadow = true; world.add(a); };
      const bond = (p, q, r, m) => { const va = new T3.Vector3(...p), vb = new T3.Vector3(...q); const mid = va.clone().add(vb).multiplyScalar(0.5); const dir = vb.clone().sub(va); const len = dir.length(); const b = new T3.Mesh(G.bond, m); b.position.copy(mid); b.scale.set(r, len, r); b.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), dir.normalize()); b.castShadow = true; world.add(b); };
      const pos = () => { for (;;) { const x = (rng() - 0.5) * (BW - 0.6), z = (rng() - 0.5) * (BD - 0.6); if (!(x > 0 && z > 0)) return [x, z]; } };
      for (let i = 0, N = n(st.siloxane, 26); i < N; i++) { const [x, z] = pos(); bond([x, 0, z], [x, gapY, z], 0.045, M.bSio); atom(x, 0.07, z, 0.14, M.atomSi); atom(x, gapY / 2, z, 0.12, M.atomO); atom(x, gapY - 0.07, z, 0.14, M.atomSi); }
      for (let i = 0, N = n(Math.max(st.silanol - st.siloxane, 0), 22); i < N; i++) { const [x, z] = pos(); const up = rng() < 0.5; const y0 = up ? gapY : 0, d = up ? -1 : 1; const yO = y0 + d * 0.42; bond([x, y0, z], [x, yO, z], 0.04, M.bOh); atom(x, y0 + d * 0.05, z, 0.14, M.atomSi); atom(x, yO, z, 0.11, M.atomO); bond([x, yO, z], [x + 0.16, yO + d * 0.11, z], 0.025, M.bH); atom(x + 0.16, yO + d * 0.11, z, 0.075, M.atomH); }
      for (let i = 0, N = n(st.water, 14); i < N; i++) { const [x, z] = pos(); const yy = 0.3 + rng() * (gapY - 0.6), a = rng() * 6.28; atom(x, yy, z, 0.12, M.atomO); [a, a + 1.82].forEach((t) => { const hx = x + 0.2 * Math.cos(t), hz = z + 0.2 * Math.sin(t); bond([x, yy, z], [hx, yy + 0.05, hz], 0.025, M.bH); atom(hx, yy + 0.05, hz, 0.075, M.atomH); }); }
      for (let i = 0, N = Math.min(5, Math.round(st.voidF * 40)); i < N; i++) { const [x, z] = pos(); const r = 0.4 + rng() * 0.45; const m = new T3.Mesh(G.atom, M.voidM); m.position.set(x, gapY / 2, z); m.scale.set(r, gapY * 0.42, r * 0.8); world.add(m); }
      if (photons.on) { if (photons.pts) scene.remove(photons.pts); const N = 360; const p3 = new Float32Array(N * 3); photons.data = []; photons.yTop = yTop; photons.hSi = hSi; for (let i = 0; i < N; i++) photons.data.push({ x: (Math.random() - 0.5) * BW, z: (Math.random() - 0.5) * BD, y: yTop + 1 + Math.random() * 7, v: 0.05 + Math.random() * 0.04, stop: yTop - Math.random() * (hSi + 0.3) });
        const geo = new T3.BufferGeometry(); geo.setAttribute('position', new T3.BufferAttribute(p3, 3)); const pm = new T3.PointsMaterial({ color: new T3.Color('#1D5FCC'), size: 0.24, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false }); pm.toneMapped = false; photons.pts = new T3.Points(geo, pm); scene.add(photons.pts); }
    }
    B.hooks.frame = () => { if (!photons.on || !photons.pts) return; const pos = photons.pts.geometry.attributes.position.array; photons.data.forEach((p, i) => { p.y -= p.v; if (p.y < p.stop) { p.y = photons.yTop + 1 + Math.random() * 7; p.x = (Math.random() - 0.5) * BW; p.z = (Math.random() - 0.5) * BD; p.stop = photons.yTop - Math.random() * (photons.hSi + 0.3); } pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; }); photons.pts.geometry.attributes.position.needsUpdate = true; };
    return { update(st) { const key = JSON.stringify([st.shell, st.ts, st.cb, st.ci, Math.round(st.oxide_nm * 10), Math.round(st.siloxane / 6e12), Math.round(st.silanol / 6e12), Math.round(st.water / 6e12), Math.round(st.voidF * 40), st.colors.bulk]); if (key !== lastKey) { lastKey = key; build(st); } }, start: B.start, stop: B.stop, resize: B.resize };
  }
  return { create, createBeam, createFilm };
})();
