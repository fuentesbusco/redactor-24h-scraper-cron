import dotenv from 'dotenv'
dotenv.config()

import cron from 'node-cron'
import { runAllScrapers } from './src/scrapers/index.js'
import { timestamp } from './libraries/utils.js'
import { randomDelay } from './libraries/utils.js'

let lastExecution = null

function alreadyExecutedThisHour() {
  const now = new Date()
  const currentHourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`
  return lastExecution === currentHourKey
}

async function runCronScrapers() {
  console.log(`🔄 Iniciando todos los scrapers...\n`)
  try {
    await runAllScrapers()
    console.log(`✅ Todos los scrapers finalizados.\n`)
  } catch (err) {
    console.error(`❌ Error general en la ejecución:`, err)
  }
}

console.log('🕓 Scheduler planned at  0, 3, 6, 9, 12, 15, 18 and 21 hrs')

cron.schedule('0 0,3,6,9,12,15,18,21 * * *', async () => {
  console.log(`🔄 Iniciando ejecución de scrapers`)
  const now = new Date().toISOString()
  if (alreadyExecutedThisHour()) {
    console.log(`⏭️ Ya ejecutado en esta hora. Ignorando... (${now})`)
    return
  }

  const delay = Math.floor(Math.random() * 10000)
  console.log(`⏳ Esperando ${delay}ms antes de ejecutar... (${now})`)
  await randomDelay()

  lastExecution = `${new Date().getUTCFullYear()}-${new Date().getUTCMonth()}-${new Date().getUTCDate()}-${new Date().getUTCHours()}`

  console.log(`🕓 Ejecutando scraper a las ${now}`)
  await runCronScrapers()
})
