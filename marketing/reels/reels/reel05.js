/* Reel 5 — «Отчёт в 9:00». Катя, маркетолог: расписание → HTTP API → текст → Telegram. */
(() => {
  const { C, at, box, person, phone, pipeline, cta, lamp, chip, emoji, digital, bg, paper, p, easeOut, lerp, wob, burst } = K;
  const LEMON = '#FFF1B8';
  const PEACH = '#FFDCC7';
  const katya = (expr, t, o = {}) =>
    person({ skin: '#C98E68', hair: 'curly', hairColor: '#2A1A14', shirt: C.orange, acc: ['glasses'], expr, seed: 1.9, ...o }, t);
  const report = `<div style="font-size:25px;white-space:nowrap"><b>📊 Продажи за вчера</b><br>Заказов: 42<br>Выручка: 186 400 ₽<br>Средний чек: 4 438 ₽</div>`;

  const hook = (t, a, loop) =>
    box(60, 470, digital('09:00', { size: 96, color: C.green }), { tf: `rotate(${p(t, a, 1.6) < 1 ? wob(t, 4, 9) : 0}deg)` }) +
    box(30, 760, katya(loop ? 'happy' : 'surprised', t, { talk: !loop }), { w: 380 }) +
    box(450, 500, phone(t, { title: 'Отчёты', avatarText: '📊', avatar: C.yellow, buzz: a + 0.2, msgs: [{ side: 'in', html: report, at: loop ? -1 : a - 0.25 }] }), { tf: 'scale(.9) rotate(4deg)', origin: 'top left' });

  K.reel({
    beats: [
      { vo: 'Хватит считать вчерашние продажи руками.', card: '9:00 — ОТЧЁТ УЖЕ ТУТ' },
      { vo: 'В 9:00 они сами приходят в Telegram.' },
      { vo: 'Я каждое утро тратила на цифры 20 минут.', card: '20 МИНУТ КАЖДОЕ УТРО', cardStyle: { bg: C.pink } },
      { vo: 'Первый шаг запускается каждый день в 9:00.', card: 'КАЖДЫЙ ДЕНЬ В 9:00', cardStyle: { bg: C.orange } },
      { vo: 'Второй берёт цифры из CRM или магазина.', card: 'ЦИФРЫ ИЗ CRM', cardStyle: { bg: '#CFE0FF' } },
      { vo: 'Третий собирает их в понятный текст.', card: 'ПОНЯТНЫЙ ТЕКСТ', cardStyle: { bg: '#B8F5E4' } },
      { vo: 'И отправляет в Telegram — мне и клиенту.', card: 'МНЕ И КЛИЕНТУ', cardStyle: { bg: C.sky } },
      { vo: 'Кофе, отчёт — и сразу работа.', card: '−20 МИНУТ УТРОМ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «ОТЧЁТ» — пришлю сценарий.', card: 'НАПИШИТЕ «ОТЧЁТ»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'Завтра продажи снова посчитаются сами.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: bg(LEMON), html: hook(t, 0, false) };
      if (i === 9) return { bg: bg(LEMON), html: hook(t, B[9], true) };
      if (i === 1)
        return {
          bg: bg(LEMON),
          html: box(150, 470, phone(t, { title: 'Отчёты', avatarText: '📊', avatar: C.yellow, msgs: [{ side: 'in', html: report, at: -1 }] }), { tf: `scale(${1.05 + 0.08 * easeOut(p(lt, 0, 0.5))})`, origin: 'top center' }),
        };
      if (i === 2) {
        const secs = Math.floor(lerp(0, 20 * 60, p(lt, 0, 3.0)));
        return {
          bg: bg(LEMON),
          html:
            box(40, 820, katya('tired', t, { talk: true }), { w: 360 }) +
            ['CRM', 'Магазин', 'Реклама']
              .map((n, k) => at(t, B[2] + 0.15 + k * 0.2, 'drop', 400 + k * 40, 480 + k * 120, paper({ w: 380, title: `🗂 ${n}`, lines: [80, 55] })))
              .join('') +
            at(t, B[2] + 0.6, 'pop', 420, 980, emoji('🧮', 120)) +
            at(t, B[2] + 0.4, 'pop', 560, 1010, chip(`⏱ ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`, C.yellow, { size: 50 })),
        };
      }
      if (i === 7)
        return {
          bg: bg(PEACH),
          html:
            box(60, 640, katya('happy', t, { talk: true }), { w: 420 }) +
            at(t, B[7] + 0.1, 'pop', 560, 600, emoji('☕', 170)) +
            at(t, B[7] + 0.5, 'pop', 520, 900, `<div style="position:relative">${chip('⏱ 20:00', '#fff', { size: 50 })}<div style="position:absolute;left:-10px;right:-10px;top:42%;height:10px;background:${C.red};border-radius:6px;transform:rotate(-8deg)"></div></div>`),
        };
      if (i === 8)
        return { bg: bg(PEACH), html: cta(t, B[8], { title: 'Шаблон: по расписанию → API → отчёт', lines: ['⏰  Каждый день в 9:00', '🔌  Цифры из CRM по API', '✈  Отчёт в Telegram'], keyword: 'ОТЧЁТ' }) };

      // 3–6: the board.
      const steps = [
        { id: 's', x: 60, y: 470, w: 500, beat: 3, cat: 'trigger', icon: '⏰', kicker: 'ЗАПУСК', title: 'По расписанию · 9:00' },
        { id: 'h', after: 's', x: 60, gap: 44, w: 500, beat: 4, cat: 'data', icon: '🔌', kicker: 'ДАННЫЕ', title: 'HTTP-запрос к API CRM' },
        { id: 'x', after: 'h', x: 60, gap: 44, w: 500, beat: 5, cat: 'logic', icon: '✎', kicker: 'ТЕКСТ', title: 'Собрать текст из данных' },
        { id: 'm', after: 'x', x: 60, gap: 44, w: 500, beat: 6, cat: 'message', icon: '✈', kicker: 'ДЕЙСТВИЕ', title: 'Сообщение в Telegram' },
      ];
      const links = [{ from: 's', to: 'h' }, { from: 'h', to: 'x' }, { from: 'x', to: 'm' }];
      let html = pipeline(t, c, steps, links, { from: 3 });
      if (i === 3) html += at(t, B[3] + 0.5, 'pop', 620, 470, K.clock(540 + 360 * (1 - easeOut(p(lt, 0.5, 1.2))), { size: 200 }));
      if (i === 4)
        ['42', '186 400 ₽', '4 438 ₽'].forEach((n, k) => {
          const f = easeOut(p(t, B[4] + 0.2 + k * 0.3, 0.8));
          html += box(lerp(720, 470, f), lerp(560 + k * 70, 720, f), chip(n, '#CFE0FF', { size: 36 }), { op: 1 - p(t, B[4] + 0.9 + k * 0.3, 0.2) });
        });
      if (i === 5) html += at(t, B[5] + 0.3, 'right', 590, 820, paper({ w: 280, pt: 26, lines: ['Заказов: 42', 'Выручка: 186 400 ₽'] }));
      if (i === 6) {
        html += at(t, B[6] + 0.3, 'pop', 610, 900, emoji('📱', 150)) + at(t, B[6] + 0.5, 'pop', 730, 940, emoji('📱', 120));
        html += at(t, B[6] + 1.0, 'pop', 600, 1170, lamp(t, 'ok'));
      }
      return { bg: bg(PEACH), html };
    },
  });
})();
