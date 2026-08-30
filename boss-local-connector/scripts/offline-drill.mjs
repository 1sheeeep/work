import { runOfflineDrillSuite } from '../src/lib/offline-drill-suite.mjs'

const report = await runOfflineDrillSuite()
console.log(JSON.stringify({ mode: report.mode, productionEnabled: report.productionEnabled, actionCount: report.actionCount, passed: report.passed, actions: report.results.map(x => ({ actionType: x.actionType, outcome: x.outcome, evidenceSource: x.evidenceSource })) }, null, 2))
