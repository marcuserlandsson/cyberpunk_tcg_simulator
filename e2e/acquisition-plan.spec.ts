import { test,expect } from '@playwright/test'
const starter={demo:true,legends:['goro-takemura-hands-unclean','yorinobu-arasaka-embracing-destruction','saburo-arasaka-stubborn-patriarch']}
test('plans shared and assembled decks with optional binder copies',async({page})=>{
  await page.addInitScript(({starter})=>localStorage.setItem('ctcg:decks:v1',JSON.stringify({
    'Plan A':{...starter,name:'Plan A',cards:{'industrial-assembly':3}},
    'Plan B':{...starter,name:'Plan B',cards:{'industrial-assembly':2}},
  })),{starter})
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
  await page.getByTestId('expand-industrial-assembly').click()
  await page.getByTestId('printing-inc-arasakademodeck/006').click()
  await page.getByTestId('printing-inc-arasakademodeck/006').click()
  const planner=page.getByTestId('acquisition-planner')
  await planner.locator('summary').first().click()
  await planner.getByLabel('Plan A',{exact:true}).check()
  await planner.getByLabel('Plan B',{exact:true}).check()
  const row=planner.locator('[data-card-id="industrial-assembly"]')
  await expect(row.locator('td').nth(5)).toHaveText('1')
  await page.getByTestId('acquisition-mode').selectOption('assembled')
  await expect(row.locator('td').nth(5)).toHaveText('3')
  await page.getByTestId('reserve-artwork').check()
  await expect(row.locator('td').nth(5)).toHaveText('4')
  await expect(row.locator('td').nth(2)).toHaveText('2')
  await expect(page.getByTestId('acquisition-list')).toHaveValue(/4x Industrial Assembly/)
})
