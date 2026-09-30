const form = document.querySelector('#planner-form');
const idea = document.querySelector('#idea');
const button = document.querySelector('#build-btn');
const result = document.querySelector('#result');

function renderList(id, items) {
  document.querySelector(id).innerHTML = items.map(item => `<li>${item}</li>`).join('');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = idea.value.trim();
  if (!value) return;

  button.disabled = true;
  button.innerHTML = 'Planning your project <span class="spinner">◌</span>';

  try {
    const response = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Planning failed');

    document.querySelector('#project-name').textContent = data.projectName;
    document.querySelector('#summary').textContent = data.summary;
    document.querySelector('#mode').textContent = data.mode === 'ai' ? 'AI PLAN' : 'DEMO PLAN';
    renderList('#requirements', data.requirements || []);
    renderList('#pages', data.pages || []);
    document.querySelector('#tasks').innerHTML = (data.tasks || []).map(task => `
      <div class="task">
        <span class="number">${task.id}</span>
        <span class="task-title">${task.title}</span>
        <span class="priority ${task.priority}">${task.priority}</span>
      </div>
    `).join('');

    result.classList.remove('hidden');
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Create Build Plan <span>→</span>';
  }
});
