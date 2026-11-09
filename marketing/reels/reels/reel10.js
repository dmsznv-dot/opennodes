/* Reel 10 — «Живёт на вашем Mac». Маскоты — три ноды из иконки OpenNodes.
 * Редактор: блоки, цветные входы, «Проверить» по шагам, лампочка, данные на Mac. */
(() => {
  const { C, at, box, buddy, pipeline, node, lamp, testBtn, chip, emoji, bg, paper, p, easeOut, lerp, back, wob, burst } = K;
  const SKY = '#DCEBFF';
  const PAPERBG = '#F4F0FF';
  const COLORS = ['#2A2A2F', '#7C5CFF', '#2DD4BF'];

  /** The Mac dock with the OpenNodes icon; the buddies jump out of it (k: 0 in the icon → 1 out). */
  const dock = (t, k) => {
    const icons = ['#FF8FB1', '#7DD3FC', null, '#FFD84D', '#B8F5C9'];
    const hop = k > 0 && k < 1 ? Math.sin(k * Math.PI) * 30 : 0;
    let html = box(80, 1080, `<div style="width:700px;height:150px;background:rgba(255,255,255,.75);border:7px solid ${C.ink};border-radius:44px;box-shadow:0 10px 0 ${C.ink}"></div>`);
    icons.forEach((col, n) => {
      const x = 120 + n * 132;
      html += col
        ? box(x, 1102, `<div style="width:106px;height:106px;border-radius:28px;background:${col};border:6px solid ${C.ink}"></div>`)
        : box(x - 6, 1096 - hop, `<img src="logo-mark.svg" width="118" height="118" alt="">`);
    });
    // The buddies: from the icon (x≈384, y≈1150) up to their places.
    const places = [
      [140, 560],
      [400, 500],
      [640, 600],
    ];
    places.forEach(([x, y], n) => {
      const m = easeOut(clamp01((k - n * 0.12) / 0.7));
      if (m <= 0) return;
      html += box(lerp(390, x, m), lerp(1120, y, m) - Math.sin(m * Math.PI) * 180, buddy(t, { color: COLORS[n], size: lerp(60, 200, m), seed: n }));
    });
    return html;
  };
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const cloud = (t, k) =>
    k >= 1 ? '' : box(lerp(600, 1000, k), lerp(470, 300, k), emoji('☁️', lerp(200, 60, k)), { op: 1 - k });

  K.reel({
    brand: true,
    beats: [
      { vo: 'Автоматизация, которая живёт на вашем Mac.', card: 'НА ВАШЕМ MAC' },
      { vo: 'А не в чужом облаке.' },
      { vo: 'OpenNodes — это сценарии из блоков. Без кода.', card: 'СЦЕНАРИИ БЕЗ КОДА', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Перетащите шаг на доску и соедините стрелкой.', card: 'ПЕРЕТАЩИ И СОЕДИНИ', cardStyle: { bg: C.orange } },
      { vo: 'Цветные входы сами подсказывают, что куда.', card: 'ВХОДЫ ПОДСКАЗЫВАЮТ', cardStyle: { bg: C.sky } },
      { vo: 'Нажмите «Проверить» — шаги загорятся по очереди.', card: 'ШАГ ЗА ШАГОМ' },
      { vo: 'Зелёная лампочка — всё работает. Красная покажет, где сломалось.', card: 'УСПЕХ ИЛИ ГДЕ ОШИБКА', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Данные и ключи остаются на вашем компьютере.', card: 'ДАННЫЕ У ВАС', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Скачайте OpenNodes для Mac — ссылка в профиле.', card: 'ССЫЛКА В ПРОФИЛЕ', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'И всё это живёт на вашем Mac.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: bg(SKY), html: cloud(t, 0) + dock(t, p(t, -0.5, 1.8)) };
      if (i === 1) return { bg: bg(SKY), html: cloud(t, easeOut(p(lt, 0, 1.4))) + dock(t, 1) };
      if (i === 9) return { bg: bg(SKY), html: dock(t, 1 - easeOut(p(lt, 0.3, 1.4))) };
      if (i === 2) {
        const steps = COLORS.map((col, n) => ({ id: `n${n}`, x: 330, y: 470 + n * 260, w: 220, title: ' ', kicker: ' ', state: 'idle', cat: ['trigger', 'ai', 'message'][n], in: n > 0, out: n < 2 }));
        let html = '';
        COLORS.forEach((col, n) => {
          html += at(t, B[2] + n * 0.2, 'drop', 340, 480 + n * 250, buddy(t, { color: col, size: 190, seed: n }));
          if (n < 2) html += box(0, 0, `<svg width="1080" height="1920" style="overflow:visible"><path d="M435 ${680 + n * 250} V ${720 + n * 250}" stroke="${C.ink}" stroke-width="12" stroke-linecap="round" opacity="${p(t, B[2] + 0.6 + n * 0.2, 0.3)}"/></svg>`);
        });
        return { bg: bg(PAPERBG), html };
      }
      if (i === 3) {
        // A step dragged from the menu onto the board, then linked.
        const k = easeOut(p(lt, 0.2, 1.0));
        const placed = k >= 1;
        const steps = [
          { id: 'a', x: 60, y: 480, w: 500, at: -1, state: 'idle', cat: 'trigger', icon: '✈', kicker: 'ЗАПУСК', title: 'Входящее сообщение' },
          { id: 'b', x: lerp(560, 60, k), y: lerp(1000, 760, k), w: 500, at: -1, state: 'idle', cat: 'ai', icon: '✦', kicker: 'ИИ', title: 'Обработать текст с помощью ИИ' },
        ];
        let html = pipeline(t, c, steps, placed ? [{ from: 'a', to: 'b', at: B[3] + 1.3 }] : []);
        html += box(lerp(700, 220, k), lerp(1080, 840, k), emoji('👆', 110));
        return { bg: bg(PAPERBG), html };
      }
      if (i === 4) {
        // Coloured inputs: the voice output looks for a diamond input — that one glows.
        const glow = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
        const port = (label, color, shape, on, y) =>
          box(110, y, `<div style="display:flex;align-items:center;gap:20px;opacity:${on ? 1 : 0.35}"><span style="display:inline-block;width:56px;height:56px;background:${color};border:7px solid ${C.ink};border-radius:${shape === 'dia' ? '10px' : '50%'};transform:${shape === 'dia' ? 'rotate(45deg)' : 'none'};box-shadow:${on ? `0 0 0 ${10 + glow * 14}px ${color}66` : 'none'}"></span><span style="font-size:42px;font-weight:900">${label}</span></div>`);
        return {
          bg: bg(PAPERBG),
          html:
            at(t, B[4], 'pop', 60, 470, node(t, { cat: 'ai', icon: '✦', kicker: 'ИИ · ВХОДЫ', title: 'Обработать текст с помощью ИИ', w: 760, in: false, out: false })) +
            port('Данные', C.blue, 'circle', false, 720) +
            port('Голос бренда', C.voice, 'dia', true, 830) +
            port('Шаблон инструкции', '#7C3AED', 'dia', false, 940) +
            port('Модель', '#9B83ED', 'dia', false, 1050) +
            at(t, B[4] + 0.4, 'right', 560, 820, `<div class="paper" style="width:290px;border-style:dashed;font-size:30px;font-weight:900">🎙 Голос бренда ◆→</div>`),
        };
      }
      if (i === 5 || i === 6) {
        const run = (k) => (i === 6 ? 'ok' : lt < 0.4 + k * 0.6 ? (lt > k * 0.6 ? 'active' : 'idle') : 'ok');
        const fail = i === 6 && lt > 1.8;
        const steps = [
          { id: 'a', x: 60, y: 560, w: 500, at: -1, state: run(0), cat: 'trigger', icon: '✈', kicker: 'ЗАПУСК', title: 'Входящее сообщение' },
          { id: 'b', after: 'a', gap: 60, x: 60, w: 500, at: -1, state: fail ? 'fail' : run(1), cat: 'ai', icon: '✦', kicker: 'ИИ', title: 'Обработать текст с помощью ИИ' },
          { id: 'c', after: 'b', gap: 60, x: 60, w: 500, at: -1, state: fail ? 'idle' : run(2), cat: 'message', icon: '➤', kicker: 'ДЕЙСТВИЕ', title: 'Отправить ответ' },
        ];
        const links = [
          { from: 'a', to: 'b', at: -1, flow: i === 5 && lt > 0.6 },
          { from: 'b', to: 'c', at: -1, flow: i === 5 && lt > 1.2 },
        ];
        let html = pipeline(t, c, steps, links);
        html += box(560, 470, testBtn(i === 5 && lt < 0.3));
        if (i === 6) {
          html += box(580, 610, lamp(t, fail ? 'fail' : 'ok'));
          if (fail) html += at(t, B[6] + 2.0, 'up', 560, 760, paper({ w: 290, title: 'Шаг 2', pt: 26, lines: ['нет подключения ИИ'], bg: '#FFE1E1' }));
        }
        return { bg: bg(PAPERBG), html };
      }
      if (i === 7)
        return {
          bg: bg(SKY),
          html:
            at(t, B[7], 'pop', 220, 520, emoji('💻', 300)) +
            at(t, B[7] + 0.4, 'pop', 470, 760, emoji('🔒', 130)) +
            at(t, B[7] + 0.7, 'left', 120, 980, chip('🗄 база', '#fff', { size: 42 })) +
            at(t, B[7] + 0.9, 'left', 360, 980, chip('🔑 ключи', '#fff', { size: 42 })) +
            at(t, B[7] + 1.1, 'pop', 240, 1090, chip('на этом Mac', '#F1E6FF', { size: 42 })),
        };
      // 8: download.
      return {
        bg: bg(SKY),
        html:
          at(t, B[8], 'pop', 330, 480, `<img src="logo-mark.svg" width="220" height="220" alt="">`) +
          at(t, B[8] + 0.3, 'pop', 150, 760, `<div class="btn" style="font-size:54px;background:${C.yellow}"> Скачать для Mac</div>`) +
          at(t, B[8] + 0.7, 'pop', 230, 940, chip('👆 ссылка в профиле', '#fff', { size: 46 })) +
          box(560, 800, burst(t, B[8] + 0.35)),
      };
    },
  });
})();
