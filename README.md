# Minutes

Minutes is a local-first AI meeting assistant for macOS and Windows. It records your microphone and system audio, turns the conversation into clean, skimmable notes, and keeps everything on your machine unless you explicitly configure an external AI provider.

It is built to feel like a notes app first: you jot down what matters during the call, and Minutes quietly enriches those notes from the transcript.

## Features

### Capture
- Record microphone and system audio together with professional mixing and clipping protection.
- Live transcription on demand, or transcribe after the meeting to stay light on CPU.
- Voice Activity Detection so only speech is sent to the model.
- Detect supported meetings and offer to start recording automatically.
- Menu bar state for idle, recording, and paused.

### The meeting workspace
- One unified screen from the moment you hit record: notes, transcript, and chat live together, with a floating record bar.
- Write live notes while the meeting runs; they persist continuously to the meeting folder and database.
- Raw notes stay editable after the meeting, side by side with the transcript.
- Live transcript dock with search and color-coded speaker chips.
- Collapsible navigation rail and a collapsible transcript/chat dock.
- Responsive layout: on narrow windows the sidebar collapses and the dock becomes a bottom panel.
- Light and dark themes.

### Notes and summaries
- Enhanced notes: concise, skimmable bullet points that **build on the notes you already wrote**, keeping your wording and order while adding specifics from the transcript.
- Free-form notes — no templates to pick, no rigid sections.
- The model also names the meeting from the notes, and the title stays inline editable.
- Re-enhance any time with a single refresh action; stop an in-flight generation.
- Optional per-meeting summary language.

### Ask your meeting
- Chat with the meeting; the assistant can reference the transcript and your notes.
- The assistant can revise the enhanced notes and apply revision-backed transcript edits.
- Suggested prompts to get started.

### Transcription and models
- Whisper.cpp / whisper-rs and NVIDIA Parakeet paths, running locally.
- GPU acceleration: Metal + CoreML on macOS, CUDA/Vulkan on Windows/Linux, CPU fallback.
- Built-in AI summary models, plus Ollama for local summarization.
- Optional external summary providers (Claude, Groq, OpenRouter) when you configure them.
- Speaker diarization with an editable speaker manager and reassignment.
- Import existing audio and retranscribe; transcription queue with background processing.

### Data
- Meetings, transcripts, and summaries are stored locally in SQLite.
- Full-text transcript search and a meetings list with dates.
- Signed-update friendly desktop build.

## Install

Prebuilt packages are published on the [Releases page](https://github.com/praveenvnktsh/minutes/releases/latest).

- **macOS**: Apple Silicon (`minutes.app`).
- **Windows**: x64 with AVX2, Vulkan for Whisper acceleration.
- **Linux**: supported via source builds.

## Build from source

Install Rust, Node.js, pnpm 9.15.9, and the native build tools for your platform. On macOS install Xcode and select it with `xcode-select`.

```bash
git clone https://github.com/praveenvnktsh/minutes.git
cd minutes/frontend
pnpm install --frozen-lockfile
pnpm tauri:dev
```

Local Apple Silicon production bundle with Metal:

```bash
cd frontend
pnpm tauri:build:local:mac
```

See [docs/BUILDING.md](docs/BUILDING.md) and [docs/building_in_linux.md](docs/building_in_linux.md) for platform details.

## Architecture

Minutes is a Tauri 2 desktop app: a Next.js/React interface inside a Rust core. Rust handles audio capture, local inference, persistence, notifications, meeting detection, and updates. The frontend talks to Rust through Tauri commands and events, and all meeting data lives in a local SQLite database.

See [docs/architecture.md](docs/architecture.md) for details.

## Privacy

Usage telemetry is disabled, and no analytics destination is configured. Audio, transcripts, notes, and summaries stay on your machine. If you configure an external AI provider, the data sent to it is governed by that provider's terms and your configuration. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Updates

The desktop updater reads signed manifests from this repository's releases:

`https://github.com/praveenvnktsh/minutes/releases/latest/download/latest.json`

Release artifacts are signed with this fork's Tauri updater key; the private key lives outside the repository and in CI secrets.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License and acknowledgments

Minutes is distributed under the [MIT License](LICENSE.md). The original MIT copyright notice is retained as required by that license. Third-party code, libraries, and models retain their respective licenses and attribution.

Built on open-source work including [whisper.cpp](https://github.com/ggerganov/whisper.cpp), [Screenpipe](https://github.com/mediar-ai/screenpipe), and NVIDIA Parakeet model tooling.
