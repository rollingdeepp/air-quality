# Air Quality

Air quality verification and attestation system on GenLayer.

- **App**: https://rollingdeepp.github.io/air-quality/
- **Network**: GenLayer Studionet

## Overview

A decentralized platform for tracking, verifying, and attesting air quality measurements. The contract enables transparent submission of air quality data, validates measurements against trusted sources, and maintains an auditable record of environmental conditions.

## Features

- Real-time air quality data submission
- Multi-source validation and verification
- Transparent attestation records
- Historical data tracking
- Geographic coverage mapping
- Automated alert thresholds

## Structure

- `backend/` - GenLayer smart contract (air-quality.py)
- `frontend/` - React + TypeScript + Vite web application

## Develop

```bash
cd frontend
npm install
npm run dev      # http://localhost:5380
```

## Build

```bash
cd frontend
npm run build    # static output in dist/
```

## Deploy

This project is automatically deployed to GitHub Pages via GitHub Actions on every push to main.
