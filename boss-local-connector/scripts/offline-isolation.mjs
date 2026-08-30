import { runOfflineIsolationDrill } from '../src/lib/offline-isolation-drill.mjs'
const report=runOfflineIsolationDrill()
console.log(JSON.stringify(report,null,2))
if(!report.passed)process.exitCode=1
