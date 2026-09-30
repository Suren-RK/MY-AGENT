const form = document.querySelector('#planner-form');
const idea = document.querySelector('#idea');
const button = document.querySelector('#build-btn');
const result = document.querySelector('#result');
const buildProjectButton = document.querySelector('#build-project-btn');
const buildStatus = document.querySelector('#build-status');
const buildResult = document.querySelector('#build-result');
const buildProjectName = document.querySelector('#build-project-name');
const buildSummary = document.querySelector('#build-summary');
const buildMode = document.querySelector('#build-mode');
const generatedFiles = document.querySelector('#generated-files');

let currentPlan = null;

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

    currentPlan = data;
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


buildProjectButton.addEventListener('click', async () => {
  if (!currentPlan) return;

  buildProjectButton.disabled = true;
  buildProjectButton.textContent = 'Building...';
  buildStatus.textContent = 'Builder agent is generating a runnable MVP from the plan.';
  buildResult.classList.add('hidden');

  try {
    const response = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: currentPlan })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Build failed');

    buildProjectName.textContent = data.projectName;
    buildSummary.textContent = data.summary || 'Starter project generated.';
    buildMode.textContent = data.mode === 'ai' ? 'AI BUILD' : 'DEMO BUILD';
    generatedFiles.innerHTML = (data.files || []).map(file => `
      <div class="generated-file">
        <span>▸</span>
        <code>${file.path}</code>
        <small>${file.content.length} chars</small>
      </div>
    `).join('');

    buildStatus.textContent = `${data.files.length} files generated successfully.`;
    buildResult.classList.remove('hidden');
    buildResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    buildStatus.textContent = error.message;
    alert(error.message);
  } finally {
    buildProjectButton.disabled = false;
    buildProjectButton.textContent = '🚀 Build Project';
  }
});
