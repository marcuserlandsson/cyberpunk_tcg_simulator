import { test as base } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { resolve,sep } from 'node:path'
export * from '@playwright/test'
const root=resolve(process.cwd(),'test-results')
async function cleanScratch(){
  for(const name of ['e2e-collection.json','e2e-collection.backup.json']){
    const target=resolve(root,name)
    if(!target.startsWith(root+sep))throw new Error('Scratch cleanup escaped test-results')
    await rm(target,{force:true,recursive:true})
  }
}
export const test=base.extend<{isolatedCollection:void}>({
  isolatedCollection:[async({},use)=>{await cleanScratch();await use();await cleanScratch()},{auto:true}],
})
