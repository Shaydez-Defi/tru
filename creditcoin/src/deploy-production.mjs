import 'dotenv/config';
import { JsonRpcProvider, Wallet, ContractFactory, Contract } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Deploy the production contracts (AGENTS.md build-order step 3):
//   1. SourceLoanMarket        -> Ethereum Sepolia
//   1b. SourceObligationMarket -> Ethereum Sepolia (verifiable economic obligations)
//   2. TRUCreditRegistry       -> Creditcoin CC3 Testnet
//   3. TRUUniversalContract    -> Creditcoin CC3 Testnet (needs registry + decoder)
//   4. TRUFinancing            -> Creditcoin CC3 (reads verified credit)
// Deploys via ethers (forge broadcast is unreliable on CC3 testnet).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

const decoderAddress = process.env.DECODER_CONTRACT ?? '0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f';

function readArtifact(contract, sub) {
  const p = path.resolve(root, `contracts/out/${sub}/${contract}.json`);
  const artifact = JSON.parse(fs.readFileSync(p, 'utf8'));
  const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode.object;
  return { artifact, bytecode };
}

function saveDeployment(chainDir, contract, address, deployTxHash, chainId, abi) {
  const dir = path.resolve(root, `contracts/deployments/${chainDir}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${contract}.json`);
  fs.writeFileSync(file, JSON.stringify({ address, chainId, chain: chainDir, deployTxHash, abi }, null, 2) + '\n');
  console.log(`  saved ${path.relative(root, file)}`);
}

// ---- 1. SourceLoanMarket on Sepolia ----
const sepoliaProvider = new JsonRpcProvider(process.env.SOURCE_RPC_URL ?? process.env.SEPOLIA_RPC_URL);
const sepoliaWallet = new Wallet(process.env.SEPOLIA_PRIVATE_KEY, sepoliaProvider);

console.log('=== deploying SourceLoanMarket (Sepolia) ===');
console.log('  deployer:', sepoliaWallet.address);
{
  const { artifact, bytecode } = readArtifact('SourceLoanMarket', 'SourceLoanMarket.sol');
  const factory = new ContractFactory(artifact.abi, bytecode, sepoliaWallet);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log('  SourceLoanMarket at:', address);
  console.log('  tx:', contract.deploymentTransaction().hash);
  console.log('  gas used:', receipt.gasUsed.toString());
  saveDeployment('sepolia', 'SourceLoanMarket', address, contract.deploymentTransaction().hash, 11155111, artifact.abi);
}

console.log('\n=== deploying SourceObligationMarket (Sepolia) ===');
console.log('  deployer:', sepoliaWallet.address);
let obligationMarketAddress;
{
  const { artifact, bytecode } = readArtifact('SourceObligationMarket', 'SourceObligationMarket.sol');
  const factory = new ContractFactory(artifact.abi, bytecode, sepoliaWallet);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  obligationMarketAddress = await contract.getAddress();
  console.log('  SourceObligationMarket at:', obligationMarketAddress);
  console.log('  tx:', contract.deploymentTransaction().hash);
  console.log('  gas used:', receipt.gasUsed.toString());
  saveDeployment('sepolia', 'SourceObligationMarket', obligationMarketAddress, contract.deploymentTransaction().hash, 11155111, artifact.abi);
}

// ---- 2. TRUCreditRegistry on CC3 ----
const ccProvider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL);
const ccWallet = new Wallet(process.env.CREDITCOIN_PRIVATE_KEY, ccProvider);

console.log('\n=== deploying TRUCreditRegistry (Creditcoin CC3) ===');
console.log('  deployer:', ccWallet.address);
let registryAddress;
{
  const { artifact, bytecode } = readArtifact('TRUCreditRegistry', 'TRUCreditRegistry.sol');
  const factory = new ContractFactory(artifact.abi, bytecode, ccWallet);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  registryAddress = await contract.getAddress();
  console.log('  TRUCreditRegistry at:', registryAddress);
  console.log('  tx:', contract.deploymentTransaction().hash);
  console.log('  gas used:', receipt.gasUsed.toString());
  saveDeployment('creditcoin', 'TRUCreditRegistry', registryAddress, contract.deploymentTransaction().hash, 102031, artifact.abi);
}

// ---- 3. TRUUniversalContract on CC3 (needs registry + source market) ----
const sourceMeta = JSON.parse(
  fs.readFileSync(path.resolve(root, 'contracts/deployments/sepolia/SourceLoanMarket.json'), 'utf8')
);
console.log('\n=== deploying TRUUniversalContract (Creditcoin CC3) ===');
console.log('  decoder        :', decoderAddress);
console.log('  registry       :', registryAddress);
console.log('  sourceLoanMarket:', sourceMeta.address);
let universalContractAddress;
{
  const { artifact, bytecode } = readArtifact('TRUUniversalContract', 'TRUUniversalContract.sol');
  const factory = new ContractFactory(artifact.abi, bytecode, ccWallet);
  const contract = await factory.deploy(decoderAddress, registryAddress, sourceMeta.address);
  const receipt = await contract.deploymentTransaction().wait();
  universalContractAddress = await contract.getAddress();
  console.log('  TRUUniversalContract at:', universalContractAddress);
  console.log('  tx:', contract.deploymentTransaction().hash);
  console.log('  gas used:', receipt.gasUsed.toString());
  saveDeployment('creditcoin', 'TRUUniversalContract', universalContractAddress, contract.deploymentTransaction().hash, 102031, artifact.abi);
}

// ---- 4. Point the registry at the TRUUniversalContract ----
console.log('\n=== configuring TRUCreditRegistry.universalContract ===');
{
  const { artifact } = readArtifact('TRUCreditRegistry', 'TRUCreditRegistry.sol');
  const registry = new Contract(registryAddress, artifact.abi, ccWallet);
  const tx = await registry.setUniversalContract(universalContractAddress);
  const receipt = await tx.wait();
  console.log('  setUniversalContract tx:', receipt.hash);
  console.log('  universalContract ->', universalContractAddress);
}

// ---- 4b. Configure TRUUniversalContract's obligation market ----
console.log('\n=== configuring TRUUniversalContract.sourceObligationMarket ===');
{
  const { artifact } = readArtifact('TRUUniversalContract', 'TRUUniversalContract.sol');
  const uc = new Contract(universalContractAddress, artifact.abi, ccWallet);
  const tx = await uc.setSourceObligationMarket(obligationMarketAddress);
  const receipt = await tx.wait();
  console.log('  setSourceObligationMarket tx:', receipt.hash);
  console.log('  sourceObligationMarket ->', obligationMarketAddress);
}

// ---- 5. TRUFinancing on CC3 (needs registry) ----
console.log('\n=== deploying TRUFinancing (Creditcoin CC3) ===');
console.log('  registry:', registryAddress);
{
  const { artifact, bytecode } = readArtifact('TRUFinancing', 'TRUFinancing.sol');
  const factory = new ContractFactory(artifact.abi, bytecode, ccWallet);
  const contract = await factory.deploy(registryAddress);
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log('  TRUFinancing at:', address);
  console.log('  tx:', contract.deploymentTransaction().hash);
  console.log('  gas used:', receipt.gasUsed.toString());
  saveDeployment('creditcoin', 'TRUFinancing', address, contract.deploymentTransaction().hash, 102031, artifact.abi);
}

console.log('\nDone.');