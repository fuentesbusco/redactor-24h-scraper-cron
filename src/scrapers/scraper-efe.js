import dotenv from 'dotenv'
dotenv.config()

import fetch from 'node-fetch'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { timestamp } from '../../libraries/utils.js'

const BASE_URL = 'https://efe.com/mundo'
const MAX_PAGES = 5
const DELAY_MS = 300
const SOURCE_ID_EFE = 5 // Asegúrate de tener este ID en tu tabla `sources`
let db
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

async function getNewsListFromPage(page = 1) {
  const url = page === 1 ? BASE_URL : `${BASE_URL}/page/${page}/`
  const response = await fetch(url)
  const html = await response.text()
  const $ = cheerio.load(html)

  const articles = []

  $('article').each((i, el) => {
    const title = $(el).find('h2.entry-title a').text().trim()
    const url = $(el).find('h2.entry-title a').attr('href')
    if (!url || url.includes('/tax/')) return

    const date = $(el).find('time.entry-date').attr('datetime') || null
    const image = $(el).find('.post-image img').attr('src') || null
    const description = $(el).find('.entry-summary p').text().trim() || null
    const section = $(el).find('footer .cat-links a').text().trim() || null
    const tags = []
    $(el)
      .find('.tags-links a')
      .each((i, tagEl) => tags.push($(tagEl).text().trim()))

    articles.push({ title, url, date, image, description, section, tags })
  })

  return articles
}

async function getNewsDetails(news) {
  try {
    const response = await fetch(news.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36',
        Accept: 'text/html'
      },
      redirect: 'follow'
    })

    const html = await response.text()
    const $ = cheerio.load(html)

    const author =
      $('.author__name span').text().trim() ||
      $('.entry-meta .author').text().trim() ||
      null

    const content = $('.entry-content p')
      .map((_, el) => $(el).text().trim())
      .get()
      .join('\n\n')

    return {
      ...news,
      author,
      content
    }
  } catch (error) {
    console.error(`❌ Error en "${news.title}":`, error.message)
    return {
      ...news,
      author: null,
      content: '[ERROR AL CARGAR CONTENIDO]'
    }
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
        SOURCE_ID_EFE,
        article.title,
        article.description,
        article.author,
        article.section,
        JSON.stringify(article.tags),
        article.content,
        article.image,
        article.url,
        article.date ? new Date(article.date) : null,
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

async function runEfeNewsScraper() {
  console.log(`🔄 Iniciando scraper de EFE...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`📄 Extrayendo página ${page}/${MAX_PAGES}`)
    const articles = await getNewsListFromPage(page)

    for (const [i, article] of articles.entries()) {
      console.log(`✍️  Procesando noticia ${i + 1}/${articles.length}`)
      const fullArticle = await getNewsDetails(article)
      await saveArticle(fullArticle)
      await delay(DELAY_MS)
      newsCount++
    }

    await delay(500) // entre páginas
  }

  await db.end()
  console.log(`✅ EFE scraper ended`)
  return newsCount
}

export default runEfeNewsScraper
