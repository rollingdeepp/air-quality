# HazeLine

Air-quality registry.

The contract logic runs fully on-chain. A decentralised panel of GenLayer validators reads the
submitted evidence, reaches consensus on the outcome, and stores the result on-chain so it cannot be
quietly changed after the fact.

## Contract

- Network: GenLayer Studionet
- Address: `0xF2Cd5d0Dab900933F08c662bc41c2efc7b18774D`

## Develop

```bash
npm install
npm run dev      # http://localhost:5380
```

## Build

```bash
npm run build    # static output in dist/
```

## Deploy

This is a static Vite single-page app. Push this folder to a GitHub repository and import it on
Vercel (no configuration needed), or run `npx vercel` from here. The included `vercel.json`
handles single-page-app routing.