// Pure decisions for the interface: no DOM in here, so it is unit-tested.
// Loaded as a plain script in the renderer (global `viewModel`) and with
// require() in tests.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.viewModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function counts(days) {
    return {
      learned: days.filter((d) => d.done).length,
      missed: days.filter((d) => d.missed).length,
    };
  }

  function filterDays(days, tab) {
    return tab === 'missed' ? days.filter((d) => d.missed) : days;
  }

  function badge(day) {
    if (day.isToday) return 'Today';
    if (day.missed) return 'Missed';
    return null;
  }

  function posLabel(pos) {
    if (pos === 'verb' || pos === 'noun') return pos.charAt(0).toUpperCase() + pos.slice(1);
    return pos;
  }

  // 'YYYY-MM-DD' -> 'Sun, Nov 22'. Built from local parts so no day shifts.
  function formatDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return str;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  }

  // The banner under the title: null when all is well.
  function banner(status, model) {
    switch (status.status) {
      case 'ollama-down':
        return {
          level: 'warning',
          text:
            "Ollama isn't running, so example sentences can't be written yet. " +
            'Start Ollama and they will fill in on their own (checked every 10 minutes).',
        };
      case 'model-missing': {
        const name = model || 'the selected model';
        return {
          level: 'warning',
          text: model
            ? `The model "${model}" isn't installed in Ollama. Install it with: ollama pull ${model}`
            : `${name} isn't installed in Ollama.`,
        };
      }
      case 'error':
        return {
          level: 'warning',
          text: 'The last attempt to write a sentence failed. Use Regenerate to try again.',
        };
      default:
        return null;
    }
  }

  // What the example card shows for a day:
  // 'content' | 'loading' | 'unavailable' | 'error' | 'queued' | 'none'
  function exampleState(day, status) {
    if (day.hasContent || day.content) return 'content';
    if (day.generating) return 'loading';
    if (status.status === 'ollama-down' || status.status === 'model-missing') return 'unavailable';
    if (status.status === 'error') return 'error';
    return day.done ? 'none' : 'queued';
  }

  function exampleMessage(state, status, model) {
    switch (state) {
      case 'loading':
        return {
          title: 'Writing an example sentence…',
          hint: 'The first sentence after launch can take a minute while the model loads.',
        };
      case 'unavailable':
        return {
          title: 'Example sentence unavailable',
          hint:
            status.status === 'model-missing'
              ? `The model ${model ? `"${model}" ` : ''}isn't installed yet. This fills in once it is.`
              : "Ollama isn't ready. This fills in automatically once it is.",
        };
      case 'error':
        return { title: "Couldn't write a sentence", hint: 'Use Regenerate to try again.' };
      case 'queued':
        return { title: 'Waiting to be written', hint: 'This sentence is queued and will appear shortly.' };
      case 'none':
        return { title: 'No example sentence yet', hint: 'Use Regenerate to write one.' };
      default:
        return null;
    }
  }

  function learnedButton(day) {
    return day.done
      ? { label: 'Learned', pressed: true }
      : { label: 'Mark as learned', pressed: false };
  }

  // 'water, to drink' for the review words a sentence used, or null.
  function reviewLine(content) {
    if (!content || !Array.isArray(content.review) || content.review.length === 0) return null;
    return content.review.join(', ');
  }

  // Keep the current choice if it still exists; else today; else the first day.
  // After midnight, a user still looking at yesterday's "today" (previousToday)
  // follows to the new today; a deliberately chosen older day is kept.
  function pickSelection(days, current, previousToday) {
    if (days.length === 0) return null;
    const today = days.find((d) => d.isToday);
    if (current && previousToday && current === previousToday && today && today.date !== previousToday) {
      return today.date;
    }
    if (current && days.some((d) => d.date === current)) return current;
    return (today || days[0]).date;
  }

  return {
    counts,
    filterDays,
    badge,
    posLabel,
    formatDate,
    banner,
    exampleState,
    exampleMessage,
    learnedButton,
    reviewLine,
    pickSelection,
  };
});
