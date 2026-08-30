import { runOfflineFaultMatrix } from '../src/lib/offline-fault-matrix.mjs'
const report=await runOfflineFaultMatrix()
console.log(JSON.stringify(report,null,2))
if(!report.passed)process.exitCode=1
