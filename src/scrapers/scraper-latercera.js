import dotenv from 'dotenv'
dotenv.config()

import fetch from 'node-fetch'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { timestamp } from '../../libraries/utils.js'

const BASE_URL = 'https://www.latercera.com'
const PAGE_SIZE = 12
const NUM_PAGES = 5
const DELAY_MS = 300
let db
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

const SOURCE_ID_LA_TERCERA = 1 // asegúrate de tenerlo en la tabla sources

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

async function fetchNewsPage(offset = 0, size = PAGE_SIZE) {
  const query = {
    feedOffset: offset,
    feedSize: size,
    fromComponent: 'result-list',
    query: 'type:story',
    sectionsExclude: '/opinion, /cartas-al-director, /editorial'
  }

  const url = `${BASE_URL}/pf/api/v3/content/fetch/story-feed-query-fetch?query=${encodeURIComponent(
    JSON.stringify(query)
  )}&_website=la-tercera`

  const response = await fetch(url)
  const json = await response.json()

  return json.content_elements.map((el) => ({
    title: el.headlines?.basic || null,
    description: el.description?.basic || null,
    author: el.credits?.by?.[0]?.name || null,
    date: el.publish_date ? new Date(el.publish_date) : null,
    section: el.taxonomy?.primary_section?.name || null,
    tags: el.taxonomy?.tags?.map((t) => t.text) || [],
    image: el.promo_items?.basic?.url || null,
    url: BASE_URL + el.canonical_url
  }))
}

async function fetchFullContent(articleUrl) {
  try {
    await sleep(DELAY_MS)
    const res = await fetch(articleUrl)
    const html = await res.text()
    const $ = cheerio.load(html)

    const content = []
    $('.article-body__paragraph, .article-body__heading-h2').each((_, el) => {
      const tag = $(el)[0].tagName
      const text = $(el).text().trim()
      if (text) content.push(tag === 'h2' ? `\n\n## ${text}\n` : text)
    })

    return content.join('\n\n')
  } catch (err) {
    console.error('❌ Error leyendo contenido:', articleUrl)
    return '[ERROR AL CARGAR CONTENIDO]'
  }
}

async function saveArticle(article) {
  const hash = generateHash(article.url)

  try {
    await db.execute(
      `INSERT INTO scraped_articles
      (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        SOURCE_ID_LA_TERCERA,
        article.title,
        article.description,
        article.author,
        article.section,
        JSON.stringify(article.tags),
        article.content,
        article.image,
        article.url,
        article.date,
        hash
      ]
    )
    console.log(`✅ Guardado: ${article.title}`)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      console.log(`⚠️ Duplicado (hash): ${article.url}`)
    } else {
      console.error(`❌ Error al guardar: ${err.message}`)
    }
  }
}

async function runLaTerceraNewsScraper() {
  console.log(`🔄 Iniciando scraper de La Tercera...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })
  for (let i = 0; i < NUM_PAGES; i++) {
    const offset = i * PAGE_SIZE
    console.log(`\n📄 Página ${i + 1} (offset ${offset})`)

    const articles = await fetchNewsPage(offset, PAGE_SIZE)

    for (let article of articles) {
      console.log(`   → Procesando: ${article.title}`)
      article.content = await fetchFullContent(article.url)
      await saveArticle(article)
      newsCount++
    }
  }

  await db.end()
  console.log(`✅ La Tercera scraper ended`)
  return newsCount
}

export default runLaTerceraNewsScraper
