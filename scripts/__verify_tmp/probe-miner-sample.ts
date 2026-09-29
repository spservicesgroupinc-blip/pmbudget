// One-off probe: does the miner false-positive on quantity-only line items?
import { mineEstimateDollars } from '../../estimateTextMiner.ts';
import { RAW_ESTIMATE_SNIPPET } from '../../src/services/sampleEstimates.ts';

const mined = mineEstimateDollars(RAW_ESTIMATE_SNIPPET);
console.log('amount_tokens =', mined.amount_tokens);
console.log('summary =', JSON.stringify(mined.summary));
console.log('lines:');
for (const l of mined.lines) console.log(' ', l.code, l.amounts, '-> total', l.total, 'qty', l.qty, 'unit', l.unit);
console.log('codes_totals =', JSON.stringify(mined.codes_totals));
console.log('division_totals =', JSON.stringify(mined.division_totals));
