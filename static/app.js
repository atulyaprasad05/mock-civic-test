'use strict';

const STORAGE_KEY = 'civics_test_session';
const TOTAL_QUESTIONS = 20;
const PASS_THRESHOLD = 12;

const state = {
  allQuestions: [],
  selectedQuestions: [],
  answers: [],
  currentIndex: 0,
  pendingAnswer: null,
};

// ─── DOM references ──────────────────────────────────────────────────────────

const screens = {
  welcome: document.getElementById('screen-welcome'),
  test: document.getElementById('screen-test'),
  results: document.getElementById('screen-results'),
};

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('data/questions_2025.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.allQuestions = data.questions;
  } catch (err) {
    showLoadError();
    return;
  }

  const session = loadSession();
  if (session) {
    state.selectedQuestions = session.questions;
    state.answers = session.answers;
    state.currentIndex = session.currentIndex;
    document.getElementById('resume-card').classList.add('visible');
  }

  showScreen('welcome');

  document.getElementById('btn-start').addEventListener('click', startNewTest);
  document.getElementById('btn-resume').addEventListener('click', resumeTest);
  document.getElementById('btn-restart').addEventListener('click', restartTest);
  document.getElementById('btn-submit').addEventListener('click', handleSubmit);
  document.getElementById('btn-next').addEventListener('click', advance);
});

// ─── Navigation ──────────────────────────────────────────────────────────────

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showLoadError() {
  document.getElementById('app').innerHTML =
    '<div class="load-error">' +
    '<h2>Could not load questions</h2>' +
    '<p>Please serve this project from a local web server.<br>' +
    'Example: <code>npx serve static</code> or <code>python -m http.server</code> inside the static folder.</p>' +
    '</div>';
}

// ─── Session management ───────────────────────────────────────────────────────

