# Disabled upstream workflows

The workflow files in this directory are preserved from the upstream Readest
project, but GitHub does not execute them because they are outside
`.github/workflows/`.

This fork uses `.github/workflows/fork-release.yml` instead. It builds release
installers for Android, Windows, Linux, and macOS whenever `master` is pushed,
without publishing to the upstream Readest release, R2, updater, or deployment
infrastructure.

When syncing from upstream, keep new upstream workflows in this directory
unless they have been explicitly reviewed and adapted for this fork.
