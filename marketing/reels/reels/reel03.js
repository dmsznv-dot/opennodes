/* Reel 3 — «Робот без права голоса». Игорь, канал о дизайне:
 * расписание → RSS → ИИ (голос) → проверка → утверждение в Telegram → пост. */
(() => {
  const { C, at, box, person, robot, phone, pipeline, cta, chip, emoji, clock, bg, paper, p, easeOut, lerp, back, wob, burst } = K;
  const LILAC = '#E4DBFF';
  const SKY = '#D6EEFF';
  const igor = (expr, t, o = {}) =>
    person({ skin: '#F2C7A2', hair: 'short', hairColor: '#1F1B2E', shirt: '#4C3BCF', acc: ['glasses'], expr, seed: 2.2, ...o }, t);
  const approve = (pressed) =>
    `<div class="btn ${pressed ? 'pressed' : ''}" style="font-size:54px;background:${C.green};color:#fff">✅ Утвердить</div>`;

  const hook = (t, zoom = 1) =>
    box(40, 500, robot(t, { mood: 'type', size: 300 })) +
    box(70, 840, paper({ w: 280, title: 'Пост №…', lines: [90, 70, 80], rot: -4 })) +
    box(430, 520, igor('neutral', t, { talk: true, look: -0.6 }), { w: 400 }) +
    box(420, 1010, approve(false), { tf: `scale(${zoom})`, origin: 'center' }) +
    box(520 + wob(t, 6, 1.3), 980 + wob(t, 10, 1.3), emoji('☝️', 90));

  K.reel({
    beats: [
      { vo: 'Этот канал ведёт робот.', card: 'РОБОТ ВЕДЁТ КАНАЛ' },
      { vo: 'Но без моего «да» он ничего не публикует.' },
      { vo: 'Каждое утро в 9:00 OpenNodes берёт 5 свежих статей.', card: '9:00 — СВЕЖИЕ СТАТЬИ', cardStyle: { bg: C.orange } },
      { vo: 'ИИ пересказывает каждую в голосе канала.', card: 'В ГОЛОСЕ КАНАЛА', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Второй ИИ ставит оценку каждому тексту.', card: 'ОЦЕНКА КАЖДОМУ' },
      { vo: 'Слабые дальше не идут.', card: '4/10 — СТОП', cardStyle: { bg: C.red, color: '#fff' } },
      { vo: 'Остальные приходят мне в Telegram с кнопками.', card: 'ПРЕДПРОСМОТР + КНОПКИ', cardStyle: { bg: C.sky } },
      { vo: 'Одно нажатие — и пост в канале.', card: 'ОДНО НАЖАТИЕ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «КАНАЛ» — пришлю сценарий.', card: 'НАПИШИТЕ «КАНАЛ»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'Пишет робот. Решаю я.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0 || i === 9) return { bg: bg(LILAC), html: hook(t) };
      if (i === 1) return { bg: bg(LILAC), html: hook(t, 1 + 0.18 * back(p(lt, 0, 0.5))) };
      if (i === 2)
        return {
          bg: bg(SKY),
          html:
            box(80, 470, clock('9:00', { size: 230 })) +
            [0, 1, 2, 3, 4]
              .map((k) =>
                at(t, B[2] + 0.4 + k * 0.22, 'pop', 360 + k * 90, 560 + k * 110, paper({ w: 300, title: ['Типографика 2026', 'Новый Figma', 'Цвет года', 'Сетки', 'Логотипы'][k], lines: [80, 60], rot: -8 + k * 4 }))
              )
              .join('') +
            at(t, B[2] + 0.2, 'pop', 90, 780, chip('📡 RSS', C.orange, { size: 48 })),
        };
      if (i === 6 || i === 7) {
        const pressedAt = B[7] + 0.35;
        const msgs = [
          { side: 'in', html: `<b>Пост на утверждение</b><br>Типографика 2026: три шрифта, которые…`, buttons: [{ t: '✅ Утвердить', pressed: pressedAt }, { t: '❌ Отклонить' }], at: B[6] + 0.3 },
          ...(i === 7 ? [{ side: 'in', text: '✅ Утверждено — @igor', at: B[7] + 0.8 }] : []),
        ];
        return {
          bg: bg(SKY),
          html:
            box(60, 470, phone(t, { title: 'Утверждения', avatarText: '✓', avatar: '#B8F5C9', msgs }), { tf: 'scale(.95)', origin: 'top left' }) +
            (i === 7
              ? at(t, B[7] + 1.0, 'right', 520, 760, paper({ w: 330, title: '📣 Канал о дизайне', lines: ['Типографика 2026…', 80, 60], pt: 26 })) + box(690, 820, burst(t, B[7] + 1.05))
              : box(440, 720, igor('neutral', t, { talk: true, look: -1 }), { w: 400 })),
        };
      }
      if (i === 8)
        return { bg: bg(SKY), html: cta(t, B[8], { title: 'Сценарий: RSS → ИИ → проверка → утверждение', lines: ['📡  Статьи по расписанию', '✦  Пересказ в голосе канала', '✅  Пост только после «да»'], keyword: 'КАНАЛ' }) };

      // 3–5: the board.
      const steps = [
        { id: 'r', x: 60, y: 480, w: 470, beat: 2, state: 'ok', cat: 'data', icon: '📡', kicker: 'ДАННЫЕ', title: 'Новые записи из RSS' },
        { id: 'a', after: 'r', x: 60, w: 470, beat: 3, cat: 'ai', icon: '✦', kicker: 'ИИ · ДЛЯ КАЖДОЙ', title: 'Обработать текст с помощью ИИ' },
        { id: 'v', x: 590, y: 480, w: 260, cat: 'context', icon: '🎙', kicker: 'КОНТЕКСТ', title: 'Голос бренда', sub: 'Канал о дизайне', ctx: true, in: false },
        { id: 'q', after: 'a', x: 60, w: 470, beat: 4, cat: 'ai', icon: '🔎', kicker: 'ИИ · ПРОВЕРКА', title: 'Проверить текст на голос бренда' },
      ];
      const links = [{ from: 'r', to: 'a' }, { from: 'v', to: 'a', ctx: true }, { from: 'a', to: 'q' }];
      let html = pipeline(t, c, steps, links, { from: 3 });
      if (i >= 4) {
        const posts = [
          { s: '9/10', c: C.green },
          { s: '8/10', c: C.green },
          { s: '4/10', c: C.red },
        ];
        posts.forEach((x, k) => {
          const fall = k === 2 && i === 5 ? easeOut(p(lt, 0.2, 0.8)) : 0;
          html += at(t, B[4] + 0.3 + k * 0.3, 'pop', 580, 760 + k * 150 + fall * 260, paper({ w: 270, lines: [80, 60], badge: { t: x.s, c: x.c } }), {
            tf: `rotate(${fall * 30}deg)`,
            op: 1 - fall * 0.9,
          });
        });
      }
      return { bg: bg(LILAC), html };
    },
  });
})();
