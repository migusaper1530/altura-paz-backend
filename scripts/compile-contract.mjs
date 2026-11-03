import solc from 'solc';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const input={language:'Solidity',sources:{'RouteRegistry.sol':{content:readFileSync('contracts/RouteRegistry.sol','utf8')}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return {contents:readFileSync(join('node_modules',p),'utf8')};}catch{return {error:`Import no encontrado: ${p}`};}}}));
const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
const contract=output.contracts['RouteRegistry.sol'].RouteRegistry;
mkdirSync('deployments',{recursive:true});writeFileSync('deployments/artifact.json',JSON.stringify({abi:contract.abi,bytecode:'0x'+contract.evm.bytecode.object,compiler:solc.version()},null,2));
console.log('RouteRegistry compilado con Solidity '+solc.version());
