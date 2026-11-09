/* OpenNodes reels — the cartoon kit.
 *
 * Everything is drawn from the time `t` (seconds): renderAt(t) rebuilds the frame, so a
 * render is exact and repeatable. A reel registers its beats (voice line, sticker card,
 * draw function); the kit adds the camera punch-ins, the sticker cards and word-by-word
 * subtitles inside the 9:16 safe zone (content x 60–850, y 230–1440).
 *
 * Style: flat fills, a thick ink outline, offset "sticker" shadows, rounded type. The
 * OpenNodes interface is the real one (step cards, coloured ports, links, run marks,
 * the result lamp) redrawn in that style.
 */
(function () {
  const INK = '#1F1B2E';
  const PAPER = '#FFF8EC';
  const C = {
    ink: INK,
    paper: PAPER,
    violet: '#7C5CFF',
    voice: '#A855F7',
    green: '#22C55E',
    red: '#EF4444',
    amber: '#F59E0B',
    yellow: '#FFD84D',
    blue: '#3B82F6',
    sky: '#7DD3FC',
    pink: '#FF8FB1',
    teal: '#2DD4BF',
    orange: '#FF9F43',
    tg: '#2AABEE',
    grey: '#E9E4F5',
  };
  // Step categories, as in the editor's colour rail.
  const CAT = {
    trigger: { color: '#F59E0B', label: 'ЗАПУСК' },
    ai: { color: '#7C5CFF', label: 'ИИ' },
    context: { color: '#A855F7', label: 'КОНТЕКСТ' },
    logic: { color: '#2DD4BF', label: 'ЛОГИКА' },
    message: { color: '#2AABEE', label: 'СООБЩЕНИЕ' },
    data: { color: '#3B82F6', label: 'ДАННЫЕ' },
  };

  // ── Time helpers ────────────────────────────────────────────────────────────
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const p = (t, a, d = 0.4) => clamp((t - a) / d);
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const back = (k) => {
    const c1 = 2.2;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  };
  const wob = (t, amp = 1, speed = 1, phase = 0) => Math.sin((t * speed + phase) * Math.PI * 2) * amp;

  /** How an element comes in at time `a`: returns a CSS transform + opacity. */
  function enter(t, a, kind = 'pop', d = 0.45) {
    const k = p(t, a, d);
    if (t < a) return { tf: 'scale(0)', op: 0 };
    switch (kind) {
      case 'pop':
        return { tf: `scale(${back(k)})`, op: clamp(k * 3) };
      case 'drop':
        return { tf: `translateY(${lerp(-260, 0, back(k))}px)`, op: clamp(k * 3) };
      case 'up':
        return { tf: `translateY(${lerp(220, 0, back(k))}px)`, op: clamp(k * 3) };
      case 'left':
        return { tf: `translateX(${lerp(-700, 0, easeOut(k))}px)`, op: clamp(k * 3) };
      case 'right':
        return { tf: `translateX(${lerp(700, 0, easeOut(k))}px)`, op: clamp(k * 3) };
      default:
        return { tf: 'none', op: k };
    }
  }

  /** An absolutely placed box. `css` is extra inline style. */
  function box(x, y, inner, { w, h, tf = '', op = 1, css = '', cls = '', origin = 'center' } = {}) {
    if (op <= 0) return '';
    const size = `${w ? `width:${w}px;` : ''}${h ? `height:${h}px;` : ''}`;
    return `<div class="abs ${cls}" style="left:${x}px;top:${y}px;${size}transform:${tf || 'none'};transform-origin:${origin};opacity:${op};${css}">${inner}</div>`;
  }
  const at = (t, a, kind, x, y, inner, o = {}) => {
    const e = enter(t, a, kind, o.d);
    return box(x, y, inner, { ...o, tf: `${e.tf} ${o.tf ?? ''}`, op: e.op * (o.op ?? 1) });
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ── Characters ──────────────────────────────────────────────────────────────
  const HAIR = {
    bob: (c) =>
      `<path d="M58 150 Q50 40 180 34 Q310 40 302 150 L300 238 Q276 196 270 120 Q180 96 90 120 Q84 196 60 238 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    bun: (c) =>
      `<circle cx="180" cy="34" r="46" fill="${c}" stroke="${INK}" stroke-width="8"/><path d="M62 160 Q56 54 180 50 Q304 54 298 160 Q270 104 180 100 Q90 104 62 160 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    short: (c) =>
      `<path d="M64 150 Q60 46 180 44 Q300 46 296 150 Q286 96 240 92 Q200 112 150 98 Q96 100 64 150 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    curly: (c) =>
      `<g fill="${c}" stroke="${INK}" stroke-width="8">${[
        [80, 110], [118, 70], [168, 54], [220, 58], [266, 80], [292, 122], [70, 160], [296, 168],
      ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="40"/>`).join('')}</g>`,
    long: (c) =>
      `<path d="M52 170 Q44 40 180 36 Q316 40 308 170 L314 330 Q280 300 276 140 Q180 108 84 140 Q80 300 46 330 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    cap: (c) =>
      `<path d="M66 128 Q70 40 180 38 Q290 40 294 128 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M180 120 L330 132 Q332 150 300 152 L180 146 Z" fill="${c}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
  };

  /**
   * A character bust (360×440). o: skin, hair, hairColor, shirt, acc ('apron', 'glasses',
   * 'headset', 'beard', 'tie'), expr ('happy', 'tired', 'surprised', 'sleep', 'neutral',
   * 'sad', 'angry'), talk (true → the mouth moves), look (-1…1).
   */
  function person(o, t) {
    const skin = o.skin ?? '#FFD3B0';
    const look = (o.look ?? 0) * 10;
    const blink = o.expr !== 'sleep' && (t + (o.seed ?? 0)) % 3.1 < 0.12;
    const eyeY = 196;
    let eyes;
    if (o.expr === 'sleep' || blink)
      eyes = `<path d="M120 ${eyeY} q20 14 40 0 M200 ${eyeY} q20 14 40 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    else if (o.expr === 'tired')
      eyes = `<g fill="${INK}"><ellipse cx="${140 + look}" cy="${eyeY + 6}" rx="11" ry="9"/><ellipse cx="${220 + look}" cy="${eyeY + 6}" rx="11" ry="9"/></g><path d="M118 ${eyeY - 4} h44 M198 ${eyeY - 4} h44" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    else {
      const r = o.expr === 'surprised' ? 17 : 13;
      eyes = `<g fill="#fff" stroke="${INK}" stroke-width="6"><circle cx="140" cy="${eyeY}" r="${r + 7}"/><circle cx="220" cy="${eyeY}" r="${r + 7}"/></g><g fill="${INK}"><circle cx="${140 + look}" cy="${eyeY + 2}" r="${r - 3}"/><circle cx="${220 + look}" cy="${eyeY + 2}" r="${r - 3}"/></g>`;
    }
    const brows =
      o.expr === 'angry'
        ? `<path d="M116 160 l46 14 M244 160 l-46 14" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`
        : o.expr === 'sad' || o.expr === 'tired'
          ? `<path d="M118 166 l42 -8 M242 166 l-42 -8" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`
          : o.expr === 'surprised'
            ? `<path d="M118 150 q22 -14 44 0 M198 150 q22 -14 44 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`
            : `<path d="M120 160 q20 -8 40 0 M200 160 q20 -8 40 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    const open = o.talk ? Math.abs(wob(t, 1, 5.3)) : 0;
    let mouth;
    if (o.expr === 'surprised') mouth = `<ellipse cx="180" cy="262" rx="18" ry="24" fill="${INK}"/>`;
    else if (o.expr === 'sad' || o.expr === 'angry')
      mouth = `<path d="M150 272 q30 -22 60 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    else if (o.expr === 'sleep') mouth = `<path d="M166 262 q14 8 28 0" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
    else if (o.talk)
      mouth = `<path d="M146 252 q34 ${18 + open * 22} 68 0 Z" fill="${INK}"/><path d="M160 ${258 + open * 8} q20 ${6 + open * 6} 40 0" fill="#FF7A8A"/>`;
    else if (o.expr === 'tired') mouth = `<path d="M152 262 h56" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    else mouth = `<path d="M142 250 q38 40 76 0" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
    const cheeks = o.expr === 'happy' || !o.expr ? `<g fill="#FF8FA3" opacity=".55"><ellipse cx="104" cy="236" rx="20" ry="12"/><ellipse cx="256" cy="236" rx="20" ry="12"/></g>` : '';
    const acc = o.acc ?? [];
    const has = (a) => acc.includes(a);
    const glasses = has('glasses')
      ? `<g fill="none" stroke="${INK}" stroke-width="7"><rect x="108" y="172" width="64" height="50" rx="16"/><rect x="188" y="172" width="64" height="50" rx="16"/><path d="M172 194 h16"/></g>`
      : '';
    const beard = has('beard')
      ? `<path d="M84 210 Q90 330 180 334 Q270 330 276 210 Q250 290 180 292 Q110 290 84 210 Z" fill="${o.hairColor ?? '#4A3426'}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`
      : '';
    const headset = has('headset')
      ? `<path d="M64 196 Q64 60 180 60 Q296 60 296 196" fill="none" stroke="${INK}" stroke-width="12"/><rect x="44" y="176" width="36" height="64" rx="14" fill="${C.violet}" stroke="${INK}" stroke-width="7"/><path d="M66 238 Q90 300 150 292" fill="none" stroke="${INK}" stroke-width="8"/>`
      : '';
    const shirt = o.shirt ?? C.blue;
    const body = `<path d="M30 440 Q34 340 120 318 L240 318 Q326 340 330 440 Z" fill="${shirt}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`;
    const apron = has('apron')
      ? `<path d="M110 440 L120 340 Q180 356 240 340 L250 440 Z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M150 380 h60" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`
      : '';
    const tie = has('tie') ? `<path d="M170 322 L190 322 L198 400 L180 420 L162 400 Z" fill="${C.red}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` : '';
    const hair = (HAIR[o.hair ?? 'short'] ?? HAIR.short)(o.hairColor ?? '#5B3A29');
    const zz = o.expr === 'sleep' ? `<text x="290" y="${90 - (t % 1.5) * 30}" font-size="54" font-weight="900" fill="${INK}" opacity="${1 - (t % 1.5) / 1.5}">z</text>` : '';
    return `<svg viewBox="0 0 360 440" width="${o.size ?? 360}" style="overflow:visible">
      ${o.hair === 'long' ? hair : ''}
      ${body}${apron}${tie}
      <rect x="150" y="280" width="60" height="50" fill="${skin}" stroke="${INK}" stroke-width="8"/>
      <ellipse cx="180" cy="200" rx="122" ry="132" fill="${skin}" stroke="${INK}" stroke-width="8"/>
      ${beard}${cheeks}${eyes}${brows}${mouth}${glasses}
      ${o.hair === 'long' ? '' : hair}${headset}${zz}
    </svg>`;
  }

  /** A friendly robot (the AI), 300×340. mood: 'type', 'happy', 'sad', 'stiff'. */
  function robot(t, o = {}) {
    const bob = wob(t, 6, 1.2);
    const eye = o.mood === 'sad' ? `<path d="M96 132 h36 M168 132 h36" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>` : `<g fill="${C.sky}" stroke="${INK}" stroke-width="6"><circle cx="114" cy="132" r="22"/><circle cx="186" cy="132" r="22"/></g><g fill="${INK}"><circle cx="114" cy="134" r="8"/><circle cx="186" cy="134" r="8"/></g>`;
    const mouth = o.mood === 'stiff' ? `<rect x="110" y="172" width="80" height="16" rx="4" fill="${INK}"/><path d="M126 172 v16 M142 172 v16 M158 172 v16 M174 172 v16" stroke="#fff" stroke-width="4"/>` : `<path d="M112 172 q38 28 76 0" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>`;
    const arms = o.mood === 'type' ? `<path d="M40 260 l${-10 + wob(t, 10, 6)} 40 M260 260 l${10 + wob(t, 10, 6, 0.5)} 40" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>` : `<path d="M40 250 l-30 ${30 + bob} M260 250 l30 ${30 - bob}" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>`;
    return `<svg viewBox="0 0 300 340" width="${o.size ?? 300}" style="overflow:visible;transform:translateY(${bob}px)">
      <path d="M150 20 v40" stroke="${INK}" stroke-width="10"/><circle cx="150" cy="18" r="16" fill="${C.red}" stroke="${INK}" stroke-width="7"/>
      <rect x="50" y="60" width="200" height="160" rx="48" fill="${o.color ?? '#D9DEFF'}" stroke="${INK}" stroke-width="8"/>
      ${eye}${mouth}${arms}
      <rect x="70" y="226" width="160" height="100" rx="34" fill="${o.color ?? '#D9DEFF'}" stroke="${INK}" stroke-width="8"/>
      <circle cx="150" cy="276" r="16" fill="${C.violet}" stroke="${INK}" stroke-width="6"/>
    </svg>`;
  }

  /** One of the three nodes from the app icon, alive (mascot). */
  function buddy(t, o = {}) {
    const s = o.size ?? 200;
    const sq = 1 + wob(t, 0.04, 1.6, o.seed ?? 0);
    const blink = (t + (o.seed ?? 0)) % 2.7 < 0.12;
    const eyes = blink
      ? `<path d="M64 96 h28 M128 96 h28" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`
      : `<g fill="#fff"><ellipse cx="78" cy="96" rx="16" ry="20"/><ellipse cx="142" cy="96" rx="16" ry="20"/></g><g fill="${INK}"><circle cx="${82 + (o.look ?? 0) * 6}" cy="100" r="8"/><circle cx="${146 + (o.look ?? 0) * 6}" cy="100" r="8"/></g>`;
    return `<svg viewBox="0 0 220 220" width="${s}" style="overflow:visible;transform:scale(${sq},${2 - sq})">
      <path d="M44 20 H176 Q200 20 200 44 V176 Q200 200 176 200 H44 Q20 200 20 176 V44 Q20 20 44 20 Z" fill="${o.color ?? '#2A2A2F'}" stroke="${INK}" stroke-width="8"/>
      ${eyes}<path d="M84 140 q26 22 52 0" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
    </svg>`;
  }

  // ── The OpenNodes interface, cartoon style ───────────────────────────────────
  /**
   * A step card (w 560 × h 150). state: 'idle', 'active' (pulses), 'ok', 'fail', 'held'.
   * port: data input/output dots; ctx: true → diamond (voice, template).
   */
  /** Lines a text takes in a box `width` px wide at font size `fs` (word wrap, rounded type). */
  function wrapLines(text, width, fs, k = 0.64) {
    const per = Math.max(4, Math.floor(width / (fs * k)));
    let lines = 1;
    let len = 0;
    for (const w of String(text).split(/\s+/)) {
      if (len && len + 1 + w.length > per) {
        lines++;
        len = w.length;
      } else len += (len ? 1 : 0) + w.length;
    }
    return lines;
  }
  /** The height a step card needs for its title and subtitle (ports sit on its edges). */
  function nodeH(o) {
    const w = o.w ?? 560;
    const fs = o.fs ?? 34;
    const inner = w - 40 - 24 - 14;
    const title = wrapLines(o.title, inner, fs) * fs * 1.12;
    const sub = o.sub ? 6 + wrapLines(o.sub, inner, 26) * 26 * 1.18 : 0;
    const tags = o.tags?.length ? 52 : 0;
    return Math.max(o.h ?? 0, Math.ceil(14 + 16 + 34 + 8 + title + sub + tags + 22));
  }

  function node(t, o) {
    const cat = CAT[o.cat ?? 'logic'];
    const w = o.w ?? 560;
    const pulse = o.state === 'active' ? 0.5 + 0.5 * Math.sin(t * Math.PI * 4) : 0;
    const glow =
      o.state === 'active'
        ? `box-shadow:0 10px 0 ${INK},0 0 0 ${8 + pulse * 14}px ${cat.color}55;`
        : o.state === 'ok'
          ? `box-shadow:0 10px 0 ${INK},0 0 0 8px ${C.green}55;`
          : o.state === 'fail'
            ? `box-shadow:0 10px 0 ${INK},0 0 0 8px ${C.red}55;`
            : `box-shadow:0 10px 0 ${INK};`;
    const mark =
      o.state === 'ok'
        ? `<div class="mark" style="background:${C.green}">✓</div>`
        : o.state === 'fail'
          ? `<div class="mark" style="background:${C.red}">✕</div>`
          : o.state === 'held'
            ? `<div class="mark" style="background:${C.amber}">■</div>`
            : '';
    const tags = (o.tags ?? []).map((g) => `<span class="tag" style="background:${g.c ?? '#fff'}">${esc(g.t)}</span>`).join('');
    const size = `height:${nodeH(o)}px;${o.fs ? `--ttl:${o.fs}px;` : ''}`;
    return `<div class="node ${o.ctx ? 'node-ctx' : ''}" style="width:${w}px;${size}${glow}">
      <div class="rail" style="background:${cat.color}"></div>
      <div class="kick"><span class="ico" style="background:${cat.color}">${o.icon ?? ''}</span>${esc(o.kicker ?? cat.label)}</div>
      <div class="ttl">${esc(o.title)}</div>
      ${o.sub ? `<div class="sub">${esc(o.sub)}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${o.in !== false ? `<div class="port in ${o.ctx ? 'dia' : ''}" style="background:${cat.color}"></div>` : ''}
      ${o.out !== false ? `<div class="port out ${o.ctx ? 'dia' : ''}" style="background:${cat.color}"></div>` : ''}
      ${mark}
    </div>`;
  }

  /** A link between two points (vertical S-curve), drawn with a flowing dash when `flow`. */
  function link(t, x1, y1, x2, y2, o = {}) {
    const k = o.draw === undefined ? 1 : clamp(o.draw);
    if (k <= 0) return '';
    const my = (y1 + y2) / 2;
    const d = o.ctx
      ? `M${x1} ${y1} C${x1} ${y2} ${x1} ${y2} ${x2} ${y2}`
      : o.side
        ? `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`
        : `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
    const len = Math.hypot(x2 - x1, y2 - y1) * 1.4 + 60;
    const color = o.color ?? INK;
    const dash = o.dashed ? `stroke-dasharray="18 14"` : '';
    const flow = o.flow
      ? `<path d="${d}" fill="none" stroke="${o.flowColor ?? C.yellow}" stroke-width="10" stroke-linecap="round" stroke-dasharray="20 30" stroke-dashoffset="${-t * 160}"/>`
      : '';
    const label = o.label
      ? `<text x="${(o.ctx ? x1 : (x1 + x2) / 2) + (o.labelDx ?? 18)}" y="${o.ctx ? y2 - 22 : my - 12}" font-size="34" font-weight="900" fill="${color}" stroke="${PAPER}" stroke-width="10" paint-order="stroke">${esc(o.label)}</text>`
      : '';
    return `<svg class="abs" style="left:0;top:0;overflow:visible" width="1080" height="1920">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" ${dash} stroke-dasharray="${o.dashed ? '18 14' : len}" stroke-dashoffset="${o.dashed ? 0 : len * (1 - k)}" opacity="${o.dashed ? k : 1}"/>
      ${k >= 1 ? flow : ''}${k >= 1 ? label : ''}
    </svg>`;
  }

  /**
   * A board: steps [{id, x, y, w, h, at, enter, …node props}] and links
   * [{from, to, at, flow, ctx, label}]. Links run port to port and sit under the cards;
   * a context link (voice, template) runs from the card's bottom into the target's side.
   */
  function board(t, steps, links = []) {
    // A step with `after: id` stands under that step (gap 64 px), whatever its height.
    const S = {};
    steps = steps.map((st) => {
      const placed = st.after && S[st.after] ? { ...st, y: S[st.after].y + nodeH(S[st.after]) + (st.gap ?? 64) } : st;
      S[placed.id] = placed;
      return placed;
    });
    let html = '';
    for (const l of links) {
      const a = S[l.from];
      const b = S[l.to];
      if (!a || !b || t < (a.at ?? -1) || t < (b.at ?? -1)) continue;
      const x1 = a.x + a.w / 2 + (l.dx1 ?? 0);
      const y1 = a.y + nodeH(a);
      const x2 = l.ctx ? b.x + b.w : b.x + b.w / 2 + (l.dx2 ?? 0);
      const y2 = l.ctx ? b.y + nodeH(b) / 2 : b.y;
      html += link(t, x1, y1, x2, y2, {
        ...l,
        color: l.ctx ? C.voice : l.color,
        dashed: l.ctx || l.dashed,
        label: l.label ?? (l.ctx ? 'голос' : undefined),
        labelDx: l.ctx ? 14 : l.labelDx,
        draw: l.at === undefined ? 1 : p(t, l.at, 0.3),
      });
    }
    for (const st of steps) html += at(t, st.at ?? -1, st.enter ?? 'drop', st.x, st.y, node(t, st), { d: st.d });
    return html;
  }

  /**
   * A board whose steps light up with the story: a step with `beat: n` pulses during beat
   * n and has its ✓ after it. Steps appear from beat `o.from` (staggered); links draw once
   * both ends are there and carry the flowing dash once their target has run.
   */
  function pipeline(t, c, steps, links = [], o = {}) {
    const from = c.B[o.from ?? 0];
    const S = steps.map((s, k) => ({
      ...s,
      at: s.at ?? from + 0.12 + k * 0.22,
      state: s.state ?? (s.beat === undefined || c.i < s.beat ? 'idle' : c.i === s.beat ? 'active' : 'ok'),
    }));
    const L = links.map((l) => {
      const a = S.find((x) => x.id === l.from);
      const b = S.find((x) => x.id === l.to);
      return { ...l, at: l.at ?? Math.max(a.at, b.at) + 0.25, flow: l.flow ?? (b.beat !== undefined && c.i >= b.beat) };
    });
    return board(t, S, L);
  }

  /** The closing ask: a template card, “Take the template”, the keyword as a comment. */
  function cta(t, a, o) {
    return (
      at(t, a, 'up', 70, 530, paper({ w: 760, title: o.title, lines: o.lines, pt: 38, ph: 42 })) +
      at(t, a + 0.35, 'pop', 230, 900, `<div class="btn" style="font-size:52px;background:${C.yellow}">${o.button ?? 'Взять шаблон'}</div>`) +
      (o.keyword ? at(t, a + 0.7, 'pop', 110, 1060, `<div class="bub in big" style="font-size:50px">💬 ${o.keyword}</div>`) : '') +
      box(470, 960, burst(t, a + 0.4))
    );
  }

  /** The result next to “Test”: Running / Success / Error, with a blinking lamp. */
  function lamp(t, kind) {
    const c = { ok: C.green, fail: C.red, run: C.amber }[kind];
    const text = { ok: 'Успех', fail: 'Ошибка ▾', run: 'Выполняется' }[kind];
    const on = 0.55 + 0.45 * Math.sin(t * Math.PI * 3);
    return `<div class="lamp" style="color:${c}"><span class="dot" style="background:${c};opacity:${on};box-shadow:0 0 ${18 * on}px ${c}"></span>${text}</div>`;
  }
  const testBtn = (pressed) => `<div class="btn ${pressed ? 'pressed' : ''}">▶ Проверить</div>`;

  /** A phone (w 420) with a chat: msgs [{side:'in'|'out', text, at}] appear at `at`. */
  function phone(t, o) {
    const msgs = (o.msgs ?? [])
      .filter((m) => t >= m.at)
      .map((m) => {
        const e = enter(t, m.at, 'pop', 0.35);
        if (m.typing) return `<div class="bub in" style="transform:${e.tf}"><span class="typing">${[0, 1, 2].map((i) => `<i style="opacity:${0.3 + 0.7 * Math.abs(Math.sin((t * 3 + i * 0.3) * Math.PI))}"></i>`).join('')}</span></div>`;
        const btns = m.buttons ? `<div class="bbtns">${m.buttons.map((b) => `<span class="${b.pressed && t >= b.pressed ? 'pressed' : ''}">${esc(b.t)}</span>`).join('')}</div>` : '';
        return `<div class="bub ${m.side}" style="transform:${e.tf};${m.color ? `background:${m.color};` : ''}">${m.html ?? esc(m.text)}${btns}</div>`;
      })
      .join('');
    const shake = o.buzz && t >= o.buzz && t < o.buzz + 0.6 ? wob(t, 8, 14) : 0;
    return `<div class="phone" style="transform:rotate(${(o.rot ?? 0) + shake}deg)">
      <div class="notch"></div>
      <div class="chathead"><span class="av" style="background:${o.avatar ?? C.tg}">${o.avatarText ?? ''}</span>${esc(o.title ?? '')}</div>
      <div class="chat">${msgs}</div>
    </div>`;
  }

  /** Sticker text (the on-screen card). */
  function sticker(text, o = {}) {
    return `<div class="sticker" style="background:${o.bg ?? C.yellow};color:${o.color ?? INK};transform:rotate(${o.rot ?? -2}deg);font-size:${o.size ?? (String(text).length > 17 ? 62 : 74)}px">${esc(text)}</div>`;
  }
  const chip = (text, bg = '#fff', o = {}) => `<span class="chip" style="background:${bg};font-size:${o.size ?? 36}px">${esc(text)}</span>`;
  const emoji = (e, s = 120) => `<span class="emo" style="font-size:${s}px">${e}</span>`;

  /** Analog wall clock; time 'HH:MM' or minutes since midnight. */
  function clock(time, o = {}) {
    const m = typeof time === 'number' ? time : Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
    const ha = ((m / 60) % 12) * 30;
    const ma = (m % 60) * 6;
    const s = o.size ?? 220;
    return `<svg viewBox="0 0 220 220" width="${s}" style="overflow:visible">
      <circle cx="110" cy="110" r="96" fill="${o.face ?? '#fff'}" stroke="${INK}" stroke-width="10"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `<circle cx="${110 + 76 * Math.sin((i * Math.PI) / 6)}" cy="${110 - 76 * Math.cos((i * Math.PI) / 6)}" r="${i % 3 ? 4 : 7}" fill="${INK}"/>`).join('')}
      <path d="M110 110 L${110 + 46 * Math.sin((ha * Math.PI) / 180)} ${110 - 46 * Math.cos((ha * Math.PI) / 180)}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
      <path d="M110 110 L${110 + 68 * Math.sin((ma * Math.PI) / 180)} ${110 - 68 * Math.cos((ma * Math.PI) / 180)}" stroke="${o.hand ?? C.red}" stroke-width="8" stroke-linecap="round"/>
      <circle cx="110" cy="110" r="10" fill="${INK}"/>
    </svg>`;
  }
  const digital = (text, o = {}) => `<div class="digital" style="color:${o.color ?? C.red};font-size:${o.size ?? 110}px">${esc(text)}</div>`;

  /** A card with lines of text (article, post, order, email…). */
  function paper(o) {
    return `<div class="paper" style="width:${o.w ?? 300}px;background:${o.bg ?? '#fff'};transform:rotate(${o.rot ?? 0}deg);${o.pt ? `--pt:${o.pt}px;` : ''}${o.ph ? `--ph:${o.ph}px;` : ''}">
      ${o.title ? `<div class="ptitle">${esc(o.title)}</div>` : ''}
      ${(o.lines ?? [80, 95, 60]).map((w) => (typeof w === 'number' ? `<div class="pline" style="width:${w}%"></div>` : `<div class="ptext">${esc(w)}</div>`)).join('')}
      ${o.badge ? `<div class="pbadge" style="background:${o.badge.c}">${esc(o.badge.t)}</div>` : ''}
    </div>`;
  }

  /** Little burst of lines around a point (a "pop" accent). */
  function burst(t, a, color = C.yellow, r = 90) {
    const k = p(t, a, 0.35);
    if (k <= 0 || k >= 1) return '';
    return `<svg width="${r * 2 + 80}" height="${r * 2 + 80}" style="overflow:visible;position:absolute;left:${-r - 40}px;top:${-r - 40}px">${[0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => {
        const ang = (i * Math.PI) / 4;
        const r1 = r * (0.6 + k * 0.6);
        const r2 = r1 + 40 * (1 - k);
        const cx = r + 40;
        return `<path d="M${cx + r1 * Math.cos(ang)} ${cx + r1 * Math.sin(ang)} L${cx + r2 * Math.cos(ang)} ${cx + r2 * Math.sin(ang)}" stroke="${color}" stroke-width="10" stroke-linecap="round" opacity="${1 - k}"/>`;
      })
      .join('')}</svg>`;
  }

  /** Background: a flat colour with soft cartoon blobs; night darkens it. */
  function bg(color, o = {}) {
    const blobs = (o.blobs ?? 'rgba(255,255,255,.35)');
    return `<div class="bg" style="background:${color}">
      <svg width="1080" height="1920" class="abs" style="left:0;top:0">
        <circle cx="120" cy="300" r="180" fill="${blobs}"/><circle cx="980" cy="760" r="240" fill="${blobs}"/>
        <circle cx="200" cy="1500" r="220" fill="${blobs}"/><circle cx="900" cy="1800" r="160" fill="${blobs}"/>
        ${o.stars ? [[160, 520], [820, 400], [640, 220], [300, 980], [940, 1180], [120, 1260], [720, 1560]].map(([x, y], i) => `<path d="M${x} ${y - 18} L${x + 6} ${y - 6} L${x + 18} ${y} L${x + 6} ${y + 6} L${x} ${y + 18} L${x - 6} ${y + 6} L${x - 18} ${y} L${x - 6} ${y - 6} Z" fill="#FFE98A" opacity="${0.5 + 0.5 * Math.sin(i + (o.t ?? 0) * 3)}"/>`).join('') : ''}
      </svg>
    </div>`;
  }

  // ── The reel: beats, camera, sticker cards, subtitles ───────────────────────
  const WORD = 0.4; // seconds per spoken word (150 wpm), the same timing as the script doc
  const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

  function reel(def) {
    // With a voiceover, each beat lasts as long as its spoken line (+ a short breath);
    // render.mjs passes the measured lengths as ?durs=…
    const q = new URLSearchParams(location.search);
    const durs = (q.get('durs') ?? '').split(',').filter(Boolean).map(Number);
    // When each spoken word starts, per beat (from speech recognition of the voiceover).
    const wordTimes = (q.get('wt') ?? '').split(';').map((b) => b.split(',').filter(Boolean).map(Number));
    let start = 0;
    const beats = def.beats.map((b, k) => {
      const dur = durs[k] ? Math.max(1.2, durs[k] + 0.22) : Math.max(1.6, words(b.vo).length * WORD);
      const beat = { ...b, start, dur, times: wordTimes[k]?.length ? wordTimes[k] : null };
      start += dur;
      return beat;
    });
    const tail = def.tail ?? 0.4; // a short hold so the last line can be read
    const duration = start + tail;
    const B = beats.map((b) => b.start);
    window.REEL_DURATION = duration;
    window.REEL_BEATS = beats;

    window.renderAt = function (t) {
      const i = Math.max(0, beats.findIndex((b, j) => t >= b.start && (j === beats.length - 1 || t < beats[j + 1].start)));
      const beat = beats[i];
      const lt = t - beat.start;
      // Camera: a punch-in on every beat change (not on the very first frame — it moves already).
      const kick = i === 0 ? 1.04 - 0.04 * easeOut(p(t, 0, 0.6)) : 1 + 0.07 * (1 - easeOut(p(lt, 0, 0.32)));
      const cam = def.camera?.(t, i) ?? '';
      const scene = def.draw(t, { B, i, lt, beat, beats, duration });
      // Sticker card: from the beat's start, popping in; the hook card is up at frame 1.
      const card = beat.card
        ? box(60, 250, sticker(beat.card, beat.cardStyle ?? def.cardStyle ?? {}), {
            w: 790,
            css: 'display:flex;justify-content:center',
            tf: `scale(${i === 0 ? 1 + wob(t, 0.015, 1.4) : back(p(lt, 0, 0.35))})`,
            op: i === 0 ? 1 : clamp(p(lt, 0, 0.12) * 3),
          })
        : '';
      // Subtitles: the beat's words appear one by one; the current word is highlighted.
      const ws = beat.vo.split(/\s+/);
      const spoken = words(beat.vo).length;
      let n = 0;
      // With word times: a word shows when it is said (the subtitle words are spread over the
      // spoken ones — “9:00” may be said as two words). Without: evenly through the beat.
      let shown = clamp(lt / Math.max(beat.dur - 0.2, 0.4)) * spoken;
      if (beat.times) {
        // The voice starts 80 ms into the beat; a word shows a touch before it is said.
        const said = beat.times.filter((x) => x <= lt - 0.08 + 0.06).length;
        const c = said ? Math.max(1, Math.round((spoken * said) / beat.times.length)) : 0;
        shown = c - 0.999; // c words visible, the c-th one highlighted
      }
      const sub = ws
        .map((w) => {
          const counts = /[\p{L}\p{N}]/u.test(w);
          const idx = counts ? n++ : n;
          const vis = idx < shown + 0.999;
          const cur = counts && idx === Math.floor(Math.min(shown, spoken - 1e-6));
          return `<span class="w ${cur ? 'cur' : ''}" style="opacity:${vis ? 1 : 0.0}">${esc(w)}</span>`;
        })
        .join(' ');
      document.getElementById('stage').innerHTML = `
        ${scene.bg ?? ''}
        <div class="world" style="transform:scale(${kick}) ${cam}">${scene.html}</div>
        ${card}
        <div class="subs"><div class="subbox">${sub}</div></div>
        ${def.brand !== false ? `<div class="brandmark"><img src="logo-mark.svg" width="54" height="54" alt="">OpenNodes</div>` : ''}`;
    };
    window.renderAt(0);
  }

  window.K = {
    C, CAT, INK, PAPER, clamp, lerp, p, easeOut, easeInOut, back, wob, enter, box, at, esc,
    person, robot, buddy, node, nodeH, link, board, pipeline, cta, lamp, testBtn, phone, sticker, chip, emoji, clock,
    digital, paper, burst, bg, reel,
  };
})();
