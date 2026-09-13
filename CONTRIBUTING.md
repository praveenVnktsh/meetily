# Contributing to Minutes

Issues and pull requests are welcome at [github.com/praveenvnktsh/minutes](https://github.com/praveenvnktsh/minutes).

## Workflow

1. Create a focused branch from `main`.
2. Make the change and add tests where practical.
3. Run the relevant frontend and Rust checks.
4. Open a pull request describing behavior, verification, and user-visible impact.

```bash
git clone https://github.com/YOUR_USERNAME/minutes.git
cd minutes
git switch -c feature/short-description
```

Keep unrelated changes separate and never commit API keys, signing keys, recordings, transcripts, model binaries, or other private data.

## Verification

Common checks include:

```bash
cd frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm build

cd ../frontend/src-tauri
cargo test --release --features metal
```

Use the platform feature appropriate to your machine. See [docs/BUILDING.md](docs/BUILDING.md) for additional setup.

## License

By contributing, you agree that your contribution will be licensed under the repository's MIT License.
