import dotenv from 'dotenv'
dotenv.config()

import axios from 'axios'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { timestamp } from '../../libraries/utils.js'

const SOURCE_ID_REUTERS = 6
const PAGE_SIZE = 15
const TOTAL_PAGES = 6
const DELAY_MS = 800
let db
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

const headers = {
  accept: '*/*',
  'accept-language': 'es,en-US;q=0.9,en;q=0.8',
  priority: 'u=1, i',
  'sec-ch-device-memory': '8',
  'sec-ch-ua':
    '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-full-version-list':
    '"Google Chrome";v="137.0.7151.103", "Chromium";v="137.0.7151.103", "Not/A)Brand";v="24.0.0.0"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  referer: 'https://www.reuters.com/world/',
  cookie: process.env.REUTERS_COOKIE || ''
}

function buildListUrl(offset) {
  const query = {
    'arc-site': 'reuters',
    fetch_type: 'collection',
    offset,
    section_id: '/world/',
    size: PAGE_SIZE,
    uri: '/world/',
    website: 'reuters'
  }

  return `https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-alias-or-id-v1?query=${encodeURIComponent(
    JSON.stringify(query)
  )}&d=291&mxId=00000000&_website=reuters`
}

function buildDetailUrl(uri) {
  const query = {
    uri,
    website: 'reuters',
    published: 'true',
    website_url: uri,
    'arc-site': 'reuters'
  }

  return `https://www.reuters.com/pf/api/v3/content/fetch/article-by-id-or-url-v1?query=${encodeURIComponent(
    JSON.stringify(query)
  )}&d=291&mxId=00000000&_website=reuters`
}

async function getArticlesFromPage(offset) {
  const url = buildListUrl(offset)
  try {
    const response = await axios.get(url, { headers })
    const items = response.data?.result?.articles ?? []

    return items.map((item) => {
      return {
        uri: item.canonical_url,
        url: `https://www.reuters.com${item.canonical_url}`,
        title: item.title || '',
        description: item.description || '',
        section: item.kicker?.names[0] ?? 'World',
        image_url: item.thumbnail?.url || '',
        date: item.published_time
      }
    })
  } catch (err) {
    console.error(
      `❌ Error al obtener artículos (offset ${offset}): ${err.message}`
    )
    return []
  }
}

async function getArticleDetail(article) {
  const url = buildDetailUrl(article.uri)
  const res = await axios.get(url, { headers })
  const result = res.data?.result
  const author =
    result?.authors
      ?.map((a) => a?.name)
      .filter(Boolean)
      .join(', ') || null

  const paragraphs = result?.content_elements
    ?.filter((el) => el.type === 'paragraph' && el.content)
    .map((el) => el.content.trim())

  const content = paragraphs?.join('\n\n') || ''
  const tags = result?.taxonomy?.keywords || []

  const image_url =
    result?.related_content?.images?.[0]?.url || article.image_url || ''

  return {
    ...article,
    content,
    author,
    tags,
    image_url
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
        SOURCE_ID_REUTERS,
        article.title,
        article.description,
        article.author || null,
        article.section,
        JSON.stringify(article.tags || []),
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
      console.log(`⚠️ Duplicado: ${article.url}`)
    } else {
      console.error(`❌ Error al guardar: ${err.message}`)
    }
  }
}

async function runReutersScraper() {
  console.log(`🔄 Iniciando scraper de Reuters...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  for (let page = 0; page < TOTAL_PAGES; page++) {
    const offset = page * PAGE_SIZE
    console.log(`📥 Página ${page + 1} (offset ${offset})`)
    const articles = await getArticlesFromPage(offset)

    for (const [i, article] of articles.entries()) {
      console.log(`🔎 Detalle ${i + 1}/${articles.length}: ${article.title}`)
      try {
        const full = await getArticleDetail(article)
        await saveArticle(full)
      } catch (err) {
        console.error(article)
        console.warn(`⚠️ Error en ${article.url}: ${err.message}`)
      }
      newsCount++
      await delay(DELAY_MS)
    }
  }

  await db.end()
  console.log(`✅ Reuters scraper ended`)
  return newsCount
}

export default runReutersScraper
