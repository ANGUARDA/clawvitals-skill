# Contributing to ClawVitals

Thanks for your interest. ClawVitals is a security product — accuracy matters more than breadth.

## What we most need

- **New control proposals** — open an issue with: what it checks, why it matters, data source, known false positives
- **Fixture improvements** — better coverage against real OpenClaw configurations
- **False positive reports** — if a stable control fires incorrectly, open an issue with sanitised CLI output
- **Docs corrections** — if a remediation step is wrong or outdated

## Process

1. Open an issue before non-trivial work
2. Fork, branch, implement
3. Add tests — stable controls need PASS + FAIL fixture coverage
4. `npm test && npm run test:integration` must pass
5. Open a PR

## Control contributions

New controls ship as `experimental` first. Promoted to `stable` after validation across 3+ real configurations with <5% false positive rate.

## License

By contributing, you agree your contributions are licensed under MIT.
