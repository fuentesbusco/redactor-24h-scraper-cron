import dotenv from 'dotenv'
dotenv.config()

import fetch from 'node-fetch'
import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import mysql from 'mysql2/promise'
import { decode } from 'html-entities'
import { timestamp } from '../../libraries/utils.js'

const BASE_NEWS_API =
  'https://newsapi.ecn.cl/NewsApi/emol/ultimoMinuto/*/not:109'
const PAGE_SIZE = 15
const PAGES = 5
const DELAY_MS = 500

const SOURCE_ID_EMOL = 2 // Asegúrate que el ID de Emol esté en la tabla `sources`
let db
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms))
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

function extractImageUrl(source) {
  const medios = source.tablas?.tablaMedios || []
  const media = medios.find((m) => m.IdTipoMedio === 1)
  if (media && media.Url) {
    return media.Url.replace('staticemol.gen.emol.cl', 'static.emol.cl/emol50')
      .replace('.jpg', '_0lx0.jpg')
      .replace(/^http:/, 'https:')
  }
  return null
}

function cleanHtml(html) {
  return decode(
    html
      .replace(/<div>/g, '')
      .replace(/<\/div>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
  )
}

async function getNewsFromApi(from) {
  const url = `${BASE_NEWS_API}?size=${PAGE_SIZE}&from=${from}`
  const response = await fetch(url)
  const json = await response.json()

  if (!json?.hits?.hits) return []

  return json.hits.hits.map((hit) => {
    const source = hit._source
    return {
      title: decode(source.titulo || ''),
      description: source.bajada?.[0]?.texto || null,
      author: source.autor || null,
      section: source.seccion || null,
      tags: (source.temas || []).map((t) => t.nombre),
      content: cleanHtml(source.texto || ''),
      image_url: extractImageUrl(source),
      url: source.permalink,
      date: source.fechaModificacion ? new Date(source.fechaModificacion) : null
    }
  })
}

async function saveArticle(article) {
  const hash = generateHash(article.url)

  try {
    await db.execute(
      `INSERT INTO scraped_articles
      (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        SOURCE_ID_EMOL,
        article.title,
        article.description,
        article.author,
        article.section,
        JSON.stringify(article.tags),
        article.content,
        article.image_url,
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

async function runEmolNewsScraper() {
  console.log(`🔄 Iniciando scraper de Emol...`)
  let newsCount = 0
  db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  })

  for (let i = 0; i < PAGES; i++) {
    const from = i * PAGE_SIZE
    console.log(`🔎 Cargando página ${i + 1} (offset ${from})`)

    const newsList = await getNewsFromApi(from)
    for (const article of newsList) {
      console.log(`   → Procesando: ${article.title}`)
      await saveArticle(article)
      newsCount++
    }

    await delay(DELAY_MS)
  }

  await db.end()
  console.log(`✅ EMOL scraper ended`)
  return newsCount
}

export default runEmolNewsScraper