function saveSession() {
  const session = {
    questions: state.selectedQuestions,
    answers: state.answers,
    currentIndex: state.currentIndex,
    startedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test flow ────────────────────────────────────────────────────────────────

function startNewTest() {
  clearSession();
  state.selectedQuestions = selectQuestions(state.allQuestions);
  state.answers = [];
  state.currentIndex = 0;
  state.pendingAnswer = null;
  saveSession();
  showScreen('test');
  renderQuestion();
}

function resumeTest() {
  showScreen('test');
  renderQuestion();
}

function restartTest() {
  clearSession();
  state.answers = [];
  state.currentIndex = 0;
  state.pendingAnswer = null;
  document.getElementById('resume-card').classList.remove('visible');
  showScreen('welcome');
}

// ─── Question selection (proportional by topic) ───────────────────────────────

function selectQuestions(all) {
  const byTopic = {};
  all.forEach(q => {
    if (!byTopic[q.topic]) byTopic[q.topic] = [];
    byTopic[q.topic].push(q);
  });

  const topics = Object.keys(byTopic);
  const total = all.length;

  const allocs = topics.map(t => ({
    topic: t,
    pool: byTopic[t],
    raw: (byTopic[t].length / total) * TOTAL_QUESTIONS,
    count: Math.floor((byTopic[t].length / total) * TOTAL_QUESTIONS),
  }));

  let remaining = TOTAL_QUESTIONS - allocs.reduce((s, a) => s + a.count, 0);
  allocs.sort((a, b) => (b.raw % 1) - (a.raw % 1));
  for (let i = 0; i < remaining; i++) allocs[i].count++;

  // Guarantee at least 1 question per topic when the pool allows
  allocs.forEach(a => { if (a.count === 0 && a.pool.length > 0) a.count = 1; });

  const selected = [];
  allocs.forEach(alloc => {
    const shuffled = shuffle([...alloc.pool]);
    selected.push(...shuffled.slice(0, alloc.count));
  });

  return shuffle(selected);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderQuestion() {
  const q = state.selectedQuestions[state.currentIndex];
  const n = state.currentIndex + 1;
  const total = state.selectedQuestions.length;

  // Progress bar
  document.getElementById('progress-fill').style.width = ((n - 1) / total * 100) + '%';
  document.getElementById('progress-counter').textContent = 'Question ' + n + ' of ' + total;
  document.getElementById('progress-topic').textContent = q.topic;

  // Question card
  document.getElementById('question-number').textContent = 'Question ' + n;
  document.getElementById('question-text').textContent = q.question;

  // Answer area
  const answerArea = document.getElementById('answer-area');
  answerArea.innerHTML = '';

  if (q.type === 'mcq-single') {
    answerArea.appendChild(buildMcqOptions(q));
  } else if (q.type === 'mcq-multi') {
    answerArea.appendChild(buildMultiOptions(q));
  } else {
    answerArea.appendChild(buildOpenInput());
  }

  // Reset panels
  resetFeedbackPanels();

  // Button visibility
  const btnSubmit = document.getElementById('btn-submit');
  const btnNext = document.getElementById('btn-next');

  btnSubmit.style.display = 'none';
  btnNext.style.display = 'none';

  if (q.type === 'mcq-single') {
    btnNext.style.display = 'flex';
    btnNext.disabled = true;
    btnNext.textContent = isLastQuestion() ? 'See Results' : 'Next Question';
  } else if (q.type === 'mcq-multi') {
    btnSubmit.style.display = 'flex';
    btnSubmit.textContent = 'Submit Answer';
    btnSubmit.disabled = true;
  } else {
    btnSubmit.style.display = 'flex';
    btnSubmit.textContent = 'Submit Answer';
    btnSubmit.disabled = false;
  }

  state.pendingAnswer = null;
}

function buildMcqOptions(q) {
  const options = shuffle([...q.options]);
  const list = document.createElement('ul');
  list.className = 'options-list';

  options.forEach((opt, i) => {
    const li = document.createElement('li');
    li.className = 'option-item';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'mcq-option';
    input.id = 'opt-' + i;
    input.value = opt;

    const label = document.createElement('label');
    label.className = 'option-label';
    label.htmlFor = 'opt-' + i;
    label.textContent = opt;

    input.addEventListener('change', () => {
      state.pendingAnswer = opt;
      document.getElementById('btn-next').disabled = false;
    });

    li.appendChild(input);
    li.appendChild(label);
    list.appendChild(li);
  });

  return list;
}

function buildMultiOptions(q) {
  const wrapper = document.createElement('div');
  wrapper.className = 'multi-wrapper';

  const instruction = document.createElement('p');
  instruction.className = 'multi-instruction';
  instruction.textContent = 'Select exactly ' + q.requiredCount + ' answer' + (q.requiredCount !== 1 ? 's' : '');
  wrapper.appendChild(instruction);

  const counter = document.createElement('p');
  counter.className = 'multi-counter';
  counter.id = 'multi-counter';
  counter.textContent = '0 / ' + q.requiredCount + ' selected';
  wrapper.appendChild(counter);

  const options = shuffle([...q.options]);
  const list = document.createElement('ul');
  list.className = 'options-list';

  state.pendingAnswer = [];

  options.forEach((opt, i) => {
    const li = document.createElement('li');
    li.className = 'option-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'multi-option';
    input.id = 'opt-' + i;
    input.value = opt;

    const label = document.createElement('label');
    label.className = 'option-label option-label-multi';
    label.htmlFor = 'opt-' + i;
    label.textContent = opt;

    input.addEventListener('change', () => updateMultiSelection(q));

    li.appendChild(input);
    li.appendChild(label);
    list.appendChild(li);
  });

  wrapper.appendChild(list);
  return wrapper;
}

function updateMultiSelection(q) {
  const checkboxes = document.querySelectorAll('input[name="multi-option"]');
  const checked = Array.from(checkboxes).filter(c => c.checked);
  const count = checked.length;
  const required = q.requiredCount;

  state.pendingAnswer = checked.map(c => c.value);

  document.getElementById('multi-counter').textContent = count + ' / ' + required + ' selected';

  // Disable unchecked boxes when limit reached
  checkboxes.forEach(cb => {
    if (!cb.checked) cb.disabled = count >= required;
  });

  document.getElementById('btn-submit').disabled = count !== required;
}

function buildOpenInput() {
  const wrapper = document.createElement('div');
  wrapper.className = 'open-input-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'open-input';
  input.id = 'open-input';
  input.placeholder = 'Type your answer here…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-submit').click();
  });

  wrapper.appendChild(input);
  return wrapper;
}

function resetFeedbackPanels() {
  const feedback = document.getElementById('answer-feedback');
  feedback.className = 'answer-feedback';
  feedback.innerHTML = '';

  const selfAssessPanel = document.getElementById('self-assess-panel');
  selfAssessPanel.className = 'self-assess-panel';
  selfAssessPanel.innerHTML = '';
}

// ─── Answer handling ──────────────────────────────────────────────────────────

