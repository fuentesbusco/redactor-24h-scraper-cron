import dotenv from 'dotenv'
dotenv.config()
import axios from 'axios'
import crypto from 'crypto'
import mysql from 'mysql2/promise'
import * as cheerio from 'cheerio'

import { timestamp } from '../../libraries/utils.js'

const SOURCE_ID_BIOBIO = 7
const PAGE_SIZE = 10
const TOTAL_PAGES = 5
const DELAY_MS = 800
const categories = ['group-internacional', 'group-nacional', 'group-economia']
let db

function cleanContent(html) {
  const $ = cheerio.load(html)

  // Eliminar secciones de "lee también" y embeds sociales
  $('.lee-tambien-bbcl, blockquote.instagram-media, script').remove()

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
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

async function fetchArticles(
  limit = 10,
  offset = 0,
  category = 'group-nacional'
) {
  const url = `https://www.biobiochile.cl/lista/api/get-todo-sin-robin?limit=${limit}&offset=${offset}&categorias=${category}&t=${Date.now()}`

  const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'es,en-US;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: 'https://www.biobiochile.cl/lista/categorias/nacional',
    'sec-ch-ua':
      '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
  }

  const response = await axios.get(url, { headers })
  return response.data
}

async function saveArticle(article) {
  const hash = generateHash(article.post_URL_https)
  const tags = article.post_tags?.map((t) => t.name) || []
  const content = cleanContent(article.post_content || '')
  const image = article.post_image?.thumbnails?.large?.URL
    ? `https://media.biobiochile.cl/wp-content/uploads/${article.post_image.thumbnails.large.URL}`
    : null

  await db.execute(
    `INSERT INTO scraped_articles
        (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      SOURCE_ID_BIOBIO,
      article.post_title,
      article.post_excerpt || '',
      article.author?.display_name || '',
      article.primary || '',
      JSON.stringify(tags),
      content,
      image,
      article.post_URL_https,
      article.raw_post_date ? new Date(article.raw_post_date) : null,
      hash
    ]
  )
}

async function runBiobioScraper() {
  console.log(`🔄 Iniciando scraper de Biobio...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  try {
    for (const category of categories) {
      console.log(`🌍 Procesando categoría: ${category}`)
      for (let page = 0; page < TOTAL_PAGES; page++) {
        const offset = page * PAGE_SIZE
        console.log(`📥 Página ${page + 1} (offset ${offset})`)
        const data = await fetchArticles(PAGE_SIZE, offset, category)
        for (const article of data) {
          try {
            await saveArticle(article)
            console.log(`Guardado: ${article.post_title}`)
          } catch (err) {
            console.error(
              `Error al guardar "${article.post_title}":`,
              err.message
            )
          }
          newsCount++
        }
        await delay(DELAY_MS)
      }
    }
  } catch (err) {
    console.error('Error al obtener artículos:', err.message)
  } finally {
    await db.end()
  }
  console.log(`✅ Biobio scraper ended`)
  return newsCount
}

export default runBiobioScraper
