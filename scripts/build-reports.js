import { generateReports } from '../src/reports.js';

generateReports()
  .then(({ monthlyAttackers, lossReports }) => {
    console.log(`Monthly attackers: ${monthlyAttackers.id} (${monthlyAttackers.rows.length} rows)`);
    for (const [period, report] of Object.entries(lossReports)) {
      console.log(`Losses ${period}: ${report.startDate}..${report.endDate} (${report.rows.length} rows)`);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