function handleSubmit() {
  const q = state.selectedQuestions[state.currentIndex];

  if (q.type === 'mcq-multi') {
    handleMultiSubmit(q);
    return;
  }

  // Open answer
  const input = document.getElementById('open-input');
  const userInput = input ? input.value.trim() : '';

  if (!userInput) return;

  input.disabled = true;
  document.getElementById('btn-submit').style.display = 'none';

  if (q.selfAssess) {
    showSelfAssessPanel(q, userInput);
  } else {
    const correct = checkOpenAnswer(userInput, q.correctAnswers);
    if (correct) {
      recordAnswer(q.id, userInput, true, false);
      showOpenFeedback(true, q.correctAnswers[0]);
      showNextButton();
    } else {
      state.pendingAnswer = userInput;
      showSelfAssessPanel(q, userInput);
    }
  }
}

function handleMultiSubmit(q) {
  const selected = Array.isArray(state.pendingAnswer) ? state.pendingAnswer : [];
  if (selected.length !== q.requiredCount) return;

  // Lock all checkboxes and hide submit button
  document.querySelectorAll('input[name="multi-option"]').forEach(cb => { cb.disabled = true; });
  document.getElementById('btn-submit').style.display = 'none';

  const correct = selected.every(s => q.correctAnswers.some(ca => normalizeStr(ca) === normalizeStr(s)));

  recordAnswer(q.id, selected.join(', '), correct, false);

  // Colour feedback: selected-correct = green, selected-wrong = red, unselected-correct = subtle highlight
  document.querySelectorAll('input[name="multi-option"]').forEach(cb => {
    const label = document.querySelector('label[for="' + cb.id + '"]');
    const isCorrect = q.correctAnswers.some(ca => normalizeStr(ca) === normalizeStr(cb.value));
    const wasSelected = selected.some(s => normalizeStr(s) === normalizeStr(cb.value));

    if (wasSelected && isCorrect) {
      label.classList.add('correct');
    } else if (wasSelected && !isCorrect) {
      label.classList.add('incorrect');
    } else if (!wasSelected && isCorrect) {
      label.classList.add('missed');
    }
  });

  showNextButton();
}

function showOpenFeedback(correct, displayAnswer) {
  const el = document.getElementById('answer-feedback');
  el.classList.add('visible', correct ? 'correct' : 'incorrect');
  if (correct) {
    el.innerHTML = '<strong>✓ Correct!</strong>';
  } else {
    el.innerHTML = '<strong>✗ Not quite.</strong> Accepted: <em>' + escapeHtml(displayAnswer) + '</em>';
  }
}

function showSelfAssessPanel(q, userInput) {
  const panel = document.getElementById('self-assess-panel');
  panel.classList.add('visible');

  let inner = '';

  if (q.selfAssess && q.note) {
    inner += '<p class="note-text">' + escapeHtml(q.note) + '</p>';
  } else if (q.correctAnswers && q.correctAnswers.length) {
    inner += '<p class="accepted-label">Accepted answers</p>';
    inner += '<ul class="accepted-list">';
    q.correctAnswers.slice(0, 8).forEach(ans => {
      inner += '<li>' + escapeHtml(titleCase(ans)) + '</li>';
    });
    inner += '</ul>';
  }

  inner += '<p class="self-assess-question">Did you get it right?</p>';
  inner += '<div class="self-assess-btns">' +
    '<button class="btn btn-success" id="btn-yes">✓ Yes</button>' +
    '<button class="btn btn-danger" id="btn-no">✗ No</button>' +
    '</div>';

  panel.innerHTML = inner;

  document.getElementById('btn-yes').addEventListener('click', () => selfAssess(true));
  document.getElementById('btn-no').addEventListener('click', () => selfAssess(false));
}

function selfAssess(correct) {
  const q = state.selectedQuestions[state.currentIndex];
  const input = document.getElementById('open-input');
  const userInput = input ? input.value.trim() : (state.pendingAnswer || '');

  recordAnswer(q.id, userInput, correct, true);
  document.getElementById('self-assess-panel').querySelectorAll('button').forEach(b => b.disabled = true);
  showNextButton();
}

