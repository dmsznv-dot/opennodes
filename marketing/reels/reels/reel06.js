/* Reel 6 — «3:12 ночи». Дима, разработчик: каждые 5 минут → проверка сайта →
 * локальная модель (Ollama) → тревога в Telegram. */
(() => {
  const { C, at, box, person, phone, pipeline, cta, lamp, chip, emoji, digital, bg, paper, p, easeOut, lerp, wob, burst } = K;
  const NIGHT = '#1E2347';
  const GREY = '#E7E9F2';
  const DUSK = '#DCD6FF';
  const dima = (expr, t, o = {}) =>
    person({ skin: '#F1C6A1', hair: 'short', hairColor: '#6B4A2E', shirt: '#334155', acc: ['headset'], expr, seed: 0.5, ...o }, t);
  const night = (t) => bg(NIGHT, { stars: true, t, blobs: 'rgba(255,255,255,.05)' });
  const alert = `<div style="font-size:26px"><b>🔴 Сайт не отвечает</b><br>502 Bad Gateway · 03:12<br>ИИ: похоже, у базы кончилась память</div>`;

  const hook = (t, a, loop) =>
    box(80, 470, digital(loop ? '03:12' : '03:12', { size: 110, color: C.red })) +
    box(40, 760, dima(loop ? 'sleep' : 'surprised', t), { w: 380 }) +
    box(470, 760, `<div style="width:300px;height:44px;background:#6E5A3F;border:7px solid ${C.ink};border-radius:12px"></div>`) +
    at(t, loop ? -1 : a, 'pop', 540, 600, emoji('📱', 150), { tf: `rotate(${loop ? 0 : wob(t, 10, 9)}deg)` }) +
    (loop ? '' : box(615, 670, `<div style="width:${80 + 60 * Math.abs(Math.sin(t * 6))}px;height:${80 + 60 * Math.abs(Math.sin(t * 6))}px;margin:-${40 + 30 * Math.abs(Math.sin(t * 6))}px;border-radius:50%;background:${C.red};opacity:.35"></div>`));

  K.reel({
    beats: [
      { vo: 'Сервер упал в 3:12 ночи.', card: '3:12 — СЕРВЕР УПАЛ', cardStyle: { bg: C.red, color: '#fff' } },
      { vo: 'А я узнал раньше клиентов.' },
      { vo: 'Раньше я узнавал утром — из злых писем.', card: 'РАНЬШЕ — ИЗ ПИСЕМ' },
      { vo: 'Теперь OpenNodes проверяет сайт каждые 5 минут.', card: 'ПРОВЕРКА КАЖДЫЕ 5 МИН', cardStyle: { bg: C.orange } },
      { vo: 'Если что-то не так, локальная модель объясняет, что случилось.', card: 'ИИ ОБЪЯСНЯЕТ', cardStyle: { bg: '#D9C2FF' } },
      { vo: 'Модель работает на моём компьютере. Логи никуда не уходят.', card: 'ЛОГИ НЕ УХОДЯТ', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'А бот будит меня одним сообщением.', card: 'ОДНО СООБЩЕНИЕ', cardStyle: { bg: C.sky } },
      { vo: 'В 3:20 всё снова работает. Клиенты спали.', card: 'ПОЧИНИЛ ДО УТРА', cardStyle: { bg: '#B8F5C9' } },
      { vo: 'Напишите «СЕРВЕР» — пришлю сценарий.', card: 'НАПИШИТЕ «СЕРВЕР»', cardStyle: { bg: C.tg, color: '#fff' } },
      { vo: 'До следующих 3:12.' },
    ],
    draw(t, c) {
      const { B, i, lt } = c;
      if (i === 0) return { bg: night(t), html: hook(t, -0.25, false) };
      if (i === 9) return { bg: night(t), html: hook(t, B[9], true) };
      if (i === 1)
        return {
          bg: night(t),
          html:
            box(40, 760, dima('surprised', t, { talk: true }), { w: 380 }) +
            box(450, 480, phone(t, { title: 'Мониторинг', avatarText: '🛡', avatar: '#FFE1E1', msgs: [{ side: 'in', html: alert, at: -1 }] }), { tf: `scale(${0.9 + 0.06 * easeOut(p(lt, 0, 0.5))}) rotate(3deg)`, origin: 'top left' }),
        };
      if (i === 2)
        return {
          bg: bg(GREY),
          html:
            box(40, 800, dima('sad', t), { w: 360 }) +
            ['Ничего не работает!!', 'Где мой заказ?', 'Сайт лежит с ночи', 'Верните деньги'].map((m, k) => at(t, B[2] + 0.15 + k * 0.3, 'drop', 400 + (k % 2) * 60, 480 + k * 140, paper({ w: 400, pt: 30, lines: [`✉ ${m}`], rot: -6 + k * 4, bg: '#FFF0F0' }))).join(''),
        };
      if (i === 7)
        return {
          bg: bg(DUSK),
          html:
            box(80, 470, digital('03:20', { size: 110, color: C.green })) +
            box(40, 760, dima('happy', t, { talk: true }), { w: 380 }) +
            at(t, B[7] + 0.3, 'pop', 470, 700, chip('сайт работает ✓', '#C9F2D4', { size: 40 })) +
            at(t, B[7] + 0.7, 'pop', 520, 860, emoji('😴', 100)) + at(t, B[7] + 0.9, 'pop', 660, 900, emoji('😴', 90)),
        };
      if (i === 8)
        return { bg: bg(DUSK), html: cta(t, B[8], { title: 'Шаблон: мониторинг → локальный ИИ → тревога', lines: ['⏰  Каждые 5 минут', '🔎  Проверка сайта', '🧠  Ollama объясняет · ✈ тревога'], keyword: 'СЕРВЕР' }) };

      // 3–6: the board.
      const steps = [
        { id: 's', x: 60, y: 470, w: 500, beat: 3, cat: 'trigger', icon: '⏰', kicker: 'ЗАПУСК', title: 'Каждые 5 минут' },
        { id: 'h', after: 's', gap: 44, x: 60, w: 500, beat: 3, cat: 'data', icon: '🔎', kicker: 'ДАННЫЕ', title: 'Проверить сайт (HTTP)' },
        { id: 'o', after: 'h', gap: 44, x: 60, w: 500, beat: 4, cat: 'ai', icon: '🧠', kicker: 'ИИ · НА ЭТОМ MAC', title: 'Локальная модель (Ollama)' },
        { id: 'm', after: 'o', gap: 44, x: 60, w: 500, beat: 6, cat: 'message', icon: '✈', kicker: 'ДЕЙСТВИЕ', title: 'Тревога в Telegram' },
      ];
      const links = [{ from: 's', to: 'h' }, { from: 'h', to: 'o' }, { from: 'o', to: 'm' }];
      let html = pipeline(t, c, steps, links, { from: 3 });
      if (i === 3 || i === 4) {
        // A heartbeat that breaks when the site stops answering.
        const broken = i === 4;
        const pts = Array.from({ length: 28 }, (_, k) => {
          const x = 590 + k * 10;
          const phase = (k * 0.35 + t * 4) % 6;
          const y = broken && k > 14 ? 600 : 600 - (phase > 2.5 && phase < 3.1 ? 70 : phase > 3.1 && phase < 3.5 ? -40 : 0);
          return `${x},${y}`;
        }).join(' ');
        html += at(t, B[3] + 0.4, 'pop', 0, 0, `<svg width="1080" height="1920" style="overflow:visible"><polyline points="${pts}" fill="none" stroke="${broken ? C.red : C.green}" stroke-width="10" stroke-linejoin="round"/></svg>`);
      }
      if (i === 4) html += at(t, B[4] + 0.6, 'pop', 590, 700, `<div class="bub in" style="font-size:28px;max-width:260px">502 от базы — похоже, кончилась память</div>`);
      if (i === 5) {
        html += at(t, B[5] + 0.2, 'pop', 600, 480, `<div style="position:relative">${emoji('☁️', 150)}<span style="position:absolute;left:40px;top:10px;font-size:110px;color:${C.red};font-weight:1000">✕</span></div>`);
        html += at(t, B[5] + 0.6, 'pop', 610, 760, emoji('💻', 140));
        html += at(t, B[5] + 0.8, 'pop', 720, 840, emoji('🔒', 80));
        html += at(t, B[5] + 1.0, 'pop', 590, 960, chip('на этом Mac', '#F1E6FF', { size: 34 }));
      }
      if (i === 6) {
        html += at(t, B[6] + 0.3, 'pop', 640, 860, emoji('📱', 150), { tf: `rotate(${wob(t, 10, 9)}deg)` });
        html += at(t, B[6] + 1.0, 'pop', 600, 1170, lamp(t, 'ok'));
      }
      return { bg: bg(DUSK), html };
    },
  });
})();
