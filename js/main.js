/* manool — главная, MVP: плавный скролл, интро, слайдер, курсор, меню, анимации по скроллу */
(() => {
  const root = document.documentElement;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const easeOut = t => 1 - (1 - t) ** 3;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const smoothstep = (from, to, value) => { const t = clamp((value - from) / (to - from)); return t * t * (3 - 2 * t); };

  /* ---------- сетка: ширина окна без скроллбара ---------- */
  const setViewportWidth = () => root.style.setProperty('--vw', `${root.clientWidth}px`);
  setViewportWidth();

  // пункты меню проявляются по очереди при открытии
  $$('.menu__list li').forEach((item, index) => item.style.setProperty('--li', index));

  /* ---------- плавный скролл ---------- */
  const scroller = {
    y: scrollY,
    target: scrollY,
    running: false,
    tween: null,
    locked: false,
    limit: () => root.scrollHeight - innerHeight,
    // плавно доехать до точки (якоря, пункты меню)
    // мгновенно (когда переход скрыт шторкой меню)
    jump(to) {
      this.tween = null;
      this.running = false;
      this.y = this.target = clamp(to, 0, this.limit());
      scrollTo(0, this.y);
    },
    glide(to) {
      const from = this.y;
      const distance = Math.abs(to - from);
      this.tween = { from, to: clamp(to, 0, this.limit()), start: performance.now(), duration: clamp(560 + distance * 0.28, 720, 1440) };
      this.running = false;
    },
    update(time, dt) {
      if (this.tween) {
        const progress = clamp((time - this.tween.start) / this.tween.duration);
        this.y = this.tween.from + (this.tween.to - this.tween.from) * easeInOut(progress);
        this.target = this.y;
        scrollTo(0, this.y);
        if (progress >= 1) this.tween = null;
        return;
      }
      if (!this.running) return;
      this.y += (this.target - this.y) * (1 - Math.exp(-dt * 11));
      if (Math.abs(this.target - this.y) < 0.4) { this.y = this.target; this.running = false; }
      scrollTo(0, this.y);
    },
  };
  addEventListener('wheel', event => {
    // зум и горизонтальные жесты тачпада («назад» свайпом) оставляем браузеру
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (scroller.locked) return;
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 33;
    else if (event.deltaMode === 2) delta *= innerHeight;
    if (scroller.tween) { scroller.tween = null; scroller.target = scroller.y; }
    scroller.target = clamp(scroller.target + delta, 0, scroller.limit());
    scroller.running = true;
  }, { passive: false });
  // клавиатура, ползунок, поиск по странице — браузер скроллит сам, мы подхватываем позицию
  addEventListener('scroll', () => {
    if (!scroller.running && !scroller.tween) { scroller.y = scrollY; scroller.target = scrollY; }
  }, { passive: true });

  /* ---------- интро ---------- */
  const firstSlide = $('.slide__img');
  let introDone = false;
  const endIntro = () => { if (!introDone) { introDone = true; root.classList.remove('is-intro'); } };
  Promise.race([
    Promise.all([document.fonts.ready, firstSlide.decode().catch(() => {})]),
    new Promise(resolve => setTimeout(resolve, 1800)),
  ]).then(() => {
    measureMenuLabels();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('is-loaded');
      setTimeout(endIntro, 2600);
    }));
  });

  /* ---------- слайдер первого экрана ---------- */
  const slider = $('[data-slider]');
  const sliderTrack = $('.slider__track', slider);
  const slides = $$('.slide', slider);
  const captionTitle = $('[data-caption-title]');
  const captionTags = $('[data-caption-tags]');
  const count = slides.length;
  let current = 0;
  // автолистание вправо: отсчёт идёт, только пока первый экран на виду
  const AUTOPLAY_SECONDS = 6;
  let autoplayElapsed = 0;
  let heroInView = true;

  function layoutSlides(instant = false) {
    slides.forEach((slide, index) => {
      let offset = (((index - current) % count) + count) % count;
      if (offset > count / 2) offset -= count;
      const previous = slide.dataset.o === undefined ? offset : Number(slide.dataset.o);
      // слайд, который перепрыгивает с одного края на другой, едет без анимации (он за экраном)
      const jump = instant || Math.abs(offset - previous) > 1;
      if (jump) slide.classList.add('no-tr');
      // смена резкости запускается только у того, кто сменил роль: центр ↔ бок
      const wasCenter = slide.classList.contains('is-center');
      if (!instant && offset === 0 && !wasCenter) { slide.classList.remove('to-side'); slide.classList.add('to-center'); }
      if (!instant && offset !== 0 && wasCenter) { slide.classList.remove('to-center'); slide.classList.add('to-side'); }
      slide.dataset.o = offset;
      slide.style.setProperty('--o', offset);
      slide.style.setProperty('--dir', Math.sign(offset));
      slide.style.setProperty('--far', Math.max(0, Math.abs(offset) - 1));
      slide.classList.toggle('is-center', offset === 0);
      slide.classList.toggle('is-side', offset !== 0);
      slide.classList.toggle('is-far', Math.abs(offset) > 2);
      slide.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
      if (jump) {
        void slide.offsetWidth;
        slide.classList.remove('no-tr');
      }
    });
  }

  // подпись меняется растворением: старая гаснет, новая проявляется
  function swapText(holder, text) {
    const old = $$('span', holder);
    const next = document.createElement('span');
    next.textContent = text;
    holder.append(next);
    old.forEach(node => {
      // при быстрых кликах гасим с текущей прозрачности, а не прыгаем
      const from = getComputedStyle(node).opacity;
      node.getAnimations().forEach(animation => animation.cancel());
      node.animate([{ opacity: from }, { opacity: 0 }], { duration: 360, easing: 'ease-out', fill: 'forwards' })
        .finished.then(() => node.remove()).catch(() => {});
    });
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 640, delay: 200, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
  }

  function goTo(direction) {
    endIntro();
    autoplayElapsed = 0;
    current = (current + direction + count) % count;
    layoutSlides();
    const slide = slides[current];
    swapText(captionTitle, slide.dataset.title);
    swapText(captionTags, slide.dataset.tags);
    pointer.dirty = true;
  }

  // зоны считаются по неподвижным слотам, а не по едущим картинкам — курсор не мигает
  function sliderZone(x) {
    const left = sliderTrack.getBoundingClientRect().left + slides[0].offsetLeft;
    const width = slides[0].offsetWidth;
    if (x < left) return -1;
    if (x > left + width) return 1;
    return 0;
  }
  sliderTrack.addEventListener('click', event => {
    const zone = sliderZone(event.clientX);
    if (zone !== 0) goTo(zone);
  });
  addEventListener('keydown', event => {
    if (root.classList.contains('is-menu-open') || scrollY > innerHeight * 0.5) return;
    if (event.key === 'ArrowRight') goTo(1);
    if (event.key === 'ArrowLeft') goTo(-1);
  });
  layoutSlides(true);

  /* ---------- курсор ---------- */
  const cursor = $('[data-cursor-el]');
  const pointer = { x: -200, y: -200, cx: -200, cy: -200, inside: false, dirty: false, dragging: false };

  function cursorStateAt(x, y) {
    // пока крутят голову манула или открыто меню — без кастомного курсора
    if (pointer.dragging || root.classList.contains('is-menu-open')) return ['', 0];
    const target = document.elementFromPoint(x, y);
    if (!target) return ['', 0];
    if (target.closest('.slider__track')) {
      const zone = sliderZone(x);
      return zone === 0 ? ['view', 0] : ['arrow', zone];
    }
    if (target.closest('[data-cursor="view"]')) return ['view', 0];
    return ['', 0];
  }
  function updateCursorState() {
    const [state, direction] = pointer.inside ? cursorStateAt(pointer.x, pointer.y) : ['', 0];
    if (cursor.dataset.state !== state) cursor.dataset.state = state;
    if (state === 'arrow') cursor.classList.toggle('is-left', direction < 0);
    // зум центрального слайда — по той же зоне, что и «смотреть проект»
    const overCenter = state === 'view' && sliderTrack.contains(document.elementFromPoint(pointer.x, pointer.y));
    sliderTrack.classList.toggle('is-hover-center', overCenter);
  }

  addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    if (!pointer.inside) { pointer.cx = event.clientX; pointer.cy = event.clientY; }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.inside = true;
    pointer.dirty = true;
  }, { passive: true });
  // мышь ушла за пределы окна — курсор прячется
  const pointerOut = () => { pointer.inside = false; pointer.dirty = true; };
  root.addEventListener('pointerleave', pointerOut);
  root.addEventListener('mouseout', event => { if (!event.relatedTarget) pointerOut(); });
  addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    cursor.classList.add('is-down');
    if (event.target.closest('.mascot')) { pointer.dragging = true; pointer.dirty = true; }
  });
  const releaseCursor = () => {
    cursor.classList.remove('is-down');
    if (pointer.dragging) { pointer.dragging = false; pointer.dirty = true; }
  };
  ['pointerup', 'pointercancel', 'blur', 'contextmenu', 'dragend'].forEach(type => addEventListener(type, releaseCursor));

  /* ---------- меню ---------- */
  const menuToggle = $('[data-menu-toggle]');
  const menuLabels = $('.menu-btn__labels', menuToggle);
  let menuCloseTimer = 0;

  function measureMenuLabels() {
    const open = root.classList.contains('is-menu-open');
    const label = $(open ? '.menu-btn__label--close' : '.menu-btn__label--open', menuLabels);
    menuLabels.style.setProperty('--lw', `${label.scrollWidth}px`);
  }
  function setMenu(open) {
    clearTimeout(menuCloseTimer);
    root.classList.remove('is-menu-closing');
    if (!open && root.classList.contains('is-menu-open')) {
      root.classList.add('is-menu-closing');
      // шапка остаётся светлой, пока шторка не уедет выше неё
      menuCloseTimer = setTimeout(() => root.classList.remove('is-menu-closing'), 840);
    }
    root.classList.toggle('is-menu-open', open);
    root.style.overflow = open ? 'hidden' : '';
    // страница под меню недоступна с клавиатуры, пока оно открыто
    $('main').inert = open;
    scroller.locked = open;
    menuToggle.setAttribute('aria-expanded', String(open));
    $('[data-menu-sr]', menuToggle).textContent = open ? 'закрыть меню' : 'открыть меню';
    measureMenuLabels();
    pointer.dirty = true;
  }
  menuToggle.addEventListener('click', () => setMenu(!root.classList.contains('is-menu-open')));
  $$('[data-menu-link]').forEach(link => link.addEventListener('click', event => {
    if (link.getAttribute('href') === '#') event.preventDefault();
    setMenu(false);
  }));
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.classList.contains('is-menu-open')) setMenu(false);
  });
  $$('a[href="#"]').forEach(link => link.addEventListener('click', event => event.preventDefault()));

  /* ---------- якоря: плавно и с учётом шапки и прилипающих секций ---------- */
  const dark = $('[data-dark]');
  function anchorTop(hash) {
    if (hash === '#top') return 0;
    const target = $(hash);
    if (!target) return null;
    if (target.parentElement !== dark) return target.getBoundingClientRect().top + scrollY;
    // у прилипающих секций реальная позиция «плавает», считаем её по потоку
    let offset = 0;
    for (const child of dark.children) {
      if (child === target) break;
      offset += child.offsetHeight;
    }
    return dark.offsetTop + offset - (offset ? headerHeight : 0);
  }
  $$('[data-anchor]').forEach(link => link.addEventListener('click', event => {
    const top = anchorTop(link.getAttribute('href'));
    if (top === null) return;
    event.preventDefault();
    // из меню: перескакиваем, пока шторка ещё закрывает экран, — она поднимается уже над нужной секцией
    if (link.hasAttribute('data-menu-link')) setTimeout(() => scroller.jump(top), 160);
    else scroller.glide(top);
  }));

  /* ---------- фильтр проектов ---------- */
  // категории кейса — в атрибуте data-tags у <article class="case">
  const filterButtons = $$('[data-filter]');
  const cases = $$('.case');
  const projectsSection = $('#projects');
  let filterRunning = false;
  let queuedFilter;

  // можно выбрать несколько: показываем проекты, у которых есть хотя бы одна из выбранных категорий
  function runFilter(selected) {
    filterRunning = true;
    const matches = item => !selected.length || item.dataset.tags.split(' ').some(tag => selected.includes(tag));
    const leaving = cases.filter(item => !item.hidden && !matches(item));
    const entering = cases.filter(item => item.hidden && matches(item));
    const staying = cases.filter(item => !item.hidden && matches(item));

    // 1. лишние гаснут
    const fadeOut = leaving.map(item => item.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 300, easing: 'ease-out', fill: 'forwards' },
    ).finished);

    Promise.all(fadeOut).then(() => {
      // 2. оставшиеся плавно переезжают на новые места (FLIP)
      const first = new Map(staying.map(item => [item, item.getBoundingClientRect()]));
      leaving.forEach(item => { item.hidden = true; item.getAnimations().forEach(animation => animation.cancel()); });
      entering.forEach(item => { item.hidden = false; });
      staying.forEach(item => {
        const from = first.get(item);
        const to = item.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        if (dx || dy) item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 680, easing: 'cubic-bezier(.76,0,.24,1)' });
      });
      // 3. новые проявляются
      entering.forEach((item, index) => item.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 720, delay: 140 + index * 64, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
      ));
      // если список уже прокручен выше шапки — плавно вернуться к его началу
      if (projectsSection.getBoundingClientRect().top < headerHeight - 2) scroller.glide(anchorTop('#projects'));
      pointer.dirty = true;

      setTimeout(() => {
        filterRunning = false;
        if (queuedFilter !== undefined) {
          const next = queuedFilter;
          queuedFilter = undefined;
          runFilter(next);
        }
      }, 360);
    });
  }

  const activeFilters = new Set();
  filterButtons.forEach(button => button.addEventListener('click', () => {
    // клик включает категорию, повторный (или по крестику) — выключает
    const key = button.dataset.filter;
    if (activeFilters.has(key)) activeFilters.delete(key);
    else activeFilters.add(key);
    const active = activeFilters.has(key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    const selected = [...activeFilters];
    if (filterRunning) queuedFilter = selected;
    else runFilter(selected);
  }));

  /* ---------- сетка-подсказка: клавиша G ---------- */
  addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey) root.classList.toggle('show-grid');
  });

  /* ---------- появление элементов ---------- */
  $$('.projects__filters [data-reveal]').forEach((item, index) => item.style.setProperty('--d', `${0.1 + index * 0.05}s`));
  $$('.footer__nav [data-reveal]').forEach((item, index) => item.style.setProperty('--d', `${0.1 + index * 0.06}s`));
  $$('.case').forEach((item, index) => {
    const delay = `${(index % 2) * 0.12}s`;
    $('[data-reveal-media]', item).style.setProperty('--d', delay);
    $('[data-split]', item).style.setProperty('--d', `${0.35 + (index % 2) * 0.12}s`);
  });
  $$('.process__list [data-split]').forEach((item, index) => item.style.setProperty('--d', `${0.1 + index * 0.06}s`));

  // элемент, скрытый через clip-path, observer считает невидимым — за медиа следим через родителя
  const revealTargets = new Map();
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      (revealTargets.get(entry.target) || [entry.target]).forEach(target => target.classList.add('is-in'));
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
  // подвал стоит в самом низу страницы — для него зона срабатывания без отступа снизу
  const footerObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      footerObserver.unobserve(entry.target);
    });
  }, { threshold: 0.01 });
  $$('[data-reveal], [data-dot], [data-split]').forEach(element => {
    (element.closest('[data-footer]') ? footerObserver : revealObserver).observe(element);
  });
  $$('[data-reveal-media]').forEach(media => {
    const watcher = media.parentElement;
    if (!revealTargets.has(watcher)) revealTargets.set(watcher, []);
    revealTargets.get(watcher).push(media);
    revealObserver.observe(watcher);
  });

  /* ---------- сцена скролла ---------- */
  const header = $('[data-header]');
  const hero = $('[data-hero]');
  const heroInner = $('[data-hero-inner]');
  const heroShade = $('[data-hero-shade]');
  const heroLetters = $$('.logo--hero .logo__l');
  const blocks = $$('[data-block]');
  const parallax = $$('[data-parallax]');
  const footerLogo = $('.logo--footer');
  const footerLetters = $$('.logo__l', footerLogo);
  let headerHeight = 45;

  function measure() {
    setViewportWidth();
    const viewport = innerHeight;
    headerHeight = Math.round(header.offsetHeight + parseFloat(getComputedStyle(header).paddingTop));
    root.style.setProperty('--header-h', `${headerHeight}px`);
    // если блок выше экрана — прилипает, когда его низ доходит до низа экрана
    hero.style.setProperty('--hero-top', `${Math.min(0, viewport - hero.offsetHeight)}px`);
    // секции прилипают под шапкой, чтобы заголовки не залезали под неё
    blocks.forEach(block => block.style.setProperty('--stick', `${Math.min(headerHeight, viewport - block.offsetHeight)}px`));
    scroller.target = clamp(scroller.target, 0, scroller.limit());
  }

  function renderScroll() {
    const viewport = innerHeight;
    const darkTop = dark.getBoundingClientRect().top;

    // 1. первый экран уходит вглубь, пока чёрная зона наезжает
    const cover = clamp(1 - darkTop / viewport);
    const coverEase = easeOut(cover);
    heroInner.style.transform = cover > 0
      ? `translate3d(0, ${(-cover * 6).toFixed(3)}vh, 0) scale(${(1 - coverEase * 0.08).toFixed(4)})`
      : '';
    // затемнение до полного чёрного: начинается с трети пути и заканчивается,
    // когда до верха остаётся ~15% экрана — над чёрной зоной уже нет светлой полосы
    const fade = smoothstep(0.35, 0.82, cover);
    heroShade.style.opacity = fade.toFixed(3);
    root.classList.toggle('is-hero-covered', fade >= 0.999);
    heroInView = cover < 0.5;
    // буквы логотипа приподнимаются лесенкой
    heroLetters.forEach((letter, index) => {
      letter.style.setProperty('--lift', cover > 0 ? `${(-coverEase * (6 + index * 2.4)).toFixed(2)}%` : '0%');
    });

    // 2. шапка: белый градиент над первым экраном, инверсия и тёмная подложка в чёрной зоне
    // шапка становится светлой, как только первый экран заметно потемнел
    const headerLine = header.firstElementChild.getBoundingClientRect().bottom - 4;
    const headerOnDark = darkTop <= headerLine || fade > 0.5;
    header.classList.toggle('is-dark', headerOnDark);
    header.classList.toggle('is-solid', darkTop <= 0 || fade >= 0.999);
    header.classList.toggle('is-veil', scrollY > 2 && !headerOnDark);

    // 3. параллакс фото внутри рамок
    parallax.forEach(layer => {
      const box = layer.parentElement.getBoundingClientRect();
      if (box.bottom < 0 || box.top > viewport) return;
      const progress = (box.top + box.height / 2 - viewport / 2) / viewport;
      layer.style.transform = `translate3d(0, ${(progress * -12).toFixed(3)}%, 0)`;
    });

    // 4. буквы большого логотипа в подвале проявляются по одной
    const logoBox = footerLogo.getBoundingClientRect();
    const logoProgress = clamp((viewport - logoBox.top) / (logoBox.height * 1.25));
    const stagger = 0.045;
    footerLetters.forEach((letter, index) => {
      const local = clamp((logoProgress - index * stagger) / (1 - (footerLetters.length - 1) * stagger));
      letter.style.setProperty('--op', easeOut(local).toFixed(3));
    });
  }

  /* ---------- единый цикл кадров ---------- */
  let scrollDirty = true;
  let lastTime = performance.now();
  let resizeTimer = 0;
  addEventListener('scroll', () => { scrollDirty = true; pointer.dirty = true; }, { passive: true });
  const onResize = () => {
    measure();
    scrollDirty = true;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measureMenuLabels, 150);
  };
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(document.body);

  function frame(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    scroller.update(time, dt);
    if (scrollDirty) { scrollDirty = false; renderScroll(); }

    // автолистание (кадры не идут в неактивной вкладке — там и отсчёт стоит)
    if (heroInView && root.classList.contains('is-loaded') && !root.classList.contains('is-menu-open')) {
      autoplayElapsed += dt;
      if (autoplayElapsed >= AUTOPLAY_SECONDS) goTo(1);
    }

    // курсор догоняет мышь с инерцией
    const follow = 1 - Math.exp(-dt * 24);
    pointer.cx += (pointer.x - pointer.cx) * follow;
    pointer.cy += (pointer.y - pointer.cy) * follow;
    cursor.style.transform = `translate3d(${pointer.cx.toFixed(2)}px, ${pointer.cy.toFixed(2)}px, 0)`;
    if (pointer.dirty) { pointer.dirty = false; updateCursorState(); }

    requestAnimationFrame(frame);
  }

  measure();
  requestAnimationFrame(frame);
})();
