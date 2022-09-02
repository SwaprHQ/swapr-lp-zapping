# Swapr LP Zapping

This repository contains Zap contract which allows Swapr user to convert single-asset coins straight into LP tokens.

## Clone Repository

`git clone https://github.com/SwaprDAO/swapr-lp-zapping.git`

## Install Dependencies

`yarn`

## Compile Contracts

`yarn compile`

## Run Tests

`yarn test`

## Deployment

Add `PRIVATE_KEY` of deployer to `.env`

```shell
echo "PRIVATE_KEY=<private-key>" > .env
```

Deploy to target network. Make sure its configuration exists in `hardhat.config.ts`

`yarn deploy:<target_network>`
