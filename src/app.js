// Embutido no <head>: liga o layout de slider antes da primeira pintura.
// Sem JS, os dois lados ficam empilhados (fallback legível e indexável).
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  root.dataset.state = 'mid';

  addEventListener('DOMContentLoaded', () => {
    const $ = s => document.querySelector(s);
    const mq = matchMedia('(max-width: 760px)');
    const face = $('.face');
    const order = ['dev', 'mid', 'pod'];                       // do menor --p para o maior
    const labels = { dev: face.dataset.lDev, mid: face.dataset.lMid, pod: face.dataset.lPod };
    const hashes = { dev: '#dev', mid: '', pod: '#podcast' };
    const fromHash = () => ({ '#podcast': 'pod', '#dev': 'dev' })[location.hash] || 'mid';
    const stops = () => {                                        // lado aberto ocupa tudo menos a faixa
      const r = mq.matches ? 64 / innerHeight : 72 / innerWidth;
      return [r, .5, 1 - r];
    };
    let state = 'mid', drag = null;

    // o rosto só vira slider com JS
    face.setAttribute('role', 'slider');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', face.dataset.label);
    face.setAttribute('aria-valuemin', '0');
    face.setAttribute('aria-valuemax', '2');

    function set(s) {
      state = s;
      root.dataset.state = s;
      root.classList.remove('hint');
      root.style.setProperty('--p', stops()[order.indexOf(s)]);
      for (const side of ['pod', 'dev']) {
        const el = $('.' + side);
        if (s !== side) el.scrollTop = 0;
        el.querySelector('.content').inert = s !== side;
        el.querySelector('.intro').inert = s !== 'mid' && (mq.matches || s !== side);
      }
      face.setAttribute('aria-valuenow', order.indexOf(s));
      face.setAttribute('aria-valuetext', labels[s]);
      face.setAttribute('aria-orientation', mq.matches ? 'vertical' : 'horizontal');

      // deep-link: mantém #podcast / #dev na URL e no seletor de idioma
      const h = hashes[s];
      if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
      for (const a of document.querySelectorAll('.lang a')) a.hash = h;
    }

    // clicar em qualquer ponto de um lado fechado abre esse lado
    for (const side of ['pod', 'dev']) {
      $('.' + side).addEventListener('click', e => {
        if (e.target.closest('[data-close]')) return set('mid');
        if (state !== side && !e.target.closest('a')) set(side);
      });
    }

    // arrastar o rosto
    face.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      face.setPointerCapture(e.pointerId);
      root.classList.remove('hint');
    });
    face.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true;
      root.classList.add('dragging');
      const [lo, , hi] = stops();
      const p = mq.matches ? e.clientY / innerHeight : e.clientX / innerWidth;
      root.style.setProperty('--p', Math.min(hi, Math.max(lo, p)));
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      root.classList.remove('dragging');
      if (!moved) {                                            // clique simples
        if (state !== 'mid') return set('mid');
        root.classList.remove('hint'); void root.offsetWidth; root.classList.add('hint');
        return;
      }
      const p = parseFloat(root.style.getPropertyValue('--p'));
      set(p < .38 ? 'dev' : p > .62 ? 'pod' : 'mid');
    };
    face.addEventListener('pointerup', end);
    face.addEventListener('pointercancel', end);

    // teclado
    face.addEventListener('keydown', e => {
      const i = order.indexOf(state);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) { e.preventDefault(); set(order[Math.min(2, Math.max(0, i + step))]); }
      if (e.key === 'Home') { e.preventDefault(); set('dev'); }
      if (e.key === 'End') { e.preventDefault(); set('pod'); }
    });
    addEventListener('keydown', e => { if (e.key === 'Escape') set('mid'); });
    addEventListener('hashchange', () => set(fromHash()));
    mq.addEventListener('change', () => set(state));
    const still = () => {                                        // reposiciona sem animar
      root.classList.add('dragging'); set(state);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('dragging')));
    };
    addEventListener('resize', () => { if (!drag) still(); });

    // estado inicial vindo do link (#podcast ou #dev), já no lugar
    state = fromHash();
    still();
    if (state === 'mid') root.classList.add('hint');
  });
})();
