import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import crypto from "crypto";
import mysql from "mysql2/promise";
import * as cheerio from "cheerio";

// --- Configuración para El Ciudadano ---
const SOURCE_ID_EL_CIUDADANO = 9; // Asigna un ID único para esta fuente
const PAGE_SIZE = 10; // La API de WP usa 'per_page', 10 es el default
const TOTAL_PAGES = 5; // Cuántas páginas por categoría quieres scrapear
const DELAY_MS = 800; // Mantenemos el delay para no sobrecargar el servidor

// IDs de categorías de El Ciudadano. Puedes obtener más desde:
// https://www.elciudadano.com/wp-json/wp/v2/categories
const categoryIds = {
  actualidad: 9,
  politica: 8,
  chile: 42,
  mundo: 743,
  economia: 7,
  cultura: 18,
};

const categoriesToScrape = [
  categoryIds.actualidad,
  categoryIds.politica,
  categoryIds.chile,
  categoryIds.mundo,
  categoryIds.economia,
  // categoryIds.cultura,
];
let db;

// Caché para no solicitar datos repetidos (autores, etc.)
const authorCache = new Map();

/**
 * Limpia el contenido HTML para extraer solo el texto relevante.
 * @param {string} html - El contenido HTML del artículo.
 * @returns {string} - El texto limpio.
 */
function cleanContent(html) {
  const $ = cheerio.load(html);

  // Eliminar elementos no deseados (scripts, embeds, etc.)
  $(
    "script, style, figure.wp-block-embed, .wp-block-separator, pre.wp-block-preformatted"
  ).remove();

  // Extraer el texto de los párrafos
  const paragraphs = [];
  $("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) {
      paragraphs.push(text);
    }
  });

  return paragraphs.join("\n\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Obtiene el nombre de un autor a partir de su ID, usando una caché.
 * @param {number} authorId - El ID del autor.
 * @returns {Promise<string>} - El nombre del autor.
 */
async function getAuthorName(authorId) {
  if (authorCache.has(authorId)) {
    return authorCache.get(authorId);
  }
  try {
    const response = await axios.get(
      `https://www.elciudadano.com/wp-json/wp/v2/users/${authorId}`
    );
    const authorName = response.data.name;
    authorCache.set(authorId, authorName);
    return authorName;
  } catch (error) {
    console.error(`Error obteniendo autor ID ${authorId}:`, error.message);
    return "Desconocido"; // Retornar un valor por defecto
  }
}

/**
 * Obtiene los artículos de la API de El Ciudadano (WordPress REST API).
 * @param {number} page - Número de página (la API de WP es 1-indexed).
 * @param {number} perPage - Artículos por página.
 * @param {number} categoryId - El ID de la categoría a consultar.
 * @returns {Promise<Array>} - Un array de artículos.
 */
async function fetchArticles(page = 1, perPage = 10, categoryId) {
  const params = new URLSearchParams({
    page: page,
    per_page: perPage,
    categories: categoryId,
    _embed: true, // Importante para incluir datos relacionados como autor y categorías
  });

  const url = `https://www.elciudadano.com/wp-json/wp/v2/posts?${params.toString()}`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  };

  const response = await axios.get(url, { headers });
  return response.data;
}

/**
 * Guarda un artículo en la base de datos.
 * @param {object} article - El objeto del artículo de la API de El Ciudadano.
 */
async function saveArticle(article) {
  const hash = generateHash(article.link);

  // Consultar el nombre del autor usando el caché
  //   const authorName = await getAuthorName(article.author);

  // Extraer nombres de categorías y tags. La API con _embed=true los incluye.
  const embeddedData = article._embedded || {};
  const sections = embeddedData["wp:term"]?.[0]?.map((cat) => cat.name) || [];
  const tags = embeddedData["wp:term"]?.[1]?.map((tag) => tag.name) || [];

  const content = cleanContent(article.content.rendered || "");
  const description = article.acf.resume || article.acf.bajada_titulo || "";

  try {
    await db.execute(
      `INSERT INTO scraped_articles
          (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, // Evita duplicados
      [
        SOURCE_ID_EL_CIUDADANO,
        article.title.rendered,
        description,
        null,
        sections.length > 0 ? sections[0] : "General", // Guarda la primera categoría como principal
        JSON.stringify(tags),
        content,
        article.jetpack_featured_media_url || null,
        article.link,
        new Date(article.date_gmt), // Usar fecha GMT para consistencia
        hash,
      ]
    );
    console.log(`✅ Guardado: ${article.title.rendered}`);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.log(`⚠️ Duplicado (hash): ${article.link}`);
    } else {
      console.error(`❌ Error al guardar: ${err.message}`);
    }
  }
}

async function runElCiudadanoScraper() {
  console.log(`🔄 Iniciando scraper de El Ciudadano...`);
  let newsCount = 0;
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    for (const categoryId of categoriesToScrape) {
      console.log(`🌍 Procesando categoría ID: ${categoryId}`);
      for (let page = 1; page <= TOTAL_PAGES; page++) {
        console.log(`📥 Página ${page}`);
        const articles = await fetchArticles(page, PAGE_SIZE, categoryId);

        if (articles.length === 0) {
          console.log("No se encontraron más artículos en esta categoría.");
          break; // Salir del bucle de páginas si no hay más artículos
        }

        for (const article of articles) {
          try {
            await saveArticle(article);
            console.log(`  Guardado: ${article.title.rendered}`);
            newsCount++;
          } catch (err) {
            if (err.code !== "ER_DUP_ENTRY") {
              console.error(
                `  Error al guardar "${article.title.rendered}":`,
                err.message
              );
            } else {
              console.log(`  Omitido (duplicado): ${article.title.rendered}`);
            }
          }
        }
        await delay(DELAY_MS);
      }
    }
  } catch (err) {
    console.error("❌ Error fatal en el scraper:", err.message);
  } finally {
    if (db) await db.end();
    console.log(
      `✅ Scraper de El Ciudadano finalizado. Total de noticias procesadas: ${newsCount}`
    );
  }

  return newsCount;
}

export default runElCiudadanoScraper;