// Handles mcq-single "Next" click — grade is determined here
function advance() {
  const q = state.selectedQuestions[state.currentIndex];

  if (q.type === 'mcq-single') {
    if (state.pendingAnswer === null) return;
    const correct = normalizeStr(state.pendingAnswer) === normalizeStr(q.correctAnswer);
    recordAnswer(q.id, state.pendingAnswer, correct, false);

    // Visual feedback on options before advancing
    document.querySelectorAll('.option-label').forEach(label => {
      if (normalizeStr(label.textContent) === normalizeStr(q.correctAnswer)) {
        label.classList.add('correct');
      } else if (normalizeStr(label.textContent) === normalizeStr(state.pendingAnswer) && !correct) {
        label.classList.add('incorrect');
      }
    });
    document.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);
    document.getElementById('btn-next').disabled = true;

    // Brief pause to show result colour before moving on
    setTimeout(moveToNext, 500);
    return;
  }

  moveToNext();
}

function showNextButton() {
  const btn = document.getElementById('btn-next');
  btn.style.display = 'flex';
  btn.disabled = false;
  btn.textContent = isLastQuestion() ? 'See Results' : 'Next Question';
}

function moveToNext() {
  if (isLastQuestion()) {
    saveSession();
    showResults();
    return;
  }
  state.currentIndex++;
  saveSession();
  renderQuestion();
}

function isLastQuestion() {
  return state.currentIndex === state.selectedQuestions.length - 1;
}

function recordAnswer(questionId, userInput, correct, selfAssessed) {
  state.answers.push({ questionId, userInput, correct, selfAssessed });
}

// ─── Answer checking ──────────────────────────────────────────────────────────

function normalizeStr(str) {
  return str.toLowerCase()
    .replace(/[.,\-/#!$%^&*;:{}=_`~()']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkOpenAnswer(userInput, correctAnswers) {
  const n = normalizeStr(userInput);
  return correctAnswers.some(ans => normalizeStr(ans) === n);
}

// ─── Results ──────────────────────────────────────────────────────────────────

function showResults() {
  clearSession();

  const score = state.answers.filter(a => a.correct).length;
  const total = state.selectedQuestions.length;
  const pct = Math.round((score / total) * 100);
  const passed = score >= PASS_THRESHOLD;

  document.getElementById('score-number').textContent = score;
  document.getElementById('score-total').textContent = '/ ' + total;
  document.getElementById('score-percent').textContent = pct + '%';

  const badge = document.getElementById('pass-badge');
  badge.textContent = passed ? '✓ PASS' : '✗ KEEP STUDYING';
  badge.className = 'pass-badge ' + (passed ? 'pass' : 'fail');

  renderReviewCards(score, total);
  showScreen('results');
  window.scrollTo(0, 0);
}

function renderReviewCards(score, total) {
  const list = document.getElementById('review-list');
  list.innerHTML = '';

  state.selectedQuestions.forEach((q, i) => {
    const answer = state.answers.find(a => a.questionId === q.id);
    const correct = answer ? answer.correct : false;
    const userInput = answer ? answer.userInput : '(no answer)';

    const card = document.createElement('div');
    card.className = 'review-card ' + (correct ? 'correct' : 'incorrect');

    const header = document.createElement('div');
    header.className = 'review-card-header';

    const num = document.createElement('span');
    num.className = 'review-q-num';
    num.textContent = 'Q' + (i + 1);

    const qText = document.createElement('span');
    qText.className = 'review-question';
    qText.textContent = q.question;

    const icon = document.createElement('span');
    icon.className = 'review-result-icon';
    icon.textContent = correct ? '✓' : '✗';

    header.appendChild(num);
    header.appendChild(qText);
    header.appendChild(icon);
    card.appendChild(header);

    const answers = document.createElement('div');
    answers.className = 'review-answers';

    const yourAns = document.createElement('div');
    yourAns.className = 'review-your-answer';
    yourAns.innerHTML = 'Your answer: <span>' + escapeHtml(userInput || '(no answer)') + '</span>';
    answers.appendChild(yourAns);

    if (!correct && !q.selfAssess) {
      const correctAns = document.createElement('div');
      correctAns.className = 'review-correct-answer';
      let displayCorrect = '';
      if (q.type === 'mcq-single') {
        displayCorrect = q.correctAnswer;
      } else if (q.type === 'mcq-multi') {
        displayCorrect = q.correctAnswers.map(titleCase).join(', ');
      } else {
        displayCorrect = q.correctAnswers && q.correctAnswers.length ? titleCase(q.correctAnswers[0]) : '';
      }
      if (displayCorrect) {
        correctAns.textContent = 'Correct: ' + displayCorrect;
        answers.appendChild(correctAns);
      }
    }

    card.appendChild(answers);
    list.appendChild(card);
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
