// The interface. All text goes in with textContent, never innerHTML: the
// content comes from a language model.
(() => {
  'use strict';

  const vm = window.viewModel;
  const api = window.api;
  const $ = (id) => document.getElementById(id);

  const state = {
    days: [],
    status: { status: 'ok', error: null, generating: [] },
    settings: { model: '' },
    tab: 'all',
    selected: null,
    todayDate: null,
    detail: null,
    loaded: false,
  };

  // ---------- small DOM helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // "Error invoking remote method 'x': TypeError: message" -> "message"
  function cleanError(err) {
    return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (\w+Error: )?/, '');
  }

  // ---------- rendering ----------

  function renderCounts() {
    const { learned, missed } = vm.counts(state.days);
    $('learned-count').textContent = String(learned);
    $('missed-count').textContent = String(missed);
  }

  function renderTabs() {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.tab === state.tab));
    }
  }

  function renderList() {
    const list = $('day-list');
    const focused = document.activeElement;
    const keep =
      focused && list.contains(focused) ? { date: focused.dataset.date, role: focused.dataset.role } : null;

    const days = vm.filterDays(state.days, state.tab);
    list.replaceChildren(
      ...days.map((day) => {
        const li = el('li', 'day-item');
        if (day.done) li.classList.add('done');
        if (day.date === state.selected) li.classList.add('selected');

        const check = el('input', 'day-check');
        check.type = 'checkbox';
        check.checked = day.done;
        check.dataset.date = day.date;
        check.dataset.role = 'check';
        check.setAttribute('aria-label', `Learned: ${day.written}, ${vm.formatDate(day.date)}`);

        const button = el('button', 'day-select');
        button.type = 'button';
        button.dataset.date = day.date;
        button.dataset.role = 'select';
        if (day.date === state.selected) button.setAttribute('aria-current', 'true');
        button.append(
          Object.assign(el('span', 'day-word', day.written), { lang: 'ja' }),
          el('span', 'day-meaning', day.meaning),
          el('span', 'day-date', vm.formatDate(day.date))
        );
        const badgeText = vm.badge(day);
        if (badgeText) {
          button.append(el('span', `badge ${badgeText.toLowerCase()}`, badgeText));
        }

        li.append(check, button);
        return li;
      })
    );

    $('empty-list').hidden = !(state.tab === 'missed' && days.length === 0);

    if (keep) {
      const again = list.querySelector(`[data-date="${keep.date}"][data-role="${keep.role}"]`);
      if (again) again.focus();
    }
  }

  function renderBanner() {
    const info = vm.banner(state.status, state.settings.model);
    const node = $('banner');
    node.hidden = !info;
    node.textContent = info ? info.text : '';
  }

  function placeholderCard(state_, message) {
    const wrap = el('div', 'placeholder');
    if (state_ === 'loading') wrap.append(el('div', 'spinner'));
    const text = el('div');
    text.append(el('p', 'placeholder-title', message.title), el('p', 'placeholder-hint', message.hint));
    wrap.append(text);
    return wrap;
  }

  function contentCard(content) {
    const frag = document.createDocumentFragment();
    frag.append(el('h3', 'card-title', 'Example'));
    frag.append(Object.assign(el('p', 'sentence', content.sentence), { lang: 'ja' }));
    frag.append(Object.assign(el('p', 'sentence-reading', content.reading), { lang: 'ja' }));
    frag.append(el('p', 'translation', content.translation));
    const review = vm.reviewLine(content);
    if (review) {
      const line = el('p', 'review-line');
      line.append('Also reviews: ');
      line.append(Object.assign(el('span', null, review), { lang: 'ja' }));
      frag.append(line);
    }
    return frag;
  }

  function renderDetail() {
    const day = state.detail;
    $('loading').hidden = state.loaded;
    $('detail').hidden = !day;
    if (!day) return;

    $('d-date').textContent = vm.formatDate(day.date);
    const badgeText = vm.badge(day);
    const badgeNode = $('d-badge');
    badgeNode.hidden = !badgeText;
    badgeNode.textContent = badgeText || '';
    badgeNode.className = `badge ${badgeText ? badgeText.toLowerCase() : ''}`;

    $('d-word').textContent = day.written;
    $('d-reading').textContent = day.reading;
    $('d-meaning').textContent = day.meaning;
    $('d-pos').textContent = vm.posLabel(day.pos);
    $('d-pos').hidden = !day.pos;

    const learned = vm.learnedButton(day);
    $('learned-btn').textContent = learned.label;
    $('learned-btn').setAttribute('aria-pressed', String(learned.pressed));
    $('regen-btn').disabled = day.generating;

    const exampleState = vm.exampleState(day, state.status);
    const card = $('example-card');
    if (exampleState === 'content') {
      card.replaceChildren(contentCard(day.content));
    } else {
      const message = vm.exampleMessage(exampleState, state.status, state.settings.model);
      card.replaceChildren(placeholderCard(exampleState, message));
    }

    const content = exampleState === 'content' ? day.content : null;
    $('grammar-card').hidden = !(content && content.grammar);
    $('usage-card').hidden = !(content && content.usage);
    $('grammar-text').textContent = content ? content.grammar : '';
    $('usage-text').textContent = content ? content.usage : '';
  }

  function renderModel() {
    const input = $('model-input');
    if (document.activeElement !== input) input.value = state.settings.model;
  }

  function render() {
    renderCounts();
    renderTabs();
    renderList();
    renderBanner();
    renderDetail();
    renderModel();
  }

  // ---------- data ----------

  let refreshing = false;
  let refreshAgain = false;

  // Re-read everything shown. Overlapping calls collapse into one follow-up.
  async function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const [days, status, settings] = await Promise.all([api.overview(), api.status(), api.getSettings()]);
        state.days = days;
        state.status = status;
        state.settings = settings;
        state.selected = vm.pickSelection(days, state.selected, state.todayDate);
        const today = days.find((d) => d.isToday);
        if (today) state.todayDate = today.date;
        state.detail = state.selected ? await api.day(state.selected) : null;
        state.loaded = true;
        render();
      } while (refreshAgain);
    } catch (err) {
      $('banner').hidden = false;
      $('banner').textContent = `Couldn't load your days: ${cleanError(err)}`;
    } finally {
      refreshing = false;
    }
  }

  let timer = null;
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 40);
  }

  function select(date) {
    state.selected = date;
    refresh();
  }

  async function setDone(date, done) {
    try {
      await api.setDone(date, done);
    } catch (err) {
      console.error(cleanError(err));
    }
    refresh();
  }

  // ---------- events ----------

  $('day-list').addEventListener('click', (event) => {
    const button = event.target.closest('.day-select');
    if (button) select(button.dataset.date);
  });

  $('day-list').addEventListener('change', (event) => {
    const box = event.target;
    if (box.classList.contains('day-check')) setDone(box.dataset.date, box.checked);
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      render();
    });
  }

  $('learned-btn').addEventListener('click', () => {
    if (state.detail) setDone(state.detail.date, !state.detail.done);
  });

  $('regen-btn').addEventListener('click', async () => {
    if (!state.detail) return;
    try {
      await api.regenerate(state.detail.date);
    } catch (err) {
      console.error(cleanError(err));
    }
    refresh();
  });

  $('model-input').addEventListener('change', async () => {
    const msg = $('model-msg');
    msg.className = 'hint';
    try {
      const saved = await api.setSettings({ model: $('model-input').value });
      state.settings = saved;
      $('model-input').value = saved.model;
      msg.textContent = 'Saved';
    } catch (err) {
      msg.className = 'hint bad';
      msg.textContent = cleanError(err);
      $('model-input').value = state.settings.model;
    }
  });

  api.onChanged(scheduleRefresh);
  refresh();
})();
