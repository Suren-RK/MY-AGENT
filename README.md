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

## LLM providers

MY-AGENT uses the OpenAI SDK with an OpenAI-compatible chat-completions endpoint. **Ollama is the default provider**, so the main workflow can run locally without a cloud API key. Groq remains available as an optional cloud provider, with OpenRouter and custom compatible endpoints supported too.

### Recommended local setup for an 8 GB RAM PC

- Coding model: `qwen2.5-coder:3b` — a relatively lightweight coding model.
- Vision QA model: `qwen3-vl:2b` — a small vision-language model for screenshot review.
- Ollama endpoint: `http://localhost:11434/v1`.

These models can still be slow on CPU-only inference, and the vision model may put pressure on memory. Close memory-heavy apps if needed. AMD GPU acceleration depends on the specific GPU, driver, and Ollama support; the setup should also be able to run without relying on GPU acceleration.

### Install and run Ollama

Install Ollama for your operating system from [ollama.com/download](https://ollama.com/download), then open a terminal and download the models:

```bash
ollama pull qwen2.5-coder:3b
ollama pull qwen3-vl:2b
```

Ollama normally runs as a background service. Check that the local API is available at `http://localhost:11434`. You can list installed models with:

```bash
ollama list
```

### Configure MY-AGENT for Ollama

Copy `.env.example` to `.env` if you have not already done so. Set:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5-coder:3b
OLLAMA_VISION_MODEL=qwen3-vl:2b
```

No Ollama API key is needed. The OpenAI SDK requires a non-empty key value, so MY-AGENT supplies a local placeholder that Ollama ignores.

### Switch to Groq when you want cloud inference

Add your real Groq key to your local `.env`, then change the provider:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

Restart MY-AGENT after changing provider settings. The provider is selected at startup; Groq is optional and is not automatically called as a fallback if Ollama fails.

Other supported providers:
- `openrouter`: set `OPENROUTER_API_KEY` and optionally override its model names.
- `custom`: set `CUSTOM_API_KEY`, `CUSTOM_BASE_URL`, and `CUSTOM_MODEL`.

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
- Use OpenAI-compatible models through the OpenAI SDK
- Connect to local Ollama, Groq, OpenRouter, or a custom OpenAI-compatible endpoint

## Example

Input:

> Build a simple todo app where users can add, complete, and delete tasks.

The agent should first turn that sentence into explicit acceptance criteria, design a small file structure, generate the app, interact with it in a real browser, and patch failures before returning the result.

## Development

Install dependencies:

```bash
npm install
```

Configure Ollama as shown above, then start MY-AGENT:

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
- [x] Direct OpenAI-compatible LLM provider support
- [x] Local Ollama provider
- [ ] More robust structured-output parsing and retries
- [ ] Persistent project workspace and version history
- [ ] Git/GitHub workflow automation
- [ ] Better cross-framework support
- [ ] Production deployment workflow

## Status

🚧 **Active development** — the goal is to make the build → test → debug loop increasingly reliable rather than relying on one-shot code generation.

## License

This project is currently being developed as a personal project.
