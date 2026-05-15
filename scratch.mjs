import { getValidDynamicCodes, verifyDynamicCode } from './src/utils/security.js'

console.log("Valid codes right now:", getValidDynamicCodes())

const code = getValidDynamicCodes()[0]
console.log("Verification of", code, ":", verifyDynamicCode(code))
console.log("Verification of WRONG :", verifyDynamicCode("wrong"))
