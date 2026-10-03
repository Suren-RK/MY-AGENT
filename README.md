# MY-AGENT 🚀

MY-AGENT is an AI software engineering agent that turns a natural-language app idea into a planned, generated, tested, and repaired project.

The key idea is simple: **don't just ask an AI to write code. Give it a software-engineering loop.**

## Agent Pipeline

```text
User idea
   ↓
Planner prompt
   ↓
Structured product spec + acceptance criteria
   ↓
Architecture prompt
   ↓
File/component plan
   ↓
Builder prompt
   ↓
Runnable project
   ↓
Static checks
   ↓
Real browser QA
   ↓
Visual QA
   ↓
Debugger prompt
   ↓
Targeted file patches
   ↓
Re-test
   ↓
Generated app
```

## Why the prompt-driven architecture?

One-shot code generation can produce plausible-looking code that is incomplete, invents features, or breaks when the browser actually uses it. MY-AGENT separates the responsibilities instead:

- **Planner** defines what should be built.
- **Architect** defines the smallest file structure needed.
- **Builder** implements that specification.
- **Browser QA** interacts with the real generated application.
- **Visual QA** checks the rendered UI.
- **Debugger** receives concrete failures and patches only the files that need changes.

This keeps the model's context focused and makes failures useful instead of throwing the whole project away and starting from scratch.

## Prompt Library

The agent's core instructions live in version-controlled prompt files:

```text
prompts/
├── planner.txt
├── architect.txt
├── builder.txt
├── browser-qa.txt
├── visual-qa.txt
└── debugger.txt
```

That means improving MY-AGENT does not require rewriting the orchestration code every time. The prompts are part of the product and can be iterated independently.

## Current Capabilities

- Accept a project idea in natural language
- Produce structured requirements and acceptance criteria
- Create a minimal architecture before coding
- Generate complete project files
- Validate JavaScript syntax and asset references
- Launch the generated app in Chromium with Playwright
- Generate browser tests from the real DOM
- Run those tests against the generated app
- Capture screenshots for visual QA
- Apply targeted debugger patches when QA fails
- Retry the repair loop instead of blindly regenerating everything
- Open the generated application directly in the browser
- Use OpenRouter-compatible models through the OpenAI SDK

## Example

Input:

> Build a simple todo app where users can add, complete, and delete tasks.

The agent should first turn that sentence into explicit acceptance criteria, design a small file structure, generate the app, interact with it in a real browser, and patch failures before returning the result.

## Development

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example` and add your OpenRouter API key.

Then run:

```bash
npm start
```

The local agent runs at:

```text
http://localhost:3000
```

If Playwright browsers are not installed yet:

```bash
npx playwright install chromium
```

## Roadmap

- [x] Prompt-driven planning
- [x] Architecture stage
- [x] AI project generation
- [x] Static checks
- [x] Real browser QA
- [x] Screenshot-based visual QA
- [x] Targeted multi-file debugging loop
- [ ] Persistent project workspace and version history
- [ ] Git/GitHub workflow automation
- [ ] Better cross-framework support
- [ ] Production deployment workflow

## Status

🚧 **Active development** — the goal is to make the build → test → debug loop increasingly reliable rather than relying on one-shot code generation.

## License

This project is currently being developed as a personal project.
