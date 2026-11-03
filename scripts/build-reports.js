import { generateReports } from '../src/reports.js';

generateReports()
  .then(({ monthReports, weekReports, attackerRollingReports, lossReports }) => {
    console.log(`Attacker months: ${monthReports.map((report) => report.id).join(', ')}`);
    console.log(`Attacker weeks: ${weekReports.map((report) => report.id).join(', ')}`);
    for (const [period, report] of Object.entries(attackerRollingReports)) {
      console.log(`Attackers ${period}: ${report.startDate}..${report.endDate} (${report.rows.length} rows)`);
    }
    for (const [period, report] of Object.entries(lossReports)) {
      console.log(`Losses ${period}: ${report.startDate}..${report.endDate} (${report.rows.length} rows)`);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
