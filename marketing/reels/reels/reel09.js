/* Reel 9 — «Жалоба под 40 сообщениями». Вика, поддержка онлайн-школы:
 * Telegram → ИИ-категория → только жалобы → руководителю. */
(() => {
  const { C, at, box, person, pipeline, cta, lamp, chip, emoji, bg, paper, p, easeOut, lerp, wob, burst } = K;
  const AQUA = '#D5F3F7';
  const SOFT = '#FFF0E0';
  const vika = (expr, t, o = {}) =>
    person({ skin: '#FFE0C7', hair: 'long', hairColor: '#E7B94F', shirt: C.teal, acc: ['headset'], expr, seed: 0.9, ...o }, t);
  const bubble = (text, color = '#fff', size = 26) => `<div class="bub in" style="font-size:${size}px;background:${color};white-space:nowrap;max-width:none">${text}</div>`;

  // A tower of “where is my access?” with the complaint at the bottom (or popping to the top).
  const tower = (t, a, o = {}) => {
    let html = '';
    for (let k = 0; k < 9; k++) html += at(t, a + k * 0.05, 'drop', 420 + (k % 2) * 30, 470 + k * 66, bubble('где мой доступ?', '#fff', 26), { tf: `rotate(${(k % 3) - 1}deg)` });
    const top = o.top ? easeOut(p(t, a + 0.5, 0.6)) : 0;
    html += at(t, a + 0.5, 'pop', 400, lerp(1080, 420, top), bubble('Хочу вернуть деньги 😡', o.lost ? '#FFC2C2' : '#FF8F8F', 30), {
      tf: `scale(${o.top ? 1 + top * 0.2 : 1})`,
      op: o.lost ? 1 - p(t, a + 0.6, 0.8) * 0.8 : 1,
    });
    html += at(t, a + 0.3, 'pop', 720, 1000, chip('×40', C.yellow, { size: 46 }));
    return html;
  };

  K.reel({
    beats: [
      { vo: 'Жалоба лежала под 40 сообщениями.', card: 'ЖАЛОБА ПОТЕРЯЛАСЬ', cardStyle: { bg: C.red, color: '#fff' } },
      { vo: 'Мы потеряли ученика.' },
      { vo: 'Все сообщения шли в один чат.', card: 'ВСЁ В ОДНОМ ЧАТЕ' },
      { vo: 'Теперь ИИ читает каждое и ставит 1 из 3 категорий.', card: 'ИИ СТАВИТ КАТЕГОРИЮ', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Фильтр пропускает только жалобы.', card: 'ТОЛЬКО ЖАЛОБЫ', cardStyle: { bg: '#B8F5E4' } },
      { vo: 'Они сразу уходят руководителю.', card: 'СРАЗУ РУКОВОДИТЕЛЮ', cardStyle: { bg: C.orange } },
      { vo: 'Вопросы — в обычную очередь.', card: 'ВОПРОСЫ — В ОЧЕРЕДЬ', cardStyle: { bg: C.sky } },
      { vo: 'Жалобу видно через секунду, а не через день.', card: 'СЕКУНДА, А НЕ ДЕНЬ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «ПОДДЕРЖКА» — пришлю сценарий.', card: 'НАПИШИТЕ «ПОДДЕРЖКА»', cardStyle: { bg: C.tg, color: '#fff', size: 64 } },
      { vo: 'И больше ни одной жалобы под 40 сообщениями.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: bg(AQUA), html: box(20, 820, vika('surprised', t, { talk: true }), { w: 360 }) + tower(t, -0.6) + box(395, 1060, `<div style="width:330px;height:70px;border-radius:30px;box-shadow:0 0 0 ${8 + 10 * Math.abs(Math.sin(t * 5))}px #FF5A5A66"></div>`) };
      if (i === 1) return { bg: bg(AQUA), html: box(20, 820, vika('sad', t), { w: 360 }) + tower(t, -1, { lost: true }) + at(t, B[1] + 0.6, 'pop', 120, 620, chip('−1 ученик', '#FFE1E1', { size: 44 })) };
      if (i === 9) return { bg: bg(AQUA), html: box(20, 820, vika('happy', t), { w: 360 }) + tower(t, B[9] - 0.3, { top: true }) };
      if (i === 2)
        return {
          bg: bg(AQUA),
          html:
            box(40, 820, vika('tired', t, { talk: true }), { w: 360 }) +
            ['где мой доступ?', 'как оплатить?', 'где мой доступ?', 'Хочу вернуть деньги 😡', 'где урок 3?', 'где мой доступ?']
              .map((m, k) => {
                const f = easeOut(p(t, B[2] + k * 0.25, 0.7));
                return box(lerp(700, 430, f), lerp(450, 520 + k * 90, f), bubble(m, m.includes('деньги') ? '#FF8F8F' : '#fff', 28), { op: f });
              })
              .join(''),
        };
      if (i === 7)
        return {
          bg: bg(SOFT),
          html:
            box(40, 680, vika('happy', t, { talk: true }), { w: 400 }) +
            at(t, B[7] + 0.2, 'pop', 450, 600, `<div class="bub in" style="font-size:30px;background:#C9F2A8;max-width:380px">Вернём деньги сегодня, простите 🙏</div>`) +
            at(t, B[7] + 0.6, 'pop', 560, 760, emoji('🙂', 130)) +
            at(t, B[7] + 0.9, 'pop', 500, 940, chip('⏱ 1 секунда', C.yellow, { size: 48 })),
        };
      if (i === 8)
        return { bg: bg(SOFT), html: cta(t, B[8], { title: 'Сценарий: ИИ-сортировка обращений', lines: ['✈  Сообщение в Telegram', '🏷  ИИ ставит категорию', '🚨  Жалобы — руководителю'], keyword: 'ПОДДЕРЖКА' }) };

      // 3–6: the board.
      const steps = [
        { id: 'i', x: 60, y: 480, w: 470, beat: 3, state: 'ok', cat: 'trigger', icon: '✈', kicker: 'ЗАПУСК', title: 'Входящее сообщение' },
        { id: 'k', after: 'i', gap: 44, x: 60, w: 470, beat: 3, cat: 'ai', icon: '🏷', kicker: 'ИИ', title: 'Определить категорию с помощью ИИ' },
        { id: 'f', after: 'k', gap: 44, x: 60, w: 470, beat: 4, cat: 'logic', icon: '⛔', kicker: 'УСЛОВИЕ', title: 'Только если «жалоба»' },
        { id: 'l', after: 'f', gap: 44, x: 60, w: 470, beat: 5, cat: 'message', icon: '🚨', kicker: 'ДЕЙСТВИЕ', title: 'Руководителю' },
      ];
      let html = pipeline(t, c, steps, [{ from: 'i', to: 'k' }, { from: 'k', to: 'f' }, { from: 'f', to: 'l' }], { from: 3 });
      const tags = [
        ['вопрос', '#E3F0FF'],
        ['оплата', '#FFF2B3'],
        ['жалоба', '#FFB3B3'],
      ];
      if (i === 3) tags.forEach(([g, col], k) => (html += at(t, B[3] + 0.6 + k * 0.3, 'pop', 580, 600 + k * 110, chip(`🏷 ${g}`, col, { size: 40 }))));
      if (i === 4)
        tags.forEach(([g, col], k) => {
          const out = k < 2 ? easeOut(p(t, B[4] + 0.5 + k * 0.2, 0.6)) : 0;
          html += box(580 + out * 120, 600 + k * 110 - out * 40, chip(`🏷 ${g}`, col, { size: 40 }), { tf: `rotate(${out * 30}deg)`, op: 1 - out * 0.8 });
        });
      if (i === 5) {
        html += at(t, B[5] + 0.2, 'right', 560, 980, paper({ w: 290, title: '🚨 Срочно', pt: 26, lines: ['Хочу вернуть деньги'], bg: '#FFE1E1' })) + box(700, 1000, burst(t, B[5] + 0.3, C.red));
        html += at(t, B[5] + 1.0, 'pop', 560, 1170, lamp(t, 'ok'));
      }
      if (i === 6)
        ['где мой доступ?', 'как оплатить?', 'где урок 3?'].forEach((m, k) => {
          html += at(t, B[6] + 0.2 + k * 0.25, 'right', 560, 620 + k * 100, bubble(m, '#fff', 24));
        });
      return { bg: bg(SOFT), html };
    },
  });
})();
