import dotenv from 'dotenv'
dotenv.config()

import fetch from 'node-fetch'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { timestamp } from '../../libraries/utils.js'

const BASE_URL = 'https://apnews.com'
const START_URL = `${BASE_URL}/world-news`
const DELAY_MS = 300
const SOURCE_ID_AP = 4 // Asegúrate de registrar AP con este ID en tu tabla `sources`
let db
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

function getHighResImage(srcset = '') {
  const parts = srcset.split(',')
  const last = parts[parts.length - 1]
  const url = last?.split(' ')[0]
  return url?.trim() || ''
}

async function getNewsList(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    }
  })

  const html = await response.text()
  const $ = cheerio.load(html)
  const articles = []

  $('.PagePromo-content').each((_, el) => {
    const $el = $(el).closest('.PagePromo')
    const title = $el
      .find('h3.PagePromo-title span.PagePromoContentIcons-text')
      .text()
      .trim()
    const href = $el.find('h3.PagePromo-title a').attr('href')
    const description = $el.find('.PagePromo-description').text().trim()
    const image = $el.find('img.PagePromo-image-img').attr('src') || ''
    const date = $el.find('span.Timestamp').text().trim()

    if (href && href.startsWith('http')) {
      articles.push({
        title,
        description,
        url: href,
        image,
        date,
        section: 'World'
      })
    }
  })

  return articles
}

async function getNewsDetail(article) {
  const response = await fetch(article.url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    }
  })

  const html = await response.text()
  const $ = cheerio.load(html)

  const content = $('.RichTextStoryBody p')
    .map((_, el) => $(el).text().trim())
    .get()
    .join('\n\n')

  const author = $('.Page-byline-info .Page-authors span.Link').text().trim()
  const dateFull = $('.Page-byline-info .Page-dateModified span[data-date]')
    .text()
    .trim()

  const imgSrcSet = $('.RichTextBody img.Image').first().attr('srcset') || ''
  const highResImage = getHighResImage(imgSrcSet)

  return {
    ...article,
    author,
    content,
    date: dateFull || article.date,
    image_url: highResImage || article.image
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
        SOURCE_ID_AP,
        article.title,
        article.description,
        article.author || null,
        article.section,
        JSON.stringify([]),
        article.content,
        article.image_url,
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

async function runApNewsScraper() {
  console.log(`🔄 Iniciando scraper de AP News...`)
  const articles = await getNewsList(START_URL)
  const articlesUS = await getNewsList('https://apnews.com/us-news')

  let newsCount = articles.length + articlesUS.length
  console.log(`📄 Encontradas ${newsCount} noticias en AP News`)
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  const allArticles = [...articles, ...articlesUS]

  for (const [i, article] of allArticles.entries()) {
    console.log(`🌍 Procesando noticia ${i + 1}/${allArticles.length}`)
    try {
      const fullArticle = await getNewsDetail(article)
      await saveArticle(fullArticle)
    } catch (err) {
      console.warn(`⚠️ Error en ${article.url}: ${err.message}`)
    }
    await delay(DELAY_MS)
  }

  await db.end()
  console.log(`✅ AP scraper ended`)
  return newsCount
}

export default runApNewsScraper
