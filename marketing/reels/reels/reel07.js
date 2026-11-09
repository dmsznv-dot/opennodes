/* Reel 7 — «Секретарь не нужен». Сергей, агентство: Telegram → ИИ-агент (MCP: Notion,
 * Документы, GitHub) → ответ. */
(() => {
  const { C, at, box, person, phone, pipeline, cta, chip, emoji, bg, paper, p, easeOut, lerp, back, wob, burst } = K;
  const MINT = '#D3F3EA';
  const CREAM = '#FFF2D6';
  const sergey = (expr, t, o = {}) =>
    person({ skin: '#F0C09B', hair: 'short', hairColor: '#8A8A93', shirt: '#22305E', acc: ['beard', 'tie'], expr, seed: 1.4, ...o }, t);
  const desk = `<div style="width:640px;height:60px;background:#B9845A;border:8px solid ${C.ink};border-radius:16px;box-shadow:0 10px 0 ${C.ink}"></div>`;
  // The sign on the empty desk flips from “vacancy” to “bot”.
  const sign = (t, flip) => {
    const k = easeOut(clampK(flip));
    const face = k < 0.5 ? '🪑 Секретарь — вакансия' : '🤖 Бот';
    return `<div class="paper" style="width:430px;text-align:center;font-size:44px;font-weight:1000;transform:rotateY(${k < 0.5 ? k * 180 : (1 - k) * 180}deg);background:${k < 0.5 ? '#fff' : C.yellow}">${face}</div>`;
  };
  const clampK = (x) => Math.min(1, Math.max(0, x));
  const tools = (t, a) =>
    [['Notion', '#fff', 620, 480], ['Документы', '#E3F0FF', 600, 600], ['GitHub', '#F1E6FF', 640, 720]]
      .map(([n, bgc, x, y], k) => at(t, a + k * 0.2, 'pop', x, y, chip(n, bgc, { size: 38 }), { tf: `translateY(${wob(t, 8, 0.8, k / 3)}px)` }))
      .join('');

  K.reel({
    beats: [
      { vo: 'Вам не нужен секретарь.', card: 'СЕКРЕТАРЬ НЕ НУЖЕН' },
      { vo: 'Нужен бот, который работает в ваших сервисах.' },
      { vo: 'Я пишу ассистенту в Telegram, как человеку.', card: 'ПИШУ КАК ЧЕЛОВЕКУ', cardStyle: { bg: C.sky } },
      { vo: 'Шаг «ИИ-агент» сам решает, что сделать.', card: 'АГЕНТ РЕШАЕТ', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Он сам открывает Notion и создаёт страницу.', card: 'СТРАНИЦА СОЗДАНА' },
      { vo: 'И отвечает, что сделал, со ссылкой.', card: 'ГОТОВО + ССЫЛКА', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Документы, задачи, заметки — одним сообщением в Telegram.', card: 'ОДНИМ СООБЩЕНИЕМ', cardStyle: { bg: C.orange } },
      { vo: 'Я говорю — он делает за 10 секунд.', card: 'Я ГОВОРЮ — ОН ДЕЛАЕТ' },
      { vo: 'Напишите «АССИСТЕНТ» — пришлю сценарий.', card: 'НАПИШИТЕ «АССИСТЕНТ»', cardStyle: { bg: C.tg, color: '#fff', size: 64 } },
      { vo: 'Так что секретарь мне правда не нужен.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0 || i === 1 || i === 9) {
        const flip = i === 0 ? p(t, 0.9, 0.6) : 1;
        return {
          bg: bg(CREAM),
          html:
            box(120, 520, sign(t, flip)) +
            box(40, 860, `<div style="transform:scale(.7);transform-origin:left top">${desk}</div>`) +
            at(t, -1, 'pop', 150, 690, emoji('🪑', 170)) +
            (i === 1 ? tools(t, B[1] + 0.2) : '') +
            box(470, 880, sergey(i === 9 ? 'happy' : 'neutral', t, { talk: i === 0, look: -0.5 }), { w: 300 }),
        };
      }
      if (i === 2)
        return {
          bg: bg(MINT),
          html:
            at(t, B[2], 'pop', 60, 560, emoji('🚕', 200)) +
            box(40, 820, sergey('neutral', t, { talk: true }), { w: 360 }) +
            box(440, 480, phone(t, { title: 'Ассистент', avatarText: '🤖', avatar: C.yellow, msgs: [{ side: 'out', text: 'Запиши идею для клиента «Альфа» в Notion', at: B[2] + 0.4 }] }), { tf: 'scale(.92) rotate(3deg)', origin: 'top left' }),
        };
      if (i === 5 || i === 6) {
        const msgs = [
          { side: 'out', text: 'Запиши идею для клиента «Альфа» в Notion', at: -1 },
          { side: 'in', html: `✅ Готово: страница «Идея — Альфа»<br><u style="color:${C.blue}">notion.so/idea-alfa</u>`, at: B[5] + 0.3 },
        ];
        let html = box(60, 470, phone(t, { title: 'Ассистент', avatarText: '🤖', avatar: C.yellow, msgs }), { tf: 'scale(.95)', origin: 'top left' });
        if (i === 6)
          ['📄 Документ ✓', '✅ Задача ✓', '📝 Заметка ✓'].forEach((g, k) => {
            html += at(t, B[6] + 0.3 + k * 0.35, 'right', 520, 600 + k * 150, chip(g, ['#E3F0FF', '#C9F2D4', '#FFF2B3'][k], { size: 40 }));
          });
        return { bg: bg(MINT), html };
      }
      if (i === 7)
        return {
          bg: bg(CREAM),
          html:
            box(60, 640, sergey('happy', t, { talk: true }), { w: 420 }) +
            at(t, B[7] + 0.3, 'pop', 520, 640, chip('⏱ 10 сек', C.yellow, { size: 56 })) +
            at(t, B[7] + 0.6, 'pop', 560, 820, emoji('🤝', 140)),
        };
      if (i === 8)
        return { bg: bg(CREAM), html: cta(t, B[8], { title: 'Шаблон «Личный ассистент»', lines: ['✈  Сообщение в Telegram', '🤖  ИИ-агент в ваших сервисах', '✅  Ответ со ссылкой'], keyword: 'АССИСТЕНТ' }) };

      // 3–4: the board.
      const steps = [
        { id: 'i', x: 60, y: 480, w: 500, beat: 2, state: 'ok', cat: 'trigger', icon: '✈', kicker: 'ЗАПУСК', title: 'Входящее сообщение в Telegram-бот' },
        { id: 'g', after: 'i', gap: 60, x: 60, w: 500, beat: 3, state: i === 4 ? 'active' : undefined, cat: 'ai', icon: '🤖', kicker: 'ИИ-АГЕНТ · MCP', title: 'Выполнить задачу ИИ-агентом в сервисах' },
        { id: 'r', after: 'g', gap: 60, x: 60, w: 500, beat: 5, cat: 'message', icon: '➤', kicker: 'ДЕЙСТВИЕ', title: 'Ответить в Telegram' },
      ];
      let html = pipeline(t, c, steps, [{ from: 'i', to: 'g' }, { from: 'g', to: 'r' }], { from: 3 });
      html += tools(t, B[3] + 0.5);
      if (i === 4) {
        html += at(t, B[4] + 0.4, 'up', 560, 900, paper({ w: 300, title: '📄 Идея — Альфа', lines: [80, 60, 70] })) + box(720, 960, burst(t, B[4] + 0.45));
      }
      return { bg: bg(MINT), html };
    },
  });
})();
