/* Reel 4 — «Ни одного заказа руками». Олег, магазин свечей:
 * вебхук платёжки → только оплаченные → PostgreSQL → чек на почту. */
(() => {
  const { C, at, box, person, pipeline, cta, lamp, chip, emoji, bg, paper, p, easeOut, lerp, wob, burst } = K;
  const SAND = '#FFE9C7';
  const SAGE = '#DDF2D1';
  const oleg = (expr, t, o = {}) =>
    person({ skin: '#EDB98F', hair: 'cap', hairColor: C.orange, shirt: '#3E8E5E', acc: ['beard'], expr, seed: 0.7, ...o }, t);

  // A storm of copy/paste around Олег; `calm` 0…1 turns it into one neat order.
  const storm = (t, calm) =>
    ['Ctrl+C', 'Ctrl+V', 'Ctrl+C', 'Ctrl+V', 'Ctrl+C', 'Ctrl+V', 'Ctrl+C']
      .map((w, k) => {
        const ang = t * 1.6 + (k * Math.PI * 2) / 7;
        const r = 300 * (1 - calm) + 40;
        return box(380 + Math.cos(ang) * r, 860 + Math.sin(ang) * r * 0.75, chip(w, k % 2 ? '#FFE1E1' : '#fff', { size: 40 }), {
          tf: `rotate(${wob(t, 14, 1.2, k / 7)}deg)`,
          op: 1 - calm,
        });
      })
      .join('');

  K.reel({
    beats: [
      { vo: 'Хватит переносить заказы руками.', card: 'ХВАТИТ КОПИРОВАТЬ ЗАКАЗЫ', cardStyle: { bg: C.red, color: '#fff' } },
      { vo: 'Каждая оплата теперь записывается сама.' },
      { vo: 'Я по 60 минут в день копировал оплаты. И ошибался.', card: 'ЧАС В ДЕНЬ + ОШИБКИ' },
      { vo: 'Теперь платёжка сама стучится в OpenNodes.', card: 'ОПЛАТА → OPENNODES', cardStyle: { bg: C.sky } },
      { vo: 'Фильтр пропускает только оплаченные.', card: 'ТОЛЬКО ОПЛАЧЕННЫЕ', cardStyle: { bg: '#B8F5E4' } },
      { vo: 'Заказ сам записывается в базу.', card: 'ЗАПИСАН В БАЗУ', cardStyle: { bg: '#CFE0FF' } },
      { vo: 'Покупатель сразу получает чек на почту.', card: 'ЧЕК — ПОКУПАТЕЛЮ' },
      { vo: 'Я узнаю о заказе, когда он уже записан.', card: '0 МИНУТ НА ЗАКАЗ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «ЗАКАЗ» — пришлю сценарий.', card: 'НАПИШИТЕ «ЗАКАЗ»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'И ни одного заказа руками.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0 || i === 9)
        return { bg: bg(SAND), html: box(200, 640, oleg(i === 9 ? 'happy' : 'angry', t, { talk: i === 0 }), { w: 400 }) + storm(t, i === 9 ? 0.15 : 0) };
      if (i === 1) {
        const calm = easeOut(p(lt, 0, 0.8));
        return {
          bg: bg(SAND),
          html:
            box(200, 640, oleg('surprised', t), { w: 400 }) +
            storm(t, calm) +
            at(t, B[1] + 0.6, 'pop', 70, 500, paper({ w: 780, pt: 34, lines: ['Заказ №1042 · 1 999 ₽ · оплачен ✓'] })),
        };
      }
      if (i === 2)
        return {
          bg: bg(SAND),
          html:
            box(40, 820, oleg('tired', t, { talk: true }), { w: 340 }) +
            at(t, B[2], 'up', 380, 500, paper({ w: 470, title: '📄 Заказы.xlsx', pt: 30, lines: ['№1040 · 1 999 ₽', '№1041 · 2 490 ₽', '№1042 · 19 99 ₽', '№1043 · 1 290 ₽'] })) +
            box(390, 648, `<div style="width:450px;height:52px;border:6px solid ${C.red};border-radius:12px;opacity:${p(lt, 1.2, 0.2) * (0.6 + 0.4 * Math.sin(t * 12))}"></div>`) +
            at(t, B[2] + 0.6, 'pop', 520, 960, chip('⏱ 60 мин/день', C.yellow, { size: 44 })),
        };
      if (i === 7)
        return {
          bg: bg(SAGE),
          html:
            box(40, 640, oleg('happy', t, { talk: true }), { w: 420 }) +
            at(t, B[7] + 0.1, 'pop', 540, 600, emoji('🕯️', 160)) +
            at(t, B[7] + 0.3, 'pop', 690, 720, emoji('🕯️', 120)) +
            at(t, B[7] + 0.6, 'pop', 470, 940, chip('📱 Заказ №1043 записан ✓', '#fff', { size: 36 })),
        };
      if (i === 8)
        return { bg: bg(SAGE), html: cta(t, B[8], { title: 'Шаблон: платёж → база → чек на почту', lines: ['💳  Оплата пришла', '✓  Только оплаченные', '🗄  В базу · ✉ чек покупателю'], keyword: 'ЗАКАЗ' }) };

      // 3–6: the board.
      const steps = [
        { id: 'w', x: 60, y: 470, w: 500, beat: 3, cat: 'trigger', icon: '💳', kicker: 'ЗАПУСК', title: 'Вебхук платёжки' },
        { id: 'f', after: 'w', x: 60, gap: 44, w: 500, beat: 4, cat: 'logic', icon: '✓', kicker: 'УСЛОВИЕ', title: 'Только если «оплачено»' },
        { id: 'd', after: 'f', x: 60, gap: 44, w: 500, beat: 5, cat: 'data', icon: '🗄', kicker: 'ДАННЫЕ', title: 'SQL-запрос в PostgreSQL' },
        { id: 'e', after: 'd', x: 60, gap: 44, w: 500, beat: 6, cat: 'message', icon: '✉', kicker: 'ДЕЙСТВИЕ', title: 'Отправить письмо с чеком' },
      ];
      const links = [{ from: 'w', to: 'f' }, { from: 'f', to: 'd' }, { from: 'd', to: 'e' }];
      let html = pipeline(t, c, steps, links, { from: 3 });
      if (i === 3) {
        const k = easeOut(p(lt, 0.3, 0.9));
        html += box(lerp(620, 300, k), lerp(1100, 500, k), paper({ w: 250, pt: 30, lines: ['💳 1 290 ₽ ✓'] }), { tf: `scale(${1 - k * 0.5}) rotate(${-10 + k * 10}deg)`, op: 1 - p(lt, 1.1, 0.2) });
      }
      if (i === 4) {
        html += at(t, B[4] + 0.2, 'pop', 600, 640, chip('оплачено ✓', '#C9F2D4', { size: 38 }));
        const b = easeOut(p(t, B[4] + 0.9, 0.6));
        html += at(t, B[4] + 0.5, 'pop', 600 + b * 80, 740 - b * 30, chip('отменён ✕', '#FFE1E1', { size: 38 }), { tf: `rotate(${b * 25}deg)`, op: 1 - b * 0.7 });
      }
      if (i >= 5)
        [0, 1, 2].forEach((k) => {
          html += at(t, B[5] + 0.3 + k * 0.25, 'drop', 610, 980 - k * 56, `<div style="width:230px;height:50px;background:#CFE0FF;border:6px solid ${C.ink};border-radius:14px;font-size:24px;font-weight:900;padding:6px 12px">№104${3 - k} ✓</div>`);
        });
      if (i === 6) {
        const k = easeOut(p(lt, 0.4, 0.9));
        html += box(lerp(560, 760, k), lerp(1120, 600, k), emoji('✉️', 100), { tf: `rotate(${k * 20}deg)` });
        html += at(t, B[6] + 1.2, 'pop', 600, 1170, lamp(t, 'ok'));
      }
      return { bg: bg(SAGE), html };
    },
  });
})();
