# Meetily

Meetily is a local-first desktop meeting recorder, transcription tool, and summary assistant. Audio, transcripts, and local-model summaries stay on your computer unless you explicitly configure an external AI provider.

[Releases](https://github.com/praveenVnktsh/meetily/releases) · [Issues](https://github.com/praveenVnktsh/meetily/issues) · [Privacy policy](PRIVACY_POLICY.md) · [Contributing](CONTRIBUTING.md)

## Features

- Record microphone and system audio together.
- Keep live transcription off and transcribe after recording, or opt into live transcription.
- Detect supported meetings and offer to start recording automatically.
- Generate summaries automatically after transcription completes.
- Run Whisper, Parakeet, and built-in summary models locally.
- Use optional external summary providers when configured by the user.
- Import existing audio and regenerate transcripts.
- Show idle, recording, and paused state in the macOS menu bar.

## Install

Prebuilt packages are published on the [GitHub Releases page](https://github.com/praveenVnktsh/meetily/releases/latest).

The current macOS package targets Apple Silicon. Windows packages target x64 systems with AVX2 and use Vulkan for Whisper acceleration. Linux is supported through source builds.

## Build from source

Install Rust, Node.js, pnpm 9.15.9, and the native build tools for your platform. On macOS, install Xcode and select it with `xcode-select`.

```bash
git clone https://github.com/praveenVnktsh/meetily.git
cd meetily/frontend
pnpm install --frozen-lockfile
pnpm tauri:dev
```

For a local Apple Silicon production bundle with Metal acceleration:

```bash
cd frontend
bun run tauri:build:local:mac
```

See [docs/BUILDING.md](docs/BUILDING.md) and [docs/building_in_linux.md](docs/building_in_linux.md) for platform-specific details.

## Architecture

Meetily uses a Next.js/React interface inside a Tauri desktop shell. Rust handles audio capture, local inference, persistence, notifications, meeting detection, and update installation. See [docs/architecture.md](docs/architecture.md).

## Privacy

This distribution has usage telemetry disabled and does not contain a configured analytics destination. Meeting content is stored locally. If you configure an external AI provider, the data sent to that provider is governed by its terms and your configuration. Read the [privacy policy](PRIVACY_POLICY.md) for details.

## Updates

The desktop updater reads signed manifests from this repository's releases:

`https://github.com/praveenVnktsh/meetily/releases/latest/download/latest.json`

Release artifacts must be signed with this fork's Tauri updater key. The private key is stored outside the repository and in GitHub Actions secrets.

## License and acknowledgments

Meetily is distributed under the [MIT License](LICENSE.md). The original MIT copyright notice is retained as required by that license. Third-party code, libraries, and models retain their respective licenses and attribution.

The project builds on open-source work including [whisper.cpp](https://github.com/ggerganov/whisper.cpp), [Screenpipe](https://github.com/mediar-ai/screenpipe), and NVIDIA Parakeet model tooling.
