import dotenv from 'dotenv'
dotenv.config()

import fetch from 'node-fetch'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { timestamp } from '../../libraries/utils.js'

const BASE_URL = 'https://www.df.cl'
const START_URL = `${BASE_URL}/ultimasnoticias`
const DELAY_MS = 300
const SOURCE_ID_DF = 3 // Asegúrate que Diario Financiero tenga este ID en tu tabla sources
let db
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

async function getNewsList() {
  const response = await fetch(START_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    }
  })

  const html = await response.text()
  const $ = cheerio.load(html)
  const noticias = []

  $('article.card.card__horizontal').each((_, el) => {
    const title = $(el).find('h3.card__title').text().trim()
    const links = $(el)
      .find("a[href^='/']")
      .map((_, a) => $(a).attr('href'))
      .get()
    const validLinks = links.filter((href) => href && !href.includes('/tax/'))
    if (validLinks.length === 0) return

    const relativeUrl = validLinks.reduce((prev, curr) =>
      curr.length > prev.length ? curr : prev
    )
    const url = BASE_URL + relativeUrl

    const tagText = $(el).find('a.card__tag').text().trim()
    const [section, date] = tagText.split('|').map((s) => s.trim())

    const imgSrc = $(el).find('img').attr('src') || ''
    const image = imgSrc.startsWith('/') ? BASE_URL + imgSrc : imgSrc

    noticias.push({ title, url, section, date, image })
  })

  return noticias
}

async function getNewsDetails(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    }
  })

  const html = await response.text()
  const $ = cheerio.load(html)

  const content = $('#articleLock p, #articleLock div.art-box')
    .map((_, el) => $(el).text().trim())
    .get()
    .join('\n\n')

  const bajada = $('.enc-main__description')
    .map((_, el) => $(el).text().trim())
    .get()
    .join(' ')

  const author = $('.author__name, .bold')
    .first()
    .text()
    .trim()
    .replace('Por: ', '')

  return { content, bajada, author }
}

async function saveArticle(article) {
  const hash = generateHash(article.url)

  try {
    await db.execute(
      `INSERT INTO scraped_articles
      (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        SOURCE_ID_DF,
        article.title,
        article.description,
        article.author,
        article.section,
        JSON.stringify([]),
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

async function runDfNewsScraper() {
  console.log(`🔄 Iniciando scraper de DF...`)
  const noticias = await getNewsList()
  let newsCount = noticias.length
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  for (const [i, noticia] of noticias.entries()) {
    console.log(`📰 Procesando noticia ${i + 1}/${noticias.length}`)
    try {
      const detalle = await getNewsDetails(noticia.url)
      noticia.content = detalle.content
      noticia.description = detalle.bajada
      noticia.author = detalle.author
      await saveArticle(noticia)
    } catch (err) {
      console.warn(`⚠️ Error en ${noticia.url}: ${err.message}`)
    }
    await delay(DELAY_MS)
  }

  await db.end()
  console.log(`✅ DF scraper ended`)
  return newsCount
}

export default runDfNewsScraper
