import dotenv from 'dotenv'

dotenv.config()

import axios from 'axios'
import { Parser } from 'xml2js'
import crypto from 'crypto'
import mysql from 'mysql2/promise'

import * as cheerio from 'cheerio'

import { timestamp } from '../../libraries/utils.js'

const RSS_SOURCES = [
  { name: 'País', prefix: 'rss_3___', source_id: 7 },
  { name: 'Mundo', prefix: 'rss_2___', source_id: 8 }
]

const BASE_URL = 'https://www.cooperativa.cl/noticias/site/tax/port/all/'
const MAX_PAGES = 5
const DELAY_MS = 1000

let db
function cleanContent(html) {
  const $ = cheerio.load(html)

  // Extraer párrafos limpios
  const paragraphs = []
  $('p').each((_, el) => {
    const text = $(el).text().trim()
    if (text.length > 0) {
      paragraphs.push(text)
    }
  })

  return paragraphs.join('\n\n')
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

async function parseRSS(xml) {
  const parser = new Parser({ explicitArray: false, mergeAttrs: true })
  const result = await parser.parseStringPromise(xml)
  return result.rss.channel.item || []
}

async function scrapeRSS(url, sourceId) {
  let newsCount = 0
  try {
    const { data } = await axios.get(url)
    const items = await parseRSS(data)

    for (const item of items) {
      try {
        const title = item.title?._ || item.title || ''
        const url = item.link || ''
        const description = cleanContent(item.descent?._ || item.descent || '')
        const content = cleanContent(
          item.description?._ || item.description || ''
        )
        const category = item.category || ''
        const published_at = new Date(item.pubDate)
        const author = item.author?.replace('Autor :', '').trim() || null
        const image_url = item['media:content']?.url || null
        const hash = generateHash(url)

        if (!title || !url || !published_at) continue

        await db.query(
          `INSERT INTO scraped_articles
              (source_id, title, description, author, section, content, image_url, url, published_at, hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            8,
            title,
            description,
            author,
            category,
            content,
            image_url,
            url,
            published_at,
            hash
          ]
        )
        console.log(`Guardado: ${title}`)
        newsCount++
      } catch (error) {
        console.error(`❌ Error al guardar "${title}":`, error.message)
      }
    }
  } catch (error) {
    console.error('❌ Error fetching RSS:', url, error.message)
  }
  return newsCount
}

async function runCooperativaScraper() {
  console.log(`🔄 Iniciando scraper de Cooperativa...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })
  for (const source of RSS_SOURCES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rssUrl = `${BASE_URL}${source.prefix}${page}.xml`
      console.log(`⏳ Fetching ${source.name} RSS page ${page}`)
      newsCount += await scrapeRSS(rssUrl, source.source_id)
      await delay(DELAY_MS)
    }
  }

  await db.end()
  console.log(`✅ Cooperativa scraper ended`)
  return newsCount
}

export default runCooperativaScraper
