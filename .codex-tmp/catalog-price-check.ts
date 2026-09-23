import { fetchPocamarketProductState, loadPocamarketApiConfig } from '../src/lib/pocamarket-api-collector';
process.loadEnvFile('.env');
fetchPocamarketProductState('505706',loadPocamarketApiConfig()).then(state=>console.log(JSON.stringify({sku:'505706',...state}))).catch(e=>{console.error(e instanceof Error?e.name:'collector failed');process.exitCode=1});
