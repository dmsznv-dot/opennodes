/* Reel 1 — «Булка не спит». Аня, пекарня: Telegram → ИИ (голос пекарни) → ответ. */
(() => {
  const { C, at, box, person, phone, board, cta, lamp, chip, emoji, clock, bg, p, easeOut, lerp, wob, burst } = K;
  const NIGHT = '#2B2F6B';
  const DAY = '#FFE7B8';
  const MORNING = '#FFC9A8';
  const anya = (expr, t, o = {}) =>
    person({ skin: '#FFD9B8', hair: 'bun', hairColor: '#C2642B', shirt: '#FF8FB1', acc: ['apron'], expr, seed: 0.3, ...o }, t);
  const night = (t) => bg(NIGHT, { stars: true, t, blobs: 'rgba(255,255,255,.06)' });

  K.reel({
    beats: [
      { vo: 'До 12 ночи я отвечала клиентам.', card: 'ДО ПОЛУНОЧИ → 4 СЕКУНДЫ' },
      { vo: 'Теперь бот отвечает за 4 секунды.' },
      { vo: 'Каждый такой вопрос — заказ, который уходит к соседям.', card: 'ВОПРОС = ЗАКАЗ', cardStyle: { bg: C.pink } },
      { vo: 'Я собрала три шага в OpenNodes.', card: '3 ШАГА' },
      { vo: 'Первый ловит сообщение в Telegram.', card: 'ЛОВИТ ВОПРОС', cardStyle: { bg: C.orange } },
      { vo: 'ИИ отвечает по меню и голосом пекарни: тепло и коротко.', card: 'ГОЛОС ПЕКАРНИ', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Третий шаг отправляет ответ.', card: 'ОТВЕТ УШЁЛ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Ночью отвечает бот. Утром я пеку.', card: 'БОТ ОТВЕЧАЕТ. Я ПЕКУ.' },
      { vo: 'Напишите «БУЛКА» — пришлю этот сценарий.', card: 'НАПИШИТЕ «БУЛКА»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'И никаких ответов до 12 ночи.' },
    ],
    draw(t, { B, i, lt }) {
      // 0–1 and the loop: night, Аня, the clock, the phone.
      if (i <= 1 || i === 9) {
        const sleeping = i === 9;
        const zoom = i === 1 ? 1 + 0.12 * easeOut(p(lt, 0, 0.5)) : 1;
        const msgs = [
          { side: 'in', text: 'А вы завтра работаете?', at: sleeping ? -1 : -0.25 },
          ...(i === 0 ? [{ side: 'in', typing: true, at: 1.2 }] : []),
          ...(i >= 1 ? [{ side: 'out', text: 'Да, с 8 утра 🥐 Круассаны будут!', at: sleeping ? -1 : B[1] + 0.4 }] : []),
        ];
        return {
          bg: night(t),
          html:
            box(70, 470, clock('23:47', { size: 190 }), { tf: `rotate(${wob(t, 3, 0.8)}deg)` }) +
            box(30, 700, anya(sleeping ? 'sleep' : 'tired', t, { talk: !sleeping && i === 0 }), { w: 400 }) +
            box(430, 470, phone(t, { title: 'Пекарня «Булка»', avatarText: '🥐', avatar: '#FFE7B8', msgs, buzz: sleeping ? -9 : 0.1 }), {
              tf: `scale(${zoom * 0.95}) rotate(4deg)`,
              origin: 'top left',
            }) +
            (i === 1 ? at(t, B[1] + 0.5, 'pop', 520, 1140, chip('⏱ 0:04', C.yellow, { size: 50 })) + box(720, 1170, burst(t, B[1] + 0.45)) : ''),
        };
      }
      // 2: the questions fly to the neighbours.
      if (i === 2) {
        const qs = ['А вы завтра работаете?', 'Есть без глютена?', 'Можно торт на субботу?'];
        return {
          bg: night(t),
          html:
            box(40, 760, anya('sad', t), { w: 360 }) +
            at(t, B[2] + 0.3, 'right', 600, 1010, `<div class="paper" style="width:240px;text-align:center;font-size:32px;font-weight:900;background:#FFE7B8">☕ Соседи</div>`) +
            qs
              .map((q, k) => {
                const a = B[2] + 0.15 + k * 0.4;
                const fly = easeOut(p(t, a + 0.55, 1.1));
                return at(t, a, 'pop', 300 + lerp(0, 330, fly), 520 + k * 150 + fly * 160, `<div class="bub in" style="font-size:32px">${q}</div>`, {
                  tf: `rotate(${-6 + k * 5 + fly * 18}deg) scale(${1 - fly * 0.5})`,
                  op: 1 - fly * 0.8,
                });
              })
              .join(''),
        };
      }
      // 3–6: the board. Three steps, then the brand voice beside the AI step.
      if (i >= 3 && i <= 6) {
        const st = (k) => {
          if (i === 4) return k === 0 ? 'active' : 'idle';
          if (i === 5) return k === 0 ? 'ok' : k === 1 ? 'active' : 'idle';
          if (i === 6) return lt > 0.3 + k * 0.3 ? 'ok' : 'active';
          return 'idle';
        };
        const steps = [
          { id: 'a', x: 60, y: 500, w: 470, at: B[3] + 0.1, cat: 'trigger', icon: '✈', kicker: 'ЗАПУСК', title: 'Входящее сообщение в Telegram-бот', state: st(0) },
          { id: 'b', after: 'a', x: 60, w: 470, at: B[3] + 0.35, cat: 'ai', icon: '✦', kicker: 'ИИ', title: 'Обработать текст с помощью ИИ', state: st(1) },
          { id: 'c', after: 'b', x: 60, w: 470, at: B[3] + 0.6, cat: 'message', icon: '➤', kicker: 'ДЕЙСТВИЕ', title: 'Отправить ответ от бота', state: st(2) },
        ];
        const links = [
          { from: 'a', to: 'b', at: B[3] + 0.8, flow: i >= 5 },
          { from: 'b', to: 'c', at: B[3] + 1.0, flow: i >= 6 },
        ];
        if (i >= 5) {
          steps.push({ id: 'v', x: 590, y: 500, w: 270, at: B[5], enter: 'right', cat: 'context', icon: '🎙', kicker: 'КОНТЕКСТ', title: 'Голос бренда', sub: 'Пекарня', ctx: true, in: false, h: 190 });
          links.push({ from: 'v', to: 'b', ctx: true, at: B[5] + 0.4 });
        }
        let html = board(t, steps, links);
        if (i === 4) {
          const k = easeOut(p(lt, 0.15, 0.7));
          html += box(lerp(580, 230, k), lerp(470, 520, k), `<div class="bub in" style="font-size:30px">А вы завтра работаете?</div>`, {
            tf: `scale(${1 - k * 0.6})`,
            op: 1 - p(lt, 0.8, 0.2),
          });
        }
        if (i >= 5)
          ['тепло', 'коротко', 'без канцелярита'].forEach((g, k) => {
            html += at(t, B[5] + 0.8 + k * 0.25, 'pop', 600, 860 + k * 76, chip(g, '#F1E6FF', { size: 32 }));
          });
        if (i === 6) html += at(t, B[6] + 1.0, 'pop', 570, 1110, lamp(t, 'ok'));
        return { bg: bg(DAY), html };
      }
      // 7: morning, baking.
      if (i === 7) {
        return {
          bg: bg(MORNING),
          html:
            box(60, 640, anya('happy', t, { talk: true }), { w: 420 }) +
            at(t, B[7] + 0.1, 'pop', 520, 560, emoji('🥐', 150)) +
            at(t, B[7] + 0.3, 'pop', 680, 700, emoji('🍞', 130)) +
            at(t, B[7] + 0.5, 'pop', 540, 860, emoji('🧁', 120)) +
            at(t, B[7] + 0.7, 'pop', 470, 1060, chip('✓✓ 12 ответов за ночь', '#B8F5C9', { size: 36 })),
        };
      }
      // 8: take the template.
      return {
        bg: bg(DAY),
        html: cta(t, B[8], {
          title: 'Шаблон: Telegram → ИИ → ответ',
          lines: ['✈  Входящее сообщение', '✦  ИИ + голос пекарни', '➤  Ответ клиенту'],
          keyword: 'БУЛКА',
        }),
      };
    },
  });
})();
