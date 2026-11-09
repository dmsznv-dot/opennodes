/* Reel 2 — «Три часа». Марина, студия маникюра: вебхук формы → фильтр → Telegram + письмо. */
(() => {
  const { C, at, box, person, phone, pipeline, cta, lamp, chip, emoji, clock, bg, paper, p, easeOut, lerp, wob, burst } = K;
  const ROSE = '#FFD1DC';
  const MINT = '#CFF5E7';
  const marina = (expr, t, o = {}) =>
    person({ skin: '#F6CBA8', hair: 'long', hairColor: '#2B1B17', shirt: C.teal, expr, seed: 1.1, ...o }, t);
  const stamp = (text, color) =>
    `<div style="border:8px solid ${color};color:${color};border-radius:18px;padding:6px 22px;font-size:56px;font-weight:1000;transform:rotate(-12deg);background:rgba(255,255,255,.85)">${text}</div>`;

  const hook = (t, loop) => {
    const mins = loop ? 600 : 600 + 180 * easeOut(p(t, 0.1, 2.0));
    return (
      box(330, 450, clock(mins, { size: 300 })) +
      box(40, 760, marina(loop ? 'happy' : 'surprised', t, { talk: !loop }), { w: 380 }) +
      at(t, loop ? -1 : 0.05, 'pop', 450, 820, paper({ w: 380, title: '✉ Заявка: Ольга', lines: ['Маникюр + покрытие', 72, 50], pt: 30 })) +
      (loop
        ? at(t, -1, 'pop', 560, 1060, emoji('💅', 130))
        : at(t, 1.2, 'pop', 520, 980, stamp('ПОЗДНО', C.red)))
    );
  };

  K.reel({
    beats: [
      { vo: 'Заявку я увидела через 3 часа.', card: '3 ЧАСА = МИНУС КЛИЕНТ', cardStyle: { bg: C.pink } },
      { vo: 'Клиентка уже ушла к другому мастеру.' },
      { vo: 'Заявки падали в почту, а почту я открываю между клиентами.', card: 'ПОЧТА МЕЖДУ КЛИЕНТАМИ' },
      { vo: 'Теперь сайт сам отдаёт заявку в OpenNodes.', card: 'САЙТ → OPENNODES', cardStyle: { bg: C.sky } },
      { vo: 'Фильтр отсекает пустые и спам.', card: 'СПАМ — МИМО', cardStyle: { bg: '#B8F5E4' } },
      { vo: 'Нормальная — за секунду в Telegram и на почту.', card: 'ЗА 1 СЕКУНДУ' },
      { vo: 'Имя, телефон, услуга — сразу видно, кому звонить.', card: 'КОМУ ЗВОНИТЬ — ЯСНО', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Я перезваниваю, пока клиентка ещё на сайте.', card: 'ЗВОНОК ЧЕРЕЗ МИНУТУ' },
      { vo: 'Напишите «ЗАЯВКА» — пришлю сценарий.', card: 'НАПИШИТЕ «ЗАЯВКА»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'Теперь 3 часа уходят на маникюр.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: bg(ROSE), html: hook(t, false) };
      if (i === 9) return { bg: bg(ROSE), html: hook(t, true) };
      if (i === 1)
        return {
          bg: bg(ROSE),
          html:
            box(40, 760, marina('sad', t), { w: 380 }) +
            box(440, 470, phone(t, { title: 'Ольга', avatarText: '👩', avatar: '#FFE0EC', msgs: [{ side: 'in', text: 'Здравствуйте! Хочу на маникюр завтра', at: -1 }, { side: 'in', text: 'Уже записалась в другую студию, спасибо 🙂', at: B[1] + 0.4 }] }), { tf: 'scale(.92) rotate(3deg)', origin: 'top left' }),
        };
      if (i === 2) {
        const n = Math.round(lerp(12, 47, easeOut(p(lt, 0, 1.4))));
        return {
          bg: bg(ROSE),
          html:
            box(60, 700, marina('tired', t, { talk: true }), { w: 360 }) +
            at(t, B[2], 'pop', 470, 560, `<div style="position:relative">${emoji('📥', 230)}<div class="mark" style="position:absolute;right:-10px;top:-6px;background:${C.red};color:#fff;border:6px solid ${C.ink};border-radius:999px;padding:4px 18px;font-size:54px;font-weight:1000">${n}</div></div>`) +
            at(t, B[2] + 0.5, 'pop', 520, 880, emoji('💅', 120)) +
            at(t, B[2] + 0.8, 'pop', 450, 1060, chip('между клиентами…', '#fff', { size: 38 })),
        };
      }
      if (i === 7)
        return {
          bg: bg(MINT),
          html:
            box(40, 640, marina('happy', t, { talk: true }), { w: 420 }) +
            at(t, B[7] + 0.1, 'pop', 520, 600, emoji('📞', 170)) +
            at(t, B[7] + 0.4, 'pop', 500, 860, chip('⏱ 0:58', C.yellow, { size: 56 })) +
            at(t, B[7] + 0.8, 'pop', 560, 1010, emoji('💖', 110)),
        };
      if (i === 8)
        return { bg: bg(MINT), html: cta(t, B[8], { title: 'Шаблон: заявка → фильтр → Telegram и письмо', lines: ['🌐  Заявка с сайта', '⛔  Пустые и спам — мимо', '✈  Telegram + ✉ письмо'], keyword: 'ЗАЯВКА' }) };

      // 3–6: the board.
      const steps = [
        { id: 'w', x: 60, y: 480, w: 520, beat: 3, cat: 'trigger', icon: '🌐', kicker: 'ЗАПУСК', title: 'Входящие данные с сайта (вебхук)' },
        { id: 'f', after: 'w', x: 60, w: 520, beat: 4, cat: 'logic', icon: '⛔', kicker: 'УСЛОВИЕ', title: 'Продолжить, только если…', sub: 'есть имя и телефон' },
        { id: 'tg', after: 'f', x: 40, w: 380, beat: 5, cat: 'message', icon: '✈', kicker: 'ДЕЙСТВИЕ', title: 'Сообщение в Telegram' },
        { id: 'em', after: 'f', x: 450, w: 380, beat: 5, cat: 'message', icon: '✉', kicker: 'ДЕЙСТВИЕ', title: 'Письмо на почту' },
      ];
      const links = [
        { from: 'w', to: 'f' },
        { from: 'f', to: 'tg', dx1: -60 },
        { from: 'f', to: 'em', dx1: 60 },
      ];
      if (i === 6) {
        return {
          bg: bg(MINT),
          html:
            at(t, B[6], 'up', 90, 520, paper({ w: 720, title: '🔔 Новая заявка', pt: 40, ph: 46, lines: ['👤 Ольга', '📞 +7 900 000-00-00', '💅 Маникюр + покрытие', '🕕 Завтра после 18:00'] })) +
            ['👤', '📞', '💅'].map((e, k) => box(70, 640 + k * 64, `<div style="width:700px;height:58px;border-radius:14px;background:${C.yellow};opacity:${p(lt, 0.4 + k * 0.5, 0.2) * (1 - p(lt, 0.9 + k * 0.5, 0.2)) * 0.6}"></div>`)).join(''),
        };
      }
      let html = pipeline(t, c, steps, links, { from: 3 });
      if (i === 3) {
        const k = easeOut(p(lt, 0.3, 0.9));
        html += box(lerp(650, 300, k), lerp(1150, 520, k), emoji('🛩', 110), { tf: `rotate(${lerp(-30, -60, k)}deg) scale(${1 - k * 0.5})`, op: 1 - p(lt, 1.1, 0.2) });
      }
      if (i === 4)
        ['пусто ✕', 'СПАМ ✕', 'тест ✕'].forEach((g, k) => {
          const a = B[4] + 0.2 + k * 0.35;
          const bounce = easeOut(p(t, a + 0.35, 0.6));
          html += at(t, a, 'pop', 620 + bounce * 60, 700 + k * 80 - bounce * 40, chip(g, '#FFE1E1', { size: 34 }), { tf: `rotate(${bounce * 25}deg)`, op: 1 - bounce * 0.6 });
        });
      if (i === 5) html += at(t, B[5] + 0.9, 'pop', 300, 1170, lamp(t, 'ok'));
      return { bg: bg(MINT), html };
    },
  });
})();
