import dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.15",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      }
    ]
  },
  defaultNetwork: "hardhat",
  networks: {
    ganache: {
      url: "HTTP://127.0.0.1:7545",
    },
    hardhat: {
      blockGasLimit: 30000000, //default 30 000 000
      gasPrice: 100000000000, //100 Gwei,
      gas: 9000000,
      chainId: 100, //set GNOSIS ID
      forking: {
        enabled: true,
        url: "https://rpc.gnosischain.com/",
      },
      live: false,
      saveDeployments: true,
      tags: ["test", "local"],
      // loggingEnabled: true,
    },
    localhost: {
      url: "http://localhost:8545",
      gasPrice: 20000000000, //20 Gwei,
      loggingEnabled: true
    },
    gnosis: {
      url: "https://rpc.gnosischain.com/",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
  paths: {
    artifacts: "build/artifacts",
    cache: "build/cache",
    deploy: "deploy",
    deployments: "deployments",  
    sources: "contracts",
  },
  namedAccounts: {
    deployer: 0,
    account1: 1,
    account2: 2,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
  },
};
export default config;