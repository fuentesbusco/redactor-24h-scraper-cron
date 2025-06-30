import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import crypto from "crypto";
import mysql from "mysql2/promise";
import * as cheerio from "cheerio";

// --- Configuración para CiperChile ---
const SOURCE_ID_CIPER = 10; // Asigna un ID único para esta fuente
const PAGE_SIZE = 10; // Artículos por página
const TOTAL_PAGES = 5; // Total de páginas a scrapear
const DELAY_MS = 800; // Delay entre peticiones de páginas

const categoryIds = {
  actualidad: 3,
  columna: 725,
};

const categoriesToScrape = [
  categoryIds.actualidad,
  //   categoryIds.columna,
];

let db;

/**
 * Limpia el contenido HTML para extraer texto legible.
 * @param {string} html - El contenido HTML del artículo.
 * @returns {string} - El texto limpio y formateado.
 */
function cleanContent(html) {
  if (!html) return "";
  const $ = cheerio.load(html);

  // Eliminar elementos no deseados como scripts, estilos, o bloques de "recomendados"
  $("script, style, .relacionados, .tags, .autor").remove();

  let contentText = "";
  // Extraer texto de párrafos y blockquotes para mantener la estructura
  $("p, blockquote").each((_, element) => {
    const text = $(element).text().trim();
    if (text) {
      // Si es un blockquote, lo marcamos para que se note en el texto plano
      if ($(element).is("blockquote")) {
        contentText += `> ${text}\n\n`;
      } else {
        contentText += `${text}\n\n`;
      }
    }
  });

  return contentText.trim();
}

/**
 * Limpia el extracto (description) de etiquetas HTML.
 * @param {string} html - El HTML del extracto.
 * @returns {string} - El texto limpio del extracto.
 */
function cleanDescription(html) {
  if (!html) return null;
  if (html.length < 10) return null; // Si es muy corto, probablemente no es un extracto válido
  const $ = cheerio.load(html);
  return $("p").text().trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Limpia el contenido HTML de la PÁGINA del artículo.
 * @param {string} html - El HTML de la página completa del artículo.
 * @returns {string} - El texto limpio y formateado.
 */
function cleanArticleContent(html) {
  if (!html) return "";
  const $ = cheerio.load(html);

  // El contenido principal de los artículos de Ciper está en este div
  const contentNode = $("div.col-lg-9").first();

  if (!contentNode.length) {
    console.log("   -> No se encontró el contenedor de contenido '.col-lg-9'.");
    return "";
  }

  // Eliminar elementos no deseados dentro del contenido (banners, etc.)
  contentNode.find('a[href*="posgrados.udp.cl"]').remove();
  contentNode.find(".wp-caption").remove(); // Elimina los contenedores de imágenes con pie de foto

  let contentText = "";
  // Extraer texto de párrafos <p> y subtítulos <h2>
  contentNode.find("p.texto-nota, h2.titulo-nota").each((_, element) => {
    const text = $(element).text().trim();
    if (text) {
      contentText += `${text}\n\n`;
    }
  });

  return contentText.trim();
}

/**
 * Obtiene los artículos de la API de CiperChile.
 * @param {number} page - Número de página (1-indexed).
 * @param {number} perPage - Artículos por página.
 * @returns {Promise<Array>} - Un array de artículos.
 */
async function fetchArticles(page = 1, perPage = 10, categoryId) {
  const params = new URLSearchParams({
    page: page,
    per_page: perPage,
    categories: categoryId,
    _embed: true,
  });

  const url = `https://www.ciperchile.cl/wp-json/wp/v2/posts?${params.toString()}`;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  };

  console.log(`  -> Consultando API: ${url}`);

  const response = await axios.get(url, { headers });
  return response.data;
}

/**
 * Obtiene el contenido completo de un artículo visitando su URL. // <-- CAMBIO CLAVE
 */
async function getFullArticleContent(articleUrl) {
  try {
    const response = await axios.get(articleUrl);
    return cleanArticleContent(response.data);
  } catch (error) {
    console.error(
      `  -> Error al obtener contenido de ${articleUrl}:`,
      error.message
    );
    return ""; // Retorna vacío si no se puede obtener el contenido
  }
}

/**
 * Guarda un artículo en la base de datos.
 * @param {object} article - El objeto del artículo de la API.
 */
async function saveArticle(article, fullContent) {
  const hash = generateHash(article.link);
  const embeddedData = article._embedded || {};

  const authorName = article.yoast_head_json?.author || "CIPER";
  const imageUrl = embeddedData["wp:featuredmedia"]?.[0]?.source_url || null;
  const terms = embeddedData["wp:term"] || [];
  const categories = terms[0]?.map((cat) => cat.name) || [];
  const tags = terms[1]?.map((tag) => tag.name) || [];
  const description = cleanDescription(article.excerpt.rendered);

  //   console.log([
  //     SOURCE_ID_CIPER,
  //     article.title.rendered,
  //     description || fullContent.substring(0, 200),
  //     authorName,
  //     categories.length > 0 ? categories[0] : "General", // Guardar la primera categoría
  //     JSON.stringify(tags),
  //     fullContent,
  //     imageUrl,
  //     article.link,
  //     new Date(article.date_gmt),
  //     hash,
  //   ]);
  try {
    await db.execute(
      `INSERT INTO scraped_articles
          (source_id, title, description, author, section, tags, content, image_url, url, published_at, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      [
        SOURCE_ID_CIPER,
        article.title.rendered,
        description || fullContent.substring(0, 200),
        authorName,
        categories.length > 0 ? categories[0] : "General", // Guardar la primera categoría
        JSON.stringify(tags),
        fullContent,
        imageUrl,
        article.link,
        new Date(article.date_gmt),
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

async function runCiperScraper() {
  console.log(`🔄 Iniciando scraper de CiperChile...`);
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
        console.log(`📥 Procesando página ${page}`);
        const articles = await fetchArticles(page, PAGE_SIZE, categoryId);

        if (articles.length === 0) {
          console.log("No se encontraron más artículos. Terminando.");
          break;
        }

        for (const article of articles) {
          try {
            console.log(
              `  📄 Obteniendo contenido de: ${article.title.rendered}`
            );
            const fullContent = await getFullArticleContent(article.link);

            if (!fullContent) {
              console.log(
                `    -> Omitido (sin contenido en la página): ${article.title.rendered}`
              );
              continue;
            }

            await saveArticle(article, fullContent);
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
          await delay(DELAY_MS);
        }
        await delay(DELAY_MS * 2);
      }
    }
  } catch (err) {
    console.error("❌ Error fatal en el scraper de CiperChile:", err.message);
  } finally {
    if (db) await db.end();
    console.log(
      `✅ Scraper de CiperChile finalizado. Noticias procesadas: ${newsCount}`
    );
  }

  return newsCount;
}

export default runCiperScraper;
