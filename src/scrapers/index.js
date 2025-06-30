import dotenv from 'dotenv'
dotenv.config()
import { timestamp } from '../../libraries/utils.js'

import runApNewsScraper from './scraper-ap.js'
import runDfNewsScraper from './scraper-df.js'
import runEfeNewsScraper from './scraper-efe.js'
import runEmolNewsScraper from './scraper-emol.js'
import runLaTerceraNewsScraper from './scraper-latercera.js'
import runReutersNewsScraper from './scraper-reuters.js'
import runBiobioScraper from './scraper-biobio.js'
import runCooperativaScraper from './scraper-cooperativa.js'

export async function runAllScrapers() {
  console.log(`🔄 Iniciando todos los scrapers...`)

  try {
    let startTime = Date.now()
    let totalNews = 0
    totalNews += await runApNewsScraper()
    totalNews += await runDfNewsScraper()
    totalNews += await runEfeNewsScraper()
    totalNews += await runEmolNewsScraper()
    totalNews += await runLaTerceraNewsScraper()
    totalNews += await runReutersNewsScraper()
    totalNews += await runBiobioScraper()
    totalNews += await runCooperativaScraper()
    console.log(`✅ Todos los scrapers ejecutados correctamente.`)
    let endTime = Date.now()
    let duration = ((endTime - startTime) / 1000).toFixed(2)
    console.log(`⏱️ Tiempo total de ejecución: ${duration} segundos`)
    console.log(`📰 Total news processed ${totalNews}`)
  } catch (err) {
    console.error(`❌ Error general en la ejecución:`, err)
  }
}
