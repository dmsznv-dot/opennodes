/* Reel 8 — «Дайте ИИ голос». Лена, SMM: голос бренда → посты, письма, ответы;
 * «Предложить правила по примерам»; проверка текста. */
(() => {
  const { C, at, box, person, robot, board, cta, chip, emoji, bg, paper, p, easeOut, lerp, back, wob, burst, node } = K;
  const VIOLET = '#EDE4FF';
  const PINK = '#FFE0EC';
  const lena = (expr, t, o = {}) =>
    person({ skin: '#FFDCC2', hair: 'bob', hairColor: '#E86A92', shirt: C.violet, expr, seed: 2.6, ...o }, t);
  const voiceCard = (fs = 'Голос бренда') =>
    `<div class="sticker" style="background:${C.voice};color:#fff;font-size:44px;padding:10px 26px">🎙 ${fs}</div>`;

  const hook = (t, a, loop) => {
    const slap = loop ? 1 : p(t, a + 1.0, 0.25);
    return (
      box(60, 560, robot(t, { mood: slap >= 1 ? 'happy' : 'stiff', size: 320 })) +
      at(t, loop ? -1 : a - 0.25, 'pop', 380, 520, `<div class="bub in" style="font-size:34px;max-width:420px">${slap >= 1 ? 'Привет! Коротко и по делу 🙂' : 'Уникальное инновационное решение для синергии…'}</div>`) +
      (slap > 0 ? box(110, 780, voiceCard('Голос'), { tf: `scale(${back(slap)}) rotate(-6deg)` }) : '') +
      box(460, 760, lena(loop ? 'happy' : 'angry', t, { talk: !loop }), { w: 380 })
    );
  };

  K.reel({
    beats: [
      { vo: 'ИИ без голоса пишет как робот.', card: 'ДАЙТЕ ИИ ГОЛОС', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Дело не в модели. Дайте ему голос.' },
      { vo: 'Я объясняла стиль в каждом запросе.', card: 'СТИЛЬ В КАЖДОМ ЗАПРОСЕ', cardStyle: { bg: C.pink } },
      { vo: 'В OpenNodes голос бренда — отдельный блок.', card: 'ГОЛОС — ОТДЕЛЬНЫЙ БЛОК', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Подключаю его к постам, письмам и ответам.', card: 'ОДИН ГОЛОС → ВСЕ ТЕКСТЫ' },
      { vo: 'Правила ИИ предложит сам — по 3–10 вашим текстам.', card: 'ПРАВИЛА ПО ПРИМЕРАМ', cardStyle: { bg: C.sky } },
      { vo: 'Проверка ставит оценку из 10 и не пропускает слабое.', card: 'СЛАБОЕ — НЕ ПРОЙДЁТ', cardStyle: { bg: C.red, color: '#fff' } },
      { vo: 'Один голос во всех текстах.', card: 'ОДИН ГОЛОС ВЕЗДЕ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «ГОЛОС» — пришлю, как настроить.', card: 'НАПИШИТЕ «ГОЛОС»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'И ни одного текста без голоса.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: bg(VIOLET), html: hook(t, 0, false) };
      if (i === 1 || i === 9) return { bg: bg(VIOLET), html: hook(t, B[i], true) };
      if (i === 2)
        return {
          bg: bg(PINK),
          html:
            box(40, 820, lena('tired', t, { talk: true }), { w: 360 }) +
            [0, 1, 2].map((k) => at(t, B[2] + 0.2 + k * 0.45, 'pop', 400 + k * 20, 560 + k * 150, `<div class="bub out" style="font-size:30px">пиши проще, без пафоса (${k + 8}-й раз)</div>`)).join(''),
        };
      if (i === 3) {
        const fields = [
          ['Язык', 'русский'],
          ['Для кого', 'дизайнеры'],
          ['Характер', 'тёплый, простой'],
          ['Не используй', 'канцелярит'],
          ['Примеры', '5 текстов'],
        ];
        return {
          bg: bg(VIOLET),
          html:
            at(t, B[3], 'up', 70, 520, node(t, { cat: 'context', icon: '🎙', kicker: 'КОНТЕКСТ', title: 'Голос бренда · Студия', w: 760, ctx: true, in: false, fs: 40 })) +
            fields.map(([k2, v], k) => at(t, B[3] + 0.4 + k * 0.25, 'left', 80, 760 + k * 88, `<div class="paper" style="width:740px;padding:12px 22px;font-size:34px;font-weight:800"><span style="opacity:.6">${k2}:</span> ${v}</div>`)).join(''),
        };
      }
      if (i === 4) {
        const steps = [
          { id: 'v', x: 290, y: 520, w: 300, cat: 'context', icon: '🎙', kicker: 'КОНТЕКСТ', title: 'Голос бренда', ctx: true, in: false },
          { id: 'a', x: 40, y: 860, w: 250, cat: 'ai', icon: '✦', kicker: 'ИИ', title: 'Пост', at: B[4] + 0.2 },
          { id: 'b', x: 315, y: 860, w: 250, cat: 'ai', icon: '✉', kicker: 'ИИ', title: 'Письмо', at: B[4] + 0.4 },
          { id: 'c', x: 590, y: 860, w: 250, cat: 'ai', icon: '💬', kicker: 'ИИ', title: 'Ответ', at: B[4] + 0.6 },
        ];
        const links = ['a', 'b', 'c'].map((id, k) => ({ from: 'v', to: id, dashed: true, color: C.voice, label: 'голос', labelDx: k === 1 ? 14 : -40, at: B[4] + 0.5 + k * 0.2 }));
        return { bg: bg(VIOLET), html: board(t, steps, links) };
      }
      if (i === 5) {
        const rows = [
          ['☑', 'Характер: тёплый, простой'],
          ['☑', 'Пиши так: коротко, сначала главное'],
          ['☑', 'Не используй: «уникальный»'],
          ['☐', 'Эмодзи: один-два'],
        ];
        const pressed = t > B[5] + 0.5;
        return {
          bg: bg(PINK),
          html:
            at(t, B[5], 'pop', 90, 500, `<div class="btn ${pressed ? 'pressed' : ''}" style="font-size:40px;background:#F1E6FF">✨ Предложить правила по примерам</div>`) +
            at(t, B[5] + 0.7, 'up', 70, 660, paper({ w: 760, title: 'Черновик правил', ph: 40, pt: 34, lines: rows.map((r) => `${r[0]}  ${r[1]}`) })) +
            box(700, 600, burst(t, B[5] + 0.75)),
        };
      }
      if (i === 6)
        return {
          bg: bg(VIOLET),
          html:
            at(t, B[6], 'drop', 60, 500, node(t, { cat: 'ai', icon: '🔎', kicker: 'ИИ · ПРОВЕРКА', title: 'Проверить текст на соответствие голосу бренда', w: 760, state: lt > 1.2 ? 'fail' : 'active' })) +
            at(t, B[6] + 0.5, 'up', 120, 800, paper({ w: 520, title: 'Наш уникальный продукт…', lines: [80, 60], badge: { t: '4/10', c: C.red } })) +
            at(t, B[6] + 1.2, 'pop', 160, 1060, chip('✕ канцелярит: «уникальный»', '#FFE1E1', { size: 38 })),
        };
      if (i === 7)
        return {
          bg: bg(PINK),
          html: ['📣 Пост', '✉ Письмо', '💬 Ответ']
            .map((n, k) => at(t, B[7] + k * 0.2, 'up', 60 + k * 265, 600 + (k % 2) * 60, paper({ w: 250, title: n, lines: [80, 60, 70], badge: { t: '9/10', c: C.green } })))
            .join('') + at(t, B[7] + 0.8, 'pop', 260, 960, voiceCard()),
        };
      return { bg: bg(PINK), html: cta(t, B[8], { title: 'Голос бренда в OpenNodes', lines: ['🎙  Один голос для всех текстов', '✨  Правила по вашим примерам', '🔎  Проверка не пропустит слабое'], keyword: 'ГОЛОС', button: 'Сохранить в библиотеку' }) };
    },
  });
})();
