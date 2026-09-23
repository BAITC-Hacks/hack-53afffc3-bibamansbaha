import { cleanPaymentMessages } from '../src/server/privacy-maintenance';
const [database, mode] = process.argv.slice(2);
if (!database || !['--dry-run', '--apply'].includes(mode)) throw new Error('Usage: node --import tsx scripts/clean-payment-messages.ts <database-path> --dry-run|--apply');
console.log(JSON.stringify(cleanPaymentMessages(database, mode === '--apply')));
