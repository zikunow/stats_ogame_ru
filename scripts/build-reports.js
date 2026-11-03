import { generateReports } from '../src/reports.js';

generateReports()
  .then(({ monthlyAttackers, dailyLosses }) => {
    console.log(`Monthly attackers: ${monthlyAttackers.id} (${monthlyAttackers.rows.length} rows)`);
    console.log(`Daily losses: ${dailyLosses.id} (${dailyLosses.rows.length} rows)`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
